import { useState, useMemo } from 'react'
import { Loader2, Search, CheckSquare, Square, Minus, ChevronUp, ChevronDown, Eye, Network, FileCode } from 'lucide-react'
import clsx from 'clsx'

export default function ObjectTable({
  objects,
  selectedKeys,
  onSelectionChange,
  onPreview,
  previewKey,
  onRelations,
  onScripts,
  search,
  onSearchChange,
  searching,
  hasMore,
  totalCount,
  filteredCount,
  objType,
  onSelectAllServer,
  selectingAll,
}) {
  const [sortDir, setSortDir] = useState('asc')

  // The list is already filtered (and capped) by the database; here we only sort.
  const filtered = useMemo(() => {
    return [...objects]
      .sort((a, b) => {
        const fa = objType === 'COLUMN'
          ? (a.parentName ? a.parentName + '.' : '') + a.name
          : (a.schema ? a.schema + '.' : '') + a.name
        const fb = objType === 'COLUMN'
          ? (b.parentName ? b.parentName + '.' : '') + b.name
          : (b.schema ? b.schema + '.' : '') + b.name
        return sortDir === 'asc' ? fa.localeCompare(fb) : fb.localeCompare(fa)
      })
  }, [objects, sortDir, objType])

  const allVisibleKeys = filtered.map(objKey)
  const allChecked = allVisibleKeys.length > 0 && allVisibleKeys.every(k => selectedKeys.has(k))
  const someChecked = !allChecked && allVisibleKeys.some(k => selectedKeys.has(k))

  const toggleAll = () => {
    if (allChecked) {
      const next = new Set(selectedKeys)
      allVisibleKeys.forEach(k => next.delete(k))
      onSelectionChange(next)
    } else {
      const next = new Set(selectedKeys)
      allVisibleKeys.forEach(k => next.add(k))
      onSelectionChange(next)
    }
  }

  const toggle = (key) => {
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectionChange(next)
  }

  const effectiveTotal = search
    ? (filteredCount != null ? filteredCount : null)
    : (totalCount != null ? totalCount : null)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            className="input-field pl-8 py-1.5"
            placeholder={objType === 'COLUMN' ? "Buscar columna, ej. ControlFactura. o Numfactura…" : "Buscar en toda la base de datos…"}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-brand-light" />}
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {selectedKeys.size} seleccionados · {
            search
              ? (filteredCount != null
                  ? (objects.length < filteredCount
                      ? `${objects.length} de ${filteredCount.toLocaleString()} encontrados`
                      : `${objects.length} encontrados`)
                  : `${objects.length}`)
              : (totalCount != null
                  ? (objects.length < totalCount
                      ? `${objects.length} de ${totalCount.toLocaleString()}`
                      : `${totalCount.toLocaleString()} objetos`)
                  : `${objects.length}${hasMore ? '+' : ''}`)
          }
        </span>
      </div>

      {/* Banner de selección masiva completa cuando se han marcado los visibles y hay más en la base de datos */}
      {allChecked && hasMore && onSelectAllServer && (
        <div className="flex items-center justify-between px-3.5 py-2 mb-2 rounded-lg bg-brand-dark/40 border border-brand-500/40 text-xs text-slate-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-light animate-pulse" />
            <span>
              Se seleccionaron los <strong className="text-white">{filtered.length}</strong> objetos de esta página.
            </span>
          </div>
          <button
            type="button"
            onClick={onSelectAllServer}
            disabled={selectingAll}
            className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5 font-medium shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            {selectingAll ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Cargando todos los objetos...</span>
              </>
            ) : (
              <span>
                Seleccionar todos los {effectiveTotal != null ? effectiveTotal.toLocaleString() : ''} objetos
              </span>
            )}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-surface-600">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: '#111B2C' }}>
              <th className="w-8 px-3 py-2.5">
                <button onClick={toggleAll} className="text-slate-400 hover:text-brand-light transition-colors" title={allChecked ? "Deseleccionar todo" : "Seleccionar todo"}>
                  {allChecked ? (
                    <CheckSquare className="w-4 h-4 text-brand-light" />
                  ) : someChecked ? (
                    <Minus className="w-4 h-4 text-brand-glow" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th
                className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors"
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              >
                <span className="flex items-center gap-1">
                  Name
                  {sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </span>
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400">
                {objType === 'COLUMN' ? 'Tabla' : 'Schema'}
              </th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-12 text-slate-500 text-sm">
                  {search ? 'No results match your search.' : 'No objects found.'}
                </td>
              </tr>
            ) : filtered.map((obj, i) => {
              const key = objKey(obj)
              const checked = selectedKeys.has(key)
              return (
                <tr
                  key={key}
                  onClick={() => toggle(key)}
                  className={clsx(
                    'cursor-pointer transition-colors border-t border-surface-700/50',
                    (checked || key === previewKey) ? 'bg-brand-dark/20' : i % 2 === 0 ? 'hover:bg-surface-700/40' : 'bg-surface-800/30 hover:bg-surface-700/40'
                  )}
                >
                  <td className="w-8 px-3 py-2">
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-brand-light" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600" />
                    )}
                  </td>
                  <td
                    className="px-3 py-2 font-medium text-white font-mono text-xs hover:text-brand-light hover:underline underline-offset-2"
                    onClick={e => { e.stopPropagation(); onPreview?.(obj) }}
                    title="Ver definición"
                  >
                    {obj.name}
                  </td>
                  <td
                    className="px-3 py-2 text-slate-400 text-xs"
                    title={objType === 'COLUMN' && obj.schema ? `${obj.schema}.${obj.parentName || ''}` : undefined}
                  >
                    {objType === 'COLUMN' ? (obj.parentName || '—') : (obj.schema || '—')}
                  </td>
                  <td className="w-10 px-3 py-2 whitespace-nowrap">
                    {onScripts && (
                      <button
                        className="p-1 mr-1 rounded text-slate-500 hover:text-brand-light hover:bg-brand-dark/30 transition-colors"
                        onClick={e => { e.stopPropagation(); onScripts(obj) }}
                        title="Generar scripts (CREATE, SELECT, INSERT…)"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onRelations && (
                      <button
                        className="p-1 mr-1 rounded text-slate-500 hover:text-brand-light hover:bg-brand-dark/30 transition-colors"
                        onClick={e => { e.stopPropagation(); onRelations(obj) }}
                        title="Ver relaciones (llaves foráneas)"
                      >
                        <Network className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      className="p-1 rounded text-slate-500 hover:text-brand-light hover:bg-brand-dark/30 transition-colors"
                      onClick={e => { e.stopPropagation(); onPreview?.(obj) }}
                      title="Ver definición"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="flex items-center justify-between mt-2 text-[11px] text-amber-400">
          <p>
            {search
              ? `Mostrando los primeros ${objects.length} de ${filteredCount != null ? filteredCount.toLocaleString() : (objects.length + '+')} encontrados. Refina la búsqueda si no ves el que buscas.`
              : `Mostrando los primeros ${objects.length} de ${totalCount != null ? totalCount.toLocaleString() : (objects.length + '+')}. Usa el buscador para encontrar el resto.`}
          </p>
          {onSelectAllServer && (
            <button
              type="button"
              onClick={onSelectAllServer}
              disabled={selectingAll}
              className="text-brand-light hover:underline font-medium flex items-center gap-1 ml-2 whitespace-nowrap cursor-pointer"
            >
              {selectingAll && <Loader2 className="w-3 h-3 animate-spin" />}
              Cargar y seleccionar todos ({effectiveTotal != null ? effectiveTotal.toLocaleString() : 'todos'})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function objKey(obj) {
  return `${obj.schema}|${obj.parentName || ''}|${obj.name}|${obj.type}`
}
