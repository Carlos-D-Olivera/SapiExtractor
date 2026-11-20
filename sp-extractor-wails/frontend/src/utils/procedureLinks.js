import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

function readIdentifier(state, from, dbType) {
  // The SQL parser recovers malformed multipart names and does not recognize all
  // escaped brackets. Validate the complete raw name rather than linking a prefix.
  const text = state.sliceDoc(from, Math.min(state.doc.length, from + 2048)), parts = []
  let pos = 0, end = 0
  for (;;) {
    let value = '', quoted = false
    const opener = text[pos]
    if (opener === '[' || opener === '"' || opener === '`') {
      if ((opener === '[' && dbType !== 'SQL_SERVER') || (opener === '`' && dbType !== 'MYSQL')) return null
      quoted = true
      const close = opener === '[' ? ']' : opener
      pos++
      let closed = false
      while (pos < text.length) {
        if (text[pos] === close) {
          if (text[pos + 1] === close) { value += close; pos += 2; continue }
          pos++; closed = true; break
        }
        value += text[pos++]
      }
      if (!closed || !value) return null
    } else {
      const match = /^[\p{L}_#$][\p{L}\p{N}_#$]*/u.exec(text.slice(pos))
      if (!match) return null
      value = match[0]; pos += value.length
    }
    parts.push({ value, quoted }); end = pos
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++
    if (text[pos] !== '.') break
    pos++
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++
  }
  if (parts.length > 2 || /[\p{L}\p{N}_#$\[\]"`]/u.test(text[end] || '')) return null
  return { parts, to: from + end }
}

export function findProcedureReferences(state, procedures, ranges = [{ from: 0, to: state.doc.length }], dbType = 'SQL_SERVER') {
  const catalog = new Map()
  for (const object of procedures || []) {
    if (object.type !== 'STORED_PROCEDURE') continue
    if (dbType === 'POSTGRESQL' && (object.routineKind !== 'p' || !object.routineId)) continue
    const key = dbType === 'POSTGRESQL' ? object.name : object.name.toLowerCase()
    if (!catalog.has(key)) catalog.set(key, [])
    catalog.get(key).push(object)
  }
  const references = [], seen = new Set()
  const nextToken = node => { do { node = node?.nextSibling } while (node && /Comment/.test(node.name)); return node }
  for (const range of ranges) syntaxTree(state).iterate({
    from: range.from, to: range.to,
    enter(node) {
      if (node.name !== 'Keyword' || !(dbType === 'SQL_SERVER' ? /^(EXEC|EXECUTE)$/i : /^CALL$/i).test(state.sliceDoc(node.from, node.to))) return
      let target = nextToken(node.node)
      if (target?.name === 'SpecialVar') {
        const equals = nextToken(target)
        if (!equals || state.sliceDoc(equals.from, equals.to) !== '=') return
        target = nextToken(equals)
      }
      if (!target || !['Identifier', 'QuotedIdentifier', 'CompositeIdentifier'].includes(target.name) || seen.has(target.from)) return
      const identifier = readIdentifier(state, target.from, dbType)
      if (!identifier) return
      const normalize = part => dbType === 'POSTGRESQL' && part.quoted ? part.value : part.value.toLowerCase()
      const { parts } = identifier
      const candidates = (catalog.get(normalize(parts.at(-1))) || []).filter(o => parts.length === 1 || (dbType === 'POSTGRESQL' ? o.schema : o.schema?.toLowerCase()) === normalize(parts[0]))
      if (candidates.length) { seen.add(target.from); references.push({ from: target.from, to: identifier.to, candidates }) }
    },
  })
  return references.sort((a, b) => a.from - b.from)
}

export function createProcedureLinks({ procedures = [], onOpenProcedure, dbType = 'SQL_SERVER' } = {}) {
  if (!onOpenProcedure || !procedures.length) return []
  return [EditorView.theme({
    '.cm-procedure-link': { textDecoration: 'none', textDecorationColor: '#7dd3fc', textUnderlineOffset: '3px', cursor: 'pointer' },
    '.cm-procedure-link:hover': { color: '#7dd3fc', textDecoration: 'underline' },
    '.cm-procedure-link:focus-visible': { outline: '1px solid #7dd3fc' },
  }), ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view; this.rebuild()
      // Handle focused links before the editor's Enter binding inserts a newline.
      this.onLinkKey = event => {
        const link = event.target.closest?.('.cm-procedure-link')
        if (event.key !== 'Enter' || (!event.altKey && !link)) return
        const head = link ? view.posAtDOM(link) : view.state.selection.main.head
        const reference = this.references.find(r => head >= r.from && head <= r.to)
        if (!reference) return
        event.preventDefault(); event.stopPropagation(); this.open(reference)
      }
      view.dom.addEventListener('keydown', this.onLinkKey, true)
    }
    rebuild() {
      this.references = findProcedureReferences(this.view.state, procedures, this.view.visibleRanges, dbType)
      this.decorations = Decoration.set(this.references.map(r => Decoration.mark({ class: 'cm-procedure-link', attributes: { role: 'link', tabindex: '0', title: 'Abrir procedimiento (clic o Alt+Enter)', 'aria-label': `Abrir procedimiento ${this.view.state.sliceDoc(r.from, r.to)}` } }).range(r.from, r.to)), true)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) { this.closeChooser(); this.rebuild() }
    }
    reference(event) {
      const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
      return pos == null ? null : this.references.find(r => pos >= r.from && pos <= r.to)
    }
    open(reference) {
      this.closeChooser()
      if (reference.candidates.length === 1) { onOpenProcedure(reference.candidates[0]); return }
      const dialog = this.chooser = document.createElement('div')
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Elegir esquema del procedimiento')
      Object.assign(dialog.style, { position: 'fixed', zIndex: '100', background: '#111b2c', color: '#f8fafc', border: '1px solid #475569', borderRadius: '6px', padding: '8px', boxShadow: '0 8px 24px #0008', font: '12px system-ui', maxHeight: '50vh', overflow: 'auto' })
      const rect = this.view.coordsAtPos(reference.from) || this.view.dom.getBoundingClientRect()
      dialog.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`
      dialog.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 160))}px`
      const title = document.createElement('div'); title.textContent = 'Elegir esquema del procedimiento'; title.style.padding = '4px'; dialog.append(title)
      for (const candidate of reference.candidates) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `${candidate.schema}.${candidate.name}${candidate.routineKind ? `(${candidate.routineSignature || ''})` : ''}`
        Object.assign(button.style, { display: 'block', width: '100%', textAlign: 'left', padding: '6px', cursor: 'pointer' })
        button.onclick = () => { this.closeChooser(); onOpenProcedure(candidate) }
        dialog.append(button)
      }
      const cancel = document.createElement('button'); cancel.textContent = 'Cancelar'; cancel.onclick = () => { this.closeChooser(); this.view.focus() }; dialog.append(cancel)
      this.dismiss = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !dialog.contains(event.target)) { this.closeChooser(); if (event.type === 'keydown') { event.preventDefault(); this.view.focus() } } }
      document.addEventListener('pointerdown', this.dismiss); document.addEventListener('keydown', this.dismiss, true)
      document.body.append(dialog); dialog.querySelector('button')?.focus()
    }
    closeChooser() { this.chooser?.remove(); this.chooser = null; if (this.dismiss) { document.removeEventListener('pointerdown', this.dismiss); document.removeEventListener('keydown', this.dismiss, true); this.dismiss = null } }
    destroy() { this.closeChooser(); this.view.dom.removeEventListener('keydown', this.onLinkKey, true) }
  }, {
    decorations: plugin => plugin.decorations,
    eventHandlers: {
      mousedown(event) { if (event.button === 0) this.down = { x: event.clientX, y: event.clientY, reference: this.reference(event) }; return false },
      mouseup(event) {
        const down = this.down; this.down = null
        if (event.button !== 0 || !down?.reference || event.detail > 1 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || !this.view.state.selection.main.empty) return false
        if (this.reference(event)?.from !== down.reference.from) return false
        this.open(down.reference); return true
      },
    },
  })]
}
