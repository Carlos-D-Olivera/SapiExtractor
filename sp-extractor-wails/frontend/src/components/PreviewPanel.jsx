import { useState } from 'react'
import { ArrowLeft, RefreshCw, Copy, Save, ExternalLink, Loader2, AlertCircle, Check, Pencil, Bug } from 'lucide-react'
import clsx from 'clsx'

export default function PreviewPanel({ workspaceId = '1', obj, typeLabel, definition, loading, error, onRefresh, onBack, onEdit, onDebug }) {
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('') // 'copy' | 'save' | 'open'
  const [saveFeedback, setSaveFeedback] = useState('')

  const go = () => import('../../wailsjs/go/main/App')

  const displayName = obj
    ? (obj.parentName && obj.type === 'COLUMN'
        ? `${obj.schema}.${obj.parentName} → ${obj.name}`
        : obj.schema ? `${obj.schema}.${obj.name}` : obj.name)
    : ''

  const objWithDef = obj ? { ...obj, definition: definition || '' } : null

  const handleCopy = async () => {
    if (!objWithDef) return
    setActionError('')
    setBusy('copy')
    try {
      const api = await go()
      const text = await api.GetObjectText(workspaceId, objWithDef)
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Fallback for older webviews
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setActionError(e.toString())
    } finally {
      setBusy('')
    }
  }

  const handleSaveAs = async () => {
    if (!objWithDef) return
    setActionError('')
    setBusy('save')
    try {
      const api = await go()
      const path = await api.SaveObject(workspaceId, objWithDef)
      if (path) {
        setSaveFeedback(path)
        setTimeout(() => setSaveFeedback(''), 2500)
      }
    } catch (e) {
      setActionError(e.toString())
    } finally {
      setBusy('')
    }
  }

  const handleOpen = async () => {
    if (!objWithDef) return
    setActionError('')
    setBusy('open')
    try {
      const api = await go()
      await api.OpenObject(workspaceId, objWithDef)
    } catch (e) {
      setActionError(e.toString())
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button onClick={onBack} className="btn-secondary text-xs py-1.5 px-3" title="Volver a la lista (Escape)">
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="badge-blue truncate">{typeLabel}</span>
          <span className="text-sm font-semibold text-white font-mono truncate" title={displayName}>
            {displayName}
          </span>
        </div>
        <div className="flex-1" />
        <button onClick={onRefresh} disabled={loading} className="btn-secondary text-xs py-1.5 px-3" title="Volver a consultar en la base de datos (F5)">
          <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
          Recargar
        </button>
        <button onClick={handleCopy} disabled={loading || busy} className="btn-secondary text-xs py-1.5 px-3" title="Copiar definición al portapapeles">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
        <button onClick={handleSaveAs} disabled={loading || busy} className="btn-secondary text-xs py-1.5 px-3" title="Guardar como archivo .sql">
          {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar como
        </button>
        {onDebug && (
          <button onClick={onDebug} disabled={loading} className="btn-secondary text-xs py-1.5 px-3" title="Ejecutar el procedimiento y ver qué sentencias, ramas y procedimientos anidados se ejecutaron">
            <Bug className="w-3.5 h-3.5" />
            Depurar
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} disabled={loading || !definition} className="btn-secondary text-xs py-1.5 px-3" title="Abrir la definición en una pestaña de Consultas para editarla">
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
        )}
        <button onClick={handleOpen} disabled={loading || busy} className="btn-primary text-xs py-1.5 px-3" title="Abrir archivo SQL en SQL Server / Editor predeterminado">
          {busy === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          Abrir en SQL Server
        </button>
      </div>

      {saveFeedback && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex-shrink-0 font-mono truncate">
          Guardado en: {saveFeedback}
        </div>
      )}

      {(error || actionError) && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error || actionError}
        </div>
      )}

      {/* Definition */}
      <div className="flex-1 overflow-auto rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
            <span className="text-sm">Cargando definición…</span>
          </div>
        ) : (
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-slate-200" style={{ margin: 0 }}>
            {definition || '-- Sin definición disponible'}
          </pre>
        )}
      </div>
    </div>
  )
}
