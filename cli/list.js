const { jobService } = require('../services/jobService');

async function listCommand(options = {}) {
  try {
    const jobs = await jobService.listJobs(options.state);

    if (!options.silent) {
      if (jobs.length === 0) {
        console.log(options.state ? `No jobs found with state: '${options.state}'.` : 'No jobs found.');
      } else {
        const pc = require('picocolors');
        console.log(`\nFound ${pc.bold(pc.cyan(jobs.length))} job(s):\n`);
        jobs.forEach((job) => {
          console.log(`${pc.gray('ID:')}         ${pc.white(job.id)}`);
          console.log(`${pc.gray('Command:')}    ${pc.green(job.command)}`);
          let stateColor = pc.white;
          if (job.state === 'pending') stateColor = pc.cyan;
          if (job.state === 'processing') stateColor = pc.blue;
          if (job.state === 'completed') stateColor = pc.green;
          if (job.state === 'failed') stateColor = pc.yellow;
          if (job.state === 'dead') stateColor = pc.red;
          console.log(`${pc.gray('State:')}      ${stateColor(job.state.toUpperCase())}`);
          console.log(`${pc.gray('Attempts:')}   ${pc.yellow(job.attempts)}/${pc.yellow(job.max_retries)}`);
          console.log(`${pc.gray('Created At:')} ${pc.dim(job.created_at)}`);
          console.log(`${pc.gray('Updated At:')} ${pc.dim(job.updated_at)}`);
          if (job.last_error) console.log(`${pc.red('Last Error:')} ${pc.red(job.last_error)}`);
          console.log(pc.gray('--------------------------------------------------'));
        });
      }
    }

    return jobs;
  } catch (err) {
    if (!options.silent) {
      console.error('Error listing jobs:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await jobService.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let state = null;
  const stateIdx = args.indexOf('--state');
  if (stateIdx !== -1 && args[stateIdx + 1]) {
    state = args[stateIdx + 1];
  }
  listCommand({ state }).catch(() => process.exit(1));
}

module.exports = {
  listCommand,
};
