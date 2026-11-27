import { Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, ScrollArea, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { findLatestSession, listCommandCenterProjects } from './commandCenterProjects'
import { CommandCenterSettings } from './CommandCenterSettings'

interface CommandCenterPaneProps {
  activeSessionId: string | null
  sessions: readonly AgentSessionEntity[]
  /** Workspace the chief chats in; the chief's sessions elsewhere are skipped. */
  chiefWorkspaceId?: string | null
  onSelectSession: (sessionId: string) => void
  /** Start a session for `agentId`, in `workspaceId` when given. */
  onStartSession: (agentId: string, workspaceId?: string) => void
}

const ROW_CLASS =
  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent data-[active=true]:bg-accent'

/** Command Center navigation: the chief at the top, then one row per project. */
export function CommandCenterPane({
  activeSessionId,
  sessions,
  chiefWorkspaceId,
  onSelectSession,
  onStartSession
}: CommandCenterPaneProps) {
  const { t } = useTranslation()
  const { agents } = useAgents()
  const [chiefAgentId] = usePreference('feature.command_center.chief_agent_id')
  const [leadAgents] = usePreference('feature.command_center.lead_agents')
  const { data: workspaces, refetch } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetch())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const projects = useMemo(
    () => listCommandCenterProjects(workspaces ?? [], sessions, leadAgents, chiefAgentId),
    [chiefAgentId, leadAgents, sessions, workspaces]
  )
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const chiefActive = !!chiefAgentId && activeSession?.agentId === chiefAgentId

  const openAgent = (agentId: string | undefined, workspaceId?: string) => {
    if (!agentId) {
      setSettingsOpen(true)
      return
    }
    const latest = findLatestSession(sessions, agentId, workspaceId)
    if (latest) onSelectSession(latest.id)
    else onStartSession(agentId, workspaceId)
  }

  return (
    <ConversationNavigationPane>
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="font-medium text-sm">{t('commandCenter.title')}</span>
        <Tooltip content={t('commandCenter.settings')}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('commandCenter.settings')}
            onClick={() => setSettingsOpen(true)}>
            <Settings2 />
          </Button>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-2 pb-3">
          <button
            type="button"
            className={ROW_CLASS}
            data-active={chiefActive}
            onClick={() => openAgent(chiefAgentId || undefined, chiefWorkspaceId || undefined)}>
            <span className="font-medium text-foreground text-sm">
              {agentNames.get(chiefAgentId) ?? t('commandCenter.chief')}
            </span>
            <span className="text-muted-foreground text-xs">{t('commandCenter.chief')}</span>
          </button>

          <span className="px-3 pt-3 pb-1 text-muted-foreground text-xs">{t('commandCenter.projects')}</span>
          {projects.length === 0 ? (
            <p className="px-3 text-muted-foreground text-sm">{t('commandCenter.noProjects')}</p>
          ) : (
            projects.map(({ workspace, leadAgentId }) => (
              <button
                key={workspace.id}
                type="button"
                className={ROW_CLASS}
                data-active={!chiefActive && activeSession?.workspaceId === workspace.id}
                onClick={() => openAgent(leadAgentId, workspace.id)}>
                <span className="w-full truncate font-medium text-foreground text-sm">{workspace.name}</span>
                <span className="w-full truncate text-muted-foreground text-xs">
                  {(leadAgentId && agentNames.get(leadAgentId)) || t('commandCenter.noLead')}
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('commandCenter.settings')}</DialogTitle>
          </DialogHeader>
          <CommandCenterSettings />
        </DialogContent>
      </Dialog>
    </ConversationNavigationPane>
  )
}
