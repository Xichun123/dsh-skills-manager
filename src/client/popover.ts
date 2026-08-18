import type { SkillCatalogEntry } from '../types.js'

export interface ProjectPopoverRowView {
  readonly checked: boolean
  readonly disabled: boolean
  readonly badge: '全局' | null
  readonly checkboxTitle: string
}

export function projectPopoverEnabledCount(entries: readonly Pick<SkillCatalogEntry, 'effectiveEnabled'>[]): number {
  return entries.filter(entry => entry.effectiveEnabled).length
}

export function projectPopoverRow(
  entry: Pick<SkillCatalogEntry, 'globalEnabled' | 'effectiveEnabled'>,
  busy = false,
): ProjectPopoverRowView {
  return {
    checked: entry.effectiveEnabled,
    disabled: busy || entry.globalEnabled,
    badge: entry.globalEnabled ? '全局' : null,
    checkboxTitle: entry.globalEnabled ? '全局已启用，请到 Skill 管理关闭' : '项目启用',
  }
}
