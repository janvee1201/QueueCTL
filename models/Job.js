const { z } = require('zod');
const crypto = require('crypto');

const JobState = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead',
};

const JobStateEnum = z.enum([
  JobState.PENDING,
  JobState.PROCESSING,
  JobState.COMPLETED,
  JobState.FAILED,
  JobState.DEAD,
]);

// Schema for validating input when enqueuing a new job
const EnqueueJobSchema = z.object({
  id: z.string().min(1).optional(),
  command: z.string().min(1, 'Command must not be empty'),
  state: JobStateEnum.optional().default(JobState.PENDING),
  attempts: z.number().int().nonnegative().optional().default(0),
  max_retries: z.number().int().nonnegative().optional().default(3),
  backoff_base: z.number().int().positive().optional().default(1000),
});

// Full schema representing a Job in the system/database
const JobSchema = EnqueueJobSchema.extend({
  id: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
  last_error: z.string().nullable().optional(),
  locked_by: z.string().nullable().optional(),
  locked_at: z.string().nullable().optional(),
  next_attempt_at: z.string().nullable().optional(),
});

class Job {
  constructor(data) {
    Object.assign(this, data);
  }

  /**
   * Static helper method to build a new Job object with timestamps set to current time.
   * @param {Object} input - Job input (command, id, max_retries, etc.)
   * @returns {Job} Validated Job instance
   */
  static create(input) {
    const validatedInput = EnqueueJobSchema.parse(input);
    const now = new Date().toISOString();

    const jobData = {
      id: validatedInput.id || crypto.randomUUID(),
      command: validatedInput.command,
      state: validatedInput.state,
      attempts: validatedInput.attempts,
      max_retries: validatedInput.max_retries,
      backoff_base: validatedInput.backoff_base,
      created_at: now,
      updated_at: now,
      last_error: null,
      locked_by: null,
      locked_at: null,
      next_attempt_at: null,
    };

    const parsed = JobSchema.parse(jobData);
    return new Job(parsed);
  }

  /**
   * Validates and creates a Job instance from existing data (e.g. from database).
   * @param {Object} data - Raw data from DB or external source
   * @returns {Job} Validated Job instance
   */
  static validate(data) {
    const parsed = JobSchema.parse(data);
    return new Job(parsed);
  }
}

module.exports = {
  Job,
  JobState,
  JobStateEnum,
  EnqueueJobSchema,
  JobSchema,
};
