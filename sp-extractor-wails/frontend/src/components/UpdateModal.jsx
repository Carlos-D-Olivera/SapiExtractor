import { useState, useEffect, useRef } from 'react'
import { X, Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, ExternalLink, ArrowUpCircle } from 'lucide-react'

const go = () => import('../../wailsjs/go/main/App')

const PHASE_LABEL = { verify: 'Verificando…', download: 'Descargando…', install: 'Instalando…' }

function fmtMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Checks for, shows and installs a new version.
 * `info` is a release already found at start-up (skips the first check).
 */
export default function UpdateModal({ version, info: initialInfo, onClose, onSkipped, onUpdateInfoChange }) {
  const [phase, setPhase] = useState(initialInfo ? 'available' : 'checking') // checking | uptodate | available | installing | restarting | error
  const [info, setInfo] = useState(initialInfo || null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null) // { phase, done, total }
  const [settings, setSettings] = useState(null)
  const busy = useRef(false)

  const check = async () => {
    setPhase('checking')
    setError('')
    try {
      const res = await (await go()).CheckForUpdate()
      setInfo(res)
      setPhase(res.available ? 'available' : 'uptodate')
      onUpdateInfoChange?.(res.available ? res : null)
    } catch (e) {
      setError(e.toString())
      setPhase('error')
    }
  }

  useEffect(() => {
    if (!initialInfo) check()
    ;(async () => {
      try { setSettings(await (await go()).GetPersistenceSettings()) } catch { /* ignore */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy.current) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let off
    let cancelled = false
    ;(async () => {
      const { EventsOn } = await import('../../wailsjs/runtime/runtime')
      if (!cancelled) off = EventsOn('update:progress', setProgress)
    })()
    return () => { cancelled = true; off?.() }
  }, [])

  const install = async () => {
    busy.current = true
    setPhase('installing')
    setError('')
    setProgress({ phase: 'verify', done: 0, total: 0 })
    try {
      await (await go()).InstallUpdate()
      setPhase('restarting') // the app quits and the new version opens by itself
    } catch (e) {
      busy.current = false
      setError(e.toString())
      setPhase('error')
    }
  }

  const skip = async () => {
    try {
      const s = settings || (await (await go()).GetPersistenceSettings())
      await (await go()).SetPersistenceSettings({ ...s, skippedVersion: info.latest })
    } catch { /* ignore */ }
    onSkipped?.()
    onClose()
  }

  const toggleAuto = async (checked) => {
    const next = { ...settings, checkUpdates: checked }
    setSettings(next)
    try { await (await go()).SetPersistenceSettings(next) } catch { /* ignore */ }
  }

  const openPage = async () => {
    const { BrowserOpenURL } = await import('../../wailsjs/runtime/runtime')
    BrowserOpenURL(info?.pageUrl || 'https://github.com/Carlos-D-Olivera/SapiExtractor/releases/latest')
  }

  const pct = progress?.phase === 'download' && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null
  const isDev = version === 'dev'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy.current) onClose() }}>
      <div className="glass rounded-2xl w-[560px] max-w-[95vw] max-h-[88vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50"><ArrowUpCircle className="w-4 h-4 text-brand-light" /></div>
            <div>
              <h2 className="text-sm font-semibold text-white">Actualizaciones</h2>
              <p className="text-xs text-slate-500">Versión instalada: {isDev ? 'desarrollo' : `v${version}`}</p>
            </div>
          </div>
          {phase !== 'installing' && phase !== 'restarting' && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all"><X className="w-4 h-4" /></button>
          )}
        </div>

        <div className="px-6 py-5 overflow-auto flex-1 min-h-0">
          {phase === 'checking' && (
            <div className="flex items-center gap-3 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin text-brand-light" /> Buscando actualizaciones…</div>
          )}

          {phase === 'uptodate' && (
            <div className="flex items-center gap-3 text-emerald-400 text-sm">
              <CheckCircle2 className="w-5 h-5" />
              {isDev ? 'Es una versión de desarrollo: no se compara con las publicadas.' : `Ya tienes la última versión (v${info?.latest || version}).`}
            </div>
          )}

          {phase === 'available' && info && (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm text-white font-semibold">Hay una versión nueva: v{info.latest}</p>
                <p className="text-xs text-slate-500">
                  Instalada: v{version}{info.assetSize ? ` · descarga de ${fmtMB(info.assetSize)}` : ''}
                  {info.publishedAt ? ` · publicada el ${new Date(info.publishedAt).toLocaleDateString('es')}` : ''}
                </p>
              </div>
              {info.notes && (
                <div className="rounded-lg border border-surface-600 bg-surface-800/40 p-3 max-h-56 overflow-auto">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Novedades</p>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-sans" style={{ margin: 0 }}>{info.notes}</pre>
                </div>
              )}
              {!info.canAutoInstall && (
                <div className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
                    <span>Esta versión no se puede instalar automáticamente: {info.reason}. Puedes descargarla desde la página de la versión.</span>
                  </div>
                  <button
                    onClick={check}
                    className="btn-secondary text-xs py-1 px-2.5 whitespace-nowrap flex-shrink-0 text-amber-200 border-amber-500/40 hover:bg-amber-500/20"
                    title="Volver a buscar la actualización"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                  </button>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Tus pestañas de consultas se guardan solas y se recuperan al reiniciar. Las trazas y ejecuciones en curso se detendrán.
              </p>
            </div>
          )}

          {phase === 'installing' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-slate-300 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-brand-light" />
                {PHASE_LABEL[progress?.phase] || 'Preparando…'}
                {pct !== null && <span className="text-slate-500">{pct}% · {fmtMB(progress.done)} de {fmtMB(progress.total)}</span>}
              </div>
              <div className="h-2 rounded-full bg-surface-700 overflow-hidden">
                <div className="h-full bg-brand-light transition-all" style={{ width: `${pct ?? (progress?.phase === 'install' ? 100 : 6)}%` }} />
              </div>
              <p className="text-[11px] text-slate-500">No cierres la aplicación: se reiniciará sola al terminar.</p>
            </div>
          )}

          {phase === 'restarting' && (
            <div className="flex items-center gap-3 text-emerald-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Instalada. Reiniciando la aplicación…</div>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-6 py-3 border-t border-surface-600 flex-shrink-0 flex-wrap">
          {settings && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={settings.checkUpdates} onChange={e => toggleAuto(e.target.checked)} />
              Buscar al iniciar
            </label>
          )}
          <div className="flex-1" />
          {(phase === 'uptodate' || phase === 'error' || phase === 'available') && (
            <button onClick={check} className="btn-secondary text-xs py-1.5 px-3" title="Buscar actualizaciones"><RefreshCw className="w-3.5 h-3.5" /> Buscar de nuevo</button>
          )}
          {(phase === 'available' || phase === 'error') && info?.latest && (
            <button onClick={openPage} className="btn-secondary text-xs py-1.5 px-3"><ExternalLink className="w-3.5 h-3.5" /> Ver en GitHub</button>
          )}
          {phase === 'available' && info && (
            <>
              <button onClick={skip} className="btn-secondary text-xs py-1.5 px-3">Omitir esta versión</button>
              <button onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">Más tarde</button>
              <button onClick={install} disabled={!info.canAutoInstall || isDev} className="btn-primary text-xs py-1.5 px-3"
                      title={isDev ? 'Desactivado en versiones de desarrollo' : undefined}>
                <Download className="w-3.5 h-3.5" /> Actualizar ahora
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
