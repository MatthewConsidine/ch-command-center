import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkerFile, listWorkerFiles } from '../workerFiles'

describe('worker files', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'workspace-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes a sub-agent Claude Code can load, and lists it back', async () => {
    const coder = { name: 'coder', description: 'Bulk edits: "rename X", search & replace', model: 'haiku' }

    expect(await createWorkerFile(workspace, { ...coder, prompt: 'Make the edits the lead asks for.' })).toBe(true)

    const text = await readFile(path.join(workspace, '.claude', 'agents', 'coder.md'), 'utf8')
    expect(text.startsWith('---\nname: coder\n')).toBe(true)
    expect(text.endsWith('---\n\nMake the edits the lead asks for.\n')).toBe(true)
    expect(await listWorkerFiles(workspace)).toEqual([coder])
  })

  it('never overwrites a worker the user already has', async () => {
    await createWorkerFile(workspace, { name: 'checker', description: 'Mine', prompt: 'My own prompt.' })

    expect(await createWorkerFile(workspace, { name: 'checker', description: 'New', prompt: 'Other.' })).toBe(false)
    expect(await readFile(path.join(workspace, '.claude', 'agents', 'checker.md'), 'utf8')).toContain('My own prompt.')
  })

  it('refuses a name that would leave the agents folder', async () => {
    await expect(createWorkerFile(workspace, { name: '../evil', description: '', prompt: '' })).rejects.toThrow()
  })

  it('lists nothing for a workspace without workers', async () => {
    expect(await listWorkerFiles(workspace)).toEqual([])
  })
})
