import { Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, ScrollArea, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ConversationNavigationPane } from '@renderer/components/chat/shell/ConversationNavigationPane'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionStreamStatuses } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { findLatestSession, listCommandCenterProjects, summarizeProject } from './commandCenterProjects'
import { CommandCenterSettings } from './CommandCenterSettings'
import { ProjectCard } from './ProjectCard'

interface CommandCenterPaneProps {
  activeSessionId: string | null
  sessions: readonly AgentSessionEntity[]
  /** Workspace the chief chats in; the chief's sessions elsewhere are skipped. */
  chiefWorkspaceId?: string | null
  onSelectSession: (sessionId: string) => void
  /** Start a session for `agentId`, in `workspaceId` when given. */
  onStartSession: (agentId: string, workspaceId?: string) => void
}

/** Newest sessions per project that get a live status subscription. */
const STATUS_SESSIONS_PER_PROJECT = 12

const ROW_CLASS =
  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent data-[active=true]:bg-accent'

/** Command Center navigation: the chief at the top, then one live card per project. */
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
  const { data: tasks, refetch: refetchTasks } = useQuery('/agent-tasks', { query: { limit: 500 } })
  useDataChange('/agent-tasks', () => void refetchTasks())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const projects = useMemo(
    () => listCommandCenterProjects(workspaces ?? [], sessions, leadAgents, chiefAgentId),
    [chiefAgentId, leadAgents, sessions, workspaces]
  )
  const statusSessionIds = useMemo(
    () =>
      projects.flatMap(({ workspace }) =>
        sessions
          .filter((session) => session.workspaceId === workspace.id)
          .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
          .slice(0, STATUS_SESSIONS_PER_PROJECT)
          .map((session) => session.id)
      ),
    [projects, sessions]
  )
  const streamStatuses = useAgentSessionStreamStatuses(statusSessionIds)
  const summaries = useMemo(
    () =>
      new Map(
        projects.map(({ workspace }) => [
          workspace.id,
          summarizeProject(workspace.id, sessions, streamStatuses, tasks?.items ?? [])
        ])
      ),
    [projects, sessions, streamStatuses, tasks]
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
              <ProjectCard
                key={workspace.id}
                name={workspace.name}
                leadName={(leadAgentId && agentNames.get(leadAgentId)) || t('commandCenter.noLead')}
                summary={summaries.get(workspace.id)!}
                active={!chiefActive && activeSession?.workspaceId === workspace.id}
                activeSessionId={activeSessionId}
                onOpenProject={() => openAgent(leadAgentId, workspace.id)}
                onOpenSession={onSelectSession}
              />
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
