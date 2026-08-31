import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_STATE, isEnabledFor, isPathWithin, normalizeState, removeSkill, setEnabled, setModelInvocation } from '../lib/types/state.js'

const root = '/workspaces/demo'
const child = `${root}/packages/app`
const outside = '/workspaces/other'

test('global and project scopes resolve independently', () => {
  const globalState = setEnabled(EMPTY_STATE, 'alpha', 'global', undefined, true)
  const projectState = setEnabled(globalState, 'beta', 'project', root, true)

  assert.equal(isEnabledFor(projectState, 'alpha', outside), true)
  assert.equal(isEnabledFor(projectState, 'beta', child), true)
  assert.equal(isEnabledFor(projectState, 'beta', outside), false)
})

test('path containment rejects sibling and parent escapes', () => {
  assert.equal(isPathWithin(root, root), true)
  assert.equal(isPathWithin(root, child), true)
  assert.equal(isPathWithin(root, outside), false)
  assert.equal(isPathWithin(root, '/workspaces/demo2'), false)
})

test('removing a skill clears every scope reference', () => {
  const globalState = setEnabled(EMPTY_STATE, 'alpha', 'global', undefined, true)
  const state = setEnabled(globalState, 'alpha', 'project', root, true)
  const removed = removeSkill(setModelInvocation(state, 'alpha', false), 'alpha')
  assert.deepEqual(removed.globalEnabled, [])
  assert.deepEqual(removed.projectEnabled, {})
  assert.deepEqual(removed.modelInvocation, {})
})

test('model-invocation overrides go both ways and undefined stops overriding', () => {
  const off = setModelInvocation(EMPTY_STATE, 'alpha', false)
  const on = setModelInvocation(off, 'alpha', true)
  assert.deepEqual(off.modelInvocation, { alpha: false })
  assert.deepEqual(on.modelInvocation, { alpha: true })
  assert.deepEqual(setModelInvocation(on, 'alpha', undefined).modelInvocation, {})
  assert.deepEqual(setModelInvocation(on, 'beta', false).modelInvocation, { alpha: true, beta: false })
})

test('normalizes the current state schema', () => {
  const state = normalizeState({
    version: 1,
    globalEnabled: ['beta', 'alpha', 'alpha'],
    projectEnabled: { [root]: ['beta', 'beta'] },
  })

  assert.deepEqual(state, {
    version: 1,
    globalEnabled: ['alpha', 'beta'],
    projectEnabled: { [root]: ['beta'] },
    modelInvocation: {},
  })

  // 只保留布尔覆盖；旧状态文件没有这个字段，也照样读得动。
  assert.deepEqual(normalizeState({
    version: 1,
    globalEnabled: [],
    projectEnabled: {},
    modelInvocation: { alpha: 'yes', beta: false },
  }).modelInvocation, { beta: false })
})

test('rejects unversioned or malformed state instead of migrating it', () => {
  assert.throws(() => normalizeState({
    skills: {},
    globalEnabled: [],
    projectEnabled: {},
  }), /unsupported shape/)
  assert.throws(() => normalizeState({ version: 2 }), /unsupported shape/)
  // Extra keys are ignored: only the version contract is enforced.
  assert.doesNotThrow(() => normalizeState({
    version: 1,
    globalEnabled: [],
    projectEnabled: {},
    futureField: true,
  }))
})
