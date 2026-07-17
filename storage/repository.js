const { getDb } = require('./sqlite');
const crypto = require('crypto');

const getNow = () => new Date().toISOString();

async function insertJob(jobInput) {
  const db = await getDb();
  const id = jobInput.id || crypto.randomUUID();
  const now = getNow();
  const command = jobInput.command;
  const state = jobInput.state || 'pending';
  const attempts = jobInput.attempts !== undefined ? jobInput.attempts : 0;
  const max_retries = jobInput.max_retries !== undefined ? jobInput.max_retries : 3;
  const backoff_base = jobInput.backoff_base !== undefined ? jobInput.backoff_base : 1000;
  const created_at = jobInput.created_at || now;
  const updated_at = jobInput.updated_at || now;
  const last_error = jobInput.last_error || null;
  const locked_by = jobInput.locked_by || null;
  const locked_at = jobInput.locked_at || null;
  const next_attempt_at = jobInput.next_attempt_at || null;
  
  await db.run(
    `INSERT INTO Jobs (id, command, state, attempts, max_retries, backoff_base, created_at, updated_at, last_error, locked_by, locked_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, command, state, attempts, max_retries, backoff_base, created_at, updated_at, last_error, locked_by, locked_at, next_attempt_at]
  );
  
  return await getJobById(id);
}

async function getJobById(id) {
  const db = await getDb();
  return await db.get('SELECT * FROM Jobs WHERE id = ?', [id]);
}

async function updateJobState(id, state, extras = {}) {
  const db = await getDb();
  const now = getNow();
  
  const fields = ['state = ?', 'updated_at = ?'];
  const params = [state, now];
  
  if (extras.last_error !== undefined) {
    fields.push('last_error = ?');
    params.push(extras.last_error);
  }
  if (extras.locked_by !== undefined) {
    fields.push('locked_by = ?');
    params.push(extras.locked_by);
  }
  if (extras.locked_at !== undefined) {
    fields.push('locked_at = ?');
    params.push(extras.locked_at);
  }
  if (extras.next_attempt_at !== undefined) {
    fields.push('next_attempt_at = ?');
    params.push(extras.next_attempt_at);
  }
  if (extras.attempts !== undefined) {
    fields.push('attempts = ?');
    params.push(extras.attempts);
  }
  if (extras.command !== undefined) {
    fields.push('command = ?');
    params.push(extras.command);
  }
  
  params.push(id);
  
  const query = `UPDATE Jobs SET ${fields.join(', ')} WHERE id = ?`;
  await db.run(query, params);
  
  return await getJobById(id);
}

async function incrementAttempts(id) {
  const db = await getDb();
  await db.run(
    'UPDATE Jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?',
    [getNow(), id]
  );
  return await getJobById(id);
}

async function deleteJob(id) {
  const db = await getDb();
  await db.run('DELETE FROM Jobs WHERE id = ?', [id]);
}

async function listJobsByState(state) {
  const db = await getDb();
  return await db.all('SELECT * FROM Jobs WHERE state = ? ORDER BY created_at ASC', [state]);
}

async function getNextPendingJob(workerId) {
  const db = await getDb();
  const now = getNow();
  
  // Use RETURNING to make this an atomic operation, checking both state and next_attempt_at eligibility.
  const row = await db.get(`
    UPDATE Jobs 
    SET state = 'processing', locked_by = ?, locked_at = ?, updated_at = ? 
    WHERE id = (
      SELECT id FROM Jobs WHERE state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT 1
    )
    RETURNING *
  `, [workerId, now, now, now]);
  
  return row || null;
}

async function registerWorker(id, pid, status = 'idle') {
  const db = await getDb();
  const now = getNow();
  await db.run(
    'INSERT OR REPLACE INTO Workers (id, pid, heartbeat_at, status) VALUES (?, ?, ?, ?)',
    [id, pid, now, status]
  );
}

async function updateWorkerStatus(id, status) {
  const db = await getDb();
  const now = getNow();
  await db.run(
    'UPDATE Workers SET heartbeat_at = ?, status = ? WHERE id = ?',
    [now, status, id]
  );
}

async function removeWorker(id) {
  const db = await getDb();
  await db.run('DELETE FROM Workers WHERE id = ?', [id]);
}

async function listWorkers() {
  const db = await getDb();
  return await db.all('SELECT * FROM Workers');
}

async function getConfig(key) {
  const db = await getDb();
  const row = await db.get('SELECT value FROM Config WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setConfig(key, value) {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO Config (key, value) VALUES (?, ?)', [key, String(value)]);
}

async function listConfig() {
  const db = await getDb();
  return await db.all('SELECT * FROM Config');
}

async function getJobCountsByState() {
  const db = await getDb();
  return await db.all('SELECT state, COUNT(*) as count FROM Jobs GROUP BY state');
}

async function listAllJobs() {
  const db = await getDb();
  return await db.all('SELECT * FROM Jobs ORDER BY created_at ASC');
}

async function close() {
  const { closeDb } = require('./sqlite');
  await closeDb();
}

async function clearAll() {
  const db = await getDb();
  await db.run('DELETE FROM Jobs');
  await db.run('DELETE FROM Workers');
}

module.exports = {
  insertJob,
  getJobById,
  updateJobState,
  incrementAttempts,
  deleteJob,
  listJobsByState,
  getNextPendingJob,
  registerWorker,
  updateWorkerStatus,
  removeWorker,
  listWorkers,
  getConfig,
  setConfig,
  listConfig,
  getJobCountsByState,
  listAllJobs,
  clearAll,
  close
};
