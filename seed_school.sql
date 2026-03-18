-- ============================================================
-- SEED SCHOOL DATA (Run once per new school onboarding)
-- ============================================================
-- Usage: Replace all occurrences of ${SCHOOL_ID} with the 
-- actual school ID before running.
-- ============================================================

DELETE FROM periods
WHERE id IN (
    SELECT id
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY sort_order ASC, id ASC) as rnum
        FROM periods
    ) t
    WHERE t.rnum > 1
);
UPDATE periods p
SET start_time = v.start_time,
    end_time = v.end_time,
    sort_order = v.sort_order
FROM (VALUES
  ('Period 1', '08:00'::time, '08:45'::time, 1),
  ('Period 2', '08:45'::time, '09:30'::time, 2),
  ('Period 3', '09:30'::time, '10:15'::time, 3),
  ('Break',    '10:15'::time, '10:30'::time, 4),
  ('Period 4', '10:30'::time, '11:15'::time, 5),
  ('Period 5', '11:15'::time, '12:00'::time, 6),
  ('Lunch',    '12:00'::time, '12:45'::time, 7),
  ('Period 6', '12:45'::time, '13:30'::time, 8),
  ('Period 7', '13:30'::time, '14:15'::time, 9),
  ('Period 8', '14:15'::time, '15:00'::time, 10)
) AS v(name, start_time, end_time, sort_order)
WHERE p.school_id = ${SCHOOL_ID} AND p.name = v.name;
INSERT INTO periods (name, start_time, end_time, sort_order)
SELECT v.name, v.start_time, v.end_time, v.sort_order
FROM (VALUES
  ('Period 1', '08:00'::time, '08:45'::time, 1),
  ('Period 2', '08:45'::time, '09:30'::time, 2),
  ('Period 3', '09:30'::time, '10:15'::time, 3),
  ('Break',    '10:15'::time, '10:30'::time, 4),
  ('Period 4', '10:30'::time, '11:15'::time, 5),
  ('Period 5', '11:15'::time, '12:00'::time, 6),
  ('Lunch',    '12:00'::time, '12:45'::time, 7),
  ('Period 6', '12:45'::time, '13:30'::time, 8),
  ('Period 7', '13:30'::time, '14:15'::time, 9),
  ('Period 8', '14:15'::time, '15:00'::time, 10)
) AS v(name, start_time, end_time, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM periods p WHERE p.school_id = ${SCHOOL_ID} AND p.name = v.name
);
DELETE FROM periods WHERE name NOT IN (
    'Period 1', 'Period 2', 'Period 3', 'Break', 'Period 4', 'Period 5', 'Lunch', 'Period 6', 'Period 7', 'Period 8'
);
INSERT INTO permissions (code, name)
SELECT v.code, v.name
FROM (VALUES
('students.view', 'View Students'), ('students.create', 'Create Students'), ('students.edit', 'Edit Students'), ('students.delete', 'Delete Students'),
('staff.view', 'View Staff'), ('staff.create', 'Create Staff'), ('staff.edit', 'Edit Staff'), ('staff.delete', 'Delete Staff'),
('users.view', 'View Users'), ('users.create', 'Create Users'), ('users.edit', 'Edit Users'), ('users.delete', 'Delete Users'),
('academics.view', 'View Academics'), ('academics.manage', 'Manage Academics'),
('attendance.view', 'View Attendance'), ('attendance.mark', 'Mark Attendance'), ('attendance.edit', 'Edit Attendance'),
('fees.view', 'View Fees'), ('fees.manage', 'Manage Fees'), ('fees.collect', 'Collect Fees'),
('transactions.view', 'View Transactions'), ('receipts.generate', 'Generate Receipts'), ('reports.financial', 'View Financial Reports'),
('exams.view', 'View Exams'), ('exams.manage', 'Manage Exams'), ('marks.view', 'View Marks'), ('marks.enter', 'Enter Marks'), ('results.view', 'View Results'), ('results.generate', 'Generate Results'),
('transport.view', 'View Transport'), ('transport.manage', 'Manage Transport'),
('hostel.view', 'View Hostel'), ('hostel.manage', 'Manage Hostel'),
('events.view', 'View Events'), ('events.manage', 'Manage Events'),
('lms.view', 'View LMS'), ('lms.create', 'Create LMS Content'), ('lms.manage', 'Manage LMS'),
('complaints.view', 'View Complaints'), ('complaints.create', 'Create Complaints'), ('complaints.manage', 'Manage Complaints'),
('notices.view', 'View Notices'), ('notices.create', 'Create Notices'), ('notices.manage', 'Manage Notices'),
('leaves.view', 'View Leaves'), ('leaves.apply', 'Apply for Leave'), ('leaves.approve', 'Approve Leaves'),
('diary.view', 'View Diary'), ('diary.create', 'Create Diary Entries'),
('timetable.view', 'View Timetable'), ('timetable.manage', 'Manage Timetable'),
('dashboard.view', 'View Dashboard'),
('results.publish', 'Publish Results'),
('diary.manage', 'Manage Diary')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.school_id = ${SCHOOL_ID} AND p.code = v.code
);
INSERT INTO roles (code, name, is_system)
SELECT v.code, v.name, v.is_system
FROM (VALUES
('admin', 'Administrator', true),
('staff', 'Staff/Teacher', true),
('student', 'Student', true),
('accounts', 'Accounts Manager', true),
('principal', 'Principal', true),
('driver', 'Driver', true)
) AS v(code, name, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.school_id = ${SCHOOL_ID} AND r.code = v.code
);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'staff' AND p.code IN (
    'students.view', 'academics.view', 'attendance.view', 'attendance.mark', 
    'exams.view', 'marks.enter', 'marks.view', 'diary.view', 'diary.create',
    'timetable.view', 'leaves.apply', 'notices.view', 'events.view', 'lms.view'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'student' AND p.code IN (
    'academics.view', 'attendance.view', 'exams.view', 'results.view', 
    'diary.view', 'timetable.view', 'notices.view', 'events.view', 'lms.view', 'fees.view'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'accounts' AND p.code IN (
    'fees.view', 'fees.manage', 'fees.collect', 'transactions.view', 
    'receipts.generate', 'reports.financial', 'notices.view', 'staff.view',
    'dashboard.view'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'principal'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.code = 'driver' AND p.code IN (
    'transport.view', 'notices.view'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
INSERT INTO notification_config (key, value)
SELECT v.key, v.value
FROM (VALUES
  ('kill_switch',              '{"global": false, "types": {}}'::jsonb),
  ('max_batch_size',           '{"value": 500}'::jsonb),
  ('fee_reminder_daily_limit', '{"value": 1}'::jsonb)
) AS v(key, value)
WHERE NOT EXISTS (
  SELECT 1 FROM notification_config nc WHERE nc.key = v.key
);
INSERT INTO financial_policy_rules (rule_code, rule_name, description, value_type, default_value, current_value)
SELECT v.rule_code, v.rule_name, v.description, v.value_type, v.default_value, v.current_value
FROM (VALUES
  ('EXPENSE_AUTO_APPROVE_LIMIT', 'Expense Auto-Approval Limit', 'Expenses below this amount are auto-approved.', 'amount', '1000'::jsonb, '1000'::jsonb),
  ('CASH_COLLECTION_DAILY_LIMIT', 'Daily Cash Collection Limit', 'Maximum cash a user can collect per day.', 'amount', '50000'::jsonb, '50000'::jsonb),
  ('FEE_WAIVER_MAX_PERCENT', 'Max Fee Waiver Percentage', 'Maximum percentage of fee that can be waived.', 'percentage', '20'::jsonb, '20'::jsonb),
  ('PAYROLL_OVERRIDE_ALLOWED', 'Payroll Override Allowed', 'Can payroll values be manually overridden?', 'boolean', 'false'::jsonb, 'false'::jsonb),
  ('LOCK_PAST_MONTHS_DAYS', 'Lock Past Months After (Days)', 'Number of days after which previous month data is locked.', 'amount', '7'::jsonb, '7'::jsonb)
) AS v(rule_code, rule_name, description, value_type, default_value, current_value)
WHERE NOT EXISTS (
  SELECT 1 FROM financial_policy_rules fpr WHERE fpr.rule_code = v.rule_code
);
INSERT INTO school_settings (school_id, key, value)
SELECT v.school_id, v.key, v.value
FROM (VALUES
  (${SCHOOL_ID}, 'school_name',        'Default School Name'),
  (${SCHOOL_ID}, 'school_timezone',    'Asia/Kolkata'),
  (${SCHOOL_ID}, 'school_hours_start', '08:00'),
  (${SCHOOL_ID}, 'school_hours_end',   '17:00'),
  (${SCHOOL_ID}, 'admin_email',        'admin@school.local')
) AS v(school_id, key, value)
WHERE NOT EXISTS (
  SELECT 1 FROM school_settings ss
  WHERE ss.school_id = v.school_id AND ss.key = v.key
);