import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function updateRLS() {
  await client.connect();
  const tables = ['money_science_modules', 'life_values_modules', 'science_projects'];
  
  for (const table of tables) {
    console.log(`Updating policies for ${table}...`);
    try {
      // Allow superadmin (service_role or custom role) to do anything
      // In this setup, superadmins either have role='service_role' or a custom claim.
      // Usually, service_role has BYPASSRLS, but we'll add explicit policies just in case,
      // or check if superadmin is identified by a specific role.
      // Actually, looking at superAdmin app, it might use normal auth but with a specific role.
      // Let's create a policy that allows 'service_role' and 'superadmin' to fully manage.
      
      const res = await client.query(`
        DROP POLICY IF EXISTS "Superadmin full access" ON ${table};
        CREATE POLICY "Superadmin full access" 
          ON ${table}
          FOR ALL 
          USING (
            (auth.jwt() ->> 'role'::text) = 'service_role'::text OR 
            (auth.jwt() ->> 'role'::text) = 'superadmin'::text
          )
          WITH CHECK (
            (auth.jwt() ->> 'role'::text) = 'service_role'::text OR 
            (auth.jwt() ->> 'role'::text) = 'superadmin'::text
          );
      `);
      console.log(`Success for ${table}`);
    } catch (e) {
      console.error(`Error on ${table}:`, e.message);
    }
  }
  await client.end();
}

updateRLS().catch(console.error);
