import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { AgentWizardShortcutSeeder } from '@data/db/seeding/seeders/agentWizardShortcutSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

describe('agent wizard shortcut upgrade', () => {
  const dbh = setupTestDatabase()
  const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
  const shortcut = (id: string) => {
    const target: SidebarShortcutTarget = { kind: 'resource', locator: { providerId: 'core.app', resourceId: id } }
    return { type: 'shortcut', id: createSidebarShortcutId(target), target }
  }
  const save = (value: unknown[]) =>
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'ui.sidebar_shortcut', value }).run()
  const read = () => dbh.db.select().from(preferenceTable).where(scope).get()?.value
  const seed = () => new SeedRunner(dbh.db).runAll([new AgentWizardShortcutSeeder()])

  it('pins the wizard right after the Command Center, and respects removal after upgrade', () => {
    const original = [shortcut('agents'), shortcut('command_center'), shortcut('notes')]
    save(original)
    seed()
    expect(read()).toEqual([
      shortcut('agents'),
      shortcut('command_center'),
      shortcut('agent_wizard'),
      shortcut('notes')
    ])
    dbh.db.update(preferenceTable).set({ value: original }).where(scope).run()
    seed()
    expect(read()).toEqual(original)
  })

  it('pins it at the top when the Command Center is not in the sidebar', () => {
    save([shortcut('agents')])
    seed()
    expect(read()).toEqual([shortcut('agent_wizard'), shortcut('agents')])
  })
})
