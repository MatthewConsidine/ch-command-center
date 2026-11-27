import type { TopicStreamStatus } from '@shared/ai/transport'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * User workspaces that can have a project lead: not `excludedIds` (the chief's and scheduled
 * agents' workspaces) and not a folder that contains another workspace.
 */
export function listLeadWorkspaces(
  workspaces: readonly AgentWorkspaceEntity[],
  excludedIds: ReadonlySet<string>
): AgentWorkspaceEntity[] {
  const users = workspaces.filter((workspace) => workspace.type === AGENT_WORKSPACE_TYPE.USER)
  const paths = users.map((workspace) => normalizePath(workspace.path))
  return users
    .filter((workspace, index) => {
      const prefix = paths[index] + '/'
      return !excludedIds.has(workspace.id) && !paths.some((other) => other.startsWith(prefix))
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type SessionState = 'running' | 'waiting' | 'failed' | 'done'

export interface ProjectCardSession {
  session: AgentSessionEntity
  state: SessionState
}

export interface ProjectCardSummary {
  /** Running or waiting sessions first, then the newest finished ones, capped at `limit`. */
  sessions: ProjectCardSession[]
  busy: boolean
  waitingCount: number
  /** Scheduled tasks that are not paused or finished. */
  tasks: ScheduledTaskEntity[]
}

const STATE_BY_STREAM_STATUS: Partial<Record<TopicStreamStatus, SessionState>> = {
  pending: 'running',
  streaming: 'running',
  'awaiting-approval': 'waiting',
  error: 'failed'
}

export function getSessionState(status: TopicStreamStatus | undefined): SessionState {
  return (status && STATE_BY_STREAM_STATUS[status]) || 'done'
}

/** One project's live card: its sessions with state, busy flag, approvals waiting and active scheduled tasks. */
export function summarizeProject(
  workspaceId: string,
  sessions: readonly AgentSessionEntity[],
  streamStatuses: ReadonlyMap<string, { status: TopicStreamStatus }>,
  tasks: readonly ScheduledTaskEntity[],
  limit = 4
): ProjectCardSummary {
  const all = sessions
    .filter((session) => session.workspaceId === workspaceId)
    .sort(byLatestActivity)
    .map((session) => ({ session, state: getSessionState(streamStatuses.get(session.id)?.status) }))
  const live = all.filter(({ state }) => state === 'running' || state === 'waiting')
  const rest = all.filter(({ state }) => state !== 'running' && state !== 'waiting')
  return {
    sessions: [...live, ...rest].slice(0, Math.max(limit, live.length)),
    busy: live.length > 0,
    waitingCount: live.filter(({ state }) => state === 'waiting').length,
    tasks: tasks.filter(
      (task) => task.status === 'active' && task.workspace.type === 'user' && task.workspace.workspaceId === workspaceId
    )
  }
}
