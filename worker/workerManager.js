const { Worker } = require('./worker');
const repository = require('../storage/repository');

class WorkerManager {
  constructor() {
    this.workers = [];
    this.isShuttingDown = false;
  }

  /**
   * Spawns N worker instances running in-process async polling loops.
   * @param {number} count - Number of workers to spawn
   * @param {Object} [options={}] - Options passed to each worker
   * @returns {Promise<Worker[]>}
   */
  async startWorkers(count = 1, options = {}) {
    this.setupSignalHandlers();

    for (let i = 0; i < count; i++) {
      const worker = new Worker({
        ...options,
        id: options.idPrefix ? `${options.idPrefix}-${i + 1}` : undefined,
      });
      this.workers.push(worker);
      await worker.start();
    }

    return this.workers;
  }

  /**
   * Gracefully stops all active in-process workers, waiting for ongoing jobs to complete.
   * @returns {Promise<void>}
   */
  async stopWorkers() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    await Promise.all(this.workers.map((worker) => worker.stop()));
    this.workers = [];
    this.isShuttingDown = false;
  }

  /**
   * Sets up process signal handlers (SIGINT, SIGTERM) to trigger graceful shutdown.
   */
  setupSignalHandlers() {
    const handleSignal = async (signal) => {
      if (this.isShuttingDown) return;
      console.log(`\nReceived ${signal}, gracefully shutting down workers...`);
      await this.stopWorkers();
      process.exit(0);
    };

    // Remove existing listeners to avoid duplicate registrations if called multiple times
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  }

  /**
   * Signals remote worker processes registered in the database to stop gracefully.
   * Used by `queuectl worker stop` CLI.
   * @returns {Promise<number>} Number of worker processes signaled
   */
  async stopRemoteWorkers() {
    const activeWorkers = await repository.listWorkers();
    const signaledPids = new Set();

    for (const worker of activeWorkers) {
      if (!signaledPids.has(worker.pid) && worker.pid !== process.pid) {
        try {
          process.kill(worker.pid, 'SIGTERM');
          signaledPids.add(worker.pid);
        } catch (err) {
          if (err.code === 'ESRCH') {
            // Process no longer exists, clean up stale worker entry
            await repository.removeWorker(worker.id);
          } else {
            console.error(`Failed to send SIGTERM to PID ${worker.pid}:`, err.message);
          }
        }
      }
    }

    // Also stop any workers in the current process just in case
    await this.stopWorkers();

    return signaledPids.size;
  }

  /**
   * Closes underlying storage connection.
   * @returns {Promise<void>}
   */
  async close() {
    await repository.close();
  }
}

// Export a singleton instance as well as the class
const workerManager = new WorkerManager();

module.exports = {
  WorkerManager,
  workerManager,
};
