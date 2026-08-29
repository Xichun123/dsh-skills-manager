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
}

export interface SkillCatalog {
  readonly entries: readonly SkillCatalogEntry[]
}

export type SkillUpdateStatus = 'update-available' | 'current' | 'deleted-upstream' | 'unknown'

export interface SkillUpdateReportEntry {
  readonly name: string
  readonly status: SkillUpdateStatus
}

export interface SkillUpdateReport {
  readonly entries: readonly SkillUpdateReportEntry[]
}
