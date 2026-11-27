import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listAgentTemplates } from '../agentTemplates'

describe('listAgentTemplates', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agent-templates-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads role templates with their settings and prompt, CRLF files included', async () => {
    await writeFile(
      path.join(dir, 'lead.md'),
      [
        '---',
        'role: lead',
        'title: Project lead',
        'model: openrouter::anthropic/claude-sonnet-5.5',
        'small_model: openrouter::anthropic/claude-haiku-5.5',
        'permission_mode: default',
        '---',
        'You lead the {project} project.',
        ''
      ].join('\r\n')
    )

    const { templates, skipped } = await listAgentTemplates(dir)

    expect(skipped).toEqual([])
    expect(templates).toEqual([
      {
        file: 'lead.md',
        role: 'lead',
        title: 'Project lead',
        name: '{project} agent',
        model: 'openrouter::anthropic/claude-sonnet-5.5',
        smallModel: 'openrouter::anthropic/claude-haiku-5.5',
        permissionMode: 'default',
        prompt: 'You lead the {project} project.'
      }
    ])
  })

  it('ignores notes without a role and reports templates it cannot use', async () => {
    await writeFile(path.join(dir, 'README.md'), '# Notes about the templates\n')
    await writeFile(path.join(dir, 'odd.md'), '---\nrole: janitor\n---\nSweep.\n')
    await writeFile(path.join(dir, 'coder.md'), '---\nrole: worker\nmodel: haiku\n---\nDo bulk edits.\n')

    const { templates, skipped } = await listAgentTemplates(dir)

    expect(templates.map((template) => [template.file, template.name, template.title])).toEqual([
      ['coder.md', 'coder', 'coder']
    ])
    expect(skipped).toEqual([{ file: 'odd.md', reason: expect.stringContaining('role') }])
  })
})
