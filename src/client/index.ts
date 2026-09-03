import { createElement as h, useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ComponentType, type FormEvent } from 'react'
import { Pill, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
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
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.mjs'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle, RpcResult, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SkillCatalog, SkillCatalogEntry, SkillInspectEntry, SkillInspectResult, SkillUpdateReport, SkillUpdateStatus } from '../types.js'
import { projectPopoverEnabledCount, projectPopoverRow } from './popover.js'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

// uiWorkspace 仍需注入：「本机导入」走目录选择器
export const inject = ['connection', 'slots', 'uiWorkspace']

/** Slot `useSessions` 只用到 cwd；不把 session-controller 拉进 peer 图。 */
interface SessionListState {
  readonly byId: Readonly<Record<SessionId, { readonly cwd?: string } | undefined>>
}

interface ManagerApi {
  readonly list: (projectRoot?: string) => Promise<SkillCatalog>
  readonly mutate: (endpoint: string, payload: Record<string, unknown>) => Promise<SkillCatalog>
  readonly inspect: (path: string) => Promise<SkillInspectResult>
  readonly inspectRemote: (repository: string) => Promise<SkillInspectResult>
}

interface SectionProps extends ManagerApi {
  readonly checkUpdates: (name?: string) => Promise<SkillUpdateReport>
  readonly pickDirectory: () => Promise<string | null>
  readonly loopback: boolean
}

interface ComposerProps extends ManagerApi {
  readonly sessionId: SessionId
  readonly useSessions: <S>(select: (state: SessionListState) => S) => S
}

interface IconProps {
  readonly size?: number | string
  readonly className?: string
  readonly style?: CSSProperties
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}

const SKILL_ICON_PATHS = [
  'M12.5113 15.4067C12.4395 15.6249 12.1308 15.6249 12.059 15.4067L11.643 14.1416C11.454 13.567 11.0033 13.1164 10.4288 12.9274L9.16369 12.5113C8.94544 12.4395 8.94544 12.1308 9.16369 12.059L10.4288 11.643C11.0033 11.454 11.454 11.0033 11.643 10.4288L12.059 9.16369C12.1308 8.94544 12.4395 8.94544 12.5113 9.16369L12.9274 10.4288C13.1164 11.0033 13.567 11.454 14.1416 11.643L15.4067 12.059C15.6249 12.1308 15.6249 12.4395 15.4067 12.5113L14.1416 12.9274C13.567 13.1164 13.1164 13.567 12.9274 14.1416L12.5113 15.4067Z',
  'M9.02246 0.546878C9.9822 0.546878 10.7564 0.545403 11.374 0.612307C12.0042 0.680586 12.5515 0.826244 13.0273 1.17188C13.3052 1.37376 13.5501 1.61868 13.752 1.89649C14.0975 2.37225 14.2432 2.91984 14.3115 3.54981C14.3784 4.16727 14.377 4.94206 14.377 5.90137V8.51367C13.9611 8.29533 13.5071 8.13985 13.0273 8.06055V5.90137C13.0273 4.9121 13.0259 4.22322 12.9688 3.69532C12.9129 3.18044 12.8098 2.89782 12.6592 2.69043C12.5406 2.52724 12.3966 2.38326 12.2334 2.26465C12.026 2.11404 11.7437 2.0109 11.2285 1.95508C10.7005 1.89789 10.0122 1.89649 9.02246 1.89649H6.55371C5.56395 1.89649 4.87569 1.89787 4.34766 1.95508C3.83242 2.01092 3.55022 2.11398 3.34278 2.26465C3.17953 2.38329 3.03564 2.52719 2.91699 2.69043C2.76642 2.89782 2.66325 3.18042 2.60742 3.69532C2.55027 4.22322 2.54883 4.9121 2.54883 5.90137V10.0986C2.54883 11.0878 2.55031 11.7768 2.60742 12.3047C2.66326 12.8196 2.76642 13.1032 2.91699 13.3105C3.03558 13.4736 3.17966 13.6178 3.34278 13.7363C3.5502 13.8869 3.83265 13.9901 4.34766 14.0459C4.87568 14.1031 5.56398 14.1035 6.55371 14.1035H8.08399C8.27443 14.6025 8.55077 15.0585 8.89551 15.4541H6.55371C5.59402 15.4541 4.81976 15.4546 4.20215 15.3877C3.57204 15.3194 3.02468 15.1738 2.54883 14.8281C2.27111 14.6263 2.02606 14.3813 1.82422 14.1035C1.47883 13.6278 1.33293 13.08 1.26465 12.4502C1.19783 11.8327 1.19922 11.0579 1.19922 10.0986V5.90137C1.19922 4.94206 1.1978 4.16727 1.26465 3.54981C1.33295 2.91984 1.47867 2.37225 1.82422 1.89649C2.02613 1.61864 2.27098 1.37379 2.54883 1.17188C3.02472 0.826181 3.57197 0.6806 4.20215 0.612307C4.81976 0.545393 5.594 0.546877 6.55371 0.546878H9.02246ZM9.19629 9.14649H4.5459V7.84571H9.19629V9.14649ZM11.0303 6.10645H4.5459V4.80567H11.0303V6.10645Z',
] as const

function SkillIcon({ size = 16, ...props }: IconProps): ReturnType<typeof h> {
  return h('svg', { ...props, width: size, height: size, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
    h('path', { d: SKILL_ICON_PATHS[0], fill: 'currentColor' }),
    h('path', { d: SKILL_ICON_PATHS[1], fill: 'currentColor' }),
  )
}

function installSettingsNavIcon(ctx: ClientContext): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  ctx.effect(() => {
    const attribute = 'data-dsh-skill-manager-nav-icon'
    const selector = `button[${attribute}]`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${SKILL_ICON_PATHS.map(path => `<path d="${path}"/>`).join('')}</svg>`
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    const style = document.createElement('style')
    style.dataset.dshSkillManager = 'settings-nav-icon'
    style.textContent = `
      ${selector} > svg:first-of-type { display: none !important; }
      ${selector}::before {
        content: '';
        display: block;
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        background: currentColor;
        -webkit-mask: ${mask} center / contain no-repeat;
        mask: ${mask} center / contain no-repeat;
      }
    `
    document.head.appendChild(style)

    const mark = () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('nav button')) {
        if (button.textContent?.trim() === 'Skill 管理') button.setAttribute(attribute, '')
      }
    }
    const observer = new MutationObserver(mark)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    mark()

    return () => {
      observer.disconnect()
      style.remove()
      document.querySelectorAll(selector).forEach(element => element.removeAttribute(attribute))
    }
  }, 'skill-manager: settings navigation icon')
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
  installSettingsNavIcon(ctx)
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
  const checkUpdates = (name?: string): Promise<SkillUpdateReport> => request('check-updates', name ? { name } : {})

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 35,
    label: 'Skill 管理',
    inject: () => ({ list, mutate, inspect, inspectRemote, checkUpdates, pickDirectory: () => ctx.uiWorkspace.pickDirectory(), loopback: connection.isLoopback }),
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
  // 逐个 skill 记账正在检测的名字：单一全局布尔会把其它行的检测按钮一起置灰，
  // 快速连点时第二次点击落在 disabled 按钮上直接被吞掉。
  const [checkingNames, setCheckingNames] = useState<ReadonlySet<string>>(() => new Set())
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
    if (await run(() => mutate('update', { name: entry.name, path, projectRoot }))) {
      setStatuses(prev => ({ ...prev, [entry.name]: 'current' }))
    }
  }

  const markChecking = (names: readonly string[], active: boolean) => setCheckingNames(prev => {
    const next = new Set(prev)
    for (const name of names) {
      if (active) next.add(name)
      else next.delete(name)
    }
    return next
  })
  const checking = checkingNames.size > 0

  const checkAll = async () => {
    const names = (catalog?.entries ?? []).map(entry => entry.name)
    markChecking(names, true)
    setError(null)
    try {
      const report = await checkUpdates()
      const reported = Object.fromEntries(report.entries.map(entry => [entry.name, entry.status]))
      setStatuses(Object.fromEntries(names.map(name => [name, reported[name] ?? 'unknown'])))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      markChecking(names, false)
    }
  }

  const checkSkill = async (name: string) => {
    markChecking([name], true)
    setError(null)
    try {
      const report = await checkUpdates(name)
      setStatuses(prev => ({ ...prev, [name]: report.entries.find(entry => entry.name === name)?.status ?? 'unknown' }))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      markChecking([name], false)
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

  const rowProps = (entry: SkillCatalogEntry) => ({
    key: entry.name,
    entry,
    projectAvailable: projectRoot !== undefined,
    busy,
    checking: checkingNames.has(entry.name),
    updateStatus: statuses[entry.name],
    onScopeChange: (scope: 'global' | 'project', enabled: boolean) => void run(() =>
      mutate('set-enabled', { name: entry.name, scope, projectRoot, enabled })),
    onModelInvocationChange: (modelInvocable: boolean) => void run(() =>
      mutate('set-model-invocation', { name: entry.name, modelInvocable, projectRoot })),
    onCheck: () => void checkSkill(entry.name),
    onUpdate: () => void updateSkill(entry),
    onRemove: () => removeSkill(entry),
  })
  return h('div', { style: panelStyle, 'aria-busy': busy },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
        h(SkillIcon, { size: 20, 'aria-hidden': true }),
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
  const { sessionId, useSessions, list, mutate } = props
  const projectRoot = useSessions(state => state.byId[sessionId]?.cwd)
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
    }, h(SkillIcon, { size: 16, 'aria-hidden': true })),
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
              h(SkillIcon, { size: 13, 'aria-hidden': true, style: { color: entry.effectiveEnabled ? tokens.accent : tokens.secondary } }),
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

const UPDATE_BADGE: Readonly<Partial<Record<SkillUpdateStatus, { label: string; color: string; background: string; border: string }>>> = {
  'update-available': { label: '有更新', color: tokens.accent, background: 'rgba(99, 102, 241, .1)', border: '1px solid rgba(99, 102, 241, .35)' },
  'deleted-upstream': { label: '上游已删除', color: tokens.danger, background: 'rgba(220, 38, 38, .08)', border: '1px solid rgba(220, 38, 38, .3)' },
  'unknown': { label: '无法检测', color: tokens.secondary, background: 'rgba(148, 163, 184, .09)', border: '1px solid transparent' },
}

function SkillRow(props: {
  readonly entry: SkillCatalogEntry
  readonly projectAvailable: boolean
  readonly busy: boolean
  /** 只表示这一行自己在检测；不能传全局「有检测在跑」，否则别的行按钮会被一起置灰。 */
  readonly checking: boolean
  readonly updateStatus?: SkillUpdateStatus
  readonly onScopeChange: (scope: 'global' | 'project', enabled: boolean) => void
  readonly onModelInvocationChange: (modelInvocable: boolean) => void
  readonly onCheck: () => void
  readonly onUpdate: () => void
  readonly onRemove: () => void
}): ReturnType<typeof h> {
  const { entry, projectAvailable, busy, checking, updateStatus, onScopeChange, onModelInvocationChange, onCheck, onUpdate, onRemove } = props
  const badge = updateStatus ? UPDATE_BADGE[updateStatus] : undefined
  const manualOnly = entry.modelInvocable === false
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
      h(SkillIcon, { size: 16, 'aria-hidden': true }),
    ),
    h('div', { style: { minWidth: 0, display: 'grid', gap: 4 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
        h('strong', { style: { ...monoStyle, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
        badge ? h('span', { style: { display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap', color: badge.color, background: badge.background, border: badge.border } }, badge.label) : null,
        h(SourceBadge, { entry }),
        manualOnly ? h('span', { title: '仅手动：模型不会自动调用，只能用 /名字 手动引用', style: { display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', padding: '2px 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap', color: tokens.secondary, background: 'rgba(148, 163, 184, .09)' } }, '仅手动') : null,
        h(StatusBadge, { active: entry.globalEnabled, icon: Globe, label: '全局' }),
        projectAvailable ? h(StatusBadge, { active: entry.projectEnabled, icon: FolderGit, label: '项目' }) : null,
      ),
      entry.description ? h('p', { style: { margin: 0, color: tokens.secondary, lineHeight: 1.45, fontSize: 12.5 as never, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as CSSProperties }, entry.description) : null,
    ),
    h('div', { className: 'dsh-skill-manager-row-actions', style: { gridColumn: '1 / -1', display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('div', {
        role: 'radiogroup',
        'aria-label': `${entry.name} ${projectAvailable ? '项目' : '全局'}开关`,
        title: projectAvailable ? '项目开关' : '全局开关',
        style: { display: 'inline-flex', gap: 4, flex: '0 0 auto' },
      },
        (projectAvailable
          ? [['project-off', '项目关', false], ['project-on', '项目开', true]] as const
          : [['global-off', '关闭', false], ['global-on', '全局', true]] as const
        ).map(([key, label, enabled]) => {
          const active = (projectAvailable ? entry.projectEnabled : entry.globalEnabled) === enabled
          return h(Pill, {
            key,
            active,
            disabled: busy,
            role: 'radio',
            'aria-checked': active,
            onClick: () => { if (!active) onScopeChange(projectAvailable ? 'project' : 'global', enabled) },
          }, label)
        }),
      ),
      h(Pill, {
        active: manualOnly,
        disabled: busy,
        'aria-pressed': manualOnly,
        title: manualOnly
          ? '当前仅手动：模型不会自动调用；点按恢复为模型可自动调用'
          : '点按改为仅手动：模型不再自动调用，只能用 /名字 手动引用',
        onClick: () => onModelInvocationChange(manualOnly),
        style: { flex: '0 0 auto' },
      }, '仅手动'),
      updateStatus === 'current'
        ? h('span', { title: '已是最新', style: { color: tokens.success, fontSize: 12, fontWeight: 500, padding: '0 4px', whiteSpace: 'nowrap' } }, '最新')
        : updateStatus === 'update-available' || updateStatus === 'unknown'
          ? h('button', { type: 'button', style: { ...iconButtonStyle, color: tokens.accent }, disabled: busy || checking, onClick: onUpdate, title: entry.updateSupported ? (entry.sourceType === 'git' ? '从远程仓库更新' : '从原始目录更新') : '选择来源目录并更新', 'aria-label': `更新 ${entry.name}` },
            h(RefreshCw, { size: 15, 'aria-hidden': true }))
          : h('button', { type: 'button', style: { ...iconButtonStyle, color: tokens.secondary }, disabled: busy || checking, onClick: onCheck, title: checking ? '检测中…' : `检测 ${entry.name} 是否有更新`, 'aria-label': `检测 ${entry.name} 更新` },
            checking
              ? h(RefreshCw, { size: 15, 'aria-hidden': true, style: spinnerStyle })
              : h(SearchCheck, { size: 15, 'aria-hidden': true })),
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
