import { useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader2, FolderOpen } from 'lucide-react'
import clsx from 'clsx'

export default function ExportBar({ progress, onCancel, onOpenFolder }) {
  const barRef = useRef(null)

  const { current = 0, total = 0, name = '', percent = 0, done = false, error = null } = progress || {}

  const isActive = !!progress && !done && !error

  return (
    <div className={clsx(
      'glass rounded-xl p-4 transition-all duration-300',
      isActive && 'animate-pulse-glow',
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {error ? (
            <XCircle className="w-4 h-4 text-red-400" />
          ) : done ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : isActive ? (
            <Loader2 className="w-4 h-4 text-brand-light animate-spin" />
          ) : null}
          <span className="text-sm font-medium text-white">
            {error ? 'Export failed' : done ? 'Export complete' : isActive ? `Exporting… ${current}/${total}` : 'Ready to export'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {done && onOpenFolder && (
            <button onClick={onOpenFolder} className="btn-secondary text-xs py-1 px-2">
              <FolderOpen className="w-3 h-3" />
              Open folder
            </button>
          )}
          {isActive && onCancel && (
            <button onClick={onCancel} className="btn-danger text-xs py-1 px-2">Cancel</button>
          )}
          {(done || error) && (
            <span className="text-xs text-slate-500">{total} file{total !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || done) && (
        <div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(36,51,80,0.5)' }}>
            <div
              ref={barRef}
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${percent}%`,
                background: done
                  ? 'linear-gradient(90deg, #059669, #34d399)'
                  : 'linear-gradient(90deg, #004A77, #0096C7)',
                boxShadow: done ? '0 0 8px rgba(52,211,153,0.4)' : '0 0 8px rgba(0,150,199,0.4)',
              }}
            />
          </div>
          {isActive && name && (
            <p className="text-xs text-slate-500 mt-1.5 truncate font-mono">{name}</p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-1 font-mono">{error}</p>
      )}
    </div>
  )
}
