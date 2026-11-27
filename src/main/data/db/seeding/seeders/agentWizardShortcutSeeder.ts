import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import type { DbType, ISeeder } from '@data/db/types'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

const appShortcut = (resourceId: string) => {
  const target: SidebarShortcutTarget = { kind: 'resource', locator: { providerId: 'core.app', resourceId } }
  return { type: 'shortcut', id: createSidebarShortcutId(target), target }
}

export class AgentWizardShortcutSeeder implements ISeeder {
  readonly name = 'agent-wizard-shortcut'
  readonly version = '1'
  readonly description =
    'Pin the Agent Wizard shortcut once, after the Command Center, for profiles with a saved sidebar'

  run(db: DbType): void {
    const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
    const row = db.select().from(preferenceTable).where(scope).get()
    if (!row || !Array.isArray(row.value)) return
    const idOf = (item: unknown) => (item as { id?: unknown } | null)?.id
    const wizard = appShortcut('agent_wizard')
    if (row.value.some((item) => idOf(item) === wizard.id)) return
    const items = [...row.value]
    const after = items.findIndex((item) => idOf(item) === appShortcut('command_center').id)
    items.splice(after + 1, 0, wizard)
    db.update(preferenceTable).set({ value: items }).where(scope).run()
  }
}
