import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database, RefreshCw, Download,
  Table2, Columns, FunctionSquare, Zap, Eye, Loader2,
  AlertCircle, FolderOpen, Plug, Terminal, Activity
} from 'lucide-react'
import clsx from 'clsx'

import ObjectTable from './ObjectTable'
import ExportBar from './ExportBar'
import PreviewPanel from './PreviewPanel'
import TracePanel from './TracePanel'
import DebugPanel from './DebugPanel'
import ErrorBoundary from './ErrorBoundary'
import QueryWorkspace from './QueryWorkspace'
import RelationsPanel from './RelationsPanel'
import ScriptsPanel from './ScriptsPanel'
import appIcon from '../assets/SpExtractor.ico'

// ---------- Constants ----------
export const OBJECT_TYPES = [
  { value: 'STORED_PROCEDURE', label: 'Stored Procedures', icon: Database },
  { value: 'TABLE', label: 'Tables', icon: Table2 },
  { value: 'COLUMN', label: 'Columns', icon: Columns },
  { value: 'FUNCTION', label: 'Functions', icon: FunctionSquare },
  { value: 'TRIGGER', label: 'Triggers', icon: Zap },
  { value: 'VIEW', label: 'Views', icon: Eye },
]

export const DB_LABELS = {
  SQL_SERVER: 'SQL Server',
  MYSQL: 'MySQL',
  POSTGRESQL: 'PostgreSQL',
}

const INITIAL_LIMIT = 50
const SEARCH_LIMIT = 200
const SEARCH_DEBOUNCE_MS = 300

let goApp = null
async function go() {
  if (!goApp) {
    goApp = await import('../../wailsjs/go/main/App')
  }
  return goApp
}

function objKey(obj) {
  return `${obj.schema}|${obj.parentName || ''}|${obj.name}|${obj.type}`
}

export default function WorkspaceView({
  workspaceId,
  isActive,
  connInfo,
  view,
  setView,
  pendingConn,
  onOpenConnDialog,
}) {
  const [objType, setObjType] = useState('STORED_PROCEDURE')
  const [objects, setObjects] = useState([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState(null)
  const [filteredCount, setFilteredCount] = useState(null)
  const [objError, setObjError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [outDir, setOutDir] = useState('')
  const [exportProgress, setExportProgress] = useState(null)
  const [exporting, setExporting] = useState(false)

  const cacheRef = useRef(new Map())
  const totalCountCacheRef = useRef(new Map())
  const knownRef = useRef(new Map())
  const reqRef = useRef(0)
  const searchTimer = useRef(null)
  const defCacheRef = useRef(new Map())

  const [previewObj, setPreviewObj] = useState(null)
  const [previewDef, setPreviewDef] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [relationsObj, setRelationsObj] = useState(null)
  const [scriptsObj, setScriptsObj] = useState(null)
  const [debugObj, setDebugObj] = useState(null)
  const [debugInit, setDebugInit] = useState(null)    // prefilled arguments (from the trace)
  const [debugFrom, setDebugFrom] = useState('explorer')
  const [debugKey, setDebugKey] = useState(0)
  const [incomingSql, setIncomingSql] = useState(null)
  const [connSeq, setConnSeq] = useState(0)

  // Track previous connection to trigger auto-load or clear
  const prevConnRef = useRef(connInfo)

  // ---- Wails event listeners for exports ----
  useEffect(() => {
    let unlisten1, unlisten2, unlisten3, unlisten4
    ;(async () => {
      const { EventsOn } = await import('../../wailsjs/runtime/runtime')
      unlisten1 = EventsOn('export:progress', data => {
        if (!data.workspaceId || data.workspaceId === workspaceId) {
          setExportProgress({ ...data })
        }
      })
      unlisten2 = EventsOn('export:done', data => {
        if (!data.workspaceId || data.workspaceId === workspaceId) {
          setExportProgress(prev => ({ ...prev, done: true, ...data }))
          setExporting(false)
        }
      })
      unlisten3 = EventsOn('export:error', data => {
        if (!data.workspaceId || data.workspaceId === workspaceId) {
          setExportProgress(prev => ({ ...prev, error: data.error }))
        }
      })
      unlisten4 = EventsOn('export:cancelled', data => {
        if (!data.workspaceId || data.workspaceId === workspaceId) {
          setExportProgress(prev => ({ ...prev, cancelled: true, ...data }))
          setExporting(false)
        }
      })
    })()
    return () => {
      unlisten1?.()
      unlisten2?.()
      unlisten3?.()
      unlisten4?.()
    }
  }, [workspaceId])

  // ---- Object listing ----
  const loadObjects = useCallback(async (type, info, force = false, term = '') => {
    const req = ++reqRef.current
    const searchMode = term !== ''
    const limit = searchMode ? SEARCH_LIMIT : INITIAL_LIMIT
    const remember = (list) => list.forEach(o => knownRef.current.set(objKey(o), o))

    if (!searchMode && !force && cacheRef.current.has(type)) {
      const cached = cacheRef.current.get(type)
      const cachedTotal = totalCountCacheRef.current.get(type) ?? null
      setObjects(cached)
      setTotalCount(cachedTotal)
      setFilteredCount(null)
      setHasMore(cachedTotal !== null ? cachedTotal > cached.length : cached.length >= INITIAL_LIMIT)
      setObjError('')
      setLoadingObjects(false)
      setSearching(false)
      return
    }
    if (searchMode) {
      setSearching(true)
    } else {
      setLoadingObjects(true)
      setObjects([])
      if (force || !totalCountCacheRef.current.has(type)) {
        setTotalCount(null)
      }
    }
    setObjError('')
    try {
      const api = await go()
      const countPromise = (!searchMode && !force && totalCountCacheRef.current.has(type))
        ? Promise.resolve(totalCountCacheRef.current.get(type))
        : api.CountObjects(workspaceId, type, term).catch(() => null)

      const [list, count] = await Promise.all([
        api.ListObjects(workspaceId, type, term, limit),
        countPromise,
      ])
      if (req !== reqRef.current) return

      const safeList = list || []
      if (!searchMode) {
        cacheRef.current.set(type, safeList)
        if (count !== null) {
          totalCountCacheRef.current.set(type, count)
          setTotalCount(count)
        }
        setFilteredCount(null)
        setHasMore(count !== null ? count > safeList.length : safeList.length >= limit)
      } else {
        setFilteredCount(count)
        setHasMore(count !== null ? count > safeList.length : safeList.length >= limit)
      }
      remember(safeList)
      setObjects(safeList)
    } catch (e) {
      if (req !== reqRef.current) return
      setObjError(e.toString())
      setObjects([])
      setTotalCount(null)
      setFilteredCount(null)
    } finally {
      if (req === reqRef.current) {
        setLoadingObjects(false)
        setSearching(false)
      }
    }
  }, [workspaceId])

  // React to connection changes
  useEffect(() => {
    if (connInfo !== prevConnRef.current) {
      prevConnRef.current = connInfo
      if (connInfo) {
        setConnSeq(n => n + 1)
        cacheRef.current.clear()
        totalCountCacheRef.current.clear()
        knownRef.current.clear()
        setSearch('')
        defCacheRef.current.clear()
        setObjects([])
        setTotalCount(null)
        setFilteredCount(null)
        setSelected(new Set())
        setSelectingAll(false)
        setObjError('')
        setExportProgress(null)
        setPreviewObj(null)
        setPreviewDef('')
        setPreviewError('')
        setRelationsObj(null)
        setScriptsObj(null)
        setDebugObj(null)
        loadObjects('STORED_PROCEDURE', connInfo)
      } else {
        cacheRef.current.clear()
        totalCountCacheRef.current.clear()
        knownRef.current.clear()
        clearTimeout(searchTimer.current)
        setSearch('')
        defCacheRef.current.clear()
        setObjects([])
        setTotalCount(null)
        setFilteredCount(null)
        setSelected(new Set())
        setSelectingAll(false)
        setExportProgress(null)
        setPreviewObj(null)
        setPreviewDef('')
        setPreviewError('')
        setRelationsObj(null)
        setScriptsObj(null)
        setDebugObj(null)
      }
    }
  }, [connInfo, loadObjects])

  const refreshObjects = () => {
    cacheRef.current.delete(objType)
    totalCountCacheRef.current.delete(objType)
    loadObjects(objType, connInfo, true, search)
  }

  const handleTypeChange = (type) => {
    if (type === objType) return
    clearTimeout(searchTimer.current)
    setObjType(type)
    setSearch('')
    setFilteredCount(null)
    setSelected(new Set())
    setSelectingAll(false)
    setPreviewObj(null)
    setPreviewDef('')
    setRelationsObj(null)
    setScriptsObj(null)
    setDebugObj(null)
    loadObjects(type, connInfo, false, '')
  }

  const handleSearchChange = (term) => {
    setSearch(term)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      loadObjects(objType, connInfo, false, term)
    }, SEARCH_DEBOUNCE_MS)
  }

  const handleSelectAllServer = async () => {
    if (selectingAll || !connInfo) return
    setSelectingAll(true)
    setObjError('')
    try {
      const api = await go()
      const all = await api.ListObjects(workspaceId, objType, search, 0)
      const keys = new Set(selected)
      for (const o of (all || [])) {
        const k = objKey(o)
        knownRef.current.set(k, o)
        keys.add(k)
      }
      setSelected(keys)
    } catch (e) {
      setObjError(`Error al seleccionar todo: ${e}`)
    } finally {
      setSelectingAll(false)
    }
  }

  const handlePreview = async (obj) => {
    const k = objKey(obj)
    setPreviewObj(obj)
    setPreviewError('')

    if (defCacheRef.current.has(k)) {
      setPreviewDef(defCacheRef.current.get(k))
      setPreviewLoading(false)
      return
    }

    if (obj.definition) {
      defCacheRef.current.set(k, obj.definition)
      setPreviewDef(obj.definition)
      setPreviewLoading(false)
      return
    }

    setPreviewLoading(true)
    setPreviewDef('')
    try {
      const api = await go()
      const filled = await api.GetDefinition(workspaceId, obj)
      defCacheRef.current.set(k, filled.definition)
      setPreviewDef(filled.definition)
    } catch (e) {
      setPreviewError(e.toString())
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewObj(null)
    setPreviewDef('')
    setPreviewError('')
  }

  const handlePickDir = async () => {
    try {
      const api = await go()
      const path = await api.PickDirectory()
      if (path) setOutDir(path)
      return path
    } catch {
      return ''
    }
  }

  const handleExport = async () => {
    if (selected.size === 0 || exporting) return
    if (!outDir) {
      const dir = await handlePickDir()
      if (!dir) return
      startExport(dir)
      return
    }
    startExport(outDir)
  }

  const startExport = async (targetDir) => {
    setExporting(true)
    setExportProgress({ current: 0, total: selected.size, percent: 0 })
    try {
      const api = await go()
      const objsToExport = Array.from(selected)
        .map(k => knownRef.current.get(k))
        .filter(Boolean)
      await api.ExportObjects(workspaceId, {
        workspaceId,
        objects: objsToExport,
        outDir: targetDir,
      })
    } catch (e) {
      setExportProgress(prev => ({ ...prev, error: e.toString() }))
      setExporting(false)
    }
  }

  const handleCancelExport = async () => {
    try {
      const api = await go()
      await api.CancelExport(workspaceId)
    } catch { /* ignore */ }
  }

  const handleOpenFolder = () => {
    if (outDir) {
      import('../../wailsjs/runtime/runtime').then(({ BrowserOpenURL }) =>
        BrowserOpenURL(`file://${outDir}`)
      )
    }
  }

  const openScriptInQuery = (sql, title) => {
    setIncomingSql({ text: sql, title, nonce: Date.now() })
    setView('query')
  }

  const resolveTableOrObject = async (tableRef) => {
    if (!tableRef || !connInfo) return null
    let schema = ''
    let tableName = tableRef
    if (tableRef.includes('.')) {
      const parts = tableRef.split('.')
      schema = parts[0]
      tableName = parts.slice(1).join('.')
    }

    let targetObj = null
    const priorityTypes = ['TABLE', 'VIEW', 'STORED_PROCEDURE', 'FUNCTION']
    for (const t of priorityTypes) {
      for (const o of knownRef.current.values()) {
        if (o.type === t && o.name.toLowerCase() === tableName.toLowerCase()) {
          if (!schema || (o.schema && o.schema.toLowerCase() === schema.toLowerCase())) {
            targetObj = o
            break
          }
        }
      }
      if (targetObj) break
    }

    if (!targetObj) {
      try {
        const api = await go()
        for (const t of priorityTypes) {
          const matches = await api.ListObjects(workspaceId, t, tableName, 10)
          if (matches && matches.length > 0) {
            const exact = matches.find(m =>
              m.name.toLowerCase() === tableName.toLowerCase() &&
              (!schema || (m.schema && m.schema.toLowerCase() === schema.toLowerCase()))
            )
            if (exact) {
              targetObj = exact
              break
            } else if (!targetObj) {
              targetObj = matches[0]
            }
          }
        }
      } catch { /* ignore */ }
    }

    if (!targetObj) {
      targetObj = {
        type: 'TABLE',
        schema: schema || (connInfo?.dbType === 'POSTGRESQL' ? 'public' : 'dbo'),
        name: tableName,
      }
    }
    return targetObj
  }

  const handleOpenTableDefinition = async (tableRef) => {
    const targetObj = await resolveTableOrObject(tableRef)
    if (!targetObj) return

    setView('objects')
    setRelationsObj(null)
    setScriptsObj(null)
    setDebugObj(null)
    if (objType !== targetObj.type) {
      setObjType(targetObj.type)
      setSearch('')
      setFilteredCount(null)
      setSelected(new Set())
      setSelectingAll(false)
      loadObjects(targetObj.type, connInfo, false, '')
    }
    handlePreview(targetObj)
  }

  const handleOpenTableRelations = async (tableRef) => {
    const targetObj = await resolveTableOrObject(tableRef)
    if (!targetObj) return

    setView('objects')
    setPreviewObj(null)
    setScriptsObj(null)
    setDebugObj(null)
    if (objType !== 'TABLE') {
      setObjType('TABLE')
      setSearch('')
      setFilteredCount(null)
      setSelected(new Set())
      setSelectingAll(false)
      loadObjects('TABLE', connInfo, false, '')
    }
    setRelationsObj(targetObj)
  }

  const handleOpenTableScripts = async (tableRef) => {
    const targetObj = await resolveTableOrObject(tableRef)
    if (!targetObj) return

    setView('objects')
    setPreviewObj(null)
    setRelationsObj(null)
    setDebugObj(null)
    if (objType !== 'TABLE') {
      setObjType('TABLE')
      setSearch('')
      setFilteredCount(null)
      setSelected(new Set())
      setSelectingAll(false)
      loadObjects('TABLE', connInfo, false, '')
    }
    setScriptsObj(targetObj)
  }

  // Opens the debugger for a procedure call captured in the trace, with its parameters prefilled.
  const debugFromTrace = async (ev) => {
    const api = await go()
    const pre = await api.PrepareProcedureDebug(workspaceId, ev.object || '', ev.text || '')
    setView('objects')
    handleTypeChange('STORED_PROCEDURE')
    setDebugInit({ args: pre.args || [], parsed: pre.parsed })
    setDebugFrom('trace')
    setDebugKey(k => k + 1)
    setDebugObj({ type: 'STORED_PROCEDURE', schema: pre.schema, name: pre.name })
  }

  const openDebugFromExplorer = (obj) => {
    setDebugInit(null)
    setDebugFrom('explorer')
    setDebugKey(k => k + 1)
    setDebugObj(obj)
  }

  const closeDebug = () => {
    setDebugObj(null)
    if (debugFrom === 'trace') setView('trace')
  }

  const openTableFromRelations = (schema, name) => {
    setRelationsObj(null)
    setObjType('TABLE')
    setSearch(name)
  }

  const ObjTypeIcon = OBJECT_TYPES.find(t => t.value === objType)?.icon || Database
  const selectedCount = selected.size

  return (
    <div className={clsx('flex-1 flex overflow-hidden', !isActive && 'hidden')}>
      {/* Sidebar: object types + tools (Consultas, Traza) */}
      <aside
        className="w-52 flex-shrink-0 border-r border-surface-600 flex flex-col py-3 gap-1 px-2 select-none overflow-y-auto"
        style={{ background: 'rgba(11,16,26,0.8)' }}
      >
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1">Object Type</p>
        {OBJECT_TYPES.map(({ value, label, icon: Icon }) => (
          <SidebarItem
            key={value}
            icon={Icon}
            label={label}
            selected={!!connInfo && view === 'objects' && value === objType}
            disabled={!connInfo}
            onClick={() => { setView('objects'); handleTypeChange(value) }}
          />
        ))}

        {connInfo && (
          <>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mt-4 mb-1">Herramientas</p>
            <SidebarItem
              icon={Terminal}
              label="Consultas"
              selected={view === 'query'}
              onClick={() => setView('query')}
            />
            {/* Trace (Extended Events) only exists for SQL Server connections */}
            {connInfo.dbType === 'SQL_SERVER' && (
              <SidebarItem
                icon={Activity}
                label="Traza"
                selected={view === 'trace'}
                onClick={() => setView('trace')}
              />
            )}
          </>
        )}
      </aside>

      {/* Content area: every view lives here */}
      <div className="flex-1 flex overflow-hidden min-w-0">
      {/* Query workspace stays mounted (hidden) so its tabs survive view switches */}
      {connInfo && (
        <div className={clsx('flex-1 flex flex-col overflow-hidden', view !== 'query' && 'hidden')}>
          <QueryWorkspace
            key={connSeq}
            workspaceId={workspaceId}
            connLabel={`${connInfo.dbName} · ${DB_LABELS[connInfo.dbType] || connInfo.dbType}`}
            dbType={connInfo.dbType}
            incomingSql={incomingSql}
            active={isActive && view === 'query'}
            onOpenInQuery={openScriptInQuery}
            onOpenTableDefinition={handleOpenTableDefinition}
            onOpenTableRelations={handleOpenTableRelations}
            onOpenTableScripts={handleOpenTableScripts}
          />
        </div>
      )}

      {/* Trace stays mounted (hidden) so a running trace keeps collecting while you switch views */}
      {connInfo?.dbType === 'SQL_SERVER' && (
        <div className={clsx('flex-1 flex flex-col overflow-hidden', view !== 'trace' && 'hidden')}>
          <TracePanel
            key={connSeq}
            workspaceId={workspaceId}
            connInfo={connInfo}
            active={isActive && view === 'trace'}
            onOpenInQuery={openScriptInQuery}
            onDebugProc={debugFromTrace}
          />
        </div>
      )}

      {/* Main Panel: object explorer */}
      <main className={clsx('flex-1 flex flex-col overflow-hidden p-4 gap-4 min-w-0', connInfo && view !== 'objects' && 'hidden')}>
            {!connInfo ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <div className="relative p-4 rounded-2xl flex items-center justify-center">
                  <div
                    className="absolute inset-0 m-auto w-48 h-48 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(0, 150, 199, 0.15) 0%, transparent 70%)' }}
                  />
                  <img
                    src={appIcon}
                    alt="SapiExtractor"
                    className="relative w-48 h-48 object-contain animate-heartbeat select-none cursor-pointer"
                  />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-white mb-1">Espacio de trabajo {workspaceId} sin conexión</h2>
                  {pendingConn ? (
                    <p className="text-sm text-slate-500 mb-4">
                      En tu sesión anterior este espacio estaba conectado a <span className="text-slate-300 font-medium">{pendingConn.dbName}</span>{' '}
                      ({pendingConn.host}). Tus consultas de esa base se recuperan al reconectar.
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500 mb-4">Conéctate a una base de datos para comenzar a explorar y consultar.</p>
                  )}
                  <button onClick={() => onOpenConnDialog(pendingConn || null)} className="btn-primary">
                    <Plug className="w-4 h-4" />
                    {pendingConn ? 'Reconectar' : 'Conectar a base de datos'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <ObjTypeIcon className="w-4 h-4 text-brand-light" />
                    <span className="text-sm font-semibold text-white">
                      {OBJECT_TYPES.find(t => t.value === objType)?.label}
                    </span>
                    {search && filteredCount !== null ? (
                      <span
                        className="badge-blue"
                        title={`${objects.length} mostrados de ${filteredCount.toLocaleString()} coincidentes (Total en BD: ${totalCount?.toLocaleString() || 'desconocido'})`}
                      >
                        {filteredCount.toLocaleString()} coincidentes
                      </span>
                    ) : totalCount !== null ? (
                      <span
                        className="badge-blue"
                        title={`Total en BD: ${totalCount.toLocaleString()} objetos (${objects.length} cargados en vista)`}
                      >
                        {totalCount.toLocaleString()}
                      </span>
                    ) : objects.length > 0 && (
                      <span className="badge-blue" title={hasMore ? 'Hay más: usa el buscador' : undefined}>
                        {objects.length}{hasMore ? '+' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={refreshObjects}
                    disabled={loadingObjects}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    <RefreshCw className={clsx('w-3.5 h-3.5', loadingObjects && 'animate-spin')} />
                    Refresh
                  </button>
                  <button
                    onClick={handlePickDir}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {outDir ? <span className="max-w-[120px] truncate">{outDir.split(/[\\/]/).pop()}</span> : 'Output folder'}
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={exporting || selectedCount === 0}
                    className="btn-primary text-xs py-1.5 px-3"
                  >
                    {exporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Export {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </button>
                </div>

                {/* Error message */}
                {objError && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex-shrink-0">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {objError}
                  </div>
                )}

                {/* Content: ObjectTable / ScriptsPanel / RelationsPanel / PreviewPanel */}
                <div className="flex-1 overflow-hidden">
                  {loadingObjects ? (
                    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  ) : debugObj ? (
                    <ErrorBoundary title="Error en el panel de depuración" onReset={closeDebug}>
                      <DebugPanel
                        key={debugKey}
                        workspaceId={workspaceId}
                        obj={debugObj}
                        initial={debugInit}
                        onBack={closeDebug}
                        onOpenInQuery={openScriptInQuery}
                      />
                    </ErrorBoundary>
                  ) : scriptsObj ? (
                    <ScriptsPanel
                      workspaceId={workspaceId}
                      obj={scriptsObj}
                      onBack={() => setScriptsObj(null)}
                      onOpenInQuery={openScriptInQuery}
                    />
                  ) : relationsObj ? (
                    <RelationsPanel
                      workspaceId={workspaceId}
                      obj={relationsObj}
                      onBack={() => setRelationsObj(null)}
                      onOpenTable={openTableFromRelations}
                    />
                  ) : previewObj ? (
                    <PreviewPanel
                      workspaceId={workspaceId}
                      obj={previewObj}
                      typeLabel={OBJECT_TYPES.find(t => t.value === objType)?.label || objType}
                      definition={previewDef}
                      loading={previewLoading}
                      error={previewError}
                      onRefresh={() => { defCacheRef.current.delete(objKey(previewObj)); handlePreview(previewObj) }}
                      onBack={closePreview}
                      onDebug={previewObj.type === 'STORED_PROCEDURE' && connInfo?.dbType === 'SQL_SERVER'
                        ? () => openDebugFromExplorer(previewObj)
                        : undefined}
                      onEdit={['STORED_PROCEDURE', 'FUNCTION', 'VIEW', 'TRIGGER'].includes(previewObj.type)
                        ? () => openScriptInQuery(previewDef, previewObj.name)
                        : undefined}
                    />
                  ) : (
                    <ObjectTable
                      objects={objects}
                      selectedKeys={selected}
                      onSelectionChange={setSelected}
                      onPreview={handlePreview}
                      search={search}
                      onSearchChange={handleSearchChange}
                      searching={searching}
                      hasMore={hasMore}
                      totalCount={totalCount}
                      filteredCount={filteredCount}
                      onRelations={objType === 'TABLE' ? setRelationsObj : undefined}
                      onScripts={objType === 'TABLE' ? setScriptsObj : undefined}
                      previewKey={previewObj ? objKey(previewObj) : ''}
                      objType={objType}
                      onSelectAllServer={handleSelectAllServer}
                      selectingAll={selectingAll}
                    />
                  )}
                </div>

                {/* Export bar */}
                {exportProgress && (
                  <div className="flex-shrink-0">
                    <ExportBar
                      progress={exportProgress}
                      onCancel={handleCancelExport}
                      onOpenFolder={handleOpenFolder}
                    />
                  </div>
                )}
              </>
            )}
      </main>
      </div>
    </div>
  )
}

// One entry of the left navigation bar.
function SidebarItem({ icon: Icon, label, selected, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left',
        selected
          ? 'text-brand-light border border-brand-dark/50'
          : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700/40',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
      style={selected ? { background: 'linear-gradient(135deg, rgba(0,74,119,0.3), rgba(0,119,182,0.15))' } : {}}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}
