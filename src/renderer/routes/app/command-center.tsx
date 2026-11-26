import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { CommandCenterSettings } from '@renderer/components/commandCenter'
import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'

export const Route = createFileRoute('/app/command-center')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  search: {
    middlewares: [
      ({ search, next }) => {
        const destination = next(search)
        if (!destination.agentId || destination.intent) return destination

        const normalized = { ...destination }
        delete normalized.sessionId
        return normalized
      }
    ]
  },
  beforeLoad: async ({ search }) => {
    if (search.sessionId || search.intent || search.agentId) return

    const chiefAgentId = await preferenceService.get('feature.command_center.chief_agent_id')
    if (!chiefAgentId) return
    const sessionId = await resolveAgentEntrySessionIdForAgent(chiefAgentId)
    throw redirect({
      to: '/app/command-center',
      search: sessionId ? { sessionId } : { agentId: chiefAgentId },
      replace: true
    })
  },
  component: CommandCenterRoute
})

function CommandCenterRoute() {
  const [chiefAgentId] = usePreference('feature.command_center.chief_agent_id')
  return chiefAgentId ? <AgentPage variant="commandCenter" /> : <CommandCenterSetup />
}

function CommandCenterSetup() {
  const { t } = useTranslation()
  const navigate = Route.useNavigate()
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-xl flex-col gap-6 rounded-xl border border-border bg-card p-6 text-card-foreground">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-lg">{t('commandCenter.setupTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('commandCenter.setupDescription')}</p>
        </div>
        <CommandCenterSettings onChiefChange={(agentId) => void navigate({ search: { agentId }, replace: true })} />
      </div>
    </div>
  )
}
