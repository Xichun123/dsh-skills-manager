import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { SkillManager } from '../lib/index.js'

const execFileAsync = promisify(execFile)
const hostContext = {
  get: () => undefined,
  logger: { warn: () => undefined },
}

function skillMarkdown(description, body, name = 'alpha') {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

test('updates a tracked skill without losing enabled scopes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const source = join(root, 'source', 'alpha')
  const storageDir = join(root, 'storage')
  const projectRoot = join(root, 'workspace')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), skillMarkdown('First version', 'Follow version one.'), 'utf8')
  await writeFile(join(source, 'reference.txt'), 'one\n', 'utf8')

  const manager = new SkillManager(hostContext, { storageDir })
  let catalog = await manager.install(source, undefined, projectRoot)
  assert.equal(catalog.entries[0].updateSupported, true)
  assert.equal(catalog.entries[0].sourceType, 'local')
  assert.equal(catalog.entries[0].sourcePath, source)

  catalog = await manager.setEnabled('alpha', 'project', projectRoot, true)
  assert.equal(catalog.entries[0].effectiveEnabled, true)
  await manager.setEnabled('alpha', 'global', projectRoot, true)
  await writeFile(join(source, 'SKILL.md'), skillMarkdown('Second version', 'Follow version two.'), 'utf8')
  await writeFile(join(source, 'reference.txt'), 'two\n', 'utf8')

  catalog = await manager.update('alpha', undefined, projectRoot)
  const updated = catalog.entries[0]
  assert.equal(updated.description, 'Second version')
  assert.equal(updated.globalEnabled, true)
  assert.equal(updated.projectEnabled, true)
  assert.equal(updated.effectiveEnabled, true)
  assert.equal(await readFile(join(storageDir, '.agents', 'skills', 'alpha', 'reference.txt'), 'utf8'), 'two\n')
})

test('removes the private library entry and its scope state', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-remove-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const source = join(root, 'source', 'alpha')
  const storageDir = join(root, 'storage')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), skillMarkdown('Disposable skill', 'Remove me.'), 'utf8')

  const manager = new SkillManager(hostContext, { storageDir })
  await manager.install(source)
  await manager.setEnabled('alpha', 'global', undefined, true)
  const catalog = await manager.remove('alpha')

  assert.deepEqual(catalog.entries, [])
  await assert.rejects(readFile(join(storageDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8'), /ENOENT/)
  const state = JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8'))
  assert.deepEqual(state, { version: 1, globalEnabled: [], projectEnabled: {} })
})

test('imports and updates skills from a Git repository', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-git-test-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const repository = join(root, 'repository')
  const skill = join(repository, 'skills', 'alpha')
  const storageDir = join(root, 'storage')
  const projectRoot = join(root, 'workspace')
  await mkdir(skill, { recursive: true })
  await execFileAsync('git', ['init', repository])
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Skill Manager Test'])
  await writeFile(join(skill, 'SKILL.md'), skillMarkdown('Remote version one', 'Use remote one.'), 'utf8')
  await writeFile(join(skill, 'reference.txt'), 'remote-one\n', 'utf8')
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'initial'])

  const manager = new SkillManager(hostContext, { storageDir })
  let catalog = await manager.installRemote(pathToFileURL(repository).href, undefined, projectRoot)
  assert.equal(catalog.entries[0].sourceType, 'git')
  assert.equal(catalog.entries[0].sourceUrl, pathToFileURL(repository).href)
  await manager.setEnabled('alpha', 'global', projectRoot, true)

  await writeFile(join(skill, 'SKILL.md'), skillMarkdown('Remote version two', 'Use remote two.'), 'utf8')
  await writeFile(join(skill, 'reference.txt'), 'remote-two\n', 'utf8')
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'update'])

  catalog = await manager.update('alpha', undefined, projectRoot)
  assert.equal(catalog.entries[0].description, 'Remote version two')
  assert.equal(catalog.entries[0].globalEnabled, true)
  assert.equal(catalog.entries[0].effectiveEnabled, true)
  assert.equal(await readFile(join(storageDir, '.agents', 'skills', 'alpha', 'reference.txt'), 'utf8'), 'remote-two\n')
})

test('rejects flat Markdown skill sources', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-flat-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'alpha.md'), skillMarkdown('Flat skill', 'No directory bundle.'), 'utf8')

  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })
  await assert.rejects(manager.install(source), /skills CLI failed to install/)
})

test('inspects a source without installing, then installs a selection', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-select-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const source = join(root, 'source')
  await mkdir(join(source, 'alpha'), { recursive: true })
  await mkdir(join(source, 'beta'), { recursive: true })
  await writeFile(join(source, 'alpha', 'SKILL.md'), skillMarkdown('Alpha description', 'Alpha body.', 'alpha'), 'utf8')
  await writeFile(join(source, 'beta', 'SKILL.md'), skillMarkdown('Beta description', 'Beta body.', 'beta'), 'utf8')

  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })

  const inspected = await manager.inspect(source)
  assert.deepEqual(inspected.entries.map(entry => entry.name), ['alpha', 'beta'])
  assert.equal(inspected.entries[0].description, 'Alpha description')
  // Inspect must not install anything.
  assert.equal((await manager.catalog()).entries.length, 0)

  const catalog = await manager.install(source, ['beta'])
  assert.deepEqual(catalog.entries.map(entry => entry.name), ['beta'])
  assert.equal(await readFile(join(root, 'storage', '.agents', 'skills', 'beta', 'SKILL.md'), 'utf8').catch(() => 'missing') !== 'missing', true)
  await assert.rejects(readFile(join(root, 'storage', '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8'), /ENOENT/)
})

test('exposes the model-invocation policy on catalog entries', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-invocation-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const source = join(root, 'source', 'alpha')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), `---\nname: alpha\ndescription: Manual only.\ndisable-model-invocation: true\n---\n\nBody.\n`, 'utf8')

  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })
  const catalog = await manager.install(source, undefined)
  assert.equal(catalog.entries[0].modelInvocable, false)
})

test('rejects repository symlinks that escape the source root', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-symlink-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const repository = join(root, 'repository')
  const skill = join(repository, 'skills', 'alpha')
  await mkdir(skill, { recursive: true })
  await execFileAsync('git', ['init', repository])
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Skill Manager Test'])
  await writeFile(join(skill, 'SKILL.md'), skillMarkdown('Unsafe links', 'Do not load outside files.'), 'utf8')
  await symlink('/etc/passwd', join(skill, 'outside.txt'))
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'unsafe symlink'])

  const storageDir = join(root, 'storage')
  const manager = new SkillManager(hostContext, { storageDir })
  await assert.rejects(manager.installRemote(pathToFileURL(repository).href), /broken or escaping symlink/)
})

test('rejects local symlinks that escape the source root', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-local-symlink-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const source = join(root, 'source', 'alpha')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), skillMarkdown('Unsafe local links', 'Do not load outside files.'), 'utf8')
  await symlink('/etc/passwd', join(source, 'outside.txt'))

  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })
  await assert.rejects(manager.install(source), /broken or escaping symlink/)
})

test('checks local and git sources for updates without applying them', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-check-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const localSkill = join(root, 'source', 'alpha')
  const storageDir = join(root, 'storage')
  await mkdir(localSkill, { recursive: true })
  await writeFile(join(localSkill, 'SKILL.md'), skillMarkdown('Local one', 'Version one.'), 'utf8')

  const repository = join(root, 'repository')
  const gitSkill = join(repository, 'skills', 'beta')
  await mkdir(gitSkill, { recursive: true })
  await execFileAsync('git', ['init', repository])
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Skill Manager Test'])
  await writeFile(join(gitSkill, 'SKILL.md'), `---\nname: beta\ndescription: Git one\n---\n\nVersion one.\n`, 'utf8')
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'initial'])

  const manager = new SkillManager(hostContext, { storageDir })
  await manager.install(join(root, 'source'))
  await manager.installRemote(pathToFileURL(repository).href)

  const statusOf = async () => Object.fromEntries((await manager.checkUpdates()).entries.map(entry => [entry.name, entry.status]))
  assert.deepEqual(await statusOf(), { alpha: 'current', beta: 'current' })

  await writeFile(join(localSkill, 'SKILL.md'), skillMarkdown('Local two', 'Version two.'), 'utf8')
  await writeFile(join(gitSkill, 'SKILL.md'), `---\nname: beta\ndescription: Git two\n---\n\nVersion two.\n`, 'utf8')
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'update'])

  assert.deepEqual(await statusOf(), { alpha: 'update-available', beta: 'update-available' })
  // Detection never applies the update.
  assert.equal(await readFile(join(storageDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8'), skillMarkdown('Local one', 'Version one.'))
})

test('checks separate Git sources concurrently', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-concurrent-check-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })
  for (const name of ['alpha', 'beta']) {
    const repository = join(root, `${name}-repository`)
    const skill = join(repository, 'skills', name)
    await mkdir(skill, { recursive: true })
    await execFileAsync('git', ['init', repository])
    await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Skill Manager Test'])
    await writeFile(join(skill, 'SKILL.md'), skillMarkdown(`${name} description`, `${name} body.`, name), 'utf8')
    await execFileAsync('git', ['-C', repository, 'add', '.'])
    await execFileAsync('git', ['-C', repository, 'commit', '-m', 'initial'])
    await manager.installRemote(pathToFileURL(repository).href)
  }

  const bin = join(root, 'bin')
  const barrier = join(root, 'git-clone-barrier')
  const gitWrapper = join(bin, 'git')
  await mkdir(bin, { recursive: true })
  await writeFile(gitWrapper, `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { mkdirSync, readdirSync, writeFileSync } = require('node:fs')
const { delimiter, join } = require('node:path')
const args = process.argv.slice(2)
if (args[0] === 'clone') {
  const barrier = process.env.DSH_SKILL_MANAGER_GIT_BARRIER
  mkdirSync(barrier, { recursive: true })
  writeFileSync(join(barrier, String(process.pid)), '')
  const wait = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + 1500
  while (readdirSync(barrier).length < 2 && Date.now() < deadline) Atomics.wait(wait, 0, 0, 20)
  if (readdirSync(barrier).length < 2) process.exit(97)
}
const path = (process.env.PATH || '').split(delimiter).slice(1).join(delimiter)
const child = spawn('git', args, { stdio: 'inherit', env: { ...process.env, PATH: path } })
child.on('error', () => process.exit(98))
child.on('exit', code => process.exit(code ?? 1))
`, 'utf8')
  await chmod(gitWrapper, 0o755)

  const previousPath = process.env.PATH
  const previousBarrier = process.env.DSH_SKILL_MANAGER_GIT_BARRIER
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`
  process.env.DSH_SKILL_MANAGER_GIT_BARRIER = barrier
  try {
    const statuses = Object.fromEntries((await manager.checkUpdates()).entries.map(entry => [entry.name, entry.status]))
    assert.deepEqual(statuses, { alpha: 'current', beta: 'current' })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBarrier === undefined) delete process.env.DSH_SKILL_MANAGER_GIT_BARRIER
    else process.env.DSH_SKILL_MANAGER_GIT_BARRIER = previousBarrier
  }
})

test('rejects credentials embedded in repository URLs', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-security-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const manager = new SkillManager(hostContext, { storageDir: join(root, 'storage') })
  await manager.catalog()
  await assert.rejects(
    manager.installRemote('https://token@github.com/example/skills.git'),
    /do not embed credentials/,
  )
})

test('serializes concurrent mutations instead of losing updates', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-concurrent-mutate-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const storageDir = join(root, 'storage')
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(root, `source-${name}`, name), { recursive: true })
    await writeFile(join(root, `source-${name}`, name, 'SKILL.md'), skillMarkdown(`${name} description`, 'Body.', name), 'utf8')
  }

  // Two rapid imports fork the skills CLI, which read-modify-writes one shared
  // skills-lock.json: unserialized, the second write drops the first skill's source.
  const manager = new SkillManager(hostContext, { storageDir })
  await Promise.all([
    manager.install(join(root, 'source-alpha')),
    manager.install(join(root, 'source-beta')),
  ])

  const catalog = await manager.catalog()
  assert.deepEqual(catalog.entries.map(entry => entry.name), ['alpha', 'beta'])
  assert.deepEqual(catalog.entries.map(entry => entry.updateSupported), [true, true])

  // Removals fired back to back must both leave the library and the scope state.
  await manager.setEnabled('alpha', 'global', undefined, true)
  await manager.setEnabled('beta', 'global', undefined, true)
  const [, second] = await Promise.all([manager.remove('alpha'), manager.remove('beta')])
  assert.deepEqual(second.entries, [])
  assert.deepEqual(
    JSON.parse(await readFile(join(storageDir, 'state.json'), 'utf8')),
    { version: 1, globalEnabled: [], projectEnabled: {} },
  )
})
