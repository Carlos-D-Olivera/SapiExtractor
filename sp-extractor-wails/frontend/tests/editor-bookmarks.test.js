import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EditorState } from '@codemirror/state'
import { codeFolding, foldedRanges, foldEffect } from '@codemirror/language'
import { bookmarkState, createEditorBookmarks, editBookmark, goToBookmark, isProcedureScript, setBookmarks } from '../src/utils/editorBookmarks.js'

test('detects procedure scripts, including drop/create scripts opened from Edit', () => {
  for (const sql of [
    'ALTER PROC dbo.p AS SELECT 1',
    'CREATE OR ALTER PROCEDURE [dbo].[p] AS SELECT 1',
    'DROP PROCEDURE dbo.p;\nGO\n/* header */\nCREATE PROC dbo.p AS SELECT 1',
    'create /* comment */ procedure p() select 1',
  ]) assert.equal(isProcedureScript(sql), true, sql)
  for (const sql of [
    "SELECT 'ALTER PROC dbo.p'",
    '-- CREATE PROC dbo.p\nSELECT 1',
    '/* nested /* comment */ CREATE PROC p */ SELECT 1',
    'SELECT [CREATE PROC], "ALTER PROCEDURE"',
    'CREATE TABLE p (id int)',
  ]) assert.equal(isProcedureScript(sql), false, sql)
})

const makeState = (positions = []) => EditorState.create({
  doc: 'ALTER PROC p AS\nSELECT 1;\nSELECT 2;\nSELECT 3;',
  extensions: createEditorBookmarks(positions),
})
const marks = state => state.field(bookmarkState)

test('normalizes and deduplicates bookmarks and restores them per editor', () => {
  const state = makeState([16, 16, 26, -1, 999999])
  assert.deepEqual(marks(state), [state.doc.line(2).from, state.doc.line(3).from])
  assert.deepEqual(marks(makeState(marks(state))), marks(state))
  assert.deepEqual(marks(makeState()), [])
})

test('bookmarks follow inserted lines and survive edits on their own line', () => {
  let state = makeState([16])
  state = state.update({ changes: { from: 0, insert: '-- header\n' } }).state
  assert.deepEqual(marks(state), [state.doc.line(3).from])
  const pos = marks(state)[0]
  state = state.update({ changes: { from: pos, to: pos + 6, insert: 'PRINT' } }).state
  assert.deepEqual(marks(state), [pos])
})

test('deleting a bookmarked line removes its bookmark, without affecting other lines', () => {
  let state = makeState([16, 26])
  const line = state.doc.line(2)
  state = state.update({ changes: { from: line.from, to: line.to + 1 } }).state
  assert.deepEqual(marks(state), [state.doc.line(2).from])
  state = state.update({ changes: { from: 0, to: state.doc.length } }).state
  assert.deepEqual(marks(state), [])
})

test('adding and removing operate on the cursor line, navigation wraps', () => {
  const view = {
    state: makeState(),
    dispatch(spec) { this.state = this.state.update(spec).state },
    focus() {},
  }
  view.dispatch({ selection: { anchor: 18 } })
  editBookmark(view, true)
  editBookmark(view, true)
  assert.deepEqual(marks(view.state), [16])
  view.dispatch({ selection: { anchor: view.state.doc.line(4).from } })
  editBookmark(view, true)
  goToBookmark(view, 1)
  assert.equal(view.state.selection.main.head, 16)
  goToBookmark(view, -1)
  assert.equal(view.state.selection.main.head, view.state.doc.line(4).from)
  editBookmark(view, false)
  assert.deepEqual(marks(view.state), [16])
  view.dispatch({ effects: setBookmarks.of([]) })
  assert.equal(goToBookmark(view, 1), false)
})

test('navigation unfolds a collapsed block containing the bookmark', () => {
  const state = EditorState.create({
    doc: 'ALTER PROC p AS\nBEGIN\nSELECT 1;\nEND',
    extensions: [createEditorBookmarks([22]), codeFolding()],
  })
  const view = {
    state: state.update({ effects: foldEffect.of({ from: 21, to: 31 }) }).state,
    dispatch(spec) { this.state = this.state.update(spec).state },
    focus() {},
  }
  assert.equal(foldedRanges(view.state).size, 1)
  goToBookmark(view, 1)
  assert.equal(view.state.selection.main.head, 22)
  assert.equal(foldedRanges(view.state).size, 0)
})
