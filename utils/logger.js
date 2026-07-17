const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.resolve(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (e) {
    // Ignore error if unable to create logs dir immediately
  }
}

const logPath = path.join(logDir, 'queuectl.log');
const isSilent = process.env.NODE_ENV === 'test' && !process.env.DEBUG_TESTS;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.printf(({ timestamp, level, message, jobId, ...meta }) => {
      const idPart = jobId ? ` [Job ID: ${jobId}]` : '';
      const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] [${level.toUpperCase()}]${idPart}: ${message}${metaString}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      silent: isSilent,
    }),
    new winston.transports.File({
      filename: logPath,
      silent: isSilent,
    }),
  ],
});

module.exports = logger;
