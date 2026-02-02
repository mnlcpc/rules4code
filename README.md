# Hands

A CLI tool to manage and distribute Claude Code components across projects.

## What It Does

Hands manages three types of components:

- **Skills** — Specialized instruction sets with optional dependency declarations
- **Agents** — Sub-agent definitions with specific personas and tool access
- **Hooks** — Event-triggered commands (notifications, linting, etc.)

Skills can declare dependencies on MCP servers, agents, and other skills. Hands automatically resolves and installs these dependencies.

## Installation

### Global (recommended):

```bash
npm install -g .
```

### Local development:

```bash
npm install
node cli.js
```

## Usage

Navigate to any project and run:

```bash
hands
```

The CLI will:

1. Show all available skills, agents, and hooks
2. Let you select what to install or remove
3. Resolve and install skill dependencies automatically
4. Detect already-installed components and offer updates

## Adding Components

### Skills

Create a directory under `rules/.claude/skills/<name>/` with a `SKILL.md` file:

```
rules/.claude/skills/my-skill/
  SKILL.md           # Skill instructions (required)
  manifest.json      # Dependency declarations (optional)
```

The `manifest.json` declares what the skill needs:

```json
{
  "description": "What the skill does",
  "agent": "agent-name",
  "mcpServers": ["server-name"],
  "tools": ["mcp__server__tool_name"],
  "skills": ["other-skill"]
}
```

All fields are optional. Skills without a manifest have no dependencies.

### Agents

Create `rules/.claude/agents/<name>.md`:

```markdown
---
name: My Agent
allowed-tools: mcp__server__*
---

Agent instructions here.
```

### Hooks

Create `rules/.claude/hooks/<name>.json`:

```json
{
  "Stop": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "command",
          "command": "say 'Task completed'"
        }
      ]
    }
  ]
}
```

### MCP Servers (dependency pool)

Create `rules/.claude/mcp-servers/<name>.json`:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${API_KEY}"
  }
}
```

MCP servers are not shown in the selection UI. They are automatically installed when a selected skill declares them as a dependency.

## Status Indicators

- `[✓]` Installed and up to date
- `[~]` Outdated (update available)
- `[ ]` Available (not installed)
- `⚠️`  Missing environment variables

## Dependency Resolution

When you select a skill that has a `manifest.json`:

1. Required MCP servers are queued for installation
2. Required agents are auto-selected
3. Required skills are auto-selected (recursive)
4. You're shown a summary and asked to confirm
5. Everything is installed together

When you deselect a skill, orphaned dependencies are identified and you're asked whether to remove them.

## Navigation

- **Arrow keys** — Navigate options
- **Space** — Toggle selection
- **Enter** — Confirm

## Git Workflow

1. Store this repo on GitHub
2. Add or modify components in `rules/.claude/`
3. Commit and push
4. In any project, run `hands` to sync
