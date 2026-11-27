import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

import type { RosterRole } from './agentRoster'

type Role = RosterRole | 'worker'

/** i18n keys spelled out in full so the extractor and checker can see them. */
export const ROLE_GROUP_KEYS: Record<Role, string> = {
  chief: 'agentWizard.role.chief',
  lead: 'agentWizard.role.lead',
  scheduled: 'agentWizard.role.scheduled',
  other: 'agentWizard.role.other',
  builtin: 'agentWizard.role.builtin',
  worker: 'agentWizard.role.worker'
}

export const ROLE_BADGE_KEYS: Record<Role, string> = {
  chief: 'agentWizard.badge.chief',
  lead: 'agentWizard.badge.lead',
  scheduled: 'agentWizard.badge.scheduled',
  other: 'agentWizard.badge.other',
  builtin: 'agentWizard.badge.builtin',
  worker: 'agentWizard.badge.worker'
}

export const STEP_KEYS = {
  targets: 'agentWizard.step.targets',
  prompt: 'agentWizard.step.prompt',
  review: 'agentWizard.step.review'
} as const

export const PERMISSION_MODE_KEYS: Record<AgentPermissionMode, string> = {
  default: 'agent.settings.tooling.permissionMode.default.title',
  acceptEdits: 'agent.settings.tooling.permissionMode.acceptEdits.title',
  bypassPermissions: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
  plan: 'agent.settings.tooling.permissionMode.plan.title',
  auto: 'agent.settings.tooling.permissionMode.auto.title'
}
