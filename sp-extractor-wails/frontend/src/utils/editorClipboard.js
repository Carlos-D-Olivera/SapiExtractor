import { isolateHistory } from '@codemirror/commands'

export async function readClipboardText() {
  try {
    const runtime = globalThis.window?.runtime
    if (runtime?.ClipboardGetText) return await runtime.ClipboardGetText()
  } catch { /* Try the browser when the native clipboard is temporarily unavailable. */ }
  try {
    if (globalThis.navigator?.clipboard?.readText) return await navigator.clipboard.readText()
  } catch { /* Report the failure to the editor below. */ }
  throw new Error('No se pudo leer el portapapeles. Intenta pegar con Ctrl+V.')
}

export async function writeClipboardText(text) {
  try {
    const runtime = globalThis.window?.runtime
    if (runtime?.ClipboardSetText && await runtime.ClipboardSetText(text) !== false) return
  } catch { /* Fall back to the browser. */ }
  try {
    if (globalThis.navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch { /* Report below. */ }
  throw new Error('No se pudo escribir en el portapapeles. Intenta copiar con Ctrl+C.')
}

function unchanged(view, snapshot) {
  return !view.isDestroyed && view.state.doc === snapshot.doc && view.state.selection.eq(snapshot.selection)
}

export async function pasteIntoEditor(view) {
  if (!view || view.isDestroyed || view.state.readOnly) return { status: 'cancelled' }
  const snapshot = view.state
  const text = await readClipboardText()
  if (!unchanged(view, snapshot)) return { status: 'cancelled' }
  if (!text) { view.focus(); return { status: 'empty' } }
  const insert = view.state.toText(text)
  view.dispatch({
    ...view.state.replaceSelection(insert),
    scrollIntoView: true,
    userEvent: 'input.paste',
    annotations: isolateHistory.of('full'),
  })
  view.focus()
  return { status: 'pasted' }
}

export async function clipboardAction(view, action) {
  if (!view || view.isDestroyed) return
  if (action === 'paste') return pasteIntoEditor(view)
  const snapshot = view.state
  const text = snapshot.selection.ranges.map(r => snapshot.sliceDoc(r.from, r.to)).join('\n')
  if (!text) return
  await writeClipboardText(text)
  if (!unchanged(view, snapshot)) return
  if (action === 'cut' && !snapshot.readOnly) {
    view.dispatch({ ...snapshot.replaceSelection(''), userEvent: 'delete.cut', annotations: isolateHistory.of('full') })
  }
  view.focus()
}
