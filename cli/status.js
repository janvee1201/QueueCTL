const { jobService } = require('../services/jobService');
const pc = require('picocolors');

function renderStatusDashboard(status) {
  const counts = status.counts;
  const activeWorkers = status.activeWorkers;
  
  const totalJobs = counts.pending + counts.processing + counts.completed + counts.failed + counts.dead;
  
  const width = 56;
  
  const borderChar = (char) => pc.magenta(char);
  const topBorder    = borderChar('┌' + '─'.repeat(width) + '┐');
  const divider      = borderChar('├' + '─'.repeat(width) + '┤');
  const bottomBorder = borderChar('└' + '─'.repeat(width) + '┘');
  
  const padLine = (content) => {
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    const cleanContent = stripAnsi(content);
    const padding = Math.max(0, width - cleanContent.length);
    return borderChar('│') + content + ' '.repeat(padding) + borderChar('│');
  };
  
  const getProgressBar = (val, total, colorFn) => {
    const barLength = 20;
    const ratio = total > 0 ? (val / total) : 0;
    const filledCount = Math.round(ratio * barLength);
    const emptyCount = barLength - filledCount;
    return colorFn('█'.repeat(filledCount)) + pc.gray('░'.repeat(emptyCount));
  };
  
  const lines = [];
  lines.push(topBorder);
  lines.push(padLine('  ' + pc.bold(pc.white('SYSTEM DASHBOARD'))));
  lines.push(divider);
  lines.push(padLine(''));
  
  const workersText = activeWorkers > 0 
    ? pc.green(`● ${activeWorkers} running`) 
    : pc.red(`○ ${activeWorkers} active`);
  
  lines.push(padLine('  ' + pc.gray('Workers Active  ') + workersText));
  lines.push(padLine('  ' + pc.gray('Total Jobs      ') + pc.bold(pc.white(totalJobs))));
  lines.push(padLine(''));
  lines.push(divider);
  lines.push(padLine('  ' + pc.bold(pc.white('JOB BREAKDOWN'))));
  lines.push(divider);
  lines.push(padLine(''));
  
  // Pending
  const pendingBar = getProgressBar(counts.pending, totalJobs, pc.cyan);
  lines.push(padLine(`  ${pc.cyan('●')} ${pc.white('Pending').padEnd(12)}  ${pendingBar}  ${pc.cyan(`${counts.pending}/${totalJobs}`)}`));
  
  // Processing
  const processingBar = getProgressBar(counts.processing, totalJobs, pc.blue);
  lines.push(padLine(`  ${pc.blue('◎')} ${pc.white('Processing').padEnd(12)}  ${processingBar}  ${pc.blue(`${counts.processing}/${totalJobs}`)}`));
  
  // Completed
  const completedBar = getProgressBar(counts.completed, totalJobs, pc.green);
  lines.push(padLine(`  ${pc.green('✓')} ${pc.white('Completed').padEnd(12)}  ${completedBar}  ${pc.green(`${counts.completed}/${totalJobs}`)}`));
  
  // Failed
  const failedBar = getProgressBar(counts.failed, totalJobs, pc.yellow);
  lines.push(padLine(`  ${pc.yellow('▲')} ${pc.white('Failed').padEnd(12)}  ${failedBar}  ${pc.yellow(`${counts.failed}/${totalJobs}`)}`));
  
  // Dead
  const deadBar = getProgressBar(counts.dead, totalJobs, pc.red);
  lines.push(padLine(`  ${pc.red('×')} ${pc.white('Dead (DLQ)').padEnd(12)}  ${deadBar}  ${pc.red(`${counts.dead}/${totalJobs}`)}`));
  
  lines.push(padLine(''));
  lines.push(bottomBorder);
  
  return lines.join('\n');
}

async function statusCommand(options = {}) {
  try {
    const status = await jobService.getJobStatus();
    if (!options.silent) {
      console.log(renderStatusDashboard(status));
    }
    return status;
  } catch (err) {
    if (!options.silent) {
      console.error('Error fetching job status:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await jobService.close();
    }
  }
}

if (require.main === module) {
  statusCommand().catch(() => process.exit(1));
}

module.exports = {
  statusCommand,
};
