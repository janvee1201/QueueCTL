const queueManager = require('../queue/queueManager');
const repository = require('../storage/repository');
const executor = require('./executor');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { jobService } = require('../services/jobService');

class Worker {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.id] - Unique worker ID
   * @param {number} [options.pollInterval=500] - Polling interval in ms when no jobs found
   */
  constructor(options = {}) {
    this.id = options.id || `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.pid = process.pid;
    this.pollInterval = options.pollInterval || 500;
    this.isRunning = false;
    this.currentJob = null;
    this.loopPromise = null;
    this.options = options;
  }

  /**
   * Registers the worker in storage.
   */
  async register() {
    await repository.registerWorker(this.id, this.pid, 'idle');
  }

  /**
   * Starts the worker polling loop.
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.register();
    logger.info(`Worker [${this.id}] started`, { workerId: this.id });

    this.loopPromise = this.runLoop().catch((err) => {
      logger.error(`Worker [${this.id}] loop error: ${err.message}`, { workerId: this.id });
    });
  }

  /**
   * Internal async polling loop.
   */
  async runLoop() {
    while (this.isRunning) {
      try {
        const job = await queueManager.pickNextJob(this.id);

        if (job) {
          if (!this.isRunning) {
            await repository.updateJobState(job.id, JobState.PENDING, {
              locked_by: null,
              locked_at: null,
            });
            break;
          }
          this.currentJob = job;
          await repository.updateWorkerStatus(this.id, 'busy');

          const result = await executor.executeCommand(job.command);

          for (let attempt = 0; attempt < 15; attempt++) {
            try {
              if (result.success) {
                await queueManager.markCompleted(job.id);
              } else {
                const errorMessage = result.stderr || (result.error && result.error.message) || 'Execution failed';
                await queueManager.markFailed(job.id, errorMessage);
              }
              break;
            } catch (updateErr) {
              if (attempt === 14) {
                logger.error(`Worker [${this.id}] failed to update job [${job.id}] state after 15 attempts: ${updateErr.message}`, { workerId: this.id, jobId: job.id });
                throw updateErr;
              }
              await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
            }
          }

          this.currentJob = null;
          if (this.isRunning) {
            await repository.updateWorkerStatus(this.id, 'idle');
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        } else {
          // No pending jobs found
          if (this.options.drain) {
            const status = await jobService.getJobStatus();
            if (status.counts.pending === 0 && status.counts.processing === 0) {
              logger.info(`Worker [${this.id}] drain complete: no pending or processing jobs left.`, { workerId: this.id });
              this.isRunning = false;
              await repository.updateWorkerStatus(this.id, 'idle');
              break;
            }
          }
          // sleep before polling again
          await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
        }
      } catch (err) {
        // Log unexpected errors, make sure we reset currentJob if caught outside execution
        logger.error(`Worker [${this.id}] error: ${err.message}`, { workerId: this.id });
        this.currentJob = null;
        await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
      }
    }
  }

  /**
   * Gracefully stops the worker, waiting for any currently running job to finish.
   */
  async stop() {
    this.isRunning = false;

    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }

    // If currently busy with a job, wait until it finishes (graceful shutdown)
    while (this.currentJob) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await repository.removeWorker(this.id);
  }
}

module.exports = {
  Worker,
};
