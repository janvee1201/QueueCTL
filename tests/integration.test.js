const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const queueManager = require('../queue/queueManager');
const { workerManager } = require('../worker/workerManager');
const { dlqService } = require('../services/dlqService');
const { executeCommand } = require('../worker/executor');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Official Integration Scenarios (Module 13)', () => {
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
    const db = await getDb();
    await db.run('DELETE FROM Jobs');
    await db.run('DELETE FROM Workers');
  });

  afterEach(async () => {
    await workerManager.stopWorkers();
    jest.restoreAllMocks();
  });

  test('Scenario 1: Successful Job execution and state transitions', async () => {
    // Enqueue job
    const job = await queueManager.addJob({ command: 'echo success' });
    expect(job.state).toBe(JobState.PENDING);

    // Worker picks up job
    const processingJob = await queueManager.pickNextJob('worker-S1');
    expect(processingJob.id).toBe(job.id);
    expect(processingJob.state).toBe(JobState.PROCESSING);
    expect(processingJob.locked_by).toBe('worker-S1');

    // Executor runs command
    const result = await executeCommand(processingJob.command);
    expect(result.success).toBe(true);

    // Mark completed
    const completedJob = await queueManager.markCompleted(processingJob.id);
    expect(completedJob.state).toBe(JobState.COMPLETED);
    expect(completedJob.locked_by).toBeNull();
  });

  test('Scenario 2: Failed Job with Retries exhausting into Dead Letter Queue (DLQ)', async () => {
    // Enqueue job with max_retries = 3, backoff_base = 1 (1 second delay per attempt)
    const job = await queueManager.addJob({
      command: 'nonexistent-cmd-for-dlq',
      max_retries: 3,
      backoff_base: 1,
    });

    // Attempt 1 fails -> should transition to PENDING with attempts = 1
    const jobA1 = await queueManager.pickNextJob('worker-S2');
    const fail1 = await queueManager.markFailed(jobA1.id, 'Error attempt 1');
    expect(fail1.state).toBe(JobState.PENDING);
    expect(fail1.attempts).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Attempt 2 fails -> should transition to PENDING with attempts = 2
    const jobA2 = await queueManager.pickNextJob('worker-S2');
    const fail2 = await queueManager.markFailed(jobA2.id, 'Error attempt 2');
    expect(fail2.state).toBe(JobState.PENDING);
    expect(fail2.attempts).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Attempt 3 fails (attempts >= max_retries) -> transitions to DEAD (DLQ)
    const jobA3 = await queueManager.pickNextJob('worker-S2');
    const fail3 = await queueManager.markFailed(jobA3.id, 'Fatal error attempt 3');
    expect(fail3.state).toBe(JobState.DEAD);
    expect(fail3.attempts).toBe(3); // Attempt count when entering dead state
    expect(fail3.last_error).toContain('Fatal error attempt 3');
  }, 15000);

  test('Scenario 3: Parallel Workers running concurrent jobs with zero duplication', async () => {
    jest.spyOn(require('../worker/executor'), 'executeCommand').mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'mocked output',
      stderr: '',
      error: null,
    });

    const totalJobs = 15;
    for (let i = 1; i <= totalJobs; i++) {
      await queueManager.addJob({ command: `node -e "console.log(${i})"` });
    }

    // Start 3 concurrent workers
    await workerManager.startWorkers(3, { pollInterval: 10, idPrefix: 'parallel-w' });

    // Wait until all jobs complete (timeout after 10 seconds)
    const startTime = Date.now();
    let completed = [];
    while (Date.now() - startTime < 10000) {
      completed = await repository.listJobsByState(JobState.COMPLETED);
      if (completed.length === totalJobs) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    await workerManager.stopWorkers();

    expect(completed.length).toBe(totalJobs);

    // Confirm every single job ran exactly once (attempts = 0, no job failed or ran duplicate times)
    const db = await getDb();
    const sumAttempts = await db.get('SELECT SUM(attempts) as total_attempts FROM Jobs');
    expect(sumAttempts.total_attempts).toBe(0);
  }, 15000);

  test('Scenario 4: Persistence across database connection closure and process restart simulation', async () => {
    const job1 = await queueManager.addJob({ command: 'echo persist-1' });
    const job2 = await queueManager.addJob({ command: 'echo persist-2' });

    // Complete job1, leave job2 pending
    const picked = await queueManager.pickNextJob('worker-restart');
    await queueManager.markCompleted(picked.id);

    // Simulate process shutdown by closing DB connection
    await closeDb();

    // Simulate process startup by reopening DB connection
    await initDb();

    const freshJob1 = await repository.getJobById(job1.id);
    const freshJob2 = await repository.getJobById(job2.id);

    expect(freshJob1.state).toBe(JobState.COMPLETED);
    expect(freshJob1.command).toBe('echo persist-1');
    expect(freshJob2.state).toBe(JobState.PENDING);
    expect(freshJob2.command).toBe('echo persist-2');
  });

  test('Scenario 5: DLQ Recovery resetting a dead job back to pending and running to completion', async () => {
    // Force a job into DEAD state directly
    const deadJob = await repository.insertJob({
      command: 'bad-cmd',
      state: JobState.DEAD,
      attempts: 3,
      max_retries: 3,
      last_error: 'Exhausted retries',
    });

    // Recover job via DLQ service
    const recoveredJob = await dlqService.retryDeadJob(deadJob.id, 'node -e "console.log(\'recovered\')"');
    expect(recoveredJob.state).toBe(JobState.PENDING);
    expect(recoveredJob.attempts).toBe(0);
    expect(recoveredJob.last_error).toBeNull();
    expect(recoveredJob.command).toBe('node -e "console.log(\'recovered\')"');

    // Process the recovered job cleanly
    const picked = await queueManager.pickNextJob('worker-recovery');
    expect(picked.id).toBe(deadJob.id);

    const result = await executeCommand(picked.command);
    expect(result.success).toBe(true);

    const finished = await queueManager.markCompleted(picked.id);
    expect(finished.state).toBe(JobState.COMPLETED);
  });
});
