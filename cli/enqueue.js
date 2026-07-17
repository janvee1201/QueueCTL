const queueManager = require('../queue/queueManager');

async function enqueueCommand(inputData = null, options = {}) {
  try {
    let jobData = {};

    if (typeof inputData === 'string' && inputData.trim()) {
      const trimmed = inputData.trim();
      try {
        jobData = JSON.parse(trimmed);
      } catch (e) {
        // If input looks like a PowerShell quote-stripped object {id:job2,command:echo hello2}, try extracting fields
        if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes(':')) {
          const content = trimmed.slice(1, -1);
          const parsedObj = {};
          // Match key: value pairs where value can contain spaces
          const regex = /(['"]?([a-zA-Z0-9_]+)['"]?\s*:\s*['"]?([^,'"}]+(?:\s+[^,'"}]+)*)['"]?)(?:,|$)/g;
          let match;
          while ((match = regex.exec(content)) !== null) {
            const k = match[2].trim();
            let v = match[3].trim();
            // Remove surrounding quotes if any remain
            v = v.replace(/^['"]|['"]$/g, '');
            if (k === 'max_retries' || k === 'backoff_base' || k === 'attempts') {
              const num = Number(v);
              if (!isNaN(num)) v = num;
            }
            parsedObj[k] = v;
          }
          if (parsedObj.command) {
            jobData = parsedObj;
          } else {
            jobData = { command: trimmed };
          }
        } else {
          // Otherwise treat plain string as the command
          jobData = { command: trimmed };
        }
      }
    } else if (typeof inputData === 'object' && inputData !== null) {
      jobData = { ...inputData };
    }

    if (options.id) {
      jobData.id = options.id;
    }
    if (options.command) {
      jobData.command = options.command;
    }
    if (options.maxRetries !== undefined && options.maxRetries !== null) {
      jobData.max_retries = Number(options.maxRetries);
    }
    if (options.backoffBase !== undefined && options.backoffBase !== null) {
      jobData.backoff_base = Number(options.backoffBase);
    }

    if (!jobData.command) {
      throw new Error('Command is required. Provide a JSON string or use --command <cmd>.');
    }

    const pc = require('picocolors');
    const job = await queueManager.addJob(jobData);

    if (!options.silent) {
      console.log(pc.green('✔ Job Added Successfully'));
      console.log(`${pc.bold('ID:')}         ${pc.cyan(job.id)}`);
      console.log(`${pc.bold('Command:')}    ${pc.white(job.command)}`);
      console.log(`${pc.bold('State:')}      ${pc.yellow(job.state)}`);
      console.log(`${pc.bold('Max Retries:')} ${pc.magenta(job.max_retries)}`);
    }

    return job;
  } catch (err) {
    if (!options.silent) {
      console.error('Error adding job:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await queueManager.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let input = args[0] || null;
  enqueueCommand(input).catch(() => process.exit(1));
}

module.exports = {
  enqueueCommand,
};
