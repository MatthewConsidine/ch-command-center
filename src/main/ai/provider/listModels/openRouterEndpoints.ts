import * as z from 'zod'

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { OpenRouterEndpoint } from '@shared/ipc/schemas/commandCenter'

import { customFetch } from '../../utils/customFetch'
import { defaultHeaders } from '../../utils/provider'
import { toOpenRouterPricing } from './openRouterPricing'

const EndpointsResponseSchema = z.object({
  data: z.object({
    endpoints: z.array(
      z.looseObject({
        provider_name: z.string(),
        tag: z.string().nullish(),
        quantization: z.string().nullish(),
        context_length: z.number().nullish(),
        uptime_last_30m: z.number().nullish(),
        pricing: z.unknown()
      })
    )
  })
})

/** `deepseek/deepseek-v4.1-flash` → `<models url>/deepseek/deepseek-v4.1-flash/endpoints`. */
export function openRouterEndpointsUrl(modelsUrl: string, apiModelId: string): string | undefined {
  const slash = apiModelId.indexOf('/')
  if (slash <= 0 || slash === apiModelId.length - 1) return undefined
  const author = encodeURIComponent(apiModelId.slice(0, slash))
  const slug = encodeURIComponent(apiModelId.slice(slash + 1))
  return `${modelsUrl.replace(/\/+$/, '')}/${author}/${slug}/endpoints`
}

/** Each upstream provider serving the model, cheapest input price first. */
export function toOpenRouterEndpoints(body: unknown): OpenRouterEndpoint[] {
  const endpoints = EndpointsResponseSchema.parse(body).data.endpoints.map((endpoint) => {
    const pricing = toOpenRouterPricing(endpoint.pricing)
    return {
      provider: endpoint.provider_name,
      ...(endpoint.tag ? { tag: endpoint.tag } : {}),
      ...(endpoint.quantization ? { quantization: endpoint.quantization } : {}),
      ...(endpoint.context_length ? { contextLength: endpoint.context_length } : {}),
      ...(endpoint.uptime_last_30m != null ? { uptime: endpoint.uptime_last_30m } : {}),
      ...(pricing ? { pricing } : {})
    }
  })
  return endpoints.sort(
    (a, b) =>
      (a.pricing?.input.perMillionTokens ?? Infinity) - (b.pricing?.input.perMillionTokens ?? Infinity) ||
      a.provider.localeCompare(b.provider)
  )
}

/** Ask OpenRouter which providers serve `apiModelId` and what each charges. */
export async function fetchOpenRouterEndpoints(
  provider: Provider,
  apiModelId: string,
  signal?: AbortSignal
): Promise<OpenRouterEndpoint[]> {
  const modelsUrl =
    provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.modelsApiUrls?.default ??
    'https://openrouter.ai/api/v1/models'
  const url = openRouterEndpointsUrl(modelsUrl, apiModelId)
  if (!url) return []
  const response = await customFetch(url, { headers: defaultHeaders(provider), signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`)
  return toOpenRouterEndpoints(await response.json())
}
