ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE notifications ADD COLUMN expires_at timestamptz;
CREATE INDEX notifications_expiry_idx ON notifications (expires_at) WHERE status IN ('pending', 'sending');
