const { initDb, closeDb } = require('../storage/sqlite');
const { insertJob, getJobById, getNextPendingJob, clearAll } = require('../storage/repository');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Storage Layer', () => {
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
    await clearAll();
  });

  test('insert a job and verify it exists', async () => {
    const job = await insertJob({ command: 'echo "hello"' });
    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.command).toBe('echo "hello"');
    expect(job.state).toBe('pending');

    const fetchedJob = await getJobById(job.id);
    expect(fetchedJob).toEqual(job);
  });

  test('getNextPendingJob is atomic and returns the job', async () => {
    await insertJob({ command: 'echo "pending"' });
    const job = await getNextPendingJob('worker-1');
    expect(job).toBeDefined();
    expect(job.state).toBe('processing');
    expect(job.locked_by).toBe('worker-1');
    expect(job.locked_at).toBeDefined();

    // Next call should return null since there are no more pending jobs
    const nextJob = await getNextPendingJob('worker-2');
    expect(nextJob).toBeNull();
  });
});
