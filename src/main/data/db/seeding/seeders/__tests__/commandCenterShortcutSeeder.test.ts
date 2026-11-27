import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { CommandCenterShortcutSeeder } from '@data/db/seeding/seeders/commandCenterShortcutSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

describe('command center shortcut upgrade', () => {
  const dbh = setupTestDatabase()
  const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
  const shortcut = (id: string) => {
    const target: SidebarShortcutTarget = { kind: 'resource', locator: { providerId: 'core.app', resourceId: id } }
    return { type: 'shortcut', id: createSidebarShortcutId(target), target }
  }
  const read = () => dbh.db.select().from(preferenceTable).where(scope).get()?.value
  const seed = () => new SeedRunner(dbh.db).runAll([new CommandCenterShortcutSeeder()])

  it('adds the shortcut to a saved sidebar at the top, and respects removal after upgrade', () => {
    const original = [shortcut('agents'), shortcut('assistants'), shortcut('notes')]
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'ui.sidebar_shortcut', value: original }).run()
    seed()
    expect(read()).toEqual([shortcut('command_center'), ...original])
    dbh.db.update(preferenceTable).set({ value: original }).where(scope).run()
    seed()
    expect(read()).toEqual(original)
  })

  it('leaves an already pinned shortcut where the user put it', () => {
    const original = [shortcut('agents'), shortcut('command_center')]
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'ui.sidebar_shortcut', value: original }).run()
    seed()
    expect(read()).toEqual(original)
  })
})
