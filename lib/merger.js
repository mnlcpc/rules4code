const fs = require('fs-extra');
const path = require('path');
const tracker = require('./tracker');

/**
 * Reads a JSON file, returning default if missing or corrupted
 * @param {string} filePath - Path to JSON file
 * @param {Object} defaultValue - Default value if file doesn't exist
 * @returns {Promise<Object>}
 */
async function readJsonFile(filePath, defaultValue = {}) {
  const resolvedPath = path.resolve(filePath);
  try {
    if (await fs.pathExists(resolvedPath)) {
      return await fs.readJson(resolvedPath);
    }
  } catch {
    // Corrupted file, return default
  }
  return defaultValue;
}

/**
 * Writes a JSON file, creating directories as needed
 * @param {string} filePath - Path to JSON file
 * @param {Object} content - Content to write
 * @returns {Promise<void>}
 */
async function writeJsonFile(filePath, content) {
  const resolvedPath = path.resolve(filePath);
  await fs.ensureDir(path.dirname(resolvedPath));
  await fs.writeJson(resolvedPath, content, { spaces: 2 });
}

// --- MCP Server operations (used by resolver for dependency management) ---

/**
 * Adds or updates an MCP server in config.json
 * @param {string} targetFile - Path to config.json
 * @param {string} serverName - Server name
 * @param {Object} serverConfig - Server configuration
 * @returns {Promise<void>}
 */
async function addMcpServer(targetFile, serverName, serverConfig) {
  const config = await readJsonFile(targetFile, {});
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[serverName] = serverConfig;
  await writeJsonFile(targetFile, config);
}

/**
 * Removes an MCP server from config.json
 * @param {string} targetFile - Path to config.json
 * @param {string} serverName - Server name to remove
 * @returns {Promise<void>}
 */
async function removeMcpServer(targetFile, serverName) {
  const config = await readJsonFile(targetFile, {});
  if (config.mcpServers) {
    delete config.mcpServers[serverName];
  }
  await writeJsonFile(targetFile, config);
}

/**
 * Gets a specific MCP server config
 * @param {string} targetFile - Path to config.json
 * @param {string} serverName - Server name
 * @returns {Promise<Object|null>}
 */
async function getMcpServer(targetFile, serverName) {
  const config = await readJsonFile(targetFile, {});
  return config.mcpServers?.[serverName] ?? null;
}

// --- Hook operations ---

/**
 * Gets hooks configuration from settings.json
 * @param {string} targetFile - Path to settings.json
 * @returns {Promise<Object>}
 */
async function getHooks(targetFile = '.claude/settings.json') {
  const settings = await readJsonFile(targetFile, {});
  return settings.hooks ?? {};
}

/**
 * Merges hook config into existing hooks in settings.json
 * @param {string} targetFile - Path to settings.json
 * @param {string} hookName - Identifier for tracking
 * @param {Object} hookConfig - Hook configuration { eventType: handlers }
 * @returns {Promise<void>}
 */
async function mergeHook(targetFile, hookName, hookConfig) {
  const settings = await readJsonFile(targetFile, {});
  if (!settings.hooks) settings.hooks = {};

  for (const [eventType, handlers] of Object.entries(hookConfig)) {
    if (!settings.hooks[eventType]) {
      settings.hooks[eventType] = [];
    }

    const handlerArray = Array.isArray(handlers) ? handlers : [handlers];

    for (const handler of handlerArray) {
      const markedHandler = typeof handler === 'object'
        ? { ...handler, _hands: hookName }
        : { command: handler, _hands: hookName };

      const existingIndex = settings.hooks[eventType].findIndex(
        h => h._hands === hookName
      );

      if (existingIndex >= 0) {
        settings.hooks[eventType][existingIndex] = markedHandler;
      } else {
        settings.hooks[eventType].push(markedHandler);
      }
    }
  }

  await writeJsonFile(targetFile, settings);
}

/**
 * Removes all handlers for a hook by name
 * @param {string} targetFile - Path to settings.json
 * @param {string} hookName - Hook name to remove
 * @returns {Promise<void>}
 */
async function removeHook(targetFile, hookName) {
  const settings = await readJsonFile(targetFile, {});
  if (!settings.hooks) return;

  for (const eventType of Object.keys(settings.hooks)) {
    if (Array.isArray(settings.hooks[eventType])) {
      settings.hooks[eventType] = settings.hooks[eventType].filter(
        h => h._hands !== hookName
      );
      if (settings.hooks[eventType].length === 0) {
        delete settings.hooks[eventType];
      }
    }
  }

  await writeJsonFile(targetFile, settings);
}

/**
 * Checks if a hook exists by its _hands marker
 * @param {string} targetFile - Path to settings.json
 * @param {string} hookName - Hook name to check
 * @returns {Promise<boolean>}
 */
async function hasHook(targetFile, hookName) {
  const hooks = await getHooks(targetFile);
  for (const eventType of Object.keys(hooks)) {
    if (Array.isArray(hooks[eventType])) {
      if (hooks[eventType].some(h => h._hands === hookName)) return true;
    }
  }
  return false;
}

/**
 * Syncs hooks: installs selected, removes unselected that came from hands
 * @param {string} targetFile - Path to settings.json
 * @param {Object[]} selectedHooks - Hooks the user selected
 * @param {Object} trackedHooks - Currently tracked hooks from metadata
 * @returns {Promise<{added: string[], removed: string[], updated: string[]}>}
 */
async function syncHooks(targetFile, selectedHooks, trackedHooks) {
  const result = { added: [], removed: [], updated: [] };
  const selectedNames = new Set(selectedHooks.map(h => h.name));

  for (const hook of selectedHooks) {
    const isNew = !(await hasHook(targetFile, hook.name));
    const newHash = tracker.computeHash(hook.config);

    if (isNew) {
      result.added.push(hook.name);
    } else {
      const tracked = trackedHooks[hook.name];
      if (tracked && tracked.hash !== newHash) {
        result.updated.push(hook.name);
      }
    }

    await mergeHook(targetFile, hook.name, hook.config);
    await tracker.trackInstall(hook, newHash);
  }

  for (const hookName of Object.keys(trackedHooks)) {
    if (!selectedNames.has(hookName)) {
      await removeHook(targetFile, hookName);
      await tracker.trackUninstall({ name: hookName, category: 'hooks' });
      result.removed.push(hookName);
    }
  }

  return result;
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  addMcpServer,
  removeMcpServer,
  getMcpServer,
  getHooks,
  mergeHook,
  removeHook,
  hasHook,
  syncHooks
};
