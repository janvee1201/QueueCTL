const child_process = require('child_process');

/**
 * Executes a command string using child_process.exec and returns a structured result.
 * @param {string} command - The command string to run
 * @param {Object} [options={}] - Execution options
 * @param {number} [options.timeout=0] - Timeout in milliseconds (0 for no timeout)
 * @param {string} [options.cwd] - Current working directory
 * @param {Object} [options.env] - Environment variables
 * @param {number} [options.maxBuffer] - Max stdout/stderr buffer size in bytes
 * @returns {Promise<{ success: boolean, exitCode: number | null, stdout: string, stderr: string, error: Error | null }>}
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve) => {
    const execOptions = {
      timeout: options.timeout || 0,
      cwd: options.cwd || process.cwd(),
      env: options.env ? { ...process.env, ...options.env } : process.env,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 10, // 10 MB default max buffer
    };

    const child = child_process.exec(command, execOptions, (error, stdout = '', stderr = '') => {
      const trimmedStdout = stdout.toString().trim();
      const trimmedStderr = stderr.toString().trim();

      if (error) {
        let exitCode = null;
        if (typeof error.code === 'number') {
          exitCode = error.code;
        } else if (child && typeof child.exitCode === 'number') {
          exitCode = child.exitCode;
        } else if (error.killed) {
          exitCode = -1;
        }

        return resolve({
          success: false,
          exitCode: exitCode,
          stdout: trimmedStdout,
          stderr: trimmedStderr,
          error: error,
        });
      }

      resolve({
        success: true,
        exitCode: 0,
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        error: null,
      });
    });
  });
}

module.exports = {
  executeCommand,
};
