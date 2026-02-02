#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');

const { detectComponents, detectDependencyPool, getAllComponents } = require('./lib/detector');
const { addStatusToComponents, formatComponentDisplay, Status } = require('./lib/status');
const { validateComponentEnvVars, formatEnvWarning } = require('./lib/env-validator');
const { resolveDependencies, findOrphans } = require('./lib/resolver');
const { addMcpServer, removeMcpServer, syncHooks } = require('./lib/merger');
const tracker = require('./lib/tracker');

class Hands {
  constructor() {
    this.rulesPath = path.join(__dirname, 'rules');
  }

  async init() {
    try {
      await fs.ensureDir(this.rulesPath);
    } catch (error) {
      console.error(chalk.red('Error accessing rules directory:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Copies a FILE_BASED component to the target project.
   * Does NOT track — caller is responsible for tracking.
   * @param {Object} component - Component to install
   * @returns {Promise<boolean>}
   */
  async installFileComponent(component) {
    const { sourcePath } = component;
    const targetPath = path.resolve(component.targetPath);

    if (!await fs.pathExists(sourcePath)) {
      console.log(chalk.red(`  Source not found: ${sourcePath}`));
      return false;
    }

    // Backup existing file if content differs
    if (await fs.pathExists(targetPath)) {
      const sourceHash = await tracker.computeFileHash(sourcePath);
      const targetHash = await tracker.computeFileHash(targetPath);

      if (sourceHash !== targetHash) {
        const backupPath = `${targetPath}.local`;
        await fs.copy(targetPath, backupPath);
        console.log(chalk.yellow(`  Backed up existing to: ${path.basename(backupPath)}`));
      }
    }

    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(sourcePath, targetPath, {
      filter: (src) => path.basename(src) !== 'manifest.json'
    });
    return true;
  }

  /**
   * Removes a FILE_BASED component from the target project.
   * Does NOT track — caller is responsible for tracking.
   * @param {Object} component - Component to remove
   * @returns {Promise<boolean>}
   */
  async uninstallFileComponent(component) {
    const targetPath = path.resolve(component.targetPath);
    if (await fs.pathExists(targetPath)) {
      await fs.remove(targetPath);
    }
    return true;
  }

  /**
   * Displays the component selection UI (skills, agents, hooks)
   * @param {Object} componentsWithStatus - Components with status info
   * @returns {Promise<Object[]>} - Selected components
   */
  async displayComponentUI(componentsWithStatus) {
    const categories = [
      { key: 'skills', label: 'Skills', icon: '📦' },
      { key: 'agents', label: 'Agents', icon: '🤖' },
      { key: 'hooks', label: 'Hooks', icon: '🔗' }
    ];

    const choices = [];

    for (const cat of categories) {
      const items = componentsWithStatus[cat.key] || [];
      if (items.length === 0) continue;

      choices.push(new inquirer.Separator(chalk.bold.cyan(`\n${cat.icon} ${cat.label}:`)));

      for (const item of items) {
        const displayName = formatComponentDisplay(item);
        const shouldBeChecked = item.status === Status.INSTALLED || item.status === Status.OUTDATED;

        choices.push({
          name: displayName,
          value: item,
          checked: shouldBeChecked
        });
      }
    }

    if (choices.length === 0) {
      console.log(chalk.yellow('\nNo components found in rules directory.'));
      console.log(chalk.dim('Add components to rules/.claude/ to get started.'));
      return [];
    }

    const response = await inquirer.prompt({
      type: 'checkbox',
      name: 'selected',
      message: 'Toggle components to install/remove:',
      choices,
      pageSize: 20,
      loop: false
    });

    return response.selected;
  }

  /**
   * Processes user selection: resolves dependencies, syncs everything
   * @param {Object[]} selectedComponents - User-selected components
   * @param {Object} allComponents - All components with status
   * @param {Object} dependencyPool - { mcpServers: [...] }
   * @returns {Promise<Object>} - { installed, updated, removed, depsAdded, depsRemoved }
   */
  async syncComponents(selectedComponents, allComponents, dependencyPool) {
    // Categorize user selections
    const selected = { skills: [], agents: [], hooks: [] };
    for (const comp of selectedComponents) {
      if (selected[comp.category]) {
        selected[comp.category].push(comp);
      }
    }

    const results = {
      installed: [],
      updated: [],
      removed: [],
      depsAdded: [],
      depsRemoved: []
    };

    // --- Resolve dependencies ---
    const resolution = resolveDependencies({
      selectedSkills: selected.skills,
      allSkills: allComponents.skills,
      selectedAgents: selected.agents,
      allAgents: allComponents.agents,
      dependencyPool
    });

    // Handle circular dependency errors
    if (resolution.errors.length > 0) {
      for (const error of resolution.errors) {
        console.log(chalk.red(`  Error: ${error}`));
      }
      console.log(chalk.red('\nAborting due to dependency errors.'));
      return results;
    }

    // Show warnings
    for (const warning of resolution.warnings) {
      console.log(chalk.yellow(`  Warning: ${warning}`));
    }

    // --- Confirm and install dependencies ---
    const hasDeps = resolution.mcpServers.length > 0
      || resolution.agents.length > 0
      || resolution.skills.length > 0;

    if (hasDeps) {
      console.log(chalk.bold.blue('\nDependencies required:'));

      for (const dep of resolution.mcpServers) {
        console.log(chalk.dim(`  MCP: ${dep.name} (required by: ${dep.requiredBy.join(', ')})`));
      }
      for (const dep of resolution.agents) {
        console.log(chalk.dim(`  Agent: ${dep.name} (required by: ${dep.requiredBy.join(', ')})`));
      }
      for (const dep of resolution.skills) {
        console.log(chalk.dim(`  Skill: ${dep.name} (required by: ${dep.requiredBy.join(', ')})`));
      }

      // Validate env vars for MCP server deps
      let envIssues = false;
      for (const mcpDep of resolution.mcpServers) {
        const validation = validateComponentEnvVars(mcpDep);
        if (!validation.isValid) {
          console.log(formatEnvWarning(validation.missingVars, mcpDep.name));
          envIssues = true;
        }
      }

      const { proceed } = await inquirer.prompt({
        type: 'confirm',
        name: 'proceed',
        message: envIssues
          ? 'Install dependencies anyway? (some env vars are missing)'
          : 'Install dependencies?',
        default: !envIssues
      });

      if (proceed) {
        await this.installDependencies(resolution, results);
      }
    }

    // --- Install/remove auto-resolved skill dependencies ---
    for (const depSkill of resolution.skills) {
      if (await this.installFileComponent(depSkill)) {
        const hash = await tracker.computeDirectoryHash(depSkill.sourcePath);
        await tracker.trackDependency('skills', depSkill.name, hash, depSkill.sourcePath, depSkill.requiredBy);
        results.depsAdded.push(`${depSkill.name} (skill)`);
      }
    }

    // --- Sync user-selected FILE_BASED components (skills, agents) ---
    for (const category of ['skills', 'agents']) {
      const selectedNames = new Set(selected[category].map(c => c.name));
      const allInCategory = allComponents[category] || [];

      // Install selected
      for (const comp of selected[category]) {
        if (comp.status === Status.AVAILABLE || comp.status === Status.OUTDATED) {
          if (await this.installFileComponent(comp)) {
            const hashFn = comp.category === 'skills'
              ? tracker.computeDirectoryHash
              : tracker.computeFileHash;
            const hash = await hashFn(comp.sourcePath);
            await tracker.trackInstall(comp, hash);
            results[comp.status === Status.AVAILABLE ? 'installed' : 'updated'].push(comp.name);
          }
        }
      }

      // Remove unselected that were previously installed
      for (const comp of allInCategory) {
        if (!selectedNames.has(comp.name)
          && (comp.status === Status.INSTALLED || comp.status === Status.OUTDATED)) {
          await this.uninstallFileComponent(comp);
          await tracker.trackUninstall(comp);
          results.removed.push(comp.name);
        }
      }
    }

    // --- Sync hooks ---
    if (allComponents.hooks?.length > 0) {
      // Validate env vars for selected hooks
      for (const hook of [...selected.hooks]) {
        const validation = validateComponentEnvVars(hook);
        if (!validation.isValid) {
          console.log(formatEnvWarning(validation.missingVars, hook.name));
          const { proceed } = await inquirer.prompt({
            type: 'confirm',
            name: 'proceed',
            message: `Install ${hook.name} anyway?`,
            default: false
          });
          if (!proceed) {
            selected.hooks = selected.hooks.filter(h => h.name !== hook.name);
          }
        }
      }

      const trackedHooks = await tracker.getTrackedComponents('hooks');
      const hookResult = await syncHooks('.claude/settings.json', selected.hooks, trackedHooks);

      results.installed.push(...hookResult.added);
      results.updated.push(...hookResult.updated);
      results.removed.push(...hookResult.removed);
    }

    // --- Orphan cleanup ---
    await this.cleanupOrphans(selected.skills, results);

    return results;
  }

  /**
   * Installs resolved MCP server and agent dependencies
   */
  async installDependencies(resolution, results) {
    // Install MCP server dependencies
    for (const mcpDep of resolution.mcpServers) {
      await addMcpServer(mcpDep.targetFile, mcpDep.name, mcpDep.config);
      const hash = tracker.computeHash(mcpDep.config);
      await tracker.trackDependency('mcpServers', mcpDep.name, hash, mcpDep.sourcePath, mcpDep.requiredBy);
      results.depsAdded.push(`${mcpDep.name} (mcp)`);
      console.log(chalk.green(`  Installed dependency: ${mcpDep.name} (MCP)`));
    }

    // Install agent dependencies
    for (const agentDep of resolution.agents) {
      if (await this.installFileComponent(agentDep)) {
        const hash = await tracker.computeFileHash(agentDep.sourcePath);
        await tracker.trackDependency('agents', agentDep.name, hash, agentDep.sourcePath, agentDep.requiredBy);
        results.depsAdded.push(`${agentDep.name} (agent)`);
        console.log(chalk.green(`  Installed dependency: ${agentDep.name} (agent)`));
      }
    }
  }

  /**
   * Checks for and removes orphaned dependencies
   */
  async cleanupOrphans(selectedSkills, results) {
    const metadata = await tracker.readMetadata();
    const currentSkillNames = new Set(selectedSkills.map(s => s.name));

    // Also include auto-resolved skill deps that are still needed
    const resolvedSkillDeps = metadata.resolvedDeps?.skills ?? {};
    for (const [name, info] of Object.entries(resolvedSkillDeps)) {
      const stillNeeded = (info.requiredBy ?? []).some(s => currentSkillNames.has(s));
      if (stillNeeded) currentSkillNames.add(name);
    }

    const orphans = findOrphans(metadata, currentSkillNames);

    // Clean up orphaned MCP servers
    for (const orphan of orphans.mcpServers) {
      const { proceed } = await inquirer.prompt({
        type: 'confirm',
        name: 'proceed',
        message: `MCP server "${orphan.name}" is no longer needed. Remove?`,
        default: true
      });
      if (proceed) {
        await removeMcpServer('.claude/config.json', orphan.name);
        await tracker.removeDependency('mcpServers', orphan.name);
        results.depsRemoved.push(`${orphan.name} (mcp)`);
        console.log(chalk.yellow(`  Removed dependency: ${orphan.name} (MCP)`));
      }
    }

    // Clean up orphaned agents
    for (const orphan of orphans.agents) {
      const { proceed } = await inquirer.prompt({
        type: 'confirm',
        name: 'proceed',
        message: `Agent "${orphan.name}" is no longer needed as a dependency. Remove?`,
        default: true
      });
      if (proceed) {
        const targetPath = path.resolve('.claude', 'agents', `${orphan.name}.md`);
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
        }
        await tracker.removeDependency('agents', orphan.name);
        results.depsRemoved.push(`${orphan.name} (agent)`);
        console.log(chalk.yellow(`  Removed dependency: ${orphan.name} (agent)`));
      }
    }

    // Clean up orphaned skills
    for (const orphan of orphans.skills) {
      const { proceed } = await inquirer.prompt({
        type: 'confirm',
        name: 'proceed',
        message: `Skill "${orphan.name}" is no longer needed as a dependency. Remove?`,
        default: true
      });
      if (proceed) {
        const targetPath = path.resolve('.claude', 'skills', orphan.name);
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
        }
        await tracker.removeDependency('skills', orphan.name);
        results.depsRemoved.push(`${orphan.name} (skill)`);
        console.log(chalk.yellow(`  Removed dependency: ${orphan.name} (skill)`));
      }
    }
  }

  /**
   * Main entry point
   */
  async run() {
    await this.init();

    console.log(chalk.bold.green('\n🤲 Hands v3.0\n'));

    // Detect components and dependency pool
    const [components, dependencyPool] = await Promise.all([
      detectComponents(this.rulesPath),
      detectDependencyPool(this.rulesPath)
    ]);

    const allComponents = getAllComponents(components);
    if (allComponents.length === 0) {
      console.log(chalk.yellow('No components found in rules directory.'));
      console.log(chalk.dim('\nExpected structure:'));
      console.log(chalk.dim('  rules/.claude/skills/<name>/SKILL.md'));
      console.log(chalk.dim('  rules/.claude/agents/<name>.md'));
      console.log(chalk.dim('  rules/.claude/hooks/<name>.json'));
      console.log(chalk.dim('  rules/.claude/mcp-servers/<name>.json  (dependency pool)'));
      return;
    }

    // Add status to all components
    const componentsWithStatus = await addStatusToComponents(components);

    // Display UI and get user selection
    const selectedComponents = await this.displayComponentUI(componentsWithStatus);

    // Sync
    console.log(chalk.bold.blue('\nSyncing components...\n'));
    const results = await this.syncComponents(selectedComponents, componentsWithStatus, dependencyPool);

    // Summary
    console.log('');
    if (results.installed.length > 0) {
      console.log(chalk.green(`✓ Installed: ${results.installed.join(', ')}`));
    }
    if (results.updated.length > 0) {
      console.log(chalk.yellow(`↻ Updated: ${results.updated.join(', ')}`));
    }
    if (results.removed.length > 0) {
      console.log(chalk.red(`✗ Removed: ${results.removed.join(', ')}`));
    }
    if (results.depsAdded.length > 0) {
      console.log(chalk.green(`⊕ Dependencies added: ${results.depsAdded.join(', ')}`));
    }
    if (results.depsRemoved.length > 0) {
      console.log(chalk.yellow(`⊖ Dependencies removed: ${results.depsRemoved.join(', ')}`));
    }

    const noChanges = results.installed.length === 0
      && results.updated.length === 0
      && results.removed.length === 0
      && results.depsAdded.length === 0
      && results.depsRemoved.length === 0;

    if (noChanges) {
      console.log(chalk.dim('No changes made.'));
    }

    console.log(chalk.bold.green('\nDone!'));
  }
}

if (require.main === module) {
  const hands = new Hands();
  hands.run().catch(error => {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  });
}

module.exports = Hands;
