import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('useAddWorkspaceFolder')

/** Pick a folder with the native dialog and register it as a workspace. Resolves null when cancelled or failed. */
export function useAddWorkspaceFolder() {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [adding, setAdding] = useState(false)

  const addFolder = useCallback(async (): Promise<AgentWorkspaceEntity | null> => {
    setAdding(true)
    try {
      const folderPath = await window.api.file.selectFolder({ properties: ['openDirectory', 'createDirectory'] })
      if (!folderPath) return null
      const workspace = await ipcApi.request('ai.agent.workspace.register', {
        path: AbsoluteFilePathSchema.parse(folderPath)
      })
      await invalidate('/agent-workspaces')
      return workspace
    } catch (error) {
      logger.error('Failed to add workspace folder', error as Error)
      toast.error(t('commandCenter.addFolderFailed'))
      return null
    } finally {
      setAdding(false)
    }
  }, [invalidate, t])

  return { addFolder, adding }
}
