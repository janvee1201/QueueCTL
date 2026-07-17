#!/usr/bin/env node
const { Command } = require('commander');
const { enqueueCommand } = require('./cli/enqueue');
const { startWorkerCommand, stopWorkerCommand } = require('./cli/worker');
const { statusCommand } = require('./cli/status');
const { listCommand } = require('./cli/list');
const { listDlqCommand, retryDlqCommand } = require('./cli/dlq');
const { setConfigCommand, getConfigCommand } = require('./cli/config');

const figlet = require('figlet');
const pc = require('picocolors');
const Table = require('cli-table3');

const program = new Command();

function wrapInDashedBox(text) {
  const lines = text.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));

  const topBorder = '+' + '-'.repeat(maxLen + 4) + '+';
  const bottomBorder = '+' + '-'.repeat(maxLen + 4) + '+';
  const emptyLine = '|' + ' '.repeat(maxLen + 4) + '|';

  const boxedLines = [
    topBorder,
    emptyLine,
    ...lines.map(line => '|  ' + line.padEnd(maxLen, ' ') + '  |'),
    emptyLine,
        bottomBorder
  ];

  return boxedLines.join('\n');
}

function applyGradient(text) {
  const lines = text.split('\n');
  return lines.map(line => {
    let coloredLine = '';
    const len = line.length || 1;
    for (let i = 0; i < line.length; i++) {
      const ratio = i / len;
      // Cyan to Blue gradient
      const r = 0;
      const g = Math.round(255 - ratio * 255);
      const b = 255;
      coloredLine += `\x1b[38;2;${r};${g};${b}m${line[i]}\x1b[39m`;
    }
    return coloredLine;
  }).join('\n');
}

program.configureHelp({
  formatHelp: (cmd, helper) => {
    const rawText = figlet.textSync('QUEUECTL', { font: 'ANSI Regular', horizontalLayout: 'full' });
    const lines = rawText.split('\n').filter(l => l.trim().length > 0);
    
    const shadowOffset = 1;
    const shadowChar = '▒';
    let shadowedLines = [];
    for (let i = 0; i < lines.length + shadowOffset; i++) {
      shadowedLines.push('');
    }
    for (let y = 0; y < lines.length; y++) {
      for (let x = 0; x < lines[y].length; x++) {
        if (lines[y][x] === '█') {
          const sy = y + shadowOffset;
          const sx = x + shadowOffset;
          while(shadowedLines[sy].length <= sx) shadowedLines[sy] += ' ';
          shadowedLines[sy] = shadowedLines[sy].substring(0, sx) + shadowChar + shadowedLines[sy].substring(sx + 1);
        }
      }
    }
    for (let y = 0; y < lines.length; y++) {
      for (let x = 0; x < lines[y].length; x++) {
        if (lines[y][x] === '█') {
          while(shadowedLines[y].length <= x) shadowedLines[y] += ' ';
          shadowedLines[y] = shadowedLines[y].substring(0, x) + '█' + shadowedLines[y].substring(x + 1);
        }
      }
    }

    const exactArrow = [
      "██      ",
      " ██     ",
      "  ██▒▒  ",
      " ██ ▒▒  ",
      "██  ▒▒  ",
      "   ▒▒   "
    ];

    for (let i = 0; i < shadowedLines.length; i++) {
      if (exactArrow[i]) {
        shadowedLines[i] = exactArrow[i] + shadowedLines[i];
      } else {
        shadowedLines[i] = "        " + shadowedLines[i];
      }
    }

    const bannerText = shadowedLines.join('\n');
    const boxedBanner = wrapInDashedBox(bannerText);
    const coloredBanner = applyGradient(boxedBanner);
    
    let help = `\n${coloredBanner}\n`;
    help += pc.dim('     by QueueCTL Team') + '\n\n';
    
    help += pc.bold(pc.green(cmd.description())) + '\n\n';
    help += pc.bold(pc.cyan('Usage: ')) + pc.white(helper.commandUsage(cmd)) + '\n\n';
    
    const opts = cmd.options;
    const boxBorders = {
      'top': pc.cyan('-'), 'top-mid': pc.cyan('+'), 'top-left': pc.cyan('+'), 'top-right': pc.cyan('+'),
      'bottom': pc.cyan('-'), 'bottom-mid': pc.cyan('+'), 'bottom-left': pc.cyan('+'), 'bottom-right': pc.cyan('+'),
      'left': pc.cyan('|'), 'left-mid': '', 'mid': '', 'mid-mid': '',
      'right': pc.cyan('|'), 'right-mid': '', 'middle': pc.cyan(' | ')
    };

    if (opts.length > 0) {
      help += pc.bold(pc.cyan('Options:\n'));
      const optTable = new Table({ chars: boxBorders, style: { 'padding-left': 2, 'padding-right': 2 } });
      opts.forEach(opt => optTable.push([pc.bold(pc.yellow(opt.flags)), pc.white(opt.description)]));
      help += optTable.toString() + '\n\n';
    }
    
    const subcmds = cmd.commands;
    if (subcmds.length > 0) {
      help += pc.bold(pc.cyan('Commands:\n'));
      const cmdTable = new Table({ chars: boxBorders, style: { 'padding-left': 2, 'padding-right': 2 } });
      subcmds.forEach(sub => {
        if (sub.commands && sub.commands.length > 0) {
          sub.commands.forEach(subSub => {
            const term = helper.subcommandTerm(subSub);
            cmdTable.push([pc.bold(pc.green(`➜ ${sub.name()} ${term}`)), pc.white(subSub.description())]);
          });
        } else {
          cmdTable.push([pc.bold(pc.green(`➜ ${sub.name()}`)) + ' ' + pc.dim(sub.options.length > 0 ? '[options]' : ''), pc.white(sub.description())]);
        }
      });
      help += cmdTable.toString() + '\n\n';
    }
    help += pc.dim('Developed for high-throughput reliability.\n');
    return help;
  }
});

program
  .name('queuectl')
  .description('A robust, concurrency-safe Node.js & SQLite job queueing system.')
  .version('1.0.0');

// 1. Enqueue Subcommand
program
  .command('enqueue [json]')
      .description('Enqueue a new background job using a JSON string or flags')
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .option('-i, --id <id>', 'Unique job ID')
      .option('-c, --command <cmd>', 'Command string to execute')
      .option('-r, --max-retries <n>', 'Maximum retry attempts on failure')
      .option('-b, --backoff-base <n>', 'Exponential backoff base value')
      .action(async (jsonInput, options) => {
        try {
          let fullCommandString = options.command;
          const cIndex = process.argv.findIndex((arg) => arg === '-c' || arg === '--command');
          if (cIndex !== -1 && cIndex + 1 < process.argv.length) {
            const parts = [];
            for (let idx = cIndex + 1; idx < process.argv.length; idx++) {
              const token = process.argv[idx];
              if (['--id', '-i', '--max-retries', '-r', '--backoff-base', '-b'].includes(token)) {
                break;
              }
              parts.push(token);
            }
            if (parts.length > 0) {
              fullCommandString = parts.join(' ');
            }
          }

          await enqueueCommand(jsonInput, {
            id: options.id,
            command: fullCommandString,
            maxRetries: options.maxRetries,
            backoffBase: options.backoffBase,
          });
        } catch (err) {
          process.exit(1);
        }
      });

  // 2. Worker Subcommands
  const workerCmd = program
    .command('worker')
    .description('Manage background worker processes');

  workerCmd
    .command('start')
    .description('Start a pool of background workers to process jobs')
    .option('--count <n>', 'Number of worker instances to launch', '1')
    .option('--poll-interval <ms>', 'Polling interval in milliseconds when queue is empty', '500')
    .option('--drain', 'Auto-exit workers when all pending tasks are completed')
    .action(async (options) => {
      try {
        await startWorkerCommand(options);
      } catch (err) {
        process.exit(1);
      }
    });

  workerCmd
    .command('stop')
    .description('Signal all running workers to finish their current job and stop gracefully')
    .action(async () => {
      try {
        await stopWorkerCommand();
      } catch (err) {
        process.exit(1);
      }
    });

  // 3. Status Subcommand
  program
    .command('status')
    .description('Display aggregated counts of jobs grouped by state and active workers')
    .action(async () => {
      try {
        await statusCommand();
      } catch (err) {
        process.exit(1);
      }
    });

  // 4. List Subcommand
  program
    .command('list')
    .description('List individual job rows with timestamps and attempt history')
    .option('-s, --state <state>', 'Filter jobs by state (pending, processing, completed, failed, dead, all)')
    .action(async (options) => {
      try {
        await listCommand({ state: options.state });
      } catch (err) {
        process.exit(1);
      }
    });

  // 5. DLQ Subcommands
  const dlqCmd = program
    .command('dlq')
    .description('Manage the Dead Letter Queue (jobs in dead state)');

  dlqCmd
    .command('list')
    .description('List all jobs currently in the Dead Letter Queue')
    .action(async () => {
      try {
        await listDlqCommand();
      } catch (err) {
        process.exit(1);
      }
    });

  dlqCmd
    .command('retry <jobId>')
    .description('Reset a dead job to pending state with attempts=0 so it re-enters the normal queue flow')
    .option('-c, --command <cmd>', 'Optional new command string if correcting a bad command')
    .action(async (jobId, options) => {
      try {
        await retryDlqCommand(jobId, { command: options.command });
      } catch (err) {
        process.exit(1);
      }
    });

  // 6. Config Subcommands
  const configCmd = program
    .command('config')
    .description('Manage global defaults for max-retries and backoff-base');

  configCmd
    .command('set <key> <value>')
    .description('Set a global configuration value (e.g. max-retries, backoff-base)')
    .action(async (key, value) => {
      try {
        await setConfigCommand(key, value);
      } catch (err) {
        process.exit(1);
      }
    });

  configCmd
    .command('get [key]')
    .description('Get a specific configuration setting or display all if key is omitted')
    .action(async (key) => {
      try {
        await getConfigCommand(key);
      } catch (err) {
        process.exit(1);
      }
    });

  configCmd
    .command('show')
    .description('Display all current configuration settings')
    .action(async () => {
      try {
        await getConfigCommand('show', { showAll: true });
      } catch (err) {
        process.exit(1);
      }
    });

  if (require.main === module) {
    program.parseAsync(process.argv).catch(() => process.exit(1));
  }

  module.exports = {
    program,
  };
