// Prism client plugin — the five read-only views (SPEC P8).
//
// Plain-JS bundle in the host's documented `window.__ModuleLoader__` format, so
// it needs no bundler and no typert codegen. It reads `.prism/` through the
// host's read-only `/prism/view` route (see src/host/webrow.ts).
//
// Surface choice: ONE session-header utility that renders nothing unless the
// session has an engagement, opening a frame-wide `shell.overlay` panel with the
// five views as internal tabs. Registering into `conversation.view` would put
// five permanent tabs in every conversation — including coding/PPT sessions —
// which breaks the zero-presence requirement (A2). See D22.
window.__ModuleLoader__.load({
  id: 'dsh-prism',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const VIEW_IDS = ['graph', 'frontier', 'workers', 'evidence', 'report']
    const COPY = {
      zh: {
        open: 'Prism 透视',
        title: 'Prism 渗透模式 · 实时状态',
        close: '关闭',
        refresh: '刷新',
        loading: '读取 .prism/ …',
        failed: '读取失败',
        absent: '此会话没有 Prism engagement',
        graph: '图谱',
        frontier: '前沿',
        workers: '工兵',
        evidence: '证据',
        report: '报告',
        empty: '暂无数据'
      },
      en: {
        open: 'Prism',
        title: 'Prism engagement · live state',
        close: 'Close',
        refresh: 'Refresh',
        loading: 'Reading .prism/ …',
        failed: 'Read failed',
        absent: 'No Prism engagement in this session',
        graph: 'Graph',
        frontier: 'Frontier',
        workers: 'Workers',
        evidence: 'Evidence',
        report: 'Report',
        empty: 'No data yet'
      }
    }

    /** Shared panel state; the header button and the overlay live in this module. */
    const shared = { open: false, sessionId: null, tab: 'graph', listeners: new Set() }
    function publish(patch) {
      Object.assign(shared, patch)
      for (const listener of Array.from(shared.listeners)) listener()
    }
    function useShared() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((n) => n + 1)
        shared.listeners.add(listener)
        return () => shared.listeners.delete(listener)
      }, [])
      return shared
    }

    // ---- transport -------------------------------------------------------
    let basePath = null
    function candidatePaths() {
      if (basePath !== null) return [basePath]
      const paths = ['/prism/view']
      try {
        const absolute = new URL('prism/view', document.baseURI).toString()
        if (!paths.includes(absolute)) paths.push(absolute)
      } catch {
        /* relative only */
      }
      return paths
    }
    async function fetchView(view, sessionId) {
      const query = `view=${encodeURIComponent(view)}&session=${encodeURIComponent(sessionId)}`
      let lastError
      for (const path of candidatePaths()) {
        try {
          const response = await fetch(`${path}?${query}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin'
          })
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`)
            continue
          }
          const body = await response.json()
          if (body === null || typeof body !== 'object' || body.ok !== true) {
            lastError = new Error((body && body.message) || 'malformed payload')
            continue
          }
          basePath = path
          return body.payload
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new Error('view request failed')
    }

    // ---- data hook -------------------------------------------------------
    function useView(view, sessionId, intervalMs) {
      const [state, setState] = React.useState({ status: sessionId === null ? 'absent' : 'loading', payload: null, at: 0 })
      const [nonce, setNonce] = React.useState(0)
      const reload = React.useCallback(() => setNonce((n) => n + 1), [])
      React.useEffect(() => {
        if (sessionId === null || typeof sessionId !== 'string' || sessionId.length === 0) {
          setState({ status: 'absent', payload: null, at: 0 })
          return
        }
        let cancelled = false
        const run = async () => {
          if (typeof document !== 'undefined' && document.hidden) return
          try {
            const payload = await fetchView(view, sessionId)
            if (!cancelled) setState({ status: 'ok', payload, at: Date.now() })
          } catch (error) {
            if (!cancelled) setState({ status: 'error', payload: null, at: Date.now(), error: String(error) })
          }
        }
        void run()
        // Poll only while the panel is open and the tab is visible; the read is
        // a local JSON projection, never a model/tool call.
        const timer = intervalMs > 0 ? setInterval(run, intervalMs) : null
        return () => {
          cancelled = true
          if (timer !== null) clearInterval(timer)
        }
      }, [view, sessionId, intervalMs, nonce])
      return [state, reload]
    }

    // ---- styling (theme-agnostic: inherit + matched system pair) ----------
    const muted = { opacity: 0.66 }
    const box = { border: '1px solid rgba(127,127,127,0.35)', borderRadius: 8 }
    const td = { padding: '6px 10px', borderTop: '1px solid rgba(127,127,127,0.22)', textAlign: 'left', verticalAlign: 'top' }
    const th = { padding: '6px 10px', textAlign: 'left', fontSize: 12, opacity: 0.66, borderBottom: '1px solid rgba(127,127,127,0.35)' }
    const button = {
      cursor: 'pointer',
      font: 'inherit',
      color: 'inherit',
      background: 'transparent',
      borderRadius: 6,
      border: '1px solid rgba(127,127,127,0.4)',
      padding: '2px 9px',
      lineHeight: '18px',
      fontSize: 12
    }

    function table(headers, rows) {
      if (rows.length === 0) {
        return h('p', { style: { margin: '12px 0', fontSize: 13, ...muted } }, '—')
      }
      return h(
        'div',
        { style: { ...box, overflow: 'auto' } },
        h(
          'table',
          { style: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } },
          h('thead', null, h('tr', null, headers.map((label) => h('th', { key: label, style: th }, label)))),
          h(
            'tbody',
            null,
            rows.map((cells, index) =>
              h(
                'tr',
                { key: String(index) },
                cells.map((cell, column) => h('td', { key: String(column), style: td }, String(cell ?? '—')))
              )
            )
          )
        )
      )
    }

    function chip(text) {
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '0 7px',
            borderRadius: 999,
            fontSize: 11,
            lineHeight: '17px',
            border: '1px solid rgba(127,127,127,0.45)'
          }
        },
        text
      )
    }

    function renderGraph(payload, t) {
      const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : []
      const edges = Array.isArray(payload && payload.edges) ? payload.edges : []
      if (nodes.length === 0) return h('p', { style: { fontSize: 13, ...muted } }, t.empty)
      return h(
        'div',
        null,
        h('p', { style: { fontSize: 12, ...muted, margin: '0 0 8px' } }, `${nodes.length} nodes · ${edges.length} edges`),
        table(
          ['类型', '节点', '状态', '标签'],
          nodes.map((node) => [node.kind, node.id, node.state, node.label])
        )
      )
    }

    function renderFrontier(payload, t) {
      if (payload === null || typeof payload !== 'object') return h('p', { style: { fontSize: 13, ...muted } }, t.empty)
      const groups = ['ready', 'available', 'running', 'blocked', 'done']
      const rows = []
      for (const group of groups) {
        for (const intent of payload[group] ?? []) rows.push([group, intent.id, intent.confirm ? 'confirm' : 'open', intent.description])
      }
      return table(['前沿状态', '意图', '确认', '描述'], rows)
    }

    function renderWorkers(payload, t) {
      const assignments = Array.isArray(payload && payload.assignments) ? payload.assignments : []
      const executions = Array.isArray(payload && payload.executions) ? payload.executions : []
      return h(
        'div',
        null,
        table(
          ['Assignment', '意图', 'Mandate', '状态', '后端', '尝试', '接班'],
          assignments.map((a) => [a.id, a.intent_id, a.mandate_id, a.status, a.backend, a.attempts, a.resume_of ?? '—'])
        ),
        h('h4', { style: { fontSize: 13, margin: '16px 0 8px' } }, 'Executions'),
        table(
          ['执行', 'Assignment', '状态', '游标', 'Job'],
          executions.map((x) => [x.id, x.assignment_id, x.status, x.output_cursor, x.job_ref ?? '—'])
        )
      )
    }

    function renderEvidence(payload, t) {
      const items = Array.isArray(payload && payload.items) ? payload.items : []
      return table(
        ['证据', '标题', '摘要', '路径', '字节'],
        items.map((item) => [item.id, item.title, item.summary, item.path, item.bytes])
      )
    }

    function renderReport(payload, t) {
      if (payload === null || typeof payload !== 'object') return h('p', { style: { fontSize: 13, ...muted } }, t.empty)
      const pairs = (record) =>
        Object.keys(record ?? {})
          .sort()
          .map((key) => [key, record[key]])
      return h(
        'div',
        null,
        h('p', { style: { fontSize: 12, ...muted, margin: '0 0 8px' } }, `${payload.origin || '—'} · ${payload.goal || '—'}`),
        table(
          ['指标', '值'],
          [
            ['facts', payload.facts],
            ['intents.open', payload.intents && payload.intents.open],
            ['intents.done', payload.intents && payload.intents.done],
            ['generated_at', payload.generated_at]
          ]
        ),
        h('h4', { style: { fontSize: 13, margin: '16px 0 8px' } }, 'assignments'),
        table(['状态', '数量'], pairs(payload.assignments)),
        h('h4', { style: { fontSize: 13, margin: '16px 0 8px' } }, 'effects'),
        table(['状态', '数量'], pairs(payload.effects))
      )
    }

    const RENDERERS = {
      graph: renderGraph,
      frontier: renderFrontier,
      workers: renderWorkers,
      evidence: renderEvidence,
      report: renderReport
    }

    function ViewBody(props) {
      const { state, t } = props
      if (state.status === 'loading') return h('p', { style: { fontSize: 13, ...muted } }, t.loading)
      if (state.status === 'error') {
        return h('p', { style: { fontSize: 13, color: 'inherit', ...muted } }, `${t.failed}: ${state.error || ''}`)
      }
      if (state.status === 'absent' || state.payload === null || state.payload === undefined) {
        return h('p', { style: { fontSize: 13, ...muted } }, t.absent)
      }
      if (state.payload.present === false) return h('p', { style: { fontSize: 13, ...muted } }, t.absent)
      const render = RENDERERS[props.view]
      return render === undefined ? null : render(state.payload, t)
    }

    function Panel(props) {
      const current = useShared()
      const [state, reload] = useView(current.tab, current.sessionId, current.open ? 4000 : 0)
      const t = props.t
      if (!current.open) return null
      const close = () => publish({ open: false })
      return h(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t.title,
          onClick: (event) => {
            if (event.target === event.currentTarget) close()
          },
          onKeyDown: (event) => {
            if (event.key === 'Escape') close()
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147483000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            pointerEvents: 'auto'
          }
        },
        h(
          'div',
          {
            style: {
              width: 'min(1080px, 94vw)',
              height: 'min(760px, 88vh)',
              display: 'flex',
              flexDirection: 'column',
              background: 'Canvas',
              color: 'CanvasText',
              border: '1px solid rgba(127,127,127,0.45)',
              borderRadius: 12,
              boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              font: 'inherit'
            }
          },
          h(
            'header',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderBottom: '1px solid rgba(127,127,127,0.3)'
              }
            },
            h('strong', { style: { fontSize: 13, fontWeight: 600 } }, t.title),
            h('span', { style: { fontSize: 11, ...muted } }, current.sessionId || ''),
            h('span', { style: { marginLeft: 'auto' } }),
            h('button', { type: 'button', style: button, onClick: reload, title: t.refresh }, t.refresh),
            h('button', { type: 'button', style: button, onClick: close, autoFocus: true }, t.close)
          ),
          h(
            'nav',
            { style: { display: 'flex', gap: 8, padding: '10px 14px', flexWrap: 'wrap' } },
            VIEW_IDS.map((id) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  onClick: () => publish({ tab: id }),
                  'aria-pressed': current.tab === id,
                  style: {
                    ...button,
                    padding: '4px 14px',
                    fontSize: 13,
                    fontWeight: current.tab === id ? 600 : 400,
                    border: current.tab === id ? '1px solid rgba(127,127,127,0.75)' : '1px solid rgba(127,127,127,0.4)',
                    background: current.tab === id ? 'rgba(127,127,127,0.12)' : 'transparent'
                  }
                },
                t[id]
              )
            )
          ),
          h(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: '0 14px 18px' } },
            h(ViewBody, { view: current.tab, state, t })
          ),
          h(
            'footer',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderTop: '1px solid rgba(127,127,127,0.3)',
                fontSize: 11,
                ...muted
              }
            },
            chip(state.status === 'ok' ? '.prism/ (read-only)' : state.status)
          )
        )
      )
    }

    /** Session-header utility: renders nothing unless this session has an engagement. */
    function HeaderButton(props) {
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : null
      const [probe] = useView('board', sessionId, 15000)
      const t = props.t
      const present = probe.status === 'ok' && probe.payload !== null && probe.payload !== undefined && probe.payload.present === true
      if (sessionId === null || !present) return null
      const board = probe.payload
      return h(
        'button',
        {
          type: 'button',
          title: t.open,
          onClick: () => publish({ open: true, sessionId }),
          style: { ...button, display: 'inline-flex', alignItems: 'center', gap: 6 }
        },
        'Prism',
        h('span', { style: { fontSize: 11, ...muted } }, `${board.facts ? board.facts.length : 0} facts`)
      )
    }

    function languageOf(ctx) {
      try {
        const raw = ctx?.locale?.current ?? ctx?.locale?.lang ?? ctx?.locale?.locale
        if (typeof raw === 'string' && raw.toLowerCase().startsWith('en')) return 'en'
      } catch {
        /* default to zh */
      }
      return 'zh'
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = COPY[languageOf(ctx)] ?? COPY.zh
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'prism-engagement', order: 40, label: () => t.open },
            (props) => h(HeaderButton, { ...props, t })
          )
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'prism-panel', order: 60, label: () => t.title }, () =>
            h(Panel, { t })
          )
        )
      }
    }
  }
})
