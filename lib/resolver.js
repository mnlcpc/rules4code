/**
 * Dependency resolver for Hands components.
 *
 * Skills can declare dependencies on:
 *   - MCP servers (auto-installed from the dependency pool)
 *   - One agent (auto-selected if not already selected by user)
 *   - Other skills (recursive, with circular dependency detection)
 */

/**
 * Resolves all dependencies for a set of selected skills
 * @param {Object} params
 * @param {Object[]} params.selectedSkills - Skills the user explicitly selected
 * @param {Object[]} params.allSkills - All available skills
 * @param {Object[]} params.selectedAgents - Agents the user explicitly selected
 * @param {Object[]} params.allAgents - All available agents
 * @param {Object} params.dependencyPool - { mcpServers: [...] }
 * @returns {Object} - { mcpServers, agents, skills, errors, warnings }
 */
function resolveDependencies({ selectedSkills, allSkills, selectedAgents, allAgents, dependencyPool }) {
  const result = {
    mcpServers: [],
    agents: [],
    skills: [],
    errors: [],
    warnings: []
  };

  const mcpServerMap = new Map(dependencyPool.mcpServers.map(s => [s.name, s]));
  const agentMap = new Map(allAgents.map(a => [a.name, a]));
  const skillMap = new Map(allSkills.map(s => [s.name, s]));

  const userSelectedSkillNames = new Set(selectedSkills.map(s => s.name));
  const userSelectedAgentNames = new Set(selectedAgents.map(a => a.name));

  // Track resolved dependencies with their requiredBy sets
  const requiredMcpServers = new Map();
  const requiredAgents = new Map();
  const requiredSkills = new Map();

  const resolved = new Set();

  function resolveSkill(skill, chain = []) {
    if (resolved.has(skill.name)) return;

    // Circular dependency detection
    if (chain.includes(skill.name)) {
      result.errors.push(`Circular dependency: ${[...chain, skill.name].join(' → ')}`);
      return;
    }

    resolved.add(skill.name);
    const { manifest } = skill;
    if (!manifest) return;

    const currentChain = [...chain, skill.name];

    // Resolve MCP server dependencies
    if (Array.isArray(manifest.mcpServers)) {
      for (const serverName of manifest.mcpServers) {
        if (mcpServerMap.has(serverName)) {
          if (!requiredMcpServers.has(serverName)) {
            requiredMcpServers.set(serverName, new Set());
          }
          requiredMcpServers.get(serverName).add(skill.name);
        } else {
          result.warnings.push(
            `Skill "${skill.name}" requires MCP server "${serverName}" which is not in the dependency pool`
          );
        }
      }
    }

    // Resolve agent dependency (singular)
    if (manifest.agent) {
      const agentName = manifest.agent;
      if (agentMap.has(agentName)) {
        // Only track as auto-dependency if user didn't explicitly select it
        if (!userSelectedAgentNames.has(agentName)) {
          if (!requiredAgents.has(agentName)) {
            requiredAgents.set(agentName, new Set());
          }
          requiredAgents.get(agentName).add(skill.name);
        }
      } else {
        result.warnings.push(
          `Skill "${skill.name}" requires agent "${agentName}" which is not available`
        );
      }
    }

    // Resolve skill dependencies (recursive)
    if (Array.isArray(manifest.skills)) {
      for (const depName of manifest.skills) {
        if (skillMap.has(depName)) {
          if (!userSelectedSkillNames.has(depName)) {
            if (!requiredSkills.has(depName)) {
              requiredSkills.set(depName, new Set());
            }
            requiredSkills.get(depName).add(skill.name);
          }
          resolveSkill(skillMap.get(depName), currentChain);
        } else {
          result.warnings.push(
            `Skill "${skill.name}" requires skill "${depName}" which is not available`
          );
        }
      }
    }
  }

  // Resolve all user-selected skills
  for (const skill of selectedSkills) {
    resolveSkill(skill);
  }

  // Resolve transitive deps from auto-required skills
  for (const [, requiredBy] of requiredSkills) {
    const depSkill = skillMap.get([...requiredBy][0]);
    if (depSkill) resolveSkill(depSkill);
  }

  // Build result arrays
  for (const [name, requiredBy] of requiredMcpServers) {
    result.mcpServers.push({
      ...mcpServerMap.get(name),
      requiredBy: [...requiredBy]
    });
  }

  for (const [name, requiredBy] of requiredAgents) {
    result.agents.push({
      ...agentMap.get(name),
      requiredBy: [...requiredBy]
    });
  }

  for (const [name, requiredBy] of requiredSkills) {
    result.skills.push({
      ...skillMap.get(name),
      requiredBy: [...requiredBy]
    });
  }

  return result;
}

/**
 * Finds orphaned dependencies that are no longer required by any installed skill
 * @param {Object} metadata - Current .hands-meta.json content
 * @param {Set<string>} currentSkillNames - Skills that will remain installed
 * @returns {{mcpServers: Object[], agents: Object[], skills: Object[]}}
 */
function findOrphans(metadata, currentSkillNames) {
  const orphans = {
    mcpServers: [],
    agents: [],
    skills: []
  };

  const resolvedDeps = metadata.resolvedDeps ?? {};

  for (const category of ['mcpServers', 'agents', 'skills']) {
    const deps = resolvedDeps[category] ?? {};

    for (const [name, info] of Object.entries(deps)) {
      const requiredBy = info.requiredBy ?? [];
      const stillNeeded = requiredBy.some(s => currentSkillNames.has(s));

      if (!stillNeeded) {
        orphans[category].push({ name, ...info });
      }
    }
  }

  return orphans;
}

module.exports = {
  resolveDependencies,
  findOrphans
};
