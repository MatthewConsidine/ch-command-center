import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { CommandCenterLeadAgents } from '@shared/data/preference/preferenceTypes'

export interface CommandCenterProject {
  workspace: AgentWorkspaceEntity
  /** Undefined when no lead is chosen and no Agent has worked in the workspace yet. */
  leadAgentId?: string
}

function byLatestActivity(a: AgentSessionEntity, b: AgentSessionEntity): number {
  return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
}

/** Newest session of `agentId`, limited to one workspace when `workspaceId` is given. */
export function findLatestSession(
  sessions: readonly AgentSessionEntity[],
  agentId: string,
  workspaceId?: string
): AgentSessionEntity | undefined {
  return sessions
    .filter((session) => session.agentId === agentId && (!workspaceId || session.workspaceId === workspaceId))
    .sort(byLatestActivity)[0]
}

/**
 * User workspaces as projects, each with its lead: the chosen lead, else the Agent of the
 * workspace's newest session. Workspaces the chief leads are the chief's own, not projects.
 */
export function listCommandCenterProjects(
  workspaces: readonly AgentWorkspaceEntity[],
  sessions: readonly AgentSessionEntity[],
  leadAgents: CommandCenterLeadAgents,
  chiefAgentId: string
): CommandCenterProject[] {
  return workspaces
    .filter((workspace) => workspace.type === AGENT_WORKSPACE_TYPE.USER)
    .map((workspace) => {
      const newest = sessions.filter((session) => session.workspaceId === workspace.id).sort(byLatestActivity)[0]
      return { workspace, leadAgentId: leadAgents[workspace.id] || newest?.agentId || undefined }
    })
    .filter((project) => project.leadAgentId !== chiefAgentId)
    .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name))
}
