import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Copy, Check, Save, Terminal, FileCode2, Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

const go = () => import('../../wailsjs/go/main/App')

// One identifier, quoted ([x], "x", `x`) or bare.
const IDENT_RE = /\[[^\]]+\]|"[^"]+"|`[^`]+`|[^.\s]+/g
// Qualified identifier: [schema].[table], "schema"."table", `schema`.`table` or plain names.
const FROM_RE = /\bfrom\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[^.\s]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[^.\s]+))*)/i

function cleanIdent(s) {
  const v = s.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '[' && last === ']') || (first === '"' && last === '"') || (first === '`' && last === '`')) {
      return v.slice(1, -1)
    }
  }
  return v
}

function splitQualified(text) {
  const parts = (text.match(IDENT_RE) || []).map(cleanIdent).filter(Boolean)
  if (parts.length === 0) return { schema: '', table: '' }
  return { schema: parts.slice(0, -1).join('.'), table: parts[parts.length - 1] }
}

function targetFromSql(sql) {
  const m = FROM_RE.exec(sql || '')
  if (!m) return ''
  const { schema, table } = splitQualified(m[1])
  if (!table) return ''
  return schema ? `${schema}.${table}` : table
}

function fileSafe(name) {
  return (name || 'resultado').replace(/[^\w.-]+/g, '_')
}

export default function InsertScriptModal({ set, sql, dbType, onClose, onOpenInQuery }) {
  const columns = set?.columns || []
  const types = set?.types || []
  const rows = set?.rows || []

  const [target, setTarget] = useState(() => targetFromSql(sql))
  const [selected, setSelected] = useState(() => new Set(columns.map((_, i) => i)))
  const [detectTypes, setDetectTypes] = useState(true)
  const [identityInsert, setIdentityInsert] = useState(false)
  const [deleteFirst, setDeleteFirst] = useState(false)
  const [batchSize, setBatchSize] = useState(100)
  const [script, setScript] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState('')
  const reqRef = useRef(0)

  const isSQLServer = dbType === 'SQL_SERVER'

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const generate = useCallback(async () => {
    const idx = columns.map((_, i) => i).filter(i => selected.has(i))
    const { schema, table } = splitQualified(target)
    if (!table || idx.length === 0 || rows.length === 0) {
      setScript('')
      setError(!table && target.trim() ? 'No se pudo interpretar la tabla destino.' : '')
      return
    }
    const req = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const api = await go()
      const text = await api.GenerateInsertScript({
        schema,
        table,
        columns: idx.map(i => columns[i]),
        types: idx.map(i => types[i] || ''),
        rows: rows.map(r => idx.map(i => (r[i] ?? null))),
        detectTypes,
        batchSize: Number(batchSize) || 1,
        identityInsert: isSQLServer && identityInsert,
        deleteFirst,
      })
      if (req === reqRef.current) setScript(text)
    } catch (e) {
      if (req === reqRef.current) {
        setError(e.toString())
        setScript('')
      }
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [columns, types, rows, selected, target, detectTypes, batchSize, identityInsert, deleteFirst, isSQLServer])

  useEffect(() => {
    const id = setTimeout(generate, 200)
    return () => clearTimeout(id)
  }, [generate])

  const toggleColumn = (i) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const handleCopy = async () => {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = script
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSave = async () => {
    if (!script) return
    setError('')
    try {
      const api = await go()
      const { table } = splitQualified(target)
      const path = await api.SaveScript(`insert_${fileSafe(table)}.sql`, script)
      if (path) {
        setSaved(path)
        setTimeout(() => setSaved(''), 2500)
      }
    } catch (e) {
      setError(e.toString())
    }
  }

  const handleOpenInQuery = () => {
    if (!script || !onOpenInQuery) return
    onOpenInQuery(script)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass rounded-2xl w-[980px] max-w-[95vw] h-[86vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50">
              <FileCode2 className="w-4 h-4 text-brand-light" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Script INSERT</h2>
              <p className="text-xs text-slate-500">
                Genera INSERT a partir de {rows.length} fila(s) del resultado
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Options */}
          <div className="w-[330px] flex-shrink-0 border-r border-surface-600 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Tabla destino</label>
              <input
                className="input-field font-mono"
                placeholder="esquema.tabla"
                value={target}
                onChange={e => setTarget(e.target.value)}
              />
              <p className="text-[10px] text-slate-600 mt-1">
                Detectada desde la consulta. Puedes editarla (esquema.tabla).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400 block">Opciones</label>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-brand-accent"
                  checked={detectTypes}
                  onChange={e => setDetectTypes(e.target.checked)}
                />
                <span className="text-xs text-slate-400">
                  Detectar números y booleanos (sin comillas)
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-brand-accent"
                  checked={deleteFirst}
                  onChange={e => setDeleteFirst(e.target.checked)}
                />
                <span className="text-xs text-slate-400">Incluir DELETE FROM antes de los INSERT</span>
              </label>
              {isSQLServer && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded accent-brand-accent"
                    checked={identityInsert}
                    onChange={e => setIdentityInsert(e.target.checked)}
                  />
                  <span className="text-xs text-slate-400">Incluir SET IDENTITY_INSERT</span>
                </label>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Filas por INSERT</label>
              <input
                type="number"
                min={1}
                max={1000}
                className="input-field w-28 font-mono"
                value={batchSize}
                onChange={e => setBatchSize(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-xs font-medium text-slate-400">Columnas</label>
                <span className="text-[10px] text-slate-600">{selected.size}/{columns.length}</span>
                <div className="flex-1" />
                <button
                  className="text-[10px] text-brand-light hover:text-white transition-colors"
                  onClick={() => setSelected(new Set(columns.map((_, i) => i)))}
                >
                  Todas
                </button>
                <button
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  onClick={() => setSelected(new Set())}
                >
                  Ninguna
                </button>
              </div>
              <div className="rounded-lg border border-surface-600 overflow-hidden">
                {columns.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-600">Sin columnas.</p>
                ) : columns.map((c, i) => (
                  <label
                    key={i}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1 cursor-pointer select-none text-xs',
                      i > 0 && 'border-t border-surface-700/60',
                      selected.has(i) ? 'hover:bg-surface-700/40' : 'opacity-60 hover:bg-surface-700/40'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded accent-brand-accent flex-shrink-0"
                      checked={selected.has(i)}
                      onChange={() => toggleColumn(i)}
                    />
                    <span className="font-mono text-slate-300 truncate">{c}</span>
                    <div className="flex-1" />
                    {types[i] && <span className="text-[10px] text-slate-600">{types[i]}</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-600 flex-shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Vista previa</span>
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-light" />}
              <div className="flex-1" />
              <button onClick={handleCopy} disabled={!script} className="btn-secondary text-xs py-1.5 px-3">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
              <button onClick={handleSave} disabled={!script} className="btn-secondary text-xs py-1.5 px-3">
                <Save className="w-3.5 h-3.5" />
                Guardar
              </button>
              {onOpenInQuery && (
                <button onClick={handleOpenInQuery} disabled={!script} className="btn-primary text-xs py-1.5 px-3">
                  <Terminal className="w-3.5 h-3.5" />
                  Abrir en Consultas
                </button>
              )}
            </div>

            {saved && (
              <div className="mx-3 mt-3 rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono truncate">
                Guardado en: {saved}
              </div>
            )}
            {error && (
              <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap font-mono" style={{ margin: 0 }}>{error}</pre>
              </div>
            )}

            <div className="flex-1 overflow-auto m-3 rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
              {script ? (
                <pre className="p-4 text-xs font-mono whitespace-pre text-slate-200" style={{ margin: 0 }}>{script}</pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
                  <FileCode2 className="w-8 h-8 opacity-40" />
                  <span className="text-xs">
                    {loading ? 'Generando script…' : 'Selecciona una tabla y al menos una columna.'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
