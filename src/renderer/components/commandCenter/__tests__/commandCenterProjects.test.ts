import { describe, expect, it } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import { findLatestSession, listCommandCenterProjects } from '../commandCenterProjects'

function session(id: string, agentId: string, workspaceId: string, lastActivityAt: string): AgentSessionEntity {
  return { id, agentId, workspaceId, lastActivityAt } as AgentSessionEntity
}

function workspace(id: string, name: string, type: 'user' | 'system' = 'user'): AgentWorkspaceEntity {
  return { id, name, type } as AgentWorkspaceEntity
}

describe('findLatestSession', () => {
  const sessions = [
    session('old', 'lead', 'ws-a', '2026-01-01T00:00:00.000Z'),
    session('new', 'lead', 'ws-a', '2026-03-01T00:00:00.000Z'),
    session('other-workspace', 'lead', 'ws-b', '2026-04-01T00:00:00.000Z'),
    session('other-agent', 'helper', 'ws-a', '2026-05-01T00:00:00.000Z')
  ]

  it("opens the agent's newest session in the project, not one from another project or agent", () => {
    expect(findLatestSession(sessions, 'lead', 'ws-a')?.id).toBe('new')
  })

  it("falls back to the agent's newest session anywhere when no workspace is given", () => {
    expect(findLatestSession(sessions, 'lead')?.id).toBe('other-workspace')
  })

  it('returns nothing when the agent has no session there, so a new one gets started', () => {
    expect(findLatestSession(sessions, 'lead', 'ws-c')).toBeUndefined()
  })
})

describe('listCommandCenterProjects', () => {
  const sessions = [
    session('s1', 'recent-agent', 'ws-a', '2026-02-01T00:00:00.000Z'),
    session('s2', 'chief', 'ws-chief', '2026-02-01T00:00:00.000Z')
  ]

  it('uses the chosen lead over the most recently active agent', () => {
    const projects = listCommandCenterProjects([workspace('ws-a', 'Alpha')], sessions, { 'ws-a': 'chosen' }, 'chief')
    expect(projects[0].leadAgentId).toBe('chosen')
  })

  it('falls back to the most recently active agent when no lead is chosen', () => {
    const projects = listCommandCenterProjects([workspace('ws-a', 'Alpha')], sessions, {}, 'chief')
    expect(projects[0].leadAgentId).toBe('recent-agent')
  })

  it("leaves out system workspaces and the chief's own workspace", () => {
    const projects = listCommandCenterProjects(
      [workspace('ws-a', 'Alpha'), workspace('ws-chief', 'Chief home'), workspace('ws-sys', 'System', 'system')],
      sessions,
      {},
      'chief'
    )
    expect(projects.map((project) => project.workspace.id)).toEqual(['ws-a'])
  })

  it('keeps a project with no lead yet so one can be chosen', () => {
    const projects = listCommandCenterProjects([workspace('ws-new', 'New')], sessions, {}, 'chief')
    expect(projects).toEqual([{ workspace: workspace('ws-new', 'New'), leadAgentId: undefined }])
  })
})
