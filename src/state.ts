import { isAbsolute, relative, sep } from 'node:path'
import type { ManagerState, SkillScope } from './types.js'

export const EMPTY_STATE: ManagerState = {
  version: 1,
  globalEnabled: [],
  projectEnabled: {},
}

export function normalizeState(value: unknown): ManagerState {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 3
    || value.version !== 1
    || !Array.isArray(value.globalEnabled)
    || !isRecord(value.projectEnabled)
  ) {
    throw new Error('skill-manager state.json has an unsupported shape')
  }

  return {
    version: 1,
    globalEnabled: cleanNames(value.globalEnabled),
    projectEnabled: cleanProjects(value.projectEnabled),
  }
}

export function setEnabled(
  state: ManagerState,
  name: string,
  scope: SkillScope,
  projectRoot: string | undefined,
  enabled: boolean,
): ManagerState {
  if (scope === 'project' && !projectRoot) throw new Error('projectRoot is required for project scope')

  if (scope === 'global') {
    return { ...state, globalEnabled: updateNames(state.globalEnabled, name, enabled) }
  }

  const current = state.projectEnabled[projectRoot!] ?? []
  const next = updateNames(current, name, enabled)
  const projectEnabled = { ...state.projectEnabled }
  if (next.length === 0) delete projectEnabled[projectRoot!]
  else projectEnabled[projectRoot!] = next
  return { ...state, projectEnabled }
}

export function removeSkill(state: ManagerState, name: string): ManagerState {
  return {
    ...state,
    globalEnabled: state.globalEnabled.filter(item => item !== name),
    projectEnabled: Object.fromEntries(
      Object.entries(state.projectEnabled)
        .map(([root, names]) => [root, names.filter(item => item !== name)] as const)
        .filter(([, names]) => names.length > 0),
    ),
  }
}

export function isPathWithin(root: string, target: string): boolean {
  if (!isAbsolute(root) || !isAbsolute(target)) return false
  const child = relative(root, target)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`))
}

export function isEnabledFor(state: ManagerState, name: string, cwd: string | undefined): boolean {
  if (state.globalEnabled.includes(name)) return true
  if (!cwd) return false
  return Object.entries(state.projectEnabled).some(([root, names]) => names.includes(name) && isPathWithin(root, cwd))
}

function updateNames(names: readonly string[], name: string, enabled: boolean): string[] {
  const next = new Set(names)
  if (enabled) next.add(name)
  else next.delete(name)
  return [...next].sort()
}

function cleanNames(value: unknown[]): string[] {
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].sort()
}

function cleanProjects(value: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [root, names] of Object.entries(value)) {
    if (!isAbsolute(root) || !Array.isArray(names)) continue
    const clean = cleanNames(names)
    if (clean.length > 0) result[root] = clean
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
