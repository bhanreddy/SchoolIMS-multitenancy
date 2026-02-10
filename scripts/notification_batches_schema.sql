-- Part 1: Fee Reminder Batch System Schema
CREATE TABLE IF NOT EXISTS notification_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('FEES', 'GENERAL', 'EXAM', 'EMERGENCY')), -- Extendable
    filters JSONB DEFAULT '{}',
    status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'aborted')) DEFAULT 'pending',
    total_targets INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for rate limiting (finding last batch by type/created_at)
CREATE INDEX IF NOT EXISTS idx_notification_batches_type_created ON notification_batches(type, created_at);
