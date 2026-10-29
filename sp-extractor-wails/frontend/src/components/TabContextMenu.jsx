import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Save, SaveAll, X } from 'lucide-react'
import clsx from 'clsx'

/**
 * Context menu shown when right-clicking a query tab.
 *
 * Props:
 *  - x, y        : screen coordinates where the menu should appear
 *  - tab         : the tab object ({ id, title, sql, savedPath })
 *  - onClose     : close the menu
 *  - onSave      : "Guardar" — save to existing path or open dialog if new
 *  - onSaveAs    : "Guardar como…" — always open the save dialog
 *  - onCloseTab  : "Cerrar pestaña" — close this tab
 */
export default function TabContextMenu({ x, y, tab, onClose, onSave, onSaveAs, onCloseTab }) {
  const menuRef = useRef(null)
  const [coords, setCoords] = useState({ top: y, left: x })

  // Adjust position so the menu doesn't overflow screen boundaries
  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let top = y
    let left = x
    if (left + rect.width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - rect.width - 10)
    }
    if (top + rect.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - rect.height - 10)
    }
    setCoords({ top, left })
  }, [x, y])

  // Close on outside click, Escape, scroll or resize
  useEffect(() => {
    const handleDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    const handleScroll = () => onClose()

    window.addEventListener('pointerdown', handleDown, true)
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('wheel', handleScroll, { passive: true })
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', handleDown, true)
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('wheel', handleScroll)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const handle = (fn) => (e) => {
    e.stopPropagation()
    fn?.()
  }

  const hasSql = Boolean(tab?.sql?.trim())

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-lg border border-surface-600/90 py-1 text-xs shadow-2xl backdrop-blur-sm select-none"
      style={{ top: coords.top, left: coords.left, background: '#18191a' }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header: tab title */}
      <div className="px-3 py-1.5 border-b border-surface-700/60 mb-1">
        <span className="block truncate font-mono text-[11px] text-slate-400" title={tab?.title}>
          {tab?.title || 'Pestaña'}
        </span>
        {tab?.savedPath && (
          <span className="block truncate text-[10px] text-slate-600 mt-0.5" title={tab.savedPath}>
            {tab.savedPath}
          </span>
        )}
      </div>

      {/* Guardar (Ctrl+S) */}
      <button
        type="button"
        disabled={!hasSql}
        onClick={handle(() => onSave?.(tab))}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasSql
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        <Save className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        <span className="flex-1 font-medium">Guardar</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Ctrl+S
        </span>
      </button>

      {/* Guardar como… */}
      <button
        type="button"
        disabled={!hasSql}
        onClick={handle(() => onSaveAs?.(tab))}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasSql
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        <SaveAll className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
        <span className="flex-1 font-medium">Guardar como…</span>
      </button>

      <div className="my-1 border-t border-surface-700/60" />

      {/* Cerrar pestaña */}
      <button
        type="button"
        onClick={handle(() => onCloseTab?.(tab))}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors text-slate-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
      >
        <X className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 font-medium">Cerrar pestaña</span>
      </button>
    </div>,
    document.body
  )
}
