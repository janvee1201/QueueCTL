const { initDb, closeDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const { JobState } = require('../models/Job');
const {
  addJob,
  pickNextJob,
  markCompleted,
  markFailed,
  releaseLock,
  removeOrArchiveCompleted,
} = require('../queue/queueManager');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Queue Manager', () => {
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

  test('insert 5 jobs, confirm all pending; pick jobs and complete them', async () => {
    // Insert 5 jobs
    const jobs = [];
    for (let i = 1; i <= 5; i++) {
      const job = await addJob({ command: `task-${i}` });
      jobs.push(job);
    }

    // Confirm 5 jobs in pending state
    let pendingJobs = await repository.listJobsByState(JobState.PENDING);
    expect(pendingJobs.length).toBe(5);

    // Worker picks first job
    const pickedJob1 = await pickNextJob('worker-A');
    expect(pickedJob1).toBeDefined();
    expect(pickedJob1.state).toBe(JobState.PROCESSING);
    expect(pickedJob1.locked_by).toBe('worker-A');

    // Confirm pending count decreased by 1
    pendingJobs = await repository.listJobsByState(JobState.PENDING);
    expect(pendingJobs.length).toBe(4);

    // Complete the picked job
    const completedJob1 = await markCompleted(pickedJob1.id);
    expect(completedJob1.state).toBe(JobState.COMPLETED);
    expect(completedJob1.locked_by).toBeNull();

    // Confirm completed count increased
    const completedJobs = await repository.listJobsByState(JobState.COMPLETED);
    expect(completedJobs.length).toBe(1);
  });

  test('markFailed transitions to FAILED if attempts < max_retries and to DEAD when attempts >= max_retries', async () => {
    const job = await addJob({ command: 'failing-task', max_retries: 2 });
    
    // Pick job (attempts is 0)
    const picked1 = await pickNextJob('worker-B');
    expect(picked1.id).toBe(job.id);

    // Fail attempt 1 (attempts becomes 1 < 2) -> PENDING state with future backoff timestamp
    const failed1 = await markFailed(picked1.id, 'Connection timeout');
    expect(failed1.attempts).toBe(1);
    expect(failed1.state).toBe(JobState.PENDING);
    expect(failed1.last_error).toBe('Connection timeout');

    // Manually expire next_attempt_at timestamp (simulating time elapsed/scheduler) and pick again
    await repository.updateJobState(failed1.id, JobState.PENDING, {
      next_attempt_at: new Date(Date.now() - 100).toISOString(),
    });
    const picked2 = await pickNextJob('worker-B');

    // Fail attempt 2 (attempts becomes 2 >= 2) -> DEAD state
    const failed2 = await markFailed(picked2.id, 'Fatal error');
    expect(failed2.attempts).toBe(2);
    expect(failed2.state).toBe(JobState.DEAD);
    expect(failed2.last_error).toBe('Fatal error');
  });

  test('releaseLock resets processing job back to pending and clears lock', async () => {
    const job = await addJob({ command: 'long-running-task' });
    const picked = await pickNextJob('worker-C');
    expect(picked.state).toBe(JobState.PROCESSING);
    expect(picked.locked_by).toBe('worker-C');

    const released = await releaseLock(picked.id);
    expect(released.state).toBe(JobState.PENDING);
    expect(released.locked_by).toBeNull();
    expect(released.locked_at).toBeNull();

    // Can be picked again
    const repicked = await pickNextJob('worker-D');
    expect(repicked.locked_by).toBe('worker-D');
  });

  test('removeOrArchiveCompleted deletes only completed jobs according to age threshold', async () => {
    const job1 = await addJob({ command: 'completed-1' });
    const picked1 = await pickNextJob('worker-E');
    await markCompleted(picked1.id);

    const job2 = await addJob({ command: 'completed-2' });
    const picked2 = await pickNextJob('worker-E');
    await markCompleted(picked2.id);

    // Remove all completed jobs without age restriction
    const removedCount = await removeOrArchiveCompleted(null);
    expect(removedCount).toBe(2);

    const remainingCompleted = await repository.listJobsByState(JobState.COMPLETED);
    expect(remainingCompleted.length).toBe(0);
  });
});
