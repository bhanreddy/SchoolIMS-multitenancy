import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// We need a postgres client to insert directly into super_admins
const sql = postgres(process.env.DATABASE_URL);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));

async function seedSuperAdmin() {
  console.log('\n=== Super Admin Bootstrap ===\n');

  try {
    const email = await prompt('Enter email (or press enter for default 25e001.nexsyrus@gmail.com): ') || '25e001.nexsyrus@gmail.com';
    const password = await prompt('Enter password (or press enter for default 25E001@nex): ') || '25E001@nex';
    const fullName = await prompt('Enter full name (or press enter for default Super Admin): ') || 'Super Admin';

    let authId = null;

    // 1. Create or find user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (authError) {
      if (authError.message.includes('already exists') || authError.code === 'email_exists' || authError.status === 422) {
        console.log(`\nUser ${email} already exists in Supabase Auth. Fetching ID...`);
        const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) throw listError;

        const existingUser = usersData.users.find(u => u.email === email);
        if (!existingUser) {
          throw new Error('Could not find existing user ID in Auth.');
        }
        authId = existingUser.id;
      } else {
        throw authError;
      }
    } else {
      authId = authData.user.id;
      console.log(`\nCreated new Auth user: ${authId}`);
    }

    // 2. Insert into super_admins table
    const existingAdmin = await sql`
      SELECT id FROM super_admins WHERE id = ${authId}
    `;

    if (existingAdmin.length > 0) {
      console.log(`\nUser is already a super admin in the database. Updating name.`);
      await sql`
        UPDATE super_admins
        SET full_name = ${fullName}
        WHERE id = ${authId}
      `;
    } else {
      console.log(`\nInserting into super_admins table...`);
      await sql`
        INSERT INTO super_admins (id, email, full_name, created_by)
        VALUES (${authId}, ${email}, ${fullName}, NULL)
      `;
    }

    console.log(`\n✅ Super admin created: ${email} (id: ${authId})\n`);

  } catch (error) {
    console.error('\n❌ Error bootstrapping super admin:', error.message || error);
  } finally {
    rl.close();
    await sql.end();
  }
}

seedSuperAdmin();
