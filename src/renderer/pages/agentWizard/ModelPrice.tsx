import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HoverCard, HoverCardContent, HoverCardTrigger, Spinner } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { OpenRouterEndpoint } from '@shared/ipc/schemas/commandCenter'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { dollars, formatModelPrice } from './modelLabel'

/** The model's saved price; for OpenRouter models, hovering lists what each upstream provider charges. */
export function ModelPrice({ model }: { model: Model | undefined }) {
  const price = formatModelPrice(model)
  if (!price) return null
  if (model?.providerId !== SystemProviderIds.openrouter) return <span className="text-muted-foreground">{price}</span>
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
          {price}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 p-3">
        <ProviderPrices modelId={model.id} />
      </HoverCardContent>
    </HoverCard>
  )
}

// Mounted only while the card is open, so OpenRouter is asked on hover, not for every row.
function ProviderPrices({ modelId }: { modelId: UniqueModelId }) {
  const { t } = useTranslation()
  const [endpoints, setEndpoints] = useState<OpenRouterEndpoint[] | 'error'>()

  useEffect(() => {
    let current = true
    ipcApi.request('command_center.model_endpoints.list', { modelId }).then(
      (result) => current && setEndpoints(result),
      () => current && setEndpoints('error')
    )
    return () => {
      current = false
    }
  }, [modelId])

  if (endpoints === undefined) return <Spinner text={t('agentWizard.prices.loading')} />
  if (endpoints === 'error') return <p className="text-muted-foreground text-xs">{t('agentWizard.prices.error')}</p>
  if (endpoints.length === 0) return <p className="text-muted-foreground text-xs">{t('agentWizard.prices.empty')}</p>

  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium">{t('agentWizard.prices.title')}</p>
      <table className="w-full">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="pb-1 font-normal">{t('agentWizard.prices.provider')}</th>
            <th className="pb-1 font-normal">{t('agentWizard.prices.inputOutput')}</th>
            <th className="pb-1 font-normal">{t('agentWizard.prices.cacheRead')}</th>
            <th className="pb-1 text-right font-normal">{t('agentWizard.prices.uptime')}</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((endpoint) => {
            const cacheRead = endpoint.pricing?.cacheRead?.perMillionTokens
            return (
              <tr key={endpoint.tag ?? endpoint.provider}>
                <td className="py-0.5 pr-2">
                  {endpoint.provider}
                  {endpoint.quantization && <span className="text-muted-foreground"> · {endpoint.quantization}</span>}
                </td>
                <td className="py-0.5 pr-2">{formatModelPrice(endpoint) || '—'}</td>
                <td className="py-0.5 pr-2">{cacheRead != null ? dollars(cacheRead) : '—'}</td>
                <td className="py-0.5 text-right">
                  {endpoint.uptime != null ? `${Math.round(endpoint.uptime)}%` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
