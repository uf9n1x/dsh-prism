// Prism client plugin — the five read-only views (SPEC P8).
//
// Plain-JS bundle in the host's documented `window.__ModuleLoader__` format, so
// it needs no bundler and no typert codegen. It reads `.prism/` through the
// host's read-only `/prism/view` route (see src/host/webrow.ts).
//
// Surface: one entry in `conversation.view` — the tab row that already holds
// 对话/轨迹. That is where the host puts a per-session view, it is scoped to one
// session, and the props carry that session's id, so nothing has to be scraped
// out of the DOM. The honest trade-off: an entry in this slot cannot hide itself
// per session (its only options are id/order/label), so a session without an
// engagement renders a short empty state instead of no tab at all. The old
// header button could hide, but it sat in the top-right corner and was easy to
// miss, which is exactly what the operator reported.
//
// Visuals: one injected sheet (`.prism-root`, `--p-*` tokens) instead of a
// hundred inline objects. Neutral colours are mixed from the host's own
// Canvas/CanvasText, so the panel follows the host theme without hardcoding a
// light or a dark palette.
window.__ModuleLoader__.load({
  id: 'dsh-prism',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const VIEW_IDS = ['graph', 'frontier', 'workers', 'evidence', 'report']

    const COPY = {
      zh: {
        tab: 'Prism',
        title: '实时状态',
        refresh: '刷新',
        loading: '读取 .prism/ …',
        failed: '读取失败',
        absent: '此会话没有 Prism engagement',
        absentHint: '在「Prism 渗透模式」会话里发起一次任务，图谱会自动出现在这里。',
        empty: '暂无数据',
        noSession: '未选中会话',
        live: '实时',
        readOnly: '只读',
        graph: '图谱',
        frontier: '前沿',
        workers: '工兵',
        evidence: '证据',
        report: '报告',
        facts: '事实',
        intentsOpen: '意图 · 开放',
        intentsDone: '意图 · 完成',
        openIntents: '待办意图',
        activeWorkers: '在跑工兵',
        blocked: '受阻',
        nodes: '节点',
        edges: '边',
        legendFact: '事实',
        legendIntent: '意图',
        legendAssignment: '派单',
        selectHint: '点击节点查看详情',
        assignments: '派单',
        executions: '执行',
        effects: '副作用',
        generatedAt: '生成于',
        intent: '意图',
        mandate: '范围',
        backend: '后端',
        attempts: '尝试',
        resume: '接班',
        cursor: '游标',
        job: '作业'
      },
      en: {
        tab: 'Prism',
        title: 'Live state',
        refresh: 'Refresh',
        loading: 'Reading .prism/ …',
        failed: 'Read failed',
        absent: 'No Prism engagement in this session',
        absentHint: 'Start a task in a Prism session and the graph appears here.',
        empty: 'No data yet',
        noSession: 'No session selected',
        live: 'live',
        readOnly: 'read-only',
        graph: 'Graph',
        frontier: 'Frontier',
        workers: 'Workers',
        evidence: 'Evidence',
        report: 'Report',
        facts: 'Facts',
        intentsOpen: 'Intents open',
        intentsDone: 'Intents done',
        openIntents: 'Open intents',
        activeWorkers: 'Active workers',
        blocked: 'Blocked',
        nodes: 'nodes',
        edges: 'edges',
        legendFact: 'fact',
        legendIntent: 'intent',
        legendAssignment: 'assignment',
        selectHint: 'Click a node for detail',
        assignments: 'Assignments',
        executions: 'Executions',
        effects: 'Effects',
        generatedAt: 'generated',
        intent: 'Intent',
        mandate: 'Mandate',
        backend: 'Backend',
        attempts: 'Tries',
        resume: 'Resume',
        cursor: 'Cursor',
        job: 'Job'
      }
    }

    // Status hues are the only fixed colours. Each one is always paired with a
    // text label, so nothing is encoded by colour alone; values sit at the
    // 500/600 step to stay legible on both a white and a near-black surface.
    const STATE_COLOR = {
      fact: '#0d9488',
      ready: '#d97706',
      available: '#0891b2',
      running: '#2563eb',
      spawned: '#2563eb',
      waiting: '#7c3aed',
      blocked: '#dc2626',
      failed: '#dc2626',
      done: '#16a34a',
      interrupted: '#b45309',
      paused: '#64748b',
      cancelled: '#64748b',
      unknown: '#64748b'
    }
    const KIND_COLOR = { fact: '#0d9488', intent: '#7c3aed', assignment: '#2563eb' }

    const CSS = `
.prism-root {
  --p-fg: CanvasText;
  --p-line: color-mix(in srgb, CanvasText 14%, transparent);
  --p-line-soft: color-mix(in srgb, CanvasText 8%, transparent);
  --p-surface: color-mix(in srgb, CanvasText 3.5%, transparent);
  --p-surface-2: color-mix(in srgb, CanvasText 6%, transparent);
  --p-muted: color-mix(in srgb, CanvasText 56%, transparent);
  --p-faint: color-mix(in srgb, CanvasText 36%, transparent);
  --p-accent: #0d9488;
  --p-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: var(--p-fg);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.prism-root *, .prism-root *::before, .prism-root *::after { box-sizing: border-box; }
.prism-top { flex: 0 0 auto; padding: 14px 18px 10px; border-bottom: 1px solid var(--p-line-soft); }
.prism-head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.prism-origin { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
.prism-goal {
  color: var(--p-muted); font-size: 12.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.prism-head-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.prism-live {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--p-muted);
  padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--p-line-soft);
}
.prism-live-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 0 3px color-mix(in srgb, #16a34a 18%, transparent);
}
.prism-btn {
  appearance: none; font: inherit; font-size: 12px; color: var(--p-fg);
  background: transparent; border: 1px solid var(--p-line); border-radius: 7px;
  padding: 4px 10px; cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease;
}
.prism-btn:hover { background: var(--p-surface-2); border-color: color-mix(in srgb, CanvasText 26%, transparent); }
.prism-btn:focus-visible { outline: 2px solid var(--p-accent); outline-offset: 2px; }
.prism-kpi { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.prism-kpi-cell {
  flex: 1 1 0; min-width: 104px;
  border: 1px solid var(--p-line-soft); border-radius: 9px;
  padding: 7px 10px 8px; background: var(--p-surface);
}
.prism-kpi-num {
  font-size: 19px; font-weight: 620; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; line-height: 1.15;
}
.prism-kpi-label {
  margin-top: 1px; font-size: 10.5px; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--p-faint);
}
.prism-tabs {
  flex: 0 0 auto; display: flex; gap: 2px; align-items: center;
  padding: 8px 18px; border-bottom: 1px solid var(--p-line-soft); overflow-x: auto;
}
.prism-tab {
  appearance: none; font: inherit; font-size: 12.5px; color: var(--p-muted);
  background: transparent; border: 0; padding: 5px 11px; border-radius: 7px;
  cursor: pointer; white-space: nowrap;
  transition: color 140ms ease, background-color 140ms ease;
}
.prism-tab:hover { color: var(--p-fg); background: var(--p-surface-2); }
.prism-tab[aria-selected="true"] {
  color: var(--p-fg); background: var(--p-surface-2);
  box-shadow: inset 0 -2px 0 0 var(--p-accent); font-weight: 600;
}
.prism-tab:focus-visible { outline: 2px solid var(--p-accent); outline-offset: 1px; }
.prism-tab-count { margin-left: 5px; font-size: 11px; color: var(--p-faint); font-variant-numeric: tabular-nums; }
.prism-body {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: 14px 18px 88px; scrollbar-width: thin;
}
.prism-body::-webkit-scrollbar { width: 10px; height: 10px; }
.prism-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 6px; border: 3px solid transparent; background-clip: content-box;
}
.prism-card { border: 1px solid var(--p-line-soft); border-radius: 10px; background: var(--p-surface); overflow: hidden; }
.prism-card-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--p-line-soft);
  font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--p-faint);
}
.prism-card-head .prism-count {
  margin-left: auto; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums;
}
.prism-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 12px; border-top: 1px solid var(--p-line-soft);
}
.prism-row:first-child { border-top: 0; }
.prism-row:hover { background: var(--p-surface-2); }
.prism-mono { font-family: var(--p-mono); font-size: 11.5px; letter-spacing: -0.01em; }
.prism-id { color: var(--p-faint); flex: 0 0 auto; padding-top: 1px; }
.prism-row-main { min-width: 0; flex: 1 1 auto; }
.prism-row-title {
  font-size: 12.5px; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.prism-row-sub {
  margin-top: 2px; font-size: 11.5px; color: var(--p-muted); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.prism-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; line-height: 16px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--p-line-soft); color: var(--p-muted); white-space: nowrap;
}
.prism-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.prism-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(244px, 1fr)); }
.prism-group-title {
  display: flex; align-items: center; gap: 6px; margin: 0 0 6px;
  font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--p-faint);
}
.prism-empty-cell {
  border: 1px dashed var(--p-line); border-radius: 9px;
  padding: 10px 12px; color: var(--p-faint); font-size: 12px;
}
.prism-graph-wrap { position: relative; }
.prism-graph-meta {
  text-align: right; font-size: 11.5px; color: var(--p-faint);
  margin-bottom: 6px; font-variant-numeric: tabular-nums;
}
.prism-graph { display: block; width: 100%; height: auto; }
.prism-node { cursor: pointer; }
.prism-node:focus { outline: none; }
.prism-node rect.prism-node-box {
  fill: color-mix(in srgb, CanvasText 4%, transparent);
  stroke: var(--p-line); stroke-width: 1;
  transition: fill 120ms ease, stroke 120ms ease;
}
.prism-node:hover rect.prism-node-box,
.prism-node:focus-visible rect.prism-node-box { fill: color-mix(in srgb, CanvasText 9%, transparent); }
.prism-node[data-selected="true"] rect.prism-node-box { stroke: var(--p-accent); stroke-width: 1.6; }
.prism-node text { fill: currentColor; }
.prism-edge { fill: none; stroke: currentColor; stroke-width: 1.1; }
.prism-detail {
  margin-top: 12px; border: 1px solid var(--p-line-soft);
  border-left: 3px solid var(--p-accent); border-radius: 9px;
  padding: 9px 12px; background: var(--p-surface);
}
.prism-detail-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.prism-detail-body { margin-top: 4px; font-size: 12px; color: var(--p-muted); overflow-wrap: anywhere; }
.prism-bar { height: 6px; border-radius: 999px; background: var(--p-surface-2); overflow: hidden; margin-top: 5px; }
.prism-bar-fill { height: 100%; border-radius: 999px; }
.prism-absent {
  flex: 1 1 auto; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  padding: 48px 24px; text-align: center; color: var(--p-muted);
}
.prism-absent-title { font-size: 13.5px; color: var(--p-fg); }
.prism-absent-hint { font-size: 12px; max-width: 380px; }
.prism-foot {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 7px 18px; border-top: 1px solid var(--p-line-soft);
  font-size: 11px; color: var(--p-faint);
}
.prism-foot .prism-spacer { margin-left: auto; }
@media (prefers-reduced-motion: reduce) { .prism-root * { transition: none !important; } }
`

    /** Inject the sheet once per document; headless contexts simply skip it. */
    function injectStyles() {
      try {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
        if (typeof document.getElementById === 'function' && document.getElementById('prism-style') !== null) return
        const el = document.createElement('style')
        el.id = 'prism-style'
        el.textContent = CSS
        const parent = document.head || document.documentElement
        if (parent !== null && parent !== undefined && typeof parent.appendChild === 'function') parent.appendChild(el)
      } catch {
        /* no DOM (tests, SSR) — inline styles still render */
      }
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
      // `for` pins every payload to the session it was fetched for. The host may
      // keep one view instance alive across a session switch, so between the
      // switch and the first response the previous payload is still in state;
      // without this tag the panel shows the last session's graph under the new
      // session's header, which is worse than showing a spinner.
      const [state, setState] = React.useState({
        status: sessionId === null ? 'absent' : 'loading',
        payload: null,
        at: 0,
        for: sessionId
      })
      const [nonce, setNonce] = React.useState(0)
      const reload = React.useCallback(() => setNonce((n) => n + 1), [])
      React.useEffect(() => {
        if (sessionId === null || typeof sessionId !== 'string' || sessionId.length === 0) {
          setState({ status: 'absent', payload: null, at: 0, for: null })
          return
        }
        let cancelled = false
        const run = async () => {
          if (typeof document !== 'undefined' && document.hidden) return
          try {
            const payload = await fetchView(view, sessionId)
            if (!cancelled) setState({ status: 'ok', payload, at: Date.now(), for: sessionId })
          } catch (error) {
            if (!cancelled) setState({ status: 'error', payload: null, at: Date.now(), error: String(error && error.message), for: sessionId })
          }
        }
        void run()
        // The tab only mounts while it is selected, so this interval is the whole
        // polling story: no timers ticking behind a hidden view.
        const timer = intervalMs > 0 ? setInterval(run, intervalMs) : null
        return () => {
          cancelled = true
          if (timer !== null) clearInterval(timer)
        }
      }, [view, sessionId, intervalMs, nonce])
      return [state, reload]
    }

    // ---- primitives ------------------------------------------------------
    const ONE_LINE = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim()

    function clip(value, max) {
      const text = ONE_LINE(value)
      return text.length <= max ? text : `${text.slice(0, max - 1)}…`
    }

    /**
     * Clip by measured width, not by character count. A CJK glyph is roughly a
     * full em while a Latin one is about 0.55 of it, so counting characters let
     * Chinese labels run past the node border while English ones stopped short.
     */
    function fit(value, maxPx, size) {
      const text = ONE_LINE(value)
      let used = 0
      let out = ''
      for (const char of text) {
        const wide = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)
        const width = wide ? size : size * 0.55
        if (used + width > maxPx) return `${out}…`
        out += char
        used += width
      }
      return out
    }

    function stateColor(state) {
      return STATE_COLOR[state] ?? '#64748b'
    }

    function Dot(props) {
      return h('span', { className: 'prism-dot', style: { background: props.color ?? '#64748b' }, 'aria-hidden': 'true' })
    }

    function Chip(props) {
      return h(
        'span',
        { className: 'prism-chip' },
        props.color === undefined ? null : h(Dot, { color: props.color }),
        props.children
      )
    }

    function StateChip(props) {
      return h(Chip, { color: stateColor(props.state) }, props.label ?? props.state)
    }

    function Card(props) {
      return h(
        'section',
        { className: 'prism-card' },
        props.title === undefined
          ? null
          : h(
              'header',
              { className: 'prism-card-head' },
              props.title,
              props.count === undefined ? null : h('span', { className: 'prism-count' }, String(props.count))
            ),
        props.children
      )
    }

    function Empty(props) {
      return h('div', { className: 'prism-empty-cell' }, props.text ?? props.t.empty)
    }

    function Absent(props) {
      return h(
        'div',
        { className: 'prism-absent' },
        h(
          'svg',
          { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true' },
          h('circle', { cx: 6, cy: 12, r: 2.4, opacity: 0.45 }),
          h('circle', { cx: 18, cy: 6, r: 2.4, opacity: 0.45 }),
          h('circle', { cx: 18, cy: 18, r: 2.4, opacity: 0.45 }),
          h('path', { d: 'M8.3 11.2 15.7 6.8M8.3 12.8 15.7 17.2', opacity: 0.4 })
        ),
        h('div', { className: 'prism-absent-title' }, props.title ?? props.t.absent),
        props.hint === '' ? null : h('div', { className: 'prism-absent-hint' }, props.hint ?? props.t.absentHint)
      )
    }

    // ---- graph -----------------------------------------------------------
    const NODE_W = 208
    const NODE_H = 40
    const NODE_GAP = 8
    const COL_GAP = 78
    const COL_HEADER = 24

    const COLUMN = { fact: 0, intent: 1, assignment: 2 }

    /**
     * Three fixed columns, top-aligned.
     *
     * Top-aligning matters: with a long fact column and two intents, centring
     * each column pushed the intents and assignments to the vertical middle of a
     * 1000px-tall graph — off screen on first load, which made the graph look
     * like a list of facts. Anchoring every column at the top keeps the three
     * layers visible together no matter how lopsided the counts are.
     */
    function layoutGraph(nodes) {
      const columns = [[], [], []]
      for (const node of nodes) (columns[COLUMN[node.kind]] ?? columns[0]).push(node)
      const rows = Math.max(1, ...columns.map((list) => list.length))
      const height = COL_HEADER + rows * (NODE_H + NODE_GAP) - NODE_GAP
      const positions = new Map()
      columns.forEach((list, index) => {
        list.forEach((node, row) => {
          positions.set(node.id, { x: index * (NODE_W + COL_GAP), y: COL_HEADER + row * (NODE_H + NODE_GAP) })
        })
      })
      return { positions, width: 3 * NODE_W + 2 * COL_GAP, height: Math.max(height, NODE_H) }
    }

    function edgePath(from, to) {
      const forward = to.x >= from.x
      const x1 = forward ? from.x + NODE_W : from.x
      const x2 = forward ? to.x : to.x + NODE_W
      const y1 = from.y + NODE_H / 2
      const y2 = to.y + NODE_H / 2
      const bend = Math.max(28, Math.abs(x2 - x1) * 0.38)
      const c1 = forward ? x1 + bend : x1 - bend
      const c2 = forward ? x2 - bend : x2 + bend
      return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`
    }

    function GraphView(props) {
      const t = props.t
      const payload = props.payload
      const [hover, setHover] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : []
      const edges = Array.isArray(payload && payload.edges) ? payload.edges : []
      if (nodes.length === 0) return h(Empty, { t })

      const layout = layoutGraph(nodes)
      const byId = new Map(nodes.map((node) => [node.id, node]))
      const near = hover === null ? null : new Set([hover])
      if (near !== null) {
        for (const edge of edges) {
          if (edge.from === hover) near.add(edge.to)
          if (edge.to === hover) near.add(edge.from)
        }
      }
      const dim = (id) => (near === null || near.has(id) ? 1 : 0.32)
      const picked = selected === null ? null : byId.get(selected)

      return h(
        'div',
        null,
        h('div', { className: 'prism-graph-meta' }, `${nodes.length} ${t.nodes} · ${edges.length} ${t.edges}`),
        h(
          'div',
          { className: 'prism-card prism-graph-wrap', style: { padding: '14px 14px 10px' } },
          h(
            'svg',
            {
              className: 'prism-graph',
              viewBox: `-4 -4 ${layout.width + 8} ${layout.height + 8}`,
              style: { maxWidth: layout.width + 8 },
              role: 'img',
              'aria-label': `${nodes.length} ${t.nodes}, ${edges.length} ${t.edges}`
            },
            ['fact', 'intent', 'assignment'].map((kind, index) =>
              h(
                'g',
                { key: `h-${kind}` },
                h('circle', { cx: index * (NODE_W + COL_GAP) + 3, cy: 9, r: 3.2, fill: KIND_COLOR[kind] }),
                h(
                  'text',
                  {
                    x: index * (NODE_W + COL_GAP) + 12,
                    y: 13,
                    fontSize: 10.5,
                    letterSpacing: '0.06em',
                    className: 'prism-mono',
                    opacity: 0.62
                  },
                  t[kind === 'fact' ? 'legendFact' : kind === 'intent' ? 'legendIntent' : 'legendAssignment']
                )
              )
            ),
            edges.map((edge, index) => {
              const from = layout.positions.get(edge.from)
              const to = layout.positions.get(edge.to)
              if (from === undefined || to === undefined) return null
              const lit = hover !== null && (edge.from === hover || edge.to === hover)
              return h('path', {
                key: `e${index}`,
                className: 'prism-edge',
                d: edgePath(from, to),
                strokeOpacity: lit ? 0.6 : hover === null ? 0.22 : 0.07,
                strokeDasharray: edge.kind === 'result' ? '4 3' : undefined
              })
            }),
            nodes.map((node) => {
              const position = layout.positions.get(node.id)
              if (position === undefined) return null
              const color = node.kind === 'intent' ? stateColor(node.state) : KIND_COLOR[node.kind] ?? '#64748b'
              const toggle = () => setSelected((current) => (current === node.id ? null : node.id))
              return h(
                'g',
                {
                  key: node.id,
                  className: 'prism-node',
                  transform: `translate(${position.x},${position.y})`,
                  opacity: dim(node.id),
                  'data-selected': selected === node.id ? 'true' : 'false',
                  tabIndex: 0,
                  role: 'button',
                  'aria-label': `${node.kind} ${node.id}: ${node.label}`,
                  onMouseEnter: () => setHover(node.id),
                  onMouseLeave: () => setHover(null),
                  onFocus: () => setHover(node.id),
                  onBlur: () => setHover(null),
                  onClick: toggle,
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    toggle()
                  }
                },
                h('rect', { className: 'prism-node-box', width: NODE_W, height: NODE_H, rx: 9 }),
                h('rect', { width: 3, height: NODE_H - 12, x: 1.5, y: 6, rx: 1.5, fill: color, opacity: 0.9 }),
                h('circle', { cx: 15, cy: NODE_H / 2, r: 3.2, fill: color }),
                h('text', { x: 26, y: 16, fontSize: 10.5, className: 'prism-mono', opacity: 0.5 }, fit(node.id, 96, 10.5)),
                h('text', { x: 26, y: 31, fontSize: 11.5 }, fit(node.label, NODE_W - 38, 11.5)),
                h('title', null, `${node.kind} · ${node.state}\n${node.id}\n${node.label}`)
              )
            })
          )
        ),
        picked === null
          ? h('p', { style: { margin: '8px 2px 0', fontSize: 11.5, color: 'var(--p-faint)' } }, t.selectHint)
          : h(
              'div',
              { className: 'prism-detail' },
              h(
                'div',
                { className: 'prism-detail-head' },
                h(Dot, { color: picked.kind === 'intent' ? stateColor(picked.state) : KIND_COLOR[picked.kind] }),
                h('span', { className: 'prism-mono' }, picked.id),
                h(Chip, null, picked.kind),
                h(StateChip, { state: picked.state })
              ),
              h('div', { className: 'prism-detail-body' }, picked.label)
            )
      )
    }

    // ---- frontier --------------------------------------------------------
    function FrontierView(props) {
      const t = props.t
      const payload = props.payload
      if (payload === null || typeof payload !== 'object') return h(Empty, { t })
      const groups = ['ready', 'available', 'running', 'blocked', 'done']
      return h(
        'div',
        { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' } },
        groups.map((key) => {
          const list = Array.isArray(payload[key]) ? payload[key] : []
          // A group with work gets twice the width of an empty one: four empty
          // states sharing the row evenly squeezed the only populated column into
          // unreadable two-word lines.
          const basis = list.length === 0 ? '1 1 176px' : '2 1 260px'
          return h(
            'div',
            { key, style: { flex: basis, minWidth: 0 } },
            h(
              'h3',
              { className: 'prism-group-title' },
              h(Dot, { color: stateColor(key) }),
              key,
              h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, String(list.length))
            ),
            list.length === 0
              ? h('div', { className: 'prism-empty-cell' }, '—')
              : h(
                  'div',
                  { className: 'prism-card' },
                  list.map((intent) =>
                    h(
                      'div',
                      { className: 'prism-row', key: intent.id },
                      h('span', { className: 'prism-id prism-mono' }, intent.id),
                      h(
                        'div',
                        { className: 'prism-row-main' },
                        h('div', { className: 'prism-row-title' }, clip(intent.description, 120)),
                        h(
                          'div',
                          { className: 'prism-row-sub' },
                          `${(intent.from ?? []).length} ← ${intent.to ?? '—'}${intent.confirm ? ' · confirm' : ''}`
                        )
                      )
                    )
                  )
                )
          )
        })
      )
    }

    // ---- workers ---------------------------------------------------------
    function WorkersView(props) {
      const t = props.t
      const payload = props.payload
      const assignments = Array.isArray(payload && payload.assignments) ? payload.assignments : []
      const executions = Array.isArray(payload && payload.executions) ? payload.executions : []
      const byAssignment = new Map()
      for (const execution of executions) {
        const list = byAssignment.get(execution.assignment_id) ?? []
        list.push(execution)
        byAssignment.set(execution.assignment_id, list)
      }
      return h(
        'div',
        null,
        h(
          Card,
          { title: t.assignments, count: assignments.length },
          assignments.length === 0
            ? h(Empty, { t })
            : assignments.map((assignment) =>
                h(
                  'div',
                  { className: 'prism-row', key: assignment.id },
                  h('span', { className: 'prism-id prism-mono' }, assignment.id),
                  h(
                    'div',
                    { className: 'prism-row-main' },
                    h(
                      'div',
                      {
                        className: 'prism-row-title',
                        style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
                      },
                      h(StateChip, { state: assignment.status }),
                      h('span', { className: 'prism-mono' }, assignment.intent_id),
                      h('span', { style: { color: 'var(--p-muted)', fontSize: 11.5 } }, assignment.backend)
                    ),
                    h(
                      'div',
                      { className: 'prism-row-sub' },
                      [
                        `${t.mandate} ${assignment.mandate_id}`,
                        `${t.attempts} ${assignment.attempts}`,
                        assignment.resume_of === null || assignment.resume_of === undefined
                          ? null
                          : `${t.resume} ${assignment.resume_of}`,
                        assignment.worker_session === null || assignment.worker_session === undefined
                          ? null
                          : clip(assignment.worker_session, 20)
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')
                    )
                  ),
                  h(Chip, null, String((byAssignment.get(assignment.id) ?? []).length))
                )
              )
        ),
        h(
          'div',
          { style: { marginTop: 12 } },
          h(
            Card,
            { title: t.executions, count: executions.length },
            executions.length === 0
              ? h(Empty, { t })
              : executions.map((execution) =>
                  h(
                    'div',
                    { className: 'prism-row', key: execution.id },
                    h('span', { className: 'prism-id prism-mono' }, execution.id),
                    h(
                      'div',
                      { className: 'prism-row-main' },
                      h(
                        'div',
                        { className: 'prism-row-title', style: { display: 'flex', gap: 8, alignItems: 'center' } },
                        h(StateChip, { state: execution.status }),
                        h('span', { className: 'prism-mono', style: { color: 'var(--p-muted)' } }, execution.assignment_id)
                      ),
                      h(
                        'div',
                        { className: 'prism-row-sub' },
                        [
                          `${t.cursor} ${execution.output_cursor}`,
                          execution.job_ref === null || execution.job_ref === undefined
                            ? null
                            : `${t.job} ${clip(execution.job_ref, 24)}`,
                          execution.exit_code === undefined || execution.exit_code === null
                            ? null
                            : `exit ${execution.exit_code}`
                        ]
                          .filter((part) => part !== null)
                          .join(' · ')
                      )
                    )
                  )
                )
          )
        )
      )
    }

    // ---- evidence --------------------------------------------------------
    function EvidenceView(props) {
      const t = props.t
      const payload = props.payload
      const items = Array.isArray(payload && payload.items) ? payload.items : []
      return h(
        Card,
        { title: t.evidence, count: items.length },
        items.length === 0
          ? h(Empty, { t })
          : items.map((item) =>
              h(
                'div',
                { className: 'prism-row', key: item.id },
                h('span', { className: 'prism-id prism-mono' }, item.id),
                h(
                  'div',
                  { className: 'prism-row-main' },
                  h('div', { className: 'prism-row-title' }, clip(item.title, 140)),
                  h('div', { className: 'prism-row-sub' }, clip(item.summary, 240)),
                  item.path === null || item.path === undefined
                    ? null
                    : h(
                        'div',
                        { className: 'prism-row-sub prism-mono', style: { color: 'var(--p-faint)' } },
                        `${clip(item.path, 96)}${
                          item.bytes === undefined || item.bytes === null ? '' : ` · ${item.bytes} B`
                        }`
                      )
                )
              )
            )
      )
    }

    // ---- report ----------------------------------------------------------
    function metricBar(value, total) {
      const ratio = total > 0 ? Math.min(1, value / total) : 0
      return h(
        'div',
        { className: 'prism-bar' },
        h('div', {
          className: 'prism-bar-fill',
          style: {
            width: `${Math.max(ratio * 100, value > 0 ? 3 : 0)}%`,
            background: 'color-mix(in srgb, var(--p-accent) 55%, transparent)'
          }
        })
      )
    }

    function Distribution(props) {
      const t = props.t
      const record = props.record ?? {}
      const keys = Object.keys(record).sort()
      const total = keys.reduce((sum, key) => sum + Number(record[key] || 0), 0)
      return h(
        Card,
        { title: props.title, count: total },
        keys.length === 0
          ? h(Empty, { t })
          : keys.map((key) =>
              h(
                'div',
                { className: 'prism-row', key },
                h(
                  'div',
                  { className: 'prism-row-main' },
                  h(
                    'div',
                    { className: 'prism-row-title', style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h(StateChip, { state: key }),
                    h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, String(record[key]))
                  ),
                  metricBar(Number(record[key] || 0), total)
                )
              )
            )
      )
    }

    function ReportView(props) {
      const t = props.t
      const payload = props.payload
      if (payload === null || typeof payload !== 'object') return h(Empty, { t })
      const metrics = [
        [t.facts, payload.facts ?? 0],
        [t.intentsOpen, payload.intents ? payload.intents.open : 0],
        [t.intentsDone, payload.intents ? payload.intents.done : 0]
      ]
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'prism-kpi', style: { marginTop: 0, marginBottom: 12 } },
          metrics.map(([label, value]) =>
            h(
              'div',
              { className: 'prism-kpi-cell', key: label },
              h('div', { className: 'prism-kpi-num' }, String(value)),
              h('div', { className: 'prism-kpi-label' }, label)
            )
          )
        ),
        h(Distribution, { t, title: t.assignments, record: payload.assignments }),
        h('div', { style: { marginTop: 12 } }, h(Distribution, { t, title: t.effects, record: payload.effects })),
        h(
          'p',
          { style: { margin: '10px 2px 0', fontSize: 11.5, color: 'var(--p-faint)' } },
          `${payload.origin || '—'} · ${t.generatedAt} ${payload.generated_at || '—'}`
        )
      )
    }

    const RENDERERS = {
      graph: GraphView,
      frontier: FrontierView,
      workers: WorkersView,
      evidence: EvidenceView,
      report: ReportView
    }

    // ---- shell -----------------------------------------------------------
    function Kpi(props) {
      return h(
        'div',
        { className: 'prism-kpi' },
        props.cells.map((cell) =>
          h(
            'div',
            { className: 'prism-kpi-cell', key: cell.label },
            h('div', { className: 'prism-kpi-num' }, String(cell.value)),
            h('div', { className: 'prism-kpi-label' }, cell.label)
          )
        )
      )
    }

    /**
     * The view prop `sessionId` is not always the session the user is looking at:
     * the host reuses a view instance across a session switch, so the prop can
     * lag by one switch while the tab already shows the new conversation. A
     * payload fetched for the wrong session is worse than a spinner, so ask the
     * host's own session hook first and keep the prop only as a fallback.
     */
    function useLiveSessionId(props) {
      const hook = props.useSession
      if (typeof hook !== 'function') return null
      try {
        const snapshot = hook((value) => value)
        if (snapshot === null || typeof snapshot !== 'object') return null
        const direct = snapshot.id ?? snapshot.sessionId
        if (typeof direct === 'string' && direct.length > 0) return direct
        const nested = snapshot.session
        if (nested !== null && typeof nested === 'object' && typeof nested.id === 'string') return nested.id
        return null
      } catch {
        return null
      }
    }

    function PrismView(props) {
      const t = props.t
      const propSession = typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null
      const liveSession = useLiveSessionId(props)
      const sessionId = liveSession ?? propSession
      const [tab, setTab] = React.useState('graph')
      const [boardRaw, reloadBoard] = useView('board', sessionId, 4000)
      const [viewRaw, reloadView] = useView(tab, sessionId, 4000)
      // A payload fetched for another session is not evidence about this one.
      const stale = { status: 'loading', payload: null, at: 0, for: sessionId }
      const board = boardRaw.for === sessionId ? boardRaw : stale
      const state = viewRaw.for === sessionId ? viewRaw : stale

      // On a session switch the host can render this view one frame before it
      // binds the session id. That is "not ready yet", not "no session", and
      // saying the wrong one makes the panel look broken for a moment.
      if (sessionId === null) {
        return h(
          'div',
          { className: 'prism-absent' },
          h('div', { className: 'prism-absent-hint' }, t.loading)
        )
      }

      const boardPayload = board.status === 'ok' ? board.payload : null
      if (board.status === 'ok' && (boardPayload === null || boardPayload.present !== true)) return h(Absent, { t })

      const refresh = () => {
        reloadBoard()
        reloadView()
      }

      const frontier = (boardPayload && boardPayload.frontier) ?? {}
      const openIntents = ['ready', 'available', 'running', 'blocked'].reduce(
        (sum, key) => sum + (Array.isArray(frontier[key]) ? frontier[key].length : 0),
        0
      )
      const assignments = (boardPayload && boardPayload.assignments) ?? []
      const active = assignments.filter(
        (assignment) =>
          assignment.status === 'running' || assignment.status === 'spawned' || assignment.status === 'waiting'
      ).length
      const blocked = Array.isArray(frontier.blocked) ? frontier.blocked.length : 0
      const facts = boardPayload && Array.isArray(boardPayload.facts) ? boardPayload.facts.length : 0

      const counts = { graph: facts, frontier: openIntents, workers: active, evidence: 0, report: 0 }

      return h(
        'div',
        {
          className: 'prism-root',
          'data-session': sessionId,
          'data-live': liveSession ?? '',
          'data-prop-session': propSession ?? ''
        },
        h(
          'header',
          { className: 'prism-top' },
          h(
            'div',
            { className: 'prism-head' },
            h('span', { className: 'prism-origin' }, (boardPayload && boardPayload.origin) || 'Prism'),
            h('span', { className: 'prism-goal' }, (boardPayload && boardPayload.goal) || ''),
            h(
              'div',
              { className: 'prism-head-actions' },
              h('span', { className: 'prism-live', title: '4s' }, h('span', { className: 'prism-live-dot' }), t.live),
              h('button', { type: 'button', className: 'prism-btn', onClick: refresh, 'aria-label': t.refresh }, t.refresh)
            )
          ),
          board.status === 'ok'
            ? h(Kpi, {
                cells: [
                  { label: t.facts, value: facts },
                  { label: t.openIntents, value: openIntents },
                  { label: t.activeWorkers, value: active },
                  { label: t.blocked, value: blocked }
                ]
              })
            : null
        ),
        h(
          'nav',
          { className: 'prism-tabs', role: 'tablist', 'aria-label': t.title },
          VIEW_IDS.map((id) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                className: 'prism-tab',
                'aria-selected': tab === id ? 'true' : 'false',
                onClick: () => setTab(id),
                onKeyDown: (event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                  event.preventDefault()
                  const index = VIEW_IDS.indexOf(tab)
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % VIEW_IDS.length
                      : (index - 1 + VIEW_IDS.length) % VIEW_IDS.length
                  setTab(VIEW_IDS[next])
                }
              },
              t[id],
              counts[id] > 0 ? h('span', { className: 'prism-tab-count' }, String(counts[id])) : null
            )
          )
        ),
        h(
          'div',
          { className: 'prism-body', role: 'tabpanel', 'aria-label': t[tab] },
          state.status === 'loading' && state.payload === null
            ? h('p', { style: { fontSize: 12.5, color: 'var(--p-muted)' } }, t.loading)
            : state.status === 'error'
              ? h('p', { style: { fontSize: 12.5, color: 'var(--p-muted)' } }, `${t.failed}: ${state.error || ''}`)
              : state.payload === null || state.payload === undefined
                ? h(Empty, { t })
                : state.payload.present === false
                  ? h(Empty, { t })
                  : h(RENDERERS[tab] ?? Empty, { t, payload: state.payload })
        ),
        h(
          'footer',
          { className: 'prism-foot' },
          h('span', null, `.prism/ · ${t.readOnly}`),
          h('span', { className: 'prism-spacer' }),
          state.at > 0 ? h('span', null, new Date(state.at).toLocaleTimeString()) : null
        )
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
        injectStyles()
        const t = COPY[languageOf(ctx)] ?? COPY.zh
        // The tab row that holds 对话/轨迹. Scoped to a single session, and the
        // props carry that session's id, so no scraping and no cross-session
        // leakage. `label` is a thunk so it follows the active locale.
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'prism', order: 100, label: () => t.tab },
            (props) => h(PrismView, { ...props, t })
          )
        )
      }
    }
  }
})
