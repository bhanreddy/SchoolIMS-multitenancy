-- Part 1: Delivery Observability
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    role TEXT,
    notification_type TEXT NOT NULL,
    channel_id TEXT,
    push_provider TEXT DEFAULT 'fcm',
    provider_response JSONB,
    status TEXT CHECK (status IN ('success', 'failed', 'partial')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Part 3: Rate Limiting (Optional: can use Redis, but DB is fine for this scale)
-- We will query notification_logs for rate limiting, so we need good indexes.
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_type_date ON notification_logs(user_id, notification_type, created_at);

-- Part 6: Incident Kill Switch
CREATE TABLE IF NOT EXISTS notification_config (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed default config if not exists
INSERT INTO notification_config (key, value)
VALUES 
    ('kill_switch', '{"global": false, "types": {}}')
ON CONFLICT (key) DO NOTHING;
