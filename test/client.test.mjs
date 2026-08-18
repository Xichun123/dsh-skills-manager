import test from 'node:test'
import assert from 'node:assert/strict'
import { projectRootForSession } from '../lib/types/client/session.js'

test('resolves the composer project root from the session list summary', () => {
  const state = {
    byId: {
      active: { cwd: '/workspaces/demo' },
    },
  }

  assert.equal(projectRootForSession(state, 'active'), '/workspaces/demo')
  assert.equal(projectRootForSession(state, 'missing'), undefined)
})
