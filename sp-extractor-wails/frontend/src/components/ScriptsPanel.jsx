import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Copy, Check, Save, Terminal } from 'lucide-react'
import clsx from 'clsx'

export default function ScriptsPanel({ obj, onBack, onOpenInQuery }) {
  const [scripts, setScripts] = useState([])
  const [active, setActive] = useState('ddl')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState('')

  const display = obj.schema ? `${obj.schema}.${obj.name}` : obj.name

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const api = await import('../../wailsjs/go/main/App')
        const list = await api.GenerateTableScripts(obj.schema, obj.name)
        if (!cancelled) {
          setScripts(list || [])
          setActive('ddl')
        }
      } catch (e) {
        if (!cancelled) {
          setScripts([])
          setError(e.toString())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [obj.schema, obj.name])

  const current = scripts.find(s => s.id === active) || scripts[0]

  const handleCopy = async () => {
    if (!current) return
    try {
      await navigator.clipboard.writeText(current.sql)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = current.sql
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSave = async () => {
    if (!current) return
    setError('')
    try {
      const api = await import('../../wailsjs/go/main/App')
      const path = await api.SaveScript(`${obj.name}_${current.id}.sql`, current.sql)
      if (path) {
        setSaved(path)
        setTimeout(() => setSaved(''), 2500)
      }
    } catch (e) {
      setError(e.toString())
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button onClick={onBack} className="btn-secondary text-xs py-1.5 px-3" title="Volver a la lista (Escape)">
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="badge-blue">Scripts</span>
          <span className="text-sm font-semibold text-white font-mono truncate" title={display}>{display}</span>
        </div>
        <div className="flex-1" />
        <button onClick={handleCopy} disabled={!current} className="btn-secondary text-xs py-1.5 px-3">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button onClick={handleSave} disabled={!current} className="btn-secondary text-xs py-1.5 px-3">
          <Save className="w-3.5 h-3.5" />
          Guardar como
        </button>
        {onOpenInQuery && (
          <button onClick={() => current && onOpenInQuery(current.sql)} disabled={!current} className="btn-primary text-xs py-1.5 px-3"
                  title="Abrir en el editor de Consultas">
            <Terminal className="w-3.5 h-3.5" />
            Abrir en Consultas
          </button>
        )}
      </div>

      {scripts.length > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
          {scripts.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                current?.id === s.id ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200 bg-white/5'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {saved && (
        <div className="rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex-shrink-0 font-mono truncate">
          Guardado en: {saved}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
            <span className="text-sm">Generando scripts…</span>
          </div>
        ) : (
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-slate-200" style={{ margin: 0 }}>
            {current?.sql || ''}
          </pre>
        )}
      </div>
    </div>
  )
}
