const repository = require('../storage/repository');
const { Job, JobState } = require('../models/Job');
const { retryManager } = require('./retryManager');
const { configService } = require('../services/configService');
const logger = require('../utils/logger');
const lock = require('../utils/lock');

/**
 * Validates job data via Job model, sets state to pending, and inserts into storage.
 * @param {Object} jobData
 * @returns {Promise<Job>}
 */
async function addJob(jobData) {
  const inputData = { ...jobData };
  if (inputData.max_retries === undefined || inputData.max_retries === null) {
    inputData.max_retries = await configService.getConfig('max_retries');
  }
  if (inputData.backoff_base === undefined || inputData.backoff_base === null) {
    inputData.backoff_base = await configService.getConfig('backoff_base');
  }

  const validatedJob = Job.create(inputData);
  validatedJob.state = JobState.PENDING;
  const savedJob = await repository.insertJob(validatedJob);
  logger.info(`Job [${savedJob.id}] enqueued (command: "${savedJob.command}")`, { jobId: savedJob.id });
  return Job.validate(savedJob);
}

/**
 * Atomically selects one pending job, marks it processing, and stamps locked_by/locked_at.
 * @param {string} workerId
 * @returns {Promise<Job|null>}
 */
async function pickNextJob(workerId) {
  const jobRow = await lock.acquireLock(workerId);
  if (!jobRow) return null;
  logger.info(`Job [${jobRow.id}] picked up by worker ${workerId}`, { jobId: jobRow.id });
  return Job.validate(jobRow);
}

/**
 * Updates job state to completed, updates updated_at, and clears locks.
 * @param {string} jobId
 * @returns {Promise<Job|null>}
 */
async function markCompleted(jobId) {
  const updatedJob = await repository.updateJobState(jobId, JobState.COMPLETED, {
    locked_by: null,
    locked_at: null,
  });
  if (!updatedJob) return null;
  logger.info(`Job [${jobId}] completed successfully`, { jobId });
  return Job.validate(updatedJob);
}

/**
 * Increments attempts, stores last_error, and decides next state (failed for retry vs dead).
 * @param {string} jobId
 * @param {string} errorMessage
 * @returns {Promise<Job|null>}
 */
async function markFailed(jobId, errorMessage) {
  return await retryManager.handleFailure(jobId, errorMessage);
}

/**
 * Releases the lock on a processing job, resetting its state back to pending for graceful shutdown.
 * @param {string} jobId
 * @returns {Promise<Job|null>}
 */
async function releaseLock(jobId) {
  return await lock.releaseLock(jobId);
}

/**
 * Prunes completed jobs older than the given threshold (in milliseconds).
 * @param {number|null} olderThanMs
 * @returns {Promise<number>} Number of jobs removed
 */
async function removeOrArchiveCompleted(olderThanMs = null) {
  const completedJobs = await repository.listJobsByState(JobState.COMPLETED);
  const now = Date.now();
  let removedCount = 0;

  for (const job of completedJobs) {
    if (!olderThanMs || now - new Date(job.updated_at).getTime() >= olderThanMs) {
      await repository.deleteJob(job.id);
      removedCount++;
    }
  }
  return removedCount;
}

/**
 * Closes underlying storage connection.
 * @returns {Promise<void>}
 */
async function close() {
  await repository.close();
}

module.exports = {
  addJob,
  pickNextJob,
  markCompleted,
  markFailed,
  releaseLock,
  removeOrArchiveCompleted,
  close,
};
