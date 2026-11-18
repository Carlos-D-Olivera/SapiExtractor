import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Play, Check, AlertCircle, Loader2, Folder, FileCode2 } from 'lucide-react'
import clsx from 'clsx'

export default function ScriptListItem({
  script,
  isSelected,
  isRunning,
  onSelect,
  onToggleCheck,
  onRunSingle,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: script.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const status = script.status || 'idle'

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect?.(script.id)}
      className={clsx(
        'group relative flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs cursor-pointer transition-all duration-150 select-none',
        isDragging && 'opacity-50 z-20 shadow-xl border-brand-light scale-[1.01]',
        // Status border styling as requested:
        status === 'success' && 'border-emerald-500/80 bg-emerald-950/20 hover:border-emerald-400',
        status === 'failed' && 'border-red-500/90 bg-red-950/25 hover:border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.15)]',
        status === 'running' && 'border-sky-400 bg-sky-950/30 animate-pulse',
        status === 'idle' && !isSelected && 'border-surface-600/60 bg-surface-800/40 hover:bg-surface-800/80 hover:border-surface-500',
        isSelected && status === 'idle' && 'border-brand/70 bg-brand-dark/25 shadow-sm',
        !script.enabled && 'opacity-60'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Arrastra para cambiar el orden de ejecución"
        onClick={(e) => e.stopPropagation()}
        className="p-1 -ml-1 text-slate-500 hover:text-slate-200 cursor-grab active:cursor-grabbing rounded hover:bg-surface-700/50 flex-shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Checkbox to run or skip */}
      <input
        type="checkbox"
        checked={!!script.enabled}
        onChange={(e) => {
          e.stopPropagation()
          onToggleCheck?.(script.id, e.target.checked)
        }}
        onClick={(e) => e.stopPropagation()}
        title={script.enabled ? 'Marcado para ejecutar' : 'Desmarcado (no se ejecutará)'}
        className="w-4 h-4 rounded text-brand border-surface-500 bg-surface-900 focus:ring-0 focus:ring-offset-0 cursor-pointer flex-shrink-0 accent-sky-500"
      />

      {/* Run Single Triangle Button */}
      <button
        type="button"
        disabled={isRunning}
        onClick={(e) => {
          e.stopPropagation()
          onRunSingle?.(script)
        }}
        title="Ejecutar solo este script"
        className={clsx(
          'p-1.5 rounded-lg flex items-center justify-center transition-all flex-shrink-0',
          isRunning
            ? 'opacity-40 cursor-not-allowed'
            : 'text-sky-400 hover:text-white bg-sky-500/10 hover:bg-sky-500/25 border border-sky-500/30 active:scale-95'
        )}
      >
        <Play className="w-3.5 h-3.5 fill-current" />
      </button>

      {/* Status icon badge */}
      <div className="flex-shrink-0 w-5 flex items-center justify-center">
        {status === 'running' && (
          <Loader2 className="w-4 h-4 text-sky-400 animate-spin" title="Ejecutando..." />
        )}
        {status === 'success' && (
          <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center" title="Ejecutado con éxito (chulo)">
            <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
          </div>
        )}
        {status === 'failed' && (
          <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center" title="Falló la ejecución">
            <AlertCircle className="w-3 h-3 text-red-400 stroke-[2.5]" />
          </div>
        )}
        {status === 'idle' && (
          <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
        )}
      </div>

      {/* Script info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              'font-mono font-medium truncate',
              status === 'success' && 'text-emerald-300 font-semibold',
              status === 'failed' && 'text-red-300 font-semibold',
              status === 'running' && 'text-sky-300',
              status === 'idle' && (isSelected ? 'text-white' : 'text-slate-200')
            )}
            title={script.fileName}
          >
            {script.fileName}
          </span>
        </div>

        {/* Subfolder & metadata tags */}
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
          {script.folder && (
            <span className="flex items-center gap-1 text-slate-400 font-mono truncate max-w-[160px]" title={`Carpeta: ${script.folder}`}>
              <Folder className="w-3 h-3 text-amber-500/80 flex-shrink-0" />
              <span className="truncate">{script.folder}</span>
            </span>
          )}
          {script.durationMs !== undefined && status !== 'idle' && (
            <span className={clsx(status === 'success' ? 'text-emerald-400/80' : 'text-red-400/80')}>
              {script.durationMs}ms
            </span>
          )}
          {script.size > 0 && (
            <span>{(script.size / 1024).toFixed(1)} KB</span>
          )}
        </div>
      </div>
    </div>
  )
}
