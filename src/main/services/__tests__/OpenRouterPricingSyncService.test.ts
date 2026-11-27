import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@main/data/db/schemas/userModel'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { modelService } from '@main/data/services/ModelService'
import { createUniqueModelId, type RuntimeModelPricing } from '@shared/data/types/model'

import { listModels } from '../../ai/provider/listModels'
import { BaseService } from '../../core/lifecycle'
import { OpenRouterPricingSyncService } from '../OpenRouterPricingSyncService'

vi.mock('@main/ai/provider/listModels', () => ({ listModels: vi.fn() }))

const SIX_HOURS = 6 * 60 * 60 * 1000
const price = (input: number, output: number): RuntimeModelPricing => ({
  input: { perMillionTokens: input },
  output: { perMillionTokens: output }
})

describe('OpenRouterPricingSyncService', () => {
  const dbh = setupTestDatabase()
  let service: OpenRouterPricingSyncService

  function seedProvider(providerId = 'openrouter', keyEnabled = true) {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId,
        name: providerId,
        isEnabled: true,
        orderKey: 'a0',
        apiKeys: [{ id: 'key-id', key: 'test-key', isEnabled: keyEnabled }]
      })
      .run()
  }

  function seedModel(modelId: string, pricing: RuntimeModelPricing | null, providerId = 'openrouter') {
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId(providerId, modelId),
        providerId,
        modelId,
        name: modelId,
        capabilities: [],
        supportsStreaming: true,
        pricing,
        orderKey: modelId
      })
      .run()
  }

  const storedPrice = (modelId: string) =>
    dbh.db.select().from(userModelTable).where(eq(userModelTable.modelId, modelId)).get()!.pricing

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T00:00:00Z'))
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    vi.mocked(listModels).mockReset()
    service = new OpenRouterPricingSyncService()
  })

  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
  })

  it('moves saved models to the live price and leaves the rest of the catalog out', async () => {
    seedProvider()
    seedModel('anthropic/claude-sonnet-5.5', price(3, 15))
    seedModel('deepseek/deepseek-v4.1-flash', price(0.15, 0.6))
    seedModel('openrouter/auto', null)
    vi.mocked(listModels).mockResolvedValue({
      models: [
        { apiModelId: 'anthropic/claude-sonnet-5.5', pricing: price(2, 10) },
        { apiModelId: 'deepseek/deepseek-v4.1-flash', pricing: price(0.15, 0.6) },
        { apiModelId: 'openrouter/auto' },
        { apiModelId: 'z-ai/glm-5.3', pricing: price(0.07, 1.4) }
      ]
    })

    await service.check()

    expect(modelService.getByKey('openrouter', 'anthropic/claude-sonnet-5.5').pricing).toEqual(price(2, 10))
    expect(storedPrice('deepseek/deepseek-v4.1-flash')).toEqual(price(0.15, 0.6))
    expect(storedPrice('openrouter/auto')).toBeNull()
    expect(modelService.list({ providerId: 'openrouter' }).map((model) => model.apiModelId)).not.toContain(
      'z-ai/glm-5.3'
    )
  })

  it.each(['no OpenRouter provider', 'a disabled key', 'no saved models'])(
    'makes no request with %s',
    async (state) => {
      if (state === 'no OpenRouter provider') {
        seedProvider('openai')
        seedModel('gpt-6.1-terra', price(1, 5), 'openai')
      } else {
        seedProvider('openrouter', state !== 'a disabled key')
        if (state !== 'no saved models') seedModel('anthropic/claude-sonnet-5.5', price(3, 15))
      }
      await service.check()
      expect(listModels).not.toHaveBeenCalled()
    }
  )

  it('keeps local prices when the catalog fails, and retries only after six hours, across restarts', async () => {
    seedProvider()
    seedModel('anthropic/claude-sonnet-5.5', price(3, 15))
    vi.mocked(listModels).mockRejectedValueOnce(new Error('offline'))
    await service.check()
    expect(storedPrice('anthropic/claude-sonnet-5.5')).toEqual(price(3, 15))

    await service._doStop()
    BaseService.resetInstances()
    service = new OpenRouterPricingSyncService()
    vi.mocked(listModels).mockResolvedValue({
      models: [{ apiModelId: 'anthropic/claude-sonnet-5.5', pricing: price(2, 10) }]
    })
    await service.check()
    expect(listModels).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + SIX_HOURS)
    await service.check()
    expect(storedPrice('anthropic/claude-sonnet-5.5')).toEqual(price(2, 10))
  })
})
