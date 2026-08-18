import type { SkillCatalogEntry } from '../types.js'

export const projectPopoverEnabledCount = (entries: readonly Pick<SkillCatalogEntry, 'effectiveEnabled'>[]) => entries.filter(entry => entry.effectiveEnabled).length

export const projectPopoverRow = (
  entry: Pick<SkillCatalogEntry, 'globalEnabled' | 'effectiveEnabled'>,
  busy = false,
) => ({
  checked: entry.effectiveEnabled,
  disabled: busy || entry.globalEnabled,
  badge: entry.globalEnabled ? '全局' : null,
  checkboxTitle: entry.globalEnabled ? '全局已启用，请到 Skill 管理关闭' : '项目启用',
})
