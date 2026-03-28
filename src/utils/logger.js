const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const m = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${m}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

/** Message/code for logging (AggregateError from pg often has empty .message). */
logger.errorDetail = function errorDetail(e) {
  if (!e) return 'unknown';
  if (e.message) return e.message;
  if (e.code) return String(e.code);
  if (e.name === 'AggregateError' && Array.isArray(e.errors) && e.errors.length) {
    return e.errors.map((x) => x.message || x.code || String(x)).join('; ');
  }
  return String(e);
};

module.exports = logger;
