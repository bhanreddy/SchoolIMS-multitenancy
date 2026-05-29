/**
 * Email helpers — store and authenticate with the user's real address.
 * Never inject +school-{id} scoping; multitenant uniqueness is enforced in DB.
 */

const SCOPED_EMAIL_PATTERN = /\+school-\d+/i;

function stripScopedSuffix(email) {
  const at = email.indexOf('@');
  if (at <= 0) return email;

  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!SCOPED_EMAIL_PATTERN.test(localPart)) return email;

  return `${localPart.split('+')[0]}@${domain}`;
}

/** Trim, lowercase, and strip any legacy +school-{id}-{hash} suffix if present. */
export function normalizeEmail(email) {
  if (email == null) return null;
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed) return null;
  return stripScopedSuffix(trimmed);
}

export function isScopedSchoolEmail(email) {
  return typeof email === 'string' && SCOPED_EMAIL_PATTERN.test(email);
}

/**
 * Strip legacy +school-{schoolId}-{hash} suffixes from corrupted records.
 * Example: staff+school-13-2529d6943273c30d@samskruthe.com → staff@samskruthe.com
 */
export function stripSchoolEmailScope(email) {
  if (email == null) return null;
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed) return null;
  return stripScopedSuffix(trimmed);
}
