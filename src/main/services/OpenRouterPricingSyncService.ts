import { isEqual } from 'es-toolkit/compat'

import { application } from '@application'
import { loggerService } from '@logger'
import { listModels } from '@main/ai/provider/listModels'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { modelService } from '@main/data/services/ModelService'
import { matchesModelPricingBaseline } from '@main/data/services/ProviderRegistryService'
import { providerService } from '@main/data/services/ProviderService'
import { parseUniqueModelId } from '@shared/data/types/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

const logger = loggerService.withContext('OpenRouterPricingSyncService')
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_ATTEMPT_KEY = 'openrouter.pricing.last_attempt_at'

/**
 * Keeps the prices of the user's OpenRouter models current, so the model picker and
 * per-reply cost records follow OpenRouter's live catalog instead of the bundled registry.
 */
@Injectable('OpenRouterPricingSyncService')
@ServicePhase(Phase.WhenReady)
export class OpenRouterPricingSyncService extends BaseService {
  private controller: AbortController | null = null
  private stopped = false

  protected onReady(): void {
    this.stopped = false
    const initial = setTimeout(() => {
      void this.check()
      this.registerInterval(() => this.check(), CHECK_INTERVAL_MS)
    }, 30_000)
    initial.unref()
    this.registerDisposable(() => clearTimeout(initial))
  }

  protected onStop(): void {
    this.stopped = true
    this.controller?.abort()
  }

  public async check(): Promise<void> {
    if (this.stopped || this.controller) return

    try {
      const provider = this.getEnabledProvider()
      if (!provider || modelService.list({ providerId: provider.id }).length === 0) return

      const cache = application.get('CacheService')
      const lastAttempt = cache.getPersist(LAST_ATTEMPT_KEY)
      const now = Date.now()
      if (lastAttempt !== null && now - lastAttempt < CHECK_INTERVAL_MS) return

      const controller = new AbortController()
      this.controller = controller
      // Throttle failed and empty pulls too, including across application restarts.
      cache.setPersist(LAST_ATTEMPT_KEY, now)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
      const { models } = await listModels(provider, signal, { throwOnError: true })
      if (signal.aborted || !isEqual(provider, this.getEnabledProvider())) return

      const live = new Map(models.filter((model) => model.pricing).map((model) => [model.apiModelId, model.pricing]))
      const updates = modelService.list({ providerId: provider.id }).flatMap((model) => {
        const modelId = parseUniqueModelId(model.id).modelId
        const pricing = live.get(modelId)
        if (!pricing || matchesModelPricingBaseline(pricing, model.pricing)) return []
        return [{ providerId: provider.id, modelId, patch: { pricing } }]
      })
      if (updates.length === 0) return

      modelService.bulkUpdate(updates)
      notifyDataApiDataChange([{ endpoint: '/models', kind: 'projection' }, { endpoint: '/models/:uniqueModelId*' }])
      logger.info('Refreshed OpenRouter model prices', { count: updates.length })
    } catch (error) {
      if (!this.stopped)
        logger.warn('OpenRouter price refresh failed', {
          errorType: error instanceof Error ? error.name : typeof error
        })
    } finally {
      this.controller = null
    }
  }

  private getEnabledProvider() {
    return providerService
      .list({ enabled: true })
      .find((provider) => provider.id === SystemProviderIds.openrouter && provider.apiKeys.some((key) => key.isEnabled))
  }
}
