import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import sharp from 'sharp'
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

  describe('image input', () => {
    const vision = (input = 1, output = 2) => ({ ...priced(input, output), capabilities: ['image-recognition'] })
    const png = (width: number, height: number) =>
      sharp({ create: { width, height, channels: 3, background: '#808080' } })
        .png()
        .toBuffer()
    const askWithImage = (image: string) =>
      ask({ model: base.model, messages: [{ role: 'user', content: [{ type: 'image', image }] }] })
    const sentContent = () => generateText.mock.calls[0][0].messages[0].content

    beforeEach(() => {
      getByKey.mockReturnValue(vision())
    })

    it('sends a workspace image named in messagesFile as an image part', async () => {
      writeFileSync(path.join(workspace, 'shot.png'), await png(64, 64))
      writeFileSync(
        path.join(workspace, 'vision.json'),
        JSON.stringify([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image', image: 'shot.png' }
            ]
          }
        ])
      )
      const result = await ask({ model: base.model, messagesFile: 'vision.json' })
      expect(result.isError).toBeUndefined()
      expect(sentContent()).toEqual([
        { type: 'text', text: 'describe' },
        { type: 'image', image: expect.any(Uint8Array), mediaType: 'image/png' }
      ])
    })

    it('accepts a base64 data URL', async () => {
      const result = await askWithImage(`data:image/png;base64,${(await png(8, 8)).toString('base64')}`)
      expect(result.isError).toBeUndefined()
      expect(sentContent()[0]).toMatchObject({ type: 'image', mediaType: 'image/png' })
    })

    it('refuses images for a model without image input', async () => {
      getByKey.mockReturnValue({ ...priced(1, 2), capabilities: [] })
      writeFileSync(path.join(workspace, 'a.png'), await png(8, 8))
      const result = await askWithImage('a.png')
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('does not accept image input')
      expect(generateText).not.toHaveBeenCalled()
    })

    it('refuses an image path outside the workspace', async () => {
      const outside = path.join(mkdtempSync(path.join(tmpdir(), 'outside-')), 'a.png')
      writeFileSync(outside, await png(8, 8))
      const result = await askWithImage(outside)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('inside your workspace')
      expect(generateText).not.toHaveBeenCalled()
    })

    it('refuses a file that is not an image', async () => {
      writeFileSync(path.join(workspace, 'fake.png'), 'not an image')
      const result = await askWithImage('fake.png')
      expect(result.isError).toBe(true)
      expect(generateText).not.toHaveBeenCalled()
    })

    it('counts image tokens toward the per-call cap', async () => {
      getByKey.mockReturnValue(vision(20, 1))
      expect((await ask(base)).isError).toBeUndefined()
      writeFileSync(path.join(workspace, 'big.png'), await png(2000, 2000))
      const result = await askWithImage('big.png')
      expect(result.isError).toBe(true)
      expect(text(result)).toContain(`$${ASK_MODEL_PER_CALL_CAP_USD} per-call cap`)
    })
  })
})
