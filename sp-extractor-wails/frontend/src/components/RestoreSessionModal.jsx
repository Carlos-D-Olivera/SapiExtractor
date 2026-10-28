import { useState } from 'react'
import { History, Loader2, Database, KeyRound } from 'lucide-react'
import { DB_LABELS } from './WorkspaceView'

/**
 * Offered at start-up when the previous session had connections.
 * `workspaces` are the saved entries that had a database; `hasPassword(ws)` tells
 * whether the connection can be reopened without asking for the password.
 */
export default function RestoreSessionModal({ workspaces, hasPassword, restoring, onRestore, onSkip }) {
  const [selected, setSelected] = useState(() => new Set(workspaces.map(w => w.id)))
  const [always, setAlways] = useState(false)

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass rounded-2xl w-[520px] max-w-[95vw] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-600">
          <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50"><History className="w-4 h-4 text-brand-light" /></div>
          <div>
            <h2 className="text-sm font-semibold text-white">Restaurar la sesión anterior</h2>
            <p className="text-xs text-slate-500">Se reconectarán estos espacios y volverán tus pestañas de consultas.</p>
          </div>
        </div>

        <div className="px-6 py-4 flex flex-col gap-2">
          {workspaces.map(w => (
            <label key={w.id} className="flex items-center gap-3 rounded-lg border border-surface-600 bg-surface-800/40 px-3 py-2 cursor-pointer select-none">
              <input type="checkbox" checked={selected.has(w.id)} disabled={restoring} onChange={() => toggle(w.id)} />
              <span className="w-6 h-6 rounded-md bg-emerald-950/70 border border-emerald-500/60 text-emerald-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">{w.id}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate flex items-center gap-1.5"><Database className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />{w.dbName}</p>
                <p className="text-[11px] text-slate-500 truncate">{DB_LABELS[w.dbType] || w.dbType} · {w.host} · {w.user}</p>
              </div>
              {!hasPassword(w) && (
                <span className="flex items-center gap-1 text-[10px] text-amber-300 whitespace-nowrap" title="No hay contraseña guardada: se te pedirá al reconectar">
                  <KeyRound className="w-3 h-3" /> pedirá contraseña
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3 px-6 py-3 border-t border-surface-600">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={always} disabled={restoring} onChange={e => setAlways(e.target.checked)} />
            Restaurar siempre sin preguntar
          </label>
          <div className="flex-1" />
          <button onClick={onSkip} disabled={restoring} className="btn-secondary text-xs py-1.5 px-3">Empezar de cero</button>
          <button onClick={() => onRestore(selected, always)} disabled={restoring || selected.size === 0} className="btn-primary text-xs py-1.5 px-3">
            {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {restoring ? 'Restaurando…' : 'Restaurar'}
          </button>
        </div>
      </div>
    </div>
  )
}
