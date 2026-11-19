import { useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  Layers,
  Play,
  Copy,
  Check,
  FileCode2,
} from 'lucide-react'
import clsx from 'clsx'

const cellText = (v) => (v === null || v === undefined ? '' : String(v))

export default function ScriptResultPanel({
  script,
  result,
  isRunning,
  onRetrySingle,
}) {
  const [copied, setCopied] = useState(false)
  const [selectedCell, setSelectedCell] = useState(null)

  const copy = (text) => {
    try {
      navigator.clipboard?.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* ignore */ }
  }

  if (!script) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 bg-surface-900/40 rounded-xl border border-surface-600/50">
        <Database className="w-8 h-8 opacity-40 mb-2" />
        <p className="text-xs">Selecciona un script para ver el resultado de su ejecución</p>
      </div>
    )
  }

  const hasResult = !!result
  const isSuccess = hasResult && result.success
  const isError = hasResult && !result.success
  const response = result?.response
  const sets = response?.sets || []
  const durationMs = result?.durationMs || response?.durationMs || 0

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-900/60 rounded-xl border border-surface-600/70 overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-surface-600/60 bg-surface-800/50 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-300">Resultado:</span>
          <span className="text-xs font-mono text-white truncate max-w-[200px]" title={script.fileName}>
            {script.fileName}
          </span>
        </div>

        <div className="flex-1" />

        {/* Status badges */}
        {isRunning && (
          <span className="badge-blue flex items-center gap-1.5 py-1">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            <span>Ejecutando...</span>
          </span>
        )}

        {isSuccess && (
          <div className="flex items-center gap-2">
            <span className="badge-green flex items-center gap-1 py-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Correcto</span>
            </span>
            <span className="badge flex items-center gap-1 text-slate-400 bg-surface-700/50 border border-surface-600/50 text-[11px]">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>{durationMs} ms</span>
            </span>
            {response?.rowCount !== undefined && (
              <span className="badge flex items-center gap-1 text-slate-400 bg-surface-700/50 border border-surface-600/50 text-[11px]">
                <Layers className="w-3 h-3 text-slate-400" />
                <span>{response.rowCount} fila(s)</span>
              </span>
            )}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2">
            <span className="badge-red flex items-center gap-1 py-0.5">
              <XCircle className="w-3.5 h-3.5" />
              <span>Error</span>
            </span>
            {durationMs > 0 && (
              <span className="badge flex items-center gap-1 text-slate-400 bg-surface-700/50 border border-surface-600/50 text-[11px]">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{durationMs} ms</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => onRetrySingle?.(script)}
              className="btn-secondary text-[11px] py-1 px-2 text-sky-400 hover:text-white"
              title="Reintentar ejecutar solo este script"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Reintentar</span>
            </button>
          </div>
        )}
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-auto p-3 text-xs select-text">
        {isRunning ? (
          <div className="flex items-center justify-center h-full gap-3 text-sky-400">
            <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Ejecutando script en la base de datos...</span>
          </div>
        ) : isError ? (
          <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/30 text-red-300 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
              <XCircle className="w-5 h-5 flex-shrink-0" />
              <span>Error al ejecutar el script</span>
            </div>
            <pre className="p-3 rounded-lg bg-surface-950/70 border border-red-500/20 text-xs font-mono whitespace-pre-wrap text-red-200 overflow-x-auto">
              {result.error}
            </pre>
            <p className="text-[11px] text-slate-400">
              La ejecución en cola se ha pausado. Puedes corregir el script, editarlo en Consultas o hacer clic en "Reanudar" para continuar con el siguiente.
            </p>
          </div>
        ) : isSuccess ? (
          <div className="space-y-3">
            {/* Success summary banner */}
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              <span className="font-medium text-xs">
                {response?.message || 'Script ejecutado correctamente.'}
              </span>
            </div>

            {/* PRINT / RAISERROR messages */}
            {(response?.messages || []).length > 0 && (
              <div className="rounded-lg border border-surface-600/70 overflow-auto bg-surface-900/40" style={{ maxHeight: '25vh' }}>
                <div className="px-3 py-1 border-b border-surface-700/60 text-[10px] text-slate-500 font-medium uppercase tracking-wide select-none">
                  Mensajes
                </div>
                <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap leading-relaxed m-0">
                  {(response.messages).map((msg, i) => (
                    <span key={i} className={msg.kind === 'error' ? 'text-red-400' : 'text-slate-300'}>
                      {msg.text}{'\n'}
                    </span>
                  ))}
                </pre>
              </div>
            )}

            {/* If there are tabular result sets */}
            {sets.length > 0 ? (
              <div className="space-y-4">
                {sets.map((set, sIdx) => {
                  const columns = set.columns || []
                  const rows = set.rows || []
                  return (
                    <div key={sIdx} className="rounded-xl border border-surface-600/70 overflow-hidden bg-surface-900/40">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-800/80 border-b border-surface-600/70 text-[11px] text-slate-400">
                        <span>Conjunto {sIdx + 1} de {sets.length}</span>
                        <span>·</span>
                        <span>{rows.length} fila(s)</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => {
                            const header = columns.join('\t')
                            const body = rows.map((r) => r.map(cellText).join('\t')).join('\n')
                            copy(`${header}\n${body}`)
                          }}
                          className="text-[11px] hover:text-white flex items-center gap-1 text-slate-400"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copied ? 'Copiado' : 'Copiar tabla'}</span>
                        </button>
                      </div>

                      <div className="overflow-auto max-h-[260px]">
                        <table className="border-collapse text-[11px] min-w-full font-mono">
                          <thead className="sticky top-0 z-10 bg-surface-800 border-b border-surface-600">
                            <tr>
                              <th className="px-2 py-1 text-right text-slate-500 font-normal border-r border-surface-700/60 w-8">#</th>
                              {columns.map((c, cIdx) => {
                                const isLast = cIdx === columns.length - 1
                                return (
                                  <th
                                    key={cIdx}
                                    className={clsx(
                                      "px-3 py-1 text-left font-medium text-slate-300 whitespace-nowrap",
                                      isLast ? "w-full border-r-0" : "border-r border-surface-700/60"
                                    )}
                                  >
                                    {c}
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length === 0 ? (
                              <tr>
                                <td colSpan={columns.length + 1} className="text-center py-4 text-slate-500 italic">
                                  Sin filas devueltas
                                </td>
                              </tr>
                            ) : (
                              rows.map((row, rIdx) => (
                                <tr
                                  key={rIdx}
                                  className={rIdx % 2 === 0 ? 'bg-surface-900/20 hover:bg-surface-700/30' : 'bg-surface-800/20 hover:bg-surface-700/30'}
                                >
                                  <td className="px-2 py-1 text-right text-slate-500 font-mono border-r border-surface-700/60">
                                    {rIdx + 1}
                                  </td>
                                  {row.map((cell, cIdx) => {
                                    const isLast = cIdx === columns.length - 1
                                    const isSel = selectedCell?.s === sIdx && selectedCell?.r === rIdx && selectedCell?.c === cIdx
                                    return (
                                      <td
                                        key={cIdx}
                                        onClick={() => {
                                          setSelectedCell({ s: sIdx, r: rIdx, c: cIdx })
                                          copy(cellText(cell))
                                        }}
                                        className={clsx(
                                          'px-3 py-1 font-mono whitespace-nowrap align-top cursor-pointer text-slate-200',
                                          isLast ? 'border-r-0' : 'border-r border-surface-700/60',
                                          isSel && 'bg-brand-dark/40 outline outline-1 -outline-offset-1 outline-sky-400'
                                        )}
                                        title="Clic para copiar valor"
                                      >
                                        {cell === null ? (
                                          <span className="text-slate-500 italic">NULL</span>
                                        ) : cell === '' ? (
                                          <span className="text-slate-500 italic">(vacío)</span>
                                        ) : (
                                          cell
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-1.5 p-4 text-center">
            <FileCode2 className="w-7 h-7 opacity-30" />
            <p className="text-xs">El script no se ha ejecutado todavía.</p>
            <p className="text-[11px] text-slate-500 max-w-sm">
              Haz clic en el botón <Play className="w-3 h-3 inline text-sky-400 fill-current" /> al lado del script para ejecutarlo individualmente o presiona "Ejecutar Todo".
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
