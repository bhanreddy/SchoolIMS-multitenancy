import { NotificationTemplateService, NotificationTypes } from '../services/notificationTemplateService.js';

const tests = [
{
  name: 'General Template',
  type: NotificationTypes.GENERAL,
  params: { message: 'Hello System' },
  expectedTitle: 'Notification',
  expectedBody: 'Hello System',
  expectedChannel: 'default_voice'
},
{
  name: 'Emergency Template',
  type: NotificationTypes.EMERGENCY,
  params: { message: 'Fire Drill' },
  expectedTitle: 'EMERGENCY ALERT',
  expectedBody: 'Fire Drill',
  expectedChannel: 'emergency'
},
{
  name: 'Fees Template',
  type: NotificationTypes.FEES,
  params: { amount: '500', month: 'October' },
  expectedTitle: 'Fee Reminder',
  expectedBody: '₹500 due for October.',
  expectedChannel: 'fees'
},
{
  name: 'Exam Template',
  type: NotificationTypes.EXAM,
  params: { examName: 'Maths Final', date: '2023-10-10' },
  expectedTitle: 'Exam: Maths Final',
  expectedBody: 'Scheduled on 2023-10-10.',
  expectedChannel: 'exam'
},
{
  name: 'Attendance Absent Template',
  type: NotificationTypes.ATTENDANCE_ABSENT,
  params: { date: '2023-10-01' },
  expectedTitle: 'Attendance Alert',
  expectedBody: 'Absent on 2023-10-01.',
  expectedChannel: 'attendance'
}];

let errors = 0;

tests.forEach((test) => {
  try {
    const result = NotificationTemplateService.render(test.type, test.params);
    if (result.title !== test.expectedTitle) throw new Error(`Title mismatch. Got: ${result.title}, Expected: ${test.expectedTitle}`);
    if (result.body !== test.expectedBody) throw new Error(`Body mismatch. Got: ${result.body}, Expected: ${test.expectedBody}`);
    if (result.android.channelId !== test.expectedChannel) throw new Error(`Channel mismatch. Got: ${result.android.channelId}, Expected: ${test.expectedChannel}`);

  } catch (e) {

    errors++;
  }
});

// Test Missing Params
try {

  NotificationTemplateService.render(NotificationTypes.FEES, { amount: '500' });

  errors++;
} catch (e) {
  if (e.message.includes('Missing required parameters')) {

  } else {

    errors++;
  }
}

// Test Invalid Type
try {

  NotificationTemplateService.render('INVALID_TYPE', {});

  errors++;
} catch (e) {
  if (e.message.includes('Invalid notification type')) {

  } else {

    errors++;
  }
}

if (errors === 0) {

  process.exit(0);
} else {

  process.exit(1);
}