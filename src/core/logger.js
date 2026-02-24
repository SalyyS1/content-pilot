import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import config from './config.js';
import { resolve } from 'path';

const logDir = resolve(config.dataDir, 'logs');

// Custom format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) log += ` ${JSON.stringify(meta)}`;
    return log;
  })
);

// In-memory log buffer for dashboard real-time viewer
const logBuffer = [];
const MAX_BUFFER = 500;

// Custom transport for in-memory buffer
class BufferTransport extends winston.transports.Console {
  constructor(opts) {
    super({ ...opts, stderrLevels: [] });
  }
  log(info, callback) {
    const msg = `${info.timestamp || ''} [${(info.level || '').toUpperCase().padEnd(5)}] ${info.message || ''}`;
    logBuffer.push(msg.trim());
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
    if (callback) callback();
  }
}

const bufferTransport = new BufferTransport({ silent: false });

const logger = winston.createLogger({
  level: 'debug',
  format: logFormat,
  transports: [
    // Console
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // Daily rotate file
    new DailyRotateFile({
      dirname: logDir,
      filename: 'reup-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'debug',
    }),
    // Error file
    new DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    }),
    // Buffer for dashboard
    bufferTransport
  ]
});

export function getLogBuffer() {
  return [...logBuffer];
}

export default logger;
