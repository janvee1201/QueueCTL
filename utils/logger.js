const winston = require('winston');
const path = require('path');
const fs = require('fs');
const pc = require('picocolors');

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

const plainFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, jobId, ...meta }) => {
    const idPart = jobId ? ` [Job ID: ${jobId}]` : '';
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}]${idPart}: ${message}${metaString}`;
  })
);

const consoleFormatter = winston.format.printf(({ timestamp, level, message, jobId, ...meta }) => {
  const idPart = jobId ? ` ${pc.magenta(`[Job ID: ${jobId}]`)}` : '';
  const metaString = Object.keys(meta).length ? ` ${pc.dim(JSON.stringify(meta))}` : '';
  
  let coloredLevel = level.toUpperCase();
  let icon = 'ℹ️';
  let formattedMessage = message;

  if (level === 'info') {
    coloredLevel = pc.cyan('INFO');
    icon = 'ℹ️';
  } else if (level === 'warn') {
    coloredLevel = pc.yellow('WARN');
    icon = '⚠️';
  } else if (level === 'error') {
    coloredLevel = pc.red('ERROR');
    icon = '❌';
  }

  // Detect specific log types to apply custom icons and colors
  if (message.includes('started') && message.includes('Worker')) {
    icon = '🚀';
    formattedMessage = pc.green(message);
  } else if (message.includes('enqueued')) {
    icon = '📥';
    formattedMessage = pc.cyan(message);
  } else if (message.includes('picked up by worker')) {
    icon = '⚙️';
    formattedMessage = pc.blue(message);
  } else if (message.includes('completed successfully')) {
    icon = '✅';
    formattedMessage = pc.green(message);
  } else if (message.includes('failed attempt')) {
    icon = '⚠️';
    formattedMessage = pc.yellow(message);
  } else if (message.includes('exceeded max retries') || message.includes('DLQ')) {
    icon = '💀';
    formattedMessage = pc.red(message);
  } else if (message.includes('Cleaned up stale') || message.includes('drain complete') || message.includes('Reclaimed')) {
    icon = '🧹';
    formattedMessage = pc.gray(message);
  } else {
    // General coloring
    if (level === 'info') {
      formattedMessage = pc.white(message);
    } else if (level === 'warn') {
      formattedMessage = pc.yellow(message);
    } else if (level === 'error') {
      formattedMessage = pc.red(message);
    }
  }

  return `[${pc.gray(timestamp)}] [${coloredLevel}]${idPart} ${icon} ${formattedMessage}${metaString}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: plainFormat,
  transports: [
    new winston.transports.Console({
      silent: isSilent,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        consoleFormatter
      )
    }),
    new winston.transports.File({
      filename: logPath,
      silent: isSilent,
      format: plainFormat
    }),
  ],
});

module.exports = logger;
