# rules4code

A CLI tool to download and install configuration files, rules, and AI agent instructions across projects.

## Philosophy

Keep your configuration wisdom in one place and distribute it effortlessly. No complex mappings needed, the directory structure IS the configuration map.

## Features

- 🎯 **Zero-config approach** - File paths in `/rules` mirror installation paths
- 📁 **Category-based navigation** - Organized by tool (.claude, .cursor, .eslintrc, etc.)
- ✅ **Smart preselection** - Already installed files are pre-selected
- ⚠️ **Conflict detection** - Clear warnings for files with different content
- 🔄 **Safe backups** - Existing files backed up as `.local` before overwrite

## Installation

### Local development:

```bash
npm install
node cli.js
```

### Global installation (recommended):

```bash
npm install -g .
```

## Usage

Navigate to any project directory and run:

```bash
rules4code
# or use the short alias
r4c
```

### Or run directly with npx (⚠️ YET TO BE PUBLISHED):

```bash
npx rules4code
```

The CLI will:

1. Show categories of available configurations
2. Let you select a category (Claude, Cursor, ESLint, etc.)
3. Show files with status indicators and smart preselection
4. Install selected files with conflict handling

## How It Works

### Simple Structure = Simple Config

Instead of maintaining mapping files, the directory structure in `/rules` directly mirrors where files should be installed

### Categories Auto-Detected

Categories are automatically derived from top-level folder names

## Adding New Rules

### For Claude Code agents:

1. Create `rules/.claude/agents/my-agent.md`
2. Write your agent instructions
3. Run `rules4code` (or `r4c`) in any project to install

### For ESLint configurations:

1. Create `rules/.eslintrc.d/my-rules.json`
2. Add your ESLint rules
3. Install with `rules4code` (or `r4c`)

### For any tool:

1. Create the exact directory structure in `rules/`
2. Add your configuration files
3. They'll appear in the appropriate category automatically

## Navigation

- **Arrow keys** - Navigate options
- **Space** - Toggle file selection
- **Enter** - Confirm selection
- **'a'** - Toggle all files in category

## Status Indicators

- **Not selected** - Files not installed or different from repo
- **Pre-selected** - Files already installed and synced
- **⚠️ warning** - Existing file with different content (will be backed up)

## Git Workflow

1. Store this repo on GitHub
2. Add/modify rules in the `/rules` directory
3. Commit and push changes
4. In any project, run `rules4code` (or `r4c`) to sync latest configurations
