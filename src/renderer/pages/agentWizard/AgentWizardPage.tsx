import { WandSparkles } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useModels } from '@renderer/hooks/useModel'
import { ipcApi } from '@renderer/ipc'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { Model } from '@shared/data/types/model'
import type { AgentTemplate, WorkerFile } from '@shared/ipc/schemas/commandCenter'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { buildAgentRoster, ROSTER_ROLES, type RosterEntry, type RosterRole } from './agentRoster'
import { AgentWizardDialog } from './AgentWizardDialog'
import { PERMISSION_MODE_KEYS, ROLE_BADGE_KEYS, ROLE_GROUP_KEYS } from './labelKeys'
import { formatModelPrice } from './modelLabel'

interface TemplateListing {
  templates: AgentTemplate[]
  skipped: { file: string; reason: string }[]
  error?: string
}

/** Every agent at a glance, grouped by Command Center role, plus template-driven creation. */
export function AgentWizardPage() {
  const { t } = useTranslation()
  const { agents } = useAgents()
  const { models } = useModels()
  const [chiefAgentId] = usePreference('feature.command_center.chief_agent_id')
  const [leadAgents] = usePreference('feature.command_center.lead_agents')
  const [templatesDir, setTemplatesDir] = usePreference('feature.command_center.templates_dir')
  const { data: workspaceData, refetch: refetchWorkspaces } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetchWorkspaces())
  const { data: sessionData } = useQuery('/agent-sessions', { query: { limit: 200 } })
  const { data: taskData } = useQuery('/agent-tasks', { query: { limit: 500 } })

  const workspaces = useMemo(
    () => (workspaceData ?? []).filter((workspace) => workspace.type === AGENT_WORKSPACE_TYPE.USER),
    [workspaceData]
  )
  const roster = useMemo(
    () =>
      buildAgentRoster({
        agents,
        workspaces,
        sessions: sessionData?.items ?? [],
        tasks: taskData?.items ?? [],
        leadAgents,
        chiefAgentId
      }),
    [agents, workspaces, sessionData, taskData, leadAgents, chiefAgentId]
  )
  const modelsById = useMemo(() => new Map(models.map((model) => [model.id as string, model])), [models])

  const [listing, setListing] = useState<TemplateListing>({ templates: [], skipped: [] })
  const loadTemplates = useCallback(async () => {
    if (!templatesDir) return setListing({ templates: [], skipped: [] })
    const dir = AbsoluteFilePathSchema.safeParse(templatesDir)
    if (!dir.success) return setListing({ templates: [], skipped: [], error: t('agentWizard.templates.notAbsolute') })
    try {
      setListing(await ipcApi.request('command_center.templates.list', { dir: dir.data }))
    } catch (error) {
      setListing({ templates: [], skipped: [], error: error instanceof Error ? error.message : String(error) })
    }
  }, [templatesDir, t])
  useEffect(() => void loadTemplates(), [loadTemplates])

  const [workers, setWorkers] = useState<Record<string, WorkerFile[]>>({})
  const loadWorkers = useCallback(async () => {
    if (workspaces.length === 0) return
    setWorkers(
      await ipcApi.request('command_center.workers.list', { workspaceIds: workspaces.map((workspace) => workspace.id) })
    )
  }, [workspaces])
  useEffect(() => void loadWorkers(), [loadWorkers])

  const [editTarget, setEditTarget] = useState<ResourceEditDialogTarget | null>(null)
  const [wizardTemplate, setWizardTemplate] = useState<AgentTemplate | null>(null)
  const leadTemplate = listing.templates.find((template) => template.role === 'lead')

  const workerRows = useMemo(() => {
    const byName = new Map<string, { worker: WorkerFile; projects: string[] }>()
    for (const workspace of workspaces) {
      for (const worker of workers[workspace.id] ?? []) {
        const row = byName.get(worker.name) ?? { worker, projects: [] }
        row.projects.push(workspace.name)
        byName.set(worker.name, row)
      }
    }
    return [...byName.values()].sort((a, b) => a.worker.name.localeCompare(b.worker.name))
  }, [workers, workspaces])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl">{t('agentWizard.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('agentWizard.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {leadTemplate && (
              <Button onClick={() => setWizardTemplate(leadTemplate)}>
                <WandSparkles className="size-4" />
                {t('agentWizard.setupLeads')}
              </Button>
            )}
          </div>
        </header>

        {roster.projectsWithoutLead.length > 0 && (
          <div
            role="note"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-border bg-warning-subtle px-4 py-2.5 text-sm text-warning-subtle-foreground">
            <span>
              {t('agentWizard.noLead', {
                projects: roster.projectsWithoutLead.map((workspace) => workspace.name).join(', ')
              })}
            </span>
            {leadTemplate && (
              <Button size="sm" variant="outline" onClick={() => setWizardTemplate(leadTemplate)}>
                {t('agentWizard.createLeads')}
              </Button>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agentWizard.column.agent')}</TableHead>
                <TableHead>{t('agentWizard.column.role')}</TableHead>
                <TableHead>{t('agentWizard.column.models')}</TableHead>
                <TableHead>{t('agentWizard.column.lastActive')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.edit')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROSTER_ROLES.map((role) => (
                <RosterGroup
                  key={role}
                  role={role}
                  entries={roster.entries.filter((entry) => entry.role === role)}
                  modelsById={modelsById}
                  onEdit={(id) => setEditTarget({ kind: 'agent', id })}
                />
              ))}
              {workerRows.length > 0 && <GroupRow label={t(ROLE_GROUP_KEYS.worker)} />}
              {workerRows.map(({ worker, projects }) => (
                <TableRow key={worker.name}>
                  <TableCell>
                    <div className="font-medium">{worker.name}</div>
                    <div className="text-muted-foreground text-xs">{worker.description}</div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role="worker" /> {projects.join(', ')}
                  </TableCell>
                  <TableCell className="text-sm">{worker.model ?? 'inherit'}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-xs">{t('agentWizard.priceNote')}</p>
      </main>

      <aside className="flex w-80 flex-none flex-col gap-3 overflow-y-auto border-border border-l p-5">
        <h2 className="font-semibold text-base">{t('agentWizard.templates.title')}</h2>
        <TemplatesFolder value={templatesDir} onSave={(dir) => void setTemplatesDir(dir)} />
        {listing.error && <p className="text-destructive text-xs">{listing.error}</p>}
        {templatesDir && !listing.error && listing.templates.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('agentWizard.templates.none')}</p>
        )}
        {listing.templates.map((template) => (
          <button
            key={template.file}
            type="button"
            onClick={() => setWizardTemplate(template)}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent">
            <span className="font-medium text-sm">{template.title}</span>
            <span className="text-muted-foreground text-xs">
              {t(ROLE_GROUP_KEYS[template.role])} · {template.file}
            </span>
          </button>
        ))}
        {listing.skipped.map(({ file, reason }) => (
          <p key={file} className="text-muted-foreground text-xs">
            {t('agentWizard.templates.skipped', { file, reason })}
          </p>
        ))}
      </aside>

      <ResourceEditDialogHost target={editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />
      {wizardTemplate && (
        <AgentWizardDialog
          template={wizardTemplate}
          workspaces={workspaces}
          models={models}
          roster={roster}
          workers={workers}
          onClose={() => {
            setWizardTemplate(null)
            void loadWorkers()
          }}
        />
      )}
    </div>
  )
}

function TemplatesFolder({ value, onSave }: { value: string; onSave: (dir: string) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="agent-wizard-templates-dir">{t('agentWizard.templates.folder')}</Label>
      <div className="flex gap-2">
        <Input
          id="agent-wizard-templates-dir"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="C:\\…\\templates"
        />
        <Button variant="outline" disabled={draft.trim() === value} onClick={() => onSave(draft.trim())}>
          {t('common.save')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('agentWizard.templates.hint')}</p>
    </div>
  )
}

function GroupRow({ label }: { label: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={5} className="pt-5 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </TableCell>
    </TableRow>
  )
}

function RoleBadge({ role }: { role: RosterRole | 'worker' }) {
  const { t } = useTranslation()
  return <Badge variant={role === 'chief' ? 'outline' : 'secondary'}>{t(ROLE_BADGE_KEYS[role])}</Badge>
}

function RosterGroup({
  role,
  entries,
  modelsById,
  onEdit
}: {
  role: RosterRole
  entries: RosterEntry[]
  modelsById: Map<string, Model>
  onEdit: (agentId: string) => void
}) {
  const { t } = useTranslation()
  if (entries.length === 0) return null
  return (
    <>
      <GroupRow label={t(ROLE_GROUP_KEYS[role])} />
      {entries.map(({ agent, projects, tasks, lastActiveAt }) => (
        <TableRow key={agent.id}>
          <TableCell>
            <div className="font-medium">{agent.name}</div>
            {agent.configuration?.permission_mode && (
              <div className="text-muted-foreground text-xs">
                {t(PERMISSION_MODE_KEYS[agent.configuration.permission_mode])}
              </div>
            )}
          </TableCell>
          <TableCell>
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge role={role} />
              {projects.length > 0 && <span className="text-sm">{projects.join(', ')}</span>}
              {tasks > 0 && (
                <span className="text-muted-foreground text-xs">{t('agentWizard.tasks', { n: tasks })}</span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <ModelSlot label={t('agentWizard.slot.main')} model={agent.model} modelsById={modelsById} />
            <ModelSlot label={t('agentWizard.slot.plan')} model={agent.planModel} modelsById={modelsById} />
            <ModelSlot label={t('agentWizard.slot.small')} model={agent.smallModel} modelsById={modelsById} />
          </TableCell>
          <TableCell className="whitespace-nowrap text-sm">
            {lastActiveAt ? new Date(lastActiveAt).toLocaleString() : t('agentWizard.never')}
          </TableCell>
          <TableCell>
            <Button size="sm" variant="outline" onClick={() => onEdit(agent.id)}>
              {t('common.edit')}
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

function ModelSlot({
  label,
  model,
  modelsById
}: {
  label: ReactNode
  model: string | null | undefined
  modelsById: Map<string, Model>
}) {
  if (!model) return null
  const resolved = modelsById.get(model)
  return (
    <div className="flex items-baseline gap-2 text-xs leading-relaxed">
      <span className="w-10 flex-none text-muted-foreground">{label}</span>
      <span className="text-sm">{resolved?.name ?? model}</span>
      <span className="text-muted-foreground">{formatModelPrice(resolved)}</span>
    </div>
  )
}
