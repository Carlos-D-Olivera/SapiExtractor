import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Play, Square, Pause, Eraser, Search, Loader2, AlertCircle, ShieldAlert, Copy, Check,
  Terminal, ArrowDownToLine, Trash2, Bug,
} from 'lucide-react'
import clsx from 'clsx'

const go = () => import('../../wailsjs/go/main/App')

const MAX_EVENTS = 3000 // oldest events are discarded beyond this

const KIND_LABEL = { batch: 'Lote', rpc: 'RPC', error: 'Error' }
const KIND_STYLE = {
  batch: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  rpc: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
}

const MIN_DURATIONS = [
  { value: 0, label: 'Todas' },
  { value: 10, label: '≥ 10 ms' },
  { value: 100, label: '≥ 100 ms' },
  { value: 500, label: '≥ 500 ms' },
  { value: 1000, label: '≥ 1 s' },
  { value: 5000, label: '≥ 5 s' },
]

function fmtDuration(us) {
  if (!us) return '—'
  const ms = us / 1000
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 10) return `${Math.round(ms)} ms`
  return `${ms.toFixed(1)} ms`
}

function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

const oneLine = (s) => (s || '').replace(/\s+/g, ' ').trim()

// RPC calls made by drivers to run prepared statements or cursors are not user procedures.
const DRIVER_PROCS = new Set([
  'sp_executesql', 'sp_prepare', 'sp_execute', 'sp_prepexec', 'sp_prepexecrpc', 'sp_unprepare', 'sp_reset_connection',
  'sp_describe_first_result_set', 'sp_describe_undeclared_parameters',
])
const BATCH_EXEC = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*exec(?:ute)?\s+[[\w@]/i

// True when the captured event is a call to a stored procedure that can be sent to the debugger.
function isProcCall(e) {
  if (e.kind === 'rpc' && e.object) {
    const n = e.object.toLowerCase()
    return !DRIVER_PROCS.has(n) && !n.startsWith('sp_cursor')
  }
  return e.kind === 'batch' && BATCH_EXEC.test(e.text || '')
}

export default function TracePanel({ workspaceId, connInfo, active, onOpenInQuery, onDebugProc }) {
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [events, setEvents] = useState([])
  const [selectedSeq, setSelectedSeq] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Options applied when the trace starts (they become server-side filters).
  const [minDuration, setMinDuration] = useState(0)
  const [includeOwn, setIncludeOwn] = useState(false)
  // Display filters (instant).
  const [text, setText] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)

  const pausedRef = useRef(false)
  const pendingRef = useRef([])
  const scrollRef = useRef(null)
  pausedRef.current = paused

  const append = useCallback((incoming) => {
    setEvents(prev => {
      const next = prev.concat(incoming)
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    })
  }, [])

  // Live events from the backend poller.
  useEffect(() => {
    const offs = []
    let cancelled = false
    ;(async () => {
      const { EventsOn } = await import('../../wailsjs/runtime/runtime')
      if (cancelled) return
      offs.push(EventsOn('trace:events', data => {
        if (data.workspaceId !== workspaceId || !data.events?.length) return
        if (pausedRef.current) pendingRef.current.push(...data.events)
        else append(data.events)
      }))
      offs.push(EventsOn('trace:error', data => {
        if (data.workspaceId === workspaceId) setError(data.error)
      }))
      offs.push(EventsOn('trace:stopped', async data => {
        if (data.workspaceId !== workspaceId) return
        setRunning(false)
        setError(data.reason || 'La traza se detuvo.')
        try { (await go()).StopTrace(workspaceId) } catch { /* already gone */ }
      }))
    })()
    return () => { cancelled = true; offs.forEach(off => off?.()) }
  }, [workspaceId, append])

  // A trace may already be running (e.g. component remounted).
  useEffect(() => {
    ;(async () => {
      try { setRunning(await (await go()).TraceStatus(workspaceId)) } catch { /* ignore */ }
    })()
  }, [workspaceId])

  // Keep the newest event in view.
  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [events, autoScroll])

  const start = async () => {
    setError('')
    setNotice('')
    setStarting(true)
    try {
      await (await go()).StartTrace(workspaceId, { minDurationMs: minDuration, includeOwn })
      setRunning(true)
      setPaused(false)
    } catch (e) {
      setError(e.toString())
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    try { await (await go()).StopTrace(workspaceId) } catch (e) { setError(e.toString()) }
    setRunning(false)
    setPaused(false)
    if (pendingRef.current.length) { append(pendingRef.current); pendingRef.current = [] }
  }

  const togglePause = () => {
    if (paused && pendingRef.current.length) {
      append(pendingRef.current)
      pendingRef.current = []
    }
    setPaused(p => !p)
  }

  const clear = () => {
    setEvents([])
    pendingRef.current = []
    setSelectedSeq(null)
  }

  const cleanup = async () => {
    if (!window.confirm('Se eliminarán del servidor TODAS las sesiones de traza creadas por esta herramienta (spx_trace_*), incluidas las de otros usuarios que la estén usando ahora. ¿Continuar?')) return
    try {
      const n = await (await go()).CleanupTraceSessions(workspaceId)
      setRunning(false)
      setError('')
      setNotice(n === 0 ? 'No había sesiones abandonadas.' : `Se eliminaron ${n} sesión(es) de traza del servidor.`)
    } catch (e) {
      setError(e.toString())
    }
  }

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    return events.filter(e => {
      if (onlyErrors && e.kind !== 'error' && (e.result === 'OK' || e.result === '')) return false
      if (!q) return true
      return [e.text, e.object, e.login, e.host, e.app, e.database].some(v => v && v.toLowerCase().includes(q))
    })
  }, [events, text, onlyErrors])

  const selected = useMemo(() => events.find(e => e.seq === selectedSeq) || null, [events, selectedSeq])

  const debugSelected = async () => {
    if (!selected || !onDebugProc) return
    setError('')
    try {
      await onDebugProc(selected)
    } catch (e) {
      setError(e.toString())
    }
  }

  const copySelected = async () => {
    if (!selected) return
    try { await navigator.clipboard.writeText(selected.text) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
      {/* Privacy notice */}
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex-shrink-0">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-px" />
        <span>
          La traza muestra las consultas que ejecutan <b>todos los usuarios</b> de la base <b>{connInfo.dbName}</b>, incluidos sus parámetros,
          que pueden contener datos personales. Se crea una sesión temporal de Extended Events en el servidor; se elimina al detener la traza o al desconectar.
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        {!running ? (
          <button onClick={start} disabled={starting} className="btn-primary text-xs py-1.5 px-3">
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Iniciar traza
          </button>
        ) : (
          <>
            <button onClick={stop} className="btn-danger text-xs py-1.5 px-3">
              <Square className="w-3.5 h-3.5" />
              Detener
            </button>
            <button onClick={togglePause} className="btn-secondary text-xs py-1.5 px-3"
                    title="Congela la tabla; los eventos se siguen capturando y aparecen al reanudar">
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? `Reanudar (${pendingRef.current.length})` : 'Pausar'}
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Capturando
            </span>
          </>
        )}
        <button onClick={clear} className="btn-secondary text-xs py-1.5 px-3">
          <Eraser className="w-3.5 h-3.5" />
          Limpiar
        </button>

        <div className="w-px h-5 bg-surface-600 mx-1" />

        <label className="flex items-center gap-1.5 text-[11px] text-slate-500"
               title="Se aplica en el servidor al iniciar la traza">
          Duración
          <select value={minDuration} onChange={e => setMinDuration(Number(e.target.value))} disabled={running}
                  className="rounded-md px-1.5 py-1 text-xs bg-surface-800 border border-surface-600 text-slate-300 outline-none disabled:opacity-50">
            {MIN_DURATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none"
               title="Incluye las consultas ejecutadas desde la pestaña Consultas de esta app">
          <input type="checkbox" checked={includeOwn} disabled={running} onChange={e => setIncludeOwn(e.target.checked)} />
          Incluir esta app
        </label>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input className="input-field pl-7 py-1 text-xs w-56" placeholder="Filtrar texto, login, host…"
                 value={text} onChange={e => setText(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
          <input type="checkbox" checked={onlyErrors} onChange={e => setOnlyErrors(e.target.checked)} />
          Solo errores
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          <ArrowDownToLine className="w-3.5 h-3.5" />
        </label>
        <button onClick={cleanup} className="btn-secondary text-xs py-1.5 px-2.5"
                title="Elimina del servidor las sesiones de traza abandonadas (spx_trace_*)">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-slate-500 whitespace-nowrap">{filtered.length} / {events.length}</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex-shrink-0">{notice}</div>
      )}

      {/* Events table */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: '#111B2C' }} className="text-slate-400 text-left">
              {['Hora', 'Tipo', 'Duración', 'CPU', 'Lecturas', 'Escrit.', 'Filas', 'SPID', 'Login', 'Aplicación', 'Consulta'].map(h => (
                <th key={h} className="px-2.5 py-1.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-slate-500">
                  {running
                    ? 'Esperando actividad en la base de datos…'
                    : 'Pulsa "Iniciar traza" para capturar las consultas que se ejecutan en esta base de datos.'}
                </td>
              </tr>
            ) : filtered.map(e => {
              const failed = e.kind === 'error' || (e.result && e.result !== 'OK')
              return (
                <tr key={e.seq} onClick={() => setSelectedSeq(e.seq)}
                    className={clsx('cursor-pointer border-t border-surface-700/40 hover:bg-surface-700/30',
                      e.seq === selectedSeq && 'bg-brand-dark/25', failed && 'text-red-300')}>
                  <td className="px-2.5 py-1 font-mono whitespace-nowrap text-slate-400">{fmtTime(e.time)}</td>
                  <td className="px-2.5 py-1">
                    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px]', KIND_STYLE[e.kind])}>{KIND_LABEL[e.kind] || e.kind}</span>
                  </td>
                  <td className="px-2.5 py-1 font-mono text-right whitespace-nowrap">{e.kind === 'error' ? '—' : fmtDuration(e.durationUs)}</td>
                  <td className="px-2.5 py-1 font-mono text-right whitespace-nowrap">{e.kind === 'error' ? '—' : fmtDuration(e.cpuUs)}</td>
                  <td className="px-2.5 py-1 font-mono text-right">{e.kind === 'error' ? '—' : e.reads.toLocaleString()}</td>
                  <td className="px-2.5 py-1 font-mono text-right">{e.kind === 'error' ? '—' : e.writes.toLocaleString()}</td>
                  <td className="px-2.5 py-1 font-mono text-right">{e.kind === 'error' ? '—' : e.rows.toLocaleString()}</td>
                  <td className="px-2.5 py-1 font-mono text-right text-slate-500">{e.sessionId || ''}</td>
                  <td className="px-2.5 py-1 whitespace-nowrap max-w-[140px] truncate" title={e.login}>{e.login}</td>
                  <td className="px-2.5 py-1 whitespace-nowrap max-w-[140px] truncate text-slate-400" title={e.app}>{e.app}</td>
                  <td className="px-2.5 py-1 font-mono max-w-[480px] truncate" title={oneLine(e.text)}>
                    {e.kind === 'error' ? `#${e.errorNumber} ${e.object} — ` : e.object ? `${e.object} · ` : ''}{oneLine(e.text)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail */}
      {selected && (
        <div className="flex-shrink-0 rounded-xl border border-surface-600 flex flex-col" style={{ background: '#18191A', height: 190 }}>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700/60 text-[11px] text-slate-400 flex-wrap">
            <span className={clsx('px-1.5 py-0.5 rounded border text-[10px]', KIND_STYLE[selected.kind])}>{KIND_LABEL[selected.kind]}</span>
            <span>{fmtTime(selected.time)}</span>
            {selected.kind !== 'error' && <span>· {fmtDuration(selected.durationUs)} · CPU {fmtDuration(selected.cpuUs)} · {selected.reads.toLocaleString()} lecturas</span>}
            {selected.kind === 'error' && <span className="text-red-300">· Error {selected.errorNumber} (sev. {selected.severity}): {selected.object}</span>}
            <span>· {selected.login || '—'}@{selected.host || '—'} · SPID {selected.sessionId}</span>
            <div className="flex-1" />
            {onDebugProc && isProcCall(selected) && (
              <button onClick={debugSelected} className="btn-secondary text-[11px] py-1 px-2"
                      title="Abre el depurador con los parámetros de esta llamada">
                <Bug className="w-3 h-3" />
                Depurar
              </button>
            )}
            <button onClick={copySelected} className="btn-secondary text-[11px] py-1 px-2">
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              Copiar
            </button>
            {onOpenInQuery && (
              <button onClick={() => onOpenInQuery(selected.text, selected.object || 'Traza')} className="btn-primary text-[11px] py-1 px-2">
                <Terminal className="w-3 h-3" />
                Abrir en Consultas
              </button>
            )}
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap text-slate-200" style={{ margin: 0 }}>
            {selected.text || '(sin texto)'}
          </pre>
        </div>
      )}
    </div>
  )
}
