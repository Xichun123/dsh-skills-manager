import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_STATE, isEnabledFor, isPathWithin, normalizeState, removeSkill, setEnabled } from '../lib/types/state.js'

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
  const removed = removeSkill(state, 'alpha')
  assert.deepEqual(removed.globalEnabled, [])
  assert.deepEqual(removed.projectEnabled, {})
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
  })
})

test('rejects the former state shape instead of migrating it', () => {
  assert.throws(() => normalizeState({
    version: 1,
    skills: {},
    globalEnabled: [],
    projectEnabled: {},
  }), /unsupported shape/)
})
