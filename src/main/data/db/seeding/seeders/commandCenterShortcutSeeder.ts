import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import type { DbType, ISeeder } from '@data/db/types'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

export class CommandCenterShortcutSeeder implements ISeeder {
  readonly name = 'command-center-shortcut'
  readonly version = '1'
  readonly description = 'Pin the Command Center shortcut once, at the top, for profiles that already saved a sidebar'

  run(db: DbType): void {
    const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
    const row = db.select().from(preferenceTable).where(scope).get()
    if (!row || !Array.isArray(row.value)) return
    const target: SidebarShortcutTarget = {
      kind: 'resource',
      locator: { providerId: 'core.app', resourceId: 'command_center' }
    }
    const id = createSidebarShortcutId(target)
    if (row.value.some((item) => (item as { id?: unknown } | null)?.id === id)) return
    db.update(preferenceTable)
      .set({ value: [{ type: 'shortcut', id, target }, ...row.value] })
      .where(scope)
      .run()
  }
}
