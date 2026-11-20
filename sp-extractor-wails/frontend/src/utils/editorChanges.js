import { diffArrays } from 'diff'
import { StateEffect, StateField } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

const lines = text => text ? text.replace(/\r\n?/g, '\n').split('\n') : []
export function computeChangedLineMarks(openedSql, currentSql) {
  const current = lines(currentSql), parts = diffArrays(lines(openedSql), current)
  const marks = []
  let line = 1
  for (let i = 0; i < parts.length;) {
    const part = parts[i]
    if (!part.added && !part.removed) { line += part.count; i++; continue }
    let added = 0, removed = 0
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].added) added += parts[i].count
      else removed += parts[i].count
      i++
    }
    const fromLine = Math.min(line, Math.max(1, current.length))
    marks.push({ fromLine, toLine: added ? line + added - 1 : fromLine, kind: added ? removed ? 'modified' : 'added' : 'deleted' })
    line += added
  }
  return marks
}

const publishChanges = StateEffect.define()
export const changedLineState = StateField.define({
  create: () => [],
  update(value, tr) {
    if (tr.docChanged) value = []
    for (const effect of tr.effects) if (effect.is(publishChanges) && effect.value.doc === tr.state.doc) value = effect.value.marks
    return value
  },
})

export function createChangeTracking(openedSql) {
  return [changedLineState, ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.requestId = 0; this.schedule() }
    update(update) { if (update.docChanged) this.schedule() }
    schedule() {
      clearTimeout(this.timer); this.worker?.terminate(); this.worker = null
      const requestId = ++this.requestId, doc = this.view.state.doc
      this.timer = setTimeout(() => {
        const currentSql = doc.toString()
        if (currentSql === openedSql) { this.publish(doc, []); return }
        this.worker = new Worker(new URL('./editorChanges.worker.js', import.meta.url), { type: 'module' })
        this.worker.onmessage = ({ data }) => {
          if (data.requestId !== this.requestId || this.view.isDestroyed) return
          this.publish(doc, data.marks)
          this.worker?.terminate(); this.worker = null
        }
        this.worker.onerror = event => { console.error('No se pudieron calcular las marcas de cambios', event.message); this.worker?.terminate(); this.worker = null }
        this.worker.postMessage({ requestId, openedSql, currentSql })
      }, 150)
    }
    publish(doc, marks) { if (!this.view.isDestroyed && this.view.state.doc === doc) this.view.dispatch({ effects: publishChanges.of({ doc, marks }) }) }
    destroy() { this.requestId++; clearTimeout(this.timer); this.worker?.terminate() }
  })]
}
