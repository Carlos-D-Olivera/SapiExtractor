import { useState, useCallback, useRef, useEffect } from 'react'
import { Play, Plus, X, Loader2, AlertCircle, Ban, Clock, Table2, Trash2, Sparkles, FileCode2, PanelBottomClose, PanelBottomOpen, Check } from 'lucide-react'
import clsx from 'clsx'
import SqlEditor, { getIdentifierAtCursor, stripQuotes } from './SqlEditor'
import AutocompletesModal, { getStoredAutocompletes, loadStoredAutocompletes, saveStoredAutocompletes } from './AutocompletesModal'
import InsertScriptModal from './InsertScriptModal'

let tabSeq = 0
function newTab() {
  tabSeq += 1
  return { id: `q${Date.now()}_${tabSeq}`, title: `Consulta ${tabSeq}`, sql: '', lastSql: '', result: null, error: '', running: false }
}

const go = () => import('../../wailsjs/go/main/App')

// Applied only to queries that don't set their own limit (TOP / LIMIT / FETCH).
const DEFAULT_ROW_LIMIT = 100
const EXPLICIT_LIMIT = /\b(top\s*\(?\s*\d+|limit\s+\d+|fetch\s+(first|next)\b)/i

const DEFAULT_FONT_SIZE = 12
const MIN_FONT_SIZE = 9
const MAX_FONT_SIZE = 32

function getStoredFontSize() {
  try {
    const v = localStorage.getItem('sp_extractor_query_font_size')
    const n = Number(v)
    if (Number.isFinite(n) && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) return n
  } catch { /* ignore */ }
  return DEFAULT_FONT_SIZE
}

const ROW_LIMITS = [
  { value: 100, label: '100 filas' },
  { value: 1000, label: '1.000 filas' },
  { value: 5000, label: '5.000 filas' },
  { value: 50000, label: '50.000 filas' },
  { value: 0, label: 'Sin límite' },
]

// Builds { "schema.table": [cols], "table": [cols] } for editor autocompletion.
function buildSchema(columns) {
  const schema = {}
  for (const c of columns) {
    if (!c.parentName) continue
    const qualified = c.schema ? `${c.schema}.${c.parentName}` : c.parentName
    ;(schema[qualified] ||= []).push(c.name)
    ;(schema[c.parentName] ||= [])
    if (!schema[c.parentName].includes(c.name)) schema[c.parentName].push(c.name)
  }
  return schema
}

export default function QueryWorkspace({
  workspaceId = '1',
  connLabel,
  dbType,
  incomingSql,
  active: visible,
  onOpenInQuery,
  onOpenTableDefinition,
  onOpenTableRelations,
  onOpenTableScripts,
}) {
  const [tabs, setTabs] = useState(() => [newTab()])
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const [insertTarget, setInsertTarget] = useState(null)
  const [maxRows, setMaxRows] = useState(DEFAULT_ROW_LIMIT)
  const [showResults, setShowResults] = useState(true)

  const toggleResults = useCallback(() => {
    setShowResults(prev => !prev)
  }, [])
  const [fontSize, setFontSize] = useState(() => getStoredFontSize())
  const workspaceRef = useRef(null)
  const deltaRef = useRef(0)
  const schemaLoaded = useRef(false)
  const [schema, setSchema] = useState({})
  const editorRef = useRef(null)
  const lastNonce = useRef(incomingSql?.nonce)
  const [autocompletes, setAutocompletes] = useState(() => getStoredAutocompletes())
  const [showAutocompletesModal, setShowAutocompletesModal] = useState(false)

  const changeFontSize = useCallback((delta) => {
    setFontSize(prev => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, prev + delta))
      try {
        localStorage.setItem('sp_extractor_query_font_size', String(next))
      } catch { /* ignore */ }
      return next
    })
  }, [])

  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_FONT_SIZE)
    try {
      localStorage.setItem('sp_extractor_query_font_size', String(DEFAULT_FONT_SIZE))
    } catch { /* ignore */ }
  }, [])

  // Ctrl + MouseWheel zooms text across QueryWorkspace
  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return

    let timeoutId = null

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return

      // Prevent browser-level full-window zoom in WebView2
      e.preventDefault()
      e.stopPropagation()

      // Reset accumulated delta if scrolling direction reverses
      if ((deltaRef.current > 0 && e.deltaY < 0) || (deltaRef.current < 0 && e.deltaY > 0)) {
        deltaRef.current = 0
      }

      deltaRef.current += e.deltaY

      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        deltaRef.current = 0
      }, 250)

      const THRESHOLD = 60
      if (Math.abs(deltaRef.current) >= THRESHOLD) {
        const steps = Math.trunc(deltaRef.current / THRESHOLD)
        deltaRef.current -= steps * THRESHOLD
        // deltaY < 0 is wheel up (zoom in, +steps)
        // deltaY > 0 is wheel down (zoom out, -steps)
        changeFontSize(-steps)
      }
    }

    el.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel, { capture: true })
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [changeFontSize])

  // Keyboard zoom shortcuts (Ctrl +, Ctrl -, Ctrl 0) when QueryWorkspace is active
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault()
        changeFontSize(1)
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        changeFontSize(-1)
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        resetFontSize()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, changeFontSize, resetFontSize])

  const handleSaveAutocompletes = async (newList) => {
    setAutocompletes(newList)
    await saveStoredAutocompletes(newList)
  }

  // Load autocompletes from persistent disk storage (~/.spextractor/autocompletes.json)
  // and keep synced across all open workspaces.
  useEffect(() => {
    let mounted = true
    loadStoredAutocompletes().then(loaded => {
      if (mounted && loaded && Array.isArray(loaded)) {
        setAutocompletes(loaded)
      }
    }).catch(() => {})

    const handleUpdate = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        setAutocompletes(e.detail)
      }
    }
    window.addEventListener('spextractor:autocompletes-updated', handleUpdate)
    return () => {
      mounted = false
      window.removeEventListener('spextractor:autocompletes-updated', handleUpdate)
    }
  }, [])

  // Table/column names for autocompletion: loaded once per connection, the first
  // time the Consultas view is actually shown (not when the app starts).
  useEffect(() => {
    if (!visible || schemaLoaded.current) return
    schemaLoaded.current = true
    ;(async () => {
      try {
        const api = await go()
        const cols = await api.ListObjects(workspaceId, 'COLUMN', '', 0)
        setSchema(buildSchema(cols || []))
      } catch { /* autocompletion just stays keyword-only */ }
    })()
  }, [visible])

  // SQL pushed from elsewhere in the app (e.g. generated scripts) opens in a new tab.
  useEffect(() => {
    if (!incomingSql || incomingSql.nonce === lastNonce.current) return
    lastNonce.current = incomingSql.nonce
    const t = { ...newTab(), sql: incomingSql.text }
    if (incomingSql.title) t.title = incomingSql.title
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
  }, [incomingSql])

  const active = tabs.find(t => t.id === activeId) || tabs[0]

  const patchTab = useCallback((id, patch) => {
    setTabs(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const addTab = () => {
    const t = newTab()
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
  }

  const closeTab = (id) => {
    setTabs(prev => {
      if (prev.length === 1) return prev
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      if (id === activeId) {
        setActiveId(next[Math.max(0, idx - 1)].id)
      }
      return next
    })
  }

  // Runs the selected text when there is a selection, otherwise the whole editor.
  const runQuery = useCallback(async (tab, selection) => {
    if (!tab || tab.running) return
    const text = (selection ?? tab.sql)
    if (!text.trim()) return
    setShowResults(true)
    patchTab(tab.id, { running: true, error: '', result: null, lastSql: text })
    try {
      const api = await go()
      // A query with its own TOP/LIMIT/FETCH is left alone; everything else gets the cap.
      const cap = EXPLICIT_LIMIT.test(text) ? 0 : maxRows
      const result = await api.ExecuteQuery(workspaceId, text, cap)
      patchTab(tab.id, { result, running: false })
    } catch (e) {
      patchTab(tab.id, { error: e.toString(), running: false })
    }
  }, [workspaceId, patchTab, maxRows])

  const currentSelection = () => {
    const view = editorRef.current
    if (!view) return null
    const { from, to } = view.state.selection.main
    return from === to ? null : view.state.sliceDoc(from, to)
  }

  const cancelQuery = async (tab) => {
    try {
      const api = await go()
      await api.CancelQuery(workspaceId)
    } catch { /* ignore */ }
  }

  const clearEditor = (tab) => {
    const view = editorRef.current
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
    patchTab(tab.id, { sql: '', lastSql: '', result: null, error: '' })
  }

  const activeRef = useRef(active)
  activeRef.current = active

  const runQueryRef = useRef(runQuery)
  runQueryRef.current = runQuery

  const addTabRef = useRef(addTab)
  addTabRef.current = addTab

  const toggleResultsRef = useRef(toggleResults)
  toggleResultsRef.current = toggleResults

  const onOpenTableDefinitionRef = useRef(onOpenTableDefinition)
  onOpenTableDefinitionRef.current = onOpenTableDefinition

  const onOpenTableRelationsRef = useRef(onOpenTableRelations)
  onOpenTableRelationsRef.current = onOpenTableRelations

  const onOpenTableScriptsRef = useRef(onOpenTableScripts)
  onOpenTableScriptsRef.current = onOpenTableScripts

  const [copyToast, setCopyToast] = useState('')

  const openQueryInNewTab = useCallback((sqlText, tabTitle, autoRun = false) => {
    const t = { ...newTab(), sql: sqlText, title: tabTitle || 'Consulta' }
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
    if (autoRun) {
      setTimeout(() => {
        runQueryRef.current?.(t, sqlText)
      }, 60)
    }
  }, [])

  const handleSelectTop100 = useCallback((target) => {
    if (!target) return
    const clean = stripQuotes(target)
    let sqlText = ''
    if (dbType === 'SQL_SERVER') {
      sqlText = `SELECT TOP 100 * FROM ${clean};`
    } else {
      sqlText = `SELECT * FROM ${clean} LIMIT 100;`
    }
    openQueryInNewTab(sqlText, `TOP 100 ${clean}`, true)
  }, [dbType, openQueryInNewTab])

  const handleGenerateScript = useCallback(async (target, scriptId) => {
    if (!target) return
    const clean = stripQuotes(target)
    let schema = ''
    let tableName = clean
    if (clean.includes('.')) {
      const parts = clean.split('.')
      schema = parts[0]
      tableName = parts.slice(1).join('.')
    } else {
      schema = dbType === 'POSTGRESQL' ? 'public' : 'dbo'
    }

    try {
      const api = await go()
      const list = await api.GenerateTableScripts(workspaceId, schema, tableName)
      if (list && list.length > 0) {
        const found = list.find(s => s.id === scriptId) || list[0]
        openQueryInNewTab(found.sql, `${tableName} (${found.label})`, false)
      } else {
        openQueryInNewTab(`-- No se pudieron generar scripts para ${clean}`, clean, false)
      }
    } catch (e) {
      console.error(e)
    }
  }, [workspaceId, dbType, openQueryInNewTab])

  const handleCopyName = useCallback((target) => {
    if (!target) return
    const clean = stripQuotes(target)
    try {
      navigator.clipboard?.writeText(clean)
      setCopyToast(`Copiado: ${clean}`)
      setTimeout(() => setCopyToast(''), 1800)
    } catch { /* ignore */ }
  }, [])

  const getTargetIdentifier = useCallback(() => {
    let text = currentSelection()
    if (!text && editorRef.current) {
      const view = editorRef.current
      const { head } = view.state.selection.main
      text = getIdentifierAtCursor(view.state, head)
    }
    return text ? stripQuotes(text) : ''
  }, [])

  // F5 executes query; Ctrl+N opens a new query tab (prevents WebView2 reload / new window)
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e) => {
      if (e.key === 'F5') {
        const wasHandledByEditor = e.defaultPrevented || editorRef.current?.hasFocus
        e.preventDefault()
        const cur = activeRef.current
        if (!wasHandledByEditor && cur && !cur.running && cur.sql?.trim()) {
          runQueryRef.current?.(cur, currentSelection())
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        addTabRef.current?.()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        toggleResultsRef.current?.()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        const target = getTargetIdentifier()
        if (target) handleSelectTop100(target)
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        const target = getTargetIdentifier()
        if (target) onOpenTableRelationsRef.current?.(target)
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        const target = getTargetIdentifier()
        if (target) handleCopyName(target)
      } else if (e.altKey && (e.key === 'F1' || e.code === 'F1')) {
        e.preventDefault()
        const target = getTargetIdentifier()
        if (target) onOpenTableDefinitionRef.current?.(target)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, getTargetIdentifier, handleSelectTop100, handleCopyName])

  return (
    <div ref={workspaceRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-surface-600 flex-shrink-0 overflow-x-auto"
           style={{ background: 'rgba(11,16,26,0.8)' }}>
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={clsx(
              'group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-medium cursor-pointer select-none whitespace-nowrap transition-colors',
              t.id === activeId
                ? 'text-brand-light bg-surface-900 border border-surface-600 border-b-transparent -mb-px'
                : 'text-slate-500 hover:text-slate-300 hover:bg-surface-700/40'
            )}
          >
            <Table2 className="w-3.5 h-3.5" />
            {t.title}
            {tabs.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); closeTab(t.id) }}
                className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-slate-600"
                title="Cerrar pestaña"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="p-1.5 rounded text-slate-500 hover:text-brand-light hover:bg-surface-700/50 mb-0.5"
          title="Nueva pestaña de consulta (Ctrl+N)"
        >
          <Plus className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        {connLabel && (
          <span className="text-[10px] text-slate-600 px-2 whitespace-nowrap">Conectado a {connLabel}</span>
        )}
      </div>

      {active && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
            <button
              onClick={() => runQuery(active, currentSelection())}
              disabled={active.running || !active.sql.trim()}
              className="btn-primary text-xs py-1.5 px-3"
              title="Ejecutar (F5). Si hay texto seleccionado, ejecuta solo la selección"
            >
              {active.running
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Play className="w-3.5 h-3.5" />}
              Ejecutar
            </button>
            {active.running && (
              <button onClick={() => cancelQuery(active)} className="btn-danger text-xs py-1.5 px-3">
                <Ban className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}
            <button onClick={() => clearEditor(active)} className="btn-secondary text-xs py-1.5 px-3">
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar
            </button>
            <button
              onClick={() => setShowAutocompletesModal(true)}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              title="Configurar códigos de autocompletado rápido con TAB"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              AutoCompletes
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400/20 text-amber-300 font-mono font-bold">
                {autocompletes.length}
              </span>
            </button>
            <button
              onClick={toggleResults}
              className={clsx(
                'btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5',
                !showResults && 'bg-brand-primary/20 text-brand-light border-brand-primary/40'
              )}
              title={showResults ? 'Ocultar panel de resultados (Ctrl+R)' : 'Mostrar panel de resultados (Ctrl+R)'}
            >
              {showResults ? <PanelBottomClose className="w-3.5 h-3.5" /> : <PanelBottomOpen className="w-3.5 h-3.5" />}
              {showResults ? 'Resultados' : 'Ver resultados'}
            </button>

            {/* Zoom text control */}
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-surface-800/80 border border-surface-600/70 text-slate-400 select-none"
              title="Zoom de texto: Ctrl + Rueda del ratón o Ctrl +/- (clic para reiniciar a 100%)"
            >
              <button
                onClick={() => changeFontSize(-1)}
                disabled={fontSize <= MIN_FONT_SIZE}
                className="hover:text-white px-1 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Reducir texto (Ctrl - o Ctrl+Rueda abajo)"
              >
                −
              </button>
              <button
                onClick={resetFontSize}
                className="font-mono text-[11px] hover:text-brand-light px-1 transition-colors min-w-[36px] text-center"
                title="Reiniciar tamaño a 100% (12px)"
              >
                {Math.round((fontSize / DEFAULT_FONT_SIZE) * 100)}%
              </button>
              <button
                onClick={() => changeFontSize(1)}
                disabled={fontSize >= MAX_FONT_SIZE}
                className="hover:text-white px-1 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Aumentar texto (Ctrl + o Ctrl+Rueda arriba)"
              >
                +
              </button>
            </div>

            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
              Límite (si la consulta no trae TOP/LIMIT)
              <select
                value={maxRows}
                onChange={e => setMaxRows(Number(e.target.value))}
                className="rounded-md px-1.5 py-1 text-xs bg-surface-800 border border-surface-600 text-slate-300 outline-none"
              >
                {ROW_LIMITS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <span className="text-[10px] text-slate-600">F5 ejecuta · selección = solo eso</span>
          </div>

          {/* Editor */}
          <div className={clsx('px-3', showResults ? 'flex-shrink-0' : 'flex-1 overflow-hidden pb-3 min-h-0')}>
            <div
              className={clsx('rounded-lg overflow-hidden', showResults ? 'resize-y' : 'h-full')}
              style={{
                ...(showResults ? { height: 176, minHeight: 80 } : {}),
                border: '1px solid rgba(36,51,80,0.8)',
              }}
            >
              <SqlEditor
                key={active.id}
                value={active.sql}
                onChange={sqlText => patchTab(active.id, { sql: sqlText })}
                dbType={dbType}
                schema={schema}
                autocompletes={autocompletes}
                fontSize={fontSize}
                viewRef={editorRef}
                onRun={selection => runQuery(active, selection)}
                onAltF1={table => onOpenTableDefinition?.(table)}
                onSelectTop100={handleSelectTop100}
                onOpenRelations={table => onOpenTableRelations?.(table)}
                onOpenScripts={table => onOpenTableScripts?.(table)}
                onGenerateScript={handleGenerateScript}
                onCopyName={handleCopyName}
                onToggleResults={toggleResults}
              />
            </div>
          </div>

          {/* Results */}
          <div className={clsx('flex-1 overflow-hidden px-3 pb-3 pt-1', !showResults && 'hidden')}>
            <ResultArea
              tab={active}
              fontSize={fontSize}
              onInsertScript={set => setInsertTarget({ set, sql: active.lastSql || active.sql })}
            />
          </div>
        </>
      )}

      {/* AutoCompletes Modal */}
      {showAutocompletesModal && (
        <AutocompletesModal
          autocompletes={autocompletes}
          onSave={handleSaveAutocompletes}
          onClose={() => setShowAutocompletesModal(false)}
        />
      )}

      {/* INSERT script generator */}
      {insertTarget && (
        <InsertScriptModal
          set={insertTarget.set}
          sql={insertTarget.sql}
          dbType={dbType}
          onClose={() => setInsertTarget(null)}
          onOpenInQuery={onOpenInQuery}
        />
      )}

      {/* Copy Toast feedback */}
      {copyToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#18191a] border border-brand/70 text-white text-xs px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 pointer-events-none transition-all">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{copyToast}</span>
        </div>
      )}
    </div>
  )
}

function ResultArea({ tab, fontSize, onInsertScript }) {
  if (tab.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm overflow-auto h-full">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <pre className="whitespace-pre-wrap font-mono" style={{ margin: 0, fontSize: `${fontSize}px` }}>{tab.error}</pre>
      </div>
    )
  }

  if (tab.running) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
        <span className="text-sm">Ejecutando consulta…</span>
      </div>
    )
  }

  if (!tab.result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
        <Table2 className="w-8 h-8 opacity-40" />
        <span className="text-xs">Los resultados aparecerán aquí.</span>
      </div>
    )
  }

  const { sets = [], message = '', durationMs = 0 } = tab.result

  return (
    <div className="flex flex-col h-full gap-2 overflow-auto">
      <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
        <span>{message}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{durationMs} ms</span>
      </div>
      {sets.map((set, i) => (
        <ResultGrid key={i} set={set} index={i} total={sets.length} fontSize={fontSize} onInsertScript={onInsertScript} />
      ))}
    </div>
  )
}

function ResultGrid({ set, index, total, fontSize, onInsertScript }) {
  const { columns = [], rows = [] } = set
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-1">
        {total > 1 && (
          <span className="text-[10px] text-slate-500">Resultado {index + 1} · {rows.length} fila(s)</span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onInsertScript?.(set)}
          disabled={rows.length === 0}
          className="btn-secondary text-[11px] py-1 px-2"
          title="Generar un script INSERT con las filas de este resultado"
        >
          <FileCode2 className="w-3 h-3" />
          Script INSERT
        </button>
      </div>
      {set.truncated && (
        <div className="text-[11px] text-amber-400 mb-1">
          Mostrando solo las primeras {rows.length} filas; hay más. Sube el límite o acota la consulta.
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-surface-600" style={{ maxHeight: '45vh' }}>
        <table className="border-collapse" style={{ fontSize: `${Math.min(fontSize || 12, 20)}px` }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ background: '#111B2C' }}>
              <th className="px-2 py-1.5 text-right text-slate-600 font-normal border-r border-surface-700/60 w-10">#</th>
              {columns.map((c, i) => (
                <th key={i} className="px-3 py-1.5 text-left font-medium text-slate-300 whitespace-nowrap border-r border-surface-700/60">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="text-center py-6 text-slate-500">
                  Sin filas.
                </td>
              </tr>
            ) : rows.map((row, r) => (
              <tr key={r} className={r % 2 === 0 ? 'hover:bg-surface-700/30' : 'bg-surface-800/30 hover:bg-surface-700/30'}>
                <td className="px-2 py-1 text-right text-slate-600 font-mono border-r border-surface-700/60">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-1 font-mono text-slate-200 whitespace-nowrap border-r border-surface-700/60 align-top">
                    {cell === null
                      ? <span className="text-slate-600 italic">NULL</span>
                      : cell === ''
                      ? <span className="text-slate-600">(vacío)</span>
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
