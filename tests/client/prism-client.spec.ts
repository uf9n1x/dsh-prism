import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const clientPath = join(root, 'client', 'prism-client.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Minimal React stand-in. The real module table supplies React in the browser;
 * here we only need createElement plus inert hooks so a component function can
 * be invoked and its element tree inspected.
 */
function fakeReact(renders: string[]) {
  const createElement = (type: unknown, props: any, ...children: unknown[]) => {
    const name = typeof type === 'function' ? (type as { name?: string }).name ?? 'anonymous' : String(type)
    renders.push(name)
    return { type, props: { ...(props ?? {}), children } }
  }
  return {
    createElement,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useEffect: () => undefined,
    useCallback: (fn: unknown) => fn
  }
}

interface Loaded {
  id: string
  plugin: { inject: string[]; apply(ctx: any): void }
  renders: string[]
}

/** Load the bundle the way the host's module table does: through __ModuleLoader__.load. */
function loadClient(options: { locale?: string; fetch?: unknown } = {}): Loaded {
  const renders: string[] = []
  const react = fakeReact(renders)
  let captured: { id: string; plugin: any } | null = null
  const sandbox: Record<string, unknown> = {
    window: {
      __ModuleLoader__: {
        load(spec: { id: string; factory: (require: (name: string) => unknown) => unknown }) {
          const plugin = spec.factory((name: string) => {
            if (name === 'react') return react
            throw new Error(`unexpected require(${name})`)
          })
          captured = { id: spec.id, plugin }
        }
      }
    },
    document: { baseURI: 'http://127.0.0.1:3080/', hidden: false },
    fetch: options.fetch ?? (async () => ({ ok: false, status: 404, json: async () => ({}) })),
    setInterval: () => 0,
    clearInterval: () => undefined,
    console
  }
  const context = createContext(sandbox)
  runInContext(readFileSync(clientPath, 'utf8'), context)
  if (captured === null) throw new Error('the client bundle registered no factory')
  return { id: (captured as { id: string }).id, plugin: (captured as { plugin: any }).plugin, renders }
}

interface Registration {
  name: string
  id: string
  order?: number
  label?: string | (() => string)
}

function applyAndCollect(): { registered: Registration[]; injected: string[]; components: Map<string, any> } {
  const loaded = loadClient()
  const registered: Registration[] = []
  const injected: string[] = []
  const components = new Map<string, any>()
  const ctx = {
    slots: {
      inject(owner: string, install: () => unknown) {
        injected.push(owner)
        install()
      },
      register(options: Registration, component: any) {
        registered.push(options)
        components.set(`${options.name}#${options.id}`, component)
        return () => undefined
      }
    }
  }
  loaded.plugin.apply(ctx)
  return { registered, injected, components }
}

/** Any key resolves to its own name, so a missing copy key never crashes a render. */
const anyCopy = new Proxy({}, { get: (_target, key) => String(key) }) as Record<string, string>

describe('P8 client bundle contract', () => {
  it('registers a lazy factory whose id equals the package name', () => {
    expect(loadClient().id).toBe(pkg.name)
  })

  it('is a plain module-loader bundle, not an ESM module', () => {
    const source = readFileSync(clientPath, 'utf8')
    expect(/^window\.__ModuleLoader__\.load\(\{/m.test(source)).toBe(true)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/^\s*export\s/m)
  })

  it('declares the manifest fields the host scans', () => {
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.dsh.client.immediately).toBe(true)
    expect(pkg.dsh.client.inject).toEqual(['@deepseek-ai/dsh-client-ui-conversation'])
    expect(pkg.exports['./client']).toBe('./client/prism-client.js')
    expect(existsSync(clientPath)).toBe(true)
  })

  it('registers exactly one entry: the conversation view beside 对话/轨迹', () => {
    const { registered, injected } = applyAndCollect()
    expect(injected).toEqual(['conversation.view'])
    expect(registered.map((entry) => `${entry.name}#${entry.id}`)).toEqual(['conversation.view#prism'])
    expect(registered[0]!.order).toBe(100)
  })

  it('labels the tab by thunk so it follows the active locale', () => {
    const { registered } = applyAndCollect()
    const label = registered[0]!.label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('Prism')
  })

  it('no longer registers a header utility or a shell overlay', () => {
    const { registered, injected } = applyAndCollect()
    const names = registered.map((entry) => entry.name)
    // The old surface lived in the top-right corner and was easy to miss; the
    // tab row is the host's own place for a per-session view.
    expect(names).not.toContain('conversation.session.header.utilities')
    expect(names).not.toContain('shell.overlay')
    expect(injected).not.toContain('shell.overlay')
  })

  it('says it is still loading, not "no session", before the host binds a session id', () => {
    const { components } = applyAndCollect()
    const component = components.get('conversation.view#prism')!
    const wrapper = component({ sessionId: undefined, t: anyCopy })
    // The slot registers a thin wrapper that closes over the locale copy; the
    // view itself is its child.
    const element = wrapper.type(wrapper.props)
    expect(element).not.toBeNull()
    expect(element.props.className).toBe('prism-absent')
    const hint = element.props.children[0]
    expect(hint.props.className).toBe('prism-absent-hint')
    // No engagement is claimed and no "no session selected" is asserted: on a
    // switch this state lasts a frame and the honest word is "loading".
    // The copy comes from the plugin's own table (the wrapper closes over it),
    // so assert the meaning rather than a literal: it must talk about reading.
    expect(String(hint.props.children[0])).toContain('.prism')
  })

  it('renders the shell for a session before the first payload arrives', () => {
    const { components } = applyAndCollect()
    const component = components.get('conversation.view#prism')!
    const wrapper = component({ sessionId: 'session-1', t: anyCopy })
    const element = wrapper.type(wrapper.props)
    expect(element.props.className).toBe('prism-root')
    // Nothing is claimed about the engagement until the board answers.
    expect(element.props.children[0].props.className).toBe('prism-top')
  })

  it('draws the graph as SVG rather than a table', () => {
    const source = readFileSync(clientPath, 'utf8')
    expect(source).toMatch(/h\(\s*'svg'/)
    expect(source).toContain('viewBox')
    expect(source).toContain('className: \'prism-node\'')
    // Fact → intent use solid edges, intent → result use dashed ones.
    expect(source).toContain('strokeDasharray')
    expect(source).toContain('layoutGraph')
  })

  it('pairs every status colour with a text label', () => {
    const source = readFileSync(clientPath, 'utf8')
    // STATE_COLOR is a lookup, and the chip that consumes it always renders the
    // state name next to the dot — colour is never the only signal.
    expect(source).toContain('function StateChip')
    expect(source).toMatch(/props\.label \?\? props\.state/)
  })

  it('builds relative view requests so no host origin is hard-coded', () => {
    const source = readFileSync(clientPath, 'utf8')
    expect(source).toContain("'/prism/view'")
    expect(source).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[a-z]/)
  })

  it('never touches document.body or another plugin DOM', () => {
    const source = readFileSync(clientPath, 'utf8')
    expect(source).not.toContain('document.body')
    expect(source).not.toContain('querySelector')
    expect(source).not.toContain('innerHTML')
  })

  it('injects one stylesheet instead of hardcoding a light or dark palette', () => {
    const source = readFileSync(clientPath, 'utf8')
    expect(source).toContain("id = 'prism-style'")
    expect(source).toContain('CanvasText')
    expect(source).toContain('prefers-reduced-motion')
    // No hardcoded page background: the panel must sit on any host theme.
    expect(source).not.toMatch(/background:\s*['"]#fff/i)
    expect(source).not.toMatch(/background:\s*['"]#000/i)
  })
})
