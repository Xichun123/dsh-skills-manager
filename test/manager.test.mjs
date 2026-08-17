import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { SkillManager } from '../lib/index.js'

const execFileAsync = promisify(execFile)

function skillMarkdown(description, body) {
  return `---\nname: alpha\ndescription: ${description}\n---\n\n${body}\n`
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

  const manager = new SkillManager({}, { storageDir })
  let catalog = await manager.install(source, projectRoot)
  const installedAt = catalog.entries[0].installedAt
  assert.equal(catalog.entries[0].updateSupported, true)

  await manager.setEnabled('alpha', 'global', projectRoot, true)
  await manager.setEnabled('alpha', 'project', projectRoot, true)
  await writeFile(join(source, 'SKILL.md'), skillMarkdown('Second version', 'Follow version two.'), 'utf8')
  await writeFile(join(source, 'reference.txt'), 'two\n', 'utf8')

  catalog = await manager.checkUpdates(projectRoot)
  assert.equal(catalog.entries[0].updateAvailable, true)

  catalog = await manager.update('alpha', undefined, projectRoot)
  const updated = catalog.entries[0]
  assert.equal(updated.description, 'Second version')
  assert.equal(updated.installedAt, installedAt)
  assert.equal(updated.globalEnabled, true)
  assert.equal(updated.projectEnabled, true)
  assert.equal(updated.updateAvailable, false)
  assert.ok(updated.updatedAt)
  assert.equal(await readFile(join(storageDir, 'library', 'alpha', 'reference.txt'), 'utf8'), 'two\n')
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

  const manager = new SkillManager({}, { storageDir })
  let catalog = await manager.installRemote(pathToFileURL(repository).href, projectRoot)
  assert.equal(catalog.entries[0].sourceType, 'git')
  assert.equal(catalog.entries[0].sourceSubpath, 'skills/alpha')
  assert.equal(catalog.entries[0].updateAvailable, false)
  await manager.setEnabled('alpha', 'global', projectRoot, true)

  await writeFile(join(skill, 'SKILL.md'), skillMarkdown('Remote version two', 'Use remote two.'), 'utf8')
  await writeFile(join(skill, 'reference.txt'), 'remote-two\n', 'utf8')
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'update'])

  catalog = await manager.checkUpdates(projectRoot)
  assert.equal(catalog.entries[0].updateAvailable, true)

  catalog = await manager.update('alpha', undefined, projectRoot)
  assert.equal(catalog.entries[0].description, 'Remote version two')
  assert.equal(catalog.entries[0].globalEnabled, true)
  assert.equal(catalog.entries[0].updateAvailable, false)
  assert.equal(await readFile(join(storageDir, 'library', 'alpha', 'reference.txt'), 'utf8'), 'remote-two\n')
})

test('rejects repository skill symlinks that escape the source root', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-symlink-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const repository = join(root, 'repository')
  const skill = join(repository, 'skills', 'alpha')
  await mkdir(skill, { recursive: true })
  await execFileAsync('git', ['init', repository])
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Skill Manager Test'])
  await writeFile(join(skill, 'SKILL.md'), skillMarkdown('Unsafe links', 'Do not load outside files.'), 'utf8')
  await symlink('../../outside.txt', join(skill, 'outside.txt'))
  await execFileAsync('git', ['-C', repository, 'add', '.'])
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'unsafe symlink'])

  const manager = new SkillManager({}, { storageDir: join(root, 'storage') })
  await assert.rejects(
    manager.installRemote(pathToFileURL(repository).href),
    /symlink escapes its source root/,
  )
})

test('rejects credentials embedded in repository URLs', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-security-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const manager = new SkillManager({}, { storageDir: join(root, 'storage') })
  await manager.catalog()
  await assert.rejects(
    manager.installRemote('https://token@github.com/example/skills.git'),
    /do not embed credentials/,
  )
})
