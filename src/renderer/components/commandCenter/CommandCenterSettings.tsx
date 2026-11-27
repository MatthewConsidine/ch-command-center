import { FolderPlus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { WorkspaceDeleteConfirmDialog } from '@renderer/components/resourceCatalog/dialogs/workspace'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAddWorkspaceFolder } from '@renderer/hooks/agent/useAddWorkspaceFolder'
import { AGENT_WORKSPACE_TYPE, type AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import { listLeadWorkspaces, mapWorkspaceAgents } from './commandCenterProjects'

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
  const { data: chiefLatest } = useQuery('/agent-sessions/latest', {
    query: { agentId: chiefAgentId || 'unlinked' }
  })
  const { data: tasks } = useQuery('/agent-tasks', { query: { limit: 500 } })
  const { data: sessions } = useQuery('/agent-sessions', { query: { limit: 200 } })
  const { addFolder, adding } = useAddWorkspaceFolder()
  const [removing, setRemoving] = useState<AgentWorkspaceEntity | null>(null)
  const allUserWorkspaces = useMemo(
    () => (workspaces ?? []).filter((workspace) => workspace.type === AGENT_WORKSPACE_TYPE.USER),
    [workspaces]
  )
  const agentsByWorkspace = useMemo(() => mapWorkspaceAgents(sessions?.items ?? []), [sessions])
  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const userWorkspaces = useMemo(() => {
    const excluded = new Set<string>()
    if (chiefAgentId && chiefLatest?.session?.workspaceId) excluded.add(chiefLatest.session.workspaceId)
    for (const task of tasks?.items ?? []) {
      if (task.workspace.type === 'user') excluded.add(task.workspace.workspaceId)
    }
    return listLeadWorkspaces(workspaces ?? [], excluded)
  }, [chiefAgentId, chiefLatest, tasks, workspaces])

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

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-sm">{t('commandCenter.workspacesTitle')}</span>
          <Button type="button" variant="outline" size="sm" disabled={adding} onClick={() => void addFolder()}>
            <FolderPlus className="size-4" />
            {t('commandCenter.addFolder')}
          </Button>
        </div>
        {allUserWorkspaces.map((workspace) => {
          const used = (agentsByWorkspace.get(workspace.id) ?? []).map((id) => agentNames.get(id) ?? id)
          return (
            <div key={workspace.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{workspace.name}</div>
                <div className="truncate text-muted-foreground text-xs" title={workspace.path}>
                  {workspace.path}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {used.length > 0
                    ? t('commandCenter.workspaceUsedBy', { agents: used.join(', ') })
                    : t('commandCenter.workspaceUnused')}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('commandCenter.removeWorkspace')}
                onClick={() => setRemoving(workspace)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          )
        })}
      </div>

      {removing && (
        <WorkspaceDeleteConfirmDialog workspace={removing} onDeleted={() => undefined} onClose={() => setRemoving(null)} />
      )}
    </div>
  )
}
