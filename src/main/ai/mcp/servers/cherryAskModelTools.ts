import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import { isSameOrInside, realpath } from '@main/utils/file'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

const logger = loggerService.withContext('McpServer:AskModel')

export const ASK_MODEL_TOOL_NAME = 'ask_model'

export const ASK_MODEL_PER_CALL_CAP_USD = 0.1
export const ASK_MODEL_SESSION_CAP_USD = 1
const DEFAULT_MAX_OUTPUT_TOKENS = 1500
const MAX_OUTPUT_TOKENS = 4000
// Deliberately pessimistic so the pre-call worst case never undershoots.
const CHARS_PER_TOKEN = 2

const spentUsdBySession = new Map<string, number>()

const chatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }).strict()

const askModelInputSchema = z
  .object({
    model: z.string().describe('Configured model as "providerId::modelId", for example "openrouter::vendor/model".'),
    messages: z.array(chatMessageSchema).min(1).max(40).optional(),
    messagesFile: z
      .string()
      .optional()
      .describe(
        'Instead of messages: a JSON file inside your workspace holding a `messages` array (system, user and assistant roles). Use it for long prompts so you need not retype them.'
      ),
    system: z.string().optional(),
    maxOutputTokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    reasoningEffort: ReasoningEffortOptionSchema.optional().describe('Defaults to none.')
  })
  .strict()

type ChatMessages = { system?: string; messages: Array<z.infer<typeof chatMessageSchema>> }

async function readMessagesFile(workspacePath: string, file: string): Promise<ChatMessages> {
  const target = await realpath(AbsoluteFilePathSchema.parse(path.resolve(workspacePath, file)))
  if (!isSameOrInside(target, await realpath(AbsoluteFilePathSchema.parse(workspacePath)))) {
    throw new Error('messagesFile must be inside your workspace.')
  }
  const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
  const raw = z
    .object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1) })
    .array()
    .min(1)
    .parse(Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown }).messages)
  const system = raw
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  return {
    ...(system ? { system } : {}),
    messages: raw.filter((m): m is z.infer<typeof chatMessageSchema> => m.role !== 'system')
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
      const messages = chat.messages
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
        pricing = createAiUsagePricingSnapshot(configured.pricing)
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

      const promptChars = (system?.length ?? 0) + messages.reduce((sum, message) => sum + message.content.length, 0)
      const worstCase =
        (Math.ceil(promptChars / CHARS_PER_TOKEN) * pricing.inputPerMillionTokens +
          maxOutputTokens * pricing.outputPerMillionTokens) /
        1_000_000
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
