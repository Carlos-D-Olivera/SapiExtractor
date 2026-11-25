import { BookmarkPlus, BookmarkMinus, ChevronUp, ChevronDown } from 'lucide-react'
import { editBookmark, goToBookmark, isProcedureScript } from '../utils/editorBookmarks'

export default function BookmarkToolbar({ sql, positions = [], viewRef }) {
  if (!isProcedureScript(sql)) return null
  const buttons = [
    ['Agregar marcador en la línea del cursor', BookmarkPlus, () => editBookmark(viewRef.current, true), false],
    ['Quitar marcador de la línea del cursor', BookmarkMinus, () => editBookmark(viewRef.current, false), !positions.length],
    ['Marcador anterior', ChevronUp, () => goToBookmark(viewRef.current, -1), !positions.length],
    ['Marcador siguiente', ChevronDown, () => goToBookmark(viewRef.current, 1), !positions.length],
  ]
  return (
    <div role="group" aria-label="Marcadores del procedimiento" className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-surface-600/70 text-violet-300">
      <span className="text-[10px] px-1">Marcadores · {positions.length}</span>
      {buttons.map(([title, Icon, onClick, disabled]) => (
        <button key={title} type="button" title={title} aria-label={title} disabled={disabled}
                onMouseDown={event => event.preventDefault()} onClick={onClick}
                className="p-1 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  )
}
