const { initDb, closeDb, getDb } = require('../storage/sqlite');
const repository = require('../storage/repository');
const { enqueueCommand } = require('../cli/enqueue');
const { statusCommand } = require('../cli/status');
const { listCommand } = require('../cli/list');
const { listDlqCommand, retryDlqCommand } = require('../cli/dlq');
const { setConfigCommand, getConfigCommand } = require('../cli/config');
const { program } = require('../index');
const { JobState } = require('../models/Job');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');

describe('CLI Layer & Subcommands (Module 10)', () => {
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

  test('Commander program registers all required subcommands', () => {
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('enqueue');
    expect(commandNames).toContain('worker');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('list');
    expect(commandNames).toContain('dlq');
    expect(commandNames).toContain('config');
  });

  test('enqueueCommand adds jobs via JSON string and via individual flags', async () => {
    const job1 = await enqueueCommand('{"command": "echo json-cmd", "max_retries": 4}', {
      keepDbOpen: true,
      silent: true,
    });
    expect(job1.command).toBe('echo json-cmd');
    expect(job1.max_retries).toBe(4);
    expect(job1.state).toBe(JobState.PENDING);

    const job2 = await enqueueCommand(null, {
      command: 'echo flag-cmd',
      maxRetries: 2,
      keepDbOpen: true,
      silent: true,
    });
    expect(job2.command).toBe('echo flag-cmd');
    expect(job2.max_retries).toBe(2);
  });

  test('statusCommand and listCommand return accurate summaries without direct storage calls', async () => {
    await enqueueCommand(null, { command: 'job-a', keepDbOpen: true, silent: true });
    await enqueueCommand(null, { command: 'job-b', keepDbOpen: true, silent: true });

    const status = await statusCommand({ keepDbOpen: true, silent: true });
    expect(status.counts.pending).toBe(2);

    const pendingList = await listCommand({ state: 'pending', keepDbOpen: true, silent: true });
    expect(pendingList.length).toBe(2);
  });

  test('configCommand handles set, get, and show commands', async () => {
    await setConfigCommand('max-retries', 9, { keepDbOpen: true, silent: true });
    const val = await getConfigCommand('max-retries', { keepDbOpen: true, silent: true });
    expect(val).toBe(9);

    const all = await getConfigCommand('show', { keepDbOpen: true, silent: true, showAll: true });
    expect(all.max_retries).toBe(9);
  });

  test('dlqCommand handles list and retry subcommands', async () => {
    const deadRow = await repository.insertJob({
      command: 'failing-forever',
      state: JobState.DEAD,
      attempts: 3,
      max_retries: 3,
    });

    const deadList = await listDlqCommand({ keepDbOpen: true, silent: true });
    expect(deadList.length).toBe(1);
    expect(deadList[0].id).toBe(deadRow.id);

    const retriedJob = await retryDlqCommand(deadRow.id, {
      command: 'echo fixed-command',
      keepDbOpen: true,
      silent: true,
    });
    expect(retriedJob.state).toBe(JobState.PENDING);
    expect(retriedJob.attempts).toBe(0);
    expect(retriedJob.command).toBe('echo fixed-command');

    const emptyDeadList = await listDlqCommand({ keepDbOpen: true, silent: true });
    expect(emptyDeadList.length).toBe(0);
  });
});
