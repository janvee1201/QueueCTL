const { Job, JobState, EnqueueJobSchema, JobSchema } = require('../models/Job');

describe('Job Model & Validation', () => {
  test('Job.create generates a valid job with sane defaults and timestamps', () => {
    const job = Job.create({ command: 'echo "hello world"' });

    expect(job.id).toBeDefined();
    expect(typeof job.id).toBe('string');
    expect(job.command).toBe('echo "hello world"');
    expect(job.state).toBe(JobState.PENDING);
    expect(job.attempts).toBe(0);
    expect(job.max_retries).toBe(3);
    expect(job.backoff_base).toBe(1000);
    expect(job.created_at).toBeDefined();
    expect(job.updated_at).toBeDefined();
    expect(new Date(job.created_at).getTime()).not.toBeNaN();
    expect(new Date(job.updated_at).getTime()).not.toBeNaN();
  });

  test('Job.create respects provided id and custom max_retries', () => {
    const customId = '123e4567-e89b-12d3-a456-426614174000';
    const job = Job.create({
      id: customId,
      command: 'node worker.js',
      max_retries: 5,
    });

    expect(job.id).toBe(customId);
    expect(job.max_retries).toBe(5);
  });

  test('EnqueueJobSchema validates required command field', () => {
    expect(() => {
      EnqueueJobSchema.parse({});
    }).toThrow();

    expect(() => {
      EnqueueJobSchema.parse({ command: '' });
    }).toThrow('Command must not be empty');
  });

  test('JobState allows only valid enum values', () => {
    expect(() => {
      EnqueueJobSchema.parse({ command: 'test', state: 'invalid_state' });
    }).toThrow();

    const validStates = ['pending', 'processing', 'completed', 'failed', 'dead'];
    validStates.forEach((state) => {
      const parsed = EnqueueJobSchema.parse({ command: 'test', state });
      expect(parsed.state).toBe(state);
    });
  });

  test('Job.validate validates full job structures correctly', () => {
    const validData = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      command: 'echo "test"',
      state: 'completed',
      attempts: 1,
      max_retries: 3,
      backoff_base: 1000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const validatedJob = Job.validate(validData);
    expect(validatedJob).toBeInstanceOf(Job);
    expect(validatedJob.state).toBe('completed');
  });
});
