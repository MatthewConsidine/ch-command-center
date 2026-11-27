import { agentWorkspaceService } from '@main/data/services/AgentWorkspaceService'
import { listAgentTemplates } from '@main/features/commandCenter/agentTemplates'
import { createWorkerFile, listWorkerFiles } from '@main/features/commandCenter/workerFiles'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { commandCenterRequestSchemas, WorkerFile } from '@shared/ipc/schemas/commandCenter'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Worker files are only ever read or written inside a registered user workspace. */
function userWorkspacePath(workspaceId: string): string {
  const workspace = agentWorkspaceService.getById(workspaceId)
  if (workspace.type !== AGENT_WORKSPACE_TYPE.USER) throw new Error('Worker files live in user workspaces only')
  return workspace.path
}

export const commandCenterHandlers: IpcHandlersFor<typeof commandCenterRequestSchemas> = {
  'command_center.templates.list': ({ dir }) => listAgentTemplates(dir),
  'command_center.workers.list': async ({ workspaceIds }) => {
    const result: Record<string, WorkerFile[]> = {}
    for (const id of workspaceIds) result[id] = await listWorkerFiles(userWorkspacePath(id))
    return result
  },
  'command_center.workers.create': async ({ workspaceId, worker }) => ({
    created: await createWorkerFile(userWorkspacePath(workspaceId), worker)
  })
}
