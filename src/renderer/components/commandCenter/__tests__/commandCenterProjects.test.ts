import { describe, expect, it } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import type { ScheduledTaskEntity } from '@shared/data/types/agent'

import { findLatestSession, listCommandCenterProjects, listLeadWorkspaces, summarizeProject } from '../commandCenterProjects'

function session(id: string, agentId: string, workspaceId: string, lastActivityAt: string): AgentSessionEntity {
  return { id, agentId, workspaceId, lastActivityAt } as AgentSessionEntity
}

function workspace(
  id: string,
  name: string,
  type: 'user' | 'system' = 'user',
  path = `/work/${id}`
): AgentWorkspaceEntity {
  return { id, name, type, path } as AgentWorkspaceEntity
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

describe('listLeadWorkspaces', () => {
  const root = workspace('root', 'Root', 'user', 'C:\\Work\\')
  const child = workspace('child', 'Child', 'user', 'c:/work/child')
  const sibling = workspace('sibling', 'Sibling', 'user', 'C:\\Workshop')

  it('hides a workspace that is the parent folder of another, whatever the path style', () => {
    expect(listLeadWorkspaces([root, child, sibling], new Set()).map((w) => w.id)).toEqual(['child', 'sibling'])
  })

  it('hides excluded workspaces and system workspaces', () => {
    const system = workspace('sys', 'Sys', 'system')
    expect(listLeadWorkspaces([child, sibling, system], new Set(['child'])).map((w) => w.id)).toEqual(['sibling'])
  })
})

describe('summarizeProject', () => {
  const sessions = [
    session('old-done', 'lead', 'ws-a', '2026-01-01T00:00:00.000Z'),
    session('new-done', 'lead', 'ws-a', '2026-03-01T00:00:00.000Z'),
    session('old-waiting', 'lead', 'ws-a', '2025-12-01T00:00:00.000Z'),
    session('elsewhere', 'lead', 'ws-b', '2026-04-01T00:00:00.000Z')
  ]
  const task = (id: string, workspaceId: string, status: ScheduledTaskEntity['status']) =>
    ({ id, status, workspace: { type: 'user', workspaceId } }) as ScheduledTaskEntity

  it('keeps a session awaiting approval on the card however old it is, and counts it', () => {
    const summary = summarizeProject('ws-a', sessions, new Map([['old-waiting', { status: 'awaiting-approval', isAwaitingApproval: true }]]), [], 2)
    expect(summary.sessions.map((entry) => entry.session.id)).toEqual(['old-waiting', 'new-done'])
    expect(summary.waitingCount).toBe(1)
    expect(summary.busy).toBe(true)
  })

  it('is idle with nothing running, and ignores other projects and finished streams', () => {
    const summary = summarizeProject('ws-a', sessions, new Map([['elsewhere', { status: 'streaming', isAwaitingApproval: false }]]), [])
    expect(summary.busy).toBe(false)
    expect(summary.sessions.map((entry) => entry.session.id)).toEqual(['new-done', 'old-done', 'old-waiting'])
  })

  it('lists only active scheduled tasks of this project', () => {
    const tasks = [task('mine', 'ws-a', 'active'), task('paused', 'ws-a', 'paused'), task('other', 'ws-b', 'active')]
    expect(summarizeProject('ws-a', sessions, new Map(), tasks).tasks.map((entry) => entry.id)).toEqual(['mine'])
  })

  it('shows approval wait for a stream paused mid-turn, which still reports streaming', () => {
    const paused = new Map([['new-done', { status: 'streaming' as const, isAwaitingApproval: true }]])
    const summary = summarizeProject('ws-a', sessions, paused, [])
    expect(summary.sessions[0].state).toBe('waiting')
    expect(summary.waitingCount).toBe(1)
  })

  it('reports a failed stream as failed rather than done', () => {
    const summary = summarizeProject('ws-a', sessions, new Map([['new-done', { status: 'error', isAwaitingApproval: false }]]), [])
    expect(summary.sessions[0].state).toBe('failed')
  })
})
