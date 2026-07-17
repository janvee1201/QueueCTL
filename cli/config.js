const { configService } = require('../services/configService');

async function setConfigCommand(key, value, options = {}) {
  try {
    if (value === undefined || value === null) {
      throw new Error('Value is required when setting a configuration.');
    }
    await configService.setConfig(key, value);

    if (!options.silent) {
      console.log(`Config ${key} set to ${value}`);
    }
  } catch (err) {
    if (!options.silent) {
      console.error('Error setting config:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await configService.close();
    }
  }
}

async function getConfigCommand(key = null, options = {}) {
  try {
    if (!key || key === 'show' || options.showAll) {
      const all = await configService.getAllConfig();
      if (!options.silent) {
        console.log('\nCurrent Configuration:\n');
        for (const [k, v] of Object.entries(all)) {
          console.log(`${k}: ${v}`);
        }
        console.log('');
      }
      return all;
    }

    const val = await configService.getConfig(key);
    if (!options.silent) {
      console.log(`${key}: ${val !== null ? val : 'Not set'}`);
    }
    return val;
  } catch (err) {
    if (!options.silent) {
      console.error('Error getting config:', err.message);
    }
    throw err;
  } finally {
    if (!options.keepDbOpen) {
      await configService.close();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  if (action === 'set' && args[1] && args[2] !== undefined) {
    setConfigCommand(args[1], args[2]).catch(() => process.exit(1));
  } else if (action === 'get' || action === 'show') {
    getConfigCommand(args[1]).catch(() => process.exit(1));
  } else {
    console.log('Usage: node cli/config.js <set|get|show> [key] [value]');
  }
}

module.exports = {
  setConfigCommand,
  getConfigCommand,
};
