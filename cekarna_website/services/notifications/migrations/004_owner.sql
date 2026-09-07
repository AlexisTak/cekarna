ALTER TABLE notifications ADD COLUMN owner_id text;
CREATE INDEX notifications_owner_idx ON notifications (owner_id);
