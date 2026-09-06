package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/redis/go-redis/v9"
)

type Guard struct {
	Redis *redis.Client
	Key   []byte
}

func (g Guard) Identity(value string) string {
	m := hmac.New(sha256.New, g.Key)
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

var limitScript = redis.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n`)

func (g Guard) Allow(ctx context.Context, bucket string, max int, window time.Duration) (bool, error) {
	n, err := limitScript.Run(ctx, g.Redis, []string{"auth:limit:" + g.Identity(bucket)}, window.Milliseconds()).Int64()
	return n <= int64(max), err
}
func (g Guard) Block(ctx context.Context, sid string) error {
	if sid == "" {
		return nil
	}
	return g.Redis.Set(ctx, "auth:revoked:"+sid, "1", 15*time.Minute).Err()
}
func (g Guard) Blocked(ctx context.Context, sid string) (bool, error) {
	n, err := g.Redis.Exists(ctx, "auth:revoked:"+sid).Result()
	return n != 0, err
}
