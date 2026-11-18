import {
  FolderOpen,
  Files,
  ArrowUpDown,
  Trash2,
  CheckSquare,
  Square as SquareOutline,
  RotateCcw,
} from 'lucide-react'

export default function ScriptRunnerToolbar({
  runnerState, // 'idle' | 'running' | 'paused' | 'done'
  scriptsCount,
  enabledCount,
  successCount,
  failedCount,
  sortOrder,
  onSortChange,
  folderOrder,
  onFolderOrderChange,
  hasFolders,
  onResetStatus,
  onSelectAll,
  onDeselectAll,
  onClearList,
  onOpenFiles,
  onOpenFolder,
}) {
  const isRunning = runnerState === 'running'

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl glass border border-surface-600/60 flex-wrap flex-shrink-0"
      style={{ background: 'rgba(13, 21, 32, 0.85)' }}
    >
      {/* Add files / folder buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isRunning}
          onClick={onOpenFiles}
          className="btn-secondary text-xs py-1.5 px-3"
          title="Abrir uno o varios archivos SQL"
        >
          <Files className="w-3.5 h-3.5 text-sky-400" />
          <span>+ Archivos</span>
        </button>
        <button
          type="button"
          disabled={isRunning}
          onClick={onOpenFolder}
          className="btn-secondary text-xs py-1.5 px-3"
          title="Escanear carpeta recursivamente (incluye todas sus subcarpetas)"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span>+ Carpeta</span>
        </button>
      </div>

      <div className="h-5 w-[1px] bg-surface-600/60 mx-1 hidden sm:block" />

      {/* Sort Orders */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 text-slate-500" />
          Orden:
        </span>
        <select
          value={sortOrder}
          disabled={isRunning || scriptsCount === 0}
          onChange={(e) => onSortChange(e.target.value)}
          className="select-field text-xs py-1 px-2.5 bg-surface-800/80 border-surface-600/80 rounded-lg text-slate-200 cursor-pointer"
        >
          <option value="name-asc">Nombre (A → Z)</option>
          <option value="name-desc">Nombre (Z → A)</option>
          <option value="date-asc">Fecha (antiguos primero)</option>
          <option value="date-desc">Fecha (recientes primero)</option>
          <option value="folder-name-asc">Por carpeta, luego nombre (A → Z)</option>
          <option value="folder-name-desc">Por carpeta, luego nombre (Z → A)</option>
          <option value="manual">Manual (arrastrar y soltar)</option>
        </select>

        {hasFolders && (
          <select
            value={folderOrder}
            disabled={isRunning || scriptsCount === 0}
            onChange={(e) => onFolderOrderChange(e.target.value)}
            className="select-field text-xs py-1 px-2.5 bg-surface-800/80 border-surface-600/80 rounded-lg text-slate-200 cursor-pointer ml-1"
            title="Orden de ejecución entre carpetas"
          >
            <option value="asc">Carpetas: A → Z</option>
            <option value="desc">Carpetas: Z → A</option>
          </select>
        )}
      </div>

      <div className="flex-1" />

      {/* Status Counters */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {scriptsCount > 0 && (
          <>
            <span className="badge-blue" title={`${enabledCount} de ${scriptsCount} marcados en la lista`}>
              {enabledCount}/{scriptsCount} marcados
            </span>
            {successCount > 0 && (
              <span className="badge-green" title={`${successCount} script(s) exitosos en la lista`}>
                ✓ {successCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="badge-red" title={`${failedCount} script(s) con error en la lista`}>
                ✗ {failedCount}
              </span>
            )}
          </>
        )}
      </div>

      {/* Extra Action Buttons */}
      <div className="flex items-center gap-1 pl-1">
        <button
          type="button"
          disabled={isRunning || scriptsCount === 0}
          onClick={onSelectAll}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700/60 transition-colors"
          title="Marcar todos en la lista actual"
        >
          <CheckSquare className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={isRunning || scriptsCount === 0}
          onClick={onDeselectAll}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700/60 transition-colors"
          title="Desmarcar todos en la lista actual"
        >
          <SquareOutline className="w-3.5 h-3.5" />
        </button>
        {(successCount > 0 || failedCount > 0) && (
          <button
            type="button"
            disabled={isRunning}
            onClick={onResetStatus}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700/60 transition-colors"
            title="Reiniciar estados de ejecución de la lista actual"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          disabled={isRunning || scriptsCount === 0}
          onClick={onClearList}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Limpiar todos los scripts"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
