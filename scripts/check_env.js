import config from '../config/env.js';

if (config.databaseUrl) {
  const masked = config.databaseUrl.replace(/:[^:@]+@/, ':****@');

} else {

}