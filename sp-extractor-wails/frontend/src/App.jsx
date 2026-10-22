import { useState, useEffect, useCallback } from 'react'
import {
  Plug, PlugZap, Layers, Terminal
} from 'lucide-react'
import clsx from 'clsx'

import ConnectionDialog from './components/ConnectionDialog'
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

  // Add a new workspace up to a max of 5
  const handleAddWorkspace = () => {
    if (workspaces.length >= 5) return
    const existingIds = new Set(workspaces.map(w => w.id))
    const available = ['1', '2', '3', '4', '5'].find(id => !existingIds.has(id))
    if (!available) return

    const newWs = { id: available, connInfo: null, view: 'objects' }
    const updated = [...workspaces, newWs].sort((a, b) => Number(a.id) - Number(b.id))
    setWorkspaces(updated)
    setActiveId(available)
  }

  // Close workspace and disconnect session in Go backend
  const handleCloseWorkspace = async (idToClose) => {
    if (workspaces.length <= 1) return

    const wsToClose = workspaces.find(w => w.id === idToClose)
    if (wsToClose?.connInfo) {
      try {
        const api = await go()
        await api.Disconnect(idToClose)
      } catch { /* ignore */ }
    }

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
    setWorkspaces(prev => prev.map(w => w.id === activeId ? { ...w, connInfo: info, view: 'objects' } : w))
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
    try {
      const api = await go()
      await api.Disconnect(activeId)
    } catch { /* ignore */ }

    setWorkspaces(prev => prev.map(w => w.id === activeId ? { ...w, connInfo: null, view: 'objects' } : w))
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
            <p className="text-[10px] text-slate-500 -mt-0.5">Database Object Extractor</p>
          </div>
        </div>

        {/* ── Workspaces Tabs: 1, 2, + ── */}
        <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-surface-600/60">
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

        {/* View switch (active workspace) */}
        {activeWs?.connInfo && (
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <button
              onClick={() => updateWorkspaceView(activeId, 'objects')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                activeWs.view === 'objects' ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Explorador
            </button>
            <button
              onClick={() => updateWorkspaceView(activeId, 'query')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                activeWs.view === 'query' ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Terminal className="w-3.5 h-3.5" />
              Consultas
            </button>
          </div>
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
          <button onClick={() => setShowConnDialog(true)} className="btn-primary">
            <Plug className="w-3.5 h-3.5" />
            Connect
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
            onOpenConnDialog={() => setShowConnDialog(true)}
          />
        ))}
      </div>

      {/* Connection dialog for the active workspace */}
      {showConnDialog && (
        <ConnectionDialog
          workspaceId={activeId}
          onConnect={handleWorkspaceConnect}
          onClose={() => setShowConnDialog(false)}
          savedConnections={savedConns}
          onDeleteConnection={handleDeleteSaved}
        />
      )}
    </div>
  )
}
