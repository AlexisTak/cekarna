package auth

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"
)

func TestIntegrationMFAHasNoSessionBeforePasskeyAndConsumesCeremony(t *testing.T) {
	s := fixture(t)
	b := newBrowser(t, s)
	register := `{"email":"mfa@example.test","password":"une phrase secrète assez longue","first_name":"Mina"}`
	if response := b.call("POST", "/v1/auth/register", register); response.Code != 202 {
		t.Fatal("register", response.Code)
	}
	var uid string
	if err := s.Store.DB.QueryRow(context.Background(), "SELECT id FROM users WHERE email='mfa@example.test'").Scan(&uid); err != nil {
		t.Fatal(err)
	}
	credential := webauthn.Credential{ID: []byte("synthetic-credential"), PublicKey: []byte("synthetic-public-key")}
	raw, _ := json.Marshal(credential)
	if _, err := s.Store.DB.Exec(context.Background(), "INSERT INTO passkeys(id,user_id,credential_id,public_key,credential,name) VALUES($1,$2,$3,$4,$5,'Fixture')", randomToken(), uid, credential.ID, credential.PublicKey, raw); err != nil {
		t.Fatal(err)
	}
	response := b.call("POST", "/v1/auth/login", `{"email":"mfa@example.test","password":"une phrase secrète assez longue"}`)
	if response.Code != 202 || b.access != "" || b.refresh != nil {
		t.Fatal("MFA password step created a session", response.Code)
	}
	var pending struct {
		Token string `json:"mfa_token"`
	}
	if json.Unmarshal(response.Body.Bytes(), &pending) != nil || len(pending.Token) != 43 {
		t.Fatal("missing transition token")
	}
	response = b.call("POST", "/v1/auth/mfa/login/begin", `{"mfa_token":"`+pending.Token+`"}`)
	if response.Code != 200 {
		t.Fatal("begin", response.Code, response.Body.String())
	}
	var begin struct {
		ChallengeID string `json:"challenge_id"`
	}
	if json.Unmarshal(response.Body.Bytes(), &begin) != nil || len(begin.ChallengeID) != 43 {
		t.Fatal("missing challenge")
	}
	wrongToken := randomToken()
	if err := s.Guard.Redis.Set(context.Background(), "auth:mfa:pending:"+digest(wrongToken), randomToken(), mfaTTL).Err(); err != nil {
		t.Fatal(err)
	}
	response = b.call("POST", "/v1/auth/mfa/login/finish", `{"mfa_token":"`+wrongToken+`","challenge_id":"`+begin.ChallengeID+`","credential":{}}`)
	if response.Code != 401 || response.Body.String() != "{\"error\":\"invalid_token\"}\n" {
		t.Fatal("challenge accepted for another account", response.Code, response.Body.String())
	}
	response = b.call("POST", "/v1/auth/mfa/login/begin", `{"mfa_token":"`+pending.Token+`"}`)
	if response.Code != 200 {
		t.Fatal("begin after account mismatch", response.Code, response.Body.String())
	}
	if json.Unmarshal(response.Body.Bytes(), &begin) != nil || len(begin.ChallengeID) != 43 {
		t.Fatal("missing replacement challenge")
	}
	response = b.call("POST", "/v1/auth/mfa/login/finish", `{"mfa_token":"`+pending.Token+`","challenge_id":"`+begin.ChallengeID+`","credential":{}}`)
	if response.Code != 400 {
		t.Fatal("invalid assertion accepted", response.Code)
	}
	if response = b.call("POST", "/v1/auth/mfa/login/begin", `{"mfa_token":"`+pending.Token+`"}`); response.Code != 401 {
		t.Fatal("consumed transition token replayed", response.Code)
	}
	if response = b.call("POST", "/v1/auth/mfa/register/begin", `{"password":"une phrase secrète assez longue"}`); response.Code != 401 {
		t.Fatal("enrollment accepted without full session", response.Code)
	}
	response = b.call("POST", "/v1/auth/login", `{"email":"mfa@example.test","password":"une phrase secrète assez longue"}`)
	if response.Code != 202 || json.Unmarshal(response.Body.Bytes(), &pending) != nil {
		t.Fatal("second MFA password step", response.Code)
	}
	if err := s.Guard.Redis.Del(context.Background(), "auth:mfa:pending:"+digest(pending.Token)).Err(); err != nil {
		t.Fatal(err)
	}
	if response = b.call("POST", "/v1/auth/mfa/login/begin", `{"mfa_token":"`+pending.Token+`"}`); response.Code != 401 {
		t.Fatal("expired transition token accepted", response.Code)
	}
}
