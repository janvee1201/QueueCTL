const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const lock = require('../utils/lock');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Locking Utility (Module 12)', () => {
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

  test('acquireLock atomically selects and locks the oldest pending job', async () => {
    const job1 = await repository.insertJob({ command: 'echo first', state: JobState.PENDING });
    await new Promise((r) => setTimeout(r, 10));
    const job2 = await repository.insertJob({ command: 'echo second', state: JobState.PENDING });

    const locked = await lock.acquireLock('worker-A');
    expect(locked).toBeDefined();
    expect(locked.id).toBe(job1.id);
    expect(locked.state).toBe(JobState.PROCESSING);
    expect(locked.locked_by).toBe('worker-A');
    expect(locked.locked_at).toBeDefined();

    const secondLocked = await lock.acquireLock('worker-B');
    expect(secondLocked.id).toBe(job2.id);
    expect(secondLocked.locked_by).toBe('worker-B');

    const thirdLocked = await lock.acquireLock('worker-C');
    expect(thirdLocked).toBeNull();
  });

  test('releaseLock resets processing job back to pending and clears lock fields', async () => {
    const job = await repository.insertJob({ command: 'echo test', state: JobState.PENDING });
    const locked = await lock.acquireLock('worker-X');
    expect(locked.state).toBe(JobState.PROCESSING);

    const released = await lock.releaseLock(job.id);
    expect(released.state).toBe(JobState.PENDING);
    expect(released.locked_by).toBeNull();
    expect(released.locked_at).toBeNull();
  });

  test('reclaimStaleLocks reclaims jobs stuck in processing beyond timeout', async () => {
    // Create a job simulated as locked 10 seconds ago
    const staleTimeISO = new Date(Date.now() - 10000).toISOString();
    const staleJob = await repository.insertJob({
      command: 'echo stuck',
      state: JobState.PROCESSING,
      locked_by: 'crashed-worker',
      locked_at: staleTimeISO,
    });

    // Create a job locked just 1 second ago (not stale if threshold is 5s)
    const recentTimeISO = new Date(Date.now() - 1000).toISOString();
    const recentJob = await repository.insertJob({
      command: 'echo active',
      state: JobState.PROCESSING,
      locked_by: 'active-worker',
      locked_at: recentTimeISO,
    });

    const reclaimed = await lock.reclaimStaleLocks(5000); // 5s threshold
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0].id).toBe(staleJob.id);
    expect(reclaimed[0].state).toBe(JobState.PENDING);
    expect(reclaimed[0].locked_by).toBeNull();

    // Check recent job remains untouched
    const checkRecent = await repository.getJobById(recentJob.id);
    expect(checkRecent.state).toBe(JobState.PROCESSING);
    expect(checkRecent.locked_by).toBe('active-worker');
  });

  test('acquireLock automatically triggers stale lock recovery before locking', async () => {
    const staleTimeISO = new Date(Date.now() - 20000).toISOString();
    await repository.insertJob({
      command: 'echo auto-recover',
      state: JobState.PROCESSING,
      locked_by: 'dead-worker',
      locked_at: staleTimeISO,
    });

    // Calling acquireLock with lockTimeoutMs=5000 should first reclaim the stale job, then lock and return it
    const acquired = await lock.acquireLock('new-worker', { lockTimeoutMs: 5000 });
    expect(acquired).toBeDefined();
    expect(acquired.command).toBe('echo auto-recover');
    expect(acquired.state).toBe(JobState.PROCESSING);
    expect(acquired.locked_by).toBe('new-worker');
  });
});
