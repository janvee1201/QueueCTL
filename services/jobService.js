const repository = require('../storage/repository');
const { Job, JobState } = require('../models/Job');

class JobService {
  /**
   * Retrieves aggregated status counts grouped by state and active workers.
   * @returns {Promise<Object>} Status object containing counts and formatted output string
   */
  async getJobStatus() {
    const countsRows = await repository.getJobCountsByState();
    const workers = await repository.listWorkers();

    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
    };

    for (const row of countsRows) {
      if (counts[row.state] !== undefined) {
        counts[row.state] = row.count;
      }
    }

    const activeWorkersCount = workers.length;

    // Format output clearly, e.g., "Pending: 3, Running: 1, Completed: 4, Dead: 0"
    const pc = require('picocolors');
    const formatted = `${pc.cyan('Pending:')} ${pc.bold(counts.pending)}, ${pc.blue('Running:')} ${pc.bold(counts.processing)}, ${pc.green('Completed:')} ${pc.bold(counts.completed)}, ${pc.yellow('Failed:')} ${pc.bold(counts.failed)}, ${pc.red('Dead:')} ${pc.bold(counts.dead)} ${pc.magenta(`(Active Workers: ${activeWorkersCount})`)}`;

    return {
      counts,
      activeWorkers: activeWorkersCount,
      formatted,
    };
  }

  /**
   * Lists job rows filtered by state, or all jobs if state is not provided or 'all'.
   * @param {string|null} [state=null] - Job state filter (pending, processing, completed, failed, dead, all)
   * @returns {Promise<Job[]>} Array of job instances
   */
  async listJobs(state = null) {
    let rows;
    if (state && state !== 'all') {
      rows = await repository.listJobsByState(state.toLowerCase());
    } else {
      rows = await repository.listAllJobs();
    }
    return rows.map((row) => Job.validate(row));
  }

  /**
   * Retrieves a single job by ID.
   * @param {string} jobId
   * @returns {Promise<Job|null>}
   */
  async getJobById(jobId) {
    const row = await repository.getJobById(jobId);
    return row ? Job.validate(row) : null;
  }

  /**
   * Deletes a job by ID.
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async deleteJob(jobId) {
    await repository.deleteJob(jobId);
  }

  /**
   * Closes the underlying storage connection.
   */
  async close() {
    await repository.close();
  }
}

const jobService = new JobService();

module.exports = {
  JobService,
  jobService,
};
