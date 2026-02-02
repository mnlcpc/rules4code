const fs = require('fs-extra');
const path = require('path');

const ComponentType = {
  FILE_BASED: 'FILE_BASED',
  JSON_ENTRY: 'JSON_ENTRY'
};

const Category = {
  SKILLS: 'skills',
  AGENTS: 'agents',
  HOOKS: 'hooks'
};

/**
 * Detects all user-facing components in the rules directory
 * @param {string} rulesPath - Path to the rules directory
 * @returns {Promise<{skills: Object[], agents: Object[], hooks: Object[]}>}
 */
async function detectComponents(rulesPath) {
  const components = {
    skills: [],
    agents: [],
    hooks: []
  };

  const claudePath = path.join(rulesPath, '.claude');
  if (!await fs.pathExists(claudePath)) {
    return components;
  }

  await Promise.all([
    detectSkills(claudePath, components),
    detectAgents(claudePath, components),
    detectHooks(claudePath, components)
  ]);

  return components;
}

/**
 * Detects skills: rules/.claude/skills/<name>/SKILL.md
 */
async function detectSkills(claudePath, components) {
  const skillsPath = path.join(claudePath, 'skills');
  if (!await fs.pathExists(skillsPath)) return;

  const entries = await fs.readdir(skillsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(skillsPath, entry.name, 'SKILL.md');
    if (!await fs.pathExists(skillFile)) continue;

    let manifest = null;
    const manifestPath = path.join(skillsPath, entry.name, 'manifest.json');
    if (await fs.pathExists(manifestPath)) {
      try {
        manifest = await fs.readJson(manifestPath);
      } catch {
        // Invalid manifest JSON, continue without it
      }
    }

    components.skills.push({
      name: entry.name,
      type: ComponentType.FILE_BASED,
      category: Category.SKILLS,
      sourcePath: path.join(skillsPath, entry.name),
      targetPath: path.join('.claude', 'skills', entry.name),
      files: await getDirectoryFiles(path.join(skillsPath, entry.name)),
      manifest
    });
  }
}

/**
 * Detects agents: rules/.claude/agents/<name>.md
 */
async function detectAgents(claudePath, components) {
  const agentsPath = path.join(claudePath, 'agents');
  if (!await fs.pathExists(agentsPath)) return;

  const entries = await fs.readdir(agentsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    components.agents.push({
      name: path.basename(entry.name, '.md'),
      type: ComponentType.FILE_BASED,
      category: Category.AGENTS,
      sourcePath: path.join(agentsPath, entry.name),
      targetPath: path.join('.claude', 'agents', entry.name)
    });
  }
}

/**
 * Detects hooks: rules/.claude/hooks/<name>.json
 */
async function detectHooks(claudePath, components) {
  const hooksPath = path.join(claudePath, 'hooks');
  if (!await fs.pathExists(hooksPath)) return;

  const entries = await fs.readdir(hooksPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const sourcePath = path.join(hooksPath, entry.name);
    let config;
    try {
      config = await fs.readJson(sourcePath);
    } catch {
      continue;
    }

    components.hooks.push({
      name: path.basename(entry.name, '.json'),
      type: ComponentType.JSON_ENTRY,
      category: Category.HOOKS,
      sourcePath,
      targetFile: path.join('.claude', 'settings.json'),
      targetKey: 'hooks',
      config
    });
  }
}

/**
 * Detects the dependency pool (MCP servers available for skills to reference)
 * @param {string} rulesPath - Path to the rules directory
 * @returns {Promise<{mcpServers: Object[]}>}
 */
async function detectDependencyPool(rulesPath) {
  const pool = { mcpServers: [] };

  const mcpPath = path.join(rulesPath, '.claude', 'mcp-servers');
  if (!await fs.pathExists(mcpPath)) return pool;

  const entries = await fs.readdir(mcpPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const sourcePath = path.join(mcpPath, entry.name);
    let config;
    try {
      config = await fs.readJson(sourcePath);
    } catch {
      continue;
    }

    pool.mcpServers.push({
      name: path.basename(entry.name, '.json'),
      type: ComponentType.JSON_ENTRY,
      category: 'mcpServers',
      sourcePath,
      targetFile: path.join('.claude', 'config.json'),
      config
    });
  }

  return pool;
}

/**
 * Gets all files in a directory recursively
 * @param {string} dirPath - Directory path
 * @returns {Promise<string[]>} - Array of relative file paths
 */
async function getDirectoryFiles(dirPath) {
  const files = [];

  async function scan(currentPath, relativePath = '') {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, relPath);
      } else {
        files.push(relPath);
      }
    }
  }

  await scan(dirPath);
  return files;
}

/**
 * Gets a flat list of all user-facing components
 * @param {Object} components - Components from detectComponents
 * @returns {Object[]}
 */
function getAllComponents(components) {
  return [
    ...components.skills,
    ...components.agents,
    ...components.hooks
  ];
}

module.exports = {
  detectComponents,
  detectDependencyPool,
  getAllComponents,
  getDirectoryFiles,
  ComponentType,
  Category
};
