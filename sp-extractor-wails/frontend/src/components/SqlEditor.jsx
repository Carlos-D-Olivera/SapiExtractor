import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap, MatchDecorator, Decoration, ViewPlugin } from '@codemirror/view'
import { Compartment, EditorState, EditorSelection, Prec } from '@codemirror/state'
import { sql, MSSQL, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'

const DIALECTS = { SQL_SERVER: MSSQL, MYSQL: MySQL, POSTGRESQL: PostgreSQL }

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#18191A' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: '#18191A', borderRight: '1px solid rgba(36,51,80,0.8)', color: '#64748b' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.05)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip.cm-tooltip-autocomplete': { fontFamily: 'ui-monospace, Consolas, monospace' },
  // High contrast selection background styling
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#245d9a !important',
  },
  '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: '#1b4068 !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(56, 189, 248, 0.28) !important',
    outline: '1px solid rgba(56, 189, 248, 0.5)',
    borderRadius: '2px',
  },
  '.cm-autocomplete-code-highlight': {
    color: '#facc15 !important',
    backgroundColor: 'rgba(250, 204, 21, 0.18)',
    border: '1px solid rgba(250, 204, 21, 0.45)',
    borderRadius: '3px',
    padding: '0 2px',
    fontWeight: '700',
    textDecoration: 'underline',
    textDecorationColor: '#facc15',
  },
}, { dark: true })

function makeFontSizeTheme(size) {
  return EditorView.theme({
    '&': { fontSize: `${size}px` },
    '.cm-tooltip.cm-tooltip-autocomplete': { fontSize: `${size}px` },
  })
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createHighlightPlugin(autocompletes) {
  const codes = (autocompletes || [])
    .map(a => a.code?.trim())
    .filter(Boolean)

  if (codes.length === 0) return []

  const escaped = codes.map(escapeRegex).join('|')
  const regex = new RegExp('\\b(' + escaped + ')\\b', 'gi')

  const decorator = new MatchDecorator({
    regexp: regex,
    decoration: Decoration.mark({ class: 'cm-autocomplete-code-highlight' }),
  })

  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = decorator.createDeco(view)
    }
    update(update) {
      this.decorations = decorator.updateDeco(update, this.decorations)
    }
  }, {
    decorations: v => v.decorations,
  })
}

function sqlLanguage(dbType, schema) {
  return sql({
    dialect: DIALECTS[dbType] || MSSQL,
    schema,
    upperCaseKeywords: true,
  })
}

/**
 * CodeMirror-based SQL editor.
 *  - value / onChange: document text
 *  - dbType / schema: SQL dialect and { "schema.table": [columns] } used for autocompletion
 *  - autocompletes: list of { code, query } for TAB autocomplete & yellow highlighting
 *  - onRun(selectedTextOrNull): fired on F5 or Ctrl/Cmd+Enter
 *  - viewRef: receives the EditorView
 */
export default function SqlEditor({ value, onChange, dbType, schema, autocompletes, onRun, viewRef, fontSize = 12 }) {
  const host = useRef(null)
  const lang = useRef(new Compartment())
  const highlightComp = useRef(new Compartment())
  const fontSizeComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  const autocompletesRef = useRef(autocompletes)

  onChangeRef.current = onChange
  onRunRef.current = onRun
  autocompletesRef.current = autocompletes

  useEffect(() => {
    const runKeys = Prec.highest(keymap.of([{
      key: 'F5',
      run: (view) => {
        const { from, to } = view.state.selection.main
        onRunRef.current?.(from === to ? null : view.state.sliceDoc(from, to))
        return true
      },
    }, {
      key: 'Mod-Enter',
      run: (view) => {
        const { from, to } = view.state.selection.main
        onRunRef.current?.(from === to ? null : view.state.sliceDoc(from, to))
        return true
      },
    }]))

    // Highest-priority TAB key handler to expand autocomplete codes (case-insensitive)
    const tabKeys = Prec.highest(keymap.of([{
      key: 'Tab',
      run: (view) => {
        const list = autocompletesRef.current || []
        if (list.length === 0) return false

        const { from: selFrom, to: selTo, head } = view.state.selection.main
        if (selFrom !== selTo) return false // don't replace ranged selections

        const line = view.state.doc.lineAt(head)
        const textBefore = view.state.sliceDoc(line.from, head)
        const match = textBefore.match(/([a-zA-Z0-9_#$@]+)$/)
        if (!match) return false

        const typedWord = match[1]
        const matched = list.find(it => it.code && it.code.trim().toLowerCase() === typedWord.toLowerCase())
        if (!matched || !matched.query) return false

        const from = head - typedWord.length
        const to = head
        const rawQuery = matched.query

        let insertText = rawQuery
        let selection

        const firstHash = rawQuery.indexOf('#')
        if (firstHash !== -1) {
          const secondHash = rawQuery.indexOf('#', firstHash + 1)
          if (secondHash !== -1) {
            insertText = rawQuery.slice(0, firstHash) + rawQuery.slice(firstHash + 1, secondHash) + rawQuery.slice(secondHash + 1)
            selection = EditorSelection.single(from + firstHash, from + secondHash - 1)
          } else {
            insertText = rawQuery.slice(0, firstHash) + rawQuery.slice(firstHash + 1)
            selection = EditorSelection.cursor(from + firstHash)
          }
        } else if (matched.seleccionar) {
          selection = EditorSelection.single(from, from + insertText.length)
        } else {
          selection = EditorSelection.cursor(from + insertText.length)
        }

        view.dispatch({
          changes: { from, to, insert: insertText },
          selection,
          scrollIntoView: true,
        })
        return true
      },
    }]))

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value || '',
        extensions: [
          runKeys,
          tabKeys,
          basicSetup,
          lang.current.of(sqlLanguage(dbType, schema)),
          highlightComp.current.of(createHighlightPlugin(autocompletesRef.current)),
          fontSizeComp.current.of(makeFontSizeTheme(fontSize || 12)),
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

  // Reconfigure the highlight plugin when the autocompletes list changes
  useEffect(() => {
    const view = viewRef?.current
    if (view) {
      view.dispatch({
        effects: highlightComp.current.reconfigure(createHighlightPlugin(autocompletes)),
      })
    }
  }, [autocompletes, viewRef])

  // Reconfigure font size and remeasure when fontSize changes
  useEffect(() => {
    const view = viewRef?.current
    if (view) {
      view.dispatch({
        effects: fontSizeComp.current.reconfigure(makeFontSizeTheme(fontSize || 12)),
      })
      view.requestMeasure()
    }
  }, [fontSize, viewRef])

  return <div ref={host} className="h-full w-full" style={{ fontSize: `${fontSize || 12}px` }} />
}
