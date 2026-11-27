import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import matter from 'gray-matter'
import { parse } from 'yaml'

import { type AgentTemplate, AgentTemplateSchema } from '@shared/ipc/schemas/commandCenter'

export interface AgentTemplateListing {
  templates: AgentTemplate[]
  skipped: { file: string; reason: string }[]
}

// CRLF files leave a bare CR after gray-matter's slice, which YAML rejects; failsafe keeps every value a string.
const parseYaml = (block: string) => parse(block.replace(/\r\n?/g, '\n'), { schema: 'failsafe' }) as object

/** Parse one template file; `null` means it is not a template (no `role` in its frontmatter). */
export function parseAgentTemplate(file: string, raw: string): AgentTemplate | { error: string } | null {
  const { data, content } = matter(raw, { engines: { yaml: parseYaml } })
  if (data.role === undefined) return null
  const stem = path.basename(file, path.extname(file))
  const parsed = AgentTemplateSchema.safeParse({
    file,
    role: data.role,
    title: data.title ?? stem,
    name: data.name ?? (data.role === 'lead' ? '{project} agent' : stem),
    description: data.description,
    model: data.model,
    planModel: data.plan_model,
    smallModel: data.small_model,
    permissionMode: data.permission_mode,
    schedule: data.schedule,
    workspace: data.workspace,
    prompt: content.trim()
  })
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  return { error: `${issue.path.join('.') || 'file'}: ${issue.message}` }
}

/** Read every `*.md` role template in a folder, in file-name order. */
export async function listAgentTemplates(dir: string): Promise<AgentTemplateListing> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const listing: AgentTemplateListing = { templates: [], skipped: [] }
  for (const file of files) {
    const result = parseAgentTemplate(file, await readFile(path.join(dir, file), 'utf8'))
    if (result === null) continue
    if ('error' in result) listing.skipped.push({ file, reason: result.error })
    else listing.templates.push(result)
  }
  return listing
}
