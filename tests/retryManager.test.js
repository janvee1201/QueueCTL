const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const queueManager = require('../queue/queueManager');
const { retryManager } = require('../queue/retryManager');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Retry Manager', () => {
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
  });

  test('computes increasing delays (2s, 4s, 8s for base=2) and transitions to DEAD when max_retries reached', async () => {
    const job = await queueManager.addJob({
      command: 'guaranteed-failing-command',
      max_retries: 3,
      backoff_base: 2, // base = 2 seconds
    });

    const now = Date.now();

    // 1st failure -> attempts = 1, formula: 2^1 = 2 seconds delay
    const retry1 = await retryManager.handleFailure(job.id, 'Failure 1');
    expect(retry1.attempts).toBe(1);
    expect(retry1.state).toBe(JobState.PENDING);
    expect(retry1.last_error).toBe('Failure 1');
    const delay1 = new Date(retry1.next_attempt_at).getTime() - now;
    expect(Math.round(delay1 / 1000)).toBe(2);

    // Verify queue picker honors backoff: picking immediately returns null because next_attempt_at is in the future
    const pickedTooEarly = await queueManager.pickNextJob('worker-X');
    expect(pickedTooEarly).toBeNull();

    // Simulate time passing by updating next_attempt_at to past/now
    await repository.updateJobState(job.id, JobState.PENDING, {
      next_attempt_at: new Date(Date.now() - 100).toISOString(),
    });

    // Worker picks job for retry #1
    const pickedForRetry1 = await queueManager.pickNextJob('worker-X');
    expect(pickedForRetry1.id).toBe(job.id);
    expect(pickedForRetry1.state).toBe(JobState.PROCESSING);

    // 2nd failure -> attempts = 2, formula: 2^2 = 4 seconds delay
    const retry2 = await retryManager.handleFailure(job.id, 'Failure 2');
    expect(retry2.attempts).toBe(2);
    expect(retry2.state).toBe(JobState.PENDING);
    const delay2 = new Date(retry2.next_attempt_at).getTime() - Date.now();
    expect(Math.round(delay2 / 1000)).toBe(4);

    // Simulate time passing for retry #2
    await repository.updateJobState(job.id, JobState.PENDING, {
      next_attempt_at: new Date(Date.now() - 100).toISOString(),
    });

    // Worker picks job for retry #2
    const pickedForRetry2 = await queueManager.pickNextJob('worker-X');
    expect(pickedForRetry2.id).toBe(job.id);

    // 3rd failure -> attempts = 3 >= max_retries (3). Should transition to DEAD!
    // Note: if formula was calculated before checking dead, 2^3 = 8s, but since attempts >= max_retries it moves directly to DEAD
    const deadJob = await retryManager.handleFailure(job.id, 'Failure 3 - fatal');
    expect(deadJob.attempts).toBe(3);
    expect(deadJob.state).toBe(JobState.DEAD);
    expect(deadJob.next_attempt_at).toBeNull();
    expect(deadJob.last_error).toBe('Failure 3 - fatal');

    // Confirm job is dead in DB and cannot be picked
    const finalDeadList = await repository.listJobsByState(JobState.DEAD);
    expect(finalDeadList.length).toBe(1);
    expect(await queueManager.pickNextJob('worker-X')).toBeNull();
  });
});
