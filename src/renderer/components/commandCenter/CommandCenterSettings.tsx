import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

const AUTO_LEAD = '__auto__'

interface CommandCenterSettingsProps {
  onChiefChange?: (agentId: string) => void
}

/** Pick the chief Agent and, per user workspace, the Agent that leads that project. */
export function CommandCenterSettings({ onChiefChange }: CommandCenterSettingsProps) {
  const { t } = useTranslation()
  const { agents } = useAgents()
  const [chiefAgentId, setChiefAgentId] = usePreference('feature.command_center.chief_agent_id')
  const [leadAgents, setLeadAgents] = usePreference('feature.command_center.lead_agents')
  const { data: workspaces, refetch } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetch())
  const userWorkspaces = useMemo(
    () =>
      (workspaces ?? [])
        .filter((workspace) => workspace.type === AGENT_WORKSPACE_TYPE.USER)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [workspaces]
  )

  const handleChiefChange = async (agentId: string) => {
    await setChiefAgentId(agentId)
    onChiefChange?.(agentId)
  }

  const handleLeadChange = async (workspaceId: string, value: string) => {
    const next = { ...leadAgents }
    if (value === AUTO_LEAD) delete next[workspaceId]
    else next[workspaceId] = value
    await setLeadAgents(next)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="command-center-chief">{t('commandCenter.chiefLabel')}</Label>
        <Select value={chiefAgentId || undefined} onValueChange={(value) => void handleChiefChange(value)}>
          <SelectTrigger id="command-center-chief" className="w-full">
            <SelectValue placeholder={t('commandCenter.chooseAgent')} />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">{t('commandCenter.chiefHint')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="font-medium text-sm">{t('commandCenter.leadsTitle')}</span>
        {userWorkspaces.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('commandCenter.noProjects')}</p>
        ) : (
          userWorkspaces.map((workspace) => (
            <div key={workspace.id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`command-center-lead-${workspace.id}`} className="min-w-0 truncate">
                {workspace.name}
              </Label>
              <Select
                value={leadAgents[workspace.id] ?? AUTO_LEAD}
                onValueChange={(value) => void handleLeadChange(workspace.id, value)}>
                <SelectTrigger id={`command-center-lead-${workspace.id}`} size="sm" className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_LEAD}>{t('commandCenter.leadAuto')}</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
