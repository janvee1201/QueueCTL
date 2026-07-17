const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const queueManager = require('../queue/queueManager');
const { WorkerManager } = require('../worker/workerManager');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Worker & WorkerManager', () => {
  let workerManager;

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
    workerManager = new WorkerManager();
    const db = await getDb();
    await db.run('DELETE FROM Jobs');
    await db.run('DELETE FROM Workers');
  });

  afterEach(async () => {
    await workerManager.stopWorkers();
    jest.restoreAllMocks();
  });

  test('insert 10 jobs, start 3 workers, confirm every job runs exactly once with no duplicates', async () => {
    jest.spyOn(require('../worker/executor'), 'executeCommand').mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'mocked job output',
      stderr: '',
      error: null,
    });

    // Insert 10 jobs using a fast command
    for (let i = 1; i <= 10; i++) {
      await queueManager.addJob({ command: `node -e "console.log('job ${i}')"` });
    }

    let pending = await repository.listJobsByState(JobState.PENDING);
    expect(pending.length).toBe(10);

    // Start 3 workers
    await workerManager.startWorkers(3, { pollInterval: 10, idPrefix: 'test-worker' });

    // Confirm workers are registered
    const activeWorkers = await repository.listWorkers();
    expect(activeWorkers.length).toBe(3);

    // Wait until all 10 jobs are completed (timeout after 10 seconds)
    const startTime = Date.now();
    let completed = [];
    while (Date.now() - startTime < 10000) {
      completed = await repository.listJobsByState(JobState.COMPLETED);
      if (completed.length === 10) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Stop workers cleanly
    await workerManager.stopWorkers();

    // Verify exactly 10 completed jobs
    expect(completed.length).toBe(10);

    // Verify 0 remaining in pending or processing
    expect((await repository.listJobsByState(JobState.PENDING)).length).toBe(0);
    expect((await repository.listJobsByState(JobState.PROCESSING)).length).toBe(0);

    // Confirm every job ran exactly once without failures/retries (attempts === 0 for all)
    for (const job of completed) {
      expect(job.attempts).toBe(0);
    }

    // Confirm workers were deregistered after stopping
    const remainingWorkers = await repository.listWorkers();
    expect(remainingWorkers.length).toBe(0);
  }, 15000);

  test('graceful stop waits for running job to complete before exiting', async () => {
    // Insert a job that takes 500ms to finish
    await queueManager.addJob({
      command: 'node -e "setTimeout(() => console.log(\'finished\'), 500)"',
    });

    // Start 1 worker
    await workerManager.startWorkers(1, { pollInterval: 50 });

    // Wait 150ms so worker picks up job and begins processing
    await new Promise((resolve) => setTimeout(resolve, 150));
    const processing = await repository.listJobsByState(JobState.PROCESSING);
    expect(processing.length).toBe(1);

    // Trigger stop mid-execution; worker should wait until the 500ms job completes
    const stopPromise = workerManager.stopWorkers();

    // Check right after requesting stop, job should still be processing or finishing
    await stopPromise;

    // By the time stopWorkers resolves, the job must be marked completed
    const completed = await repository.listJobsByState(JobState.COMPLETED);
    expect(completed.length).toBe(1);
    expect(completed[0].attempts).toBe(0);
  }, 10000);
});
