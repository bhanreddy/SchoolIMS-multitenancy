import sql from './db.js';
sql`SELECT 1`.then(() => {
  console.log('Query OK');
  process.exit(0);
}).catch(e => {
  console.error('Query Error:', e);
  process.exit(1);
});
