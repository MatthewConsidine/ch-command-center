import { fetchOpenRouterEndpoints } from '@main/ai/provider/listModels/openRouterEndpoints'
import { agentWorkspaceService } from '@main/data/services/AgentWorkspaceService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { listAgentTemplates } from '@main/features/commandCenter/agentTemplates'
import { createWorkerFile, listWorkerFiles } from '@main/features/commandCenter/workerFiles'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { commandCenterRequestSchemas, WorkerFile } from '@shared/ipc/schemas/commandCenter'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

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
  }),
  'command_center.model_endpoints.list': async ({ modelId }) => {
    const { providerId, modelId: catalogId } = parseUniqueModelId(modelId)
    if (providerId !== SystemProviderIds.openrouter) return []
    const model = modelService.getByKey(providerId, catalogId)
    return fetchOpenRouterEndpoints(
      providerService.getByProviderId(providerId),
      model.apiModelId ?? catalogId,
      AbortSignal.timeout(15_000)
    )
  }
}
