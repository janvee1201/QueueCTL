const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const queueManager = require('../queue/queueManager');
const { retryManager } = require('../queue/retryManager');
const { configService } = require('../services/configService');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Configuration Manager', () => {
  beforeAll(async () => {
    await closeDb();
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch (e) {}
    }
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await repository.clearAll();
    const db = await getDb();
    await db.run('DELETE FROM Config');
  });

  test('set and get configs normalizing hyphens and underscores', async () => {
    await configService.setConfig('max-retries', 7);
    await configService.setConfig('backoff_base', 4);

    expect(await configService.getConfig('max_retries')).toBe(7);
    expect(await configService.getConfig('max-retries')).toBe(7);
    expect(await configService.getConfig('backoff-base')).toBe(4);

    const all = await configService.getAllConfig();
    expect(all.max_retries).toBe(7);
    expect(all.backoff_base).toBe(4);
  });

  test('set max_retries=5, enqueue a failing job, confirm exactly 5 retries occur before moving to DLQ', async () => {
    // 1. Set global config max_retries = 5 and backoff_base = 1
    await configService.setConfig('max_retries', 5);
    await configService.setConfig('backoff_base', 1);

    // 2. Enqueue a failing job without explicit overrides so it picks up global defaults
    const job = await queueManager.addJob({ command: 'always-fail-cmd' });
    expect(job.max_retries).toBe(5);
    expect(job.backoff_base).toBe(1);

    // 3. Simulate failure attempts 1 through 4 (should stay PENDING for retry)
    for (let attempt = 1; attempt <= 4; attempt++) {
      const retriedJob = await retryManager.handleFailure(job.id, `Failure ${attempt}`);
      expect(retriedJob.attempts).toBe(attempt);
      expect(retriedJob.state).toBe(JobState.PENDING);
    }

    // 4. Simulate the 5th failure (should transition to DEAD / DLQ)
    const deadJob = await retryManager.handleFailure(job.id, 'Failure 5 - max reached');
    expect(deadJob.attempts).toBe(5);
    expect(deadJob.state).toBe(JobState.DEAD);

    const deadList = await repository.listJobsByState(JobState.DEAD);
    expect(deadList.length).toBe(1);
    expect(deadList[0].id).toBe(job.id);
  });
});
