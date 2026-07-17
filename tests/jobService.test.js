const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const { jobService } = require('../services/jobService');
const { statusCommand } = require('../cli/status');
const { listCommand } = require('../cli/list');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('Status & Job Service (Module 9)', () => {
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

  test('run status and manually cross-check counts against a direct database query', async () => {
    // 1. Insert jobs with distinct states into the database
    await repository.insertJob({ command: 'pending-1', state: JobState.PENDING });
    await repository.insertJob({ command: 'pending-2', state: JobState.PENDING });
    await repository.insertJob({ command: 'proc-1', state: JobState.PROCESSING });
    await repository.insertJob({ command: 'comp-1', state: JobState.COMPLETED });
    await repository.insertJob({ command: 'comp-2', state: JobState.COMPLETED });
    await repository.insertJob({ command: 'comp-3', state: JobState.COMPLETED });
    await repository.insertJob({ command: 'fail-1', state: JobState.FAILED });
    await repository.insertJob({ command: 'dead-1', state: JobState.DEAD });
    await repository.insertJob({ command: 'dead-2', state: JobState.DEAD });

    // 2. Register 2 active workers
    await repository.registerWorker('worker-a', 101, 'idle');
    await repository.registerWorker('worker-b', 102, 'busy');

    // 3. Run status command and service
    const status = await statusCommand({ keepDbOpen: true, silent: true });

    // 4. Perform direct database query to cross-check
    const db = await getDb();
    const rawCounts = await db.all('SELECT state, COUNT(*) as count FROM Jobs GROUP BY state');
    const rawMap = {};
    for (const row of rawCounts) {
      rawMap[row.state] = row.count;
    }
    const rawWorkerCount = (await db.all('SELECT id FROM Workers')).length;

    // 5. Cross-check counts
    expect(status.counts.pending).toBe(rawMap[JobState.PENDING] || 0);
    expect(status.counts.pending).toBe(2);

    expect(status.counts.processing).toBe(rawMap[JobState.PROCESSING] || 0);
    expect(status.counts.processing).toBe(1);

    expect(status.counts.completed).toBe(rawMap[JobState.COMPLETED] || 0);
    expect(status.counts.completed).toBe(3);

    expect(status.counts.failed).toBe(rawMap[JobState.FAILED] || 0);
    expect(status.counts.failed).toBe(1);

    expect(status.counts.dead).toBe(rawMap[JobState.DEAD] || 0);
    expect(status.counts.dead).toBe(2);

    expect(status.activeWorkers).toBe(rawWorkerCount);
    expect(status.activeWorkers).toBe(2);

    const stripAnsi = (str) => str.replace(/\x1B\[\d+m/g, '');
    const cleanFormatted = stripAnsi(status.formatted);

    expect(cleanFormatted).toContain('Pending: 2');
    expect(cleanFormatted).toContain('Running: 1');
    expect(cleanFormatted).toContain('Completed: 3');
    expect(cleanFormatted).toContain('Failed: 1');
    expect(cleanFormatted).toContain('Dead: 2');
    expect(cleanFormatted).toContain('Active Workers: 2');
  });

  test('list --state <state> shows individual job rows filtered by state', async () => {
    await repository.insertJob({ command: 'p-task', state: JobState.PENDING });
    await repository.insertJob({ command: 'c-task', state: JobState.COMPLETED });
    await repository.insertJob({ command: 'd-task', state: JobState.DEAD });

    const pendingList = await listCommand({ state: 'pending', keepDbOpen: true, silent: true });
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].command).toBe('p-task');

    const completedList = await listCommand({ state: 'completed', keepDbOpen: true, silent: true });
    expect(completedList.length).toBe(1);
    expect(completedList[0].command).toBe('c-task');

    const allList = await listCommand({ keepDbOpen: true, silent: true });
    expect(allList.length).toBe(3);
  });
});
