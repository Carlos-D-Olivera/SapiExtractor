import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { FileCode, FolderOpen, Files } from 'lucide-react'
import ScriptListItem from './ScriptListItem'

export default function ScriptList({
  scripts,
  selectedId,
  runningScriptId,
  isExecutingAll,
  onSelect,
  onToggleCheck,
  onRunSingle,
  onReorder,
  onOpenFiles,
  onOpenFolder,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = scripts.findIndex((s) => s.id === active.id)
    const newIndex = scripts.findIndex((s) => s.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(scripts, oldIndex, newIndex)
      onReorder?.(reordered)
    }
  }

  if (scripts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center border border-dashed border-surface-600/70 rounded-2xl bg-surface-900/30">
        <div className="p-4 rounded-2xl bg-brand-dark/20 border border-brand/30 text-brand-light mb-3">
          <FileCode className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">No hay scripts cargados</h3>
        <p className="text-xs text-slate-400 max-w-[280px] mb-4 leading-relaxed">
          Abre archivos .sql individuales o selecciona una carpeta completa con scripts para ejecutarlos en secuencia.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onOpenFiles}
            className="btn-primary text-xs py-2 px-3"
          >
            <Files className="w-3.5 h-3.5" />
            + Archivos .sql
          </button>
          <button
            type="button"
            onClick={onOpenFolder}
            className="btn-secondary text-xs py-2 px-3"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            + Carpeta
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 select-none">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={scripts.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {scripts.map((script) => (
            <ScriptListItem
              key={script.id}
              script={script}
              isSelected={script.id === selectedId}
              isRunning={isExecutingAll || runningScriptId === script.id}
              onSelect={onSelect}
              onToggleCheck={onToggleCheck}
              onRunSingle={onRunSingle}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
