import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Network, List, ZoomIn, ZoomOut, KeyRound, Link2 } from 'lucide-react'
import clsx from 'clsx'

const MAX_COLS = 5
const CARD_W = 230
const HEADER_H = 30
const ROW_H = 20
const MORE_H = 20
const COL_GAP = 90
const ROW_GAP = 24
const PAD = 24
const HOP_OPTIONS = [1, 2, 3, 4]

const tKey = (schema, name) => `${schema}.${name}`.toLowerCase()

// Builds the node/edge layout: columns by hop distance from the seed table.
function buildLayout(model, seedKey) {
  const tables = model.tables || []
  const edges = model.edges || []

  // Hop distance (undirected BFS) from the seed.
  const adj = new Map()
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a).add(b)
  }
  edges.forEach(e => {
    const a = tKey(e.fromSchema, e.fromTable)
    const b = tKey(e.toSchema, e.toTable)
    link(a, b)
    link(b, a)
  })
  const dist = new Map([[seedKey, 0]])
  let frontier = [seedKey]
  while (frontier.length) {
    const next = []
    for (const k of frontier) {
      for (const n of adj.get(k) || []) {
        if (!dist.has(n)) {
          dist.set(n, dist.get(k) + 1)
          next.push(n)
        }
      }
    }
    frontier = next
  }

  // Columns that take part in a relation come first, then PKs, then the rest.
  const fkCols = new Map()
  edges.forEach(e => {
    const f = tKey(e.fromSchema, e.fromTable)
    const t = tKey(e.toSchema, e.toTable)
    if (!fkCols.has(f)) fkCols.set(f, new Set())
    if (!fkCols.has(t)) fkCols.set(t, new Set())
    fkCols.get(f).add(e.fromColumn.toLowerCase())
    fkCols.get(t).add(e.toColumn.toLowerCase())
  })

  const nodes = tables.map(t => {
    const key = tKey(t.schema, t.name)
    const related = fkCols.get(key) || new Set()
    const cols = t.columns || []
    const rank = c => (related.has(c.name.toLowerCase()) ? 0 : c.primaryKey ? 1 : 2)
    const sorted = cols
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .slice(0, MAX_COLS)
      .map(x => ({ ...x.c, related: related.has(x.c.name.toLowerCase()) }))
    const hidden = cols.length - sorted.length
    const height = HEADER_H + Math.max(sorted.length, 1) * ROW_H + (hidden > 0 ? MORE_H : 0)
    return {
      key, schema: t.schema, name: t.name,
      level: dist.get(key) ?? 0,
      cols: sorted, hidden, total: cols.length, height,
      x: 0, y: 0,
    }
  })

  // Group by level; order each level by the barycenter of its neighbours in the previous one.
  const levels = []
  nodes.forEach(n => {
    ;(levels[n.level] ||= []).push(n)
  })
  const yIndex = new Map()
  levels.forEach((lvl, li) => {
    if (!lvl) return
    lvl.sort((a, b) => {
      const bary = n => {
        const ys = [...(adj.get(n.key) || [])].filter(k => yIndex.has(k)).map(k => yIndex.get(k))
        return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : Infinity
      }
      return li === 0 ? 0 : bary(a) - bary(b) || a.name.localeCompare(b.name)
    })
    lvl.forEach((n, i) => yIndex.set(n.key, i))
  })

  // Positions: vertically centred columns.
  const colHeights = levels.map(lvl => (lvl || []).reduce((s, n) => s + n.height, 0) + Math.max((lvl || []).length - 1, 0) * ROW_GAP)
  const maxH = Math.max(0, ...colHeights)
  levels.forEach((lvl, li) => {
    if (!lvl) return
    let y = PAD + (maxH - colHeights[li]) / 2
    lvl.forEach(n => {
      n.x = PAD + li * (CARD_W + COL_GAP)
      n.y = y
      y += n.height + ROW_GAP
    })
  })

  const byKey = new Map(nodes.map(n => [n.key, n]))
  const anchorY = (n, col) => {
    const i = n.cols.findIndex(c => c.name.toLowerCase() === col.toLowerCase())
    return i >= 0 ? n.y + HEADER_H + i * ROW_H + ROW_H / 2 : n.y + HEADER_H / 2
  }
  const links = edges
    .map((e, i) => {
      const a = byKey.get(tKey(e.fromSchema, e.fromTable))
      const b = byKey.get(tKey(e.toSchema, e.toTable))
      if (!a || !b) return null
      return { id: i, fk: e, a, b, ya: anchorY(a, e.fromColumn), yb: anchorY(b, e.toColumn) }
    })
    .filter(Boolean)

  const width = PAD * 2 + levels.length * CARD_W + Math.max(levels.length - 1, 0) * COL_GAP
  const height = PAD * 2 + maxH
  return { nodes, links, width, height, dist }
}

function linkPath(l) {
  const { a, b, ya, yb } = l
  if (a.x === b.x) {
    // Same column: loop out through the left side.
    const x = a.x
    const bulge = 46 + (l.id % 3) * 10
    return `M ${x} ${ya} C ${x - bulge} ${ya}, ${x - bulge} ${yb}, ${x} ${yb}`
  }
  const [l1, l2, y1, y2] = a.x < b.x ? [a, b, ya, yb] : [b, a, yb, ya]
  const x1 = l1.x + CARD_W
  const x2 = l2.x
  const mid = (x2 - x1) / 2
  return `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`
}

export default function RelationsPanel({ obj, onBack, onOpenTable }) {
  const [depth, setDepth] = useState(1)
  const [mode, setMode] = useState('model') // 'model' | 'list'
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState('')

  const seedKey = tKey(obj.schema, obj.name)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const api = await import('../../wailsjs/go/main/App')
        const m = await api.GetSchemaModel(obj.schema, obj.name, depth)
        if (!cancelled) setModel(m)
      } catch (e) {
        if (!cancelled) {
          setModel(null)
          setError(e.toString())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [obj.schema, obj.name, depth])

  const layout = useMemo(() => (model ? buildLayout(model, seedKey) : null), [model, seedKey])
  const relatedCount = layout ? layout.nodes.length - 1 : 0

  const display = obj.schema ? `${obj.schema}.${obj.name}` : obj.name

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button onClick={onBack} className="btn-secondary text-xs py-1.5 px-3" title="Volver a la lista (Escape)">
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="badge-blue">Relaciones</span>
          <span className="text-sm font-semibold text-white font-mono truncate" title={display}>{display}</span>
          {layout && <span className="text-xs text-slate-500 whitespace-nowrap">{relatedCount} tabla(s) relacionada(s)</span>}
        </div>
        <div className="flex-1" />

        {/* Hops */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Saltos</span>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {HOP_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setDepth(n)}
                title={n === 1 ? 'Solo relaciones directas' : `Relaciones hasta ${n} saltos`}
                className={clsx(
                  'w-7 py-1 rounded-md text-xs font-medium transition-all',
                  depth === n ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setMode('model')}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              mode === 'model' ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            <Network className="w-3.5 h-3.5" /> Modelo
          </button>
          <button
            onClick={() => setMode('list')}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              mode === 'list' ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            <List className="w-3.5 h-3.5" /> Lista
          </button>
        </div>

        {mode === 'model' && (
          <div className="flex items-center gap-1">
            <button className="btn-secondary p-1.5" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} title="Alejar">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-slate-500 w-9 text-center">{Math.round(zoom * 100)}%</span>
            <button className="btn-secondary p-1.5" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} title="Acercar">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
            <span className="text-sm">Cargando relaciones…</span>
          </div>
        ) : !layout ? null : layout.nodes.length <= 1 ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-500">
            Esta tabla no tiene relaciones por llave foránea.
          </div>
        ) : mode === 'model' ? (
          <ModelDiagram
            layout={layout}
            seedKey={seedKey}
            zoom={zoom}
            hover={hover}
            setHover={setHover}
            onOpenTable={onOpenTable}
          />
        ) : (
          <RelationList layout={layout} seedKey={seedKey} onOpenTable={onOpenTable} />
        )}
      </div>
    </div>
  )
}

function ModelDiagram({ layout, seedKey, zoom, hover, setHover, onOpenTable }) {
  const { nodes, links, width, height } = layout
  return (
    <svg
      width={width * zoom}
      height={height * zoom}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', minWidth: '100%' }}
      onMouseLeave={() => setHover('')}
    >
      <defs>
        <marker id="fk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
        <marker id="fk-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
        </marker>
      </defs>

      {/* Edges */}
      {links.map(l => {
        const active = hover && (l.a.key === hover || l.b.key === hover)
        const dim = hover && !active
        // Arrow points to the referenced (PK) side.
        const fromLeft = l.a.x <= l.b.x
        return (
          <path
            key={l.id}
            d={linkPath(l)}
            fill="none"
            stroke={active ? '#38bdf8' : '#64748b'}
            strokeWidth={active ? 2 : 1.3}
            opacity={dim ? 0.15 : 0.9}
            markerStart={fromLeft ? undefined : (active ? 'url(#fk-arrow-hi)' : 'url(#fk-arrow)')}
            markerEnd={fromLeft ? (active ? 'url(#fk-arrow-hi)' : 'url(#fk-arrow)') : undefined}
          >
            <title>{`${l.fk.fromTable}.${l.fk.fromColumn} → ${l.fk.toTable}.${l.fk.toColumn} (${l.fk.name})`}</title>
          </path>
        )
      })}

      {/* Tables */}
      {nodes.map(n => {
        const isSeed = n.key === seedKey
        const dim = hover && hover !== n.key && !links.some(l => (l.a.key === hover && l.b.key === n.key) || (l.b.key === hover && l.a.key === n.key))
        return (
          <g key={n.key} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.35 : 1}
             onMouseEnter={() => setHover(n.key)}>
            <rect width={CARD_W} height={n.height} rx={8} fill="#0f1722"
                  stroke={isSeed ? '#38bdf8' : '#334155'} strokeWidth={isSeed ? 2 : 1} />
            <path d={`M 0 ${HEADER_H} L 0 8 Q 0 0 8 0 L ${CARD_W - 8} 0 Q ${CARD_W} 0 ${CARD_W} 8 L ${CARD_W} ${HEADER_H} Z`}
                  fill={isSeed ? '#075985' : '#1e293b'} />
            <g style={{ cursor: 'pointer' }} onClick={() => onOpenTable(n)}>
              <title>{`Abrir ${n.schema}.${n.name} en Tablas (${n.total} columnas)`}</title>
              <rect width={CARD_W} height={HEADER_H} fill="transparent" />
              <text x={10} y={19} fontSize={12} fontWeight={600} fill="#fff" fontFamily="monospace">
                {clip(n.name, 26)}
              </text>
              <text x={CARD_W - 10} y={19} fontSize={9} fill="#94a3b8" textAnchor="end">{clip(n.schema, 12)}</text>
            </g>
            {n.cols.map((c, i) => {
              const y = HEADER_H + i * ROW_H
              return (
                <g key={c.name} transform={`translate(0,${y})`}>
                  <text x={10} y={14} fontSize={10} fontFamily="monospace"
                        fill={c.primaryKey ? '#fbbf24' : c.related ? '#7dd3fc' : '#cbd5e1'}>
                    {c.primaryKey ? '🔑 ' : c.related ? '↔ ' : '   '}{clip(c.name, 20)}
                  </text>
                  <text x={CARD_W - 10} y={14} fontSize={9} fill="#64748b" textAnchor="end">{clip(c.dataType, 14)}</text>
                </g>
              )
            })}
            {n.hidden > 0 && (
              <g style={{ cursor: 'pointer' }} onClick={() => onOpenTable(n)}>
                <title>Abrir la tabla para ver todas sus columnas</title>
                <text x={10} y={HEADER_H + n.cols.length * ROW_H + 14} fontSize={10} fill="#38bdf8">
                  + {n.hidden} columna(s) más · ver definición
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function RelationList({ layout, seedKey, onOpenTable }) {
  const { nodes, links, dist } = layout
  const groups = useMemo(() => {
    const m = new Map()
    nodes.forEach(n => {
      if (n.key === seedKey) return
      const d = dist.get(n.key) ?? 0
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(n)
    })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [nodes, dist, seedKey])

  return (
    <div className="p-3 flex flex-col gap-4">
      {groups.map(([hop, list]) => (
        <div key={hop}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
            {hop === 1 ? 'Relación directa' : `${hop} saltos`} · {list.length}
          </p>
          <div className="flex flex-col gap-1.5">
            {list.sort((a, b) => a.name.localeCompare(b.name)).map(n => {
              const rel = links.filter(l => l.a.key === n.key || l.b.key === n.key)
              return (
                <div key={n.key} className="rounded-lg border border-surface-600 px-3 py-2" style={{ background: '#0f1722' }}>
                  <button
                    className="text-xs font-mono font-semibold text-white hover:text-brand-light hover:underline underline-offset-2"
                    onClick={() => onOpenTable(n)}
                    title="Abrir en Tablas"
                  >
                    {n.schema}.{n.name}
                  </button>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {rel.map(l => (
                      <div key={l.id} className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                        <Link2 className="w-3 h-3 text-slate-600 flex-shrink-0" />
                        <span>{l.fk.fromTable}.{l.fk.fromColumn}</span>
                        <span className="text-brand-light">→</span>
                        <span>{l.fk.toTable}.{l.fk.toColumn}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function clip(s, n) {
  s = s || ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
