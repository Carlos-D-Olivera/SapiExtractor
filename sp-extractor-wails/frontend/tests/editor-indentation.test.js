import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { insertNewlineKeepingIndent } from '../src/utils/editorIndentation.js'

function editor(doc, selection, extensions = []) {
  return {
    state: EditorState.create({ doc, selection, extensions }),
    dispatch(tr) { this.state = tr.state },
  }
}

// Commands receive dispatch as a function, not a bound method.
function enter(view) {
  return insertNewlineKeepingIndent({ state: view.state, dispatch: tr => view.dispatch(tr) })
}

test('Enter preserves manually aligned SELECT columns, including repeated blank lines', () => {
  const doc = 'SELECT\n                  , T.CentroAtencion'
  const view = editor(doc, { anchor: doc.length })
  enter(view)
  assert.equal(view.state.doc.toString(), doc + '\n' + ' '.repeat(18))
  enter(view)
  assert.equal(view.state.doc.toString(), doc + ('\n' + ' '.repeat(18)).repeat(2))
  assert.equal(view.state.selection.main.head, view.state.doc.length)
})

test('keeps tabs and mixed whitespace exactly as typed', () => {
  for (const indent of ['', '    ', '\t\t', '\t  \t']) {
    const doc = indent + 'SELECT 1'
    const view = editor(doc, { anchor: doc.length })
    enter(view)
    assert.equal(view.state.doc.toString(), doc + '\n' + indent)
  }
})

test('splitting a line preserves its indentation and the text after the cursor', () => {
  const view = editor('    SELECT a, b', { anchor: 13 })
  enter(view)
  assert.equal(view.state.doc.toString(), '    SELECT a,\n     b')
  assert.equal(view.state.selection.main.head, 18)
})

test('replaces a selection and supports multiple cursors independently', () => {
  const view = editor('  first\n\tsecond', EditorSelection.create([
    EditorSelection.cursor(7),
    EditorSelection.cursor(15),
  ]), [EditorState.allowMultipleSelections.of(true)])
  enter(view)
  assert.equal(view.state.doc.toString(), '  first\n  \n\tsecond\n\t')
  assert.equal(view.state.selection.ranges.length, 2)

  const selected = editor('    SELECT old', { anchor: 11, head: 14 })
  enter(selected)
  assert.equal(selected.state.doc.toString(), '    SELECT \n    ')
})

test('does not duplicate indentation when pressing Enter at the start of a line', () => {
  const view = editor('    SELECT 1', { anchor: 0 })
  enter(view)
  assert.equal(view.state.doc.toString(), '\n    SELECT 1')
})

test('respects read-only mode and Enter is undoable', () => {
  const readOnly = editor('  SELECT 1', { anchor: 10 }, [EditorState.readOnly.of(true)])
  assert.equal(enter(readOnly), false)
  assert.equal(readOnly.state.doc.toString(), '  SELECT 1')

  const view = editor('  SELECT 1', { anchor: 10 }, [history()])
  enter(view)
  assert.equal(undo({ state: view.state, dispatch: tr => view.dispatch(tr) }), true)
  assert.equal(view.state.doc.toString(), '  SELECT 1')
})
