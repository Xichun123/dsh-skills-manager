import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillLookupOptions, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-client-connection'
import { EMPTY_STATE, isEnabledFor, isPathWithin, normalizeState, removeSkill, setEnabled } from './state.js'
import type { ManagerState, SkillCatalog, SkillCatalogEntry, SkillOrigin, SkillScope } from './types.js'

export const name = 'dsh-skills-manager'
export const inject = ['skills', 'connection']

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const skillsCli = join(dirname(require.resolve('skills/package.json')), 'bin', 'cli.mjs')

export interface Config {
  readonly storageDir?: string
}

export const Config: Schema<Config> = Schema.object({
  storageDir: Schema.string().default(''),
})

interface CliSkill {
  readonly name: string
  readonly source?: string
  readonly sourceUrl?: string | null
  readonly sourceType?: string
}

export class SkillManager {
  private readonly root: string
  private readonly library: string
  private readonly stateFile: string
  private state: ManagerState = EMPTY_STATE
  private readonly loaded: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()
  private providerControl: SkillProviderControl | undefined
  private filesystemProvider: FileSystemSkillProvider

  constructor(private readonly ctx: Context, config: Config) {
    const storageDir = config.storageDir?.trim()
    this.root = storageDir ? resolve(storageDir) : join(resolveDshHome(), 'skill-manager')
    this.library = join(this.root, '.agents', 'skills')
    this.stateFile = join(this.root, 'state.json')
    this.filesystemProvider = this.createFilesystemProvider({
      signal: new AbortController().signal,
      invalidate: () => undefined,
    }, false)
    this.loaded = this.load()
  }

  provider(control: SkillProviderControl): SkillProvider {
    this.providerControl = control
    this.filesystemProvider = this.createFilesystemProvider(control, true)

    return {
      name: 'skill-manager',
      list: async (options) => {
        await this.loaded
        return (await this.libraryCandidates(options))
          .filter(candidate => isEnabledFor(this.state, candidate.name, options.cwd))
          .map(candidate => ({
            ...candidate,
            provider: 'skill-manager',
            source: 'skill-manager',
            rank: 50,
            locator: candidate,
          }))
      },
      get: async (candidate, options) => {
        await this.loaded
        return this.filesystemProvider.get(candidate.locator as SkillCandidate, options)
      },
    }
  }

  async catalog(projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const [candidates, cliSkills] = await Promise.all([
      this.libraryCandidates({}),
      this.listCliSkills().catch(() => []),
    ])
    const cliByName = new Map(cliSkills.map(skill => [skill.name, skill]))
    const entries = candidates
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((candidate): SkillCatalogEntry => {
        const origin = originFromCli(cliByName.get(candidate.name))
        return {
          name: candidate.name,
          description: candidate.description,
          ...(origin?.sourceType === 'local' ? { sourceType: 'local' as const, sourcePath: origin.source } : {}),
          ...(origin?.sourceType === 'git' ? { sourceType: 'git' as const, sourceUrl: origin.source } : {}),
          globalEnabled: this.state.globalEnabled.includes(candidate.name),
          projectEnabled: projectRoot !== undefined && (this.state.projectEnabled[projectRoot] ?? []).includes(candidate.name),
          effectiveEnabled: isEnabledFor(this.state, candidate.name, projectRoot),
          updateSupported: origin !== undefined,
        }
      })
    return { entries }
  }

  async install(sourcePath: string, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const source = resolve(sourcePath.trim())
    if (!await isDirectory(source)) throw new Error('skill source must be a directory containing SKILL.md bundles')
    return this.installSource(source, projectRoot, 'local')
  }

  async installRemote(input: string, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    return this.installSource(repositorySource(input), projectRoot, 'git')
  }

  private async installSource(source: string, projectRoot: string | undefined, sourceType: 'local' | 'git'): Promise<SkillCatalog> {
    await validateSource(source, sourceType)
    await this.runSkills('install', ['add', source, '--skill', '*', '--agent', 'universal', '--yes'])
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  async update(name: string, sourcePath: string | undefined, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    await this.assertInstalled(name)
    const explicitOrigin = sourcePath
      ? { source: resolve(sourcePath), sourceType: 'local' as const }
      : undefined
    if (explicitOrigin && !await isDirectory(explicitOrigin.source)) {
      throw new Error('skill source must be a directory containing SKILL.md bundles')
    }
    const origin = explicitOrigin ?? originFromCli((await this.listCliSkills().catch(() => [])).find(skill => skill.name === name))
    if (!origin) throw new Error('the original source is unknown; select the skill source folder to update it')
    await validateSource(origin.source, origin.sourceType)

    await this.runSkills('update', ['add', origin.source, '--skill', name, '--agent', 'universal', '--yes'])
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  async setEnabled(name: string, scope: SkillScope, projectRoot: string | undefined, enabled: boolean): Promise<SkillCatalog> {
    await this.loaded
    await this.assertInstalled(name)
    this.state = setEnabled(this.state, name, scope, projectRoot, enabled)
    await this.persist()
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  async remove(name: string, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    await this.assertInstalled(name)
    await this.runSkills('remove', ['remove', name, '--agent', 'universal', '--yes'])
    await rm(join(this.library, name), { recursive: true, force: true })
    this.state = removeSkill(this.state, name)
    await this.persist()
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  private createFilesystemProvider(control: SkillProviderControl, watch: boolean): FileSystemSkillProvider {
    return new FileSystemSkillProvider(this.ctx, control, {
      providerName: 'skill-manager-library',
      includeDefaultRoots: false,
      customSkillDirs: [this.library],
      watch,
    })
  }

  private async libraryCandidates(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const discovered = await this.filesystemProvider.list(options)
    const candidates = Array.isArray(discovered) ? discovered : discovered.candidates
    return candidates.filter(candidate => basename(candidate.path ?? '').toLowerCase() === 'skill.md')
  }

  private async assertInstalled(name: string): Promise<void> {
    if (!(await this.libraryCandidates({})).some(candidate => candidate.name === name)) {
      throw new Error(`skill is not installed: ${name}`)
    }
  }

  private async listCliSkills(): Promise<CliSkill[]> {
    const output = await this.runSkills('list', ['list', '--json', '--agent', 'universal'])
    const parsed: unknown = JSON.parse(output)
    if (!Array.isArray(parsed)) throw new Error('skills CLI returned an invalid catalog')
    return parsed.filter((entry): entry is CliSkill => isRecord(entry) && typeof entry.name === 'string')
  }

  private async runSkills(action: string, args: readonly string[]): Promise<string> {
    try {
      const result = await execFileAsync(process.execPath, [skillsCli, ...args], {
        cwd: this.root,
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      })
      return result.stdout
    } catch (error) {
      const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
      const stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout.trim() : ''
      const detail = (stderr || stdout).split(/\r?\n/).filter(Boolean).at(-1)
      throw new Error(`skills CLI failed to ${action} the skill${detail ? `: ${detail}` : ''}`)
    }
  }

  private async load(): Promise<void> {
    await mkdir(this.library, { recursive: true })
    try {
      const raw: unknown = JSON.parse(await readFile(this.stateFile, 'utf8'))
      this.state = normalizeState(raw)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.state = EMPTY_STATE
        await this.persist()
        return
      }
      throw error
    }
  }

  private async persist(): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await mkdir(this.root, { recursive: true })
      const temp = `${this.stateFile}.tmp-${randomUUID()}`
      await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
      await rename(temp, this.stateFile)
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
  }
}

export function apply(ctx: Context, config: Config): void {
  if (config.storageDir?.trim() && !isAbsolute(config.storageDir)) {
    throw new Error('storageDir must resolve to an absolute path')
  }
  const manager = new SkillManager(ctx, config)
  ctx.skills.registerProvider(control => manager.provider(control))
  ctx.effect(
    () => ctx.connection.rpc.handle(
      '/skill-manager',
      async (endpoint, payload) => handleRpc(manager, endpoint, payload),
      { authority: 'loopback' },
    ),
    'dsh-skill-manager: rpc',
  )
}

async function handleRpc(manager: SkillManager, endpoint: string, payload: unknown) {
  const args = isRecord(payload) ? payload : {}
  switch (endpoint) {
    case 'list':
      return { ok: true as const, value: await manager.catalog(asOptionalString(args.projectRoot)) }
    case 'install':
      return { ok: true as const, value: await manager.install(requiredString(args.path, 'path'), asOptionalString(args.projectRoot)) }
    case 'install-remote':
      return { ok: true as const, value: await manager.installRemote(requiredString(args.repository, 'repository'), asOptionalString(args.projectRoot)) }
    case 'update':
      return {
        ok: true as const,
        value: await manager.update(
          requiredString(args.name, 'name'),
          asOptionalString(args.path),
          asOptionalString(args.projectRoot),
        ),
      }
    case 'set-enabled':
      return {
        ok: true as const,
        value: await manager.setEnabled(
          requiredString(args.name, 'name'),
          requiredScope(args.scope),
          asOptionalString(args.projectRoot),
          requiredBoolean(args.enabled, 'enabled'),
        ),
      }
    case 'remove':
      return { ok: true as const, value: await manager.remove(requiredString(args.name, 'name'), asOptionalString(args.projectRoot)) }
    default:
      throw new Error(`unknown skill-manager endpoint: ${endpoint}`)
  }
}

const UNSAFE_SYMLINK = 'skill source contains a broken or escaping symlink'

// The CLI dereferences symlinks while copying. This preflight blocks static escapes, but mutable sources can still change afterward.
async function validateSource(source: string, sourceType: 'local' | 'git'): Promise<void> {
  if (sourceType === 'local') {
    await assertSafeSourceTree(source)
    return
  }
  if (await pathExists(source) && (await stat(source)).isDirectory()) {
    await assertSafeSourceTree(source)
    return
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-source-'))
  const checkout = join(temporaryRoot, 'repository')
  try {
    await execFileAsync('git', [
      'clone', '--depth', '1', '--no-recurse-submodules', preflightRepositorySource(source), checkout,
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
    await assertSafeSourceTree(checkout)
  } catch (error) {
    if (error instanceof Error && error.message === UNSAFE_SYMLINK) throw error
    throw new Error('unable to inspect repository source for unsafe symlinks')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function assertSafeSourceTree(root: string): Promise<void> {
  const canonicalRoot = await realpath(root)
  const visited = new Set<string>()
  await visit(canonicalRoot)

  async function visit(directory: string): Promise<void> {
    const canonicalDirectory = await realpath(directory)
    if (visited.has(canonicalDirectory)) return
    visited.add(canonicalDirectory)
    for (const entry of await readdir(canonicalDirectory, { withFileTypes: true })) {
      if (entry.name === '.git' && entry.isDirectory()) continue
      const entryPath = join(canonicalDirectory, entry.name)
      if (entry.isSymbolicLink()) {
        let target: string
        try {
          target = await realpath(entryPath)
        } catch {
          throw new Error(UNSAFE_SYMLINK)
        }
        if (!isPathWithin(canonicalRoot, target)) throw new Error(UNSAFE_SYMLINK)
        if ((await stat(target)).isDirectory()) await visit(target)
      } else if (entry.isDirectory()) {
        await visit(entryPath)
      }
    }
  }
}

function preflightRepositorySource(source: string): string {
  const shorthand = source.replace(/\.git$/, '')
  return /^[^/\s:@]+\/[^/\s]+$/.test(shorthand) ? `https://github.com/${shorthand}.git` : source
}

function repositorySource(input: string): string {
  const value = input.trim()
  if (!value || value.startsWith('-') || /[\r\n\0]/.test(value)) {
    throw new Error('repository must be a valid Git URL or owner/repo')
  }
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      throw new Error('do not embed credentials in the repository URL; use a Git credential helper or SSH')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('do not embed')) throw error
    if (value.includes('://')) throw new Error('repository must be a GitHub owner/repo, HTTPS URL, SSH URL, or file URL')
  }
  return value
}

function originFromCli(skill: CliSkill | undefined): SkillOrigin | undefined {
  if (!skill) return undefined
  const source = skill.sourceUrl || skill.source
  if (!source) return undefined
  if (skill.sourceType === 'local') return { source, sourceType: 'local' }
  if (skill.sourceType === 'git' || skill.sourceType === 'github' || skill.sourceType === 'gitlab') return { source, sourceType: 'git' }
  return undefined
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`)
  return value
}

function requiredScope(value: unknown): SkillScope {
  if (value !== 'global' && value !== 'project') throw new Error('scope must be global or project')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
