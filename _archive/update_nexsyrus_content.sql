-- ============================================================
-- NEXSYRUS TABS: NATIVE CONTENT UPDATE
-- ============================================================

-- 1. Money Science: Replace content_url with native content fields
ALTER TABLE money_science_modules 
ADD COLUMN IF NOT EXISTS content_body TEXT, -- Markdown or JSON content
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS estimated_duration INTEGER, -- Minutes
ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR(20) DEFAULT 'beginner',
ADD COLUMN IF NOT EXISTS tags TEXT[],
DROP COLUMN IF EXISTS content_url;

-- 2. Life Values: Enhance for native content
ALTER TABLE life_values_modules
ADD COLUMN IF NOT EXISTS content_body TEXT,
ADD COLUMN IF NOT EXISTS banner_image_url TEXT,
ADD COLUMN IF NOT EXISTS quote_author VARCHAR(100),
ADD COLUMN IF NOT EXISTS highlight_quote TEXT;

-- 3. Science Projects: Enhance
ALTER TABLE science_projects
ADD COLUMN IF NOT EXISTS materials_required TEXT[],
ADD COLUMN IF NOT EXISTS safety_instructions TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- 4. Discipline: No change needed usually, but let's ensure evidence links
ALTER TABLE discipline_records
ADD COLUMN IF NOT EXISTS evidence_urls TEXT[];
