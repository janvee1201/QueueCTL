const logger = require('../utils/logger');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

describe('Logging Module (Module 11)', () => {
  test('Winston is configured with both Console and File transports', () => {
    const transports = logger.transports;
    expect(transports.length).toBeGreaterThanOrEqual(2);

    const consoleTransport = transports.find((t) => t instanceof winston.transports.Console);
    const fileTransport = transports.find((t) => t instanceof winston.transports.File);

    expect(consoleTransport).toBeDefined();
    expect(fileTransport).toBeDefined();
    expect(fileTransport.filename).toContain('queuectl.log');
  });

  test('formatter includes job id and timestamp in every log line when jobId metadata is provided', () => {
    // We test the formatter by calling the format function directly on a mock log info object
    const infoObject = {
      level: 'info',
      message: 'Job lifecycle test message',
      jobId: 'test-uuid-1234',
    };

    const formattedInfo = logger.format.transform(infoObject);
    const logString = formattedInfo[Symbol.for('message')];

    // Must include timestamp, level, job ID, and message
    expect(logString).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    expect(logString).toContain('[INFO]');
    expect(logString).toContain('[Job ID: test-uuid-1234]');
    expect(logString).toContain('Job lifecycle test message');
  });

  test('logger supports info, warn, and error levels for lifecycle events', () => {
    // Ensure methods exist and can be called without errors during lifecycle tracking
    const spyInfo = jest.spyOn(logger, 'info');
    const spyWarn = jest.spyOn(logger, 'warn');
    const spyError = jest.spyOn(logger, 'error');

    logger.info('Job enqueued', { jobId: 'job-1' });
    logger.warn('Job failed attempt #1, retry scheduled', { jobId: 'job-1' });
    logger.error('Job exceeded max retries, moved to DLQ', { jobId: 'job-1' });

    expect(spyInfo).toHaveBeenCalledWith('Job enqueued', { jobId: 'job-1' });
    expect(spyWarn).toHaveBeenCalledWith('Job failed attempt #1, retry scheduled', { jobId: 'job-1' });
    expect(spyError).toHaveBeenCalledWith('Job exceeded max retries, moved to DLQ', { jobId: 'job-1' });

    spyInfo.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });
});
