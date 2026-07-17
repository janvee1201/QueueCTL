const repository = require('../storage/repository');

const DEFAULTS = {
  max_retries: 3,
  backoff_base: 2, // 2 seconds by default
};

class ConfigService {
  /**
   * Normalizes configuration keys (e.g. max-retries -> max_retries).
   * @param {string} key
   * @returns {string}
   */
  normalizeKey(key) {
    if (!key) return key;
    return key.replace(/-/g, '_').toLowerCase();
  }

  /**
   * Retrieves a config setting from storage or falls back to sensible defaults.
   * @param {string} key - Configuration key (max_retries or backoff_base)
   * @returns {Promise<string|number>}
   */
  async getConfig(key) {
    const normalizedKey = this.normalizeKey(key);
    const dbValue = await repository.getConfig(normalizedKey);

    if (dbValue !== null && dbValue !== undefined) {
      const num = Number(dbValue);
      return !isNaN(num) ? num : dbValue;
    }

    return DEFAULTS[normalizedKey] !== undefined ? DEFAULTS[normalizedKey] : null;
  }

  /**
   * Sets a config setting in storage.
   * @param {string} key - Configuration key (max-retries or backoff-base)
   * @param {string|number} value - Configuration value
   * @returns {Promise<void>}
   */
  async setConfig(key, value) {
    const normalizedKey = this.normalizeKey(key);
    await repository.setConfig(normalizedKey, value);
  }

  /**
   * Returns all current config settings as an object.
   * @returns {Promise<Object>}
   */
  async getAllConfig() {
    const rows = await repository.listConfig();
    const config = { ...DEFAULTS };

    for (const row of rows) {
      const num = Number(row.value);
      config[row.key] = !isNaN(num) ? num : row.value;
    }

    return config;
  }

  /**
   * Closes underlying storage connection.
   * @returns {Promise<void>}
   */
  async close() {
    await repository.close();
  }
}

const configService = new ConfigService();

module.exports = {
  ConfigService,
  configService,
};
