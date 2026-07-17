const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const queueManager = require('../queue/queueManager');
const { dlqService } = require('../services/dlqService');
const { WorkerManager } = require('../worker/workerManager');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('DLQ Service', () => {
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
    await repository.clearAll();
  });

  afterEach(async () => {
    if (workerManager) {
      await workerManager.stopWorkers();
    }
  });

  test('exhaust retries into dead, confirm in dlq list, retry via dlq retry, and confirm completion', async () => {
    // 1. Enqueue a job with max_retries = 1 that fails initially
    const job = await queueManager.addJob({
      command: 'non-existent-bad-command-12345',
      max_retries: 1,
      backoff_base: 1,
    });

    // 2. Worker picks up job for initial attempt
    const picked1 = await queueManager.pickNextJob('worker-1');
    expect(picked1.id).toBe(job.id);

    // Fail attempt 1 -> attempts becomes 1 >= max_retries (1) -> state transitions to DEAD
    const deadJob = await queueManager.markFailed(picked1.id, 'Command not found');
    expect(deadJob.state).toBe(JobState.DEAD);
    expect(deadJob.attempts).toBe(1);

    // 3. Confirm job appears in dlq list
    const deadList = await dlqService.listDeadJobs();
    expect(deadList.length).toBe(1);
    expect(deadList[0].id).toBe(job.id);

    // 4. Run dlq retry, updating the command to a valid command so it will succeed when picked
    const retriedJob = await dlqService.retryDeadJob(job.id, 'node -e "console.log(\'fixed and working\')"');
    expect(retriedJob.state).toBe(JobState.PENDING);
    expect(retriedJob.attempts).toBe(0);
    expect(retriedJob.last_error).toBeNull();
    expect(retriedJob.next_attempt_at).toBeNull();

    // Confirm DLQ list is now empty
    const newDeadList = await dlqService.listDeadJobs();
    expect(newDeadList.length).toBe(0);

    // 5. Start worker and confirm the retried job gets picked up and completes successfully
    await workerManager.startWorkers(1, { pollInterval: 50 });

    const startTime = Date.now();
    let completedJobs = [];
    while (Date.now() - startTime < 5000) {
      completedJobs = await repository.listJobsByState(JobState.COMPLETED);
      if (completedJobs.length === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(completedJobs.length).toBe(1);
    expect(completedJobs[0].id).toBe(job.id);
    expect(completedJobs[0].state).toBe(JobState.COMPLETED);
    expect(completedJobs[0].attempts).toBe(0); // Completed successfully on first try after reset
  });
});
