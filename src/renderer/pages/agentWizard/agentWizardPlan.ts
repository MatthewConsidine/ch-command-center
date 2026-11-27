import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { UniqueModelId } from '@shared/data/types/model'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import type { AgentTemplate, WorkerFile } from '@shared/ipc/schemas/commandCenter'

/** The user's choices on the wizard's steps, starting from a template. */
export interface WizardChoices {
  template: AgentTemplate
  /** Leads and workers: one per project. Chief and scheduled: the workspace the agent runs in. */
  workspaces: AgentWorkspaceEntity[]
  name: string
  prompt: string
  model?: string
  planModel?: string
  smallModel?: string
  permissionMode?: AgentPermissionMode
  schedule?: string
}

export type WizardAction =
  | {
      kind: 'agent'
      command: CreateAgentCommand
      /** Lead of this workspace id in the Command Center. */
      leadOf?: string
      chief?: boolean
      task?: { name: string; prompt: string; cron: string; workspaceId: string }
    }
  | { kind: 'worker'; workspaceId: string; worker: WorkerFile & { prompt: string } }

export const fillProject = (text: string, project: string) => text.replaceAll('{project}', project)

const SCHEDULED_RUN_PROMPT = 'Do your scheduled run now.'

/** Turn the wizard's choices into the agents, tasks and worker files to create, in order. */
export function planWizard(choices: WizardChoices): WizardAction[] {
  const { template } = choices
  if (template.role === 'worker') {
    return choices.workspaces.map((workspace) => ({
      kind: 'worker',
      workspaceId: workspace.id,
      worker: {
        name: template.name,
        description: template.description ?? template.title,
        ...(choices.model ? { model: choices.model } : {}),
        prompt: fillProject(choices.prompt, workspace.name)
      }
    }))
  }

  const agentFor = (project: string): CreateAgentCommand => ({
    type: 'claude-code',
    name: fillProject(choices.name, project),
    ...(template.description ? { description: fillProject(template.description, project) } : {}),
    instructions: fillProject(choices.prompt, project),
    model: choices.model as UniqueModelId,
    ...(choices.planModel ? { planModel: choices.planModel as UniqueModelId } : {}),
    ...(choices.smallModel ? { smallModel: choices.smallModel as UniqueModelId } : {}),
    configuration: {
      // Wizard agents get their identity from the template and the project's files, not onboarding.
      bootstrap_completed: true,
      ...(choices.permissionMode ? { permission_mode: choices.permissionMode } : {})
    }
  })

  if (template.role === 'lead') {
    return choices.workspaces.map((workspace) => ({
      kind: 'agent',
      command: agentFor(workspace.name),
      leadOf: workspace.id
    }))
  }

  const home = choices.workspaces[0]
  const command = agentFor(home?.name ?? '')
  if (template.role === 'chief') return [{ kind: 'agent', command, chief: true }]
  return [
    {
      kind: 'agent',
      command,
      ...(home && choices.schedule
        ? { task: { name: command.name, prompt: SCHEDULED_RUN_PROMPT, cron: choices.schedule, workspaceId: home.id } }
        : {})
    }
  ]
}
