import sql from './db.js';
const r = await sql`
  SELECT table_name, column_name 
  FROM information_schema.columns 
  WHERE table_schema='public' 
    AND column_name LIKE '%_te' 
    AND column_name NOT IN ('state','private','due_date','start_date','end_date','admission_date','attendance_date','exam_date','incident_date','expense_date','payment_date','joining_date','entry_date','homework_due_date','conversion_rate','highlight_quote','request_note','body_template','title_template','pad_attribute')
    AND table_name NOT LIKE 'pg_%' 
    AND table_name NOT LIKE 'messages_%'
  ORDER BY table_name, column_name
`;
console.log(JSON.stringify(r,null,2));
process.exit(0);
