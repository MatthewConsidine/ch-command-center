import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import matter from 'gray-matter'
import { parse, stringify } from 'yaml'

import { type WorkerFile, WorkerFileSchema } from '@shared/ipc/schemas/commandCenter'

/** Claude Code reads a project's sub-agents from here. */
const workerDir = (workspacePath: string) => path.join(workspacePath, '.claude', 'agents')

const parseYaml = (block: string) => parse(block.replace(/\r\n?/g, '\n'), { schema: 'failsafe' }) as object

/** The workers defined in a workspace; files that don't parse as workers are left out. */
export async function listWorkerFiles(workspacePath: string): Promise<WorkerFile[]> {
  let names: string[]
  try {
    names = (await readdir(workerDir(workspacePath))).filter((name) => name.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const workers: WorkerFile[] = []
  for (const file of names.sort((a, b) => a.localeCompare(b))) {
    const { data } = matter(await readFile(path.join(workerDir(workspacePath), file), 'utf8'), {
      engines: { yaml: parseYaml }
    })
    const parsed = WorkerFileSchema.safeParse({
      name: data.name ?? path.basename(file, '.md'),
      description: data.description ?? '',
      model: data.model
    })
    if (parsed.success) workers.push(parsed.data)
  }
  return workers
}

/** Write `.claude/agents/<name>.md`; returns false, untouched, when that worker already exists. */
export async function createWorkerFile(
  workspacePath: string,
  worker: WorkerFile & { prompt: string }
): Promise<boolean> {
  const { name, description, model } = WorkerFileSchema.parse(worker)
  const frontmatter = stringify({ name, description, ...(model ? { model } : {}) }).trimEnd()
  await mkdir(workerDir(workspacePath), { recursive: true })
  try {
    await writeFile(
      path.join(workerDir(workspacePath), `${name}.md`),
      `---\n${frontmatter}\n---\n\n${worker.prompt.trim()}\n`,
      {
        flag: 'wx'
      }
    )
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}
