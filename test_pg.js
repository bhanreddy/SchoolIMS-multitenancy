import sql from './db.js';
async function run() {
try {
const res = await sqlSELECT current_user, current_setting(\'role\');
console.log(res);
const res2 = await sqlSELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
console.log(res2);
process.exit(0);
} catch(e) { console.error(e); process.exit(1); }
}
run();
