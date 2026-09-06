ALTER TABLE notifications ADD COLUMN locked_at timestamptz;
CREATE INDEX notifications_stalled_idx ON notifications (status, locked_at) WHERE status = 'sending';
