import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap, MatchDecorator, Decoration, ViewPlugin, lineNumbers } from '@codemirror/view'
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
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer' },
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

// Selects the entire line (and supports extending/dragging across lines) when clicking line numbers
const lineNumbersExtension = lineNumbers({
  domEventHandlers: {
    mousedown: (view, line, event) => {
      if (event.button !== 0) return false
      const doc = view.state.doc
      const lineStart = doc.lineAt(line.from)
      const lineEndPos = (l) => Math.min(l.to + 1, doc.length)

      if (event.shiftKey) {
        const currentAnchor = view.state.selection.main.anchor
        const targetHead = currentAnchor <= lineStart.from ? lineEndPos(lineStart) : lineStart.from
        view.dispatch({
          selection: EditorSelection.single(currentAnchor, targetHead),
          scrollIntoView: true,
        })
        view.focus()
        return true
      }

      view.dispatch({
        selection: EditorSelection.single(lineStart.from, lineEndPos(lineStart)),
        scrollIntoView: true,
      })
      view.focus()

      const onMouseMove = (moveEvent) => {
        try {
          const lineAtPos = view.lineBlockAtHeight(moveEvent.clientY - view.documentTop)
          const currentLine = view.state.doc.lineAt(lineAtPos.from)
          if (currentLine.from >= lineStart.from) {
            view.dispatch({
              selection: EditorSelection.single(lineStart.from, lineEndPos(currentLine)),
            })
          } else {
            view.dispatch({
              selection: EditorSelection.single(lineEndPos(lineStart), currentLine.from),
            })
          }
        } catch { /* ignore */ }
      }

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)

      return true
    },
  },
})

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Strip surrounding quotes or brackets from autocompleted text ("name", [name], `name`, 'name')
export function stripQuotes(str) {
  if (typeof str !== 'string') return str
  return str.split('.')
    .map(p => p.trim().replace(/^["'`\[]+|["'`\]]+$/g, ''))
    .filter(Boolean)
    .join('.')
}

export function cleanOption(opt) {
  if (!opt) return opt
  const res = { ...opt }
  if (typeof res.label === 'string') {
    res.label = stripQuotes(res.label)
  }
  if (typeof res.apply === 'string') {
    res.apply = stripQuotes(res.apply)
  }
  return res
}

export function getIdentifierAtCursor(state, head) {
  if (!state || head == null) return ''
  const line = state.doc.lineAt(head)
  const lineText = line.text
  const col = head - line.from
  let start = col
  while (start > 0 && /[a-zA-Z0-9_#$@.\[\]"`]/.test(lineText[start - 1])) {
    start--
  }
  let end = col
  while (end < lineText.length && /[a-zA-Z0-9_#$@.\[\]"`]/.test(lineText[end])) {
    end++
  }
  if (start === end) return ''
  return lineText.slice(start, end).trim()
}

export function extractTablesFromSql(sql) {
  if (!sql) return []
  const tables = new Set()
  const cleanSql = sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')

  const joinRegex = /\b(?:LEFT\s+|RIGHT\s+|FULL\s+|INNER\s+|CROSS\s+)?JOIN\s+([a-zA-Z0-9_#$@.\[\]"`]+)/gi
  let match
  while ((match = joinRegex.exec(cleanSql)) !== null) {
    const clean = stripQuotes(match[1])
    if (clean) {
      tables.add(clean.toLowerCase())
      if (clean.includes('.')) tables.add(clean.split('.').pop().toLowerCase())
    }
  }

  const updateRegex = /\bUPDATE\s+([a-zA-Z0-9_#$@.\[\]"`]+)/gi
  while ((match = updateRegex.exec(cleanSql)) !== null) {
    const clean = stripQuotes(match[1])
    if (clean) {
      tables.add(clean.toLowerCase())
      if (clean.includes('.')) tables.add(clean.split('.').pop().toLowerCase())
    }
  }

  const intoRegex = /\bINTO\s+([a-zA-Z0-9_#$@.\[\]"`]+)/gi
  while ((match = intoRegex.exec(cleanSql)) !== null) {
    const clean = stripQuotes(match[1])
    if (clean) {
      tables.add(clean.toLowerCase())
      if (clean.includes('.')) tables.add(clean.split('.').pop().toLowerCase())
    }
  }

  const fromRegex = /\bFROM\s+([^;()]+?)(?=\bWHERE\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bLIMIT\b|\bUNION\b|\bJOIN\b|\bLEFT\b|\bRIGHT\b|\bINNER\b|\bCROSS\b|\bFULL\b|;|\)|$)/gi
  while ((match = fromRegex.exec(cleanSql)) !== null) {
    const items = match[1].split(',')
    for (const item of items) {
      const trimmed = item.trim()
      if (!trimmed) continue
      const firstToken = trimmed.split(/\s+/)[0]
      const clean = stripQuotes(firstToken)
      if (clean && !/^(SELECT|WHERE|SET|VALUES|DEFAULT|CASE)$/i.test(clean)) {
        tables.add(clean.toLowerCase())
        if (clean.includes('.')) tables.add(clean.split('.').pop().toLowerCase())
      }
    }
  }

  return Array.from(tables)
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
  // and suggest columns of queried tables when writing SELECT, WHERE, etc.
  const rawSource = schemaCompletionSource({ dialect, schema })

  const processCompletionResult = (res, context) => {
    const isDot = Boolean(context.matchBefore(/\.\w*$/))
    let columnOptions = []
    if (!isDot) {
      const docText = context.state.doc.toString()
      const queriedTables = extractTablesFromSql(docText)
      if (queriedTables.length > 0) {
        const seenCols = new Set()
        for (const tbl of queriedTables) {
          for (const [key, cols] of Object.entries(schema)) {
            const lowerKey = key.toLowerCase()
            if (lowerKey === tbl || lowerKey.endsWith('.' + tbl)) {
              if (Array.isArray(cols)) {
                for (const col of cols) {
                  const colName = typeof col === 'string' ? col : col.label
                  if (!colName || seenCols.has(colName.toLowerCase())) continue
                  seenCols.add(colName.toLowerCase())
                  columnOptions.push({
                    label: colName,
                    type: 'property',
                    detail: key,
                    boost: 2,
                  })
                }
              }
            }
          }
        }
      }
    }

    if (columnOptions.length === 0) {
      if (res && res.options) {
        return { ...res, options: res.options.map(cleanOption) }
      }
      return res
    }

    if (!res) {
      const word = context.matchBefore(/[\w$#]+/)
      if (!word && !context.explicit) return null
      return {
        from: word ? word.from : context.pos,
        options: columnOptions.map(cleanOption),
      }
    }

    return {
      ...res,
      options: [...columnOptions.map(cleanOption), ...(res.options || []).map(cleanOption)],
    }
  }

  const cleanSchemaSource = (context) => {
    const res = rawSource(context)
    if (res instanceof Promise) {
      return res.then(r => processCompletionResult(r, context))
    }
    return processCompletionResult(res, context)
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
 *  - onAltF1(tableName): fired on Alt+F1 to inspect table definition
 *  - onToggleResults(): fired on Ctrl+R to toggle query results pane
 *  - viewRef: receives the EditorView
 */
export default function SqlEditor({
  value,
  onChange,
  dbType,
  schema,
  autocompletes,
  onRun,
  onAltF1,
  onToggleResults,
  viewRef,
  fontSize = 12,
}) {
  const host = useRef(null)
  const lang = useRef(new Compartment())
  const highlightComp = useRef(new Compartment())
  const fontSizeComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  const onAltF1Ref = useRef(onAltF1)
  const onToggleResultsRef = useRef(onToggleResults)
  const autocompletesRef = useRef(autocompletes)

  onChangeRef.current = onChange
  onRunRef.current = onRun
  onAltF1Ref.current = onAltF1
  onToggleResultsRef.current = onToggleResults
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
      key: 'Alt-F1',
      run: (view) => {
        const { from, to, head } = view.state.selection.main
        let text = from !== to ? view.state.sliceDoc(from, to).trim() : getIdentifierAtCursor(view.state, head)
        if (text) {
          const clean = stripQuotes(text)
          if (clean) {
            onAltF1Ref.current?.(clean)
            return true
          }
        }
        return false
      },
    }, {
      key: 'Mod-r',
      run: () => {
        onToggleResultsRef.current?.()
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
          lineNumbersExtension,
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
