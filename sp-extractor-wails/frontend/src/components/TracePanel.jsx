import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Play, Square, Pause, Eraser, Search, Loader2, AlertCircle, ShieldAlert, Copy, Check,
  Terminal, ArrowDownToLine, Trash2, Bug, Filter, RotateCw, ChevronDown, ChevronUp,
  Database, User, Monitor, Hash, AppWindow, X, Lock, Info,
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

// Server-side filters (like the filters of SSMS's Profiler). They are remembered per database.
const DEFAULT_FILTERS = { loginMode: 'me', loginOther: '', host: '', pid: '', app: '' }

function loadFilters(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    if (saved && typeof saved === 'object') return { ...DEFAULT_FILTERS, ...saved }
  } catch { /* storage unavailable or corrupt: use the defaults */ }
  return { ...DEFAULT_FILTERS }
}

// Human-readable list of the filters a set of start options applies.
function describeOptions(o, dbName) {
  const parts = [`base: ${dbName}`]
  if (o.login) parts.push(`usuario: ${o.login}`)
  if (o.host) parts.push(`host: ${o.host}`)
  if (o.hostPid) parts.push(`PID: ${o.hostPid}`)
  if (o.app) parts.push(`aplicación: ${o.app}`)
  if (o.minDurationMs) parts.push(`≥ ${o.minDurationMs} ms`)
  if (o.includeOwn) parts.push('incluye esta app')
  return parts
}

// One filter of the panel: a titled card that lights up while it has a value.
function FilterCard({ icon: Icon, label, hint, active, wide, children }) {
  return (
    <div
      title={hint}
      className={clsx(
        'rounded-xl border px-3 py-2.5 flex flex-col gap-1.5 transition-colors',
        wide ? 'md:col-span-2' : '',
        active ? 'border-sky-500/50 bg-sky-500/[0.06] shadow-[0_0_0_1px_rgba(14,165,233,0.12)]' : 'border-surface-600 bg-surface-800/40',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold">
        <Icon className={clsx('w-3.5 h-3.5', active ? 'text-sky-300' : 'text-slate-500')} />
        <span className={active ? 'text-sky-200' : 'text-slate-500'}>{label}</span>
        {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-400" />}
      </div>
      {children}
    </div>
  )
}

// Text input with a clear button.
function FilterInput({ value, onChange, placeholder, numeric }) {
  return (
    <div className="relative">
      <input
        className="input-field py-1.5 pr-7 text-xs w-full font-mono"
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {value && (
        <button onClick={() => onChange('')} title="Borrar"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-white hover:bg-surface-600">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

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
  const filtersKey = `spx_trace_filters:${connInfo.dbType}|${connInfo.host}|${connInfo.dbName}`
  const [filters, setFilters] = useState(() => loadFilters(filtersKey))
  const [showFilters, setShowFilters] = useState(true)
  const [applied, setApplied] = useState(null) // options the running trace was started with
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

  useEffect(() => {
    try { localStorage.setItem(filtersKey, JSON.stringify(filters)) } catch { /* not critical */ }
  }, [filtersKey, filters])

  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }))

  // What the server should filter on, from the form.
  const buildOptions = () => {
    const pid = Number.parseInt(filters.pid, 10)
    return {
      minDurationMs: minDuration,
      includeOwn,
      login: filters.loginMode === 'me' ? (connInfo.user || '') : filters.loginMode === 'other' ? filters.loginOther.trim() : '',
      host: filters.host.trim(),
      hostPid: pid > 0 ? pid : 0,
      app: filters.app.trim(),
    }
  }
  const currentOptions = buildOptions()
  const dirty = running && applied !== null && JSON.stringify(applied) !== JSON.stringify(currentOptions)
  const activeFilters = [currentOptions.login, currentOptions.host, currentOptions.hostPid, currentOptions.app].filter(Boolean).length

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
      const opts = buildOptions()
      await (await go()).StartTrace(workspaceId, opts)
      setApplied(opts)
      setRunning(true)
      setPaused(false)
    } catch (e) {
      setError(e.toString())
    } finally {
      setStarting(false)
    }
  }

  // The filters live in the server-side session, so changing them means a new
  // session; what was already captured stays on screen.
  const restart = async () => {
    setError('')
    setStarting(true)
    try {
      const api = await go()
      await api.StopTrace(workspaceId)
      const opts = buildOptions()
      await api.StartTrace(workspaceId, opts)
      setApplied(opts)
      setRunning(true)
    } catch (e) {
      setRunning(false)
      setApplied(null)
      setError(e.toString())
    } finally {
      setStarting(false)
    }
  }

  // "Only this user / host / PID" from a captured event.
  const filterBy = (kind, ev) => {
    if (kind === 'login') setFilter({ loginMode: 'other', loginOther: ev.login || '' })
    if (kind === 'host') setFilter({ host: ev.host || '' })
    if (kind === 'pid') setFilter({ pid: ev.hostPid ? String(ev.hostPid) : '' })
    setShowFilters(true)
  }

  const stop = async () => {
    try { await (await go()).StopTrace(workspaceId) } catch (e) { setError(e.toString()) }
    setApplied(null)
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
               title="Se aplica en el servidor; si la traza está en marcha, pulsa Aplicar para reiniciarla con el cambio">
          Duración
          <select value={minDuration} onChange={e => setMinDuration(Number(e.target.value))}
                  className="rounded-md px-1.5 py-1 text-xs bg-surface-800 border border-surface-600 text-slate-300 outline-none">
            {MIN_DURATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none"
               title="Incluye las consultas ejecutadas desde la pestaña Consultas de esta app">
          <input type="checkbox" checked={includeOwn} onChange={e => setIncludeOwn(e.target.checked)} />
          Incluir esta app
        </label>

        <button onClick={() => setShowFilters(v => !v)} className="btn-secondary text-xs py-1.5 px-3"
                title="Filtros de la traza: usuario, host, PID del cliente y aplicación">
          <Filter className="w-3.5 h-3.5" />
          Filtros
          {activeFilters > 0 && <span className="px-1.5 rounded-full text-[10px] bg-sky-400/20 text-sky-300 font-mono font-bold">{activeFilters}</span>}
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {dirty && (
          <button onClick={restart} disabled={starting} className="btn-primary text-xs py-1.5 px-3"
                  title="Los filtros se aplican en el servidor: reinicia la traza (lo ya capturado se conserva)">
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Aplicar filtros
          </button>
        )}

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

      {showFilters && (
        <div className="flex-shrink-0 rounded-2xl border border-surface-600 p-3 flex flex-col gap-3"
             style={{ background: 'linear-gradient(180deg, rgba(17,27,44,0.65), rgba(24,25,26,0.9))' }}>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-dark/40 border border-brand-dark/50"><Filter className="w-3.5 h-3.5 text-brand-light" /></div>
            <h3 className="text-xs font-semibold text-white">Filtros de la traza</h3>
            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-medium border',
              activeFilters > 0 ? 'bg-sky-500/15 border-sky-500/40 text-sky-300' : 'bg-surface-800 border-surface-600 text-slate-500')}>
              {activeFilters > 0 ? `${activeFilters} activo${activeFilters > 1 ? 's' : ''}` : 'sin filtros'}
            </span>
            <div className="flex-1" />
            {activeFilters > 0 && (
              <button onClick={() => setFilters({ ...DEFAULT_FILTERS, loginMode: 'all' })}
                      className="btn-secondary text-[11px] py-1 px-2" title="Quita todos los filtros, incluido el de usuario">
                <X className="w-3 h-3" /> Quitar filtros
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            <FilterCard icon={Database} label="Base de datos" hint="La traza siempre se limita a la base conectada" active={false}>
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-900/70 border border-surface-600 text-xs font-mono text-slate-200">
                <span className="truncate">{connInfo.dbName}</span>
                <Lock className="w-3 h-3 ml-auto flex-shrink-0 text-slate-600" />
              </div>
            </FilterCard>

            <FilterCard icon={User} label="Usuario (login)" active={currentOptions.login !== ''}
                        hint="Inicio de sesión que ejecuta las consultas. Por defecto, el usuario con el que te conectaste.">
              <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg bg-surface-900/70 border border-surface-600">
                {[['me', 'Mi usuario'], ['all', 'Todos'], ['other', 'Otro']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setFilter({ loginMode: mode })}
                          className={clsx('py-1 rounded-md text-[11px] font-medium transition-all',
                            filters.loginMode === mode ? 'bg-brand-dark/70 text-white shadow' : 'text-slate-400 hover:text-slate-200')}>
                    {label}
                  </button>
                ))}
              </div>
              {filters.loginMode === 'other' ? (
                <FilterInput value={filters.loginOther} onChange={v => setFilter({ loginOther: v })} placeholder="DOMINIO\usuario" />
              ) : (
                <p className="text-[11px] text-slate-500 truncate">
                  {filters.loginMode === 'me' ? <>Solo <span className="font-mono text-slate-300">{connInfo.user || '—'}</span></> : 'Cualquier usuario'}
                </p>
              )}
            </FilterCard>

            <FilterCard icon={Monitor} label="Host (equipo)" active={filters.host.trim() !== ''}
                        hint="Nombre del equipo desde el que se conecta la aplicación. Coincide si lo contiene.">
              <FilterInput value={filters.host} onChange={v => setFilter({ host: v })} placeholder="cualquier equipo" />
            </FilterCard>

            <FilterCard icon={Hash} label="PID del cliente" active={currentOptions.hostPid > 0}
                        hint="Identificador (PID) del proceso del programa cliente en su equipo; se ve en el Administrador de tareas. Sirve para aislar una instancia concreta.">
              <FilterInput numeric value={filters.pid} onChange={v => setFilter({ pid: v.replace(/\D/g, '').slice(0, 10) })} placeholder="cualquier proceso" />
            </FilterCard>

            <FilterCard icon={AppWindow} label="Aplicación" active={filters.app.trim() !== ''} wide
                        hint="Nombre de la aplicación cliente (por ejemplo, el que define la cadena de conexión). Coincide si lo contiene.">
              <FilterInput value={filters.app} onChange={v => setFilter({ app: v })} placeholder="cualquier aplicación" />
            </FilterCard>

            <div className="md:col-span-2 flex items-start gap-2 rounded-xl border border-dashed border-surface-600 px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-500" />
              <span>
                Los filtros se aplican en el servidor: solo se captura lo que coincide.
                {running ? ' Si cambias alguno con la traza en marcha, pulsa «Aplicar filtros» para reiniciarla (lo ya capturado se conserva).' : ' Se recuerdan para esta base de datos.'}
                {filters.loginMode === 'me' && ' Para ver también la actividad de otros usuarios elige «Todos».'}
              </span>
            </div>
          </div>
        </div>
      )}

      {running && applied && (
        <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 text-[11px]">
          <span className="text-slate-500">Filtros en el servidor:</span>
          {describeOptions(applied, connInfo.dbName).map(part => (
            <span key={part} className="px-1.5 py-0.5 rounded border border-surface-600 bg-surface-800/60 text-slate-300 font-mono">{part}</span>
          ))}
        </div>
      )}

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
              {['Hora', 'Tipo', 'Duración', 'CPU', 'Lecturas', 'Escrit.', 'Filas', 'SPID', 'Login', 'Host', 'PID', 'Aplicación', 'Consulta'].map(h => (
                <th key={h} className="px-2.5 py-1.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-center py-12 text-slate-500">
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
                  <td className="px-2.5 py-1 whitespace-nowrap max-w-[120px] truncate text-slate-400" title={e.host}>{e.host}</td>
                  <td className="px-2.5 py-1 font-mono text-right text-slate-500">{e.hostPid || ''}</td>
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
            <span>· {selected.login || '—'}@{selected.host || '—'}{selected.hostPid ? ` (PID ${selected.hostPid})` : ''} · SPID {selected.sessionId}</span>
            {selected.login && (
              <button onClick={() => filterBy('login', selected)} className="text-sky-300 hover:underline" title="Capturar solo este usuario">solo este usuario</button>
            )}
            {selected.host && (
              <button onClick={() => filterBy('host', selected)} className="text-sky-300 hover:underline" title="Capturar solo este equipo">solo este host</button>
            )}
            {selected.hostPid > 0 && (
              <button onClick={() => filterBy('pid', selected)} className="text-sky-300 hover:underline" title="Capturar solo este proceso cliente">solo este PID</button>
            )}
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
