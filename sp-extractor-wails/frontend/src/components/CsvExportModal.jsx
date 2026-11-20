import { useState, useMemo, useEffect } from 'react'
import { X, Copy, Check, Save, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { buildCsv } from '../utils/csvExport'
import { writeClipboardText } from '../utils/editorClipboard'

const PREVIEW_ROWS = 50
const go = () => import('../../wailsjs/go/main/App')

export default function CsvExportModal({ set, onClose }) {
  const columns = set?.columns || [], types = set?.types || [], rows = set?.rows || []
  const [selected, setSelected] = useState(() => new Set(columns.map((_, i) => i)))
  const [filename, setFilename] = useState('resultado.csv')
  const [delimiter, setDelimiter] = useState(',')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [quoteAll, setQuoteAll] = useState(false)
  const [bom, setBom] = useState(true)
  const [nullValue, setNullValue] = useState('')
  const [lineEnding, setLineEnding] = useState('\r\n')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState('')
  const options = useMemo(() => ({ columnIndexes: [...selected], delimiter, includeHeaders, quoteAll, nullValue, lineEnding }), [selected, delimiter, includeHeaders, quoteAll, nullValue, lineEnding])
  const preview = useMemo(() => buildCsv(set, { ...options, maxRows: PREVIEW_ROWS }), [set, options])
  const canExport = selected.size > 0 && rows.length > 0 && !busy

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { setCopied(false); setSaved(''); setError('') }, [options, filename, bom])

  const toggleColumn = index => setSelected(previous => {
    const next = new Set(previous)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  const handleCopy = async () => {
    setBusy('copy'); setError('')
    try { await writeClipboardText(buildCsv(set, options)); setCopied(true) }
    catch (error) { setError(error.message || String(error)) }
    finally { setBusy('') }
  }

  const handleSave = async () => {
    setBusy('save'); setError(''); setSaved('')
    try {
      const api = await go()
      const path = await api.SaveCSV(filename.trim() || 'resultado.csv', buildCsv(set, { ...options, bom }))
      if (path) setSaved(path)
    } catch (error) { setError(error.message || String(error)) }
    finally { setBusy('') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label="Exportar a CSV" className="glass rounded-2xl w-[980px] max-w-[95vw] h-[86vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50"><FileSpreadsheet className="w-4 h-4 text-brand-light" /></div>
            <div><h2 className="text-sm font-semibold text-white">Exportar a CSV</h2><p className="text-xs text-slate-500">Exporta {rows.length.toLocaleString()} fila(s) del resultado con las columnas que elijas</p></div>
          </div>
          <button type="button" aria-label="Cerrar exportación CSV" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 flex min-h-0">
          <div className="w-[330px] max-w-[45%] flex-shrink-0 border-r border-surface-600 overflow-y-auto p-4 space-y-4">
            <label className="text-xs font-medium text-slate-400 block">Nombre del archivo
              <input aria-label="Nombre del archivo" className="input-field font-mono mt-1.5" value={filename} onChange={e => setFilename(e.target.value)} placeholder="resultado.csv" />
            </label>
            <label className="text-xs font-medium text-slate-400 block">Separador
              <select aria-label="Separador" className="select-field mt-1.5" value={delimiter} onChange={e => setDelimiter(e.target.value)}>
                <option value=",">Coma (,)</option><option value=";">Punto y coma (;)</option><option value={'\t'}>Tabulación</option><option value="|">Barra vertical (|)</option>
              </select>
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-400"><input type="checkbox" className="accent-brand-accent" checked={includeHeaders} onChange={e => setIncludeHeaders(e.target.checked)} />Incluir encabezados</label>
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-400"><input type="checkbox" className="accent-brand-accent" checked={quoteAll} onChange={e => setQuoteAll(e.target.checked)} />Entrecomillar todos los valores</label>
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-400"><input type="checkbox" className="accent-brand-accent" checked={bom} onChange={e => setBom(e.target.checked)} />UTF-8 con BOM (compatible con Excel)</label>
            </div>
            <label className="text-xs font-medium text-slate-400 block">Valores NULL
              <input aria-label="Valores NULL" className="input-field font-mono mt-1.5" value={nullValue} onChange={e => setNullValue(e.target.value)} placeholder="Vacío" />
              <span className="text-[10px] text-slate-600 block mt-1">Déjalo vacío o escribe una representación, por ejemplo NULL.</span>
            </label>
            <label className="text-xs font-medium text-slate-400 block">Saltos de línea
              <select aria-label="Saltos de línea" className="select-field mt-1.5" value={lineEnding} onChange={e => setLineEnding(e.target.value)}><option value={'\r\n'}>Windows (CRLF)</option><option value={'\n'}>Unix (LF)</option></select>
            </label>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-slate-400">Columnas</span><span className="text-[10px] text-slate-600">{selected.size}/{columns.length}</span><div className="flex-1" />
                <button type="button" className="text-[10px] text-brand-light hover:text-white" onClick={() => setSelected(new Set(columns.map((_, i) => i)))}>Todas</button>
                <button type="button" className="text-[10px] text-slate-500 hover:text-slate-300" onClick={() => setSelected(new Set())}>Ninguna</button>
              </div>
              <div className="rounded-lg border border-surface-600 overflow-hidden">
                {columns.map((column, index) => <label key={index} className={clsx('flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-surface-700/40', index > 0 && 'border-t border-surface-700/60', !selected.has(index) && 'opacity-60')}>
                  <input type="checkbox" aria-label={`Incluir columna ${index + 1}: ${column}`} className="accent-brand-accent flex-shrink-0" checked={selected.has(index)} onChange={() => toggleColumn(index)} />
                  <span className="font-mono text-slate-300 truncate">{column}</span><div className="flex-1" />{types[index] && <span className="text-[10px] text-slate-600">{types[index]}</span>}
                </label>)}
              </div>
            </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600 flex-shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Vista previa</span><div className="flex-1" />
              <button type="button" onClick={handleCopy} disabled={!canExport} className="btn-secondary text-xs py-1.5 px-3">
                {busy === 'copy' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copiado' : 'Copiar'}
              </button>
              <button type="button" onClick={handleSave} disabled={!canExport} className="btn-secondary text-xs py-1.5 px-3">{busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Guardar</button>
            </div>
            {set?.truncated && <div role="status" className="mx-3 mt-3 text-xs text-amber-400">El resultado está truncado. Se exportarán únicamente las {rows.length.toLocaleString()} filas cargadas; aumenta el límite y ejecuta de nuevo para obtener más.</div>}
            {rows.length > PREVIEW_ROWS && <p className="mx-3 mt-3 text-[11px] text-slate-500">Vista previa de las primeras {PREVIEW_ROWS} filas. Copiar y guardar incluyen las {rows.length.toLocaleString()} filas cargadas.</p>}
            {saved && <div role="status" className="mx-3 mt-3 rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono break-all">Guardado en: {saved}</div>}
            {error && <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            <div className="flex-1 overflow-auto m-3 rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
              {preview ? <pre aria-label="Vista previa CSV" className="p-4 text-xs font-mono whitespace-pre text-slate-200" style={{ margin: 0 }}>{preview}</pre> : <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600"><FileSpreadsheet className="w-8 h-8 opacity-40" /><span className="text-xs">Selecciona al menos una columna para exportar.</span></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
