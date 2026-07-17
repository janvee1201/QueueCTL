const { dlqService } = require('../services/dlqService');

async function listDlqCommand(options = {}) {
  try {
    const jobs = await dlqService.listDeadJobs();

    if (!options.silent) {
      if (jobs.length === 0) {
        console.log('No jobs found in the Dead Letter Queue.');
      } else {
        console.log(`\nFound ${jobs.length} dead job(s):\n`);
        jobs.forEach((job) => {
          console.log(`ID:         ${job.id}`);
          console.log(`Command:    ${job.command}`);
          console.log(`Attempts:   ${job.attempts}/${job.max_retries}`);
          console.log(`Created At: ${job.created_at}`);
          console.log(`Updated At: ${job.updated_at}`);
          if (job.last_error) console.log(`Last Error: ${job.last_error}`);
          console.log('--------------------------------------------------');
        });
      }
    }

    return jobs;
  } catch (err) {
    if (!options.silent) {
      console.error('Error listing dead jobs:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await dlqService.close();
    }
  }
}

async function retryDlqCommand(jobId, options = {}) {
  try {
    const job = await dlqService.retryDeadJob(jobId, options.command || null);

    if (!options.silent) {
      if (!job) {
        console.log(`Dead job [${jobId}] not found or not in dead state.`);
      } else {
        console.log(`Dead job [${jobId}] retried successfully and re-queued as PENDING.`);
      }
    }

    return job;
  } catch (err) {
    if (!options.silent) {
      console.error(`Error retrying dead job [${jobId}]:`, err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await dlqService.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  if (action === 'list') {
    listDlqCommand().catch(() => process.exit(1));
  } else if (action === 'retry' && args[1]) {
    retryDlqCommand(args[1]).catch(() => process.exit(1));
  } else {
    console.log('Usage: node cli/dlq.js <list|retry> [jobId]');
  }
}

module.exports = {
  listDlqCommand,
  retryDlqCommand,
};
