import { describe, expect, it } from 'vitest'

import { openRouterEndpointsUrl, toOpenRouterEndpoints } from '../openRouterEndpoints'

describe('openRouterEndpointsUrl', () => {
  it('addresses the author and slug under the models URL', () => {
    expect(openRouterEndpointsUrl('https://openrouter.ai/api/v1/models/', 'deepseek/deepseek-v4.1-flash:free')).toBe(
      'https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash%3Afree/endpoints'
    )
  })

  it('has no URL for ids without an author', () => {
    expect(openRouterEndpointsUrl('https://openrouter.ai/api/v1/models', 'openrouter-auto')).toBeUndefined()
    expect(openRouterEndpointsUrl('https://openrouter.ai/api/v1/models', 'author/')).toBeUndefined()
  })
})

describe('toOpenRouterEndpoints', () => {
  const endpoint = (provider: string, prompt: string, completion: string, extra: Record<string, unknown> = {}) => ({
    name: `${provider} | model`,
    provider_name: provider,
    tag: provider.toLowerCase(),
    quantization: null,
    context_length: 131072,
    uptime_last_30m: 99.5,
    pricing: { prompt, completion, request: '0', discount: 0 },
    ...extra
  })

  it('lists every provider in dollars per million tokens, cheapest input first', () => {
    const body = {
      data: {
        id: 'deepseek/deepseek-v4.1-flash',
        endpoints: [
          endpoint('Fireworks', '0.0000003', '0.0000012', { quantization: 'fp8' }),
          endpoint('DeepSeek', '0.00000015', '0.0000006', {
            pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.00000003' }
          })
        ]
      }
    }

    expect(toOpenRouterEndpoints(body)).toEqual([
      {
        provider: 'DeepSeek',
        tag: 'deepseek',
        contextLength: 131072,
        uptime: 99.5,
        pricing: {
          input: { perMillionTokens: 0.15 },
          output: { perMillionTokens: 0.6 },
          cacheRead: { perMillionTokens: 0.03 }
        }
      },
      {
        provider: 'Fireworks',
        tag: 'fireworks',
        quantization: 'fp8',
        contextLength: 131072,
        uptime: 99.5,
        pricing: { input: { perMillionTokens: 0.3 }, output: { perMillionTokens: 1.2 } }
      }
    ])
  })

  it('keeps providers without a fixed price, after the priced ones', () => {
    const body = {
      data: {
        endpoints: [
          endpoint('Router', '-1', '-1', { uptime_last_30m: null, tag: null }),
          endpoint('Cheap', '0.000001', '0.000002')
        ]
      }
    }

    expect(toOpenRouterEndpoints(body).map((entry) => [entry.provider, entry.pricing?.input.perMillionTokens])).toEqual(
      [
        ['Cheap', 1],
        ['Router', undefined]
      ]
    )
    expect(toOpenRouterEndpoints(body)[1]).not.toHaveProperty('uptime')
  })

  it('rejects a response that is not an endpoint listing', () => {
    expect(() => toOpenRouterEndpoints({ error: { message: 'No key' } })).toThrow()
  })
})
