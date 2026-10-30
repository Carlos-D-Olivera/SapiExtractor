import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plug, PlugZap, ArrowUpCircle, AlertCircle
} from 'lucide-react'
import clsx from 'clsx'

import ConnectionDialog from './components/ConnectionDialog'
import RestoreSessionModal from './components/RestoreSessionModal'
import UpdateModal from './components/UpdateModal'
import SettingsModal from './components/SettingsModal'
import WorkspaceView, { DB_LABELS } from './components/WorkspaceView'
import appIcon from './assets/SpExtractor.ico'

let goApp = null
async function go() {
  if (!goApp) {
    goApp = await import('../wailsjs/go/main/App')
  }
  return goApp
}

const INITIAL_WORKSPACES = [
  { id: '1', connInfo: null, view: 'objects' },
  { id: '2', connInfo: null, view: 'objects' },
]

export default function App() {
  const [workspaces, setWorkspaces] = useState(INITIAL_WORKSPACES)
  const [activeId, setActiveId] = useState('1')
  const [showConnDialog, setShowConnDialog] = useState(false)
  const [savedConns, setSavedConns] = useState([])
  const [dialogInitial, setDialogInitial] = useState(null)   // prefill for the connection dialog (reconnect)
  const [dirtyWorkspaces, setDirtyWorkspaces] = useState({})
  useEffect(() => {
    const handleSettingsShortcut = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleSettingsShortcut)
    return () => window.removeEventListener('keydown', handleSettingsShortcut)
  }, [])

  const [confirmCloseWs, setConfirmCloseWs] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const handleDirtyChange = useCallback((wsId, isDirty) => {
    setDirtyWorkspaces(prev => {
      if (prev[wsId] === isDirty) return prev
      return { ...prev, [wsId]: isDirty }
    })
  }, [])

  useEffect(() => {
    if (!confirmCloseWs) return
    const handleKey = (e) => {
      if (e.key === 'Escape') setConfirmCloseWs(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [confirmCloseWs])
  const [sessionReady, setSessionReady] = useState(false)    // the previous session was dealt with; saving may start
  const [restorePrompt, setRestorePrompt] = useState(null)   // saved session waiting for the user's decision
  const [restoring, setRestoring] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState(null)         // a newer release found at start-up
  const [showUpdate, setShowUpdate] = useState(false)

  const openConnDialog = useCallback((initial) => {
    setDialogInitial(initial || null)
    setShowConnDialog(true)
  }, [])

  // Load saved connection history
  const loadSavedConns = useCallback(async () => {
    try {
      const api = await go()
      const list = await api.LoadConnections()
      setSavedConns(list || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadSavedConns()
  }, [loadSavedConns])

  const activeWs = workspaces.find(w => w.id === activeId) || workspaces[0]

  // ---- Previous session: offer to restore it, and keep it saved ----
  const sameConn = (c, w) => c.dbType === w.dbType && c.host === w.host && c.port === w.port && c.dbName === w.dbName && c.user === w.user
  const hasPassword = useCallback((w) => savedConns.some(c => sameConn(c, w) && c.rememberPassword && c.passwordBase64), [savedConns])

  const restoreSession = useCallback(async (session, selectedIds) => {
    const api = await go()
    const saved = (await api.LoadConnections()) || []
    const rebuilt = await Promise.all((session.workspaces || []).map(async (w) => {
      const base = { id: w.id, connInfo: null, pendingConn: null, view: 'objects' }
      if (!w.dbType || !w.dbName) return base
      const conn = { dbType: w.dbType, host: w.host, port: w.port, dbName: w.dbName, user: w.user }
      if (!selectedIds.has(w.id)) return base
      const match = saved.find(c => sameConn(c, w) && c.rememberPassword && c.passwordBase64)
      if (!match) return { ...base, pendingConn: conn }
      const info = { ...conn, password: atob(match.passwordBase64), rememberPassword: true }
      try {
        await api.Connect(w.id, info)
        const view = w.view === 'query' || (w.view === 'trace' && w.dbType === 'SQL_SERVER') ? w.view : 'objects'
        return { ...base, connInfo: info, view }
      } catch {
        return { ...base, pendingConn: conn } // the server is unreachable or the password changed
      }
    }))
    const list = rebuilt.sort((a, b) => Number(a.id) - Number(b.id))
    if (list.length > 0) {
      setWorkspaces(list)
      setActiveId(list.some(w => w.id === session.activeId) ? session.activeId : list[0].id)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const api = await go()
        const [session, settings] = await Promise.all([api.LoadSession(), api.GetPersistenceSettings()])
        if (cancelled) return
        const withDb = (session?.workspaces || []).filter(w => w.dbType && w.dbName)
        if (withDb.length === 0) { setSessionReady(true); return }
        if (settings?.autoRestore) {
          await restoreSession(session, new Set(withDb.map(w => w.id)))
          if (!cancelled) setSessionReady(true)
        } else {
          setRestorePrompt(session)
        }
      } catch {
        if (!cancelled) setSessionReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [restoreSession])

  // Version label, and a quiet check for a newer release a few seconds after start.
  useEffect(() => {
    let cancelled = false
    let timer
    ;(async () => {
      try {
        const api = await go()
        const v = await api.GetAppVersion()
        if (cancelled) return
        setAppVersion(v)
        if (v === 'dev') return
        const settings = await api.GetPersistenceSettings()
        if (!settings?.checkUpdates) return
        timer = setTimeout(async () => {
          try {
            const info = await api.CheckForUpdate()
            if (!cancelled && info?.available && info.latest !== settings.skippedVersion) setUpdateInfo(info)
          } catch { /* offline or rate limited: stay quiet */ }
        }, 3000)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  const handleRestore = async (selectedIds, always) => {
    setRestoring(true)
    try {
      if (always) {
        const api = await go()
        const settings = await api.GetPersistenceSettings()
        await api.SetPersistenceSettings({ ...settings, autoRestore: true })
      }
      await restoreSession(restorePrompt, selectedIds)
    } finally {
      setRestoring(false)
      setRestorePrompt(null)
      setSessionReady(true)
    }
  }

  const handleSkipRestore = async () => {
    setRestoring(true)
    try {
      const api = await go()
      if (restorePrompt?.workspaces) {
        for (const w of restorePrompt.workspaces) {
          if (w.dbType && w.dbName) {
            await api.ResetQueryStateForDb(w.dbType, w.host || '', w.port || '', w.dbName)
          }
        }
      }
      await api.ResetSessionQueryStates()
    } catch { /* ignore */ } finally {
      setRestoring(false)
      setRestorePrompt(null)
      setSessionReady(true)
    }
  }

  // Remember the layout (never the passwords) so it can be restored next time.
  useEffect(() => {
    if (!sessionReady) return
    const id = setTimeout(async () => {
      try {
        const api = await go()
        await api.SaveSession({
          activeId,
          savedAt: 0,
          workspaces: workspaces.map(w => {
            const c = w.connInfo || w.pendingConn
            return {
              id: w.id,
              view: w.view,
              dbType: c?.dbType || '',
              host: c?.host || '',
              port: c?.port || '',
              dbName: c?.dbName || '',
              user: c?.user || '',
            }
          }),
        })
      } catch { /* not critical */ }
    }, 500)
    return () => clearTimeout(id)
  }, [sessionReady, workspaces, activeId])

  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces

  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // Switch workspaces with Ctrl+Tab (forward) and Ctrl+Shift+Tab (backward)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Tab' || e.code === 'Tab')) {
        e.preventDefault()
        e.stopPropagation()
        if (showConnDialog) return

        const currentList = workspacesRef.current
        if (currentList.length <= 1) return

        const currentActive = activeIdRef.current
        const idx = currentList.findIndex(w => w.id === currentActive)
        const step = e.shiftKey ? -1 : 1
        const nextIdx = (idx === -1 ? 0 : (idx + step + currentList.length) % currentList.length)
        setActiveId(currentList[nextIdx].id)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [showConnDialog])

  // Add a new workspace up to a max of 5
  const handleAddWorkspace = async () => {
    if (workspaces.length >= 5) return
    const existingIds = new Set(workspaces.map(w => w.id))
    const available = ['1', '2', '3', '4', '5'].find(id => !existingIds.has(id))
    if (!available) return

    try {
      const api = await go()
      await api.ResetWorkspaceQueryState(available)
    } catch { /* ignore */ }

    const newWs = { id: available, connInfo: null, view: 'objects' }
    const updated = [...workspaces, newWs].sort((a, b) => Number(a.id) - Number(b.id))
    setWorkspaces(updated)
    setActiveId(available)
  }

  // Close workspace and disconnect session in Go backend
  const handleCloseWorkspace = async (idToClose) => {
    if (workspaces.length <= 1) return

    const wsToClose = workspaces.find(w => w.id === idToClose)
    if (dirtyWorkspaces[idToClose]) {
      setConfirmCloseWs({ ...wsToClose, isDisconnectOnly: false })
      return
    }

    await executeCloseWorkspace(idToClose)
  }

  const executeCloseWorkspace = async (idToClose) => {
    const wsToClose = workspaces.find(w => w.id === idToClose)
    if (wsToClose?.connInfo) {
      try {
        const api = await go()
        await api.Disconnect(idToClose)
      } catch { /* ignore */ }
    }

    try {
      const api = await go()
      await api.ResetWorkspaceQueryState(idToClose)
    } catch { /* ignore */ }

    setDirtyWorkspaces(prev => {
      const next = { ...prev }
      delete next[idToClose]
      return next
    })

    const updated = workspaces.filter(w => w.id !== idToClose)
    setWorkspaces(updated)

    if (activeId === idToClose) {
      // Pick the adjacent or first remaining workspace
      const nextWs = updated[0]
      setActiveId(nextWs.id)
    }
  }

  const updateWorkspaceView = (wsId, newView) => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, view: newView } : w))
  }

  const handleWorkspaceConnect = async (info) => {
    setWorkspaces(prev => prev.map(w => w.id === activeId ? { ...w, connInfo: info, pendingConn: null, view: 'objects' } : w))
    setShowConnDialog(false)

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
  }

  const handleWorkspaceDisconnect = async () => {
    if (dirtyWorkspaces[activeId]) {
      setConfirmCloseWs({ ...activeWs, isDisconnectOnly: true })
      return
    }

    await executeWorkspaceDisconnect(activeId)
  }

  const executeWorkspaceDisconnect = async (wsId) => {
    try {
      const api = await go()
      await api.Disconnect(wsId)
    } catch { /* ignore */ }

    setDirtyWorkspaces(prev => {
      const next = { ...prev }
      delete next[wsId]
      return next
    })

    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, connInfo: null, pendingConn: null, view: 'objects' } : w))
  }

  const handleDeleteSaved = async (conn) => {
    try {
      const api = await go()
      await api.DeleteConnection(conn)
      await loadSavedConns()
    } catch { /* ignore */ }
  }

  return (
    <div className="h-full flex flex-col bg-surface-900">
      {/* ── Top Bar ── */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b border-surface-600 flex-shrink-0"
        style={{ background: 'rgba(13,21,32,0.95)', backdropFilter: 'blur(8px)' }}
      >
        {/* Logo / Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-surface-700/40 border border-surface-600/50">
            <img src={appIcon} alt="SapiExtractor" className="w-5 h-5 object-contain" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">SapiExtractor</h1>
            <p className="text-[10px] text-slate-500 -mt-0.5">
              Database Object Extractor
              {appVersion && (
                <button
                  onClick={() => setShowUpdate(true)}
                  className="ml-1.5 text-slate-500 hover:text-brand-light underline decoration-dotted underline-offset-2"
                  title="Buscar actualizaciones"
                >
                  {appVersion === 'dev' ? 'dev' : `v${appVersion}`}
                </button>
              )}
            </p>
          </div>
        </div>

        {/* ── Workspaces Tabs: 1, 2, + ── */}
        <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-surface-600/60" title="Espacios de trabajo (Ctrl+Tab para alternar)">
          {workspaces.map(ws => {
            const isAct = ws.id === activeId
            const isConn = !!ws.connInfo
            return (
              <div key={ws.id} className="relative group flex items-center">
                <button
                  onClick={() => setActiveId(ws.id)}
                  title={isConn ? `Espacio ${ws.id}: ${ws.connInfo.dbName} (${ws.connInfo.host})` : `Espacio ${ws.id} (Sin conexión)`}
                  className={clsx(
                    'w-7 h-7 rounded-md text-xs flex items-center justify-center transition-all select-none',
                    isConn
                      ? isAct
                        ? 'bg-emerald-600 border border-emerald-400 text-white font-bold shadow-[0_0_10px_rgba(16,185,129,0.35)]'
                        : 'bg-emerald-950/70 border border-emerald-500/60 text-emerald-400 font-semibold hover:bg-emerald-900/80 hover:text-emerald-300'
                      : isAct
                        ? 'bg-brand-dark/80 border border-brand/60 text-white font-bold shadow-sm'
                        : 'bg-surface-800/70 border border-surface-600/40 text-slate-400 font-medium hover:text-slate-200 hover:bg-surface-700/60'
                  )}
                >
                  {ws.id}
                </button>
                {workspaces.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseWorkspace(ws.id)
                    }}
                    title={`Cerrar espacio ${ws.id}`}
                    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-surface-700 border border-surface-500 text-slate-400 hover:text-white hover:bg-red-600 hover:border-red-500 hidden group-hover:flex items-center justify-center text-[10px] leading-none shadow z-10"
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}

          {workspaces.length < 5 && (
            <button
              onClick={handleAddWorkspace}
              title="Nuevo espacio de trabajo (máximo 5)"
              className="w-7 h-7 rounded-md text-xs font-semibold flex items-center justify-center bg-surface-800/40 text-slate-400 hover:text-white hover:bg-surface-700/60 border border-dashed border-surface-600/60 transition-all select-none"
            >
              +
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* A newer version is available */}
        {updateInfo && (
          <button
            onClick={() => setShowUpdate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/30 transition-all"
            title={`Hay una versión nueva (v${updateInfo.latest})`}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            Actualizar a v{updateInfo.latest}
          </button>
        )}

        {/* Connection status (active workspace) */}
        {activeWs?.connInfo ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass text-xs">
              <span className="status-dot-green" />
              <span className="text-slate-300 font-medium">
                {activeWs.connInfo.dbName}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-500">{DB_LABELS[activeWs.connInfo.dbType] || activeWs.connInfo.dbType}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-500">{activeWs.connInfo.host}</span>
            </div>
            <button onClick={handleWorkspaceDisconnect} className="btn-danger text-xs py-1.5 px-3">
              <PlugZap className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={() => openConnDialog(activeWs?.pendingConn)} className="btn-primary">
            <Plug className="w-3.5 h-3.5" />
            {activeWs?.pendingConn ? 'Reconectar' : 'Connect'}
          </button>
        )}
      </header>

      {/* ── Main Content: All Workspaces stay mounted in DOM (display: none when inactive) ── */}
      <div className="flex-1 flex overflow-hidden">
        {workspaces.map(ws => (
          <WorkspaceView
            key={ws.id}
            workspaceId={ws.id}
            isActive={ws.id === activeId}
            connInfo={ws.connInfo}
            view={ws.view}
            setView={(newView) => updateWorkspaceView(ws.id, newView)}
            pendingConn={ws.pendingConn}
            onOpenConnDialog={openConnDialog}
            onDirtyChange={handleDirtyChange}
            onOpenSettings={() => setShowSettings(true)}
            otherWorkspaces={workspaces
              .filter(o => o.id !== ws.id && o.connInfo)
              .map(o => ({
                id: o.id,
                dbType: o.connInfo.dbType,
                label: `${o.connInfo.dbName} @ ${o.connInfo.host} (espacio ${o.id})`,
              }))}
          />
        ))}
      </div>

      {/* Connection dialog for the active workspace */}
      {showConnDialog && (
        <ConnectionDialog
          key={`${activeId}-${dialogInitial?.dbName || ''}`}
          workspaceId={activeId}
          initialForm={dialogInitial}
          onConnect={handleWorkspaceConnect}
          onClose={() => setShowConnDialog(false)}
          savedConnections={savedConns}
          onDeleteConnection={handleDeleteSaved}
        />
      )}

      
      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          activeWorkspace={activeWs}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Updates */}
      {showUpdate && (
        <UpdateModal
          version={appVersion}
          info={updateInfo}
          onClose={() => setShowUpdate(false)}
          onSkipped={() => setUpdateInfo(null)}
          onUpdateInfoChange={setUpdateInfo}
        />
      )}

      {/* Offer the previous session */}
      {restorePrompt && (
        <RestoreSessionModal
          workspaces={(restorePrompt.workspaces || []).filter(w => w.dbType && w.dbName)}
          hasPassword={hasPassword}
          restoring={restoring}
          onRestore={handleRestore}
          onSkip={handleSkipRestore}
        />
      )}

      {/* Confirm close / disconnect workspace when there are unsaved changes */}
      {confirmCloseWs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass rounded-2xl w-[460px] max-w-[95vw] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up border border-surface-600">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-600">
              <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white">
                  {confirmCloseWs.isDisconnectOnly ? 'Desconectar espacio de trabajo' : 'Cerrar espacio de trabajo'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  Espacio {confirmCloseWs.id} {confirmCloseWs.connInfo?.dbName ? `· ${confirmCloseWs.connInfo.dbName}` : ''}
                </p>
              </div>
            </div>

            <div className="px-6 py-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Este espacio de trabajo tiene consultas con cambios sin guardar. Si continúas, los cambios no guardados se perderán.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-surface-600 bg-surface-900/40">
              <button
                type="button"
                onClick={() => setConfirmCloseWs(null)}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmCloseWs
                  setConfirmCloseWs(null)
                  if (target.isDisconnectOnly) {
                    executeWorkspaceDisconnect(target.id)
                  } else {
                    executeCloseWorkspace(target.id)
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-white hover:bg-red-500/20 border border-red-500/30 transition-colors"
              >
                {confirmCloseWs.isDisconnectOnly ? 'Desconectar sin guardar' : 'Cerrar sin guardar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetId = confirmCloseWs.id
                  setConfirmCloseWs(null)
                  setActiveId(targetId)
                  updateWorkspaceView(targetId, 'query')
                }}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Revisar consultas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
