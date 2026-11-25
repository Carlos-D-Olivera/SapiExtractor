import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import { foldedRanges, unfoldEffect } from '@codemirror/language'

export function isProcedureScript(sql = '') {
  // Ignore comments, strings and quoted identifiers, not just their keywords.
  let code = ''
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i++
      code += ' '
    } else if (sql.startsWith('/*', i)) {
      i += 2
      for (let depth = 1; i < sql.length && depth;) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      code += ' '
    } else if ("'\"[".includes(sql[i])) {
      const end = sql[i] === '[' ? ']' : sql[i]
      i++
      while (i < sql.length) {
        if (sql[i] !== end) i++
        else if (sql[i + 1] === end) i += 2
        else { i++; break }
      }
      code += ' '
    } else code += sql[i++]
  }
  return /\b(?:alter|create(?:\s+or\s+(?:alter|replace))?)\s+proc(?:edure)?\b/i.test(code)
}

export const procedureScriptState = StateField.define({
  create: state => isProcedureScript(state.doc.toString()),
  update: (value, tr) => tr.docChanged ? isProcedureScript(tr.newDoc.toString()) : value,
})

export const setBookmarks = StateEffect.define()
export const bookmarkState = StateField.define({
  create: () => [],
  update(positions, tr) {
    let next = positions
    if (tr.docChanged) {
      next = positions.filter(pos => {
        const line = tr.startState.doc.lineAt(pos)
        const end = Math.min(tr.startState.doc.length, line.to + 1)
        let deleted = false
        tr.changes.iterChangedRanges((from, to) => {
          if (from <= line.from && to >= end && to > from) deleted = true
        })
        return !deleted
      }).map(pos => tr.newDoc.lineAt(tr.changes.mapPos(pos, 1)).from)
    }
    for (const effect of tr.effects) if (effect.is(setBookmarks)) next = effect.value
    next = [...new Set(next.filter(pos => Number.isInteger(pos) && pos >= 0 && pos <= tr.newDoc.length)
      .map(pos => tr.newDoc.lineAt(pos).from))].sort((a, b) => a - b)
    return next.length === positions.length && next.every((pos, i) => pos === positions[i]) ? positions : next
  },
})

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const node = document.createElement('span')
    node.textContent = '⚑'
    node.title = 'Marcador'
    node.setAttribute('aria-label', 'Marcador')
    return node
  }
}
const marker = new BookmarkMarker()

export function createEditorBookmarks(initial = []) {
  return [
    procedureScriptState,
    bookmarkState.init(state => [...new Set(initial.filter(pos => Number.isInteger(pos) && pos >= 0 && pos <= state.doc.length)
      .map(pos => state.doc.lineAt(pos).from))].sort((a, b) => a - b)),
    gutter({
      class: 'cm-bookmarks',
      lineMarker: (view, line) => view.state.field(procedureScriptState) && view.state.field(bookmarkState).includes(line.from) ? marker : null,
      lineMarkerChange: update => update.docChanged || update.startState.field(bookmarkState) !== update.state.field(bookmarkState),
    }),
    EditorView.baseTheme({
      '.cm-bookmarks': { color: '#c084fc', minWidth: '12px' },
      '.cm-bookmarks .cm-gutterElement': { padding: '0 2px', fontSize: '13px' },
    }),
  ]
}

export function editBookmark(view, add) {
  if (!view || view.isDestroyed) return false
  const line = view.state.doc.lineAt(view.state.selection.main.head).from
  const positions = view.state.field(bookmarkState)
  view.dispatch({ effects: setBookmarks.of(add ? [...positions, line] : positions.filter(pos => pos !== line)) })
  view.focus()
  return true
}

export function goToBookmark(view, direction) {
  if (!view || view.isDestroyed) return false
  const positions = view.state.field(bookmarkState)
  if (!positions.length) return false
  const current = view.state.doc.lineAt(view.state.selection.main.head).from
  const pos = direction > 0
    ? positions.find(pos => pos > current) ?? positions[0]
    : positions.findLast(pos => pos < current) ?? positions.at(-1)
  const effects = []
  foldedRanges(view.state).between(pos, pos, (from, to) => effects.push(unfoldEffect.of({ from, to })))
  effects.push(EditorView.scrollIntoView(pos, { y: 'center' }))
  view.dispatch({ selection: { anchor: pos }, effects })
  view.focus()
  return true
}
