package migrations

import (
	"context"
	_ "embed"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed 001_auth.sql
var schema001 string

//go:embed 002_email_tokens.sql
var schema002 string

//go:embed 003_candidate_workspaces.sql
var schema003 string

//go:embed 004_workspace_revisions.sql
var schema004 string

//go:embed 005_initialize_candidate_profiles.sql
var schema005 string

//go:embed 006_email_outbox.sql
var schema006 string

//go:embed 007_passkeys.sql
var schema007 string

// Apply is an explicit deployment command, never run by the HTTP process.
func Apply(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(746283019)"); err != nil {
		return err
	}
	for _, migration := range []string{schema001, schema002, schema003, schema004, schema005, schema006, schema007} {
		if _, err = tx.Exec(ctx, migration); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
