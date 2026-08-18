import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

export function projectRootForSession(state: SessionListState, sessionId: SessionId): string | undefined {
  return state.byId[sessionId]?.cwd
}
