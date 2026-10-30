import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Scissors, ClipboardPaste, Eye, Table2, FileCode2, Network, Copy, Check, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

export default function SqlContextMenu({
  x,
  y,
  target,
  onClose,
  onAltF1,
  onSelectTop100,
  onOpenRelations,
  onOpenScripts,
  onGenerateScript,
  onCopyName,
  hasSelection,
  onCut,
  onCopy,
  onPaste,
}) {
  const menuRef = useRef(null)
  const submenuRef = useRef(null)
  const [coords, setCoords] = useState({ top: y, left: x })
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [submenuToLeft, setSubmenuToLeft] = useState(false)
  const [copied, setCopied] = useState(false)

  // Adjust menu position so it doesn't overflow screen boundaries
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
    // If opening submenu to the right would overflow, open to the left
    if (left + rect.width + 190 > window.innerWidth - 10) {
      setSubmenuToLeft(true)
    } else {
      setSubmenuToLeft(false)
    }
  }, [x, y])

  // Close handlers: outside click, Escape, scroll, resize
  useEffect(() => {
    const handleDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
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

  const handleAction = (fn) => (e) => {
    e.stopPropagation()
    onClose()
    fn?.()
  }

  const handleCopy = (e) => {
    e.stopPropagation()
    if (!target) return
    onCopyName?.(target)
    setCopied(true)
    setTimeout(() => {
      onClose()
    }, 450)
  }

  const hasTarget = Boolean(target && target.trim())

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[210px] rounded-lg border border-surface-600/90 py-1 text-xs shadow-2xl backdrop-blur-sm select-none"
      style={{
        top: coords.top,
        left: coords.left,
        background: '#18191a',
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header showing the detected object name */}
      <div className="px-3 py-1.5 border-b border-surface-700/60 mb-1 flex items-center gap-2">
        <Table2 className="w-3.5 h-3.5 text-brand-light flex-shrink-0" />
        <span
          className={clsx(
            'truncate font-mono text-[11px]',
            hasTarget ? 'text-white font-semibold' : 'text-slate-500 italic'
          )}
          title={hasTarget ? target : 'Sin elemento bajo el cursor'}
        >
          {hasTarget ? target : '(Sin objeto detectado)'}
        </span>
      </div>

      {/* Edición: cortar / copiar / pegar */}
      {[
        { label: 'Cortar', icon: Scissors, key: 'Ctrl+X', fn: onCut, needsSel: true },
        { label: 'Copiar', icon: Copy, key: 'Ctrl+C', fn: onCopy, needsSel: true },
        { label: 'Pegar', icon: ClipboardPaste, key: 'Ctrl+V', fn: onPaste, needsSel: false },
      ].map(a => {
        const enabled = !a.needsSel || hasSelection
        return (
          <button
            key={a.label}
            type="button"
            disabled={!enabled}
            onClick={handleAction(a.fn)}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
              enabled ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer' : 'text-slate-600 cursor-not-allowed'
            )}
          >
            <a.icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="flex-1 font-medium">{a.label}</span>
            <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">{a.key}</span>
          </button>
        )
      })}

      <div className="my-1 border-t border-surface-700/60" />

      {/* 1. Ir a definición (Alt+F1) */}
      <button
        type="button"
        disabled={!hasTarget}
        onClick={handleAction(() => onAltF1?.(target))}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasTarget
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        <Eye className="w-3.5 h-3.5 text-brand-light flex-shrink-0" />
        <span className="flex-1 font-medium">Ir a definición</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Alt+F1
        </span>
      </button>

      {/* 2. Consultar primeras 100 filas (Ctrl+Shift+T) */}
      <button
        type="button"
        disabled={!hasTarget}
        onClick={handleAction(() => onSelectTop100?.(target))}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasTarget
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        <Table2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        <span className="flex-1 font-medium">Primeras 100 filas</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Ctrl+Shift+T
        </span>
      </button>

      {/* 3. Generar Scripts (Submenú con SELECT, INSERT, UPDATE, DDL) */}
      <div
        className="relative"
        onMouseEnter={() => hasTarget && setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button
          type="button"
          disabled={!hasTarget}
          onClick={() => hasTarget && setSubmenuOpen(prev => !prev)}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
            hasTarget
              ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
              : 'text-slate-600 cursor-not-allowed'
          )}
        >
          <FileCode2 className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="flex-1 font-medium">Generar scripts</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {submenuOpen && hasTarget && (
          <div
            ref={submenuRef}
            className={clsx(
              'absolute top-0 z-50 min-w-[170px] rounded-lg border border-surface-600/90 py-1 text-xs shadow-2xl backdrop-blur-sm',
              submenuToLeft ? 'right-full mr-1' : 'left-full ml-1'
            )}
            style={{ background: '#18191a' }}
          >
            <button
              type="button"
              onClick={handleAction(() => onGenerateScript?.(target, 'select'))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
            >
              <span className="font-mono font-medium text-emerald-400">SELECT</span>
              <span className="text-slate-400 text-[11px] ml-auto">Todas las col.</span>
            </button>
            <button
              type="button"
              onClick={handleAction(() => onGenerateScript?.(target, 'insert'))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
            >
              <span className="font-mono font-medium text-amber-400">INSERT</span>
              <span className="text-slate-400 text-[11px] ml-auto">Plantilla</span>
            </button>
            <button
              type="button"
              onClick={handleAction(() => onGenerateScript?.(target, 'update'))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
            >
              <span className="font-mono font-medium text-sky-400">UPDATE</span>
              <span className="text-slate-400 text-[11px] ml-auto">Plantilla</span>
            </button>
            <button
              type="button"
              onClick={handleAction(() => onGenerateScript?.(target, 'ddl'))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
            >
              <span className="font-mono font-medium text-purple-400">CREATE (DDL)</span>
              <span className="text-slate-400 text-[11px] ml-auto">Estructura</span>
            </button>

            <div className="my-1 border-t border-surface-700/60" />

            <button
              type="button"
              onClick={handleAction(() => onOpenScripts?.(target))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span>Ver todos los scripts…</span>
            </button>
          </div>
        )}
      </div>

      {/* 4. Ver relaciones / llaves foráneas (Ctrl+Shift+R) */}
      <button
        type="button"
        disabled={!hasTarget}
        onClick={handleAction(() => onOpenRelations?.(target))}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasTarget
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        <Network className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
        <span className="flex-1 font-medium">Ver relaciones (FK)</span>
        <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
          Ctrl+Shift+R
        </span>
      </button>

      <div className="my-1 border-t border-surface-700/60" />

      {/* 5. Copiar nombre del objeto (Ctrl+Shift+C) */}
      <button
        type="button"
        disabled={!hasTarget}
        onClick={handleCopy}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
          hasTarget
            ? 'text-slate-200 hover:text-white hover:bg-brand-dark/40 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        )}
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="flex-1 font-medium text-emerald-400">¡Copiado!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="flex-1 font-medium">Copiar nombre</span>
            <span className="font-mono text-[10px] text-slate-400 bg-surface-800/80 px-1.5 py-0.5 rounded border border-surface-700/60">
              Ctrl+Shift+C
            </span>
          </>
        )}
      </button>
    </div>,
    document.body
  )
}
