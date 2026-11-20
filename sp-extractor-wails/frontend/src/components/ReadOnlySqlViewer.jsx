import { useEffect, useRef } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { openSearchPanel, highlightSelectionMatches } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { sql, MSSQL, MySQL, PostgreSQL, SQLDialect } from '@codemirror/lang-sql'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { sqlFoldExtension } from '../utils/sqlFolding'
import { getEditorThemeExtension, makeFontTheme } from '../utils/editorThemes'
import { createEditorSearch } from '../utils/editorSearch'
import { createEditorOverview } from '../utils/editorOverview'
import { createProcedureLinks } from '../utils/procedureLinks'

const customMSSQL = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true })
const customMySQL = SQLDialect.define({ ...MySQL.spec, caseInsensitiveIdentifiers: true })
const customPostgreSQL = SQLDialect.define({ ...PostgreSQL.spec, caseInsensitiveIdentifiers: true })

const DIALECTS = {
  SQL_SERVER: customMSSQL,
  MYSQL: customMySQL,
  POSTGRESQL: customPostgreSQL,
}

const baseViewerTheme = EditorView.theme({
  '&': { height: '100%', outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-gutters': { borderRight: '1px solid rgba(255, 255, 255, 0.08)' },
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'default' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-foldGutter': { width: '16px' },
  '.cm-foldGutter .cm-gutterElement': {
    cursor: 'pointer',
    color: '#64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: '#38bdf8',
  },
  '.cm-fold-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 'bold',
    userSelect: 'none',
    width: '14px',
    height: '14px',
    borderRadius: '2px',
    lineHeight: '1',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    color: '#7dd3fc',
    borderRadius: '3px',
    padding: '0 4px',
    margin: '0 2px',
    fontSize: '11px',
    cursor: 'pointer',
  },
  '.cm-indent-markers': {
    '--indent-marker-color': 'rgba(255, 255, 255, 0.07)',
    '--indent-marker-active-color': 'rgba(56, 189, 248, 0.4)',
  },
})

export default function ReadOnlySqlViewer({
  content = '',
  dbType = 'SQL_SERVER',
  fontSize = 12,
  fontFamily = 'Consolas',
  editorTheme = 'one-dark',
  showIndent = true,
  showFolding = true,
  className = '',
  procedures,
  onOpenProcedure,
}) {
  const host = useRef(null)
  const viewRef = useRef(null)

  const langComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  const fontComp = useRef(new Compartment())
  const indentComp = useRef(new Compartment())
  const foldComp = useRef(new Compartment())
  const procedureComp = useRef(new Compartment())

  // Initial creation of the CodeMirror view
  useEffect(() => {
    if (!host.current) return

    const dialect = DIALECTS[dbType] || customMSSQL
    const themeExt = getEditorThemeExtension(editorTheme)

    const extensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': 'Visor SQL de solo lectura' }),
      createEditorSearch(),
      createEditorOverview(),
      procedureComp.current.of(createProcedureLinks({ procedures, onOpenProcedure, dbType })),
      lineNumbers(),
      highlightSelectionMatches(),
      baseViewerTheme,
      langComp.current.of(sql({ dialect, upperCaseKeywords: true })),
      themeComp.current.of(themeExt),
      fontComp.current.of(makeFontTheme(fontSize, fontFamily)),
      indentComp.current.of(showIndent ? indentationMarkers({ highlightActiveBlock: true, thickness: 1 }) : []),
      foldComp.current.of(showFolding ? sqlFoldExtension : []),
    ]

    const state = EditorState.create({
      doc: content || '',
      extensions,
    })

    const view = new EditorView({
      parent: host.current,
      state,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // Mount only once

  // Update document content when prop changes
  useEffect(() => {
    viewRef.current?.dispatch({ effects: procedureComp.current.reconfigure(createProcedureLinks({ procedures, onOpenProcedure, dbType })) })
  }, [procedures, onOpenProcedure, dbType])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    const nextDoc = content || ''
    if (currentDoc !== nextDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: nextDoc },
      })
    }
  }, [content])

  // Reconfigure language dialect
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const dialect = DIALECTS[dbType] || customMSSQL
    view.dispatch({
      effects: langComp.current.reconfigure(sql({ dialect, upperCaseKeywords: true })),
    })
  }, [dbType])

  // Reconfigure theme
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeComp.current.reconfigure(getEditorThemeExtension(editorTheme)),
    })
  }, [editorTheme])

  // Reconfigure font and size
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: fontComp.current.reconfigure(makeFontTheme(fontSize, fontFamily)),
    })
    view.requestMeasure()
  }, [fontSize, fontFamily])

  // Reconfigure indentation markers
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: indentComp.current.reconfigure(
        showIndent ? indentationMarkers({ highlightActiveBlock: true, thickness: 1 }) : []
      ),
    })
  }, [showIndent])

  // Reconfigure folding
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: foldComp.current.reconfigure(showFolding ? sqlFoldExtension : []),
    })
  }, [showFolding])

  return (
    <div
      ref={host}
      // Catch Ctrl+F when the outer viewer rather than its content has focus.
      tabIndex={0}
      onKeyDown={(e) => {
        if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F') && viewRef.current) {
          e.preventDefault()
          openSearchPanel(viewRef.current)
        }
      }}
      className={`h-full w-full overflow-hidden outline-none ${className}`}
      style={{ fontSize: `${fontSize || 12}px` }}
    />
  )
}
