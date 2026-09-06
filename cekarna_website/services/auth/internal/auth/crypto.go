package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"
)

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(token string) string { h := sha256.Sum256([]byte(token)); return hex.EncodeToString(h[:]) }
func validPassword(p string) bool {
	return utf8.ValidString(p) && utf8.RuneCountInString(p) >= 15 && len(p) <= 128
}
func hashPassword(p string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key := argon2.IDKey([]byte(p), salt, 3, 64*1024, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}
func verifyPassword(p, encoded string) bool {
	parts := strings.Split(encoded, "$")
	// Bound parameters before allocating memory; new profiles need explicit migration support.
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=1" {
		return false
	}
	salt, e1 := base64.RawStdEncoding.DecodeString(parts[4])
	expected, e2 := base64.RawStdEncoding.DecodeString(parts[5])
	if e1 != nil || e2 != nil || len(salt) != 16 || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(p), salt, 3, 64*1024, 1, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

type AccessClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}
type Signer struct {
	Key              ed25519.PrivateKey
	Issuer, Audience string
	TTL              time.Duration
	Previous         []ed25519.PublicKey
}

func keyID(key ed25519.PublicKey) string { return digest(string(key))[:24] }
func (s Signer) Issue(uid, sid string) (string, error) {
	now := time.Now()
	claims := AccessClaims{sid, jwt.RegisteredClaims{Issuer: s.Issuer, Subject: uid, Audience: jwt.ClaimStrings{s.Audience}, IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(s.TTL)), ID: randomToken()}}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = keyID(s.Key.Public().(ed25519.PublicKey))
	token.Header["typ"] = "at+jwt"
	return token.SignedString(s.Key)
}
func (s Signer) PublicKeys() []ed25519.PublicKey {
	return append([]ed25519.PublicKey{s.Key.Public().(ed25519.PublicKey)}, s.Previous...)
}
func (s Signer) Verify(raw string) (*AccessClaims, error) {
	claims := new(AccessClaims)
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		if t.Header["typ"] != "at+jwt" {
			return nil, errors.New("token type")
		}
		for _, key := range s.PublicKeys() {
			if t.Header["kid"] == keyID(key) {
				return key, nil
			}
		}
		return nil, errors.New("unknown kid")
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer(s.Issuer), jwt.WithAudience(s.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		return nil, err
	}
	if claims.Subject == "" || claims.SessionID == "" || claims.ID == "" || claims.IssuedAt == nil || claims.NotBefore == nil || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > 15*time.Minute {
		return nil, errors.New("invalid claims")
	}
	return claims, nil
}
func (s Signer) JWKS() map[string]any {
	keys := []map[string]string{}
	for _, pub := range s.PublicKeys() {
		keys = append(keys, map[string]string{"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": keyID(pub), "x": base64.RawURLEncoding.EncodeToString(pub)})
	}
	return map[string]any{"keys": keys}
}
