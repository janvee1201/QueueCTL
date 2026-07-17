const { workerManager } = require('../worker/workerManager');

async function startWorkerCommand(options = {}) {
  try {
    const count = Number(options.count || 1);
    const workers = await workerManager.startWorkers(count, {
      pollInterval: options.pollInterval ? Number(options.pollInterval) : 500,
      drain: options.drain,
    });

    if (!options.silent) {
      if (options.drain) {
        console.log(`Started ${workers.length} worker(s). Will auto-exit when queue is empty.`);
      } else {
        console.log(`Started ${workers.length} worker(s). Press Ctrl+C to stop.`);
      }
    }

    if (options.drain) {
      await Promise.all(workers.map((w) => w.loopPromise));
      if (!options.silent) {
        console.log('\nQueue is empty. Shutting down workers automatically.');
      }
      await workerManager.stopWorkers();
      if (!options.keepDbOpen) {
        const { jobService } = require('../services/jobService');
        await jobService.close();
      }
      process.exit(0);
    }

    return workers;
  } catch (err) {
    if (!options.silent) {
      console.error('Error starting workers:', err.message);
    }
    throw err;
  }
}

async function stopWorkerCommand(options = {}) {
  try {
    const count = await workerManager.stopRemoteWorkers();

    if (!options.silent) {
      console.log(`Sent stop signal to ${count} remote worker process(es).`);
    }

    return count;
  } catch (err) {
    if (!options.silent) {
      console.error('Error stopping workers:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await workerManager.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  if (action === 'start') {
    let count = 1;
    const countIdx = args.indexOf('--count');
    if (countIdx !== -1 && args[countIdx + 1]) count = args[countIdx + 1];
    
    let drain = false;
    if (args.includes('--drain')) drain = true;

    startWorkerCommand({ count, drain }).catch(() => process.exit(1));
  } else if (action === 'stop') {
    stopWorkerCommand().catch(() => process.exit(1));
  } else {
    console.log('Usage: node cli/worker.js <start|stop> [--count N]');
  }
}

module.exports = {
  startWorkerCommand,
  stopWorkerCommand,
};
