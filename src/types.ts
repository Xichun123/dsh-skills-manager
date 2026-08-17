export type SkillScope = 'global' | 'project'
export type SkillLayout = 'directory' | 'file'
export type SkillSourceType = 'local' | 'git'

export interface InstalledSkill {
  readonly name: string
  readonly description: string
  readonly layout: SkillLayout
  readonly installedAt: string
  readonly updatedAt?: string
  readonly sourceType?: SkillSourceType
  readonly sourcePath?: string
  readonly sourceUrl?: string
  readonly sourceSubpath?: string
  readonly contentHash?: string
}

export interface ManagerState {
  readonly version: 1
  readonly skills: Readonly<Record<string, InstalledSkill>>
  readonly globalEnabled: readonly string[]
  readonly projectEnabled: Readonly<Record<string, readonly string[]>>
}

export interface SkillCatalogEntry extends InstalledSkill {
  readonly globalEnabled: boolean
  readonly projectEnabled: boolean
  readonly effectiveEnabled: boolean
  readonly updateSupported: boolean
  readonly updateAvailable: boolean
  readonly updateError?: string
}

export interface SkillCatalog {
  readonly entries: readonly SkillCatalogEntry[]
  readonly projectRoot?: string
}
