import fs from 'fs';
const lines = fs.readFileSync('schema.sql', 'utf8').split('\n');
const tablesToFind = ['staff_designations', 'staff_departments', 'student_statuses'];

tablesToFind.forEach(table => {
  console.log(`\n--- TABLE: ${table} ---`);
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const lineStr = lines[i].toLowerCase();
    if (lineStr.includes('create table') && 
        (lineStr.includes(` ${table} `) || lineStr.includes(` ${table}(`) || lineStr.includes(` "${table}" `)) ) {
      inTable = true;
    }
    if (inTable) {
      console.log(`${i+1}: ${lines[i]}`);
      if (lines[i].includes(');')) {
        inTable = false;
        break;
      }
    }
  }
});
