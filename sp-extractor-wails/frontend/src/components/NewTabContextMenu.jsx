import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Plus } from 'lucide-react'

/**
 * Context menu shown when right-clicking the "+" button in the query tab bar.
 *
 * Props:
 *  - x, y        : screen coordinates
 *  - onClose     : close the menu
 *  - onOpenSql   : open an existing .sql file from disk
 *  - onNewTab    : create a new empty query tab
 */
export default function NewTabContextMenu({ x, y, onClose, onOpenSql, onNewTab }) {
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
    onClose()
    fn?.()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[210px] rounded-lg border border-surface-600/90 py-1 text-xs shadow-2xl backdrop-blur-sm select-none"
      style={{ top: coords.top, left: coords.left, background: '#18191a' }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1 border-b border-surface-700/60 mb-1">
        <span className="block font-mono text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
          Pestañas de consulta
        </span>
      </div>

      {/* Abrir archivo .sql existente */}
      <button
        type="button"
        onClick={handle(onOpenSql)}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
      >
        <FolderOpen className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        <span className="flex-1 font-medium">Abrir archivo .sql…</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Ctrl+O
        </span>
      </button>

      {/* Nueva pestaña vacía */}
      <button
        type="button"
        onClick={handle(onNewTab)}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
      >
        <Plus className="w-3.5 h-3.5 text-brand-light flex-shrink-0" />
        <span className="flex-1 font-medium">Nueva consulta vacía</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Ctrl+N
        </span>
      </button>
    </div>,
    document.body
  )
}
