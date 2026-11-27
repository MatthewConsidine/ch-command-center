import { listCommandCenterProjects } from '@renderer/components/commandCenter'
import type { AgentEntity, ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { CommandCenterLeadAgents } from '@shared/data/preference/preferenceTypes'

export const ROSTER_ROLES = ['chief', 'lead', 'scheduled', 'other', 'builtin'] as const
export type RosterRole = (typeof ROSTER_ROLES)[number]

export interface RosterEntry {
  agent: AgentEntity
  role: RosterRole
  /** Names of the projects this agent leads. */
  projects: string[]
  /** Enabled scheduled tasks. */
  tasks: number
  lastActiveAt?: string
}

export interface AgentRoster {
  entries: RosterEntry[]
  projectsWithoutLead: AgentWorkspaceEntity[]
}

interface RosterInput {
  agents: readonly AgentEntity[]
  workspaces: readonly AgentWorkspaceEntity[]
  sessions: readonly AgentSessionEntity[]
  tasks: readonly Pick<ScheduledTaskEntity, 'agentId' | 'enabled'>[]
  leadAgents: CommandCenterLeadAgents
  chiefAgentId: string
}

/**
 * Every agent with its Command Center role, ordered by role then name. A role is the first that
 * applies: chief, lead of a project, owner of a scheduled task, other, then Cherry's built-ins.
 */
export function buildAgentRoster(input: RosterInput): AgentRoster {
  const projects = listCommandCenterProjects(input.workspaces, input.sessions, input.leadAgents, input.chiefAgentId)
  const led = new Map<string, string[]>()
  for (const { workspace, leadAgentId } of projects) {
    if (leadAgentId) led.set(leadAgentId, [...(led.get(leadAgentId) ?? []), workspace.name])
  }

  const entries = input.agents.map((agent): RosterEntry => {
    const tasks = input.tasks.filter((task) => task.agentId === agent.id && task.enabled).length
    const role: RosterRole =
      agent.id === input.chiefAgentId
        ? 'chief'
        : led.has(agent.id)
          ? 'lead'
          : tasks > 0
            ? 'scheduled'
            : agent.configuration?.builtin_role
              ? 'builtin'
              : 'other'
    const lastActiveAt = input.sessions
      .filter((session) => session.agentId === agent.id)
      .map((session) => session.lastActivityAt)
      .sort()
      .at(-1)
    return { agent, role, projects: led.get(agent.id) ?? [], tasks, lastActiveAt }
  })

  entries.sort(
    (a, b) => ROSTER_ROLES.indexOf(a.role) - ROSTER_ROLES.indexOf(b.role) || a.agent.name.localeCompare(b.agent.name)
  )
  return {
    entries,
    projectsWithoutLead: projects
      .filter((project) => !project.leadAgentId || !input.agents.some((agent) => agent.id === project.leadAgentId))
      .map((project) => project.workspace)
  }
}
