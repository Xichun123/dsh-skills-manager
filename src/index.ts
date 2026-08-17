import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'
import { EMPTY_STATE, isEnabledFor, normalizeState, removeSkill, setEnabled } from './state.js'
import type { InstalledSkill, ManagerState, SkillCatalog, SkillCatalogEntry, SkillLayout, SkillScope, SkillSourceType } from './types.js'

export const name = 'dsh-skills-manager'
export const inject = ['skills', 'connection']

const execFileAsync = promisify(execFile)

export interface Config {
  readonly storageDir?: string
}

export const Config: Schema<Config> = Schema.object({
  storageDir: Schema.string().default(''),
})

interface InstallSource {
  readonly path: string
  readonly name: string
  readonly description: string
  readonly layout: SkillLayout
}

interface InstallOrigin {
  readonly sourceType: SkillSourceType
  readonly sourcePath?: string
  readonly sourceUrl?: string
  readonly sourceSubpath?: string
}

interface ResolvedUpdateSource {
  readonly source: InstallSource
  readonly origin: InstallOrigin
  readonly cleanup?: () => Promise<void>
}

interface ManagedLocator {
  readonly candidate: SkillCandidate
}

interface UpdateCheck {
  readonly available: boolean
  readonly error?: string
}

interface HostContext extends Context {
  readonly connection: {
    readonly rpc: {
      handle(
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
        options: { authority: 'loopback' },
      ): () => Promise<void>
    }
  }
}

export class SkillManager {
  private readonly root: string
  private readonly library: string
  private readonly stateFile: string
  private state: ManagerState = EMPTY_STATE
  private loaded: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly updateChecks = new Map<string, UpdateCheck>()
  private providerControl: SkillProviderControl | undefined
  private filesystemProvider: FileSystemSkillProvider | undefined

  constructor(private readonly ctx: Context, config: Config) {
    const storageDir = config.storageDir?.trim()
    this.root = storageDir ? resolve(storageDir) : join(resolveDshHome(), 'skill-manager')
    this.library = join(this.root, 'library')
    this.stateFile = join(this.root, 'state.json')
    this.loaded = this.load()
  }

  provider(control: SkillProviderControl): SkillProvider {
    this.providerControl = control
    this.filesystemProvider = new FileSystemSkillProvider(this.ctx, control, {
      providerName: 'skill-manager-library',
      includeDefaultRoots: false,
      customSkillDirs: [this.library],
      watch: true,
    })

    return {
      name: 'skill-manager',
      list: async (options) => {
        await this.loaded
        const discovered = await this.filesystemProvider!.list(options)
        const candidates = Array.isArray(discovered) ? discovered : discovered.candidates
        return candidates
          .filter(candidate => isEnabledFor(this.state, candidate.name, options.cwd))
          .map(candidate => this.managedCandidate(candidate))
      },
      get: async (candidate, options) => {
        await this.loaded
        const locator = candidate.locator as ManagedLocator
        return this.filesystemProvider!.get(locator.candidate, options)
      },
    }
  }

  async catalog(projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const entries = Object.values(this.state.skills)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill): SkillCatalogEntry => {
        const check = this.updateChecks.get(skill.name)
        return {
          ...skill,
          globalEnabled: this.state.globalEnabled.includes(skill.name),
          projectEnabled: projectRoot !== undefined && (this.state.projectEnabled[projectRoot] ?? []).includes(skill.name),
          effectiveEnabled: isEnabledFor(this.state, skill.name, projectRoot),
          updateSupported: Boolean(skill.sourcePath || skill.sourceUrl),
          updateAvailable: check?.available ?? false,
          ...(check?.error ? { updateError: check.error } : {}),
        }
      })
    return { entries, ...(projectRoot ? { projectRoot } : {}) }
  }

  async install(sourcePath: string, projectRoot?: string): Promise<SkillCatalog> {
    const sources = await discoverSources(sourcePath)
    return this.installSources(sources, source => ({ sourceType: 'local', sourcePath: source.path }), projectRoot)
  }

  async installRemote(input: string, projectRoot?: string): Promise<SkillCatalog> {
    const sourceUrl = normalizeGitSource(input)
    const checkout = await cloneGitRepository(sourceUrl)
    try {
      const sources = await discoverRepositorySources(checkout)
      return await this.installSources(sources, source => ({
        sourceType: 'git',
        sourceUrl,
        sourceSubpath: relative(checkout, source.path).split(sep).join('/'),
      }), projectRoot)
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  }

  private async installSources(
    sources: InstallSource[],
    originFor: (source: InstallSource) => InstallOrigin,
    projectRoot?: string,
  ): Promise<SkillCatalog> {
    await this.loaded
    const duplicate = sources.find(source => source.name in this.state.skills)
    if (duplicate) throw new Error(`skill is already installed: ${duplicate.name}`)

    await mkdir(this.library, { recursive: true })
    const installed: Record<string, InstalledSkill> = {}
    const staged: Array<{ temp: string; target: string; layout: SkillLayout; committed: boolean }> = []
    const previousState = this.state
    try {
      for (const source of sources) {
        const target = join(this.library, source.layout === 'file' ? `${source.name}.md` : source.name)
        if (await pathExists(target)) throw new Error(`skill target already exists: ${target}`)
        const temp = `${target}.tmp-${randomUUID()}`
        await cp(source.path, temp, { recursive: source.layout === 'directory', errorOnExist: true, force: false, verbatimSymlinks: true })
        staged.push({ temp, target, layout: source.layout, committed: false })
        const now = new Date().toISOString()
        installed[source.name] = {
          name: source.name,
          description: source.description,
          layout: source.layout,
          installedAt: now,
          updatedAt: now,
          ...originFor(source),
          contentHash: await hashSkillSource(temp),
        }
      }
      for (const item of staged) {
        await rename(item.temp, item.target)
        item.committed = true
      }
      this.state = {
        ...this.state,
        skills: { ...this.state.skills, ...installed },
      }
      await this.persist()
      for (const skillName of Object.keys(installed)) this.updateChecks.set(skillName, { available: false })
      this.providerControl?.invalidate()
      return this.catalog(projectRoot)
    } catch (error) {
      this.state = previousState
      await Promise.all(staged.flatMap(item => [
        rm(item.temp, { recursive: item.layout === 'directory', force: true }),
        ...(item.committed ? [rm(item.target, { recursive: item.layout === 'directory', force: true })] : []),
      ]))
      throw error
    }
  }

  async checkUpdates(projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const checkouts: string[] = []
    const checkoutCache = new Map<string, Promise<string>>()
    const checkoutFor = (sourceUrl: string): Promise<string> => {
      let checkout = checkoutCache.get(sourceUrl)
      if (!checkout) {
        checkout = cloneGitRepository(sourceUrl).then(path => {
          checkouts.push(path)
          return path
        })
        checkoutCache.set(sourceUrl, checkout)
      }
      return checkout
    }

    try {
      for (const skill of Object.values(this.state.skills)) {
        if (!skill.contentHash || (!skill.sourcePath && !skill.sourceUrl)) {
          this.updateChecks.delete(skill.name)
          continue
        }
        try {
          const source = await resolveTrackedSource(skill, checkoutFor)
          this.updateChecks.set(skill.name, { available: await hashSkillSource(source.path) !== skill.contentHash })
        } catch (error) {
          this.updateChecks.set(skill.name, { available: false, error: messageOf(error) })
        }
      }
      return this.catalog(projectRoot)
    } finally {
      await Promise.all(checkouts.map(path => rm(path, { recursive: true, force: true })))
    }
  }

  async update(name: string, sourcePath: string | undefined, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const current = this.state.skills[name]
    if (!current) throw new Error(`skill is not installed: ${name}`)
    const resolvedSource = sourcePath
      ? { source: await findUpdateSource(name, sourcePath), origin: { sourceType: 'local' as const, sourcePath: resolve(sourcePath) } }
      : await prepareTrackedUpdate(current)
    try {
      return await this.replaceSkill(name, current, resolvedSource.source, resolvedSource.origin, projectRoot)
    } finally {
      await resolvedSource.cleanup?.()
    }
  }

  private async replaceSkill(
    name: string,
    current: InstalledSkill,
    source: InstallSource,
    origin: InstallOrigin,
    projectRoot?: string,
  ): Promise<SkillCatalog> {
    const currentTarget = join(this.library, current.layout === 'file' ? `${name}.md` : name)
    const nextTarget = join(this.library, source.layout === 'file' ? `${name}.md` : name)
    if (currentTarget !== nextTarget && await pathExists(nextTarget)) {
      throw new Error(`cannot change skill layout because the target already exists: ${nextTarget}`)
    }

    const suffix = randomUUID()
    const temp = `${nextTarget}.tmp-${suffix}`
    const backup = `${currentTarget}.bak-${suffix}`
    const previousState = this.state
    let currentMoved = false
    let nextMoved = false
    try {
      await cp(source.path, temp, { recursive: source.layout === 'directory', errorOnExist: true, force: false, verbatimSymlinks: true })
      const contentHash = await hashSkillSource(temp)
      await rename(currentTarget, backup)
      currentMoved = true
      await rename(temp, nextTarget)
      nextMoved = true
      this.state = {
        ...this.state,
        skills: {
          ...this.state.skills,
          [name]: {
            ...current,
            description: source.description,
            layout: source.layout,
            sourceType: origin.sourceType,
            sourcePath: origin.sourcePath,
            sourceUrl: origin.sourceUrl,
            sourceSubpath: origin.sourceSubpath,
            contentHash,
            updatedAt: new Date().toISOString(),
          },
        },
      }
      await this.persist()
      await rm(backup, { recursive: current.layout === 'directory', force: true }).catch(() => undefined)
      this.updateChecks.set(name, { available: false })
      this.providerControl?.invalidate()
      return this.catalog(projectRoot)
    } catch (error) {
      this.state = previousState
      if (nextMoved) await rm(nextTarget, { recursive: source.layout === 'directory', force: true })
      if (currentMoved) await rename(backup, currentTarget)
      await rm(temp, { recursive: source.layout === 'directory', force: true })
      throw error
    }
  }

  async setEnabled(name: string, scope: SkillScope, projectRoot: string | undefined, enabled: boolean): Promise<SkillCatalog> {
    await this.loaded
    this.state = setEnabled(this.state, name, scope, projectRoot, enabled)
    await this.persist()
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  async remove(name: string, projectRoot?: string): Promise<SkillCatalog> {
    await this.loaded
    const skill = this.state.skills[name]
    if (!skill) throw new Error(`skill is not installed: ${name}`)
    const target = join(this.library, skill.layout === 'file' ? `${name}.md` : name)
    await rm(target, { recursive: skill.layout === 'directory', force: true })
    this.state = removeSkill(this.state, name)
    await this.persist()
    this.updateChecks.delete(name)
    this.providerControl?.invalidate()
    return this.catalog(projectRoot)
  }

  private async load(): Promise<void> {
    await mkdir(this.library, { recursive: true })
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.stateFile, 'utf8')))
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

  private managedCandidate(candidate: SkillCandidate): SkillCandidate {
    return {
      ...candidate,
      provider: 'skill-manager',
      source: 'skill-manager',
      rank: 50,
      locator: { candidate },
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  if (config.storageDir?.trim() && !isAbsolute(config.storageDir)) {
    throw new Error('storageDir must resolve to an absolute path')
  }
  const manager = new SkillManager(ctx, config)
  ctx.skills.registerProvider(control => manager.provider(control))
  const host = ctx as HostContext
  ctx.effect(
    () => host.connection.rpc.handle(
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
    case 'check-updates':
      return { ok: true as const, value: await manager.checkUpdates(asOptionalString(args.projectRoot)) }
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

async function discoverSources(inputPath: string): Promise<InstallSource[]> {
  const path = resolve(inputPath.trim())
  const info = await stat(path)
  if (info.isFile()) {
    if (extname(path).toLowerCase() !== '.md') throw new Error('a skill file must use the .md extension')
    return [await readSkillSource(path, 'file')]
  }
  if (!info.isDirectory()) throw new Error('skill source must be a directory or Markdown file')

  if (await isFile(join(path, 'SKILL.md'))) return [await readSkillSource(join(path, 'SKILL.md'), 'directory', path)]

  const entries = await readdir(path, { withFileTypes: true })
  const sources: InstallSource[] = []
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory() && await isFile(join(child, 'SKILL.md'))) sources.push(await readSkillSource(join(child, 'SKILL.md'), 'directory', child))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') sources.push(await readSkillSource(child, 'file'))
  }
  if (sources.length === 0) throw new Error('no SKILL.md or Markdown skill file was found in the selected folder')
  return sources
}

async function discoverRepositorySources(root: string): Promise<InstallSource[]> {
  if (await isFile(join(root, 'SKILL.md'))) return [await readSkillSource(join(root, 'SKILL.md'), 'directory', root)]

  const searchRoots = [root, join(root, 'skills'), join(root, '.agents', 'skills')]
  const sources = new Map<string, InstallSource>()
  for (const searchRoot of searchRoots) {
    let entries
    try {
      entries = await readdir(searchRoot, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const child = join(searchRoot, entry.name)
      if (entry.isDirectory() && await isFile(join(child, 'SKILL.md'))) {
        const source = await readSkillSource(join(child, 'SKILL.md'), 'directory', child)
        sources.set(source.name, source)
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md' && entry.name.toLowerCase() !== 'readme.md') {
        try {
          const source = await readSkillSource(child, 'file')
          sources.set(source.name, source)
        } catch (error) {
          if ((await readFile(child, 'utf8')).startsWith('---')) throw error
        }
      }
    }
  }
  if (sources.size === 0) throw new Error('the repository does not contain a root skill or skills/* entries')
  return [...sources.values()]
}

function normalizeGitSource(input: string): string {
  const value = input.trim()
  if (!value || value.startsWith('-') || /[\r\n\0]/.test(value)) throw new Error('repository must be a valid Git URL or owner/repo')
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return `https://github.com/${value}.git`
  if (/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[^\s]+$/.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('repository must be a GitHub owner/repo, HTTPS URL, SSH URL, or file URL')
  }
  if (!['https:', 'http:', 'ssh:', 'git:', 'file:'].includes(url.protocol)) throw new Error(`unsupported Git protocol: ${url.protocol}`)
  if (url.password || ((url.protocol === 'https:' || url.protocol === 'http:') && url.username)) {
    throw new Error('do not embed credentials in the repository URL; use a Git credential helper or SSH')
  }
  if (url.hostname === 'github.com' && /\/tree\//.test(url.pathname)) {
    throw new Error('use the repository root URL, not a GitHub /tree/ URL')
  }
  return value
}

async function cloneGitRepository(sourceUrl: string): Promise<string> {
  const checkout = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-git-'))
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--', sourceUrl, checkout], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    })
    return checkout
  } catch {
    await rm(checkout, { recursive: true, force: true })
    throw new Error('failed to clone Git repository; check the URL and local Git credentials')
  }
}

async function resolveTrackedSource(
  skill: InstalledSkill,
  checkoutFor: (sourceUrl: string) => Promise<string>,
): Promise<InstallSource> {
  if (skill.sourceUrl) {
    if (typeof skill.sourceSubpath !== 'string') throw new Error('the repository skill path is missing; import it again')
    const checkout = await checkoutFor(skill.sourceUrl)
    return findUpdateSource(skill.name, resolveRepositorySubpath(checkout, skill.sourceSubpath))
  }
  return findUpdateSource(skill.name, skill.sourcePath)
}

async function prepareTrackedUpdate(skill: InstalledSkill): Promise<ResolvedUpdateSource> {
  if (!skill.sourceUrl) {
    return {
      source: await findUpdateSource(skill.name, skill.sourcePath),
      origin: { sourceType: 'local', sourcePath: skill.sourcePath },
    }
  }

  const checkout = await cloneGitRepository(skill.sourceUrl)
  try {
    return {
      source: await resolveTrackedSource(skill, async () => checkout),
      origin: {
        sourceType: 'git',
        sourceUrl: skill.sourceUrl,
        sourceSubpath: skill.sourceSubpath,
      },
      cleanup: () => rm(checkout, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(checkout, { recursive: true, force: true })
    throw error
  }
}

function resolveRepositorySubpath(root: string, subpath: string): string {
  const target = resolve(root, subpath)
  const child = relative(root, target)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('repository skill path escapes the checkout')
  return target
}

async function findUpdateSource(name: string, sourcePath: string | undefined): Promise<InstallSource> {
  if (!sourcePath) throw new Error('the original source is unknown; select the skill source folder to update it')
  const source = (await discoverSources(sourcePath)).find(candidate => candidate.name === name)
  if (!source) throw new Error(`the selected source does not contain skill: ${name}`)
  return source
}

async function hashSkillSource(root: string): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path)
    const name = relative(root, path).split(sep).join('/')
    if (info.isSymbolicLink()) {
      const target = await readlink(path)
      const resolvedTarget = resolve(dirname(path), target)
      const child = relative(root, resolvedTarget)
      if (isAbsolute(target) || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
        throw new Error(`skill symlink escapes its source root: ${path}`)
      }
      hash.update(`link\0${name}\0${target}\0`)
      return
    }
    if (info.isFile()) {
      hash.update(`file\0${name}\0`)
      hash.update(await readFile(path))
      hash.update('\0')
      return
    }
    if (!info.isDirectory()) throw new Error(`unsupported skill entry: ${path}`)
    hash.update(`directory\0${name}\0`)
    const entries = await readdir(path)
    entries.sort()
    for (const entry of entries) await visit(join(path, entry))
  }
  await visit(root)
  return hash.digest('hex')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

async function readSkillSource(markdownPath: string, layout: SkillLayout, directoryPath = markdownPath): Promise<InstallSource> {
  return {
    path: layout === 'directory' ? directoryPath : markdownPath,
    layout,
    ...await parseSkillFrontmatter(markdownPath),
  }
}

async function parseSkillFrontmatter(path: string): Promise<{ name: string; description: string }> {
  const text = await readFile(path, 'utf8')
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text)
  if (!match) throw new Error(`missing YAML frontmatter: ${path}`)
  const metadata = parseYaml(match[1])
  if (!isRecord(metadata) || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || typeof metadata.description !== 'string' || !metadata.description.trim()) {
    throw new Error(`invalid skill frontmatter: ${path}`)
  }
  return { name: metadata.name, description: metadata.description.trim() }
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
