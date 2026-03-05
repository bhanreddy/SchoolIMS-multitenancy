
import 'dotenv/config';
import config from '../config/env.js';

const connectionString = config.databaseUrl;

try {
  const url = new URL(connectionString);

  // Do not log password

} catch (e) {

}