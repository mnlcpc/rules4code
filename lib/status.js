const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { ComponentType } = require('./detector');
const tracker = require('./tracker');
const merger = require('./merger');
const envValidator = require('./env-validator');

const Status = {
  INSTALLED: 'installed',
  OUTDATED: 'outdated',
  AVAILABLE: 'available',
  MISSING_ENV: 'missing-env'
};

const StatusSymbol = {
  [Status.INSTALLED]: chalk.green('[✓]'),
  [Status.OUTDATED]: chalk.yellow('[~]'),
  [Status.AVAILABLE]: chalk.dim('[ ]'),
  [Status.MISSING_ENV]: chalk.red('⚠️ ')
};

const StatusDescription = {
  [Status.INSTALLED]: chalk.dim('(installed)'),
  [Status.OUTDATED]: chalk.yellow('(outdated)'),
  [Status.AVAILABLE]: chalk.dim('(available)'),
  [Status.MISSING_ENV]: (vars) => chalk.red(`(missing: ${vars.join(', ')})`)
};

/**
 * Gets status for a FILE_BASED component (skill or agent)
 * @param {Object} component - Component object
 * @returns {Promise<Object>} - { status, symbol, description }
 */
async function getFileBasedStatus(component) {
  const targetPath = path.resolve(component.targetPath);

  if (!await fs.pathExists(targetPath)) {
    return {
      status: Status.AVAILABLE,
      symbol: StatusSymbol[Status.AVAILABLE],
      description: StatusDescription[Status.AVAILABLE]
    };
  }

  const hashFn = component.category === 'skills'
    ? tracker.computeDirectoryHash
    : tracker.computeFileHash;
  const sourceHash = await hashFn(component.sourcePath);
  const targetHash = await hashFn(targetPath);

  if (sourceHash === targetHash) {
    return {
      status: Status.INSTALLED,
      symbol: StatusSymbol[Status.INSTALLED],
      description: StatusDescription[Status.INSTALLED]
    };
  }

  const trackedInfo = await tracker.getTrackedInfo(component);

  if (trackedInfo) {
    return {
      status: Status.OUTDATED,
      symbol: StatusSymbol[Status.OUTDATED],
      description: StatusDescription[Status.OUTDATED]
    };
  }

  return {
    status: Status.OUTDATED,
    symbol: StatusSymbol[Status.OUTDATED],
    description: chalk.yellow('(different)')
  };
}

/**
 * Gets status for a hook component
 * @param {Object} component - Component object
 * @returns {Promise<Object>} - { status, symbol, description, missingEnvVars? }
 */
async function getHookStatus(component) {
  const envValidation = envValidator.validateComponentEnvVars(component);

  if (!envValidation.isValid) {
    return {
      status: Status.MISSING_ENV,
      symbol: StatusSymbol[Status.MISSING_ENV],
      description: StatusDescription[Status.MISSING_ENV](envValidation.missingVars),
      missingEnvVars: envValidation.missingVars
    };
  }

  const exists = await merger.hasHook(component.targetFile, component.name);

  if (!exists) {
    return {
      status: Status.AVAILABLE,
      symbol: StatusSymbol[Status.AVAILABLE],
      description: StatusDescription[Status.AVAILABLE]
    };
  }

  const trackedInfo = await tracker.getTrackedInfo(component);
  const currentHash = tracker.computeHash(component.config);

  if (trackedInfo && trackedInfo.hash === currentHash) {
    return {
      status: Status.INSTALLED,
      symbol: StatusSymbol[Status.INSTALLED],
      description: StatusDescription[Status.INSTALLED]
    };
  }

  return {
    status: Status.OUTDATED,
    symbol: StatusSymbol[Status.OUTDATED],
    description: StatusDescription[Status.OUTDATED]
  };
}

/**
 * Gets status for any user-facing component
 * @param {Object} component - Component object
 * @returns {Promise<Object>}
 */
async function getComponentStatus(component) {
  if (component.type === ComponentType.FILE_BASED) {
    return getFileBasedStatus(component);
  }

  if (component.category === 'hooks') {
    return getHookStatus(component);
  }

  return getFileBasedStatus(component);
}

/**
 * Adds status info to all components
 * @param {Object} components - Components from detector
 * @returns {Promise<Object>}
 */
async function addStatusToComponents(components) {
  const result = {};

  for (const [category, items] of Object.entries(components)) {
    result[category] = [];
    for (const component of items) {
      const statusInfo = await getComponentStatus(component);
      result[category].push({ ...component, ...statusInfo });
    }
  }

  return result;
}

/**
 * Formats a component for display in the selection list
 * Includes inline dependency hints for skills with manifests
 * @param {Object} component - Component with status
 * @returns {string}
 */
function formatComponentDisplay(component) {
  const name = chalk.white(component.name.padEnd(25));
  let display = `${component.symbol} ${name} ${component.description}`;

  if (component.manifest) {
    const deps = [];
    if (component.manifest.mcpServers?.length) {
      deps.push(...component.manifest.mcpServers.map(s => `mcp: ${s}`));
    }
    if (component.manifest.agent) {
      deps.push(`agent: ${component.manifest.agent}`);
    }
    if (component.manifest.skills?.length) {
      deps.push(...component.manifest.skills.map(s => `skill: ${s}`));
    }
    if (deps.length > 0) {
      display += chalk.dim(` → ${deps.join(', ')}`);
    }
  }

  return display;
}

module.exports = {
  getComponentStatus,
  getFileBasedStatus,
  getHookStatus,
  addStatusToComponents,
  formatComponentDisplay,
  Status,
  StatusSymbol,
  StatusDescription
};
