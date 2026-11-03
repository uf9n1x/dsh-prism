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

  it('injects slots and registers exactly two entries: a header utility and an overlay', () => {
    const loaded = loadClient()
    expect(loaded.plugin.inject).toEqual(['slots'])

    const registered: { name: string; id: string; order?: number }[] = []
    const injected: string[] = []
    const ctx = {
      slots: {
        inject(owner: string, install: () => unknown) {
          injected.push(owner)
          install()
        },
        register(options: { name: string; id: string; order?: number }, _component: unknown) {
          registered.push(options)
          return () => undefined
        }
      }
    }
    loaded.plugin.apply(ctx)

    expect(injected).toEqual(['conversation.session.header.utilities', 'shell.overlay'])
    expect(registered.map((entry) => `${entry.name}#${entry.id}`)).toEqual([
      'conversation.session.header.utilities#prism-engagement',
      'shell.overlay#prism-panel'
    ])
  })

  it('does NOT register conversation.view, so ordinary sessions gain no tab', () => {
    const loaded = loadClient()
    const names: string[] = []
    const ctx = {
      slots: {
        inject: (_owner: string, install: () => unknown) => install(),
        register: (options: { name: string }) => {
          names.push(options.name)
          return () => undefined
        }
      }
    }
    loaded.plugin.apply(ctx)
    expect(names).not.toContain('conversation.view')
  })

  it('renders the header utility as nothing when the session has no engagement', () => {
    const loaded = loadClient()
    let headerComponent: ((props: any) => unknown) | null = null
    let overlayComponent: (() => unknown) | null = null
    const ctx = {
      slots: {
        inject: (_owner: string, install: () => unknown) => install(),
        register: (options: { name: string }, component: any) => {
          if (options.name === 'conversation.session.header.utilities') headerComponent = component
          else overlayComponent = component
          return () => undefined
        }
      }
    }
    loaded.plugin.apply(ctx)
    expect(headerComponent).not.toBeNull()
    expect(overlayComponent).not.toBeNull()

    // useState starts at 'absent' for a missing session, and the component must
    // return null rather than an element: a null utility adds no chrome at all.
    const wrapper = (headerComponent as (props: any) => any)({ sessionId: undefined })
    expect(wrapper).not.toBeNull()
    expect(wrapper.type(wrapper.props)).toBeNull()

    // The overlay entry is a thin wrapper; the panel itself renders nothing
    // while closed, so the wrapper contributes no chrome either.
    const overlayElement = (overlayComponent as () => any)()
    expect(overlayElement).not.toBeNull()
    expect(overlayElement.type(overlayElement.props)).toBeNull()
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
})
