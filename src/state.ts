import { isAbsolute, relative, sep } from 'node:path'
import type { ManagerState, SkillScope } from './types.js'

export const EMPTY_STATE: ManagerState = {
  version: 1,
  skills: {},
  globalEnabled: [],
  projectEnabled: {},
}

export function normalizeState(value: unknown): ManagerState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.skills) || !Array.isArray(value.globalEnabled) || !isRecord(value.projectEnabled)) {
    throw new Error('skill-manager state.json has an unsupported shape')
  }

  const skills: Record<string, ManagerState['skills'][string]> = {}
  for (const [name, entry] of Object.entries(value.skills)) {
    if (!isRecord(entry) || entry.name !== name || typeof entry.description !== 'string' || (entry.layout !== 'directory' && entry.layout !== 'file') || typeof entry.installedAt !== 'string') {
      throw new Error(`skill-manager state.json has an invalid skill entry: ${name}`)
    }
    skills[name] = {
      name,
      description: entry.description,
      layout: entry.layout,
      installedAt: entry.installedAt,
      ...(typeof entry.updatedAt === 'string' ? { updatedAt: entry.updatedAt } : {}),
      ...(entry.sourceType === 'local' || entry.sourceType === 'git' ? { sourceType: entry.sourceType } : {}),
      ...(typeof entry.sourcePath === 'string' && isAbsolute(entry.sourcePath) ? { sourcePath: entry.sourcePath } : {}),
      ...(typeof entry.sourceUrl === 'string' ? { sourceUrl: entry.sourceUrl } : {}),
      ...(typeof entry.sourceSubpath === 'string' ? { sourceSubpath: entry.sourceSubpath } : {}),
      ...(typeof entry.contentHash === 'string' ? { contentHash: entry.contentHash } : {}),
    }
  }

  return {
    version: 1,
    skills,
    globalEnabled: cleanNames(value.globalEnabled, skills),
    projectEnabled: cleanProjects(value.projectEnabled, skills),
  }
}

export function setEnabled(
  state: ManagerState,
  name: string,
  scope: SkillScope,
  projectRoot: string | undefined,
  enabled: boolean,
): ManagerState {
  if (!(name in state.skills)) throw new Error(`skill is not installed: ${name}`)
  if (scope === 'project' && !projectRoot) throw new Error('projectRoot is required for project scope')

  if (scope === 'global') {
    return {
      ...state,
      globalEnabled: updateNames(state.globalEnabled, name, enabled),
    }
  }

  const current = state.projectEnabled[projectRoot! ] ?? []
  const next = updateNames(current, name, enabled)
  const projectEnabled = { ...state.projectEnabled }
  if (next.length === 0) delete projectEnabled[projectRoot!]
  else projectEnabled[projectRoot!] = next
  return { ...state, projectEnabled }
}

export function removeSkill(state: ManagerState, name: string): ManagerState {
  if (!(name in state.skills)) throw new Error(`skill is not installed: ${name}`)
  const skills = { ...state.skills }
  delete skills[name]
  return {
    version: 1,
    skills,
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

function cleanNames(value: unknown[], skills: Record<string, unknown>): string[] {
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item in skills))].sort()
}

function cleanProjects(value: Record<string, unknown>, skills: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [root, names] of Object.entries(value)) {
    if (!isAbsolute(root) || !Array.isArray(names)) continue
    const clean = cleanNames(names, skills)
    if (clean.length > 0) result[root] = clean
  }
  return result
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
