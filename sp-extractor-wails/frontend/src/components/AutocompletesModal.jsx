import { useState, useEffect } from 'react'
import { X, Plus, Trash2, RotateCcw, Sparkles, Check, CheckSquare, Square } from 'lucide-react'
import clsx from 'clsx'

export const DEFAULT_AUTOCOMPLETES = [
  { id: 'sel', code: 'sel', query: 'SELECT * FROM ', seleccionar: false },
  { id: 'seltop', code: 'seltop', query: 'SELECT TOP 100 * FROM ', seleccionar: false },
  { id: 'ver', code: 'ver', query: 'SELECT * FROM admControlVersiones', seleccionar: true },
  { id: 'dbs', code: 'dbs', query: "SELECT * FROM admConfiguracion WHERE Codigo LIKE '%DBS%'", seleccionar: false },
  { id: 'chk', code: 'chk', query: "SELECT * FROM admConfiguracion WHERE Codigo = '#'", seleccionar: false },
  { id: 'upd', code: 'upd', query: "UPDATE # SET Columna = valor WHERE  condicion", seleccionar: false },
  { id: 'users', code: 'users', query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD", seleccionar: true },
  { id: 'userf', code: 'userf', query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD, @NombreModulo = 'Facturacion';", seleccionar: true },
  { id: 'userhc', code: 'userhc', query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD, @NombreModulo = 'Historia Clinica';", seleccionar: true }
]

const STORAGE_KEY = 'spextractor_sql_autocompletes'

export function getStoredAutocompletes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(item => ({
          ...item,
          seleccionar: Boolean(item.seleccionar),
        }))
      }
    }
  } catch (e) {
    console.error('Error loading autocompletes from localStorage:', e)
  }
  return DEFAULT_AUTOCOMPLETES
}

export function saveStoredAutocompletes(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Error saving autocompletes to localStorage:', e)
  }
}

export default function AutocompletesModal({ autocompletes, onSave, onClose }) {
  const [items, setItems] = useState(() => {
    const list = autocompletes && autocompletes.length > 0 ? autocompletes : DEFAULT_AUTOCOMPLETES
    return list.map(it => ({ ...it, seleccionar: Boolean(it.seleccionar) }))
  })
  const [filter, setFilter] = useState('')
  const [savedNotice, setSavedNotice] = useState(false)

  // Close on Escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateItem = (id, field, value) => {
    const next = items.map(it => it.id === id ? { ...it, [field]: value } : it)
    setItems(next)
    onSave(next)
    showSavedFeedback()
  }

  const deleteItem = (id) => {
    const next = items.filter(it => it.id !== id)
    setItems(next)
    onSave(next)
    showSavedFeedback()
  }

  const addItem = () => {
    const newId = `ac_${Date.now()}`
    const next = [
      ...items,
      { id: newId, code: '', query: '', seleccionar: false }
    ]
    setItems(next)
    onSave(next)
  }

  const resetDefaults = () => {
    if (window.confirm('¿Restablecer los autocompletados a los valores por defecto?')) {
      setItems(DEFAULT_AUTOCOMPLETES)
      onSave(DEFAULT_AUTOCOMPLETES)
      showSavedFeedback()
    }
  }

  const showSavedFeedback = () => {
    setSavedNotice(true)
    setTimeout(() => setSavedNotice(false), 1500)
  }

  const filtered = items.filter(it => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return it.code.toLowerCase().includes(q) || it.query.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-3xl flex flex-col rounded-2xl border border-surface-600 shadow-2xl overflow-hidden max-h-[85vh]"
        style={{ background: '#0E1726' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600/60 bg-surface-800/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-400/10 border border-amber-400/30">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                AutoCompletes Rápidos
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  {items.length} activos
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Escribe el código en el editor y pulsa <kbd className="px-1.5 py-0.5 rounded bg-surface-700 text-amber-300 font-mono text-[11px] border border-surface-600">TAB</kbd> para insertar la consulta. Usa <code className="text-amber-300 font-mono font-bold">#</code> para ubicar el cursor.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700 transition-colors"
            title="Cerrar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info banner */}
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>
              Palabras coincidentes se pintan de <strong className="text-amber-400 underline">amarillo</strong>. Coloca <strong className="text-amber-300 font-mono">#</strong> en la consulta para situar el cursor ahí automáticamente (ej. <code className="bg-surface-800/80 px-1 py-0.5 rounded font-mono text-[11px]">Codigo = '#'</code>).
            </span>
          </div>
          {savedNotice && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
              <Check className="w-3.5 h-3.5" /> Guardado
            </span>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-surface-700/50 gap-3 bg-surface-900/30">
          <input
            type="text"
            placeholder="Buscar por código o consulta…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="input-field py-1.5 px-3 text-xs w-64"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={resetDefaults}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
              title="Restablecer a las consultas por defecto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Valores por defecto
            </button>
            <button
              onClick={addItem}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar código
            </button>
          </div>
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-surface-600/80 text-left text-xs font-semibold text-slate-400">
                <th className="pb-2.5 w-32 px-2">Código</th>
                <th className="pb-2.5 px-2">Consulta SQL resultante</th>
                <th className="pb-2.5 w-28 text-center px-2" title="Selecciona automáticamente el texto al autocompletar">
                  Seleccionar
                </th>
                <th className="pb-2.5 w-16 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700/40">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500 text-xs">
                    {filter ? 'No se encontraron autocompletados con ese término.' : 'No hay autocompletados registrados. Haz clic en "Agregar código" para crear uno.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-800/30 transition-colors group">
                    <td className="py-2 px-2 align-top">
                      <div className="relative">
                        <input
                          type="text"
                          value={item.code}
                          placeholder="ej. sel"
                          onChange={e => updateItem(item.id, 'code', e.target.value)}
                          className="w-full bg-surface-800/80 border border-surface-600/80 focus:border-amber-400 focus:bg-surface-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-amber-300 outline-none transition-all placeholder:text-slate-600"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-2 align-top">
                      <textarea
                        rows={1}
                        value={item.query}
                        placeholder="ej. SELECT * FROM tabla"
                        onChange={e => updateItem(item.id, 'query', e.target.value)}
                        className="w-full bg-surface-800/80 border border-surface-600/80 focus:border-brand-light focus:bg-surface-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 outline-none transition-all placeholder:text-slate-600 resize-y min-h-[32px]"
                      />
                    </td>
                    <td className="py-2 px-2 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => updateItem(item.id, 'seleccionar', !item.seleccionar)}
                        className={clsx(
                          'p-1.5 rounded-lg transition-all inline-flex items-center justify-center gap-1 text-xs font-medium',
                          item.seleccionar
                            ? 'text-amber-300 bg-amber-400/20 border border-amber-400/40'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-surface-700/50 border border-transparent'
                        )}
                        title={item.seleccionar ? 'Selección automática activada' : 'Activar selección automática al autocompletar'}
                      >
                        {item.seleccionar ? (
                          <CheckSquare className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                        <span className="text-[11px]">{item.seleccionar ? 'Sí' : 'No'}</span>
                      </button>
                    </td>
                    <td className="py-2 px-2 text-center align-middle">
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Eliminar autocompletado"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-surface-600/60 bg-surface-800/40">
          <div className="text-[11px] text-slate-500">
            Los cambios se guardan automáticamente en tu navegador.
          </div>
          <button
            onClick={onClose}
            className="btn-primary text-xs py-1.5 px-4"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
