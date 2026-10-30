import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Sliders, Code2, Sparkles, History, FolderOutput,
  Save, Check, RotateCcw, Plus, Trash2, CheckSquare, Square,
  FolderOpen, AlertTriangle, Monitor, Database
} from 'lucide-react'
import clsx from 'clsx'
import {
  DEFAULT_AUTOCOMPLETES,
  loadStoredAutocompletes,
  saveStoredAutocompletes
} from './AutocompletesModal'

let goApp = null
async function go() {
  if (!goApp) {
    goApp = await import('../../wailsjs/go/main/App')
  }
  return goApp
}

const ROW_LIMIT_OPTIONS = [
  { value: 100, label: '100 filas (recomendado)' },
  { value: 1000, label: '1.000 filas' },
  { value: 5000, label: '5.000 filas' },
  { value: 50000, label: '50.000 filas' },
  { value: 0, label: 'Sin límite (carga todas las filas)' },
]

export default function SettingsModal({
  activeWorkspace,
  onClose,
  initialTab = 'general'
}) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)

  // Settings State
  const [settings, setSettings] = useState({
    autoRestore: false,
    historyEnabled: true,
    retentionDays: 90,
    maxEntries: 5000,
    editorFontSize: 12,
    defaultRowLimit: 100,
    defaultOutDir: '',
    includeDropHeader: true,
  })

  // AutoCompletes State
  const [autocompletes, setAutocompletes] = useState([])
  const [acFilter, setAcFilter] = useState('')
  const [acSaving, setAcSaving] = useState(false)
  const [acSavedNotice, setAcSavedNotice] = useState(false)
  const acDebounceRef = useRef(null)
  const acListRef = useRef(autocompletes)
  acListRef.current = autocompletes

  // Clearing history status
  const [clearingHistory, setClearingHistory] = useState(false)
  const [clearHistoryMsg, setClearHistoryMsg] = useState('')

  // Load persistence settings & autocompletes from backend
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const api = await go()
        const [st, acs] = await Promise.all([
          api.GetPersistenceSettings().catch(() => null),
          loadStoredAutocompletes().catch(() => DEFAULT_AUTOCOMPLETES)
        ])
        if (cancelled) return

        if (st) {
          // If localStorage has an existing font size, prefer it or sync it
          let localFontSize = 12
          try {
            const stored = localStorage.getItem('sp_extractor_query_font_size')
            if (stored && Number(stored)) localFontSize = Number(stored)
          } catch { /* ignore */ }

          setSettings({
            autoRestore: Boolean(st.autoRestore),
            historyEnabled: st.historyEnabled !== false,
            retentionDays: st.retentionDays || 90,
            maxEntries: st.maxEntries || 5000,
            editorFontSize: st.editorFontSize || localFontSize || 12,
            defaultRowLimit: st.defaultRowLimit !== undefined ? st.defaultRowLimit : 100,
            defaultOutDir: st.defaultOutDir || '',
            includeDropHeader: st.includeDropHeader !== false,
          })
        }
        if (acs) {
          setAutocompletes(acs)
        }
      } catch (e) {
        console.error('Error cargando configuración:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Save settings change to backend & dispatch event
  const persistSettings = useCallback(async (newSettings) => {
    setSaving(true)
    try {
      const api = await go()
      // Preserve any other settings fields (e.g. checkUpdates, skippedVersion)
      const current = await api.GetPersistenceSettings().catch(() => ({}))
      const merged = { ...current, ...newSettings }
      await api.SetPersistenceSettings(merged)

      // Sync local storage for editor
      try {
        if (newSettings.editorFontSize) {
          localStorage.setItem('sp_extractor_query_font_size', String(newSettings.editorFontSize))
        }
        if (newSettings.defaultRowLimit !== undefined) {
          localStorage.setItem('sp_extractor_default_row_limit', String(newSettings.defaultRowLimit))
        }
      } catch { /* ignore */ }

      // Dispatch event to app
      window.dispatchEvent(new CustomEvent('spextractor:settings-updated', { detail: merged }))

      setSavedNotice(true)
      setTimeout(() => setSavedNotice(false), 2000)
    } catch (e) {
      console.error('Error guardando configuración:', e)
    } finally {
      setSaving(false)
    }
  }, [])

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      persistSettings(next)
      return next
    })
  }

  // --- AutoCompletes Logic ---
  const triggerSaveAutocompletes = useCallback(async (listToSave) => {
    setAcSaving(true)
    try {
      await saveStoredAutocompletes(listToSave)
      setAcSavedNotice(true)
      setTimeout(() => setAcSavedNotice(false), 2000)
    } finally {
      setAcSaving(false)
    }
  }, [])

  const scheduleAutoSaveAC = useCallback((nextList) => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current)
    acDebounceRef.current = setTimeout(() => {
      triggerSaveAutocompletes(nextList)
    }, 400)
  }, [triggerSaveAutocompletes])

  const updateAcItem = (id, field, value) => {
    setAutocompletes(prev => {
      const next = prev.map(it => it.id === id ? { ...it, [field]: value } : it)
      scheduleAutoSaveAC(next)
      return next
    })
  }

  const deleteAcItem = (id) => {
    setAutocompletes(prev => {
      const next = prev.filter(it => it.id !== id)
      scheduleAutoSaveAC(next)
      return next
    })
  }

  const addAcItem = () => {
    const newId = `ac_${Date.now()}`
    const newItem = { id: newId, code: '', query: '', seleccionar: false }
    setAutocompletes(prev => {
      const next = [...prev, newItem]
      scheduleAutoSaveAC(next)
      return next
    })
    setAcFilter('')
  }

  const resetAcDefaults = async () => {
    if (window.confirm('¿Restablecer todos los autocompletados a los valores por defecto?')) {
      if (acDebounceRef.current) clearTimeout(acDebounceRef.current)
      setAutocompletes(DEFAULT_AUTOCOMPLETES)
      await triggerSaveAutocompletes(DEFAULT_AUTOCOMPLETES)
    }
  }

  // Browse Directory for Default Export OutDir
  const handleBrowseOutDir = async () => {
    try {
      const api = await go()
      const path = await api.PickDirectory()
      if (path) {
        updateSetting('defaultOutDir', path)
      }
    } catch { /* ignore */ }
  }

  // Clear History for Active Workspace
  const handleClearHistory = async () => {
    if (!activeWorkspace?.connInfo) return
    const dbName = activeWorkspace.connInfo.dbName
    if (!window.confirm(`¿Estás seguro de que deseas borrar todo el historial de consultas de la base de datos "${dbName}"? Esta acción no se puede deshacer.`)) {
      return
    }

    setClearingHistory(true)
    setClearHistoryMsg('')
    try {
      const api = await go()
      await api.ClearHistory(activeWorkspace.id)
      setClearHistoryMsg(`Historial de "${dbName}" borrado correctamente.`)
      setTimeout(() => setClearHistoryMsg(''), 3000)
    } catch (e) {
      setClearHistoryMsg(`Error al borrar historial: ${e}`)
    } finally {
      setClearingHistory(false)
    }
  }

  const filteredAutocompletes = autocompletes.filter(it => {
    if (!acFilter.trim()) return true
    const q = acFilter.toLowerCase()
    return (it.code || '').toLowerCase().includes(q) || (it.query || '').toLowerCase().includes(q)
  })

  const tabs = [
    { id: 'general', label: 'General', icon: Sliders },
    { id: 'editor', label: 'Editor SQL', icon: Code2 },
    { id: 'autocompletes', label: 'AutoCompletes', icon: Sparkles, badge: autocompletes.length },
    { id: 'history', label: 'Historial', icon: History },
    { id: 'export', label: 'Exportación', icon: FolderOutput },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-4xl h-[650px] max-h-[92vh] flex flex-col rounded-2xl border border-surface-600 shadow-2xl overflow-hidden glass animate-slide-up"
        style={{ background: '#0D1520' }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-surface-600/70 bg-surface-900/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-dark/40 border border-brand/40 text-brand-light">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">Configuración</h2>
              <p className="text-[11px] text-slate-400">Personaliza las opciones y herramientas de SapiExtractor</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(savedNotice || saving || acSaving || acSavedNotice) && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 animate-fade-in">
                <Check className="w-3.5 h-3.5" />
                {saving || acSaving ? 'Guardando…' : 'Guardado'}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700/60 transition-colors"
              title="Cerrar (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Tabs Sidebar + Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Settings Tabs Sidebar */}
          <div className="w-52 flex-shrink-0 border-r border-surface-600/60 bg-surface-950/40 p-3 flex flex-col gap-1 select-none">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2.5 mb-1.5">
              Preferencias
            </p>
            {tabs.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all text-left',
                  activeTab === id
                    ? 'bg-brand-dark/40 text-brand-light border border-brand/50 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-800/50'
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
                {badge !== undefined && (
                  <span className={clsx(
                    'text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold',
                    activeTab === id ? 'bg-amber-400/20 text-amber-300' : 'bg-surface-800 text-slate-400'
                  )}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content Panel */}
          <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-surface-900/30">
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                Cargando configuración…
              </div>
            ) : (
              <>
                {/* 1. GENERAL */}
                {activeTab === 'general' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-semibold text-white mb-1">Configuración General</h3>
                      <p className="text-xs text-slate-400">Comportamiento general de sesiones y espacios de trabajo.</p>
                    </div>

                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-4">
                      {/* AutoRestore Session */}
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-xs font-medium text-slate-200 cursor-pointer block">
                            Restaurar sesión automáticamente
                          </label>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Al iniciar la aplicación, reconecta directamente a las bases de datos guardadas en la sesión previa sin pedir confirmación.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.autoRestore}
                          onChange={(e) => updateSetting('autoRestore', e.target.checked)}
                          className="w-4 h-4 rounded text-brand border-surface-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Workspaces Info Card */}
                    <div className="p-4 rounded-xl glass border border-surface-600/60 flex items-start gap-3">
                      <Monitor className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-slate-300 space-y-1">
                        <p className="font-semibold text-white">Espacios de Trabajo Múltiples</p>
                        <p className="text-slate-400 leading-relaxed">
                          Puedes mantener hasta <strong className="text-slate-200">5 bases de datos conectadas simultáneamente</strong> en pestañas independientes (1 al 5).
                        </p>
                        <p className="text-slate-400 leading-relaxed">
                          Usa el atajo <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-slate-300 font-mono text-[10px] border border-surface-600">Ctrl + Tab</kbd> para alternar rápidamente entre espacios de trabajo sin perder tus consultas abiertas.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. EDITOR SQL */}
                {activeTab === 'editor' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-semibold text-white mb-1">Editor SQL</h3>
                      <p className="text-xs text-slate-400">Ajusta la apariencia y parámetros de ejecución del editor de consultas.</p>
                    </div>

                    {/* Font Size */}
                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-slate-200">
                            Tamaño de fuente del editor
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateSetting('editorFontSize', Math.max(9, settings.editorFontSize - 1))}
                              className="px-2 py-1 rounded bg-surface-800 border border-surface-600 text-slate-300 hover:text-white text-xs font-bold"
                              title="Reducir fuente"
                            >
                              -
                            </button>
                            <span className="font-mono text-xs font-bold text-amber-300 min-w-[36px] text-center">
                              {settings.editorFontSize} px
                            </span>
                            <button
                              onClick={() => updateSetting('editorFontSize', Math.min(32, settings.editorFontSize + 1))}
                              className="px-2 py-1 rounded bg-surface-800 border border-surface-600 text-slate-300 hover:text-white text-xs font-bold"
                              title="Aumentar fuente"
                            >
                              +
                            </button>
                            {settings.editorFontSize !== 12 && (
                              <button
                                onClick={() => updateSetting('editorFontSize', 12)}
                                className="text-[11px] text-slate-400 hover:text-slate-200 underline ml-2"
                              >
                                Restablecer (12px)
                              </button>
                            )}
                          </div>
                        </div>

                        <input
                          type="range"
                          min={9}
                          max={32}
                          value={settings.editorFontSize}
                          onChange={(e) => updateSetting('editorFontSize', Number(e.target.value))}
                          className="w-full accent-brand h-1.5 bg-surface-700 rounded-lg cursor-pointer"
                        />
                        <p className="text-[11px] text-slate-400 mt-2">
                          También puedes cambiar el tamaño dinámicamente en el editor manteniendo <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-slate-300 font-mono text-[10px] border border-surface-600">Ctrl + Rueda del ratón</kbd> o <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-slate-300 font-mono text-[10px] border border-surface-600">Ctrl + / -</kbd>.
                        </p>
                      </div>

                      {/* Live preview */}
                      <div className="pt-2 border-t border-surface-700/60">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                          Vista previa del editor
                        </p>
                        <div
                          className="p-3 rounded-lg bg-surface-950 font-mono border border-surface-800 text-slate-300 overflow-x-auto select-none"
                          style={{ fontSize: `${settings.editorFontSize}px`, lineHeight: 1.5 }}
                        >
                          <span className="text-blue-400">SELECT</span> id, nombre, fecha <br />
                          <span className="text-blue-400">FROM</span> dbo.admUsuarios <br />
                          <span className="text-blue-400">WHERE</span> activo = <span className="text-amber-400">1</span>;
                        </div>
                      </div>
                    </div>

                    {/* Default Row Limit */}
                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-200">
                          Límite de filas por defecto
                        </label>
                        <select
                          value={settings.defaultRowLimit}
                          onChange={(e) => updateSetting('defaultRowLimit', Number(e.target.value))}
                          className="input-field py-1.5 px-3 text-xs w-48 bg-surface-800 text-slate-200"
                        >
                          {ROW_LIMIT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Cantidad máxima de registros devueltos para consultas que no especifiquen cláusulas TOP, LIMIT o FETCH.
                      </p>
                    </div>
                  </div>
                )}

                {/* 3. AUTOCOMPLETES */}
                {activeTab === 'autocompletes' && (
                  <div className="space-y-4 flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between flex-shrink-0">
                      <div>
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                          AutoCompletes Rápidos
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 font-bold">
                            {autocompletes.length} configurados
                          </span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Escribe el código en el editor y presiona <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-amber-300 font-mono text-[10px] border border-surface-600">TAB</kbd> para insertar la consulta. Usa <code className="text-amber-300 font-bold">#</code> para ubicar el cursor.
                        </p>
                      </div>
                    </div>

                    {/* Toolbar */}
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-950/60 border border-surface-700/60 flex-shrink-0">
                      <input
                        type="text"
                        placeholder="Buscar por código o consulta…"
                        value={acFilter}
                        onChange={(e) => setAcFilter(e.target.value)}
                        className="input-field py-1 px-2.5 text-xs w-60"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={resetAcDefaults}
                          className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
                          title="Restablecer a valores por defecto"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Valores por defecto
                        </button>
                        <button
                          onClick={addAcItem}
                          className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Nuevo código
                        </button>
                      </div>
                    </div>

                    {/* Table Container */}
                    <div className="flex-1 overflow-auto rounded-xl border border-surface-700/50 bg-surface-950/40 p-1">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-surface-700/70 text-left text-slate-400 font-medium">
                            <th className="py-2 px-3 w-32">Código</th>
                            <th className="py-2 px-3">Consulta SQL resultante</th>
                            <th className="py-2 px-3 w-28 text-center" title="Selecciona todo el texto al autocompletar">
                              Auto-seleccionar
                            </th>
                            <th className="py-2 px-3 w-16 text-center">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-800/40">
                          {filteredAutocompletes.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-slate-500 text-xs">
                                {acFilter ? 'No se encontraron resultados.' : 'No hay autocompletados registrados.'}
                              </td>
                            </tr>
                          ) : (
                            filteredAutocompletes.map((item) => (
                              <tr key={item.id} className="hover:bg-surface-800/30 transition-colors">
                                <td className="py-1.5 px-3 align-top">
                                  <input
                                    type="text"
                                    value={item.code}
                                    placeholder="ej. sel"
                                    onChange={(e) => updateAcItem(item.id, 'code', e.target.value)}
                                    className="w-full bg-surface-800/80 border border-surface-600/80 focus:border-amber-400 rounded-md px-2 py-1 text-xs font-mono font-bold text-amber-300 outline-none"
                                  />
                                </td>
                                <td className="py-1.5 px-3 align-top">
                                  <textarea
                                    rows={1}
                                    value={item.query}
                                    placeholder="ej. SELECT * FROM tabla"
                                    onChange={(e) => updateAcItem(item.id, 'query', e.target.value)}
                                    className="w-full bg-surface-800/80 border border-surface-600/80 focus:border-brand-light rounded-md px-2.5 py-1 text-xs font-mono text-slate-200 outline-none resize-y min-h-[28px]"
                                  />
                                </td>
                                <td className="py-1.5 px-3 text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => updateAcItem(item.id, 'seleccionar', !item.seleccionar)}
                                    className={clsx(
                                      'p-1 rounded-md transition-all inline-flex items-center gap-1 text-[11px]',
                                      item.seleccionar
                                        ? 'text-amber-300 bg-amber-400/20 border border-amber-400/40'
                                        : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                    )}
                                  >
                                    {item.seleccionar ? <CheckSquare className="w-3.5 h-3.5 text-amber-400" /> : <Square className="w-3.5 h-3.5" />}
                                    <span>{item.seleccionar ? 'Sí' : 'No'}</span>
                                  </button>
                                </td>
                                <td className="py-1.5 px-3 text-center align-middle">
                                  <button
                                    onClick={() => deleteAcItem(item.id)}
                                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. HISTORIAL */}
                {activeTab === 'history' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-semibold text-white mb-1">Historial de Consultas</h3>
                      <p className="text-xs text-slate-400">Controla la retención y almacenamiento del historial de ejecución.</p>
                    </div>

                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-4">
                      {/* Enable History */}
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <label className="text-xs font-medium text-slate-200 cursor-pointer block">
                            Habilitar registro de historial
                          </label>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Guarda automáticamente cada consulta ejecutada para poder consultarla o restaurarla desde el botón "Historial".
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.historyEnabled}
                          onChange={(e) => updateSetting('historyEnabled', e.target.checked)}
                          className="w-4 h-4 rounded text-brand border-surface-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                      </div>

                      <div className="border-t border-surface-700/60 pt-3 grid grid-cols-2 gap-4">
                        {/* Retention Days */}
                        <div>
                          <label className="text-xs font-medium text-slate-200 block mb-1">
                            Días de retención
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={3650}
                            value={settings.retentionDays}
                            onChange={(e) => updateSetting('retentionDays', Math.max(1, Number(e.target.value)))}
                            className="input-field py-1.5 px-3 text-xs w-full bg-surface-800 text-slate-200"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Consultas anteriores a este plazo se depurarán automáticamente (por defecto 90 días).
                          </p>
                        </div>

                        {/* Max Entries */}
                        <div>
                          <label className="text-xs font-medium text-slate-200 block mb-1">
                            Máximo de entradas
                          </label>
                          <input
                            type="number"
                            min={100}
                            max={50000}
                            step={500}
                            value={settings.maxEntries}
                            onChange={(e) => updateSetting('maxEntries', Math.max(100, Number(e.target.value)))}
                            className="input-field py-1.5 px-3 text-xs w-full bg-surface-800 text-slate-200"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Límite de ejecuciones guardadas por cada base de datos (por defecto 5.000).
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Active DB Maintenance */}
                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-3">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-sky-400" />
                        <h4 className="text-xs font-semibold text-white">Mantenimiento de Historial Activo</h4>
                      </div>

                      {activeWorkspace?.connInfo ? (
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs text-slate-300">
                              Base de datos actual:{' '}
                              <strong className="text-white font-mono">{activeWorkspace.connInfo.dbName}</strong>{' '}
                              <span className="text-slate-500">({activeWorkspace.connInfo.host})</span>
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Elimina todo el historial acumulado exclusivamente para esta base de datos.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={clearingHistory}
                            onClick={handleClearHistory}
                            className="btn-danger text-xs py-1.5 px-3 flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {clearingHistory ? 'Borrando…' : 'Vaciar historial'}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">
                          El espacio de trabajo actual no tiene una base de datos conectada. Conéctate a una base para gestionar su historial.
                        </p>
                      )}

                      {clearHistoryMsg && (
                        <p className="text-xs text-emerald-400 font-medium animate-fade-in">
                          {clearHistoryMsg}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. EXPORTACIÓN */}
                {activeTab === 'export' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-semibold text-white mb-1">Exportación de Objetos</h3>
                      <p className="text-xs text-slate-400">Opciones para la exportación y guardado de scripts SQL.</p>
                    </div>

                    <div className="p-4 rounded-xl glass border border-surface-600/60 space-y-4">
                      {/* Default OutDir */}
                      <div>
                        <label className="text-xs font-medium text-slate-200 block mb-1.5">
                          Carpeta de salida por defecto
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            placeholder="Ninguna (se preguntará al exportar)"
                            value={settings.defaultOutDir}
                            className="input-field py-1.5 px-3 text-xs flex-1 bg-surface-950 font-mono text-slate-300 truncate"
                          />
                          <button
                            type="button"
                            onClick={handleBrowseOutDir}
                            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Examinar…
                          </button>
                          {settings.defaultOutDir && (
                            <button
                              type="button"
                              onClick={() => updateSetting('defaultOutDir', '')}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-surface-800"
                              title="Limpiar carpeta predeterminada"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1.5">
                          Carpeta seleccionada automáticamente como destino al exportar objetos masivamente.
                        </p>
                      </div>

                      {/* Include DROP IF EXISTS */}
                      <div className="pt-3 border-t border-surface-700/60 flex items-center justify-between gap-4">
                        <div>
                          <label className="text-xs font-medium text-slate-200 cursor-pointer block">
                            Incluir sentencia DROP IF EXISTS
                          </label>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Genera la cabecera condicional para eliminar el objeto previo antes de crear uno nuevo (IF EXISTS ... DROP ...).
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.includeDropHeader}
                          onChange={(e) => updateSetting('includeDropHeader', e.target.checked)}
                          className="w-4 h-4 rounded text-brand border-surface-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-surface-600/70 bg-surface-900/60">
          <div className="text-[11px] text-slate-500">
            Los cambios se guardan permanentemente en <code className="font-mono text-slate-400 bg-surface-800 px-1 py-0.5 rounded">~/.spextractor</code>
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
