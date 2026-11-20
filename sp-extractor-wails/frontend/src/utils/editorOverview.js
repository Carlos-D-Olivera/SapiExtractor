import { EditorView, ViewPlugin } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { foldedRanges, unfoldEffect } from '@codemirror/language'
import { searchMatchState } from './editorSearch.js'
import { changedLineState } from './editorChanges.js'
const noChanges = []

export function revealEditorRange(view, from, to = from) {
  const effects = []
  foldedRanges(view.state).between(from, to, (start, end) => effects.push(unfoldEffect.of({ from: start, to: end })))
  effects.push(EditorView.scrollIntoView(from, { y: 'center' }))
  view.dispatch({ selection: EditorSelection.single(from, to), effects })
  view.focus()
}

export function createEditorOverview({ trackChanges = false } = {}) {
  return [EditorView.theme({
    '&': { position: 'relative' },
    '.cm-scroller': { marginRight: '26px' },
    // Keep wheel/keyboard scrolling and the horizontal bar; the overview replaces
    // only the native vertical bar in Chromium/WebView2.
    '.cm-scroller::-webkit-scrollbar': { width: '0', height: '12px' },
    '.cm-overview': { position: 'absolute', right: '0', width: '26px', background: '#0b1220', borderLeft: '1px solid #334155', zIndex: '3', overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: 'pointer' },
    '.cm-overview-viewport': { position: 'absolute', left: '2px', right: '2px', border: '1px solid #94a3b899', borderRadius: '3px', background: '#94a3b84d', cursor: 'grab', zIndex: '1', boxSizing: 'border-box' },
    '.cm-overview-viewport:hover': { background: '#94a3b873' },
    '.cm-overview[data-dragging] .cm-overview-viewport': { cursor: 'grabbing', background: '#94a3b899' },
    '.cm-overview-viewport:focus-visible': { outline: '1px solid #7dd3fc' },
    '.cm-overview-viewport[hidden]': { display: 'none' },
    '.cm-overview-mark': { position: 'absolute', height: '3px', minHeight: '3px', padding: '0', border: '0', cursor: 'pointer', width: '8px', zIndex: '2' },
    '.cm-overview-match': { left: '1px', background: '#facc15' },
    '.cm-overview-change': { right: '1px', background: '#4ade80' },
    '.cm-overview-deleted': { background: '#f87171' },
    '.cm-overview-mark:focus-visible': { outline: '1px solid white', zIndex: '1' },
  }), ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.dom = document.createElement('div'); this.dom.className = 'cm-overview'; this.dom.setAttribute('aria-label', 'Navegador de coincidencias y cambios'); this.dom.tabIndex = -1
      view.dom.append(this.dom)
      this.viewport = document.createElement('div'); this.viewport.className = 'cm-overview-viewport'
      this.viewport.tabIndex = 0; this.viewport.title = 'Arrastra para desplazarte'
      this.viewport.setAttribute('role', 'scrollbar')
      this.viewport.setAttribute('aria-label', 'Desplazamiento vertical SQL')
      this.viewport.setAttribute('aria-orientation', 'vertical')
      this.viewport.setAttribute('aria-valuemin', '0'); this.viewport.setAttribute('aria-valuemax', '100')
      this.dom.append(this.viewport)
      this.dom.onpointerdown = event => this.startDrag(event)
      this.dom.onpointermove = event => this.moveDrag(event)
      this.dom.onpointerup = event => this.endDrag(event)
      this.dom.onpointercancel = event => this.endDrag(event, true)
      this.dom.onlostpointercapture = event => { if (this.drag?.id === event.pointerId) this.endDrag(event, true) }
      this.dom.addEventListener('click', event => {
        if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); this.suppressClick = false }
      }, true)
      this.dom.onkeydown = event => {
        // Marker buttons retain their own keyboard activation.
        if (event.target !== this.dom && event.target !== this.viewport) return
        const scroll = view.scrollDOM
        const targets = { ArrowUp: scroll.scrollTop - view.defaultLineHeight, ArrowDown: scroll.scrollTop + view.defaultLineHeight, PageUp: scroll.scrollTop - scroll.clientHeight, PageDown: scroll.scrollTop + scroll.clientHeight, Home: 0, End: scroll.scrollHeight }
        if (!(event.key in targets) || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault(); event.stopPropagation(); scroll.scrollTop = targets[event.key]
      }
      this.dom.addEventListener('wheel', event => {
        if (event.ctrlKey || event.metaKey) return
        event.preventDefault()
        const unit = event.deltaMode === 1 ? view.defaultLineHeight : event.deltaMode === 2 ? view.scrollDOM.clientHeight : 1
        if (event.shiftKey && !event.deltaX) view.scrollDOM.scrollLeft += event.deltaY * unit
        else { view.scrollDOM.scrollTop += event.deltaY * unit; view.scrollDOM.scrollLeft += event.deltaX * unit }
      }, { passive: false })
      this.onScroll = () => this.measure()
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
      this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(view.dom)
      this.measure()
    }
    startDrag(event) {
      if (event.button !== 0 || !event.isPrimary) return
      const track = this.dom.getBoundingClientRect(), thumb = this.viewport.getBoundingClientRect()
      const marker = event.target.closest('.cm-overview-mark')
      const capture = marker || this.dom
      this.suppressClick = false
      this.drag = { id: event.pointerId, capture, previousFocus: this.view.dom.ownerDocument.activeElement, startX: event.clientX, startY: event.clientY, marker, moved: false, top: track.top, height: track.height, thumbHeight: thumb.height, offset: event.target === this.viewport ? event.clientY - thumb.top : thumb.height / 2 }
      event.preventDefault()
      ;(event.target === this.viewport ? this.viewport : this.dom).focus({ preventScroll: true })
      capture.setPointerCapture(event.pointerId)
      this.dom.setAttribute('data-dragging', '')
      if (!marker) this.scrollToPointer(event.clientY)
    }
    scrollToPointer(clientY) {
      const drag = this.drag
      if (!drag) return
      const travel = drag.height - drag.thumbHeight
      const fraction = travel > 0 ? Math.max(0, Math.min(1, (clientY - drag.top - drag.offset) / travel)) : 0
      this.view.scrollDOM.scrollTop = fraction * Math.max(0, this.view.scrollDOM.scrollHeight - this.view.scrollDOM.clientHeight)
    }
    moveDrag(event) {
      if (this.drag?.id !== event.pointerId) return
      if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3) this.drag.moved = true
      if (!this.drag.marker || this.drag.moved) this.scrollToPointer(event.clientY)
    }
    endDrag(event, cancelled = false) {
      const drag = this.drag
      if (!drag || drag.id !== event.pointerId) return
      if (!cancelled && (!drag.marker || drag.moved)) this.scrollToPointer(event.clientY)
      this.drag = null; this.dom.removeAttribute('data-dragging')
      if (drag.capture.hasPointerCapture(event.pointerId)) drag.capture.releasePointerCapture(event.pointerId)
      this.suppressClick = !cancelled && drag.moved
      clearTimeout(this.clickTimer)
      this.clickTimer = setTimeout(() => { this.suppressClick = false }, 0)
      if (!cancelled && (!drag.marker || drag.moved) && !this.view.isDestroyed) {
        // Preserve the search field when it was active; otherwise return focus to
        // the SQL so shortcuts keep working without moving its selection.
        if (drag.previousFocus?.matches('input, textarea') && this.view.dom.contains(drag.previousFocus)) drag.previousFocus.focus({ preventScroll: true })
        else this.view.focus()
      }
    }
    update(update) {
      const before = update.startState, after = update.state
      if (update.docChanged || update.viewportChanged || update.geometryChanged || before.field(searchMatchState) !== after.field(searchMatchState) || before.field(changedLineState, false) !== after.field(changedLineState, false)) this.measure()
    }
    measure() {
      this.view.requestMeasure({ key: this, read: view => {
        const editor = view.dom.getBoundingClientRect(), scroll = view.scrollDOM.getBoundingClientRect()
        // Leave the resize handle and horizontal scrollbar usable at the bottom.
        return { top: scroll.top - editor.top, height: Math.max(1, view.scrollDOM.clientHeight - 16), scrollTop: view.scrollDOM.scrollTop, clientHeight: view.scrollDOM.clientHeight, scrollHeight: view.scrollDOM.scrollHeight }
      }, write: size => this.draw(size) })
    }
    draw({ top, height, scrollTop, clientHeight, scrollHeight }) {
      this.dom.style.top = `${top}px`; this.dom.style.height = `${height}px`
      const state = this.view.state, count = state.doc.lines
      const maxScroll = Math.max(0, scrollHeight - clientHeight)
      const thumbHeight = Math.min(height, Math.max(24, height * clientHeight / Math.max(1, scrollHeight)))
      const fraction = maxScroll ? Math.max(0, Math.min(1, scrollTop / maxScroll)) : 0
      this.viewport.hidden = maxScroll <= 0
      this.viewport.style.top = `${fraction * (height - thumbHeight)}px`; this.viewport.style.height = `${thumbHeight}px`
      this.viewport.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
      const matches = state.field(searchMatchState).matches
      const changes = trackChanges ? state.field(changedLineState, false) || noChanges : noChanges
      // Only rebuild marks when their source or geometry changes, never on scrolling alone.
      if (matches === this.matches && changes === this.changes && height === this.height && count === this.lineCount) return
      this.matches = matches; this.changes = changes; this.height = height; this.lineCount = count
      this.dom.querySelectorAll('button').forEach(node => node.remove())
      const buckets = new Map()
      const add = (line, kind, range) => {
        const y = Math.max(0, Math.min(height - 3, Math.floor((line - 1) / Math.max(1, count - 1) * (height - 3))))
        const key = `${kind === 'match' ? 'match' : kind === 'deleted' ? 'deleted' : 'change'}:${y}`
        if (!buckets.has(key)) buckets.set(key, { y, kind, ranges: [] })
        buckets.get(key).ranges.push(range)
      }
      for (const match of matches) add(state.doc.lineAt(match.from).number, 'match', match)
      for (const change of changes) {
        // A changed block spans the overview; cap drawing work to its pixel height.
        const step = Math.max(1, Math.floor((change.toLine - change.fromLine) / Math.max(1, height)))
        for (let line = change.fromLine; line <= change.toLine; line += step) add(line, change.kind, { from: state.doc.line(line).from, to: state.doc.line(line).from })
      }
      const fragment = document.createDocumentFragment()
      for (const { y, kind, ranges } of buckets.values()) {
        const node = document.createElement('button')
        node.type = 'button'; node.className = `cm-overview-mark ${kind === 'match' ? 'cm-overview-match' : 'cm-overview-change'}${kind === 'deleted' ? ' cm-overview-deleted' : ''}`
        node.style.top = `${y}px`
        const line = state.doc.lineAt(ranges[0].from).number
        node.title = `${kind === 'match' ? 'Coincidencia' : kind === 'deleted' ? 'Eliminación' : 'Cambio'} · línea ${line}${ranges.length > 1 ? ` (${ranges.length} marcas; pulsa para recorrer)` : ''}`
        node.setAttribute('aria-label', node.title)
        let next = 0
        node.onclick = event => { event.stopPropagation(); const range = ranges[next++ % ranges.length]; revealEditorRange(this.view, range.from, range.to) }
        fragment.append(node)
      }
      this.dom.append(fragment)
    }
    destroy() { clearTimeout(this.clickTimer); this.drag = null; this.resize.disconnect(); this.view.scrollDOM.removeEventListener('scroll', this.onScroll); this.dom.remove() }
  })]
}
