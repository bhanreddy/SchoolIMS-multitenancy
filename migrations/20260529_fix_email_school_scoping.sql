-- Fix legacy +school-{id} email scoping in person_contacts and enforce per-school email uniqueness.
-- The users table does not store email; person_contacts.contact_value is the canonical app email.

-- 1. Audit corrupted records (run manually to inspect before/after):
-- SELECT COUNT(*), school_id
-- FROM person_contacts
-- WHERE contact_type = 'email'
--   AND deleted_at IS NULL
--   AND contact_value LIKE '%+school-%'
-- GROUP BY school_id;

-- 2. Strip injected +school-{schoolId}-{hash} suffixes from all schools
UPDATE person_contacts
SET contact_value = lower(trim(concat(
  split_part(contact_value, '+', 1),
  '@',
  split_part(contact_value, '@', 2)
)))
WHERE contact_type = 'email'
  AND deleted_at IS NULL
  AND contact_value LIKE '%+school-%';

-- 3. Detect duplicate primary emails within the same school before adding the constraint:
-- SELECT lower(contact_value) AS email, school_id, COUNT(*) AS cnt
-- FROM person_contacts
-- WHERE contact_type = 'email'
--   AND is_primary = true
--   AND deleted_at IS NULL
-- GROUP BY lower(contact_value), school_id
-- HAVING COUNT(*) > 1;

-- 4. Composite unique: same email allowed across schools, not within the same school
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_contacts_email_per_school
ON person_contacts (school_id, lower(contact_value))
WHERE contact_type = 'email'
  AND is_primary = true
  AND deleted_at IS NULL;
