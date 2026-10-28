import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { X, History, Search, Play, Copy, Check, Trash2, FilePlus2, AlertCircle, Loader2, ShieldAlert } from 'lucide-react'
import clsx from 'clsx'

const go = () => import('../../wailsjs/go/main/App')

const PAGE = 200
const RETENTION_OPTIONS = [
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
  { value: 180, label: '180 días' },
  { value: 365, label: '1 año' },
  { value: 0, label: 'Sin límite de tiempo' },
]

const pad = (n) => String(n).padStart(2, '0')
const fmtTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }

function dayLabel(ms) {
  const d = new Date(ms)
  const today = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDuration(ms) {
  if (!ms) return '0 ms'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`
}

/** Short tab title for a query: its first meaningful words. */
export function titleFromSql(sql) {
  const line = (sql || '').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('--')) || 'Consulta'
  const words = line.replace(/\s+/g, ' ')
  return words.length > 28 ? `${words.slice(0, 27)}…` : words
}

export default function QueryHistoryModal({ workspaceId, dbLabel, onClose, onOpen }) {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [term, setTerm] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [copied, setCopied] = useState('')
  const [settings, setSettings] = useState(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const load = useCallback(async () => {
    const req = ++reqRef.current
    setLoading(true)
    try {
      const page = await (await go()).ListHistory(workspaceId, term, onlyErrors, limit)
      if (req !== reqRef.current) return
      setEntries(page?.entries || [])
      setTotal(page?.total || 0)
      setError('')
    } catch (e) {
      if (req === reqRef.current) setError(e.toString())
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [workspaceId, term, onlyErrors, limit])

  // Search while typing, with a short delay.
  useEffect(() => {
    const id = setTimeout(load, term ? 250 : 0)
    return () => clearTimeout(id)
  }, [load, term])

  useEffect(() => {
    ;(async () => {
      try { setSettings(await (await go()).GetPersistenceSettings()) } catch { /* ignore */ }
    })()
  }, [])

  const updateSettings = async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    try { await (await go()).SetPersistenceSettings(next) } catch (e) { setError(e.toString()) }
  }

  const remove = async (id) => {
    try {
      await (await go()).DeleteHistoryEntry(workspaceId, id)
      setEntries(prev => prev.filter(e => e.id !== id))
      setTotal(t => Math.max(0, t - 1))
    } catch (e) { setError(e.toString()) }
  }

  const clearAll = async () => {
    if (!window.confirm(`Se borrará todo el historial de consultas de ${dbLabel}. ¿Continuar?`)) return
    try {
      await (await go()).ClearHistory(workspaceId)
      setEntries([])
      setTotal(0)
    } catch (e) { setError(e.toString()) }
  }

  const copy = async (e) => {
    try { await navigator.clipboard.writeText(e.sql) } catch { /* ignore */ }
    setCopied(e.id)
    setTimeout(() => setCopied(''), 1200)
  }

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Entries grouped under a day heading.
  const groups = useMemo(() => {
    const out = []
    for (const e of entries) {
      const label = dayLabel(e.at)
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] })
      out[out.length - 1].items.push(e)
    }
    return out
  }, [entries])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass rounded-2xl w-[960px] max-w-[95vw] h-[86vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50"><History className="w-4 h-4 text-brand-light" /></div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">Historial de consultas</h2>
              <p className="text-xs text-slate-500 truncate">{dbLabel} · {total.toLocaleString()} ejecución(es)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all"><X className="w-4 h-4" /></button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-700/60 flex-shrink-0 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input autoFocus className="input-field pl-7 py-1 text-xs w-72" placeholder="Buscar en el SQL…"
                   value={term} onChange={e => { setTerm(e.target.value); setLimit(PAGE) }} />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={onlyErrors} onChange={e => { setOnlyErrors(e.target.checked); setLimit(PAGE) }} />
            Solo con error
          </label>
          <div className="flex-1" />
          <button onClick={clearAll} disabled={total === 0 && !term && !onlyErrors} className="btn-secondary text-[11px] py-1 px-2">
            <Trash2 className="w-3 h-3" /> Borrar historial
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 mx-4 mt-3 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* List */}
        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 flex flex-col gap-4">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-12"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-12">
              {settings && !settings.historyEnabled
                ? 'El historial está desactivado: las consultas nuevas no se guardan.'
                : term || onlyErrors ? 'Ninguna consulta coincide con el filtro.' : 'Aún no hay consultas en el historial de esta base de datos.'}
            </p>
          ) : groups.map(g => (
            <div key={g.label}>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5 capitalize">{g.label}</p>
              <div className="flex flex-col gap-1.5">
                {g.items.map(e => {
                  const open = expanded.has(e.id)
                  return (
                    <div key={e.id} className={clsx('rounded-lg border px-3 py-2', e.error ? 'border-red-500/30 bg-red-500/5' : 'border-surface-600 bg-surface-800/40')}>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                        <span className="font-mono text-slate-300">{fmtTime(e.at)}</span>
                        <span className={clsx('px-1.5 rounded border text-[10px]', e.error ? 'border-red-500/40 text-red-300' : 'border-emerald-500/40 text-emerald-300')}>
                          {e.error ? 'Error' : 'OK'}
                        </span>
                        <span>{fmtDuration(e.durationMs)}</span>
                        {!e.error && <span>{e.sets > 0 ? `${e.rows.toLocaleString()} fila(s)` : 'sin resultados'}</span>}
                        {e.truncated && <span className="text-amber-300">SQL recortado</span>}
                        <div className="flex-1" />
                        <button onClick={() => onOpen(e.sql, false)} className="btn-secondary text-[11px] py-0.5 px-2" title="Abrir en una pestaña nueva">
                          <FilePlus2 className="w-3 h-3" /> Abrir
                        </button>
                        <button onClick={() => onOpen(e.sql, true)} className="btn-primary text-[11px] py-0.5 px-2" title="Abrir en una pestaña nueva y ejecutar">
                          <Play className="w-3 h-3" /> Ejecutar
                        </button>
                        <button onClick={() => copy(e)} className="btn-secondary text-[11px] py-0.5 px-2" title="Copiar el SQL">
                          {copied === e.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button onClick={() => remove(e.id)} className="btn-secondary text-[11px] py-0.5 px-2 hover:text-red-400" title="Eliminar del historial">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <pre onClick={() => toggle(e.id)} title={open ? 'Clic para contraer' : 'Clic para ver completo'}
                           className={clsx('mt-1.5 text-xs font-mono text-slate-200 whitespace-pre-wrap break-words cursor-pointer', !open && 'line-clamp-3')}
                           style={{ margin: 0, marginTop: 6 }}>{e.sql}</pre>
                      {e.error && <p className="mt-1 text-[11px] text-red-300 font-mono whitespace-pre-wrap break-words">{e.error}</p>}
                    </div>
                  )
                })}
                </div>
            </div>
          ))}
          {total > entries.length && (
            <button onClick={() => setLimit(l => l + PAGE)} className="btn-secondary text-xs self-center py-1.5 px-3">
              Mostrar más ({total - entries.length} restantes)
            </button>
          )}
        </div>

        {/* Settings */}
        {settings && (
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-surface-700/60 flex-shrink-0 flex-wrap text-[11px] text-slate-400">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-slate-500">Solo se guarda el texto SQL, nunca los resultados.</span>
            <div className="flex-1" />
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={settings.historyEnabled} onChange={e => updateSettings({ historyEnabled: e.target.checked })} />
              Guardar historial
            </label>
            <label className="flex items-center gap-1.5">
              Conservar
              <select value={settings.retentionDays} onChange={e => updateSettings({ retentionDays: Number(e.target.value) })}
                      className="rounded-md px-1.5 py-1 text-xs bg-surface-800 border border-surface-600 text-slate-300 outline-none">
                {RETENTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                {!RETENTION_OPTIONS.some(o => o.value === settings.retentionDays) && (
                  <option value={settings.retentionDays}>{settings.retentionDays} días</option>
                )}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
