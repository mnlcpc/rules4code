const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const METADATA_FILE = '.hands-meta.json';
const VERSION = '3.0.0';

/**
 * Gets the path to the metadata file
 * @param {string} targetDir - Target directory (usually .claude)
 * @returns {string}
 */
function getMetadataPath(targetDir = '.claude') {
  return path.resolve(targetDir, METADATA_FILE);
}

/**
 * Creates an empty metadata structure
 * @returns {Object}
 */
function createEmptyMetadata() {
  return {
    version: VERSION,
    installedBy: 'hands',
    components: {
      skills: {},
      agents: {},
      hooks: {}
    },
    resolvedDeps: {
      mcpServers: {},
      agents: {},
      skills: {}
    }
  };
}

/**
 * Reads the metadata file, merging with defaults for missing fields
 * @param {string} targetDir - Target directory
 * @returns {Promise<Object>}
 */
async function readMetadata(targetDir = '.claude') {
  const metaPath = getMetadataPath(targetDir);

  try {
    if (await fs.pathExists(metaPath)) {
      const data = await fs.readJson(metaPath);
      const empty = createEmptyMetadata();

      return {
        ...empty,
        ...data,
        components: {
          ...empty.components,
          ...(data.components ?? {})
        },
        resolvedDeps: {
          ...empty.resolvedDeps,
          ...(data.resolvedDeps ?? {})
        }
      };
    }
  } catch {
    // Corrupted file, return empty
  }

  return createEmptyMetadata();
}

/**
 * Writes the metadata file
 * @param {Object} metadata - Metadata to write
 * @param {string} targetDir - Target directory
 * @returns {Promise<void>}
 */
async function writeMetadata(metadata, targetDir = '.claude') {
  const metaPath = getMetadataPath(targetDir);
  await fs.ensureDir(path.dirname(metaPath));
  await fs.writeJson(metaPath, metadata, { spaces: 2 });
}

/**
 * Computes an MD5 hash for content
 * @param {any} content - String or object to hash
 * @returns {string}
 */
function computeHash(content) {
  const data = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Computes a hash for a file's contents
 * @param {string} filePath - Path to file
 * @returns {Promise<string|null>}
 */
async function computeFileHash(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return computeHash(content);
  } catch {
    return null;
  }
}

/**
 * Computes a hash for a directory by hashing all files (sorted, excluding manifest.json)
 * @param {string} dirPath - Path to directory
 * @returns {Promise<string|null>}
 */
async function computeDirectoryHash(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      return computeFileHash(dirPath);
    }

    const files = [];
    async function scan(currentPath, relativePath = '') {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'manifest.json') continue;
        const fullPath = path.join(currentPath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath, relPath);
        } else {
          files.push({ relPath, fullPath });
        }
      }
    }

    await scan(dirPath);
    files.sort((a, b) => a.relPath.localeCompare(b.relPath));

    const hash = crypto.createHash('md5');
    for (const file of files) {
      const content = await fs.readFile(file.fullPath, 'utf8');
      hash.update(file.relPath + '\0' + content);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

// --- User-selected component tracking ---

/**
 * Records a user-selected component as installed
 * @param {Object} component - Component with { category, name, sourcePath }
 * @param {string} hash - Content hash
 * @param {string} targetDir - Target directory
 * @returns {Promise<void>}
 */
async function trackInstall(component, hash, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);
  const { category, name, sourcePath } = component;

  if (!metadata.components[category]) {
    metadata.components[category] = {};
  }

  metadata.components[category][name] = {
    hash,
    installedAt: new Date().toISOString(),
    sourcePath
  };

  await writeMetadata(metadata, targetDir);
}

/**
 * Records a user-selected component as uninstalled
 * @param {Object} component - Component with { category, name }
 * @param {string} targetDir - Target directory
 * @returns {Promise<void>}
 */
async function trackUninstall(component, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);
  const { category, name } = component;

  if (metadata.components[category]) {
    delete metadata.components[category][name];
  }

  await writeMetadata(metadata, targetDir);
}

// --- Resolved dependency tracking ---

/**
 * Records a resolved dependency as installed
 * @param {string} category - 'mcpServers' | 'agents' | 'skills'
 * @param {string} name - Dependency name
 * @param {string} hash - Content hash
 * @param {string} sourcePath - Source file path
 * @param {string[]} requiredBy - Skill names that require this dependency
 * @param {string} targetDir - Target directory
 * @returns {Promise<void>}
 */
async function trackDependency(category, name, hash, sourcePath, requiredBy, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);

  if (!metadata.resolvedDeps[category]) {
    metadata.resolvedDeps[category] = {};
  }

  const existing = metadata.resolvedDeps[category][name];
  const existingRequiredBy = existing?.requiredBy ?? [];

  metadata.resolvedDeps[category][name] = {
    hash,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    sourcePath,
    requiredBy: [...new Set([...existingRequiredBy, ...requiredBy])]
  };

  await writeMetadata(metadata, targetDir);
}

/**
 * Removes a resolved dependency from tracking
 * @param {string} category - 'mcpServers' | 'agents' | 'skills'
 * @param {string} name - Dependency name
 * @param {string} targetDir - Target directory
 * @returns {Promise<void>}
 */
async function removeDependency(category, name, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);

  if (metadata.resolvedDeps[category]) {
    delete metadata.resolvedDeps[category][name];
  }

  await writeMetadata(metadata, targetDir);
}

// --- Query functions ---

/**
 * Gets tracked info for a component (checks both components and resolvedDeps)
 * @param {Object} component - Component with { category, name }
 * @param {string} targetDir - Target directory
 * @returns {Promise<Object|null>}
 */
async function getTrackedInfo(component, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);
  const { category, name } = component;

  return metadata.components[category]?.[name]
    ?? metadata.resolvedDeps[category]?.[name]
    ?? null;
}

/**
 * Gets all tracked user-selected components for a category
 * @param {string} category - Category name
 * @param {string} targetDir - Target directory
 * @returns {Promise<Object>}
 */
async function getTrackedComponents(category, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);
  return metadata.components[category] ?? {};
}

/**
 * Gets all tracked resolved dependencies for a category
 * @param {string} category - Category name
 * @param {string} targetDir - Target directory
 * @returns {Promise<Object>}
 */
async function getTrackedDependencies(category, targetDir = '.claude') {
  const metadata = await readMetadata(targetDir);
  return metadata.resolvedDeps[category] ?? {};
}

/**
 * Checks if a component is tracked (in either components or resolvedDeps)
 * @param {Object} component - Component with { category, name }
 * @param {string} targetDir - Target directory
 * @returns {Promise<boolean>}
 */
async function isTracked(component, targetDir = '.claude') {
  return (await getTrackedInfo(component, targetDir)) !== null;
}

module.exports = {
  readMetadata,
  writeMetadata,
  trackInstall,
  trackUninstall,
  trackDependency,
  removeDependency,
  getTrackedInfo,
  getTrackedComponents,
  getTrackedDependencies,
  isTracked,
  computeHash,
  computeFileHash,
  computeDirectoryHash,
  getMetadataPath,
  createEmptyMetadata,
  METADATA_FILE,
  VERSION
};
