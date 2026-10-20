import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { sql, MSSQL, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'

const DIALECTS = { SQL_SERVER: MSSQL, MYSQL: MySQL, POSTGRESQL: PostgreSQL }

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: '#18191A' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: '#18191A', borderRight: '1px solid rgba(36,51,80,0.8)', color: '#64748b' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.05)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip.cm-tooltip-autocomplete': { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px' },
}, { dark: true })

function sqlLanguage(dbType, schema) {
  return sql({
    dialect: DIALECTS[dbType] || MSSQL,
    schema,
    upperCaseKeywords: true,
  })
}

/**
 * CodeMirror-based SQL editor.
 *  - value / onChange: the document text (value is only read on mount; remount with `key` to reset it)
 *  - dbType / schema: SQL dialect and { "schema.table": [columns] } used for autocompletion
 *  - onRun(selectedTextOrNull): fired on Ctrl/Cmd+Enter
 *  - viewRef: receives the EditorView so the parent can read the current selection
 */
export default function SqlEditor({ value, onChange, dbType, schema, onRun, viewRef }) {
  const host = useRef(null)
  const lang = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  onChangeRef.current = onChange
  onRunRef.current = onRun

  useEffect(() => {
    const runKeys = Prec.highest(keymap.of([{
      key: 'Mod-Enter',
      run: (view) => {
        const { from, to } = view.state.selection.main
        onRunRef.current?.(from === to ? null : view.state.sliceDoc(from, to))
        return true
      },
    }]))

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value || '',
        extensions: [
          runKeys,
          basicSetup,
          lang.current.of(sqlLanguage(dbType, schema)),
          oneDark,
          theme,
          EditorView.updateListener.of(u => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    if (viewRef) viewRef.current = view
    return () => {
      view.destroy()
      if (viewRef && viewRef.current === view) viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconfigure the language when the schema (or dialect) changes, keeping the document.
  useEffect(() => {
    const view = viewRef?.current
    if (view) view.dispatch({ effects: lang.current.reconfigure(sqlLanguage(dbType, schema)) })
  }, [dbType, schema, viewRef])

  return <div ref={host} className="h-full w-full" />
}
