import { useState, useEffect } from 'react'
import { Terminal, Copy, Check, FileCode2, Loader2, AlertCircle, Folder } from 'lucide-react'
import clsx from 'clsx'
import ReadOnlySqlViewer from './ReadOnlySqlViewer'

export default function ScriptContentPanel({
  script,
  content,
  loading,
  error,
  onEditInQuery,
  style,
  panelRef,
  dbType = 'SQL_SERVER',
  editorTheme,
  fontSize,
  fontFamily,
}) {
  const [copied, setCopied] = useState(false)

  const [currentTheme, setCurrentTheme] = useState(() => editorTheme || localStorage.getItem('sp_extractor_editor_theme') || 'one-dark')
  const [currentFont, setCurrentFont] = useState(() => fontFamily || localStorage.getItem('sp_extractor_editor_font_family') || 'Consolas')
  const [currentSize, setCurrentSize] = useState(() => fontSize || Number(localStorage.getItem('sp_extractor_query_font_size')) || 12)

  useEffect(() => {
    const handleUpdate = (e) => {
      if (e.detail) {
        if (e.detail.editorTheme) setCurrentTheme(e.detail.editorTheme)
        if (e.detail.editorFontFamily) setCurrentFont(e.detail.editorFontFamily)
        if (e.detail.editorFontSize) setCurrentSize(e.detail.editorFontSize)
      }
    }
    window.addEventListener('spextractor:settings-updated', handleUpdate)
    return () => window.removeEventListener('spextractor:settings-updated', handleUpdate)
  }, [])

  const handleCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = content
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  if (!script) {
    return (
      <div
        ref={panelRef}
        style={style}
        className={clsx(
          'flex flex-col items-center justify-center p-6 text-center text-slate-500 bg-surface-900/40 rounded-xl border border-surface-600/50',
          !style?.height && 'flex-1'
        )}
      >
        <FileCode2 className="w-8 h-8 opacity-40 mb-2" />
        <p className="text-xs">Selecciona un script de la lista para ver su contenido</p>
      </div>
    )
  }

  const lines = (content || '').split('\n')

  return (
    <div
      ref={panelRef}
      style={style}
      className={clsx(
        'flex flex-col min-h-0 bg-surface-900/60 rounded-xl border border-surface-600/70 overflow-hidden',
        !style?.height && 'flex-1'
      )}
    >
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-surface-600/60 bg-surface-800/50 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-white font-mono truncate" title={script.path}>
            {script.fileName}
          </span>
          {script.folder && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400/90 font-mono bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md truncate max-w-[200px]" title={`Carpeta: ${script.folder}`}>
              <Folder className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{script.folder}</span>
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          type="button"
          disabled={!content || loading}
          onClick={handleCopy}
          className="btn-secondary text-[11px] py-1 px-2.5"
          title="Copiar contenido del script"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>

        <button
          type="button"
          disabled={!content || loading}
          onClick={() => onEditInQuery?.(content, script.name || script.fileName)}
          className="btn-primary text-[11px] py-1 px-2.5"
          title="Abrir este script en la pestaña Consultas para editarlo y ejecutarlo con autocompletado"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Editar en Consultas</span>
        </button>
      </div>

      {/* Script body with syntax highlighting */}
      <div className="flex-1 overflow-hidden bg-surface-950 flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
            <span>Leyendo script...</span>
          </div>
        ) : error ? (
          <div className="p-4 flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <ReadOnlySqlViewer
            content={content || ''}
            dbType={dbType}
            editorTheme={currentTheme}
            fontSize={currentSize}
            fontFamily={currentFont}
          />
        )}
      </div>
    </div>
  )
}
