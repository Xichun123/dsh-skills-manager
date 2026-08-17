import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type ComponentType, type FormEvent, type ReactNode } from 'react'
import Wrench from 'lucide-react/dist/esm/icons/wrench.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import Globe from 'lucide-react/dist/esm/icons/globe.mjs'
import FolderGit from 'lucide-react/dist/esm/icons/folder-git.mjs'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs'
import PackageOpen from 'lucide-react/dist/esm/icons/package-open.mjs'
import Puzzle from 'lucide-react/dist/esm/icons/puzzle.mjs'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.mjs'
import Check from 'lucide-react/dist/esm/icons/check.mjs'
import type { ClientContext, ObservableSnapshot, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillCatalog, SkillCatalogEntry } from '../types.js'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['connection', 'slots', 'workspaces', 'sessions']

interface ClientContextWithConnection extends ClientContext {
  readonly connection: ConnectionHandle
}

interface ManagerApi {
  readonly list: (projectRoot?: string) => Promise<SkillCatalog>
  readonly mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<SkillCatalog>
}

interface SectionProps extends ManagerApi {
  readonly pickDirectory: () => Promise<string | null>
  readonly loopback: boolean
  readonly useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

interface ComposerProps extends ManagerApi {
  readonly session: { readonly sessionId: SessionId }
  readonly sessions: ObservableSnapshot<SessionListState>
}

interface RpcResult {
  readonly ok: true
  readonly value: SkillCatalog
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
  surfaceActive: 'var(--bg-active, rgba(99, 102, 241, .12))',
}

const panelStyle: CSSProperties = { containerType: 'inline-size', display: 'grid', gap: 18, width: '100%', minWidth: 0, maxWidth: 760, padding: '6px 0 36px' }

function buttonStyle(tone: 'primary' | 'ghost' | 'danger', disabled: boolean): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 12px',
    borderRadius: 8, border: `1px solid transparent`, fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
    transition: 'background .15s ease, border-color .15s ease',
  }
  if (tone === 'primary') return { ...base, background: tokens.accent, color: 'var(--fg-on-accent, #fff)', border: 'none' }
  if (tone === 'danger') return { ...base, background: 'transparent', color: tokens.danger, border: `1px solid ${tokens.border}` }
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

export function apply(ctx: ClientContext): void {
  const client = ctx as ClientContextWithConnection
  const list = async (projectRoot?: string): Promise<SkillCatalog> => {
    const result = await client.connection.rpc.call('/skill-manager', 'list', projectRoot ? { projectRoot } : {}) as RpcResult | { ok: false; error: { message: string } }
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const mutate = async (endpoint: string, payload: Record<string, unknown>): Promise<SkillCatalog> => {
    const result = await client.connection.rpc.call('/skill-manager', endpoint, payload) as RpcResult | { ok: false; error: { message: string } }
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 35,
    label: 'Skill 管理',
    inject: () => ({ list, mutate, pickDirectory: () => ctx.workspaces.pickDirectory(), loopback: client.connection.isLoopback }),
  }, SkillManagerSection as never))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'skill-manager',
    order: 10,
    inject: () => ({ list, mutate, sessions: ctx.sessions.list }),
  }, ComposerSkillButton as never))
}

function SkillManagerSection(props: SectionProps): ReturnType<typeof h> {
  const { list, mutate, pickDirectory, loopback, useWorkspaces } = props
  const workspaces = useWorkspaces(state => state)
  const [projectRoot, setProjectRoot] = useState<string | undefined>(undefined)
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [repository, setRepository] = useState('')

  useEffect(() => { ensureKeyframes() }, [])

  // 追踪用户是否主动选过「只看全局」，避免 useEffect 把它重置回第一个工作区
  const userChoseGlobal = useRef(false)

  useEffect(() => {
    // 仅当用户未主动选择「只看全局」时，才自动选中第一个工作区
    if (projectRoot === undefined && !userChoseGlobal.current && workspaces.items.length > 0) setProjectRoot(workspaces.items[0].path)
    // 当前选中的工作区被移除时，回退到第一个工作区
    if (projectRoot !== undefined && !workspaces.items.some(item => item.path === projectRoot)) setProjectRoot(workspaces.items[0]?.path)
  }, [projectRoot, workspaces.items])

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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (catalog?.entries ?? []).filter(entry => normalized.length === 0 || `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(normalized))
  }, [catalog, query])

  const stats = useMemo(() => {
    const entries = catalog?.entries ?? []
    return {
      total: entries.length,
      global: entries.filter(entry => entry.globalEnabled).length,
      project: entries.filter(entry => entry.projectEnabled).length,
    }
  }, [catalog])

  const importSkill = async () => {
    const path = await pickDirectory()
    if (path) await run(() => mutate('install', { path, projectRoot }))
  }

  const importRepository = async (event: FormEvent) => {
    event.preventDefault()
    const source = repository.trim()
    if (!source) return
    if (await run(() => mutate('install-remote', { repository: source, projectRoot }))) {
      setRepository('')
      setRepositoryOpen(false)
    }
  }

  const updateSkill = async (entry: SkillCatalogEntry) => {
    let path: string | undefined
    const remote = entry.sourceType === 'git' || Boolean(entry.sourceUrl)
    if (!entry.updateSupported || (entry.updateError && !remote)) {
      path = await pickDirectory() ?? undefined
      if (!path) return
    }
    await run(() => mutate('update', { name: entry.name, path, projectRoot }))
  }

  const selectedWorkspace = workspaces.items.find(item => item.path === projectRoot)
  return h('div', { style: panelStyle, 'aria-busy': busy },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
        h(Puzzle, { size: 20, 'aria-hidden': true }),
        h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, 'Skill 管理'),
        busy ? h(RefreshCw, { size: 14, 'aria-hidden': true, style: spinnerStyle }) : null,
      ),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', { type: 'button', style: buttonStyle('ghost', busy), onClick: () => void run(() => mutate('check-updates', { projectRoot })), disabled: busy, title: '检查已记录来源是否有变化' },
          h(RefreshCw, { size: 14, 'aria-hidden': true }), '检查更新'),
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
    h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
      h('div', { style: { position: 'relative', flex: '1 1 220px', display: 'flex', alignItems: 'center' } },
        h(Search, { size: 14, 'aria-hidden': true, style: { position: 'absolute', left: 9, color: tokens.secondary, pointerEvents: 'none' } }),
        h('input', { type: 'search', value: query, placeholder: '搜索 skill…', 'aria-label': '搜索 skill', onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), style: inputStyle }),
      ),
      h('label', { style: { display: 'flex', flex: '1 1 220px', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 13, color: tokens.secondary } },
        h('span', { style: { flex: '0 0 auto' } }, '项目范围'),
        h('select', { value: projectRoot ?? '__global__', onChange: (event: ChangeEvent<HTMLSelectElement>) => { const value = event.currentTarget.value; if (value === '__global__') { userChoseGlobal.current = true; setProjectRoot(undefined) } else { userChoseGlobal.current = false; setProjectRoot(value) } }, style: { ...selectStyle, flex: '1 1 auto', minWidth: 0, maxWidth: 'none' } },
          h('option', { value: '__global__' }, '只看全局'),
          ...workspaces.items.map(workspace => h('option', { key: workspace.workspaceId, value: workspace.path }, workspace.title)),
        ),
      ),
    ),
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      h(StatChip, { label: '已安装', value: stats.total }),
      h(StatChip, { label: '全局启用', value: stats.global, tone: 'accent' }),
      projectRoot !== undefined ? h(StatChip, { label: '项目启用', value: stats.project, tone: 'accent' }) : null,
    ),
    error ? h('div', { role: 'alert', style: { display: 'flex', gap: 8, alignItems: 'center', margin: 0, padding: '9px 12px', borderRadius: 8, fontSize: 13, color: tokens.danger, background: 'rgba(220, 38, 38, .08)', border: '1px solid rgba(220, 38, 38, .28)' } },
      h(AlertCircle, { size: 15, 'aria-hidden': true }), error) : null,
    h('section', { style: { display: 'grid', width: '100%', minWidth: 0, gap: 8 }, 'aria-label': '已安装 skill' },
      catalog === null
        ? h('p', { style: { margin: 0, padding: '24px 0', textAlign: 'center', fontSize: 13, color: tokens.secondary } }, '正在读取…')
        : filtered.length === 0
          ? h(EmptyState, { hasAny: (catalog.entries.length ?? 0) > 0 })
          : filtered.map(entry => h(SkillRow, {
            key: entry.name,
            entry,
            projectLabel: selectedWorkspace?.title ?? '当前项目',
            projectAvailable: projectRoot !== undefined,
            busy,
            onGlobalChange: enabled => void run(() => mutate('set-enabled', { name: entry.name, scope: 'global', projectRoot, enabled })),
            onProjectChange: enabled => void run(() => mutate('set-enabled', { name: entry.name, scope: 'project', projectRoot, enabled })),
            onUpdate: () => void updateSkill(entry),
            onRemove: () => void run(() => mutate('remove', { name: entry.name, projectRoot })),
          })),
    ),
  )
}

function StatChip(props: { readonly label: string; readonly value: number; readonly tone?: 'accent' }): ReturnType<typeof h> {
  const active = (props.tone === 'accent') && props.value > 0
  return h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, border: `1px solid ${active ? 'rgba(99, 102, 241, .4)' : tokens.border}`, color: active ? tokens.accent : tokens.secondary, background: active ? 'rgba(99, 102, 241, .08)' : 'transparent' } },
    h('span', null, props.label),
    h('strong', { style: { fontSize: 13, fontWeight: 600 } }, String(props.value)),
  )
}

function EmptyState(props: { readonly hasAny: boolean }): ReturnType<typeof h> {
  return h('div', { style: { display: 'grid', justifyItems: 'center', gap: 8, padding: '36px 16px', borderRadius: 10, border: `1px dashed ${tokens.borderStrong}`, color: tokens.secondary, textAlign: 'center' } },
    h(PackageOpen, { size: 26, 'aria-hidden': true }),
    h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.5 } }, props.hasAny ? '没有匹配的 skill，试试调整搜索词。' : '还没有导入任何 skill。点击右上角「导入」，从本机目录开始。'),
  )
}

function ComposerSkillButton(props: ComposerProps): ReturnType<typeof h> {
  const { session, sessions, list, mutate } = props
  const snapshot = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot)
  const projectRoot = snapshot.byId[session.sessionId]?.cwd
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

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

function ProjectSkillPopover(props: ManagerApi & { readonly projectRoot: string; readonly onClose: () => void }): ReturnType<typeof h> {
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

  const enabledCount = (catalog?.entries ?? []).filter(entry => entry.projectEnabled).length

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
          : catalog.entries.map(entry => h('label', { key: entry.name, style: { display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) 30px', gap: 8, alignItems: 'center', padding: '7px 6px', borderRadius: 7, fontSize: 13, cursor: busy ? 'default' : 'pointer' }, title: entry.description || entry.name },
            h(Puzzle, { size: 13, 'aria-hidden': true, style: { color: entry.projectEnabled ? tokens.accent : tokens.secondary } }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
            h(Toggle, { checked: entry.projectEnabled, disabled: busy, onChange: enabled => void toggle(entry, enabled), label: entry.name }),
          )),
    ),
    busy ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', paddingTop: 2 } }, h(RefreshCw, { size: 12, 'aria-hidden': true, style: spinnerStyle })) : null,
  )
}

function SkillRow(props: {
  readonly entry: SkillCatalogEntry
  readonly projectLabel: string
  readonly projectAvailable: boolean
  readonly busy: boolean
  readonly onGlobalChange: (enabled: boolean) => void
  readonly onProjectChange: (enabled: boolean) => void
  readonly onUpdate: () => void
  readonly onRemove: () => void
}): ReturnType<typeof h> {
  const { entry, projectLabel, projectAvailable, busy, onGlobalChange, onProjectChange, onUpdate, onRemove } = props
  const [hover, setHover] = useState(false)
  return h('article', {
    className: 'dsh-skill-manager-row',
    style: {
      display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 12, alignItems: 'center',
      width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box',
      padding: '12px 14px', borderRadius: 10, border: `1px solid ${hover ? tokens.borderStrong : tokens.border}`,
      background: hover ? tokens.surfaceHover : 'transparent', transition: 'border-color .15s ease, background .15s ease',
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  },
    h('div', { className: 'dsh-skill-manager-row-icon', style: { display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, color: entry.effectiveEnabled ? tokens.accent : tokens.secondary, background: entry.effectiveEnabled ? 'rgba(99, 102, 241, .1)' : 'rgba(148, 163, 184, .1)' } },
      h(Puzzle, { size: 16, 'aria-hidden': true }),
    ),
    h('div', { style: { minWidth: 0, display: 'grid', gap: 4 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
        h('strong', { style: { ...monoStyle, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
        h(SourceBadge, { entry }),
        h(StatusBadge, { active: entry.globalEnabled, icon: Globe, label: '全局' }),
        projectAvailable ? h(StatusBadge, { active: entry.projectEnabled, icon: FolderGit, label: projectLabel }) : null,
        entry.updateAvailable ? h('span', { style: { flex: '0 0 auto', fontSize: 11, color: tokens.accent } }, '有更新') : null,
        entry.updateError ? h('span', { style: { flex: '0 0 auto', fontSize: 11, color: tokens.danger }, title: entry.updateError }, '来源异常') : null,
      ),
      entry.description ? h('p', { style: { margin: 0, color: tokens.secondary, lineHeight: 1.45, fontSize: 12.5 as never, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as CSSProperties }, entry.description) : null,
    ),
    h('div', { className: 'dsh-skill-manager-row-actions', style: { gridColumn: '1 / -1', display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h(Toggle, { checked: entry.globalEnabled, disabled: busy, onChange: onGlobalChange, label: `${entry.name} 全局开关`, title: '全局启用' }),
      projectAvailable ? h(Toggle, { checked: entry.projectEnabled, disabled: busy, onChange: onProjectChange, label: `${entry.name} 项目开关`, title: `${projectLabel} 启用` }) : null,
      h('button', { type: 'button', style: { ...iconButtonStyle, color: entry.updateAvailable ? tokens.accent : tokens.secondary }, disabled: busy, onClick: onUpdate, title: entry.updateSupported && !entry.updateError ? (entry.sourceType === 'git' ? '从远程仓库更新' : '从原始目录更新') : '选择来源目录并更新', 'aria-label': `更新 ${entry.name}` },
        h(RefreshCw, { size: 15, 'aria-hidden': true })),
      h('button', { type: 'button', style: { ...iconButtonStyle, color: tokens.danger }, disabled: busy, onClick: onRemove, title: '从库中移除', 'aria-label': `移除 ${entry.name}` },
        h(Trash2, { size: 15, 'aria-hidden': true })),
    ),
  )
}

function SourceBadge(props: { readonly entry: SkillCatalogEntry }): ReturnType<typeof h> {
  const remote = props.entry.sourceType === 'git' || Boolean(props.entry.sourceUrl)
  const local = props.entry.sourceType === 'local' || Boolean(props.entry.sourcePath)
  const Icon = remote ? GitBranch : local ? FolderGit : AlertCircle
  const label = remote ? 'Git' : local ? '本机' : '未知'
  const title = remote ? props.entry.sourceUrl : local ? props.entry.sourcePath : '旧版本导入，首次更新需重新选择来源'
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

function Toggle(props: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (enabled: boolean) => void
  readonly label: string
  readonly title?: string
}): ReturnType<typeof h> {
  const { checked, disabled, onChange, label, title } = props
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    title,
    disabled,
    onClick: () => onChange(!checked),
    style: {
      position: 'relative', flex: '0 0 auto', width: 30, height: 18, padding: 0, border: 'none', borderRadius: 999,
      background: checked ? tokens.accent : 'rgba(148, 163, 184, .35)',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
      transition: 'background .15s ease',
    },
  },
    h('span', {
      'aria-hidden': true,
      style: {
        position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14, borderRadius: 999,
        background: '#fff', boxShadow: '0 1px 2px rgba(0, 0, 0, .3)', transition: 'left .15s ease',
        display: 'grid', placeItems: 'center',
      },
    }, checked ? h(Check, { size: 10, 'aria-hidden': true }) : null),
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
