import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'
import { formatRelativeTime } from '@renderer/utils/time'

import type { ProjectCardSummary, SessionState } from './commandCenterProjects'

const STATE_DOT: Record<SessionState, string> = {
  running: 'bg-success animate-pulse',
  waiting: 'bg-warning',
  failed: 'bg-destructive',
  done: 'bg-muted-foreground/40'
}

interface ProjectCardProps {
  name: string
  leadName: string
  summary: ProjectCardSummary
  active: boolean
  activeSessionId: string | null
  onOpenProject: () => void
  onOpenSession: (sessionId: string) => void
}

/** A project in the Command Center: lead, busy/idle, recent sessions, approvals waiting and scheduled tasks. */
export function ProjectCard({
  name,
  leadName,
  summary,
  active,
  activeSessionId,
  onOpenProject,
  onOpenSession
}: ProjectCardProps) {
  const { t, i18n } = useTranslation()
  const { sessions, busy, waitingCount, tasks } = summary

  return (
    <div
      className="flex flex-col rounded-lg border border-border/60 hover:bg-accent/40 data-[active=true]:border-border data-[active=true]:bg-accent/40"
      data-active={active}>
      <button
        type="button"
        className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:bg-accent"
        onClick={onOpenProject}>
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">{name}</span>
          {waitingCount > 0 && (
            <span
              className="rounded-full bg-warning-subtle px-1.5 text-warning-subtle-foreground text-xs leading-5"
              title={t('commandCenter.pendingApprovals', { count: waitingCount })}>
              {waitingCount}
            </span>
          )}
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <span className={cn('size-1.5 rounded-full', busy ? STATE_DOT.running : STATE_DOT.done)} />
            {busy ? t('commandCenter.busy') : t('commandCenter.idle')}
          </span>
        </span>
        <span className="w-full truncate text-muted-foreground text-xs">{leadName}</span>
      </button>

      {(sessions.length > 0 || tasks.length > 0) && (
        <div className="flex flex-col gap-0.5 px-1 pb-1.5">
          {sessions.map(({ session, state }) => (
            <button
              key={session.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent data-[active=true]:bg-accent"
              data-active={session.id === activeSessionId}
              title={t(`commandCenter.state.${state}`)}
              onClick={() => onOpenSession(session.id)}>
              <span className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[state])} />
              <span className="min-w-0 flex-1 truncate text-foreground text-xs">
                {session.name || session.description || t('commandCenter.untitledSession')}
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">
                {state === 'done' || state === 'failed'
                  ? formatRelativeTime(session.lastActivityAt, i18n.language)
                  : t(`commandCenter.state.${state}`)}
              </span>
            </button>
          ))}
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 px-2 py-1 text-muted-foreground text-xs">
              <Clock className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{task.name}</span>
              {task.nextRun && <span className="shrink-0">{formatRelativeTime(task.nextRun, i18n.language)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
