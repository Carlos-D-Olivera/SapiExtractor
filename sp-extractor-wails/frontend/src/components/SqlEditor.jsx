import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap, MatchDecorator, Decoration, ViewPlugin } from '@codemirror/view'
import { Compartment, EditorState, EditorSelection, Prec } from '@codemirror/state'
import {
  sql,
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLDialect,
  schemaCompletionSource,
  keywordCompletionSource,
} from '@codemirror/lang-sql'
import { LanguageSupport } from '@codemirror/language'
import { acceptCompletion, closeCompletion, completionStatus } from '@codemirror/autocomplete'
import { insertNewlineAndIndent } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'

// Dialects with case-insensitive identifiers so names aren't auto-quoted
const customMSSQL = SQLDialect.define({
  ...MSSQL.spec,
  caseInsensitiveIdentifiers: true,
})
const customMySQL = SQLDialect.define({
  ...MySQL.spec,
  caseInsensitiveIdentifiers: true,
})
const customPostgreSQL = SQLDialect.define({
  ...PostgreSQL.spec,
  caseInsensitiveIdentifiers: true,
})

const DIALECTS = {
  SQL_SERVER: customMSSQL,
  MYSQL: customMySQL,
  POSTGRESQL: customPostgreSQL,
}

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

// Strip surrounding quotes or brackets from autocompleted text ("name", [name], `name`, 'name')
function stripQuotes(str) {
  if (typeof str !== 'string') return str
  return str.replace(/^["'`\[](.*)["'`\]]$/, '$1')
}

function cleanOption(opt) {
  if (!opt) return opt
  if (typeof opt.apply === 'string') {
    return { ...opt, apply: stripQuotes(opt.apply) }
  }
  return opt
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
  const dialect = DIALECTS[dbType] || customMSSQL

  if (!schema || Object.keys(schema).length === 0) {
    return sql({
      dialect,
      upperCaseKeywords: true,
    })
  }

  // Wrap schemaCompletionSource to guarantee no completion ever inserts surrounding quotes
  const rawSource = schemaCompletionSource({ dialect, schema })
  const cleanSchemaSource = (context) => {
    const res = rawSource(context)
    if (!res) return null
    if (res instanceof Promise) {
      return res.then(r => r && r.options ? { ...r, options: r.options.map(cleanOption) } : r)
    }
    if (res.options) {
      return { ...res, options: res.options.map(cleanOption) }
    }
    return res
  }

  return new LanguageSupport(dialect.language, [
    dialect.language.data.of({ autocomplete: cleanSchemaSource }),
    dialect.language.data.of({ autocomplete: keywordCompletionSource(dialect, true) }),
  ])
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
    const customKeys = Prec.highest(keymap.of([{
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
    }, {
      // Enter: When completion popup is open, close it and insert newline.
      // Prevents Enter from ever accepting autocomplete suggestions!
      key: 'Enter',
      run: (view) => {
        if (completionStatus(view.state)) {
          closeCompletion(view)
        }
        return insertNewlineAndIndent(view)
      },
    }, {
      // Tab: Expand snippet if code matches, otherwise accept completion suggestion if popup is open.
      key: 'Tab',
      run: (view) => {
        const list = autocompletesRef.current || []
        const { from: selFrom, to: selTo, head } = view.state.selection.main

        // 1. Check if word before cursor matches an AutoComplete snippet code
        if (selFrom === selTo && list.length > 0) {
          const line = view.state.doc.lineAt(head)
          const textBefore = view.state.sliceDoc(line.from, head)
          const match = textBefore.match(/([a-zA-Z0-9_#$@]+)$/)
          if (match) {
            const typedWord = match[1]
            const matched = list.find(it => it.code && it.code.trim().toLowerCase() === typedWord.toLowerCase())
            if (matched && matched.query) {
              closeCompletion(view)

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
            }
          }
        }

        // 2. If completion suggestion popup is open, accept the completion with TAB
        if (acceptCompletion(view)) {
          return true
        }

        return false
      },
    }]))

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value || '',
        extensions: [
          customKeys,
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
