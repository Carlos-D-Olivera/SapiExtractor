import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database, Plug, PlugZap, RefreshCw, Download, ChevronDown,
  Server, Table2, Columns, FunctionSquare, Zap, Eye, Loader2,
  AlertCircle, FolderOpen
} from 'lucide-react'
import clsx from 'clsx'

import ConnectionDialog from './components/ConnectionDialog'
import ObjectTable from './components/ObjectTable'
import ExportBar from './components/ExportBar'
import PreviewPanel from './components/PreviewPanel'

// ---------- Constants ----------
const OBJECT_TYPES = [
  { value: 'STORED_PROCEDURE', label: 'Stored Procedures', icon: Database },
  { value: 'TABLE',            label: 'Tables',            icon: Table2 },
  { value: 'COLUMN',           label: 'Columns',           icon: Columns },
  { value: 'FUNCTION',         label: 'Functions',         icon: FunctionSquare },
  { value: 'TRIGGER',          label: 'Triggers',          icon: Zap },
  { value: 'VIEW',             label: 'Views',             icon: Eye },
]

const DB_LABELS = {
  SQL_SERVER: 'SQL Server',
  MYSQL: 'MySQL',
  POSTGRESQL: 'PostgreSQL',
}

// ---------- Lazy Wails bindings ----------
let goApp = null
async function go() {
  if (!goApp) {
    goApp = await import('../wailsjs/go/main/App')
  }
  return goApp
}

// ---------- Main App ----------
export default function App() {
  const [showConnDialog, setShowConnDialog] = useState(false)
  const [connInfo, setConnInfo] = useState(null)        // current connection
  const [savedConns, setSavedConns] = useState([])
  const [objType, setObjType] = useState('STORED_PROCEDURE')
  const [objects, setObjects] = useState([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [objError, setObjError] = useState('')
  const [selected, setSelected] = useState(new Set())   // Set of objKey strings
  const [outDir, setOutDir] = useState('')
  const [exportProgress, setExportProgress] = useState(null)
  const [exporting, setExporting] = useState(false)
  const cacheRef = useRef(new Map())         // objType -> DbObject[] (parity with Java cache)
  const [previewObj, setPreviewObj] = useState(null)
  const [previewDef, setPreviewDef] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  // ---- Load saved connections ----
  const loadSavedConns = useCallback(async () => {
    try {
      const api = await go()
      const list = await api.LoadConnections()
      setSavedConns(list || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSavedConns() }, [loadSavedConns])

  // ---- Wails event listeners ----
  useEffect(() => {
    let unlisten1, unlisten2, unlisten3, unlisten4
    ;(async () => {
      const { EventsOn } = await import('../wailsjs/runtime/runtime')
      unlisten1 = EventsOn('export:progress', data => {
        setExportProgress({ ...data })
      })
      unlisten2 = EventsOn('export:done', data => {
        setExportProgress(prev => ({ ...prev, done: true, ...data }))
        setExporting(false)
      })
      unlisten3 = EventsOn('export:error', data => {
        setExportProgress(prev => ({ ...prev, error: data.error }))
      })
      unlisten4 = EventsOn('export:cancelled', data => {
        setExportProgress(prev => ({ ...prev, cancelled: true, ...data }))
        setExporting(false)
      })
    })()
    return () => {
      unlisten1?.()
      unlisten2?.()
      unlisten3?.()
      unlisten4?.()
    }
  }, [])

  // ---- After connection ----
  const handleConnected = async (info) => {
    setConnInfo(info)
    setShowConnDialog(false)
    cacheRef.current.clear()
    setObjects([])
    setSelected(new Set())
    setObjError('')
    setExportProgress(null)
    setPreviewObj(null)
    setPreviewDef('')
    setPreviewError('')
    // Save to history
    try {
      const api = await go()
      await api.SaveConnection({
        dbType: info.dbType,
        host: info.host,
        port: info.port,
        dbName: info.dbName,
        user: info.user,
        rememberPassword: info.rememberPassword,
        passwordBase64: info.rememberPassword ? btoa(info.password) : '',
        lastUsed: Date.now(),
      })
      await loadSavedConns()
    } catch { /* ignore */ }
    // Auto-load objects
    loadObjects('STORED_PROCEDURE', info)
  }

  const handleDisconnect = async () => {
    try {
      const api = await go()
      await api.Disconnect()
    } catch { /* ignore */ }
    cacheRef.current.clear()
    setConnInfo(null)
    setObjects([])
    setSelected(new Set())
    setExportProgress(null)
    setPreviewObj(null)
    setPreviewDef('')
    setPreviewError('')
  }

  const handleDeleteSaved = async (conn) => {
    try {
      const api = await go()
      await api.DeleteConnection(conn)
      await loadSavedConns()
    } catch { /* ignore */ }
  }

  // ---- Object listing (cached per type, like the Java app) ----
  const loadObjects = useCallback(async (type, info, force = false) => {
    if (!force && cacheRef.current.has(type)) {
      setObjects(cacheRef.current.get(type))
      setSelected(new Set())
      setObjError('')
      return
    }
    setLoadingObjects(true)
    setObjError('')
    setObjects([])
    setSelected(new Set())
    try {
      const api = await go()
      const list = await api.ListObjects(type)
      cacheRef.current.set(type, list || [])
      setObjects(list || [])
    } catch (e) {
      setObjError(e.toString())
    } finally {
      setLoadingObjects(false)
    }
  }, [])

  const handleTypeChange = (type) => {
    setObjType(type)
    setPreviewObj(null)
    setPreviewDef('')
    setPreviewError('')
    if (connInfo) loadObjects(type, connInfo)
  }

  // ---- Preview (parity with the Java MainFrame preview panel) ----
  const handlePreview = useCallback(async (obj) => {
    if (!obj) return
    setPreviewObj(obj)
    setPreviewDef('')
    setPreviewError('')
    setPreviewLoading(true)
    try {
      const api = await go()
      const result = await api.GetDefinition(obj)
      setPreviewDef(result?.definition || '')
    } catch (e) {
      setPreviewError(e.toString())
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const closePreview = () => {
    setPreviewObj(null)
    setPreviewDef('')
    setPreviewError('')
  }

  // F5 reloads the current preview, Escape returns to the list (Java shortcuts)
  useEffect(() => {
    const onKey = (e) => {
      if (!previewObj) return
      if (e.key === 'F5') {
        e.preventDefault()
        handlePreview(previewObj)
      } else if (e.key === 'Escape') {
        closePreview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- Export ----
  const handlePickDir = async () => {
    try {
      const api = await go()
      const dir = await api.PickDirectory()
      if (dir) setOutDir(dir)
    } catch { /* ignore */ }
  }

  const handleExport = async () => {
    if (!outDir) {
      await handlePickDir()
      return
    }
    const selectedObjs = objects.filter(o => selected.has(objKey(o)))
    if (selectedObjs.length === 0) return
    setExporting(true)
    setExportProgress({ current: 0, total: selectedObjs.length, percent: 0, name: '' })
    try {
      const api = await go()
      await api.ExportObjects({ objects: selectedObjs, outDir })
    } catch (e) {
      setExportProgress(prev => ({ ...prev, error: e.toString() }))
      setExporting(false)
    }
  }

  const handleCancelExport = async () => {
    try {
      const api = await go()
      await api.CancelExport()
    } catch { /* ignore */ }
  }

  const handleOpenFolder = () => {
    if (outDir) {
      // Use shell open via Wails
      import('../wailsjs/runtime/runtime').then(({ BrowserOpenURL }) =>
        BrowserOpenURL(`file://${outDir}`)
      )
    }
  }

  // ---- Helpers ----
  const ObjTypeIcon = OBJECT_TYPES.find(t => t.value === objType)?.icon || Database
  const selectedCount = selected.size

  // ---- Render ----
  return (
    <div className="h-full flex flex-col bg-surface-900">
      {/* ── Top Bar ── */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-surface-600 flex-shrink-0"
              style={{ background: 'rgba(13,21,32,0.95)', backdropFilter: 'blur(8px)' }}>
        {/* Logo / Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg"
               style={{ background: 'linear-gradient(135deg, #004A77, #0077B6)' }}>
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">SpExtractor</h1>
            <p className="text-[10px] text-slate-500 -mt-0.5">Database Object Extractor</p>
          </div>
        </div>

        <div className="flex-1" />

        {/* Connection status */}
        {connInfo ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass text-xs">
              <span className="status-dot-green" />
              <span className="text-slate-300 font-medium">
                {connInfo.dbName}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-500">{DB_LABELS[connInfo.dbType] || connInfo.dbType}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-500">{connInfo.host}</span>
            </div>
            <button onClick={handleDisconnect} className="btn-danger text-xs py-1.5 px-3">
              <PlugZap className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={() => setShowConnDialog(true)} className="btn-primary">
            <Plug className="w-3.5 h-3.5" />
            Connect
          </button>
        )}
      </header>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar: Object Type Picker ── */}
        <aside className="w-52 flex-shrink-0 border-r border-surface-600 flex flex-col py-3 gap-1 px-2"
               style={{ background: 'rgba(11,16,26,0.8)' }}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1">Object Type</p>
          {OBJECT_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => handleTypeChange(value)}
              disabled={!connInfo}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left',
                value === objType && connInfo
                  ? 'text-brand-light border border-brand-dark/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700/40',
                !connInfo && 'opacity-30 cursor-not-allowed',
              )}
              style={value === objType && connInfo ? {
                background: 'linear-gradient(135deg, rgba(0,74,119,0.3), rgba(0,119,182,0.15))',
              } : {}}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </aside>

        {/* ── Main Panel ── */}
        <main className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          {!connInfo ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="p-5 rounded-2xl"
                   style={{ background: 'rgba(0,74,119,0.15)', border: '1px solid rgba(0,74,119,0.3)' }}>
                <Database className="w-12 h-12 text-brand-dark opacity-60" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">No connection</h2>
                <p className="text-sm text-slate-500 mb-4">Connect to a database to start extracting objects.</p>
                <button onClick={() => setShowConnDialog(true)} className="btn-primary">
                  <Plug className="w-4 h-4" />
                  Connect to database
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
                  {objects.length > 0 && (
                    <span className="badge-blue">{objects.length}</span>
                  )}
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => loadObjects(objType, connInfo, true)}
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

              {/* Error */}
              {objError && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex-shrink-0">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {objError}
                </div>
              )}

              {/* Object table / Preview */}
              <div className="flex-1 overflow-hidden">
                {loadingObjects ? (
                  <div className="flex items-center justify-center h-full gap-3 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : previewObj ? (
                  <PreviewPanel
                    obj={previewObj}
                    typeLabel={OBJECT_TYPES.find(t => t.value === objType)?.label || objType}
                    definition={previewDef}
                    loading={previewLoading}
                    error={previewError}
                    onRefresh={() => handlePreview(previewObj)}
                    onBack={closePreview}
                  />
                ) : (
                  <ObjectTable
                    objects={objects}
                    selectedKeys={selected}
                    onSelectionChange={setSelected}
                    onPreview={handlePreview}
                    previewKey={previewObj ? objKey(previewObj) : ''}
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

      {/* Connection dialog */}
      {showConnDialog && (
        <ConnectionDialog
          onConnect={handleConnected}
          onClose={() => setShowConnDialog(false)}
          savedConnections={savedConns}
          onDeleteConnection={handleDeleteSaved}
        />
      )}
    </div>
  )
}

function objKey(obj) {
  return `${obj.schema}|${obj.name}|${obj.type}`
}
