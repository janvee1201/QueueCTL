const repository = require('../storage/repository');
const { Job, JobState } = require('../models/Job');
const logger = require('../utils/logger');
const { configService } = require('../services/configService');

class RetryManager {
  /**
   * Handles job failure, computing retry delays or transitioning to DLQ (dead state).
   * @param {string|Object} jobOrId - Job instance, ID string, or job row
   * @param {string} [errorMessage='Unknown error'] - Error description
   * @returns {Promise<Job|null>} Updated job instance
   */
  async handleFailure(jobOrId, errorMessage = 'Unknown error') {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;

    // 1. Increment attempts
    const incrementedRow = await repository.incrementAttempts(jobId);
    if (!incrementedRow) return null;

    const job = Job.validate(incrementedRow);

    const maxRetries = job.max_retries !== undefined && job.max_retries !== null
      ? job.max_retries
      : await configService.getConfig('max_retries');
    const backoffBase = job.backoff_base !== undefined && job.backoff_base !== null
      ? job.backoff_base
      : await configService.getConfig('backoff_base');

    // 2. Check if max_retries reached
    if (job.attempts >= maxRetries) {
      logger.error(
        `Job [${job.id}] exceeded max retries (${job.attempts}/${maxRetries}). Moving to DEAD state (DLQ). Error: ${errorMessage}`,
        { jobId: job.id }
      );

      const deadRow = await repository.updateJobState(job.id, JobState.DEAD, {
        last_error: errorMessage,
        locked_by: null,
        locked_at: null,
        next_attempt_at: null,
      });
      return Job.validate(deadRow);
    }

    // 3. Compute delay using formula: delay = base ^ attempts
    // If backoff_base < 100, assume specified in seconds (e.g. base=2 -> 2s, 4s, 8s).
    // Otherwise treat as milliseconds and convert to seconds for exponent calculation.
    const baseVal = backoffBase < 100 ? backoffBase : backoffBase / 1000;
    const delaySeconds = Math.pow(baseVal, job.attempts);
    const delayMs = delaySeconds * 1000;

    const nextAttemptDate = new Date(Date.now() + delayMs);
    const nextAttemptISO = nextAttemptDate.toISOString();

    logger.warn(
      `Job [${job.id}] failed attempt #${job.attempts}/${maxRetries}. Scheduling retry in ${delaySeconds}s (at ${nextAttemptISO}). Error: ${errorMessage}`,
      { jobId: job.id }
    );

    // 4. Update state back to PENDING and set next_attempt_at so picker honors backoff delay
    const updatedRow = await repository.updateJobState(job.id, JobState.PENDING, {
      last_error: errorMessage,
      locked_by: null,
      locked_at: null,
      next_attempt_at: nextAttemptISO,
    });

    return Job.validate(updatedRow);
  }
}

const retryManager = new RetryManager();

module.exports = {
  RetryManager,
  retryManager,
};
