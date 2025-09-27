# rules4code

A clever CLI tool to sync configuration files, rules, and AI agent instructions across your projects using simple plain text files.

## Philosophy

Keep your configuration wisdom in one place and distribute it effortlessly. No complex mappings needed - the directory structure IS the configuration map.

## Features

- 🎯 **Zero-config approach** - File paths in `/rules` mirror installation paths
- 📁 **Category-based navigation** - Organized by tool (.claude, .cursor, .eslintrc, etc.)
- ✅ **Smart preselection** - Already installed files are pre-selected
- ⚠️ **Conflict detection** - Clear warnings for files with different content
- 🔄 **Safe backups** - Existing files backed up as `.local` before overwrite

## Installation

### Global installation (recommended):

```bash
npm install -g .
```

### Run directly with npx (when published):

```bash
npx rules4code
```

### Local development:

```bash
npm install
node cli.js
```

## Usage

Navigate to any project directory and run:

```bash
rules4code
# or use the short alias
r4c
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

Categories are automatically derived from top-level folder names:

- `.claude/` → "Claude" category
- `.cursor/` → "Cursor" category
- `.eslintrc.d/` → "Eslintrc.d" category
- `.vscode/` → "Vscode" category

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
- **ESC** - Go back to previous menu (category selection)
- **'a'** - Toggle all files in category

## Status Indicators

- **Pre-selected** - Files already installed and synced
- **Not selected** - Files not installed or different from repo
- **⚠️ warning** - Existing file with different content (will be backed up)

## Git Workflow

1. Store this repo on GitHub
2. Add/modify rules in the `/rules` directory
3. Commit and push changes
4. In any project, run `rules4code` (or `r4c`) to sync latest configurations

## Examples

### Claude Code Setup

```
rules/.claude/
├── agents/
│   ├── code-reviewer.md
│   ├── junior-engineer.md
│   └── documentation-writer.md
└── rules/
    ├── coding-standards.md
    └── security-guidelines.md
```

### Multi-tool Configuration

```
rules/
├── .claude/agents/ai-helper.md
├── .cursor/rules/cursor-rules.txt
├── .eslintrc.d/strict-rules.json
├── .prettierrc.json
└── .vscode/settings.json
```

## Why rules4code?

- **Intuitive** - No learning curve, directory structure explains itself
- **Scalable** - Works with any tool that uses configuration files
- **Maintainable** - No mapping files to keep in sync
- **Discoverable** - Easy to see what configurations are available
- **Safe** - Always backs up existing files before changes

Perfect for teams sharing AI agent configurations, linting rules, IDE settings, and any other plain text configurations across projects.
