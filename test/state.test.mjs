import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_STATE, isEnabledFor, isPathWithin, removeSkill, setEnabled } from '../lib/types/state.js'

const root = '/workspaces/demo'
const child = `${root}/packages/app`
const outside = '/workspaces/other'

test('global and project scopes resolve independently', () => {
  const state = {
    ...EMPTY_STATE,
    skills: {
      alpha: { name: 'alpha', description: 'Alpha', layout: 'directory', installedAt: 'now' },
      beta: { name: 'beta', description: 'Beta', layout: 'directory', installedAt: 'now' },
    },
  }
  const globalState = setEnabled(state, 'alpha', 'global', undefined, true)
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
  const state = setEnabled({
    ...EMPTY_STATE,
    skills: { alpha: { name: 'alpha', description: 'Alpha', layout: 'file', installedAt: 'now' } },
  }, 'alpha', 'project', root, true)
  const removed = removeSkill(state, 'alpha')
  assert.deepEqual(removed.skills, {})
  assert.deepEqual(removed.globalEnabled, [])
  assert.deepEqual(removed.projectEnabled, {})
})
