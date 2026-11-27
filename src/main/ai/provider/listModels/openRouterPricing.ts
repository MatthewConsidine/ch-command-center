import type { RuntimeModelPricing } from '@shared/data/types/model'

// OpenRouter quotes USD per token as decimal strings; routers such as openrouter/auto use "-1" (price varies).
function perMillionTokens(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const perToken = Number(value)
  if (!Number.isFinite(perToken) || perToken < 0) return undefined
  return Number((perToken * 1_000_000).toPrecision(12))
}

/**
 * Convert an OpenRouter catalog `pricing` object into Cherry's model pricing.
 *
 * @returns `undefined` when the model has no fixed input and output price.
 */
export function toOpenRouterPricing(pricing: unknown): RuntimeModelPricing | undefined {
  if (!pricing || typeof pricing !== 'object') return undefined
  const quoted = pricing as Record<string, unknown>
  const input = perMillionTokens(quoted.prompt)
  const output = perMillionTokens(quoted.completion)
  if (input === undefined || output === undefined) return undefined
  const cacheRead = perMillionTokens(quoted.input_cache_read)
  const cacheWrite = perMillionTokens(quoted.input_cache_write)
  return {
    input: { perMillionTokens: input },
    output: { perMillionTokens: output },
    ...(cacheRead !== undefined ? { cacheRead: { perMillionTokens: cacheRead } } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite: { perMillionTokens: cacheWrite } } : {})
  }
}
