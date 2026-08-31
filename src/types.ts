export type SkillScope = 'global' | 'project'
export type SkillSourceType = 'local' | 'git'

export interface SkillOrigin {
  readonly source: string
  readonly sourceType: SkillSourceType
}

export interface ManagerState {
  readonly version: 1
  readonly globalEnabled: readonly string[]
  readonly projectEnabled: Readonly<Record<string, readonly string[]>>
  /** Per-skill override of the frontmatter `disable-model-invocation` declaration; absent keys follow the file. */
  readonly modelInvocation: Readonly<Record<string, boolean>>
}

export interface SkillCatalogEntry {
  readonly name: string
  readonly description: string
  readonly sourceType?: SkillSourceType
  readonly sourcePath?: string
  readonly sourceUrl?: string
  readonly globalEnabled: boolean
  readonly projectEnabled: boolean
  readonly effectiveEnabled: boolean
  readonly updateSupported: boolean
  /** Effective model-invocation state: the frontmatter declaration unless state.json overrides it. */
  readonly modelInvocable?: boolean
}

export interface SkillCatalog {
  readonly entries: readonly SkillCatalogEntry[]
  /** Project folders that have project-scoped skills enabled through this plugin. */
  readonly projectRoots: readonly string[]
}

/** One installable skill discovered in a not-yet-installed source. */
export interface SkillInspectEntry {
  readonly name: string
  readonly description: string
}

export interface SkillInspectResult {
  readonly entries: readonly SkillInspectEntry[]
}

export type SkillUpdateStatus = 'update-available' | 'current' | 'deleted-upstream' | 'unknown'

export interface SkillUpdateReportEntry {
  readonly name: string
  readonly status: SkillUpdateStatus
}

export interface SkillUpdateReport {
  readonly entries: readonly SkillUpdateReportEntry[]
}
