/**
 * Repair Supabase auth.users rows that still carry legacy +school-{id} scoping.
 * Usage: node scripts/fix_scoped_auth_emails.js
 */
import { supabaseAdmin } from '../db.js';
import { isScopedSchoolEmail, stripSchoolEmailScope, normalizeEmail } from '../utils/email.js';

async function listAllAuthUsers() {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

async function main() {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
  }

  const users = await listAllAuthUsers();
  const scoped = users.filter((u) => isScopedSchoolEmail(u.email));

  if (scoped.length === 0) {
    console.log('No scoped auth emails found.');
    return;
  }

  console.log(`Found ${scoped.length} scoped auth user(s).`);

  for (const user of scoped) {
    const targetEmail = stripSchoolEmailScope(user.email);
    const conflict = users.find(
      (u) => u.id !== user.id && normalizeEmail(u.email) === targetEmail
    );

    if (conflict) {
      console.warn(
        `Skip ${user.email} → ${targetEmail}: already used by auth user ${conflict.id}`
      );
      continue;
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: targetEmail,
    });

    if (error) {
      console.error(`Failed ${user.email}:`, error.message);
    } else {
      console.log(`Updated ${user.email} → ${targetEmail}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
