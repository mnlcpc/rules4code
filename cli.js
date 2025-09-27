#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const inquirer = require('inquirer');
const chalk = require('chalk');

class RulesSync {
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

  async scanRules() {
    const rules = [];

    async function scanDirectory(dirPath, relativePath = '') {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          // Get category from top-level folder
          const parts = relPath.split(path.sep);
          const category = parts[0].startsWith('.')
            ? parts[0].slice(1) // Remove dot from .claude, .cursor etc
            : parts[0];

          rules.push({
            key: path.basename(entry.name, path.extname(entry.name)),
            source: fullPath,
            target: relPath,
            category: category.charAt(0).toUpperCase() + category.slice(1),
            description: `${category} configuration file`
          });
        }
      }
    }

    await scanDirectory(this.rulesPath);
    return rules;
  }

  async getFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return crypto.createHash('md5').update(content).digest('hex');
    } catch {
      return null;
    }
  }

  async getFileStatus(rule) {
    const sourcePath = rule.source;
    const targetPath = path.resolve(rule.target);

    const sourceExists = await fs.pathExists(sourcePath);
    const targetExists = await fs.pathExists(targetPath);

    if (!sourceExists) {
      return { status: 'missing-source', symbol: '[missing]' };
    }

    if (!targetExists) {
      return { status: 'not-installed', symbol: '[not installed]' };
    }

    const sourceHash = await this.getFileHash(sourcePath);
    const targetHash = await this.getFileHash(targetPath);

    if (sourceHash === targetHash) {
      return { status: 'synced', symbol: '[synced]' };
    } else {
      return { status: 'different', symbol: '[different]' };
    }
  }

  async listFiles() {
    console.log(chalk.bold.blue('\nAvailable Configuration Files:\n'));

    const fileStatuses = [];

    for (const [key, fileConfig] of Object.entries(this.config.files)) {
      const status = await this.getFileStatus(key, fileConfig);
      fileStatuses.push({ key, fileConfig, ...status });
    }

    // Group by category
    const categories = {};
    fileStatuses.forEach(item => {
      const category = item.fileConfig.category || 'Other';
      if (!categories[category]) categories[category] = [];
      categories[category].push(item);
    });

    // Display grouped by category
    for (const [category, files] of Object.entries(categories)) {
      console.log(chalk.bold.cyan(`${category}:`));
      files.forEach(({ key, status }) => {
        console.log(`  ${status.symbol} ${key}`);
      });
      console.log();
    }

    return fileStatuses;
  }

  async installFile(rule, force = false) {
    const sourcePath = rule.source;
    const targetPath = path.resolve(rule.target);

    if (!await fs.pathExists(sourcePath)) {
      console.log(chalk.red(`Source file not found: ${sourcePath}`));
      return false;
    }

    const targetExists = await fs.pathExists(targetPath);

    if (targetExists && !force) {
      const sourceHash = await this.getFileHash(sourcePath);
      const targetHash = await this.getFileHash(targetPath);

      if (sourceHash !== targetHash) {
        const backupPath = `${targetPath}.local`;
        await fs.copy(targetPath, backupPath);
        console.log(chalk.yellow(`Backed up existing file to: ${backupPath}`));
      }
    }

    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(sourcePath, targetPath);
    console.log(chalk.green(`Installed: ${rule.key} → ${targetPath}`));
    return true;
  }

  async run() {
    await this.init();

    console.log(chalk.bold.green('Rules Sync CLI'));

    // Scan rules directory
    const rules = await this.scanRules();

    // Build file statuses
    const fileStatuses = [];
    for (const rule of rules) {
      const status = await this.getFileStatus(rule);
      fileStatuses.push({ ...rule, ...status });
    }

    // Group by category
    const categories = {};
    fileStatuses.forEach(item => {
      const category = item.category || 'Other';
      if (!categories[category]) categories[category] = [];
      categories[category].push(item);
    });

    // Main navigation loop
    while (true) {
      // Ask user to select category
      let categoryResponse;
      try {
        categoryResponse = await inquirer.prompt({
          type: 'list',
          name: 'category',
          message: 'Select configuration category:',
          choices: Object.keys(categories)
        });
      } catch (error) {
        // User pressed ESC at category level, exit completely
        console.log(chalk.yellow('\nExiting.'));
        return;
      }

      if (!categoryResponse.category) {
        console.log(chalk.yellow('Exiting.'));
        return;
      }

      // Show files from selected category only
      const categoryFiles = categories[categoryResponse.category];
      const choices = categoryFiles.map((rule) => ({
        name: rule.status === 'different'
          ? `${rule.key} ⚠️ existing file with different content`
          : rule.key,
        value: rule.key,
        checked: rule.status === 'synced'  // Pre-select synced files
      }));

      let response;
      let goBack = false;

      // Set up SIGINT handler for this prompt
      const sigintHandler = () => {
        goBack = true;
        process.stdin.emit('keypress', null, { name: 'return' });
      };

      process.once('SIGINT', sigintHandler);

      try {
        response = await inquirer.prompt({
          type: 'checkbox',
          name: 'files',
          message: `Select ${categoryResponse.category} files to install/update (ESC to go back):`,
          choices
        });
      } finally {
        process.removeListener('SIGINT', sigintHandler);
      }

      if (goBack) {
        continue;
      }

      if (response.files.length === 0) {
        console.log(chalk.yellow('No files selected.'));
        continue;
      }

      console.log(chalk.bold.blue('\nInstalling selected files...\n'));

      for (const key of response.files) {
        const rule = categoryFiles.find(r => r.key === key);
        await this.installFile(rule);
      }

      console.log(chalk.bold.green('\nInstallation complete!'));

      // Ask if user wants to continue with another category
      const continueResponse = await inquirer.prompt({
        type: 'confirm',
        name: 'continue',
        message: 'Configure another category?',
        default: false
      });

      if (!continueResponse.continue) {
        return;
      }
    }
  }
}

// Run the CLI
if (require.main === module) {
  const rulesSync = new RulesSync();
  rulesSync.run().catch(error => {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  });
}

module.exports = RulesSync;