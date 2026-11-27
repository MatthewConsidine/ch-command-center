import { describe, expect, it } from 'vitest'

import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentTemplate } from '@shared/ipc/schemas/commandCenter'

import { planWizard } from '../agentWizardPlan'

const workspace = (id: string, name: string): AgentWorkspaceEntity => ({
  id,
  name,
  path: `C:\\Projects\\${name}`,
  type: 'user',
  orderKey: 'a0',
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z'
})

const template = (role: AgentTemplate['role'], extra: Partial<AgentTemplate> = {}): AgentTemplate => ({
  file: `${role}.md`,
  role,
  title: role,
  name: role === 'lead' ? '{project} agent' : role,
  prompt: 'You work on {project}.',
  ...extra
})

const sonnet = 'openrouter::anthropic/claude-sonnet-5.5'

describe('planWizard', () => {
  it('makes one lead per project, named and briefed for it, skipping onboarding', () => {
    const actions = planWizard({
      template: template('lead'),
      workspaces: [workspace('w1', 'Alpha'), workspace('w2', 'Beta')],
      name: '{project} agent',
      prompt: 'You lead {project}.',
      model: sonnet,
      smallModel: 'openrouter::anthropic/claude-haiku-5.5',
      permissionMode: 'default'
    })

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'agent', leadOf: 'w1' }),
      expect.objectContaining({ kind: 'agent', leadOf: 'w2' })
    ])
    expect(actions[1]).toMatchObject({
      command: {
        type: 'claude-code',
        name: 'Beta agent',
        instructions: 'You lead Beta.',
        model: sonnet,
        smallModel: 'openrouter::anthropic/claude-haiku-5.5',
        configuration: { bootstrap_completed: true, permission_mode: 'default' }
      }
    })
  })

  it('writes a worker file into each chosen project', () => {
    expect(
      planWizard({
        template: template('worker', { name: 'coder', description: 'Bulk edits' }),
        workspaces: [workspace('w1', 'Gamma')],
        name: 'coder',
        prompt: 'Edit files in {project} as asked.',
        model: 'haiku'
      })
    ).toEqual([
      {
        kind: 'worker',
        workspaceId: 'w1',
        worker: { name: 'coder', description: 'Bulk edits', model: 'haiku', prompt: 'Edit files in Gamma as asked.' }
      }
    ])
  })

  it('gives a scheduled agent its cron task in its home workspace', () => {
    const [action] = planWizard({
      template: template('scheduled'),
      workspaces: [workspace('home', 'Command Center')],
      name: 'Nightly digest',
      prompt: 'Tidy memory.',
      model: sonnet,
      schedule: '0 19 * * *'
    })

    expect(action).toMatchObject({
      kind: 'agent',
      command: { name: 'Nightly digest' },
      task: { name: 'Nightly digest', cron: '0 19 * * *', workspaceId: 'home' }
    })
  })

  it('marks the chief so it can be set in the Command Center', () => {
    expect(
      planWizard({ template: template('chief'), workspaces: [], name: 'Chief', prompt: 'Route work.', model: sonnet })
    ).toEqual([expect.objectContaining({ kind: 'agent', chief: true })])
  })
})
