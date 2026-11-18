import { useState, useEffect, useRef, useMemo } from 'react'
import { AlertCircle, Play, Square } from 'lucide-react'
import ScriptRunnerToolbar from './ScriptRunnerToolbar'
import ScriptList from './ScriptList'
import ScriptFolderTree from './ScriptFolderTree'
import ScriptContentPanel from './ScriptContentPanel'
import ScriptResultPanel from './ScriptResultPanel'

let goApp = null
async function go() {
  if (!goApp) {
    goApp = await import('../../wailsjs/go/main/App')
  }
  return goApp
}

function sortScripts(list, order, folderOrder = 'asc') {
  const copy = [...list]
  switch (order) {
    case 'name-asc':
      return copy.sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' })
      )
    case 'name-desc':
      return copy.sort((a, b) =>
        b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: 'base' })
      )
    case 'date-asc':
      return copy.sort((a, b) => (a.modTime || 0) - (b.modTime || 0))
    case 'date-desc':
      return copy.sort((a, b) => (b.modTime || 0) - (a.modTime || 0))
    case 'folder-name-asc':
      return copy.sort((a, b) => {
        const fA = a.folder || ''
        const fB = b.folder || ''
        const fCmp = folderOrder === 'desc'
          ? fB.localeCompare(fA, undefined, { numeric: true, sensitivity: 'base' })
          : fA.localeCompare(fB, undefined, { numeric: true, sensitivity: 'base' })
        if (fCmp !== 0) return fCmp
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' })
      })
    case 'folder-name-desc':
      return copy.sort((a, b) => {
        const fA = a.folder || ''
        const fB = b.folder || ''
        const fCmp = folderOrder === 'desc'
          ? fB.localeCompare(fA, undefined, { numeric: true, sensitivity: 'base' })
          : fA.localeCompare(fB, undefined, { numeric: true, sensitivity: 'base' })
        if (fCmp !== 0) return fCmp
        return b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: 'base' })
      })
    default:
      return copy
  }
}

export default function ScriptRunnerView({
  workspaceId,
  connInfo,
  active,
  onOpenInQuery,
}) {
  const [scripts, setScripts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [rootFolderName, setRootFolderName] = useState('Carpeta Raíz')
  const [runnerState, setRunnerState] = useState('idle') // 'idle' | 'running' | 'paused' | 'done'
  const [sortOrder, setSortOrder] = useState('name-asc')
  const [folderOrder, setFolderOrder] = useState('asc')
  const [runningScriptId, setRunningScriptId] = useState(null)
  const [pausedIndex, setPausedIndex] = useState(0)

  // Resizing state
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem('spextractor:scripts-left-width')
    return saved ? Number(saved) : 380
  })
  const [contentHeight, setContentHeight] = useState(() => {
    const saved = localStorage.getItem('spextractor:scripts-content-height')
    return saved ? Number(saved) : null
  })
  const rightContainerRef = useRef(null)
  const contentPanelRef = useRef(null)

  // Content viewer state
  const [contentCache, setContentCache] = useState({}) // { [path]: string }
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState('')

  // Results state: { [scriptId]: { success: boolean, response: QueryResponse, error: string, durationMs: number } }
  const [results, setResults] = useState({})

  const abortRef = useRef(false)
  const scriptsRef = useRef(scripts)
  scriptsRef.current = scripts

  // Scripts filtered for the currently selected folder
  const displayedScripts = useMemo(() => {
    return scripts.filter((s) => (s.folder || '') === selectedFolderId)
  }, [scripts, selectedFolderId])

  const displayedScriptsRef = useRef(displayedScripts)
  displayedScriptsRef.current = displayedScripts

  const selectedScript = useMemo(() => {
    return scripts.find((s) => s.id === selectedId) || null
  }, [scripts, selectedId])

  const hasFolders = useMemo(() => {
    return scripts.some((s) => !!s.folder)
  }, [scripts])

  // Automatically select the first script of the active folder if the current selection is outside
  useEffect(() => {
    if (displayedScripts.length > 0) {
      const isCurrentInDisplayed = displayedScripts.some((s) => s.id === selectedId)
      if (!isCurrentInDisplayed) {
        setSelectedId(displayedScripts[0].id)
      }
    } else {
      setSelectedId(null)
    }
  }, [displayedScripts, selectedId])

  // Lazy load content when selected script changes
  useEffect(() => {
    if (!selectedScript) {
      setContentError('')
      return
    }

    const path = selectedScript.path
    if (contentCache[path]) {
      setContentError('')
      return
    }

    let cancelled = false
    setLoadingContent(true)
    setContentError('')

    ;(async () => {
      try {
        const api = await go()
        const text = await api.ReadSqlFile(path)
        if (!cancelled) {
          setContentCache((prev) => ({ ...prev, [path]: text }))
        }
      } catch (err) {
        if (!cancelled) {
          setContentError(err?.message || String(err))
        }
      } finally {
        if (!cancelled) {
          setLoadingContent(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedScript, contentCache])

  // Horizontal resizing (Left to Right)
  const startHorizontalResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftPanelWidth
    const move = (ev) => {
      const newW = Math.max(260, Math.min(window.innerWidth * 0.65, startW + ev.clientX - startX))
      setLeftPanelWidth(newW)
      localStorage.setItem('spextractor:scripts-left-width', String(Math.round(newW)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Vertical resizing (Content Top to Bottom)
  const startVerticalResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const currentH = contentPanelRef.current?.getBoundingClientRect().height || 300
    const move = (ev) => {
      const containerH = rightContainerRef.current?.getBoundingClientRect().height || 600
      const minH = 100
      const maxH = containerH - 100
      const newH = Math.max(minH, Math.min(maxH, currentH + ev.clientY - startY))
      setContentHeight(newH)
      localStorage.setItem('spextractor:scripts-content-height', String(Math.round(newH)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Handle adding new files
  const handleOpenFiles = async () => {
    try {
      const api = await go()
      const files = await api.OpenMultipleSqlFiles()
      if (!files || files.length === 0) return

      setScripts((prev) => {
        const existingPaths = new Set(prev.map((s) => s.path))
        const newItems = files
          .filter((f) => !existingPaths.has(f.path))
          .map((f) => ({
            ...f,
            enabled: true,
            status: 'idle',
          }))

        const combined = [...prev, ...newItems]
        const sorted = sortOrder !== 'manual' ? sortScripts(combined, sortOrder, folderOrder) : combined
        return sorted
      })
    } catch { /* ignore user cancellation */ }
  }

  // Handle adding a folder
  const handleOpenFolder = async () => {
    try {
      const api = await go()
      const folderPath = await api.PickSqlDirectory()
      if (!folderPath) return

      const files = await api.ScanSqlFolder(folderPath)
      if (!files || files.length === 0) return

      const baseName = folderPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'Carpeta'
      setRootFolderName(baseName)

      // Auto-select root if it has scripts, otherwise select the first subfolder with scripts
      const rootHasFiles = files.some((f) => !f.folder)
      let initialFolder = ''
      if (!rootHasFiles && files.length > 0) {
        initialFolder = files[0].folder || ''
      }
      setSelectedFolderId(initialFolder)

      setScripts((prev) => {
        const existingPaths = new Set(prev.map((s) => s.path))
        const newItems = files
          .filter((f) => !existingPaths.has(f.path))
          .map((f) => ({
            ...f,
            enabled: true,
            status: 'idle',
          }))

        const combined = [...prev, ...newItems]
        const sorted = sortOrder !== 'manual' ? sortScripts(combined, sortOrder, folderOrder) : combined
        return sorted
      })
    } catch { /* ignore */ }
  }

  // Handle sorting change
  const handleSortChange = (newOrder) => {
    setSortOrder(newOrder)
    if (newOrder !== 'manual') {
      setScripts((prev) => sortScripts(prev, newOrder, folderOrder))
    }
  }

  const handleFolderOrderChange = (newFolderOrder) => {
    setFolderOrder(newFolderOrder)
    if (sortOrder.startsWith('folder-')) {
      setScripts((prev) => sortScripts(prev, sortOrder, newFolderOrder))
    }
  }

  // Handle reorder from drag and drop: updates the order of the displayed subset within scripts
  const handleReorder = (newDisplayedList) => {
    setSortOrder('manual')
    setScripts((prev) => {
      let dispIdx = 0
      return prev.map((s) => {
        if ((s.folder || '') === selectedFolderId) {
          return newDisplayedList[dispIdx++]
        }
        return s
      })
    })
  }

  const handleToggleCheck = (id, checked) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: checked } : s))
    )
  }

  const handleSelectAll = () => {
    setScripts((prev) =>
      prev.map((s) =>
        (s.folder || '') === selectedFolderId ? { ...s, enabled: true } : s
      )
    )
  }

  const handleDeselectAll = () => {
    setScripts((prev) =>
      prev.map((s) =>
        (s.folder || '') === selectedFolderId ? { ...s, enabled: false } : s
      )
    )
  }

  const handleResetStatus = () => {
    const currentFolderIds = new Set(displayedScripts.map((s) => s.id))
    setScripts((prev) =>
      prev.map((s) =>
        currentFolderIds.has(s.id) ? { ...s, status: 'idle', durationMs: undefined } : s
      )
    )
    setResults((prev) => {
      const next = { ...prev }
      currentFolderIds.forEach((id) => delete next[id])
      return next
    })
    setRunnerState('idle')
    setPausedIndex(0)
  }

  const handleClearList = () => {
    setScripts([])
    setSelectedId(null)
    setSelectedFolderId('')
    setResults({})
    setContentCache({})
    setRunnerState('idle')
    setPausedIndex(0)
  }

  // Run a single script
  const handleRunSingle = async (script) => {
    if (!connInfo) return
    const id = script.id
    setRunningScriptId(id)
    setSelectedId(id)
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'running' } : s))
    )

    const startTime = Date.now()
    try {
      const api = await go()
      const resp = await api.ExecuteScriptFile(workspaceId, script.path, 1000)
      const duration = resp?.durationMs || (Date.now() - startTime)

      setResults((prev) => ({
        ...prev,
        [id]: {
          success: true,
          response: resp,
          durationMs: duration,
        },
      }))

      setScripts((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: 'success', durationMs: duration } : s
        )
      )
    } catch (err) {
      const errMsg = err?.message || String(err)
      const duration = Date.now() - startTime

      setResults((prev) => ({
        ...prev,
        [id]: {
          success: false,
          error: errMsg,
          durationMs: duration,
        },
      }))

      setScripts((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: 'failed', durationMs: duration } : s
        )
      )
    } finally {
      setRunningScriptId(null)
    }
  }

  // Sequential execution engine running ONLY on the currently displayed folder scripts
  const executeSequential = async (startIndex) => {
    if (!connInfo) return
    abortRef.current = false
    setRunnerState('running')

    const currentList = displayedScriptsRef.current
    for (let i = startIndex; i < currentList.length; i++) {
      if (abortRef.current) break

      const currentScript = displayedScriptsRef.current[i]
      if (!currentScript.enabled) continue

      setSelectedId(currentScript.id)
      setRunningScriptId(currentScript.id)
      setScripts((prev) =>
        prev.map((s) =>
          s.id === currentScript.id ? { ...s, status: 'running' } : s
        )
      )

      const startTime = Date.now()
      let isSuccess = false
      let queryResp = null
      let queryError = ''

      try {
        const api = await go()
        queryResp = await api.ExecuteScriptFile(workspaceId, currentScript.path, 1000)
        isSuccess = true
      } catch (err) {
        queryError = err?.message || String(err)
        isSuccess = false
      }

      if (abortRef.current) break

      const duration = queryResp?.durationMs || (Date.now() - startTime)

      if (isSuccess) {
        setResults((prev) => ({
          ...prev,
          [currentScript.id]: {
            success: true,
            response: queryResp,
            durationMs: duration,
          },
        }))

        setScripts((prev) =>
          prev.map((s) =>
            s.id === currentScript.id
              ? { ...s, status: 'success', durationMs: duration }
              : s
          )
        )
      } else {
        // Script failed!
        setResults((prev) => ({
          ...prev,
          [currentScript.id]: {
            success: false,
            error: queryError,
            durationMs: duration,
          },
        }))

        setScripts((prev) =>
          prev.map((s) =>
            s.id === currentScript.id
              ? { ...s, status: 'failed', durationMs: duration }
              : s
          )
        )

        // Pause execution on failure so user inspects the error and can resume
        setRunnerState('paused')
        setPausedIndex(i)
        setRunningScriptId(null)
        return
      }
    }

    setRunningScriptId(null)
    if (!abortRef.current) {
      setRunnerState('done')
    } else {
      setRunnerState('idle')
    }
  }

  const handleRunList = () => {
    executeSequential(0)
  }

  const handleResume = () => {
    const list = displayedScriptsRef.current
    const currentScript = list[pausedIndex]
    const nextIndex = currentScript && currentScript.status === 'success'
      ? pausedIndex + 1
      : pausedIndex
    executeSequential(nextIndex)
  }

  const handleStop = async () => {
    abortRef.current = true
    try {
      const api = await go()
      await api.CancelQuery(workspaceId)
    } catch { /* ignore */ }
    setRunnerState('idle')
    setRunningScriptId(null)
  }

  // Counters calculated for the currently loaded folder
  const scriptsCount = displayedScripts.length
  const enabledCount = displayedScripts.filter((s) => s.enabled).length
  const successCount = displayedScripts.filter((s) => s.status === 'success').length
  const failedCount = displayedScripts.filter((s) => s.status === 'failed').length

  const selectedResult = selectedId ? results[selectedId] : null
  const selectedContent = selectedScript ? contentCache[selectedScript.path] || '' : ''

  const isRunning = runnerState === 'running'
  const isPaused = runnerState === 'paused'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 gap-3 bg-surface-900">
      {/* Top Toolbar */}
      <ScriptRunnerToolbar
        runnerState={runnerState}
        scriptsCount={scriptsCount}
        enabledCount={enabledCount}
        successCount={successCount}
        failedCount={failedCount}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        folderOrder={folderOrder}
        onFolderOrderChange={handleFolderOrderChange}
        hasFolders={hasFolders}
        onResetStatus={handleResetStatus}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onClearList={handleClearList}
        onOpenFiles={handleOpenFiles}
        onOpenFolder={handleOpenFolder}
      />

      {!connInfo && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Este espacio de trabajo no tiene conexión activa. Conéctate a una base de datos para ejecutar los scripts.</span>
        </div>
      )}

      {/* Main Split Layout: Left (folder tree + scripts list + execute button) / Right (top: content, bottom: result) */}
      <div className="flex-1 flex gap-1 min-h-0 overflow-hidden">
        {/* Left Side: Folder Tree above, Script List in middle, "Ejecutar lista" button below */}
        <div
          style={{ width: `${leftPanelWidth}px` }}
          className="flex-shrink-0 flex flex-col min-h-0 glass rounded-2xl border border-surface-600/70 p-3 bg-surface-900/50 gap-2.5"
        >
          {/* Small Folder Tree panel above the script list */}
          {hasFolders && (
            <ScriptFolderTree
              scripts={scripts}
              rootFolderName={rootFolderName}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(folderId) => {
                setSelectedFolderId(folderId)
                setPausedIndex(0)
                setRunnerState('idle')
              }}
            />
          )}

          {/* Section header for the active folder scripts */}
          <div className="flex items-center justify-between pb-1.5 border-b border-surface-700/60 flex-shrink-0 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-slate-300">Scripts</span>
              {selectedFolderId ? (
                <span
                  className="text-[10px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded truncate max-w-[170px]"
                  title={`Carpeta: ${selectedFolderId}`}
                >
                  {selectedFolderId}
                </span>
              ) : hasFolders ? (
                <span className="text-[10px] text-slate-400 font-mono bg-surface-800 px-1.5 py-0.5 rounded">
                  Raíz
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-slate-500 font-mono flex-shrink-0">
              {scriptsCount} {scriptsCount === 1 ? 'script' : 'scripts'}
            </span>
          </div>

          {/* Script List showing ONLY the scripts of the selected folder */}
          <ScriptList
            scripts={displayedScripts}
            selectedId={selectedId}
            runningScriptId={runningScriptId}
            isExecutingAll={runnerState === 'running'}
            onSelect={setSelectedId}
            onToggleCheck={handleToggleCheck}
            onRunSingle={handleRunSingle}
            onReorder={handleReorder}
            onOpenFiles={handleOpenFiles}
            onOpenFolder={handleOpenFolder}
          />

          {/* Bottom Action Button: "Ejecutar lista" / "Reanudar" / "Detener" */}
          <div className="pt-2 border-t border-surface-700/60 flex-shrink-0">
            {isRunning ? (
              <button
                type="button"
                onClick={handleStop}
                className="btn-danger w-full justify-center text-xs py-2 px-4 shadow-sm active:scale-95"
                title="Detener la ejecución de la lista"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Detener ejecución</span>
              </button>
            ) : isPaused ? (
              <button
                type="button"
                onClick={handleResume}
                className="btn-primary w-full justify-center text-xs py-2 px-4 shadow-lg bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white active:scale-95 animate-pulse"
                title="Reanudar ejecución después del script fallido"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Reanudar lista</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={displayedScripts.length === 0 || enabledCount === 0 || !connInfo}
                onClick={handleRunList}
                className="btn-primary w-full justify-center text-xs py-2 px-4 shadow-sm active:scale-95"
                title="Ejecutar los scripts marcados de la carpeta seleccionada en el orden de la lista"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Ejecutar lista ({enabledCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Horizontal Resizer (Left-Right) */}
        <div
          onPointerDown={startHorizontalResize}
          onDoubleClick={() => {
            setLeftPanelWidth(380)
            localStorage.removeItem('spextractor:scripts-left-width')
          }}
          className="w-2.5 -mx-1 cursor-col-resize z-20 hover:bg-sky-500/20 active:bg-sky-500/40 transition-colors rounded-full flex items-center justify-center group flex-shrink-0 select-none"
          title="Arrastra para ajustar el ancho (Doble clic para restablecer)"
        >
          <div className="w-1 h-8 bg-surface-600/70 group-hover:bg-sky-400 group-active:bg-sky-300 rounded-full transition-colors" />
        </div>

        {/* Right Side: Split into Content (top) and Result (bottom) */}
        <div ref={rightContainerRef} className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* Top Panel: Content Viewer */}
          <ScriptContentPanel
            panelRef={contentPanelRef}
            style={contentHeight ? { height: `${contentHeight}px`, flex: 'none' } : undefined}
            script={selectedScript}
            content={selectedContent}
            loading={loadingContent}
            error={contentError}
            onEditInQuery={(sqlText, title) => {
              onOpenInQuery?.(sqlText, title)
            }}
          />

          {/* Vertical Resizer Handle (Top-Bottom) */}
          <div
            onPointerDown={startVerticalResize}
            onDoubleClick={() => {
              setContentHeight(null)
              localStorage.removeItem('spextractor:scripts-content-height')
            }}
            className="h-3 my-0.5 cursor-row-resize z-20 hover:bg-sky-500/20 active:bg-sky-500/40 transition-colors rounded-full flex items-center justify-center group flex-shrink-0 select-none"
            title="Arrastra para ajustar la altura entre contenido y resultado (Doble clic para 50/50)"
          >
            <div className="h-1 w-14 bg-surface-600/70 group-hover:bg-sky-400 group-active:bg-sky-300 rounded-full transition-colors" />
          </div>

          {/* Bottom Panel: Execution Result */}
          <ScriptResultPanel
            script={selectedScript}
            result={selectedResult}
            isRunning={runningScriptId === selectedId}
            onRetrySingle={handleRunSingle}
          />
        </div>
      </div>
    </div>
  )
}
