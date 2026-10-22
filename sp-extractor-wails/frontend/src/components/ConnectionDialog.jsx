import { useState, useEffect } from 'react'
import { X, Database, Server, User, Lock, Eye, EyeOff, Trash2, Clock, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

const DB_TYPES = [
  { value: 'SQL_SERVER', label: 'SQL Server', defaultPort: '1433' },
  { value: 'MYSQL', label: 'MySQL / MariaDB', defaultPort: '3306' },
  { value: 'POSTGRESQL', label: 'PostgreSQL', defaultPort: '5432' },
]

const EMPTY_FORM = {
  dbType: 'SQL_SERVER',
  host: 'localhost',
  port: '1433',
  dbName: '',
  user: 'sa',
  password: '',
  rememberPassword: true,
}

export default function ConnectionDialog({ workspaceId = '1', onConnect, onClose, savedConnections, onDeleteConnection }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [showPassword, setShowPassword] = useState(false)
  const [databases, setDatabases] = useState([])
  const [loadingDbs, setLoadingDbs] = useState(false)
  const [dbError, setDbError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('new') // 'new' | 'recent'

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleDbTypeChange = (val) => {
    const found = DB_TYPES.find(d => d.value === val)
    set('dbType', val)
    if (found) set('port', found.defaultPort)
    setDatabases([])
    setDbError('')
  }

  const handleLoadDbs = async () => {
    setLoadingDbs(true)
    setDbError('')
    setDatabases([])
    try {
      const { ListDatabases } = await import('../../wailsjs/go/main/App')
      const dbs = await ListDatabases({ ...form })
      setDatabases(dbs || [])
    } catch (e) {
      setDbError(e.toString())
    } finally {
      setLoadingDbs(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      const { Connect } = await import('../../wailsjs/go/main/App')
      await Connect(workspaceId, { ...form })
      onConnect({ ...form })
    } catch (e) {
      setError(e.toString())
    } finally {
      setConnecting(false)
    }
  }

  const loadSaved = (conn) => {
    setForm({
      dbType: conn.dbType || 'SQL_SERVER',
      host: conn.host || '',
      port: conn.port || '',
      dbName: conn.dbName || '',
      user: conn.user || '',
      password: conn.rememberPassword ? conn.passwordBase64
        ? atob(conn.passwordBase64) : '' : '',
      rememberPassword: conn.rememberPassword ?? true,
    })
    setTab('new')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass rounded-2xl w-[540px] max-h-[90vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50">
              <Database className="w-4 h-4 text-brand-light" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">New Connection</h2>
              <p className="text-xs text-slate-500">Connect to a database server</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-600">
          {[['new', 'New'], ['recent', `Recent (${savedConnections?.length || 0})`]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx(
                'flex-1 px-4 py-2.5 text-sm font-medium transition-all',
                tab === k
                  ? 'text-brand-light border-b-2 border-brand-accent bg-brand-dark/10'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-180px)]">
          {tab === 'recent' ? (
            <div className="p-4 space-y-2">
              {(!savedConnections || savedConnections.length === 0) ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No recent connections
                </div>
              ) : savedConnections.map((conn, i) => (
                <div key={i} className="glass-hover rounded-xl p-3 flex items-center gap-3 group cursor-pointer"
                     onClick={() => loadSaved(conn)}>
                  <div className="p-2 rounded-lg bg-brand-dark/30">
                    <Server className="w-3.5 h-3.5 text-brand-light" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{conn.dbName || '(no database)'}</p>
                    <p className="text-xs text-slate-500">{conn.dbType?.replace('_', ' ')} · {conn.host}:{conn.port}</p>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 transition-all"
                    onClick={e => { e.stopPropagation(); onDeleteConnection(conn) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {/* DB Type */}
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1.5">Database Engine</label>
                <div className="relative">
                  <select
                    className="select-field pr-8"
                    value={form.dbType}
                    onChange={e => handleDbTypeChange(e.target.value)}
                  >
                    {DB_TYPES.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>

              {/* Host + Port */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Host</label>
                  <div className="relative">
                    <Server className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input className="input-field pl-8" placeholder="localhost" value={form.host}
                           onChange={e => set('host', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Port</label>
                  <input className="input-field" value={form.port} onChange={e => set('port', e.target.value)} />
                </div>
              </div>

              {/* Database */}
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1.5">Database</label>
                <div className="flex gap-2">
                  {databases.length > 0 ? (
                    <div className="relative flex-1">
                      <select className="select-field pr-8" value={form.dbName} onChange={e => set('dbName', e.target.value)}>
                        <option value="">-- Select database --</option>
                        {databases.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                  ) : (
                    <div className="relative flex-1">
                      <Database className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input className="input-field pl-8" placeholder="database name" value={form.dbName}
                             onChange={e => set('dbName', e.target.value)} />
                    </div>
                  )}
                  <button
                    className="btn-secondary whitespace-nowrap text-xs"
                    onClick={handleLoadDbs}
                    disabled={loadingDbs || !form.host}
                  >
                    {loadingDbs ? (
                      <span className="w-3.5 h-3.5 border-2 border-slate-500 border-t-brand-light rounded-full animate-spin-slow" />
                    ) : 'Browse'}
                  </button>
                </div>
                {dbError && <p className="text-red-400 text-xs mt-1">{dbError}</p>}
              </div>

              {/* Auth */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Username</label>
                  <div className="relative">
                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input className="input-field pl-8" value={form.user} onChange={e => set('user', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      className="input-field pl-8 pr-8"
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                    />
                    <button
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Remember password */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-brand-accent"
                  checked={form.rememberPassword}
                  onChange={e => set('rememberPassword', e.target.checked)}
                />
                <span className="text-sm text-slate-400">Remember password</span>
              </label>

              {/* Error */}
              {error && (
                <div className="rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === 'new' && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-surface-600">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleConnect} disabled={connecting || !form.host}>
              {connecting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-brand-light/30 border-t-brand-light rounded-full animate-spin-slow" />
                  Connecting…
                </>
              ) : 'Connect'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
