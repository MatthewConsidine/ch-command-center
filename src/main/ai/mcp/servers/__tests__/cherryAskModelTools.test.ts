import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn()
const getByKey = vi.fn()

vi.mock('@application', () => ({
  application: { get: (name: string) => (name === 'AiService' ? { generateText } : undefined) }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey } }))

const { registerAskModelTools, ASK_MODEL_TOOL_NAME, ASK_MODEL_PER_CALL_CAP_USD, ASK_MODEL_SESSION_CAP_USD } =
  await import('../cherryAskModelTools')

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
const clients: Client[] = []
let sessionCounter = 0
const workspace = mkdtempSync(path.join(tmpdir(), 'ask-model-'))

async function ask(args: Record<string, unknown>, sessionId = `s${sessionCounter++}`): Promise<Result> {
  const client = await connectMcpTestClient(() => {
    const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
    registerAskModelTools(server, { sessionId, workspacePath: workspace })
    return server
  })
  clients.push(client)
  return client.callTool({ name: ASK_MODEL_TOOL_NAME, arguments: args }) as Promise<Result>
}

const text = (r: Result) => r.content[0].text ?? ''
const priced = (input: number, output: number) => ({
  isEnabled: true,
  pricing: {
    input: { perMillionTokens: input, currency: 'USD' },
    output: { perMillionTokens: output, currency: 'USD' }
  }
})
const base = { model: 'openrouter::vendor/m', messages: [{ role: 'user', content: 'hi' }] }

describe('cherry-tools ask_model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getByKey.mockReturnValue(priced(1, 2))
    generateText.mockResolvedValue({
      text: 'hello',
      finishReason: 'stop',
      usage: { inputTokens: 1000, outputTokens: 500 }
    })
  })
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()))
  })

  it('returns the reply with its real cost', async () => {
    const result = JSON.parse(text(await ask(base)))
    expect(result.text).toBe('hello')
    expect(result.costUsd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6)
  })

  it('refuses a model with no known price rather than risk uncapped spend', async () => {
    getByKey.mockReturnValue({ isEnabled: true })
    const result = await ask(base)
    expect(result.isError).toBe(true)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('refuses a call whose worst case exceeds the per-call cap', async () => {
    getByKey.mockReturnValue(priced(10, 200))
    const result = await ask({ ...base, maxOutputTokens: 4000 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(`$${ASK_MODEL_PER_CALL_CAP_USD}`)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('stops a session once its cap is reached', async () => {
    getByKey.mockReturnValue(priced(10, 20))
    generateText.mockResolvedValue({
      text: 'x',
      finishReason: 'stop',
      usage: { inputTokens: 100_000, outputTokens: 50_000 }
    })
    let refused: Result | undefined
    for (let i = 0; i < 20 && !refused; i++) {
      const r = await ask({ ...base, maxOutputTokens: 1000 }, 'capped')
      if (r.isError) refused = r
    }
    expect(refused && text(refused)).toContain(`$${ASK_MODEL_SESSION_CAP_USD} session cap`)
  })

  it('does not charge a failed call against the session', async () => {
    generateText.mockRejectedValueOnce(new Error('boom'))
    expect((await ask(base, 'fail')).isError).toBe(true)
    const ok = JSON.parse(text(await ask(base, 'fail')))
    expect(ok.sessionSpentUsd).toBeCloseTo(ok.costUsd)
  })

  it('reads a long prompt from a workspace file and passes system turns as the system prompt', async () => {
    writeFileSync(
      path.join(workspace, 'p.json'),
      JSON.stringify({
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' }
        ]
      })
    )
    const result = await ask({ model: base.model, messagesFile: 'p.json', temperature: 0.8 })
    expect(result.isError).toBeUndefined()
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'be brief',
        messages: [{ role: 'user', content: 'hi' }],
        callOverrides: expect.objectContaining({ temperature: 0.8 })
      })
    )
  })

  it('refuses a messagesFile outside the workspace', async () => {
    const outside = path.join(mkdtempSync(path.join(tmpdir(), 'outside-')), 'p.json')
    writeFileSync(outside, JSON.stringify([{ role: 'user', content: 'hi' }]))
    const result = await ask({ model: base.model, messagesFile: outside })
    expect(result.isError).toBe(true)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('treats a saved price with no currency as USD', async () => {
    getByKey.mockReturnValue({
      isEnabled: true,
      pricing: { input: { perMillionTokens: 1 }, output: { perMillionTokens: 2 } }
    })
    const result = await ask(base)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(text(result)).costUsd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6)
  })
})
