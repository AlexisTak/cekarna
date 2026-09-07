ALTER TABLE notifications
    ADD COLUMN idempotency_key text UNIQUE;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_idempotency_key_format
    CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[a-f0-9]{64}$');
