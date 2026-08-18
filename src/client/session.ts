import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

export const projectRootForSession = (state: SessionListState, sessionId: SessionId) => state.byId[sessionId]?.cwd
