import { useState, useEffect, useMemo, useRef } from 'react'
import {
  GitCompare, ArrowRight, Loader2, AlertCircle, Search, Eye, EyeOff, X,
  Database, FunctionSquare, Zap, Eye as ViewIcon, Plus, Minus, Equal, Pencil, Info, Table2,
  ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp, FileCode2, FileText, Copy, Save, Check, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'

let goApp = null
async function go() {
  if (!goApp) goApp = await import('../../wailsjs/go/main/App')
  return goApp
}

const TYPES = [
  { value: 'TABLE', label: 'Tablas', short: 'Tablas', icon: Table2 },
  { value: 'STORED_PROCEDURE', label: 'Stored Procedures', short: 'SP', icon: Database },
  { value: 'FUNCTION', label: 'Funciones', short: 'Funciones', icon: FunctionSquare },
  { value: 'VIEW', label: 'Vistas', short: 'Vistas', icon: ViewIcon },
  { value: 'TRIGGER', label: 'Triggers', short: 'Triggers', icon: Zap },
]

const STATUS = {
  different:  { label: 'Distintos',       tip: 'Existen en ambas, con definición diferente', color: 'text-amber-300',   dot: 'bg-amber-400',   icon: Pencil },
  onlySource: { label: 'Solo en origen',  tip: 'Faltan en el destino',                       color: 'text-sky-300',     dot: 'bg-sky-400',     icon: Minus },
  onlyTarget: { label: 'Solo en destino', tip: 'No existen en el origen',                    color: 'text-violet-300',  dot: 'bg-violet-400',  icon: Plus },
  same:       { label: 'Iguales',         tip: 'Sin diferencias',                            color: 'text-emerald-300', dot: 'bg-emerald-400', icon: Equal },
}
const STATUS_ORDER = ['different', 'onlySource', 'onlyTarget', 'same']

const DEFAULT_OPTIONS = { ignoreWhitespace: true, ignoreCase: false, ignoreComments: false }
const CONTEXT = 3

const itemKey = it => `${it.type}|${it.schema}|${it.parentName || ''}|${it.name}`
const displayName = it => `${it.schema ? it.schema + '.' : ''}${it.parentName ? it.parentName + '.' : ''}${it.name}`

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none" title={hint}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-sky-500" />
      {label}
    </label>
  )
}

export default function ComparePanel({ workspaceId, connInfo, active, others }) {
  const [targetId, setTargetId] = useState('')
  const [types, setTypes] = useState(['TABLE', 'STORED_PROCEDURE', 'FUNCTION', 'VIEW', 'TRIGGER'])
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState(null) // { result, targetId, options, types }
  const [statusFilter, setStatusFilter] = useState(null)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState(null)
  const [diff, setDiff] = useState(null)
  const [changes, setChanges] = useState(null) // table structure differences
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(true)
  const diffReq = useRef(0)
  const [collapsed, setCollapsed] = useState(() => new Set()) // accordion: collapsed object types
  const [checked, setChecked] = useState(() => new Set()) // objects included in the sync script
  const [scriptOpen, setScriptOpen] = useState(false)
  const [reportMsg, setReportMsg] = useState('')

  // Candidates: other connected workspaces with the same engine.
  const candidates = useMemo(
    () => (others || []).filter(o => o.dbType === connInfo.dbType),
    [others, connInfo.dbType],
  )
  const incompatible = (others || []).length - candidates.length
  const availableTypes = connInfo.dbType === 'MYSQL' ? TYPES.filter(t => t.value === 'STORED_PROCEDURE') : TYPES

  useEffect(() => {
    if (!candidates.some(c => c.id === targetId)) setTargetId(candidates[0]?.id || '')
  }, [candidates, targetId])

  useEffect(() => {
    let off
    let cancelled = false
    ;(async () => {
      const { EventsOn } = await import('../../wailsjs/runtime/runtime')
      if (cancelled) return
      off = EventsOn('compare:progress', d => {
        if (d.workspaceId === workspaceId) setProgress(d)
      })
    })()
    return () => { cancelled = true; off?.() }
  }, [workspaceId])

  const target = candidates.find(c => c.id === targetId)
  const stale = run && (
    run.targetId !== targetId ||
    JSON.stringify(run.options) !== JSON.stringify(options) ||
    run.types.join() !== types.join()
  )

  const start = async () => {
    if (!target || running || types.length === 0) return
    setRunning(true)
    setError('')
    setProgress({ phase: 'listing', done: 0, total: 0 })
    setSelected(null)
    setDiff(null)
    setChanges(null)
    try {
      const api = await go()
      const ordered = availableTypes.map(t => t.value).filter(v => types.includes(v))
      const result = await api.CompareObjects(workspaceId, targetId, { types: ordered, options })
      setRun({ result, targetId, options: { ...options }, types: ordered, targetLabel: target.label })
      setStatusFilter(result.summary.different > 0 ? 'different' : null)
      // Only what differs is pre-selected; creating (source-only) and deleting stay opt-in.
      setChecked(new Set((result.items || []).filter(i => i.status === 'different').map(itemKey)))
      setCollapsed(new Set())
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const cancel = async () => { try { (await go()).CancelCompare(workspaceId) } catch { /* nothing running */ } }

  const openItem = async (it) => {
    setSelected(it)
    setDiff(null)
    setChanges(null)
    setDiffError('')
    if (it.status === 'onlySource' || it.status === 'onlyTarget') return
    const req = ++diffReq.current
    setDiffLoading(true)
    try {
      const api = await go()
      const obj = { type: it.type, schema: it.schema, parentName: it.parentName || '', name: it.name }
      if (it.type === 'TABLE') {
        const c = await api.CompareTableDetail(workspaceId, run.targetId, obj)
        if (req === diffReq.current) setChanges(c || [])
      } else {
        const d = await api.CompareObjectDiff(workspaceId, run.targetId, obj, run.options)
        if (req === diffReq.current) setDiff(d)
      }
    } catch (e) {
      if (req === diffReq.current) setDiffError(String(e?.message || e))
    } finally {
      if (req === diffReq.current) setDiffLoading(false)
    }
  }

  const items = run?.result?.items || []
  const visible = useMemo(() => {
    const q = text.trim().toLowerCase()
    return items.filter(it =>
      (!statusFilter || it.status === statusFilter) &&
      (!q || displayName(it).toLowerCase().includes(q)))
  }, [items, statusFilter, text])

  const groups = useMemo(() => {
    const by = new Map()
    visible.forEach(it => {
      if (!by.has(it.type)) by.set(it.type, [])
      by.get(it.type).push(it)
    })
    return TYPES.filter(t => by.has(t.value)).map(t => ({ ...t, items: by.get(t.value) }))
  }, [visible])

  const toggleType = (v) =>
    setTypes(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]))

  // A text filter opens every group so matches are never hidden inside a collapsed one.
  const filtering = text.trim() !== ''
  const isOpen = (type) => filtering || !collapsed.has(type)
  const toggleGroup = (type) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(type)) next.delete(type); else next.add(type)
    return next
  })
  const allCollapsed = groups.length > 0 && groups.every(g => collapsed.has(g.value))
  const toggleAllGroups = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(g => g.value)))

  const scriptable = (it) => it.status !== 'same'
  const toggleChecked = (it) => setChecked(prev => {
    const next = new Set(prev)
    const k = itemKey(it)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  const toggleGroupChecked = (g) => setChecked(prev => {
    const next = new Set(prev)
    const list = g.items.filter(scriptable)
    const all = list.length > 0 && list.every(it => next.has(itemKey(it)))
    list.forEach(it => (all ? next.delete(itemKey(it)) : next.add(itemKey(it))))
    return next
  })
  const selectedItems = items.filter(it => scriptable(it) && checked.has(itemKey(it)))

  const exportReport = async () => {
    setReportMsg('')
    try {
      const api = await go()
      const path = await api.SaveReport(`comparacion_${connInfo.dbName}_vs_${(run.targetLabel || 'destino').split(' ')[0]}.md`, buildReport(connInfo.dbName, run))
      if (path) setReportMsg(`Reporte guardado en ${path}`)
    } catch (e) {
      setReportMsg(String(e?.message || e))
    }
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header: what to compare */}
      <div className="flex-shrink-0 border-b border-surface-600 p-4 flex flex-col gap-3" style={{ background: 'rgba(11,16,26,0.5)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <GitCompare className="w-5 h-5 text-brand-light" />
          <h2 className="text-sm font-semibold text-white">Comparar bases de datos</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2.5 py-1 rounded-md bg-surface-700/60 border border-surface-600 text-slate-200" title="Este espacio de trabajo es el origen">
              {connInfo.dbName} <span className="text-slate-500 text-xs">· origen</span>
            </span>
            <ArrowRight className="w-4 h-4 text-slate-500" />
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              disabled={running || candidates.length === 0}
              className="input-field !w-auto !py-1.5"
            >
              {candidates.length === 0 && <option value="">Sin destino disponible</option>}
              {candidates.map(c => <option key={c.id} value={c.id}>{c.label} · destino</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {running ? (
              <button onClick={cancel} className="btn-secondary"><X className="w-4 h-4" />Cancelar</button>
            ) : null}
            <button onClick={start} disabled={!target || running || types.length === 0} className="btn-primary">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
              {run ? 'Volver a comparar' : 'Comparar'}
            </button>
          </div>
        </div>

        {candidates.length === 0 && (
          <div className="flex items-start gap-2 text-xs text-slate-400 bg-surface-800/60 border border-surface-600 rounded-lg px-3 py-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-light" />
            <span>
              Para comparar necesitas otro espacio de trabajo conectado a una base del mismo motor
              ({connInfo.dbType === 'SQL_SERVER' ? 'SQL Server' : connInfo.dbType === 'MYSQL' ? 'MySQL' : 'PostgreSQL'}).
              Usa el botón «+» de las pestañas de arriba, conéctalo a la otra base y vuelve aquí.
              {incompatible > 0 && ` (${incompatible} conexión(es) de otro motor no se pueden comparar.)`}
            </span>
          </div>
        )}

        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {availableTypes.map(t => {
              const on = types.includes(t.value)
              return (
                <button
                  key={t.value}
                  onClick={() => toggleType(t.value)}
                  disabled={running}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-all',
                    on ? 'text-brand-light border-brand-dark/60 bg-brand-dark/20' : 'text-slate-500 border-surface-600 hover:text-slate-300',
                  )}
                >
                  <t.icon className="w-3.5 h-3.5" />{t.short}
                </button>
              )
            })}
          </div>
          <span className="w-px h-5 bg-surface-600" />
          <Toggle checked={options.ignoreWhitespace} onChange={v => setOptions(o => ({ ...o, ignoreWhitespace: v }))}
            label="Ignorar espacios" hint="Ignora saltos de línea, sangría, espacios repetidos, líneas en blanco y CREATE vs ALTER" />
          <Toggle checked={options.ignoreCase} onChange={v => setOptions(o => ({ ...o, ignoreCase: v }))}
            label="Ignorar mayúsculas" />
          <Toggle checked={options.ignoreComments} onChange={v => setOptions(o => ({ ...o, ignoreComments: v }))}
            label="Ignorar comentarios" />
        </div>

        {running && (
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
              <div
                className={clsx('h-full bg-brand-light transition-all', pct === null && 'animate-pulse w-1/3')}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <span className="whitespace-nowrap">
              {progress?.phase === 'definitions' && progress.total ? `Leyendo definiciones ${progress.done}/${progress.total}` : 'Listando objetos…'}
            </span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span className="break-words min-w-0">{error}</span>
          </div>
        )}
      </div>

      {/* Body */}
      {!run ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-slate-500 px-6">
          <GitCompare className="w-10 h-10 text-slate-600" />
          <p className="text-sm">Elige el destino y pulsa <span className="text-slate-300 font-medium">Comparar</span>.</p>
          <p className="text-xs max-w-md">Se comparan las definiciones de los objetos con el mismo nombre en ambas bases y se listan los que solo existen en una.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {stale && (
            <div className="flex-shrink-0 flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5">
              <Info className="w-3.5 h-3.5" />
              Cambiaste el destino o las opciones: este resultado corresponde a la comparación anterior. Pulsa «Volver a comparar».
            </div>
          )}
          {/* Summary + filters */}
          <div className="flex-shrink-0 flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-surface-700/60">
            {STATUS_ORDER.map(s => {
              const n = run.result.summary[s]
              const st = STATUS[s]
              const on = statusFilter === s
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(on ? null : s)}
                  title={st.tip}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-all',
                    on ? 'border-brand-light/60 bg-brand-dark/25' : 'border-surface-600 hover:border-surface-500 bg-surface-800/40',
                    n === 0 && !on && 'opacity-50',
                  )}
                >
                  <span className={clsx('w-2 h-2 rounded-full', st.dot)} />
                  <span className={st.color}>{st.label}</span>
                  <span className="font-semibold text-white">{n}</span>
                </button>
              )
            })}
            <div className="relative ml-auto">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={text} onChange={e => setText(e.target.value)} placeholder="Filtrar por nombre…" className="input-field !py-1.5 !pl-8 !w-56" />
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Object list: one collapsible group per object type */}
            <div className="w-80 flex-shrink-0 border-r border-surface-700/60 flex flex-col min-h-0">
              <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-surface-700/60 text-[11px] text-slate-500">
                <button onClick={toggleAllGroups} disabled={groups.length === 0 || filtering}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-700/50 hover:text-slate-300 disabled:opacity-40"
                  title={allCollapsed ? 'Expandir todos los tipos' : 'Contraer todos los tipos'}>
                  {allCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
                  {allCollapsed ? 'Expandir todo' : 'Contraer todo'}
                </button>
                <span className="ml-auto pr-1">{visible.length} objeto(s)</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {groups.length === 0 && (
                  <p className="text-xs text-slate-500 p-4">
                    {items.length === 0 ? 'No hay objetos de los tipos elegidos en ninguna de las dos bases.' : 'Ningún objeto coincide con el filtro.'}
                  </p>
                )}
                {groups.map(g => {
                  const open = isOpen(g.value)
                  const list = g.items.filter(scriptable)
                  const nChecked = list.filter(it => checked.has(itemKey(it))).length
                  return (
                    <div key={g.value}>
                      <div className="sticky top-0 z-10 flex items-center gap-1 pl-1 pr-3 py-1 bg-surface-900/95 border-b border-surface-700/60">
                        <button
                          onClick={() => toggleGroup(g.value)}
                          aria-expanded={open}
                          className="flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200 hover:bg-surface-700/40"
                        >
                          {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                          <g.icon className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{g.label}</span>
                          <span className="ml-auto text-slate-600">{g.items.length}</span>
                        </button>
                        {list.length > 0 && (
                          <input
                            type="checkbox"
                            className="accent-sky-500 flex-shrink-0"
                            checked={nChecked === list.length}
                            ref={el => { if (el) el.indeterminate = nChecked > 0 && nChecked < list.length }}
                            onChange={() => toggleGroupChecked(g)}
                            title="Incluir/quitar este grupo del script"
                          />
                        )}
                      </div>
                      {open && g.items.map(it => {
                        const st = STATUS[it.status]
                        const sel = selected && itemKey(selected) === itemKey(it)
                        return (
                          <div
                            key={itemKey(it)}
                            className={clsx(
                              'flex items-center border-l-2 transition-colors',
                              sel ? 'bg-brand-dark/25 border-brand-light' : 'border-transparent hover:bg-surface-700/40',
                            )}
                          >
                            <button
                              onClick={() => openItem(it)}
                              title={`${displayName(it)} — ${st.tip}`}
                              className={clsx('flex-1 min-w-0 flex items-center gap-2 pl-7 pr-2 py-1.5 text-left text-xs', sel ? 'text-white' : 'text-slate-300')}
                            >
                              <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', st.dot)} />
                              <span className="truncate">{displayName(it)}</span>
                            </button>
                            {scriptable(it) ? (
                              <input
                                type="checkbox"
                                className="accent-sky-500 mr-3 flex-shrink-0"
                                checked={checked.has(itemKey(it))}
                                onChange={() => toggleChecked(it)}
                                title="Incluir en el script de sincronización"
                              />
                            ) : <span className="w-3 mr-3 flex-shrink-0" />}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              <div className="flex-shrink-0 border-t border-surface-700/60 p-2 flex flex-col gap-1.5">
                <button
                  onClick={() => setScriptOpen(true)}
                  disabled={selectedItems.length === 0}
                  className="btn-primary justify-center !py-1.5 !text-xs"
                  title="Genera un script que modifica el destino para que quede como el origen"
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  Generar script ({selectedItems.length})
                </button>
                <button onClick={exportReport} className="btn-secondary justify-center !py-1.5 !text-xs">
                  <FileText className="w-3.5 h-3.5" />
                  Exportar reporte
                </button>
                {reportMsg && <p className="text-[11px] text-slate-400 break-words">{reportMsg}</p>}
              </div>
            </div>

            {/* Detail */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {!selected ? (
                <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Selecciona un objeto para ver sus diferencias.</div>
              ) : (
                <DiffView
                  item={selected}
                  diff={diff}
                  changes={changes}
                  loading={diffLoading}
                  error={diffError}
                  onlyDiff={onlyDiff}
                  setOnlyDiff={setOnlyDiff}
                  sourceLabel={connInfo.dbName}
                  targetLabel={run.targetLabel}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {scriptOpen && run && (
        <SyncScriptModal
          srcWs={workspaceId}
          dstWs={run.targetId}
          targetLabel={run.targetLabel}
          items={selectedItems}
          onClose={() => setScriptOpen(false)}
        />
      )}
    </div>
  )
}

// Collapses long runs of equal rows, keeping CONTEXT rows around every change.
function collapse(rows) {
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, i) => {
    if (r.kind === 'eq') return
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) keep[k] = true
  })
  const out = []
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) { out.push(rows[i]); continue }
    let j = i
    while (j < rows.length && !keep[j]) j++
    out.push({ kind: 'gap', count: j - i })
    i = j - 1
  }
  return out
}

function DiffView({ item, diff, changes, loading, error, onlyDiff, setOnlyDiff, sourceLabel, targetLabel }) {
  const st = STATUS[item.status]
  const one = item.status === 'onlySource' || item.status === 'onlyTarget'
  const rows = useMemo(() => {
    if (!diff) return []
    return onlyDiff && !diff.same ? collapse(diff.rows) : diff.rows
  }, [diff, onlyDiff])

  return (
    <>
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-surface-700/60">
        <span className={clsx('w-2 h-2 rounded-full', st.dot)} />
        <span className="text-sm font-semibold text-white truncate">{displayName(item)}</span>
        <span className={clsx('text-xs', st.color)}>{st.label}</span>
        {diff && !diff.same && (
          <span className="text-xs text-slate-400 flex items-center gap-2">
            {diff.changed > 0 && <span className="text-amber-300">~{diff.changed}</span>}
            {diff.added > 0 && <span className="text-emerald-300">+{diff.added}</span>}
            {diff.removed > 0 && <span className="text-red-300">−{diff.removed}</span>}
          </span>
        )}
        {diff && !diff.same && (
          <button onClick={() => setOnlyDiff(!onlyDiff)} className="ml-auto btn-secondary !py-1 !px-2.5 !text-xs">
            {onlyDiff ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {onlyDiff ? 'Ver completo' : 'Solo diferencias'}
          </button>
        )}
      </div>

      {one ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500 px-6 text-center">
          {item.status === 'onlySource'
            ? 'Este objeto existe en el origen pero no en el destino.'
            : 'Este objeto existe en el destino pero no en el origen.'}
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <div className="m-4 flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span className="break-words min-w-0">{error}</span>
        </div>
      ) : changes ? (
        <TableChangesView changes={changes} sourceLabel={sourceLabel} targetLabel={targetLabel} />
      ) : diff ? (
        <div className="flex-1 min-h-0 flex font-mono text-[12px] leading-5">
          {[['a', 'Origen', sourceLabel], ['b', 'Destino', targetLabel]].map(([side, title, label]) => (
            <div key={side} className={clsx('flex-1 min-w-0 overflow-auto', side === 'a' && 'border-r border-surface-700/60')}>
              <div className="w-max min-w-full">
                <div className="sticky top-0 z-10 px-3 py-1 bg-surface-900 border-b border-surface-700/60 text-[10px] uppercase tracking-widest text-slate-500 font-sans">{title} · {label}</div>
                {diff.same && side === 'a' && (
                  <div className="px-4 py-2 text-xs text-emerald-300 font-sans">Sin diferencias con las opciones actuales.</div>
                )}
                {rows.map((r, i) => (r.kind === 'gap' ? (
                  <div key={i} className="px-3 py-0.5 text-center text-[11px] text-slate-500 bg-surface-800/60 font-sans">
                    ⋯ {r.count} línea(s) iguales ⋯
                  </div>
                ) : (
                  <Row key={i} r={r} side={side} />
                )))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

const TONES = {
  del: 'bg-red-500/15',
  add: 'bg-emerald-500/15',
  chg: 'bg-amber-500/15',
  empty: 'bg-surface-800/50',
  '': '',
}

function Row({ r, side }) {
  if (side === 'a') {
    const tone = r.kind === 'eq' ? '' : r.kind === 'add' ? 'empty' : r.kind === 'del' ? 'del' : 'chg'
    return <Cell num={r.aLine} text={r.a} tone={tone} />
  }
  const tone = r.kind === 'eq' ? '' : r.kind === 'del' ? 'empty' : r.kind === 'add' ? 'add' : 'chg'
  return <Cell num={r.bLine} text={r.b} tone={tone} />
}

function Cell({ num, text, tone }) {
  return (
    <div className={clsx('flex min-h-5', TONES[tone])}>
      <span className="w-10 flex-shrink-0 text-right pr-2 text-slate-600 select-none">{num || ''}</span>
      <span className="whitespace-pre pr-3 text-slate-200">{text}</span>
    </div>
  )
}

const AREAS = [
  { value: 'column', label: 'Columnas' },
  { value: 'primaryKey', label: 'Llave primaria' },
  { value: 'index', label: 'Índices' },
  { value: 'foreignKey', label: 'Llaves foráneas' },
]
const CHANGE_TONE = {
  different: { dot: 'bg-amber-400', row: 'bg-amber-500/10' },
  onlySource: { dot: 'bg-sky-400', row: 'bg-sky-500/10' },
  onlyTarget: { dot: 'bg-violet-400', row: 'bg-violet-500/10' },
}

function TableChangesView({ changes, sourceLabel, targetLabel }) {
  if (changes.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-sm text-emerald-300">Sin diferencias en la estructura de la tabla.</div>
  }
  return (
    <div className="flex-1 overflow-auto text-xs">
      <div className="grid sticky top-0 z-10 bg-surface-900 border-b border-surface-700/60 text-[10px] uppercase tracking-widest text-slate-500"
        style={{ gridTemplateColumns: 'minmax(160px, 1fr) 2fr 2fr' }}>
        <div className="px-3 py-1">Elemento</div>
        <div className="px-3 py-1 border-l border-surface-700/60">Origen · {sourceLabel}</div>
        <div className="px-3 py-1 border-l border-surface-700/60">Destino · {targetLabel}</div>
      </div>
      {AREAS.map(a => {
        const list = changes.filter(c => c.area === a.value)
        if (list.length === 0) return null
        return (
          <div key={a.value}>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 bg-surface-800/60 border-b border-surface-700/60">
              {a.label} <span className="text-slate-600">({list.length})</span>
            </div>
            {list.map((c, i) => {
              const tone = CHANGE_TONE[c.status] || CHANGE_TONE.different
              return (
                <div key={i} className={clsx('grid border-b border-surface-700/40', tone.row)} style={{ gridTemplateColumns: 'minmax(160px, 1fr) 2fr 2fr' }}>
                  <div className="px-3 py-1.5 flex items-center gap-2 min-w-0">
                    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', tone.dot)} />
                    <span className="truncate text-slate-100 font-medium" title={c.name}>{c.name}</span>
                  </div>
                  <div className="px-3 py-1.5 border-l border-surface-700/40 font-mono text-slate-200 break-words">
                    {c.source || <span className="text-slate-600 font-sans italic">no existe</span>}
                  </div>
                  <div className="px-3 py-1.5 border-l border-surface-700/40 font-mono text-slate-200 break-words">
                    {c.target || <span className="text-slate-600 font-sans italic">no existe</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// Markdown summary of a comparison, for sharing or attaching to a ticket.
function buildReport(sourceName, run) {
  const { summary, items } = run.result
  const nl = String.fromCharCode(10)
  const out = [
    '# Comparación de bases de datos',
    '',
    `- **Origen:** ${sourceName}`,
    `- **Destino:** ${run.targetLabel}`,
    '',
    '| Estado | Cantidad |',
    '|---|---|',
    ...STATUS_ORDER.map(s => `| ${STATUS[s].label} | ${summary[s]} |`),
  ]
  STATUS_ORDER.filter(s => s !== 'same').forEach(s => {
    const list = items.filter(i => i.status === s)
    if (list.length === 0) return
    out.push('', `## ${STATUS[s].label} (${list.length})`)
    TYPES.forEach(t => {
      const ofType = list.filter(i => i.type === t.value)
      if (ofType.length === 0) return
      out.push('', `**${t.label}**`, '')
      ofType.forEach(i => out.push(`- ${displayName(i)}`))
    })
  })
  return out.join(nl) + nl
}

function SyncScriptModal({ srcWs, dstWs, targetLabel, items, onClose }) {
  const [includeDrops, setIncludeDrops] = useState(false)
  const [script, setScript] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const api = await go()
        const text = await api.GenerateSyncScript(srcWs, dstWs, {
          items: items.map(i => ({ type: i.type, schema: i.schema, parentName: i.parentName || '', name: i.name, status: i.status })),
          options: { includeDrops },
        })
        if (!cancelled) setScript(text)
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcWs, dstWs, includeDrops])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  const save = async () => {
    try {
      const api = await go()
      const path = await api.SaveScript('sincronizacion.sql', script)
      if (path) setSaved(path)
    } catch (e) {
      setError(String(e?.message || e))
    }
  }
  const drops = items.filter(i => i.status === 'onlyTarget').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-full flex flex-col rounded-xl border border-surface-600 bg-surface-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700/60">
          <FileCode2 className="w-4 h-4 text-brand-light" />
          <h3 className="text-sm font-semibold text-white">Script de sincronización</h3>
          <span className="text-xs text-slate-500">{items.length} objeto(s)</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-start gap-2 mx-4 mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Este script modifica el <b>destino</b> ({targetLabel}) para que quede como el origen. No se ejecuta aquí: revísalo y córrelo tú contra el destino.</span>
        </div>
        <div className="flex items-center gap-4 px-4 py-2 flex-wrap">
          <Toggle checked={includeDrops} onChange={setIncludeDrops} label="Incluir DROP"
            hint="Activa los borrados (objetos, columnas, índices y llaves que solo existen en el destino). Apagado, salen comentados." />
          {drops > 0 && !includeDrops && <span className="text-[11px] text-slate-500">{drops} objeto(s) solo en destino saldrán comentados.</span>}
        </div>
        <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col">
          {error && <div className="mb-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 break-words">{error}</div>}
          {loading ? (
            <div className="flex-1 flex items-center justify-center py-16 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <textarea
              readOnly
              value={script}
              spellCheck={false}
              style={{ background: 'rgba(10,15,25,0.9)' }}
              className="flex-1 min-h-[320px] w-full resize-none rounded-lg border border-surface-600 p-3 font-mono text-[12px] leading-5 text-slate-200 outline-none whitespace-pre"
            />
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-surface-700/60">
          {saved && <span className="text-[11px] text-slate-400 truncate">Guardado en {saved}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={copy} disabled={loading || !script} className="btn-secondary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copiado' : 'Copiar'}
            </button>
            <button onClick={save} disabled={loading || !script} className="btn-primary"><Save className="w-4 h-4" />Guardar .sql</button>
          </div>
        </div>
      </div>
    </div>
  )
}
