import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Exercise the actual row without loading the DSH browser runtime.
const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const rowSource = source.slice(source.indexOf('function SkillRow('), source.indexOf('\nfunction SourceBadge('))
const compiled = ts.transpile(rowSource, { target: ts.ScriptTarget.ES2022 })

function harness(description, height = 80) {
  const states = []
  const element = { scrollHeight: height, clientHeight: 36 }
  let index = 0
  let measure
  const noop = () => {}
  const render = runInNewContext(`${compiled}\nSkillRow`, {
    useRef: () => ({ current: element }),
    useState: initial => {
      const slot = index++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
    useEffect: effect => effect(),
    ResizeObserver: class { constructor(callback) { measure = callback } observe() {} disconnect() {} },
    h: (type, props, ...children) => ({ type, props, children: children.flat(Infinity).filter(Boolean) }),
    tokens: {}, monoStyle: {}, iconButtonStyle: {}, buttonStyle: () => ({}), UPDATE_BADGE: {},
    SkillIcon: noop, SourceBadge: noop, StatusBadge: noop, Globe: noop, FolderGit: noop,
    ChevronDown: noop, Pill: noop, SearchCheck: noop, Trash2: noop,
  })
  return {
    element,
    resize: () => measure(),
    render: () => {
      index = 0
      const tree = render({ entry: { name: 'sample', description } })
      const nodes = []
      const walk = node => { if (typeof node === 'object') { nodes.push(node); node.children.forEach(walk) } }
      walk(tree)
      return {
        paragraph: nodes.find(node => node.type === 'p'),
        toggle: nodes.find(node => node.type === 'button' && 'aria-expanded' in node.props),
      }
    },
  }
}

test('long descriptions expand and collapse without truncating or disabling text selection', () => {
  const description = 'Long description with a full selectable ending. '.repeat(20)
  const view = harness(description)
  view.render()
  let { paragraph, toggle } = view.render()
  assert.equal(paragraph.children[0], description)
  assert.equal(paragraph.props.style.WebkitLineClamp, 2)
  assert.equal(paragraph.props.style.userSelect, 'text')
  assert.equal(paragraph.props.style.WebkitUserSelect, 'text')
  assert.equal(toggle.props['aria-controls'], paragraph.props.id)
  assert.equal(toggle.props['aria-expanded'], false)
  toggle.props.onClick()
  ;({ paragraph, toggle } = view.render())
  assert.equal(toggle.props['aria-expanded'], true)
  assert.equal(paragraph.props.style.WebkitLineClamp, undefined)
  assert.equal(paragraph.props.style.overflowWrap, 'anywhere')
  assert.equal(paragraph.children[0], description)
  toggle.props.onClick()
  assert.equal(view.render().paragraph.props.style.WebkitLineClamp, 2)
})

test('short descriptions have no toggle until resizing makes them overflow', () => {
  const view = harness('Short description', 18)
  view.render()
  assert.equal(view.render().toggle, undefined)
  view.element.scrollHeight = 80
  view.resize()
  assert.ok(view.render().toggle)
  view.element.scrollHeight = 18
  view.resize()
  assert.equal(view.render().toggle, undefined)
})
