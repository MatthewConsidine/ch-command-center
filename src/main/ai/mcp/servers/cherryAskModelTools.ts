import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { McpServer } from '@modelcontextprotocol/server'
import type { ImagePart, ModelMessage, TextPart } from 'ai'
import * as z from 'zod'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import { geminiImageTokens, type ImageDims, openaiImageTokens } from '@main/ai/tokens/imageTokens'
import { isSameOrInside, realpath } from '@main/utils/file'
import { clampImageForModel } from '@main/utils/image'
import { CURRENCY, type RuntimeModelPricing, UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { isVisionModel } from '@shared/utils/model'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

const logger = loggerService.withContext('McpServer:AskModel')

export const ASK_MODEL_TOOL_NAME = 'ask_model'

export const ASK_MODEL_PER_CALL_CAP_USD = 0.1
export const ASK_MODEL_SESSION_CAP_USD = 1
const DEFAULT_MAX_OUTPUT_TOKENS = 1500
const MAX_OUTPUT_TOKENS = 4000
// Deliberately pessimistic so the pre-call worst case never undershoots.
const CHARS_PER_TOKEN = 2
// Patch-based vision encoders spend about one token per 28×28 patch; 512 px per token leaves headroom.
const PIXELS_PER_IMAGE_TOKEN = 512
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

const spentUsdBySession = new Map<string, number>()

const imagePartSchema = z
  .object({
    type: z.literal('image'),
    image: z
      .string()
      .min(1)
      .describe('A base64 data: URL, or the path of a PNG, JPEG, WebP or GIF file inside your workspace.')
  })
  .strict()
const userContentSchema = z.union([
  z.string().min(1),
  z.array(z.union([z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(), imagePartSchema])).min(1)
])
const chatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: userContentSchema }).strict(),
  z.object({ role: z.literal('assistant'), content: z.string().min(1) }).strict()
])
type ChatMessage = z.infer<typeof chatMessageSchema>

const askModelInputSchema = z
  .object({
    model: z.string().describe('Configured model as "providerId::modelId", for example "openrouter::vendor/model".'),
    messages: z
      .array(chatMessageSchema)
      .min(1)
      .max(40)
      .optional()
      .describe(
        'User content is a string or an array of {type:"text",text} and {type:"image",image} parts. Image paths are relative to your workspace.'
      ),
    messagesFile: z
      .string()
      .optional()
      .describe(
        'Instead of messages: a JSON file inside your workspace holding a `messages` array (system, user and assistant roles; user content may include image parts). Use it for long prompts so you need not retype them.'
      ),
    system: z.string().optional(),
    maxOutputTokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    reasoningEffort: ReasoningEffortOptionSchema.optional().describe('Defaults to none.')
  })
  .strict()

type ChatMessages = { system?: string; messages: ChatMessage[] }

async function resolveInsideWorkspace(workspacePath: string, file: string, label: string): Promise<string> {
  const target = await realpath(AbsoluteFilePathSchema.parse(path.resolve(workspacePath, file)))
  if (!isSameOrInside(target, await realpath(AbsoluteFilePathSchema.parse(workspacePath)))) {
    throw new Error(`${label} must be inside your workspace.`)
  }
  return target
}

async function readMessagesFile(workspacePath: string, file: string): Promise<ChatMessages> {
  const target = await resolveInsideWorkspace(workspacePath, file, 'messagesFile')
  const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
  const raw = z
    .union([z.object({ role: z.literal('system'), content: z.string().min(1) }).strict(), chatMessageSchema])
    .array()
    .min(1)
    .parse(Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown }).messages)
  const system = raw
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  return {
    ...(system ? { system } : {}),
    messages: raw.filter((m): m is ChatMessage => m.role !== 'system')
  }
}

// No input-image price is stored, so take the largest of the common providers' token formulas.
const worstCaseImageTokens = (dims: ImageDims) =>
  Math.max(
    openaiImageTokens(dims),
    geminiImageTokens(dims),
    Math.ceil((dims.width * dims.height) / PIXELS_PER_IMAGE_TOKEN)
  )

async function loadImage(workspacePath: string, ref: string): Promise<{ part: ImagePart; tokens: number }> {
  let bytes: Buffer
  if (ref.startsWith('data:')) {
    const base64 = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(ref)?.[1]
    if (!base64) throw new Error('An image data: URL must hold base64 image data.')
    bytes = Buffer.from(base64, 'base64')
  } else {
    const target = await resolveInsideWorkspace(workspacePath, ref, 'Image paths')
    if ((await stat(target)).size > MAX_IMAGE_BYTES) throw new Error(`${ref} is larger than 20 MB.`)
    bytes = await readFile(target)
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('An image is larger than 20 MB.')

  const sharp = (await import('sharp')).default
  const original = await sharp(bytes, { failOn: 'none' }).metadata()
  const mediaType = original.format ? IMAGE_MEDIA_TYPES[original.format] : undefined
  if (!mediaType) throw new Error('Images must be PNG, JPEG, WebP or GIF.')
  const clamped = await clampImageForModel(bytes)
  const { width, height } = clamped ? await sharp(clamped).metadata() : original
  if (!width || !height) throw new Error('Could not read the image dimensions.')
  return {
    part: { type: 'image', image: clamped ?? bytes, mediaType },
    tokens: worstCaseImageTokens({ width, height })
  }
}

/** Loads image parts into bytes and returns the messages with a worst-case input token count. */
async function toModelMessages(
  workspacePath: string,
  messages: ChatMessage[]
): Promise<{ messages: ModelMessage[]; inputTokens: number }> {
  let chars = 0
  let imageTokens = 0
  const prepared: ModelMessage[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length
      prepared.push(message)
      continue
    }
    const content: Array<TextPart | ImagePart> = []
    for (const part of message.content) {
      if (part.type === 'text') {
        chars += part.text.length
        content.push(part)
        continue
      }
      const image = await loadImage(workspacePath, part.image)
      imageTokens += image.tokens
      content.push(image.part)
    }
    prepared.push({ role: 'user', content })
  }
  return { messages: prepared, inputTokens: Math.ceil(chars / CHARS_PER_TOKEN) + imageTokens }
}

const hasImage = (messages: ChatMessage[]) =>
  messages.some((m) => typeof m.content !== 'string' && m.content.some((part) => part.type === 'image'))

// Saved prices often omit currency; the pricing schema treats that as USD.
function withDefaultCurrency(pricing: RuntimeModelPricing | undefined): RuntimeModelPricing | undefined {
  if (!pricing) return undefined
  const usd = <T extends { currency?: string }>(rate: T | undefined) =>
    rate && { ...rate, currency: rate.currency ?? CURRENCY.USD }
  return {
    ...pricing,
    input: usd(pricing.input)!,
    output: usd(pricing.output)!,
    cacheRead: usd(pricing.cacheRead),
    cacheWrite: usd(pricing.cacheWrite),
    inputTokenTiers: pricing.inputTokenTiers?.map((tier) => ({
      ...tier,
      input: usd(tier.input)!,
      output: usd(tier.output)!,
      cacheRead: usd(tier.cacheRead),
      cacheWrite: usd(tier.cacheWrite)
    }))
  }
}

const fail = (message: string) => ({ ...modelOutputToMcpResult({ type: 'text', value: message }), isError: true })

/**
 * One-shot text completion through any model the user configured in Cherry. Cherry makes the
 * call with its stored credentials, so the agent never sees a key. Spend is capped per call and
 * per session, and each call is logged without its prompt or reply.
 */
export function registerAskModelTools(server: McpServer, context: { sessionId: string; workspacePath: string }): void {
  server.registerTool(
    ASK_MODEL_TOOL_NAME,
    {
      description: `Ask another configured model one question and get its text reply. No tools, no memory; you supply the full messages. Spend is capped at $${ASK_MODEL_PER_CALL_CAP_USD} per call and $${ASK_MODEL_SESSION_CAP_USD} per session, and a model without a known price is refused.`,
      inputSchema: askModelInputSchema
    },
    async (input, ctx) => {
      const { model, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS } = input
      if (!input.messages === !input.messagesFile) return fail('Pass exactly one of messages or messagesFile.')
      let chat: ChatMessages
      try {
        chat = input.messagesFile
          ? await readMessagesFile(context.workspacePath, input.messagesFile)
          : { messages: input.messages ?? [] }
      } catch (error) {
        return fail(`Could not read messagesFile: ${error instanceof Error ? error.message : String(error)}`)
      }
      const system = [input.system, chat.system].filter(Boolean).join('\n\n') || undefined
      const id = UniqueModelIdSchema.safeParse(model)
      if (!id.success) return fail('model must look like "providerId::modelId".')
      const separator = id.data.indexOf('::')
      const providerId = id.data.slice(0, separator)
      const modelId = id.data.slice(separator + 2)

      let pricing
      try {
        const configured = modelService.getByKey(providerId, modelId)
        if (!configured.isEnabled) return fail(`Model ${id.data} is disabled in Cherry.`)
        if (hasImage(chat.messages) && !isVisionModel(configured)) {
          return fail(`Model ${id.data} does not accept image input. Refused.`)
        }
        pricing = createAiUsagePricingSnapshot(withDefaultCurrency(configured.pricing))
      } catch {
        return fail(`Model ${id.data} is not configured in Cherry.`)
      }
      if (
        pricing?.currency !== 'USD' ||
        pricing.inputPerMillionTokens === undefined ||
        pricing.outputPerMillionTokens === undefined
      ) {
        return fail(`Model ${id.data} has no known USD price, so its cost cannot be capped. Refused.`)
      }

      let prepared
      try {
        prepared = await toModelMessages(context.workspacePath, chat.messages)
      } catch (error) {
        return fail(`Could not read an image: ${error instanceof Error ? error.message : String(error)}`)
      }
      const { messages } = prepared
      const inputTokens = prepared.inputTokens + Math.ceil((system?.length ?? 0) / CHARS_PER_TOKEN)
      const worstCase =
        (inputTokens * pricing.inputPerMillionTokens + maxOutputTokens * pricing.outputPerMillionTokens) / 1_000_000
      const spent = spentUsdBySession.get(context.sessionId) ?? 0
      if (worstCase > ASK_MODEL_PER_CALL_CAP_USD) {
        return fail(
          `Worst-case cost $${worstCase.toFixed(4)} exceeds the $${ASK_MODEL_PER_CALL_CAP_USD} per-call cap. Shorten the input or lower maxOutputTokens.`
        )
      }
      if (spent + worstCase > ASK_MODEL_SESSION_CAP_USD) {
        return fail(
          `Worst-case cost $${worstCase.toFixed(4)} would pass the $${ASK_MODEL_SESSION_CAP_USD} session cap ($${spent.toFixed(4)} spent).`
        )
      }

      // Reserve the worst case so concurrent calls cannot jointly overshoot the cap.
      spentUsdBySession.set(context.sessionId, spent + worstCase)
      let actual = worstCase
      try {
        const result = await application.get('AiService').generateText({
          uniqueModelId: id.data,
          conversation: { id: `ask-model:${context.sessionId}` },
          system,
          messages,
          disableTools: true,
          reasoningEffort: input.reasoningEffort ?? 'none',
          callOverrides: {
            maxOutputTokens,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {})
          },
          requestOptions: { signal: ctx.mcpReq.signal, maxRetries: 0 }
        })
        const cost = result.usage ? computeLanguageCost(result.usage, pricing)?.cost : undefined
        actual = cost ?? worstCase
        const total = (spentUsdBySession.get(context.sessionId) ?? 0) - worstCase + actual
        logger.info('ask_model call', {
          sessionId: context.sessionId,
          model: id.data,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          costUsd: actual,
          costEstimated: cost === undefined,
          sessionSpentUsd: total
        })
        return modelOutputToMcpResult({
          type: 'json',
          value: {
            model: id.data,
            text: result.text,
            finishReason: result.finishReason,
            costUsd: actual,
            sessionSpentUsd: total,
            sessionRemainingUsd: Math.max(0, ASK_MODEL_SESSION_CAP_USD - total)
          }
        })
      } catch (error) {
        actual = 0
        logger.warn('ask_model call failed', {
          sessionId: context.sessionId,
          model: id.data,
          error: error instanceof Error ? error.message : String(error)
        })
        return fail(`Call to ${id.data} failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        spentUsdBySession.set(context.sessionId, (spentUsdBySession.get(context.sessionId) ?? 0) - worstCase + actual)
      }
    }
  )
}
