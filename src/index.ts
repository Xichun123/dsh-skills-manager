import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
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
import { EMPTY_STATE, isRecord, isEnabledFor, isPathWithin, normalizeState, removeSkill, setEnabled } from './state.js'
import type { ManagerState, SkillCatalog, SkillCatalogEntry, SkillInspectEntry, SkillInspectResult, SkillOrigin, SkillScope, SkillUpdateReport, SkillUpdateReportEntry } from './types.js'

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
  private providerControl: SkillProviderControl | undefined
  private lazyProvider: FileSystemSkillProvider | undefined

  constructor(private readonly ctx: Context, config: Config) {
    const storageDir = config.storageDir?.trim()
    this.root = storageDir ? resolve(storageDir) : join(resolveDshHome(), 'skill-manager')
    this.library = join(this.root, '.agents', 'skills')
    this.stateFile = join(this.root, 'state.json')
    this.loaded = this.load()
  }

  private get filesystemProvider(): FileSystemSkillProvider {
    // ponytail: the constructor-built throwaway provider is gone; the first list/get
    // creates a watching provider bound to the registry's lifecycle control.
    if (this.lazyProvider === undefined) {
      this.lazyProvider = this.createFilesystemProvider(this.providerControl ?? {
        signal: new AbortController().signal,
        invalidate: () => undefined,
      }, this.providerControl !== undefined)
    }
    return this.lazyProvider
  }

  provider(control: SkillProviderControl): SkillProvider {
    this.providerControl = control
    this.lazyProvider = this.createFilesystemProvider(control, true)

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
          modelInvocable: candidate.invocation?.modelInvocable,
        }
      })
    return { entries }
  }

  /** Dry-run a source: what skills it offers, without installing anything. */
  async inspect(sourcePath: string): Promise<SkillInspectResult> {
    await this.loaded
    const source = resolve(sourcePath.trim())
    if (!await isDirectory(source)) throw new Error('skill source must be a directory containing SKILL.md bundles')
    return this.inspectSource(source, 'local')
  }

  async inspectRemote(input: string): Promise<SkillInspectResult> {
    await this.loaded
    return this.inspectSource(repositorySource(input), 'git')
  }

  private async inspectSource(source: string, sourceType: 'local' | 'git'): Promise<SkillInspectResult> {
    await validateSource(source, sourceType)
    const output = await this.runSkills('inspect', ['add', source, '--skill', '*', '--agent', 'universal', '--yes', '--list'])
    return { entries: parseListOutput(output) }
  }

  async install(sourcePath: string, skills: readonly string[] | undefined, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const source = resolve(sourcePath.trim())
    if (!await isDirectory(source)) throw new Error('skill source must be a directory containing SKILL.md bundles')
    return this.installSource(source, skills, projectRoot, 'local')
  }

  async installRemote(input: string, skills: readonly string[] | undefined, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    return this.installSource(repositorySource(input), skills, projectRoot, 'git')
  }

  private async installSource(source: string, skills: readonly string[] | undefined, projectRoot: string | undefined, sourceType: 'local' | 'git'): Promise<SkillCatalog> {
    await validateSource(source, sourceType)
    const selection = skills !== undefined && skills.length > 0 ? skills.flatMap(name => ['--skill', name]) : ['--skill', '*']
    await this.runSkills('install', ['add', source, ...selection, '--agent', 'universal', '--yes'])
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

  async checkUpdates(): Promise<SkillUpdateReport> {
    await this.loaded
    interface LockEntry {
      readonly source?: string
      readonly sourceType?: string
      readonly sourceUrl?: string
      readonly ref?: string
      readonly skillPath?: string
      readonly computedHash?: string
    }
    let lockSkills: Readonly<Record<string, LockEntry>>
    try {
      lockSkills = (JSON.parse(await readFile(join(this.root, 'skills-lock.json'), 'utf8')) as { skills?: Record<string, LockEntry> }).skills ?? {}
    } catch {
      return { entries: [] }
    }
    const installed = new Set((await this.libraryCandidates({})).map(candidate => candidate.name))
    const entries = Object.entries(lockSkills).filter(([name]) => installed.has(name))
    const bySource = new Map<string, Array<[string, LockEntry]>>()
    for (const item of entries) {
      const source = item[1].source ?? ''
      bySource.set(source, [...bySource.get(source) ?? [], item])
    }
    // Independent sources (including their Git clones) and skills are checked concurrently.
    const report = (await Promise.all([...bySource].map(async ([source, items]): Promise<SkillUpdateReportEntry[]> => {
      const unknownEntries = (): SkillUpdateReportEntry[] => items.map(([name]) => ({ name, status: 'unknown' }))
      const first = items[0][1]
      if (first.sourceType === 'local') {
        // The CLI stores portable relative sources; they resolve against the lock file's directory.
        const sourceRoot = isAbsolute(source) ? source : resolve(this.root, source)
        return Promise.all(items.map(async ([name]): Promise<SkillUpdateReportEntry> => {
          const [sourceHash, installedHash] = await Promise.all([
            computeSkillFolderHash(join(sourceRoot, name)).catch(() => undefined),
            computeSkillFolderHash(join(this.library, name)).catch(() => undefined),
          ])
          return { name, status: sourceHash === undefined ? 'unknown' : sourceHash === installedHash ? 'current' : 'update-available' }
        }))
      }
      if (first.sourceType === 'github' || first.sourceType === 'git' || first.sourceType === 'gitlab') {
        if (!first.skillPath) return unknownEntries()
        // ponytail: always shallow-clone and compare content hashes. The CLI's project lock stores content
        // hashes even for github sources, so the GitHub tree API (tree SHAs) is not comparable to it.
        const url = first.sourceUrl || source
        let latest: LatestHashes
        try {
          latest = await computeLatestHashesFromGit(url, first.ref, items.map(([, entry]) => entry.skillPath!))
        } catch {
          return unknownEntries()
        }
        return Promise.all(items.map(async ([name, entry]): Promise<SkillUpdateReportEntry> => {
          const remote = latest.hashes.get(entry.skillPath!)
          if (remote === undefined) return { name, status: 'deleted-upstream' }
          // The lock's hash records upstream at install time. For repos whose skillPath is the
          // repo root (e.g. iOfficeAI/OfficeCLI), the installed copy legitimately diverges from the
          // whole-repo hash (the CLI's copy drops .git and may nest skills/<name>/ duplicates), so
          // trust lock-vs-remote first: equal means nothing new upstream — installed drift is then
          // local noise, not an update.
          if (entry.computedHash !== undefined && entry.computedHash === remote) return { name, status: 'current' }
          // Compare against the installed copy so locally-diverged installs show as updatable.
          const installedHash = await computeSkillFolderHash(join(this.library, name)).catch(() => undefined)
          return { name, status: installedHash === undefined ? 'unknown' : installedHash === remote ? 'current' : 'update-available' }
        }))
      }
      return unknownEntries()
    }))).flat()
    return { entries: report.sort((a, b) => a.name.localeCompare(b.name)) }
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
      this.state = normalizeState(JSON.parse(await readFile(this.stateFile, 'utf8')))
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
      this.state = EMPTY_STATE
    }
  }

  // ponytail: no write queue — the random temp name + rename is already atomic and
  // concurrent callers stringify the same in-memory state; add a queue if writers diverge.
  private async persist(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const temp = `${this.stateFile}.tmp-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    await rename(temp, this.stateFile)
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
    case 'inspect':
      return { ok: true as const, value: await manager.inspect(requiredString(args.path, 'path')) }
    case 'inspect-remote':
      return { ok: true as const, value: await manager.inspectRemote(requiredString(args.repository, 'repository')) }
    case 'install':
      return { ok: true as const, value: await manager.install(requiredString(args.path, 'path'), asOptionalStringArray(args.skills), asOptionalString(args.projectRoot)) }
    case 'install-remote':
      return { ok: true as const, value: await manager.installRemote(requiredString(args.repository, 'repository'), asOptionalStringArray(args.skills), asOptionalString(args.projectRoot)) }
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
    case 'check-updates':
      return { ok: true as const, value: await manager.checkUpdates() }
    default:
      throw new Error(`unknown skill-manager endpoint: ${endpoint}`)
  }
}

const UNSAFE_SYMLINK = 'skill source contains a broken or escaping symlink'

// The CLI dereferences symlinks while copying, so an escaping symlink is only visible
// in the source tree: a local directory is scanned directly; a remote one is shallow-cloned
// for a preflight scan. Mutable sources can still change after the check (TOCTOU ceiling).
async function validateSource(source: string, sourceType: 'local' | 'git'): Promise<void> {
  if (sourceType === 'local' || await isDirectory(source)) {
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

function asOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
  return names.length > 0 ? names : undefined
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`)
  return value
}

function requiredScope(value: unknown): SkillScope {
  if (value !== 'global' && value !== 'project') throw new Error('scope must be global or project')
  return value
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

// ponytail: the CLI's --list has no JSON mode; parse its fixed "name / indented description"
// human format. Ceiling: a CLI redesign of that layout breaks this — switch to a JSON flag if
// the skills CLI ever grows one.
// ponytail: the CLI's --list has no JSON mode; parse its fixed human format
// (box-drawn lines "│    name" / "│      description"). Ceiling: a CLI redesign
// of that layout breaks this — switch to a JSON flag if the skills CLI grows one.
function parseListOutput(output: string): SkillInspectEntry[] {
  const lines = output
    .replace(/\x1b\[[?0-9]*[a-zA-Z]/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/^[│◇└\s]+/, ''))
  const start = lines.findIndex(line => line === 'Available Skills')
  if (start === -1) return []
  const entries: SkillInspectEntry[] = []
  let current: SkillInspectEntry | undefined
  for (const line of lines.slice(start + 1)) {
    if (/^Use --skill/.test(line)) break
    if (line === '') continue
    if (current !== undefined && current.description === '' && !/^\S+$/.test(line)) {
      current = { name: current.name, description: line.trim() }
      continue
    }
    if (/^\S+$/.test(line)) {
      if (current !== undefined) entries.push(current)
      current = { name: line, description: '' }
    }
  }
  if (current !== undefined) entries.push(current)
  return entries
}

interface LatestHashes {
  readonly hashes: ReadonlyMap<string, string>
}

// Same algorithm as the skills CLI: sha256 over sorted "relativePath + content" of every file below the skill folder.
async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = []
  const collect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) await collect(fullPath)
      else if (entry.isFile()) files.push({ relativePath: relative(skillDir, fullPath).split(sep).join('/'), content: await readFile(fullPath) })
    }
  }
  await collect(skillDir)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update(file.content)
  }
  return hash.digest('hex')
}

function skillFolderFromPath(skillPath: string): string {
  return skillPath.replace(/\/?skill\.md$/i, '')
}

// Mirror the CLI's update check: shallow clone the source and hash the skill folders.
async function computeLatestHashesFromGit(url: string, ref: string | undefined, skillPaths: readonly string[]): Promise<LatestHashes> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-check-'))
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--no-recurse-submodules', ...ref ? ['--branch', ref] : [], preflightRepositorySource(url), join(temporaryRoot, 'repo')], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    const hashes = new Map<string, string>()
    await Promise.all(skillPaths.map(async (skillPath) => {
      // ponytail: a stat (via the hash read) decides deleted-upstream; no whole-repo walk.
      const hash = await computeSkillFolderHash(join(temporaryRoot, 'repo', skillFolderFromPath(skillPath))).catch(() => undefined)
      if (hash !== undefined) hashes.set(skillPath, hash)
    }))
    return { hashes }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}
