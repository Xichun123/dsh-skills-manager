import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPopoverEnabledCount, projectPopoverRow } from '../lib/types/client/popover.js'
import { projectRootForSession } from '../lib/types/client/session.js'

function entry(overrides = {}) {
  return {
    globalEnabled: false,
    effectiveEnabled: false,
    ...overrides,
  }
}

test('resolves the composer project root from the session list summary', () => {
  const state = {
    byId: {
      active: { cwd: '/workspaces/demo' },
    },
  }

  assert.equal(projectRootForSession(state, 'active'), '/workspaces/demo')
  assert.equal(projectRootForSession(state, 'missing'), undefined)
})

test('project popover treats global-only skills as enabled and locked', () => {
  const row = projectPopoverRow(entry({
    globalEnabled: true,
    effectiveEnabled: true,
  }))

  assert.deepEqual(row, {
    checked: true,
    disabled: true,
    badge: '全局',
    checkboxTitle: '全局已启用，请到 Skill 管理关闭',
  })
})

test('project popover still toggles non-global enabled skills', () => {
  const row = projectPopoverRow(entry({ effectiveEnabled: true }))

  assert.equal(row.checked, true)
  assert.equal(row.disabled, false)
  assert.equal(row.badge, null)
  assert.equal(row.checkboxTitle, '项目启用')
})

test('project popover counts effective enabled skills', () => {
  assert.equal(projectPopoverEnabledCount([
    entry({ globalEnabled: true, effectiveEnabled: true }),
    entry(),
  ]), 1)
})
