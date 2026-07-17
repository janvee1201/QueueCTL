const { executeCommand } = require('../worker/executor');

describe('Command Executor', () => {
  test('runs "echo hello" successfully and captures stdout', async () => {
    const result = await executeCommand('echo hello');

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.error).toBeNull();
  });

  test('runs non-existent command "abcdxyz" and reports failure', async () => {
    const result = await executeCommand('abcdxyz');

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toBeDefined();
  });

  test('runs delayed command successfully (simulating "sleep 2")', async () => {
    // Using node -e with setTimeout for 100% reliable cross-platform execution on Windows/Unix
    const startTime = Date.now();
    const result = await executeCommand('node -e "setTimeout(() => console.log(\'done sleeping\'), 1500)"');
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('done sleeping');
    expect(elapsed).toBeGreaterThanOrEqual(1400);
  }, 10000); // 10s jest timeout

  test('kills command and reports failure when timeout option is exceeded', async () => {
    const result = await executeCommand('node -e "setTimeout(() => {}, 5000)"', {
      timeout: 300,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error.killed).toBe(true);
  }, 10000);
});
