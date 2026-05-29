import { supabaseAdmin } from '../db.js';
import { isScopedSchoolEmail, normalizeEmail } from '../utils/email.js';

/**
 * Paginate through Supabase Auth users to find one by email (case-insensitive).
 */
export async function findAuthUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !supabaseAdmin) return null;

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Auth List Error: ${error.message}`);

    const match = data.users.find((u) => normalizeEmail(u.email) === normalized);
    if (match) return match;

    if (data.users.length < perPage) break;
    page += 1;
  }

  return null;
}

/**
 * Create a Supabase Auth user with the raw email, or link an existing auth account.
 * Never applies +school-{id} scoping.
 */
export async function createOrLinkAuthUser({ email, password, userMetadata = {} }) {
  if (!supabaseAdmin) {
    throw new Error('Server misconfiguration: Admin client not initialized');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  if (isScopedSchoolEmail(String(email))) {
    console.warn('[authUserService] Received scoped email input; storing raw address instead:', normalizedEmail);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (!authError) {
    return { authUserId: authData.user.id, created: true, email: normalizedEmail };
  }

  const alreadyExists =
    authError.message?.includes('already been registered') ||
    authError.message?.includes('already registered');

  if (alreadyExists) {
    const existing = await findAuthUserByEmail(normalizedEmail);
    if (!existing) {
      throw new Error('User reported existing but not found in auth');
    }

    await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      user_metadata: { ...(existing.user_metadata || {}), ...userMetadata },
    });

    return { authUserId: existing.id, created: false, email: normalizedEmail };
  }

  throw new Error(`Supabase Auth Error: ${authError.message}`);
}
