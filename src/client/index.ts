import { createElement as h, useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ComponentType, type FormEvent } from 'react'
import { Pill, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import Wrench from 'lucide-react/dist/esm/icons/wrench.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import SearchCheck from 'lucide-react/dist/esm/icons/search-check.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import Globe from 'lucide-react/dist/esm/icons/globe.mjs'
import FolderGit from 'lucide-react/dist/esm/icons/folder-git.mjs'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs'
import PackageOpen from 'lucide-react/dist/esm/icons/package-open.mjs'
import Puzzle from 'lucide-react/dist/esm/icons/puzzle.mjs'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.mjs'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillCatalog, SkillCatalogEntry, SkillInspectEntry, SkillInspectResult, SkillUpdateReport, SkillUpdateStatus } from '../types.js'
import { projectPopoverEnabledCount, projectPopoverRow } from './popover.js'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

// 'workspaces' 仍需注入：项目范围列表已改用 catalog.projectRoots，但「本机导入」的目录选择器还依赖它
export const inject = ['connection', 'slots', 'workspaces']

interface ManagerApi {
  readonly list: (projectRoot?: string) => Promise<SkillCatalog>
  readonly mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<SkillCatalog>
  readonly inspect: (path: string) => Promise<SkillInspectResult>
  readonly inspectRemote: (repository: string) => Promise<SkillInspectResult>
}

interface SectionProps extends ManagerApi {
  readonly checkUpdates: () => Promise<SkillUpdateReport>
  readonly pickDirectory: () => Promise<string | null>
  readonly loopback: boolean
}

interface ComposerProps extends ManagerApi {
  readonly session: { readonly sessionId: SessionId }
  readonly useSessions: SnapshotSelectorHook<SessionListState>
}

interface IconProps {
  readonly size?: number | string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}

const ICON_SPIN: [string, string] = ['dsh-skill-manager-spin', 'to { transform: rotate(360deg); }']

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(ICON_SPIN[0])) return
  const style = document.createElement('style')
  style.id = ICON_SPIN[0]
  style.textContent = `
    @keyframes ${ICON_SPIN[0]} { ${ICON_SPIN[1]} }
    .dsh-skill-manager-row:hover {
      border-color: ${tokens.borderStrong} !important;
      background: ${tokens.surfaceHover} !important;
    }
    @container (max-width: 360px) {
      .dsh-skill-manager-row { grid-template-columns: minmax(0, 1fr) !important; }
      .dsh-skill-manager-row-icon { display: none !important; }
      .dsh-skill-manager-row-actions { grid-column: 1 !important; justify-content: flex-start !important; }
    }
  `
  document.head.appendChild(style)
}

const spinnerStyle: CSSProperties = { animation: `${ICON_SPIN[0]} 1s linear infinite`, flex: '0 0 auto' }

const monoStyle: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }

const tokens = {
  border: 'var(--border-subtle, rgba(148, 163, 184, .22))',
  borderStrong: 'var(--border-strong, rgba(148, 163, 184, .38))',
  accent: 'var(--fg-accent, #6366f1)',
  success: 'var(--fg-success, #16a34a)',
  danger: 'var(--fg-danger, #dc2626)',
  secondary: 'var(--fg-secondary, #64748b)',
  surfaceHover: 'var(--bg-hover, rgba(148, 163, 184, .08))',
}

const panelStyle: CSSProperties = { containerType: 'inline-size', display: 'grid', gap: 18, width: '100%', minWidth: 0, maxWidth: 760, padding: '6px 0 36px' }

function buttonStyle(tone: 'primary' | 'ghost', disabled: boolean): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 12px',
    borderRadius: 8, border: `1px solid transparent`, fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
    transition: 'background .15s ease, border-color .15s ease',
  }
  if (tone === 'primary') return { ...base, background: tokens.accent, color: 'var(--fg-on-accent, #fff)', border: 'none' }
  return { ...base, background: 'transparent', color: 'inherit', border: `1px solid ${tokens.border}` }
}

const iconButtonStyle: CSSProperties = {
  display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0,
  border: 'none', borderRadius: 7, background: 'transparent', color: tokens.secondary, cursor: 'pointer',
}

const inputStyle: CSSProperties = {
  width: '100%', minHeight: 34, padding: '0 10px 0 30px', borderRadius: 8,
  border: `1px solid ${tokens.border}`, background: 'var(--bg-primary, transparent)', color: 'inherit',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

const selectStyle: CSSProperties = {
  minHeight: 34, maxWidth: 300, padding: '0 8px', borderRadius: 8,
  border: `1px solid ${tokens.border}`, background: 'var(--bg-primary, transparent)', color: 'inherit', fontSize: 13,
}

const checkboxStyle: CSSProperties = { width: 16, height: 16, margin: 0, accentColor: tokens.accent, flex: '0 0 auto' }

export function apply(ctx: ClientContext): void {
  const connection = (ctx as unknown as { readonly connection: ConnectionHandle }).connection
  const request = async <T>(endpoint: string, payload: Record<string, unknown> = {}): Promise<T> => {
    const result = await connection.rpc.call('/skill-manager', endpoint, payload) as RpcResult<T>
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const list = (projectRoot?: string): Promise<SkillCatalog> => request('list', projectRoot ? { projectRoot } : {})
  const mutate = (endpoint: string, payload: Record<string, unknown>): Promise<SkillCatalog> => request(endpoint, payload)
  const inspect = (path: string): Promise<SkillInspectResult> => request('inspect', { path })
  const inspectRemote = (repository: string): Promise<SkillInspectResult> => request('inspect-remote', { repository })
  const checkUpdates = (): Promise<SkillUpdateReport> => request('check-updates')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 35,
    label: 'Skill 管理',
    inject: () => ({ list, mutate, inspect, inspectRemote, checkUpdates, pickDirectory: () => ctx.workspaces.pickDirectory(), loopback: connection.isLoopback }),
  }, SkillManagerSection as never))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'skill-manager',
    order: 10,
    inject: () => ({ list, mutate }),
  }, ComposerSkillButton as never))
}

function SkillManagerSection(props: SectionProps): ReturnType<typeof h> {
  const { list, mutate, inspect, inspectRemote, checkUpdates, pickDirectory, loopback } = props
  const [projectRoot, setProjectRoot] = useState<string | undefined>(undefined)
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [statuses, setStatuses] = useState<Readonly<Record<string, SkillUpdateStatus>>>({})
  const [error, setError] = useState<string | null>(null)
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [repository, setRepository] = useState('')
  const [grouped, setGrouped] = useState(false)
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({})
  // 已点删除、等服务端确认的 skill：立刻从列表隐藏，失败再放回
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set())
  // 待确认导入：inspect 结果 + 已勾选集合；提交后清空。
  const [selection, setSelection] = useState<{ entries: readonly SkillInspectEntry[]; chosen: ReadonlySet<string>; path?: string; repository?: string } | null>(null)

  useEffect(() => { ensureKeyframes() }, [])

  // 追踪用户是否主动选过「只看全局」，避免 useEffect 把它重置回第一个项目
  const userChoseGlobal = useRef(false)
  const projectRoots = catalog?.projectRoots ?? []

  useEffect(() => {
    // 仅当用户未主动选择「只看全局」时，才自动选中第一个有项目级 skill 的文件夹
    if (projectRoot === undefined && !userChoseGlobal.current && projectRoots.length > 0) setProjectRoot(projectRoots[0])
    // 当前选中的文件夹不再有项目级 skill 时，回退到第一个
    if (projectRoot !== undefined && !projectRoots.includes(projectRoot)) setProjectRoot(projectRoots[0])
  }, [projectRoot, projectRoots])

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try { setCatalog(await list(projectRoot)) } catch (reason) { setError(messageOf(reason)) }
    finally { setBusy(false) }
  }, [list, projectRoot])

  useEffect(() => { void refresh() }, [refresh])

  const run = useCallback(async (action: () => Promise<SkillCatalog>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      setCatalog(await action())
      return true
    } catch (reason) {
      setError(messageOf(reason))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = (catalog?.entries ?? []).filter(entry => !removing.has(entry.name)
    && (normalizedQuery.length === 0 || `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(normalizedQuery)))

  // 乐观删除：先隐藏该行（不锁整页），服务端确认后写回目录；失败则放回并报错。
  const removeSkill = (entry: SkillCatalogEntry) => {
    setRemoving(prev => new Set(prev).add(entry.name))
    setError(null)
    void mutate('remove', { name: entry.name, projectRoot }).then(
      next => {
        setCatalog(next)
        setRemoving(prev => { const rest = new Set(prev); rest.delete(entry.name); return rest })
      },
      reason => {
        setError(messageOf(reason))
        setRemoving(prev => { const rest = new Set(prev); rest.delete(entry.name); return rest })
      },
    )
  }

  const importSkill = async () => {
    const path = await pickDirectory()
    if (!path) return
    await inspectForInstall(() => inspect(path), path, undefined)
  }

  const importRepository = async (event: FormEvent) => {
    event.preventDefault()
    const source = repository.trim()
    if (!source) return
    if (await inspectForInstall(() => inspectRemote(source), undefined, source)) {
      setRepository('')
      setRepositoryOpen(false)
    }
  }

  // 拿到来源的 skill 列表后进入勾选面板；来源只有一个 skill 时跳过勾选直接装。
  const inspectForInstall = async (call: () => Promise<SkillInspectResult>, path: string | undefined, repository: string | undefined): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const result = await call()
      if (result.entries.length === 0) throw new Error('来源中没有可安装的 skill')
      if (result.entries.length === 1) {
        await installSelection([result.entries[0].name], path, repository)
        return true
      }
      setSelection({ entries: result.entries, chosen: new Set(result.entries.map(entry => entry.name)), path, repository })
      return true
    } catch (reason) {
      setError(messageOf(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  const installSelection = async (names: readonly string[], path: string | undefined, repository: string | undefined) => {
    setBusy(true)
    setError(null)
    try {
      setCatalog(await mutate(repository !== undefined ? 'install-remote' : 'install', {
        ...(repository !== undefined ? { repository } : { path }),
        skills: names,
        projectRoot,
      }))
      setSelection(null)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const updateSkill = async (entry: SkillCatalogEntry) => {
    const path = entry.updateSupported ? undefined : await pickDirectory() ?? undefined
    if (!entry.updateSupported && !path) return
    await run(() => mutate('update', { name: entry.name, path, projectRoot }))
  }

  const checkAll = async () => {
    setChecking(true)
    setError(null)
    try {
      const report = await checkUpdates()
      setStatuses(Object.fromEntries(report.entries.map(entry => [entry.name, entry.status])))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setChecking(false)
    }
  }

  const updatable = (catalog?.entries ?? []).filter(entry => !removing.has(entry.name) && statuses[entry.name] === 'update-available' && entry.updateSupported)

  const updateAll = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const entry of updatable) setCatalog(await mutate('update', { name: entry.name, projectRoot }))
      await checkAll()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const projectLabel = projectRoot === undefined ? '当前项目' : projectRoot.split('/').filter(Boolean).pop() ?? projectRoot
  const rowProps = (entry: SkillCatalogEntry) => ({
    key: entry.name,
    entry,
    projectLabel,
    projectAvailable: projectRoot !== undefined,
    busy,
    updateStatus: statuses[entry.name],
    onScopeChange: (scope: 'off' | 'global' | 'project') => void run(async () => {
      // 后端串行处理，逐条切换即可；最后一次返回的目录就是最新状态
      let next = await mutate('set-enabled', { name: entry.name, scope: 'global', projectRoot, enabled: scope === 'global' })
      if (projectRoot !== undefined) next = await mutate('set-enabled', { name: entry.name, scope: 'project', projectRoot, enabled: scope === 'project' })
      return next
    }),
    onUpdate: () => void updateSkill(entry),
    onRemove: () => removeSkill(entry),
  })
  return h('div', { style: panelStyle, 'aria-busy': busy },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
        h(Puzzle, { size: 20, 'aria-hidden': true }),
        h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, 'Skill 管理'),
        busy ? h(RefreshCw, { size: 14, 'aria-hidden': true, style: spinnerStyle }) : null,
      ),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', { type: 'button', style: buttonStyle('ghost', busy || checking), onClick: () => void checkAll(), disabled: busy || checking, title: '检测全部 skill 是否有更新（只检测，不更新）' },
          h(SearchCheck, { size: 14, 'aria-hidden': true }), checking ? '检测中…' : '检测'),
        updatable.length > 0 ? h('button', { type: 'button', style: buttonStyle('primary', busy || checking || !loopback), onClick: () => void updateAll(), disabled: busy || checking || !loopback, title: loopback ? `更新全部 ${updatable.length} 个有更新的 skill` : '仅在本机连接时可更新' },
          h(RefreshCw, { size: 14, 'aria-hidden': true }), `全部更新 (${updatable.length})`) : null,
        h('button', { type: 'button', style: buttonStyle('ghost', busy || !loopback), onClick: () => setRepositoryOpen(value => !value), disabled: busy || !loopback, title: loopback ? '从 Git 仓库导入 skill' : '仅在本机连接时可导入' },
          h(GitBranch, { size: 14, 'aria-hidden': true }), '仓库'),
        h('button', { type: 'button', style: buttonStyle('primary', busy || !loopback), onClick: importSkill, disabled: busy || !loopback, title: loopback ? '从本机目录导入 skill' : '仅在本机连接时可导入' },
          h(Plus, { size: 14, 'aria-hidden': true }), '本机'),
      ),
    ),
    h('p', { style: { margin: '-8px 0 0', fontSize: 13, color: tokens.secondary, lineHeight: 1.5 } },
      '从本机目录或 Git 仓库导入 skill，并按「全局」或「项目」范围启用。'),
    repositoryOpen ? h('form', { onSubmit: importRepository, style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
      h('input', {
        type: 'text',
        value: repository,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setRepository(event.currentTarget.value),
        placeholder: 'owner/repo 或 Git URL',
        'aria-label': 'Git 仓库地址',
        autoFocus: true,
        disabled: busy,
        style: { ...inputStyle, flex: '1 1 260px', minWidth: 0, paddingLeft: 10 },
      }),
      h('button', { type: 'submit', style: buttonStyle('primary', busy || !repository.trim()), disabled: busy || !repository.trim() },
        h(GitBranch, { size: 14, 'aria-hidden': true }), '导入'),
      h('button', { type: 'button', style: iconButtonStyle, onClick: () => setRepositoryOpen(false), disabled: busy, title: '关闭仓库导入', 'aria-label': '关闭仓库导入' },
        h(X, { size: 15, 'aria-hidden': true })),
    ) : null,
    selection ? h('section', { 'aria-label': '选择要导入的 skill', style: { display: 'grid', gap: 8, padding: '12px 14px', borderRadius: 10, border: `1px solid ${tokens.borderStrong}` } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
        h('strong', { style: { fontSize: 13, fontWeight: 600 } }, `来源提供 ${selection.entries.length} 个 skill，勾选要导入的：`),
        h('button', { type: 'button', style: iconButtonStyle, onClick: () => setSelection(null), disabled: busy, title: '取消导入', 'aria-label': '取消导入' },
          h(X, { size: 15, 'aria-hidden': true })),
      ),
      h('div', { style: { display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' } },
        selection.entries.map(entry => h('label', { key: entry.name, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px', borderRadius: 7, cursor: busy ? 'default' : 'pointer', fontSize: 13 }, title: entry.description || entry.name },
          h('input', { type: 'checkbox', checked: selection.chosen.has(entry.name), disabled: busy, onChange: () => setSelection(prev => prev && {
            ...prev,
            chosen: prev.chosen.has(entry.name)
              ? new Set([...prev.chosen].filter(name => name !== entry.name))
              : new Set([...prev.chosen, entry.name]),
          }), 'aria-label': `导入 ${entry.name}`, style: checkboxStyle }),
          h('span', { style: { ...monoStyle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
          h('span', { style: { color: tokens.secondary, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' } }, entry.description),
        )),
      ),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', { type: 'button', style: buttonStyle('primary', busy || selection.chosen.size === 0), disabled: busy || selection.chosen.size === 0, onClick: () => void installSelection([...selection.chosen], selection.path, selection.repository) },
          h(Plus, { size: 14, 'aria-hidden': true }), `导入所选 (${selection.chosen.size})`),
      ),
    ) : null,
    h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
      h('div', { style: { position: 'relative', flex: '1 1 220px', display: 'flex', alignItems: 'center' } },
        h(Search, { size: 14, 'aria-hidden': true, style: { position: 'absolute', left: 9, color: tokens.secondary, pointerEvents: 'none' } }),
        h('input', { type: 'search', value: query, placeholder: '搜索 skill…', 'aria-label': '搜索 skill', onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), style: inputStyle }),
      ),
      h('label', { style: { display: 'flex', flex: '1 1 220px', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 13, color: tokens.secondary } },
        h('span', { style: { flex: '0 0 auto' } }, '项目范围'),
        h('select', { value: projectRoot ?? '__global__', onChange: (event: ChangeEvent<HTMLSelectElement>) => { const value = event.currentTarget.value; if (value === '__global__') { userChoseGlobal.current = true; setProjectRoot(undefined) } else { userChoseGlobal.current = false; setProjectRoot(value) } }, style: { ...selectStyle, flex: '1 1 auto', minWidth: 0, maxWidth: 'none' } },
          h('option', { value: '__global__' }, '只看全局'),
          // 当前选中的文件夹可能已不在 projectRoots（刚被清空），保留显示以免选中态凭空消失
          ...(projectRoot !== undefined && !projectRoots.includes(projectRoot) ? [projectRoot] : projectRoots).map(root =>
            h('option', { key: root, value: root, title: root }, root.split('/').filter(Boolean).pop() ?? root)),
        ),
      ),
      h(Pill, { active: grouped, onClick: () => setGrouped(value => !value), title: '按来源仓库分组', 'aria-pressed': grouped, style: { flex: '0 0 auto' } },
        h(GitBranch, { size: 12, 'aria-hidden': true }), '按仓库'),
    ),
    error ? h('div', { role: 'alert', style: { display: 'flex', gap: 8, alignItems: 'center', margin: 0, padding: '9px 12px', borderRadius: 8, fontSize: 13, color: tokens.danger, background: 'rgba(220, 38, 38, .08)', border: '1px solid rgba(220, 38, 38, .28)' } },
      h(AlertCircle, { size: 15, 'aria-hidden': true }), error) : null,
    h('section', { style: { display: 'grid', width: '100%', minWidth: 0, gap: 8 }, 'aria-label': '已安装 skill' },
      catalog === null
        ? h('p', { style: { margin: 0, padding: '24px 0', textAlign: 'center', fontSize: 13, color: tokens.secondary } }, '正在读取…')
        : filtered.length === 0
          ? h(EmptyState, { hasAny: catalog.entries.some(entry => !removing.has(entry.name)) })
          : grouped
            ? groupBySource(filtered).map(group => h('div', { key: group.key, style: { display: 'grid', gap: 8 } },
              h('button', {
                type: 'button',
                onClick: () => setCollapsed(prev => ({ ...prev, [group.key]: !prev[group.key] })),
                'aria-expanded': !collapsed[group.key],
                style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' },
              },
                collapsed[group.key] ? h(ChevronRight, { size: 14, 'aria-hidden': true, style: { color: tokens.secondary, flex: '0 0 auto' } }) : h(ChevronDown, { size: 14, 'aria-hidden': true, style: { color: tokens.secondary, flex: '0 0 auto' } }),
                h(GitBranch, { size: 13, 'aria-hidden': true, style: { color: tokens.secondary, flex: '0 0 auto' } }),
                h('span', { title: group.key === '__local__' ? undefined : group.key, style: { ...monoStyle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, group.label),
                h('span', { style: { color: tokens.secondary, fontWeight: 400, flex: '0 0 auto' } }, `${group.entries.length} 个`),
              ),
              collapsed[group.key] ? null : group.entries.map(entry => h(SkillRow, rowProps(entry))),
            ))
            : filtered.map(entry => h(SkillRow, rowProps(entry))),
    ),
  )
}

function groupBySource(entries: readonly SkillCatalogEntry[]): ReadonlyArray<{ key: string; label: string; entries: readonly SkillCatalogEntry[] }> {
  const groups = new Map<string, { label: string; entries: SkillCatalogEntry[] }>()
  for (const entry of entries) {
    const key = entry.sourceType === 'git' && entry.sourceUrl ? entry.sourceUrl : '__local__'
    const label = key === '__local__' ? '本机导入' : shortRepoLabel(key)
    const group = groups.get(key) ?? { label, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, label: group.label, entries: group.entries }))
    .sort((a, b) => (a.key === '__local__' ? 1 : b.key === '__local__' ? -1 : a.label.localeCompare(b.label)))
}

function shortRepoLabel(url: string): string {
  const match = /^(?:https?:\/\/|git@|ssh:\/\/git@)?([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)
  return match ? `${match[2]} (${match[1]})` : url
}

function EmptyState(props: { readonly hasAny: boolean }): ReturnType<typeof h> {
  return h('div', { style: { display: 'grid', justifyItems: 'center', gap: 8, padding: '36px 16px', borderRadius: 10, border: `1px dashed ${tokens.borderStrong}`, color: tokens.secondary, textAlign: 'center' } },
    h(PackageOpen, { size: 26, 'aria-hidden': true }),
    h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.5 } }, props.hasAny ? '没有匹配的 skill，试试调整搜索词。' : '还没有导入任何 skill。点击右上角「导入」，从本机目录开始。'),
  )
}

function ComposerSkillButton(props: ComposerProps): ReturnType<typeof h> {
  const { session, useSessions, list, mutate } = props
  const projectRoot = useSessions(state => state.byId[session.sessionId]?.cwd)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsidePointer(containerRef, open, setOpen)

  return h('div', { ref: containerRef, style: { position: 'relative', display: 'inline-flex', marginLeft: -25 } },
    h('button', {
      type: 'button',
      title: projectRoot ? '配置当前项目的 Skill' : '当前会话没有工作区',
      'aria-label': '配置当前项目的 Skill',
      'aria-expanded': open,
      disabled: !projectRoot,
      onClick: () => setOpen(value => !value),
      style: {
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: open ? 'var(--dsw-alias-bg-active, rgba(255, 255, 255, .16))' : 'var(--dsw-specific-selector, rgba(255, 255, 255, .08))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: projectRoot ? 'pointer' : 'default',
        opacity: projectRoot ? 1 : 0.5,
      },
    }, h(Wrench, { size: 16, 'aria-hidden': true })),
    open && projectRoot ? h(ProjectSkillPopover, { projectRoot, list, mutate, onClose: () => setOpen(false) }) : null,
  )
}

function ProjectSkillPopover(props: Pick<ManagerApi, 'list' | 'mutate'> & { readonly projectRoot: string; readonly onClose: () => void }): ReturnType<typeof h> {
  const { projectRoot, list, mutate, onClose } = props
  const theme = currentThemeColors()
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { ensureKeyframes() }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try { setCatalog(await list(projectRoot)) } catch (reason) { setError(messageOf(reason)) }
    finally { setBusy(false) }
  }, [list, projectRoot])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = async (entry: SkillCatalogEntry, enabled: boolean) => {
    setBusy(true)
    setError(null)
    try { setCatalog(await mutate('set-enabled', { name: entry.name, scope: 'project', projectRoot, enabled })) } catch (reason) { setError(messageOf(reason)) }
    finally { setBusy(false) }
  }

  const enabledCount = projectPopoverEnabledCount(catalog?.entries ?? [])

  return h('section', { style: { position: 'absolute', zIndex: 50, left: 0, bottom: 40, width: 320, display: 'grid', gap: 6, padding: 12, border: `1px solid ${tokens.borderStrong}`, borderRadius: 12, background: theme.background, color: theme.color, boxShadow: '0 16px 40px rgba(0, 0, 0, .4)' }, 'aria-label': '当前项目 Skill' },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', paddingBottom: 4 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
        h(FolderGit, { size: 14, 'aria-hidden': true, style: { color: tokens.secondary, flex: '0 0 auto' } }),
        h('strong', { style: { fontSize: 13, fontWeight: 600 } }, '项目 Skill'),
        h('span', { style: { fontSize: 12, color: tokens.secondary } }, `${enabledCount}/${catalog?.entries.length ?? 0} 已启用`),
      ),
      h('button', { type: 'button', onClick: onClose, style: iconButtonStyle, 'aria-label': '关闭项目 Skill', title: '关闭' }, h(X, { size: 14, 'aria-hidden': true })),
    ),
    error ? h('div', { role: 'alert', style: { display: 'flex', gap: 6, alignItems: 'center', margin: 0, padding: '7px 9px', borderRadius: 7, fontSize: 12, color: tokens.danger, background: 'rgba(220, 38, 38, .08)' } },
      h(AlertCircle, { size: 13, 'aria-hidden': true }), error) : null,
    h('div', { style: { display: 'grid', gap: 1, maxHeight: 280, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' } },
      catalog === null
        ? h('p', { style: { margin: 0, padding: '18px 0', textAlign: 'center', fontSize: 12, color: tokens.secondary } }, '正在读取…')
        : catalog.entries.length === 0
          ? h('p', { style: { margin: 0, padding: '18px 0', textAlign: 'center', fontSize: 12, color: tokens.secondary } }, '未导入 skill。请到「设置 → Skill 管理」导入。')
          : catalog.entries.map(entry => {
            const row = projectPopoverRow(entry, busy)
            return h('label', { key: entry.name, style: { display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) 30px', gap: 8, alignItems: 'center', padding: '7px 6px', borderRadius: 7, fontSize: 13, cursor: row.disabled ? 'default' : 'pointer' }, title: entry.description || entry.name },
              h(Puzzle, { size: 13, 'aria-hidden': true, style: { color: entry.effectiveEnabled ? tokens.accent : tokens.secondary } }),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
                row.badge ? h(StatusBadge, { active: true, icon: Globe, label: row.badge }) : null,
              ),
              h('input', { type: 'checkbox', checked: row.checked, disabled: row.disabled, onChange: (event: ChangeEvent<HTMLInputElement>) => void toggle(entry, event.currentTarget.checked), 'aria-label': `${entry.name} 项目开关`, title: row.checkboxTitle, style: checkboxStyle }),
            )
          }),
    ),
    busy ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', paddingTop: 2 } }, h(RefreshCw, { size: 12, 'aria-hidden': true, style: spinnerStyle })) : null,
  )
}

const UPDATE_BADGE: Readonly<Record<SkillUpdateStatus, { label: string; color: string; background: string; border: string }>> = {
  'update-available': { label: '有更新', color: tokens.accent, background: 'rgba(99, 102, 241, .1)', border: '1px solid rgba(99, 102, 241, .35)' },
  'current': { label: '已是最新', color: tokens.success, background: 'rgba(22, 163, 74, .1)', border: '1px solid rgba(22, 163, 74, .3)' },
  'deleted-upstream': { label: '上游已删除', color: tokens.danger, background: 'rgba(220, 38, 38, .08)', border: '1px solid rgba(220, 38, 38, .3)' },
  'unknown': { label: '无法检测', color: tokens.secondary, background: 'rgba(148, 163, 184, .09)', border: '1px solid transparent' },
}

function SkillRow(props: {
  readonly entry: SkillCatalogEntry
  readonly projectLabel: string
  readonly projectAvailable: boolean
  readonly busy: boolean
  readonly updateStatus?: SkillUpdateStatus
  readonly onScopeChange: (scope: 'off' | 'global' | 'project') => void
  readonly onUpdate: () => void
  readonly onRemove: () => void
}): ReturnType<typeof h> {
  const { entry, projectLabel, projectAvailable, busy, updateStatus, onScopeChange, onUpdate, onRemove } = props
  const badge = updateStatus ? UPDATE_BADGE[updateStatus] : undefined
  return h('article', {
    className: 'dsh-skill-manager-row',
    style: {
      display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 12, alignItems: 'center',
      width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box',
      padding: '12px 14px', borderRadius: 10, border: `1px solid ${tokens.border}`,
      background: 'transparent', transition: 'border-color .15s ease, background .15s ease',
    },
  },
    h('div', { className: 'dsh-skill-manager-row-icon', style: { display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, color: entry.effectiveEnabled ? tokens.accent : tokens.secondary, background: entry.effectiveEnabled ? 'rgba(99, 102, 241, .1)' : 'rgba(148, 163, 184, .1)' } },
      h(Puzzle, { size: 16, 'aria-hidden': true }),
    ),
    h('div', { style: { minWidth: 0, display: 'grid', gap: 4 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
        h('strong', { style: { ...monoStyle, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
        badge ? h('span', { style: { display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap', color: badge.color, background: badge.background, border: badge.border } }, badge.label) : null,
        h(SourceBadge, { entry }),
        entry.modelInvocable === false ? h('span', { title: 'skill 声明了 disable-model-invocation：模型不会自动调用，只能用户手动引用', style: { display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap', color: tokens.secondary, background: 'rgba(148, 163, 184, .09)' } }, '仅手动') : null,
        h(StatusBadge, { active: entry.globalEnabled, icon: Globe, label: '全局' }),
        projectAvailable ? h(StatusBadge, { active: entry.projectEnabled, icon: FolderGit, label: projectLabel }) : null,
      ),
      entry.description ? h('p', { style: { margin: 0, color: tokens.secondary, lineHeight: 1.45, fontSize: 12.5 as never, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as CSSProperties }, entry.description) : null,
    ),
    h('div', { className: 'dsh-skill-manager-row-actions', style: { gridColumn: '1 / -1', display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('div', { role: 'radiogroup', 'aria-label': `${entry.name} 启用范围`, title: '启用范围', style: { display: 'inline-flex', gap: 4, flex: '0 0 auto' } },
        (projectAvailable
          ? [['off', '关闭'], ['global', '全局'], ['project', `仅${projectLabel}`]] as const
          : [['off', '关闭'], ['global', '全局']] as const
        ).map(([scope, label]) => {
          const active = (entry.globalEnabled ? 'global' : entry.projectEnabled ? 'project' : 'off') === scope
          return h(Pill, {
            key: scope,
            active,
            disabled: busy,
            role: 'radio',
            'aria-checked': active,
            // 点当前范围是空操作，别为它跑一趟 RPC
            onClick: () => { if (!active) onScopeChange(scope) },
          }, label)
        }),
      ),
      h('button', { type: 'button', style: { ...iconButtonStyle, color: tokens.secondary }, disabled: busy, onClick: onUpdate, title: entry.updateSupported ? (entry.sourceType === 'git' ? '从远程仓库更新' : '从原始目录更新') : '选择来源目录并更新', 'aria-label': `更新 ${entry.name}` },
        h(RefreshCw, { size: 15, 'aria-hidden': true })),
      h('button', { type: 'button', style: { ...iconButtonStyle, color: tokens.danger }, onClick: onRemove, title: '从库中移除', 'aria-label': `移除 ${entry.name}` },
        h(Trash2, { size: 15, 'aria-hidden': true })),
    ),
  )
}

function SourceBadge(props: { readonly entry: SkillCatalogEntry }): ReturnType<typeof h> {
  const remote = props.entry.sourceType === 'git'
  const local = props.entry.sourceType === 'local'
  const Icon = remote ? GitBranch : local ? FolderGit : AlertCircle
  const label = remote ? 'Git' : local ? '本机' : '未知'
  const title = remote ? props.entry.sourceUrl : local ? props.entry.sourcePath : '来源未知，更新时需选择本机来源目录'
  return h('span', {
    title,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', maxWidth: '100%', overflow: 'hidden',
      padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
      color: tokens.secondary, background: 'rgba(148, 163, 184, .09)',
    },
  }, h(Icon, { size: 11, 'aria-hidden': true }), label)
}

function StatusBadge(props: { readonly active: boolean; readonly icon: ComponentType<IconProps>; readonly label: string }): ReturnType<typeof h> {
  const Icon = props.icon
  return h('span', {
    title: props.active ? `${props.label}已启用` : `${props.label}未启用`,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', maxWidth: '100%', overflow: 'hidden',
      padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
      color: props.active ? tokens.success : tokens.secondary,
      background: props.active ? 'rgba(22, 163, 74, .1)' : 'rgba(148, 163, 184, .09)',
      border: `1px solid ${props.active ? 'rgba(22, 163, 74, .3)' : 'transparent'}`,
    },
  },
    h(Icon, { size: 11, 'aria-hidden': true }),
    props.active ? `${props.label}开` : `${props.label}关`,
  )
}

function currentThemeColors(): { background: string; color: string } {
  if (typeof document === 'undefined') return { background: '#151517', color: '#f9fafb' }
  const style = getComputedStyle(document.body)
  return {
    background: style.backgroundColor || '#151517',
    color: style.color || '#f9fafb',
  }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
