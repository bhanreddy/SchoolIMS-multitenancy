import { NotificationTemplateService } from '../services/notificationTemplateService.js';
import { NotificationEventConfig } from '../services/notificationEventConfig.js';

const testCases = [
{ type: 'FEE_REMINDER', params: { message: '₹1000 due.' } },
{ type: 'ATTENDANCE_ABSENT', params: { date: '2023-10-27' } },
{ type: 'TIMETABLE_UPDATED', params: { message: 'Period 1 changed.' } }];

let errors = 0;

testCases.forEach(({ type, params }) => {
  try {

    const result = NotificationTemplateService.render(type, params);

    const config = NotificationEventConfig[type];

    // precise template check is hard without regex matching, but we check if placeholders are gone
    if (result.body.includes('{{')) {

      errors++;
    } else {

    }

    // Check Channel ID
    if (result.android.channelId !== config.channelId) {

      errors++;
    } else {

    }

    // Check Sound (indirectly via channelId logic in service, but here just consistency)
    // config.sound should exist
    if (!config.sound) {

      errors++;
    } else {

    }

  } catch (err) {

    errors++;
  }
});

if (errors === 0) {

  process.exit(0);
} else {

  process.exit(1);
}