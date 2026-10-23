import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ArrowLeft, Play, Ban, Loader2, AlertCircle, ChevronRight, ChevronDown, Bug, Terminal,
  CheckCircle2, XCircle, Undo2, Info, SlidersHorizontal,
} from 'lucide-react'
import clsx from 'clsx'

const go = () => import('../../wailsjs/go/main/App')

const TABS = [
  { id: 'exec', label: 'Ejecución' },
  { id: 'results', label: 'Resultados' },
  { id: 'messages', label: 'Mensajes' },
  { id: 'output', label: 'Retorno y salida' },
]

const BRANCH_STYLE = {
  THEN: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  ELSE: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  SALTADO: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  ENTRA: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  SALE: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
}
const BRANCH_LABEL = {
  THEN: 'entró (THEN)', ELSE: 'entró (ELSE)', SALTADO: 'no entró',
  ENTRA: 'entra al ciclo', SALE: 'sale del ciclo',
}

function fmtUs(us) {
  if (!us) return '0 ms'
  const ms = us / 1000
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 10) return `${Math.round(ms)} ms`
  return `${ms.toFixed(1)} ms`
}

const oneLine = (s) => (s || '').replace(/\s+/g, ' ').trim()

// Applies the arguments of a captured call (named, or positional in declaration order) to the form.
function applyInitial(list, init, initial) {
  const out = { ...init }
  const usable = list.filter(p => !p.unsupported)
  let position = 0
  for (const arg of initial.args || []) {
    let p
    if (arg.name) p = list.find(x => x.name.toLowerCase() === arg.name.toLowerCase())
    else p = usable[position++]
    if (!p || p.unsupported) continue
    out[p.name] = { value: arg.value || '', isNull: !!arg.isNull, useDefault: !!arg.useDefault }
  }
  return out
}

export default function DebugPanel({ workspaceId, obj, initial, onBack, onOpenInQuery }) {
  const [params, setParams] = useState(null) // null = loading
  const [inputs, setInputs] = useState({})
  const [rollback, setRollback] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState(null)
  const [showForm, setShowForm] = useState(true)
  const [tab, setTab] = useState('exec')

  const display = obj.schema ? `${obj.schema}.${obj.name}` : obj.name

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = (await (await go()).GetProcParameters(workspaceId, obj.schema, obj.name)) || []
        if (cancelled) return
        setParams(list)
        const init = {}
        list.forEach(p => { init[p.name] = { value: '', isNull: false, useDefault: p.hasDefault } })
        setInputs(initial ? applyInitial(list, init, initial) : init)
      } catch (e) {
        if (!cancelled) { setParams([]); setLoadError(e.toString()) }
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId, obj.schema, obj.name])

  const patch = (name, change) => setInputs(prev => ({ ...prev, [name]: { ...prev[name], ...change } }))

  const run = async () => {
    setRunning(true)
    setRunError('')
    setResult(null)
    try {
      const req = {
        schema: obj.schema,
        name: obj.name,
        rollback,
        maxRows: 500,
        params: (params || []).filter(p => !p.unsupported).map(p => ({
          name: p.name,
          value: inputs[p.name]?.value ?? '',
          isNull: !!inputs[p.name]?.isNull,
          useDefault: !!inputs[p.name]?.useDefault,
        })),
      }
      const res = await (await go()).DebugProcedure(workspaceId, req)
      // Defensive: any list the server leaves null becomes empty so the views can iterate.
      setResult({
        ...res,
        steps: res.steps || [],
        sources: res.sources || [],
        sets: res.sets || [],
        messages: res.messages || [],
        outputs: res.outputs || [],
        notes: res.notes || [],
      })
      setShowForm(false)
      setTab('exec')
    } catch (e) {
      setRunError(e.toString())
    } finally {
      setRunning(false)
    }
  }

  const cancel = async () => { try { await (await go()).CancelQuery(workspaceId) } catch { /* ignore */ } }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button onClick={onBack} className="btn-secondary text-xs py-1.5 px-3">
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver
        </button>
        <span className="badge-blue flex items-center gap-1"><Bug className="w-3 h-3" /> Depurar</span>
        <span className="text-sm font-semibold text-white font-mono truncate" title={display}>{display}</span>
        <div className="flex-1" />
        {result && (
          <button onClick={() => setShowForm(s => !s)} className="btn-secondary text-xs py-1.5 px-3">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Parámetros
          </button>
        )}
        {running && (
          <button onClick={cancel} className="btn-danger text-xs py-1.5 px-3">
            <Ban className="w-3.5 h-3.5" />
            Cancelar
          </button>
        )}
        <button onClick={run} disabled={running || params === null} className="btn-primary text-xs py-1.5 px-3">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {result ? 'Ejecutar de nuevo' : 'Ejecutar y depurar'}
        </button>
      </div>

      {(loadError || runError) && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span className="whitespace-pre-wrap">{loadError || runError}</span>
        </div>
      )}

      {/* Parameters */}
      {showForm && initial && (
        <p className="flex items-center gap-1.5 text-[11px] text-sky-300 flex-shrink-0">
          <Info className="w-3.5 h-3.5" />
          {initial.parsed === false
            ? 'No se pudieron leer los valores de la llamada en la traza; completa los parámetros a mano.'
            : 'Parámetros prellenados con los valores de la llamada capturada en la traza.'}
        </p>
      )}
      {showForm && (
        <ParamForm params={params} inputs={inputs} patch={patch} rollback={rollback} setRollback={setRollback} />
      )}

      {running && (
        <div className="flex items-center justify-center gap-3 text-slate-400 text-sm py-6">
          <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
          Ejecutando y recopilando la traza de sentencias (puede tardar unos segundos)…
        </div>
      )}

      {!running && result && (
        <>
          <Summary result={result} onOpenBatch={onOpenInQuery ? () => onOpenInQuery(result.batch, `Depurar ${obj.name}`) : null} />
          <div className="flex items-center gap-1 flex-shrink-0">
            {TABS.map(t => {
              const badge = t.id === 'results' ? result.sets.length : t.id === 'messages' ? result.messages.length : null
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                        className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                          tab === t.id ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200 bg-white/5')}>
                  {t.label}{badge ? ` (${badge})` : ''}
                </button>
              )
            })}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === 'exec' && <ExecutionView result={result} />}
            {tab === 'results' && <ResultsView sets={result.sets} />}
            {tab === 'messages' && <MessagesView messages={result.messages} />}
            {tab === 'output' && <OutputView result={result} />}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ parameters

function ParamForm({ params, inputs, patch, rollback, setRollback }) {
  if (params === null) {
    return <div className="flex items-center gap-2 text-slate-500 text-xs"><Loader2 className="w-4 h-4 animate-spin" /> Leyendo parámetros…</div>
  }
  return (
    <div className="flex-shrink-0 rounded-xl border border-surface-600 overflow-hidden" style={{ background: '#18191A' }}>
      {params.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">Este procedimiento no recibe parámetros.</p>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: '#111B2C' }}>
              <tr className="text-left text-slate-400">
                <th className="px-3 py-1.5 font-medium">Parámetro</th>
                <th className="px-3 py-1.5 font-medium">Tipo</th>
                <th className="px-3 py-1.5 font-medium w-full">Valor</th>
                <th className="px-3 py-1.5 font-medium">NULL</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Por defecto</th>
              </tr>
            </thead>
            <tbody>
              {params.map(p => {
                const inp = inputs[p.name] || { value: '', isNull: false, useDefault: false }
                const off = p.unsupported || inp.useDefault || inp.isNull
                return (
                  <tr key={p.name} className="border-t border-surface-700/50">
                    <td className="px-3 py-1.5 font-mono text-white whitespace-nowrap">
                      {p.name}
                      {p.isOutput && <span className="ml-1.5 text-[10px] px-1 rounded border border-violet-500/40 text-violet-300">OUT</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-slate-400 whitespace-nowrap">{p.type}</td>
                    <td className="px-3 py-1.5">
                      {p.unsupported ? (
                        <span className="text-slate-600">tipo no soportado</span>
                      ) : (
                        <input className="input-field py-1 text-xs font-mono w-full" disabled={off}
                               value={inp.value} placeholder={inp.useDefault ? '(valor por defecto)' : inp.isNull ? 'NULL' : ''}
                               onChange={e => patch(p.name, { value: e.target.value })} />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" disabled={p.unsupported} checked={inp.isNull}
                             onChange={e => patch(p.name, { isNull: e.target.checked, useDefault: e.target.checked ? false : inp.useDefault })} />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" disabled={!p.hasDefault || p.unsupported} checked={inp.useDefault}
                             onChange={e => patch(p.name, { useDefault: e.target.checked, isNull: e.target.checked ? false : inp.isNull })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <label className="flex items-start gap-2 px-4 py-2.5 border-t border-surface-700/50 text-xs text-slate-300 cursor-pointer select-none">
        <input type="checkbox" className="mt-0.5" checked={rollback} onChange={e => setRollback(e.target.checked)} />
        <span>
          Ejecutar dentro de una transacción y deshacer los cambios al terminar (ROLLBACK).
          <span className="block text-[11px] text-slate-500">
            El procedimiento se ejecuta de verdad. El rollback no deshace los incrementos de IDENTITY ni efectos externos
            (correos, servidores vinculados, escrituras en variables de tabla).
          </span>
        </span>
      </label>
    </div>
  )
}

// --------------------------------------------------------------------- summary

function Summary({ result, onOpenBatch }) {
  return (
    <div className="flex-shrink-0 flex flex-col gap-1.5">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        {result.failed
          ? <span className="flex items-center gap-1 text-red-400 font-medium"><XCircle className="w-4 h-4" /> Terminó con error</span>
          : <span className="flex items-center gap-1 text-emerald-400 font-medium"><CheckCircle2 className="w-4 h-4" /> Terminó correctamente</span>}
        <span className="text-slate-400">{fmtUs(result.durationMs * 1000)}</span>
        <span className="text-slate-400">{result.stepCount} sentencia(s) ejecutada(s)</span>
        {result.rolledBack && (
          <span className="flex items-center gap-1 text-sky-300"><Undo2 className="w-3.5 h-3.5" /> con ROLLBACK</span>
        )}
        <div className="flex-1" />
        {onOpenBatch && (
          <button onClick={onOpenBatch} className="btn-secondary text-[11px] py-1 px-2" title="Abre en Consultas el T-SQL que se ejecutó">
            <Terminal className="w-3 h-3" /> Ver T-SQL ejecutado
          </button>
        )}
      </div>
      {result.notes.map((n, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px] text-amber-300">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {n}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- execution

// Lines executed per source: key -> Map(line -> times executed).
function executedLines(steps) {
  const out = new Map()
  const walk = (nodes) => {
    for (const s of nodes) {
      if (s.kind === 'stmt' && s.sourceKey && s.line > 0) {
        if (!out.has(s.sourceKey)) out.set(s.sourceKey, new Map())
        const m = out.get(s.sourceKey)
        for (let l = s.line; l <= Math.max(s.line, s.endLine); l++) m.set(l, (m.get(l) || 0) + (s.count || 1))
      }
      walk(s.children || [])
    }
  }
  walk(steps)
  return out
}

function ExecutionView({ result }) {
  const { steps, sources } = result
  const [selected, setSelected] = useState(null) // step
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [sourceKey, setSourceKey] = useState(() => steps.find(s => s.sourceKey)?.sourceKey || sources[0]?.key || '')

  const executed = useMemo(() => executedLines(steps), [steps])
  const source = sources.find(s => s.key === sourceKey) || null
  const minLevel = useMemo(() => Math.min(...steps.map(s => s.level)), [steps])

  const toggle = useCallback((seq) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(seq) ? next.delete(seq) : next.add(seq)
      return next
    })
  }, [])

  const select = (step) => {
    setSelected(step)
    if (step.sourceKey) setSourceKey(step.sourceKey)
  }

  if (steps.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-500 text-center px-6">
        No se registraron sentencias. Si el procedimiento falló al inicio, revisa la pestaña Mensajes;
        si la traza no está disponible, el usuario necesita el permiso ALTER ANY EVENT SESSION.
      </div>
    )
  }

  return (
    <div className="h-full flex gap-3 min-h-0">
      <div className="flex-1 min-w-0 overflow-auto rounded-xl border border-surface-600 py-1" style={{ background: '#18191A' }}>
        {steps.map(s => (
          <TreeNode key={s.seq} step={s} depth={s.level - minLevel} selected={selected} onSelect={select}
                    collapsed={collapsed} toggle={toggle} />
        ))}
      </div>
      <SourcePane source={source} sources={sources} onPick={setSourceKey}
                  executed={executed.get(sourceKey)} selected={selected && selected.sourceKey === sourceKey ? selected : null}
                  fallbackText={selected && !selected.sourceKey ? selected.text : ''} />
    </div>
  )
}

function TreeNode({ step: s, depth, selected, onSelect, collapsed, toggle }) {
  const kids = s.children || []
  const isOpen = !collapsed.has(s.seq)
  const isErr = s.kind === 'error'
  return (
    <>
      <div
        onClick={() => onSelect(s)}
        className={clsx('flex items-center gap-2 pr-3 py-[3px] cursor-pointer text-xs hover:bg-surface-700/30',
          selected?.seq === s.seq && 'bg-brand-dark/30', isErr && 'text-red-300')}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <span className="w-4 flex-shrink-0">
          {kids.length > 0 && (
            <button onClick={e => { e.stopPropagation(); toggle(s.seq) }} className="text-slate-500 hover:text-white">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </span>
        {isErr ? (
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <span className="font-mono text-[10px] text-slate-500 w-9 flex-shrink-0 text-right">{s.line ? `L${s.line}` : ''}</span>
        )}
        <span className="font-mono truncate min-w-0 flex-1" title={s.text}>
          {isErr && <span className="font-semibold">Error {s.errorNumber}: </span>}
          {oneLine(s.text)}
        </span>
        {s.branch && (
          <span className={clsx('px-1.5 py-px rounded border text-[10px] whitespace-nowrap', BRANCH_STYLE[s.branch])}
                title="Deducido de la siguiente sentencia que se ejecutó">
            {BRANCH_LABEL[s.branch] || s.branch}
          </span>
        )}
        {s.note && <span className="text-[10px] text-slate-500 whitespace-nowrap">{s.note}</span>}
        {s.count > 1 && <span className="text-[10px] text-sky-300 whitespace-nowrap">×{s.count}</span>}
        {!isErr && s.rows > 0 && <span className="text-[10px] text-slate-400 whitespace-nowrap">{s.rows.toLocaleString()} fila(s)</span>}
        {!isErr && <span className="font-mono text-[10px] text-slate-500 w-14 text-right whitespace-nowrap">{fmtUs(s.durationUs)}</span>}
      </div>
      {isOpen && kids.map(c => (
        <TreeNode key={c.seq} step={c} depth={depth + 1} selected={selected} onSelect={onSelect}
                  collapsed={collapsed} toggle={toggle} />
      ))}
    </>
  )
}

function SourcePane({ source, sources, onPick, executed, selected, fallbackText }) {
  const containerRef = useRef(null)
  const lines = useMemo(() => (source ? source.text.split('\n') : []), [source])

  // Scroll the selected statement into view.
  useEffect(() => {
    if (!selected?.line || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-line="${selected.line}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [selected])

  return (
    <div className="w-[46%] flex-shrink-0 min-w-0 flex flex-col rounded-xl border border-surface-600 overflow-hidden" style={{ background: '#18191A' }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700/60 text-[11px] text-slate-400 flex-shrink-0">
        <span>Código</span>
        {sources.length > 1 ? (
          <select value={source?.key || ''} onChange={e => onPick(e.target.value)}
                  className="rounded-md px-1.5 py-0.5 text-xs bg-surface-800 border border-surface-600 text-slate-200 outline-none min-w-0">
            {sources.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        ) : (
          <span className="font-mono text-slate-200 truncate">{source?.name}</span>
        )}
        <div className="flex-1" />
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> ejecutada</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-600" /> no ejecutada</span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto py-1 font-mono text-[11px] leading-[1.45]">
        {fallbackText ? (
          <div className="p-3 text-slate-300 whitespace-pre-wrap">
            <p className="text-[10px] text-slate-500 mb-1">SQL dinámico (sin código fuente asociado):</p>
            {fallbackText}
          </div>
        ) : !source ? (
          <p className="p-3 text-slate-500">No hay código fuente disponible (¿módulo cifrado?).</p>
        ) : lines.map((text, i) => {
          const n = i + 1
          const times = executed?.get(n) || 0
          const isSel = selected && n >= selected.line && n <= Math.max(selected.line, selected.endLine)
          return (
            <div key={n} data-line={n}
                 className={clsx('flex border-l-2', times ? 'border-emerald-500/70 bg-emerald-500/[0.07]' : 'border-transparent text-slate-500',
                   isSel && '!bg-brand-dark/50')}>
              <span className="w-9 flex-shrink-0 text-right pr-2 text-slate-600 select-none">{n}</span>
              <span className="whitespace-pre flex-1">{text || ' '}</span>
              {times > 1 && <span className="px-1.5 text-[10px] text-sky-300 select-none">×{times}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ results / output

function ResultsView({ sets }) {
  if (sets.length === 0) {
    return <p className="text-sm text-slate-500 p-4">El procedimiento no devolvió conjuntos de resultados.</p>
  }
  return (
    <div className="h-full overflow-auto flex flex-col gap-4 pr-1">
      {sets.map((set, i) => (
        <div key={i}>
          <p className="text-[11px] text-slate-500 mb-1">
            Resultado {i + 1} · {set.rows.length} fila(s){set.truncated ? ' (se muestran las primeras; hay más)' : ''}
          </p>
          <div className="overflow-auto rounded-xl border border-surface-600" style={{ maxHeight: '55vh' }}>
            <table className="text-xs border-collapse">
              <thead className="sticky top-0"><tr style={{ background: '#111B2C' }}>
                {set.columns.map((c, ci) => (
                  <th key={ci} className="px-3 py-1.5 text-left font-medium text-slate-300 whitespace-nowrap border-r border-surface-700/60">{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {set.rows.map((row, r) => (
                  <tr key={r} className={r % 2 ? 'bg-surface-800/30' : ''}>
                    {row.map((cell, c) => (
                      <td key={c} className="px-3 py-1 font-mono text-slate-200 whitespace-nowrap border-r border-surface-700/60">
                        {cell === null ? <span className="text-slate-600 italic">NULL</span> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function MessagesView({ messages }) {
  if (messages.length === 0) return <p className="text-sm text-slate-500 p-4">Sin mensajes (PRINT / RAISERROR) ni errores.</p>
  return (
    <div className="h-full overflow-auto flex flex-col gap-1.5 pr-1">
      {messages.map((m, i) => (
        <div key={i} className={clsx('flex items-start gap-2 rounded-lg px-3 py-2 text-xs border',
          m.kind === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-surface-800/60 border-surface-600 text-slate-200')}>
          {m.kind === 'error' ? <XCircle className="w-4 h-4 flex-shrink-0" /> : <Info className="w-4 h-4 flex-shrink-0 text-sky-300" />}
          <div className="min-w-0">
            <p className="font-mono whitespace-pre-wrap break-words">{m.text}</p>
            {(m.number > 0 || m.proc || m.line > 0) && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {m.number > 0 && <>Error {m.number} </>}{m.proc && <>en {m.proc} </>}{m.line > 0 && <>línea {m.line}</>}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function OutputView({ result }) {
  const rows = [
    ...(result.returnValue !== null && result.returnValue !== undefined ? [{ name: 'Valor de retorno (RETURN)', value: result.returnValue }] : []),
    ...result.outputs,
  ]
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 p-4">No hay valor de retorno ni parámetros de salida (la ejecución pudo haber fallado antes).</p>
  }
  return (
    <table className="text-xs border-collapse rounded-xl overflow-hidden border border-surface-600">
      <tbody>
        {rows.map(r => (
          <tr key={r.name} className="border-t border-surface-700/50">
            <td className="px-4 py-2 font-mono text-slate-300 whitespace-nowrap">{r.name}</td>
            <td className="px-4 py-2 font-mono text-white">{r.value === null ? <span className="text-slate-600 italic">NULL</span> : r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
