import * as z from 'zod'

import { AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { defineRoute } from '../define'

/**
 * Command Center IPC schemas — the Agent Wizard's file work: reading role templates from the
 * user's templates folder, and listing or adding worker (sub-agent) files inside project workspaces.
 */

export const AGENT_TEMPLATE_ROLES = ['chief', 'lead', 'worker', 'scheduled'] as const
export const AgentTemplateRoleSchema = z.enum(AGENT_TEMPLATE_ROLES)
export type AgentTemplateRole = z.infer<typeof AgentTemplateRoleSchema>

/** `{project}` in `name` and `prompt` is replaced with each project's name. */
export const AgentTemplateSchema = z.object({
  file: z.string().min(1),
  role: AgentTemplateRoleSchema,
  title: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Agents: a Cherry model id (`provider::model`). Workers: a sub-agent model (`inherit`, `haiku`, …). */
  model: z.string().optional(),
  planModel: z.string().optional(),
  smallModel: z.string().optional(),
  permissionMode: AgentPermissionModeSchema.optional(),
  /** Scheduled agents: a five-field cron expression. */
  schedule: z.string().optional(),
  /** Chief and scheduled agents: the name of the workspace they run in. */
  workspace: z.string().optional(),
  prompt: z.string()
})
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>

/** Lowercase letters, digits and dashes: it becomes `.claude/agents/<name>.md`. */
export const WorkerNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)

export const WorkerFileSchema = z.object({
  name: WorkerNameSchema,
  description: z.string(),
  model: z.string().optional()
})
export type WorkerFile = z.infer<typeof WorkerFileSchema>

export const commandCenterRequestSchemas = {
  'command_center.templates.list': defineRoute({
    input: z.strictObject({ dir: AbsoluteFilePathSchema }),
    output: z.object({
      templates: z.array(AgentTemplateSchema),
      skipped: z.array(z.object({ file: z.string(), reason: z.string() }))
    })
  }),
  /** Worker files found in each user workspace, keyed by workspace id. */
  'command_center.workers.list': defineRoute({
    input: z.strictObject({ workspaceIds: z.array(z.string().min(1)).max(200) }),
    output: z.record(z.string(), z.array(WorkerFileSchema))
  }),
  /** Create-only: an existing worker file is never overwritten. */
  'command_center.workers.create': defineRoute({
    input: z.strictObject({
      workspaceId: z.string().min(1),
      worker: WorkerFileSchema.extend({ prompt: z.string() })
    }),
    output: z.object({ created: z.boolean() })
  })
}
