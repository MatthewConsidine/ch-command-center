import { FolderPlus } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAddWorkspaceFolder } from '@renderer/hooks/agent/useAddWorkspaceFolder'
import { ipcApi } from '@renderer/ipc'
import { type AgentPermissionMode, AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { Model } from '@shared/data/types/model'
import type { AgentTemplate, WorkerFile } from '@shared/ipc/schemas/commandCenter'

import type { AgentRoster } from './agentRoster'
import { planWizard, type WizardAction } from './agentWizardPlan'
import { PERMISSION_MODE_KEYS, ROLE_GROUP_KEYS, STEP_KEYS } from './labelKeys'
import { formatModelPrice } from './modelLabel'

const SAME_AS_MAIN = '__same__'
const WORKER_MODELS = ['inherit', 'haiku', 'sonnet', 'opus']
const STEPS = ['targets', 'prompt', 'review'] as const

interface AgentWizardDialogProps {
  template: AgentTemplate
  workspaces: AgentWorkspaceEntity[]
  models: readonly Model[]
  roster: AgentRoster
  workers: Record<string, WorkerFile[]>
  onClose: () => void
}

type Outcome = { label: string; ok: boolean; note?: string }

/** Create agents or worker files from one template: targets and models, prompt, then review. */
export function AgentWizardDialog({ template, workspaces, models, roster, workers, onClose }: AgentWizardDialogProps) {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const { addFolder, adding } = useAddWorkspaceFolder()
  const [leadAgents, setLeadAgents] = usePreference('feature.command_center.lead_agents')
  const [, setChiefAgentId] = usePreference('feature.command_center.chief_agent_id')

  const perProject = template.role === 'lead' || template.role === 'worker'
  const isAgent = template.role !== 'worker'
  const unavailable = (workspace: AgentWorkspaceEntity) =>
    template.role === 'lead'
      ? !roster.projectsWithoutLead.some((project) => project.id === workspace.id)
      : (workers[workspace.id] ?? []).some((worker) => worker.name === template.name)

  const chatModels = useMemo(() => models.filter((model) => model.isEnabled !== false), [models])
  const initialModel = isAgent
    ? (chatModels.find((model) => model.id === template.model)?.id ?? chatModels[0]?.id ?? '')
    : (template.model ?? 'inherit')

  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<string[]>(() =>
    perProject
      ? workspaces.filter((workspace) => !unavailable(workspace)).map((workspace) => workspace.id)
      : [(workspaces.find((workspace) => workspace.name === template.workspace) ?? workspaces[0])?.id ?? '']
  )
  const [name, setName] = useState(template.name)
  const [prompt, setPrompt] = useState(template.prompt)
  const [model, setModel] = useState<string>(initialModel)
  const [planModel, setPlanModel] = useState(template.planModel ?? SAME_AS_MAIN)
  const [smallModel, setSmallModel] = useState(template.smallModel ?? SAME_AS_MAIN)
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(template.permissionMode ?? 'default')
  const [schedule, setSchedule] = useState(template.schedule ?? '')
  const [hookUp, setHookUp] = useState(true)
  const [running, setRunning] = useState(false)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)

  const actions: WizardAction[] = useMemo(
    () =>
      planWizard({
        template,
        workspaces: workspaces.filter((workspace) => selected.includes(workspace.id)),
        name,
        prompt,
        model,
        ...(planModel !== SAME_AS_MAIN ? { planModel } : {}),
        ...(smallModel !== SAME_AS_MAIN ? { smallModel } : {}),
        ...(isAgent ? { permissionMode } : {}),
        ...(template.role === 'scheduled' ? { schedule } : {})
      }),
    [template, workspaces, selected, name, prompt, model, planModel, smallModel, permissionMode, schedule, isAgent]
  )
  const ready =
    actions.length > 0 && !!model && name.trim() !== '' && (template.role !== 'scheduled' || schedule.trim() !== '')

  const projectName = (action: Extract<WizardAction, { kind: 'worker' }>) =>
    workspaces.find((workspace) => workspace.id === action.workspaceId)?.name ?? ''

  const create = async () => {
    setRunning(true)
    const results: Outcome[] = []
    const leads = { ...leadAgents }
    for (const action of actions) {
      const label = action.kind === 'agent' ? action.command.name : `${action.worker.name} · ${projectName(action)}`
      try {
        if (action.kind === 'worker') {
          const { created } = await ipcApi.request('command_center.workers.create', {
            workspaceId: action.workspaceId,
            worker: action.worker
          })
          results.push({ label, ok: created, note: created ? undefined : t('agentWizard.result.exists') })
          continue
        }
        const agent = await ipcApi.request('ai.agent.create', action.command)
        if (action.leadOf && hookUp) leads[action.leadOf] = agent.id
        if (action.chief && hookUp) await setChiefAgentId(agent.id)
        if (action.task) {
          await ipcApi.request('ai.agent.task.create', {
            agentId: agent.id,
            name: action.task.name,
            prompt: action.task.prompt,
            trigger: { kind: 'cron', expr: action.task.cron },
            workspace: { type: 'user', workspaceId: action.task.workspaceId }
          })
        }
        results.push({ label, ok: true })
      } catch (error) {
        results.push({ label, ok: false, note: error instanceof Error ? error.message : String(error) })
      }
    }
    if (template.role === 'lead' && hookUp) await setLeadAgents(leads)
    await invalidate('/agents')
    setOutcomes(results)
    setRunning(false)
  }

  const modelOption = (option: Model) => (
    <SelectItem key={option.id} value={option.id}>
      {option.name} <span className="text-muted-foreground">{formatModelPrice(option)}</span>
    </SelectItem>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {template.title} · {t(ROLE_GROUP_KEYS[template.role])}
          </DialogTitle>
          <ol className="flex flex-wrap gap-4 pt-2 text-sm">
            {STEPS.map((key, index) => (
              <li
                key={key}
                aria-current={index === step ? 'step' : undefined}
                className={index === step ? 'font-semibold' : 'text-muted-foreground'}>
                {index + 1}. {t(STEP_KEYS[key])}
              </li>
            ))}
          </ol>
        </DialogHeader>

        {outcomes ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {outcomes.map((outcome, index) => (
              <li key={index} className={outcome.ok ? '' : 'text-destructive'}>
                {outcome.ok ? '✓' : '✗'} {outcome.label}
                {outcome.note && <span className="text-muted-foreground"> · {outcome.note}</span>}
              </li>
            ))}
          </ul>
        ) : step === 0 ? (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium text-sm">
                {perProject ? t('agentWizard.projects') : t('agentWizard.workspace')}
              </legend>
              {perProject ? (
                workspaces.map((workspace) => (
                  <label key={workspace.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(workspace.id)}
                      disabled={unavailable(workspace)}
                      onCheckedChange={(checked) =>
                        setSelected((ids) =>
                          checked ? [...ids, workspace.id] : ids.filter((id) => id !== workspace.id)
                        )
                      }
                    />
                    {workspace.name}
                    {unavailable(workspace) && (
                      <span className="text-muted-foreground text-xs">
                        {template.role === 'lead' ? t('agentWizard.hasLead') : t('agentWizard.hasWorker')}
                      </span>
                    )}
                  </label>
                ))
              ) : (
                <Select value={selected[0]} onValueChange={(id) => setSelected([id])}>
                  <SelectTrigger aria-label={t('agentWizard.workspace')} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={adding}
                onClick={() =>
                  void addFolder().then((workspace) => {
                    if (!workspace) return
                    setSelected((ids) => (perProject ? [...new Set([...ids, workspace.id])] : [workspace.id]))
                  })
                }>
                <FolderPlus className="size-4" />
                {t('commandCenter.addFolder')}
              </Button>
            </fieldset>

            {isAgent && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-wizard-name">{t('agentWizard.name')}</Label>
                <Input id="agent-wizard-name" value={name} onChange={(event) => setName(event.target.value)} />
                {perProject && <p className="text-muted-foreground text-xs">{t('agentWizard.nameHint')}</p>}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="agent-wizard-model"
                label={isAgent ? t('agentWizard.model.main') : t('agentWizard.model.worker')}>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="agent-wizard-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isAgent
                      ? chatModels.map(modelOption)
                      : [...new Set([...WORKER_MODELS, model])].map((alias) => (
                          <SelectItem key={alias} value={alias}>
                            {alias}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </Field>
              {isAgent && (
                <>
                  <Field id="agent-wizard-plan" label={t('agentWizard.model.plan')}>
                    <Select value={planModel} onValueChange={setPlanModel}>
                      <SelectTrigger id="agent-wizard-plan" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SAME_AS_MAIN}>{t('agentWizard.model.same')}</SelectItem>
                        {chatModels.map(modelOption)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="agent-wizard-small" label={t('agentWizard.model.small')}>
                    <Select value={smallModel} onValueChange={setSmallModel}>
                      <SelectTrigger id="agent-wizard-small" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SAME_AS_MAIN}>{t('agentWizard.model.same')}</SelectItem>
                        {chatModels.map(modelOption)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="agent-wizard-permission" label={t('agentWizard.permission')}>
                    <Select
                      value={permissionMode}
                      onValueChange={(mode) => setPermissionMode(AgentPermissionModeSchema.parse(mode))}>
                      <SelectTrigger id="agent-wizard-permission" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AgentPermissionModeSchema.options.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {t(PERMISSION_MODE_KEYS[mode])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              )}
            </div>

            {template.role === 'scheduled' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-wizard-schedule">{t('agentWizard.schedule')}</Label>
                <Input
                  id="agent-wizard-schedule"
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                  placeholder="0 19 * * *"
                />
              </div>
            )}

            {(template.role === 'lead' || template.role === 'chief') && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={hookUp} onCheckedChange={(checked) => setHookUp(checked === true)} />
                {template.role === 'lead' ? t('agentWizard.setLead') : t('agentWizard.setChief')}
              </label>
            )}
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-wizard-prompt">{t('agentWizard.prompt')}</Label>
            <Textarea.Input
              id="agent-wizard-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={14}
            />
            {perProject && <p className="text-muted-foreground text-xs">{t('agentWizard.nameHint')}</p>}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {actions.map((action, index) => (
              <li key={index}>
                {action.kind === 'agent'
                  ? `${action.command.name}${action.task ? ` · ${action.task.cron}` : ''}`
                  : `${action.worker.name} → ${projectName(action)}`}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {outcomes ? (
            <Button onClick={onClose}>{t('common.close')}</Button>
          ) : (
            <>
              {step > 0 && (
                <Button variant="outline" disabled={running} onClick={() => setStep(step - 1)}>
                  {t('common.back')}
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button disabled={!ready} onClick={() => setStep(step + 1)}>
                  {t('common.next')}
                </Button>
              ) : (
                <Button disabled={!ready || running} onClick={() => void create()}>
                  {running ? t('common.loading') : t('agentWizard.create', { n: actions.length })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
