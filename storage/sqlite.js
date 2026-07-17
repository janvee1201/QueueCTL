const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', 'database', 'queue.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance = null;

async function initDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  const origRun = dbInstance.run.bind(dbInstance);
  const origGet = dbInstance.get.bind(dbInstance);
  const origAll = dbInstance.all.bind(dbInstance);
  const origExec = dbInstance.exec.bind(dbInstance);

  const withRetry = (fn) => async (...args) => {
    let attempts = 0;
    const maxRetries = 150;
    while (true) {
      try {
        return await fn(...args);
      } catch (err) {
        if (
          attempts < maxRetries &&
          (err.code === 'SQLITE_BUSY' ||
            err.code === 'SQLITE_LOCKED' ||
            (err.message && err.message.includes('SQLITE_BUSY')) ||
            (err.message && err.message.includes('SQLITE_LOCKED')) ||
            (err.message && err.message.includes('database is locked')) ||
            (err.message && err.message.includes('database table is locked')))
        ) {
          attempts++;
          const delay = Math.floor(Math.random() * 15) + 5 * Math.min(attempts, 20);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
  };

  dbInstance.run = withRetry(origRun);
  dbInstance.get = withRetry(origGet);
  dbInstance.all = withRetry(origAll);
  dbInstance.exec = withRetry(origExec);

  // Enable WAL mode and busy timeout for better concurrency
  await dbInstance.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS Jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      backoff_base INTEGER DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT,
      locked_by TEXT,
      locked_at TEXT,
      next_attempt_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state ON Jobs(state);
    CREATE INDEX IF NOT EXISTS idx_jobs_id ON Jobs(id);
  `);

  try {
    await dbInstance.exec('ALTER TABLE Jobs ADD COLUMN next_attempt_at TEXT;');
  } catch (e) {
    // Column already exists
  }

  await dbInstance.exec(`

    CREATE TABLE IF NOT EXISTS Config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Workers (
      id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      heartbeat_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  // Insert default configs if they don't exist
  await dbInstance.run(
    'INSERT OR IGNORE INTO Config (key, value) VALUES (?, ?)',
    ['max_retries', '3']
  );
  await dbInstance.run(
    'INSERT OR IGNORE INTO Config (key, value) VALUES (?, ?)',
    ['backoff_base', '1000']
  );

  return dbInstance;
}

async function getDb() {
  if (!dbInstance) {
    return await initDb();
  }
  return dbInstance;
}

async function closeDb() {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb
};
