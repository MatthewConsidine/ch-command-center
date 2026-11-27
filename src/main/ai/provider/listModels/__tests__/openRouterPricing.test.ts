import { describe, expect, it } from 'vitest'

import { toOpenRouterPricing } from '../openRouterPricing'

describe('toOpenRouterPricing', () => {
  it('turns per-token USD quotes into per-million prices, cache prices included', () => {
    expect(
      toOpenRouterPricing({
        prompt: '0.000003',
        completion: '0.000015',
        input_cache_read: '0.0000003',
        input_cache_write: '0.00000375',
        request: '0'
      })
    ).toEqual({
      input: { perMillionTokens: 3 },
      output: { perMillionTokens: 15 },
      cacheRead: { perMillionTokens: 0.3 },
      cacheWrite: { perMillionTokens: 3.75 }
    })
  })

  it('prices free models at zero', () => {
    expect(toOpenRouterPricing({ prompt: '0', completion: '0' })).toEqual({
      input: { perMillionTokens: 0 },
      output: { perMillionTokens: 0 }
    })
  })

  it.each([
    ['a router whose price varies', { prompt: '-1', completion: '-1' }],
    ['a quote without an output price', { prompt: '0.000001' }],
    ['an unreadable quote', { prompt: 'n/a', completion: '' }],
    ['no pricing at all', undefined]
  ])('gives no price for %s', (_case, pricing) => {
    expect(toOpenRouterPricing(pricing)).toBeUndefined()
  })
})
