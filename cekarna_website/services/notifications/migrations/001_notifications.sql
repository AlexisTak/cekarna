CREATE TYPE notification_status AS ENUM ('pending', 'sending', 'delivered', 'failed');

CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind ~ '^[a-z0-9_.-]{1,80}$'),
    recipient text NOT NULL,
    subject text NOT NULL,
    text_body text NOT NULL,
    status notification_status NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

CREATE INDEX notifications_dispatch_idx ON notifications (status, available_at, created_at);
CREATE INDEX notifications_created_idx ON notifications (created_at DESC);
