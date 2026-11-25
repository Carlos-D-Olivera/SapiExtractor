import { EditorSelection } from '@codemirror/state'

// Copy the current line's actual whitespace, rather than asking the SQL parser
// to recalculate indentation (which can move aligned SELECT columns to the left).
export function insertNewlineKeepingIndent({ state, dispatch }) {
  if (state.readOnly) return false
  const changes = state.changeByRange(range => {
    const line = state.doc.lineAt(range.from)
    const whitespace = /^[\t ]*/.exec(line.text)[0]
    const indent = whitespace.slice(0, range.from - line.from)
    const insert = state.toText(state.lineBreak + indent)
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
  return true
}
