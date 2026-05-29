/**
 * Email helpers — store and authenticate with the user's real address.
 * Never inject +school-{id} scoping; multitenant uniqueness is enforced in DB.
 */

const SCOPED_EMAIL_PATTERN = /\+school-\d+/i;

/** Trim and lowercase. Does not mutate the local part beyond that. */
export function normalizeEmail(email) {
  if (email == null) return null;
  const trimmed = String(email).trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function isScopedSchoolEmail(email) {
  return typeof email === 'string' && SCOPED_EMAIL_PATTERN.test(email);
}

/**
 * Strip legacy +school-{schoolId}-{hash} suffixes from corrupted records.
 * Example: staff+school-3-abc@school.com → staff@school.com
 */
export function stripSchoolEmailScope(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isScopedSchoolEmail(normalized)) return normalized;

  const at = normalized.indexOf('@');
  if (at <= 0) return normalized;

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const baseLocal = localPart.split('+')[0];
  return `${baseLocal}@${domain}`;
}
