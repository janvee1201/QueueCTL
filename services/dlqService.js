const repository = require('../storage/repository');
const { Job, JobState } = require('../models/Job');
const logger = require('../utils/logger');

class DlqService {
  /**
   * Retrieves all jobs currently in the dead-letter queue (state = 'dead').
   * @returns {Promise<Job[]>} Array of dead jobs
   */
  async listDeadJobs() {
    const deadRows = await repository.listJobsByState(JobState.DEAD);
    return deadRows.map((row) => Job.validate(row));
  }

  /**
   * Retries a dead job by resetting its attempts to 0, clearing error/lock states,
   * setting state back to pending, and updating its timestamp.
   * @param {string} jobId - ID of the dead job to retry
   * @param {string} [newCommand=null] - Optional new command if updating the command string
   * @returns {Promise<Job|null>} Updated job instance or null if not found
   */
  async retryDeadJob(jobId, newCommand = null) {
    const jobRow = await repository.getJobById(jobId);
    if (!jobRow) {
      logger.warn(`DLQ retry failed: Job [${jobId}] not found.`, { jobId });
      return null;
    }

    if (jobRow.state !== JobState.DEAD) {
      logger.warn(`DLQ retry failed: Job [${jobId}] is currently in state '${jobRow.state}', not 'dead'.`, { jobId });
      return null;
    }

    const extras = {
      attempts: 0,
      last_error: null,
      locked_by: null,
      locked_at: null,
      next_attempt_at: null,
    };

    if (newCommand) {
      extras.command = newCommand;
    }

    const updatedRow = await repository.updateJobState(jobId, JobState.PENDING, extras);
    const validatedJob = Job.validate(updatedRow);

    logger.info(`DLQ retry: Job [${jobId}] has been reset and re-queued as PENDING.`, { jobId });
    return validatedJob;
  }

  /**
   * Deletes one specific dead job or purges all jobs in the dead-letter queue.
   * @param {string|null} [jobId=null] - Optional job ID to delete; purges all dead jobs if null
   * @returns {Promise<number>} Number of dead jobs deleted
   */
  async purgeDeadJobs(jobId = null) {
    if (jobId) {
      const jobRow = await repository.getJobById(jobId);
      if (jobRow && jobRow.state === JobState.DEAD) {
        await repository.deleteJob(jobId);
        logger.info(`DLQ purge: Deleted dead job [${jobId}].`, { jobId });
        return 1;
      }
      return 0;
    }

    const deadJobs = await this.listDeadJobs();
    for (const job of deadJobs) {
      await repository.deleteJob(job.id);
    }
    logger.info(`DLQ purge: Deleted ${deadJobs.length} dead jobs.`);
    return deadJobs.length;
  }

  /**
   * Closes underlying storage connection.
   * @returns {Promise<void>}
   */
  async close() {
    await repository.close();
  }
}

const dlqService = new DlqService();

module.exports = {
  DlqService,
  dlqService,
};
