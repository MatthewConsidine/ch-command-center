import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import { buildAgentRoster } from '../agentRoster'

const agent = (id: string, name: string, extra: Partial<AgentEntity> = {}) =>
  ({ id, name, type: 'claude-code', model: null, modelName: null, ...extra }) as AgentEntity
const workspace = (id: string, name: string) =>
  ({ id, name, path: `/p/${name}`, type: 'user', orderKey: 'a0', createdAt: '', updatedAt: '' }) as AgentWorkspaceEntity
const session = (agentId: string, workspaceId: string, lastActivityAt: string) =>
  ({ id: `${agentId}-${lastActivityAt}`, agentId, workspaceId, lastActivityAt }) as AgentSessionEntity

describe('buildAgentRoster', () => {
  it('gives each agent its role, the projects it leads and when it was last active', () => {
    const roster = buildAgentRoster({
      agents: [
        agent('cherry', 'Cherry Assistant', { configuration: { builtin_role: 'assistant' } }),
        agent('nightly', 'Nightly digest'),
        agent('alpha', 'Alpha agent'),
        agent('chief', 'Chief'),
        agent('spare', 'Scratch')
      ],
      workspaces: [workspace('w-alpha', 'Alpha'), workspace('w-beta', 'Beta'), workspace('w-home', 'Home')],
      sessions: [
        session('alpha', 'w-alpha', '2026-11-25T10:00:00.000Z'),
        session('alpha', 'w-alpha', '2026-11-26T10:00:00.000Z'),
        session('chief', 'w-home', '2026-11-26T12:00:00.000Z')
      ],
      tasks: [
        { agentId: 'nightly', enabled: true },
        { agentId: 'spare', enabled: false }
      ],
      leadAgents: {},
      chiefAgentId: 'chief'
    })

    expect(roster.entries.map((entry) => [entry.agent.name, entry.role, entry.projects, entry.tasks])).toEqual([
      ['Chief', 'chief', [], 0],
      ['Alpha agent', 'lead', ['Alpha'], 0],
      ['Nightly digest', 'scheduled', [], 1],
      ['Scratch', 'other', [], 0],
      ['Cherry Assistant', 'builtin', [], 0]
    ])
    expect(roster.entries[1].lastActiveAt).toBe('2026-11-26T10:00:00.000Z')
    expect(roster.projectsWithoutLead.map((project) => project.name)).toEqual(['Beta'])
  })

  it('flags a project whose chosen lead was deleted as having no lead', () => {
    const roster = buildAgentRoster({
      agents: [],
      workspaces: [workspace('w-alpha', 'Alpha')],
      sessions: [],
      tasks: [],
      leadAgents: { 'w-alpha': 'gone' },
      chiefAgentId: ''
    })

    expect(roster.projectsWithoutLead.map((project) => project.name)).toEqual(['Alpha'])
  })
})
