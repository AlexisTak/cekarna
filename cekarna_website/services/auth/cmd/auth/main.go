package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"cekarna/auth/internal/auth"
	"cekarna/auth/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func secret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func writeExclusive(path, value string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("secret file already exists or cannot be created")
	}
	defer f.Close()
	_, err = f.WriteString(value)
	return err
}
func initDev() error {
	if err := os.MkdirAll(".secrets", 0700); err != nil {
		return err
	}
	keyPath := filepath.Join(".secrets", "ed25519.key")
	if err := writeExclusive(keyPath, secret()); err != nil {
		return err
	}
	value := fmt.Sprintf("POSTGRES_PASSWORD=%s\nREDIS_PASSWORD=%s\nAUDIT_HMAC_KEY=%s\n", secret(), secret(), secret())
	if err := writeExclusive(".env", value); err != nil {
		return err
	}
	slog.Info("local secrets created; run docker compose up --build -d")
	return nil
}
func run() error {
	if len(os.Args) == 3 && os.Args[1] == "keygen" {
		if err := writeExclusive(os.Args[2], secret()); err != nil {
			return err
		}
		slog.Info("signing key created")
		return nil
	}
	if len(os.Args) == 3 && os.Args[1] == "public-key" {
		raw, err := os.ReadFile(os.Args[2])
		if err != nil {
			return errors.New("cannot read signing key file")
		}
		seed, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(seed) != ed25519.SeedSize {
			return errors.New("invalid signing key file")
		}
		fmt.Println(base64.RawURLEncoding.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)))
		return nil
	}
	if len(os.Args) > 1 && os.Args[1] == "init-dev" {
		return initDev()
	}
	if len(os.Args) > 1 && os.Args[1] != "migrate" {
		return errors.New("usage: auth [init-dev | migrate | keygen PATH | public-key PATH]")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	// Migrations use the owner account, separately from the HTTP service in production.
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
		if err != nil {
			return errors.New("invalid migration database configuration")
		}
		defer db.Close()
		migrationCtx, stop := context.WithTimeout(ctx, 30*time.Second)
		defer stop()
		if err = migrations.Apply(migrationCtx, db); err != nil {
			return errors.New("migration failed")
		}
		slog.Info("schema ready")
		return nil
	}
	config, err := auth.LoadConfig()
	if err != nil {
		return err
	}
	pg, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		return errors.New("invalid PostgreSQL configuration")
	}
	pg.MaxConns = 12
	pg.ConnConfig.ConnectTimeout = 5 * time.Second
	db, err := pgxpool.NewWithConfig(ctx, pg)
	if err != nil {
		return errors.New("database initialization failed")
	}
	defer db.Close()
	options, err := redis.ParseURL(config.RedisURL)
	if err != nil {
		return errors.New("invalid Redis configuration")
	}
	options.DialTimeout = 3 * time.Second
	options.ReadTimeout = 2 * time.Second
	options.WriteTimeout = 2 * time.Second
	options.MaxRetries = 1
	options.PoolSize = 12
	cache := redis.NewClient(options)
	defer cache.Close()
	readyCtx, stop := context.WithTimeout(ctx, 10*time.Second)
	defer stop()
	if db.Ping(readyCtx) != nil || cache.Ping(readyCtx).Err() != nil {
		return errors.New("PostgreSQL or Redis unavailable")
	}
	app := auth.NewServer(config, auth.Store{DB: db}, auth.Guard{Redis: cache, Key: config.AuditKey}, config.Mailer)
	server := &http.Server{Addr: config.Address, Handler: app.Routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	result := make(chan error, 1)
	go func() {
		slog.Info("auth service listening", "address", config.Address)
		result <- server.ListenAndServe()
	}()
	select {
	case err = <-result:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP server stopped unexpectedly")
		}
		return nil
	case <-ctx.Done():
		shutdownCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		return server.Shutdown(shutdownCtx)
	}
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("auth stopped", "reason", err.Error())
		os.Exit(1)
	}
}
