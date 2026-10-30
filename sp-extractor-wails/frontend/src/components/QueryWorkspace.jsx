import { useState, useCallback, useRef, useEffect } from 'react'
import { Play, Plus, X, Loader2, AlertCircle, Ban, Clock, Table2, Trash2, Sparkles, FileCode2, Check, History, RotateCcw, Save } from 'lucide-react'
import clsx from 'clsx'
import SqlEditor, { getIdentifierAtCursor, stripQuotes } from './SqlEditor'
import { getStoredAutocompletes, loadStoredAutocompletes } from './AutocompletesModal'
import InsertScriptModal from './InsertScriptModal'
import StructuredViewerModal from './StructuredViewerModal'
import QueryHistoryModal, { titleFromSql } from './QueryHistoryModal'
import TabContextMenu from './TabContextMenu'
import NewTabContextMenu from './NewTabContextMenu'
import { detectType } from '../utils/structured'

function makeTab(seq, overrides = {}) {
  return {
    id: `q${Date.now()}_${seq}`,
    title: `Consulta ${seq}`,
    sql: '',
    lastSql: '',
    result: null,
    error: '',
    running: false,
    savedPath: null,
    savedSql: '',
    ...overrides,
  }
}

export function isQueryTabDirty(tab) {
  if (!tab) return false
  const sql = tab.sql ?? ''
  const savedSql = tab.savedSql ?? ''
  if (sql === savedSql) return false
  if (!tab.savedPath && !sql.trim() && !savedSql.trim()) return false
  return true
}

const go = () => import('../../wailsjs/go/main/App')

// Applied only to queries that don't set their own limit (TOP / LIMIT / FETCH).
const DEFAULT_ROW_LIMIT = 100
const EXPLICIT_LIMIT = /\b(top\s*\(?\s*\d+|limit\s+\d+|fetch\s+(first|next)\b)/i

const DEFAULT_FONT_SIZE = 12
const MIN_FONT_SIZE = 9
const MAX_FONT_SIZE = 32

function getStoredRowLimit() {
  try {
    const v = localStorage.getItem('sp_extractor_default_row_limit')
    if (v !== null) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch { /* ignore */ }
  return DEFAULT_ROW_LIMIT
}

function getStoredFontSize() {
  try {
    const v = localStorage.getItem('sp_extractor_query_font_size')
    const n = Number(v)
    if (Number.isFinite(n) && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) return n
  } catch { /* ignore */ }
  return DEFAULT_FONT_SIZE
}

// Builds { "schema.table": [cols], "table": [cols] } for editor autocompletion.
function buildSchema(columns) {
  const schema = {}
  for (const c of columns) {
    if (!c.parentName) continue
    const qualified = c.schema ? `${c.schema}.${c.parentName}` : c.parentName
    ;(schema[qualified] ||= []).push(c.name)
    ;(schema[c.parentName] ||= [])
    if (!schema[c.parentName].includes(c.name)) schema[c.parentName].push(c.name)
  }
  return schema
}

export default function QueryWorkspace({
  workspaceId = '1',
  connLabel,
  dbType,
  incomingSql,
  active: visible,
  onOpenInQuery,
  onOpenTableDefinition,
  onOpenTableRelations,
  onOpenTableScripts,
  onDirtyChange,
}) {
  const tabSeqRef = useRef(1)
  const createTab = useCallback((overrides = {}) => {
    tabSeqRef.current += 1
    return makeTab(tabSeqRef.current, overrides)
  }, [])

  const [tabs, setTabs] = useState(() => [makeTab(1)])
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const [insertTarget, setInsertTarget] = useState(null)
  const [viewer, setViewer] = useState(null) // JSON / XML cell open in the viewer
  const [maxRows, setMaxRows] = useState(() => getStoredRowLimit())
  const [showResults, setShowResults] = useState(true)

  const toggleResults = useCallback(() => {
    setShowResults(prev => !prev)
  }, [])
  const [fontSize, setFontSize] = useState(() => getStoredFontSize())
  const workspaceRef = useRef(null)
  const deltaRef = useRef(0)
  const schemaLoaded = useRef(false)
  const [schema, setSchema] = useState({})
  const editorRef = useRef(null)
  const lastNonce = useRef(incomingSql?.nonce)
  const [autocompletes, setAutocompletes] = useState(() => getStoredAutocompletes())

  const [closedTabs, setClosedTabs] = useState([])      // recently closed tabs of this database
  const [showClosed, setShowClosed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [tabMenu, setTabMenu] = useState(null) // { x, y, tabId }
  const [plusMenu, setPlusMenu] = useState(null) // { x, y }
  const [stateLoaded, setStateLoaded] = useState(false) // saved tabs have been read; autosave may start
  const lastSaved = useRef('')

  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange

  useEffect(() => {
    const hasDirty = tabs.some(t => isQueryTabDirty(t))
    onDirtyChangeRef.current?.(hasDirty)
  }, [tabs])

  const changeFontSize = useCallback((delta) => {
    setFontSize(prev => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, prev + delta))
      try {
        localStorage.setItem('sp_extractor_query_font_size', String(next))
      } catch { /* ignore */ }
      return next
    })
  }, [])

  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_FONT_SIZE)
    try {
      localStorage.setItem('sp_extractor_query_font_size', String(DEFAULT_FONT_SIZE))
    } catch { /* ignore */ }
  }, [])

  // Ctrl + MouseWheel zooms text across QueryWorkspace
  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return

    let timeoutId = null

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return

      // Prevent browser-level full-window zoom in WebView2
      e.preventDefault()
      e.stopPropagation()

      // Reset accumulated delta if scrolling direction reverses
      if ((deltaRef.current > 0 && e.deltaY < 0) || (deltaRef.current < 0 && e.deltaY > 0)) {
        deltaRef.current = 0
      }

      deltaRef.current += e.deltaY

      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        deltaRef.current = 0
      }, 250)

      const THRESHOLD = 60
      if (Math.abs(deltaRef.current) >= THRESHOLD) {
        const steps = Math.trunc(deltaRef.current / THRESHOLD)
        deltaRef.current -= steps * THRESHOLD
        // deltaY < 0 is wheel up (zoom in, +steps)
        // deltaY > 0 is wheel down (zoom out, -steps)
        changeFontSize(-steps)
      }
    }

    el.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel, { capture: true })
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [changeFontSize])

  // Keyboard zoom shortcuts (Ctrl +, Ctrl -, Ctrl 0) when QueryWorkspace is active
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault()
        changeFontSize(1)
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        changeFontSize(-1)
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        resetFontSize()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, changeFontSize, resetFontSize])

  const handleSaveAutocompletes = async (newList) => {
    setAutocompletes(newList)
    await saveStoredAutocompletes(newList)
  }

  // Load autocompletes from persistent disk storage (~/.spextractor/autocompletes.json)
  // and keep synced across all open workspaces.
  useEffect(() => {
    let mounted = true
    loadStoredAutocompletes().then(loaded => {
      if (mounted && loaded && Array.isArray(loaded)) {
        setAutocompletes(loaded)
      }
    }).catch(() => {})

    const handleUpdate = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        setAutocompletes(e.detail)
      }
    }
    window.addEventListener('spextractor:autocompletes-updated', handleUpdate)
    const handleSettingsUpdated = (e) => {
      if (e.detail) {
        if (e.detail.editorFontSize) {
          setFontSize(e.detail.editorFontSize)
        }
        if (e.detail.defaultRowLimit !== undefined) {
          setMaxRows(e.detail.defaultRowLimit)
        }
      }
    }
    window.addEventListener('spextractor:settings-updated', handleSettingsUpdated)
    return () => {
      mounted = false
      window.removeEventListener('spextractor:autocompletes-updated', handleUpdate)
      window.removeEventListener('spextractor:settings-updated', handleSettingsUpdated)
    }
  }, [])

  // Table/column names for autocompletion: loaded once per connection, the first
  // time the Consultas view is actually shown (not when the app starts).
  useEffect(() => {
    if (!visible || schemaLoaded.current) return
    schemaLoaded.current = true
    ;(async () => {
      try {
        const api = await go()
        const cols = await api.ListObjects(workspaceId, 'COLUMN', '', 0)
        setSchema(buildSchema(cols || []))
      } catch { /* autocompletion just stays keyword-only */ }
    })()
  }, [visible])

  // SQL pushed from elsewhere in the app (e.g. generated scripts) opens in a new tab.
  useEffect(() => {
    if (!incomingSql || incomingSql.nonce === lastNonce.current) return
    lastNonce.current = incomingSql.nonce
    const t = createTab({
      sql: incomingSql.text,
      savedSql: '',
      ...(incomingSql.title ? { title: incomingSql.title } : {}),
    })
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
  }, [incomingSql, createTab])

  // Tabs are kept per workspace database: restore the ones saved last time.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const st = await (await go()).LoadQueryState(workspaceId)
        if (cancelled) return
        if (st?.tabs?.length) {
          const restored = st.tabs.map(t => makeTab(1, {
            id: t.id,
            title: t.title || 'Consulta',
            sql: t.sql || '',
            lastSql: t.sql || '',
            savedPath: t.savedPath || t.SavedPath || null,
            savedSql: t.sql || ''
          }))
          restored.forEach(t => {
            const n = /^Consulta (\d+)$/.exec(t.title)
            if (n) tabSeqRef.current = Math.max(tabSeqRef.current, Number(n[1]))
          })
          setTabs(restored)
          setActiveId(restored.some(t => t.id === st.activeId) ? st.activeId : restored[0].id)
          lastSaved.current = JSON.stringify({
            tabs: st.tabs.map(t => ({ id: t.id, title: t.title, sql: t.sql, savedPath: t.savedPath || t.SavedPath || '' })),
            activeId: st.activeId,
            closed: st.closed || []
          })
        }
        setClosedTabs((st?.closed || []).map(c => ({
          ...c,
          savedPath: c.savedPath || c.SavedPath || ''
        })))
      } catch { /* start with an empty tab */ }
      if (!cancelled) setStateLoaded(true)
    })()
    return () => { cancelled = true }
  }, [workspaceId])

  // Autosave (debounced) whenever tabs or closed tabs change.
  const pendingSave = useRef(null)
  const flushSave = useCallback(async () => {
    const payload = pendingSave.current
    if (!payload) return
    pendingSave.current = null
    const sig = JSON.stringify(payload)
    if (sig === lastSaved.current) return
    lastSaved.current = sig
    try { await (await go()).SaveQueryState(workspaceId, { ...payload, updatedAt: 0 }) } catch { /* not critical */ }
  }, [workspaceId])

  useEffect(() => {
    if (!stateLoaded) return
    pendingSave.current = {
      tabs: tabs.map(t => ({ id: t.id, title: t.title, sql: t.sql, savedPath: t.savedPath || '' })),
      activeId,
      closed: closedTabs,
    }
    const id = setTimeout(flushSave, 800)
    return () => clearTimeout(id)
  }, [stateLoaded, tabs, activeId, closedTabs, flushSave])

  // Do not lose the last keystrokes when the window closes or the view is replaced.
  useEffect(() => {
    window.addEventListener('beforeunload', flushSave)
    return () => {
      window.removeEventListener('beforeunload', flushSave)
      flushSave()
    }
  }, [flushSave])

  const active = tabs.find(t => t.id === activeId) || tabs[0]

  const patchTab = useCallback((id, patch) => {
    setTabs(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const addTab = () => {
    const t = createTab()
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
  }

  const doCloseTab = useCallback((id) => {
    const idx = tabs.findIndex(t => t.id === id)
    if (idx < 0) return
    const closing = tabs[idx]
    // Keep what was written so it can be reopened later.
    if (closing.sql.trim()) {
      setClosedTabs(prev => [
        { id: closing.id, title: closing.title, sql: closing.sql, savedPath: closing.savedPath || '', closedAt: Date.now() },
        ...prev.filter(c => c.id !== closing.id),
      ].slice(0, 50))
    }
    if (tabs.length === 1) {
      tabSeqRef.current = 1
      const fresh = makeTab(1)
      setTabs([fresh])
      setActiveId(fresh.id)
      return
    }
    const next = tabs.filter(t => t.id !== id)
    if (id === activeId) setActiveId(next[Math.max(0, idx - 1)].id)
    setTabs(next)
  }, [tabs, activeId])

  const [tabToClose, setTabToClose] = useState(null)

  const requestCloseTab = useCallback((id) => {
    const tab = tabs.find(t => t.id === id)
    if (!tab) return
    const currentTab = (tab.id === activeId && editorRef.current)
      ? { ...tab, sql: editorRef.current.state.doc.toString() }
      : tab
    if (isQueryTabDirty(currentTab)) {
      setTabToClose(currentTab)
    } else {
      doCloseTab(id)
    }
  }, [tabs, activeId, doCloseTab])

  const handleConfirmSaveAndClose = async () => {
    if (!tabToClose) return
    const current = tabsRef.current?.find(t => t.id === tabToClose.id) || tabToClose
    const saved = await handleSave(current)
    if (saved) {
      const idToClose = tabToClose.id
      setTabToClose(null)
      doCloseTab(idToClose)
    }
  }

  const handleConfirmDiscardAndClose = () => {
    if (!tabToClose) return
    const idToClose = tabToClose.id
    setTabToClose(null)
    doCloseTab(idToClose)
  }

  useEffect(() => {
    if (!tabToClose) return
    const handleKey = (e) => {
      if (e.key === 'Escape') setTabToClose(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tabToClose])

  const reopenClosed = (c) => {
    const t = createTab({ title: c.title, sql: c.sql, savedPath: c.savedPath || null, savedSql: c.sql })
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
    setClosedTabs(prev => prev.filter(x => x.id !== c.id))
    setShowClosed(false)
  }

  // Runs the selected text when there is a selection, otherwise the whole editor.
  const runQuery = useCallback(async (tab, selection) => {
    if (!tab || tab.running) return
    const text = (selection ?? tab.sql)
    if (!text.trim()) return
    setShowResults(true)
    patchTab(tab.id, { running: true, error: '', result: null, lastSql: text })
    try {
      const api = await go()
      // A query with its own TOP/LIMIT/FETCH is left alone; everything else gets the cap.
      const cap = EXPLICIT_LIMIT.test(text) ? 0 : maxRows
      const result = await api.ExecuteQuery(workspaceId, text, cap)
      patchTab(tab.id, { result, running: false })
    } catch (e) {
      patchTab(tab.id, { error: e.toString(), running: false })
    }
  }, [workspaceId, patchTab, maxRows])

  const currentSelection = () => {
    const view = editorRef.current
    if (!view) return null
    const { from, to } = view.state.selection.main
    return from === to ? null : view.state.sliceDoc(from, to)
  }

  const cancelQuery = async (tab) => {
    try {
      const api = await go()
      await api.CancelQuery(workspaceId)
    } catch { /* ignore */ }
  }

  const clearEditor = (tab) => {
    const view = editorRef.current
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
    patchTab(tab.id, { sql: '', lastSql: '', result: null, error: '' })
  }

  // Opens an existing .sql file from disk and loads it into a new tab
  const handleOpenSqlFile = useCallback(async () => {
    try {
      const api = await go()
      const res = await api.OpenSqlFile()
      if (!res || !res.path) return
      const t = createTab({
        title: res.name || 'Consulta',
        sql: res.content || '',
        lastSql: res.content || '',
        savedPath: res.path,
        savedSql: res.content || '',
      })
      setTabs(prev => [...prev, t])
      setActiveId(t.id)
      setCopyToast(`Abierto: ${res.name}.sql`)
      setTimeout(() => setCopyToast(''), 2500)
    } catch (e) {
      console.error('Error opening SQL file:', e)
    }
  }, [createTab])

  const handleOpenSqlFileRef = useRef(handleOpenSqlFile)
  handleOpenSqlFileRef.current = handleOpenSqlFile

  // "Guardar como…" — always opens the native save dialog
  const handleSaveAs = useCallback(async (tab, customSql) => {
    if (!tab) return false
    const currentTab = tabsRef.current?.find(t => t.id === tab.id) || tab
    const textToSave = customSql !== undefined
      ? customSql
      : ((currentTab.id === activeRef.current?.id && editorRef.current)
        ? editorRef.current.state.doc.toString()
        : currentTab.sql)
    if (!textToSave.trim()) return false
    try {
      const api = await go()
      const path = await api.SaveScript(currentTab.title + '.sql', textToSave)
      if (path) {
        const name = path.split(/[\\/]/).pop().replace(/\.sql$/i, '')
        patchTab(currentTab.id, { savedPath: path, title: name, sql: textToSave, savedSql: textToSave })
        setCopyToast(`Guardado: ${path.split(/[\\/]/).pop()}`)
        setTimeout(() => setCopyToast(''), 2500)
        // Immediately persist state to database store so savedPath is never lost
        try {
          const nextTabs = (tabsRef.current || []).map(t =>
            t.id === currentTab.id
              ? { id: t.id, title: name, sql: textToSave, savedPath: path }
              : { id: t.id, title: t.title, sql: t.sql, savedPath: t.savedPath || '' }
          )
          await api.SaveQueryState(workspaceId, { tabs: nextTabs, activeId, closed: closedTabs, updatedAt: 0 })
          lastSaved.current = JSON.stringify({ tabs: nextTabs, activeId, closed: closedTabs })
        } catch { /* ignore */ }
        return true
      }
      return false
    } catch (e) {
      console.error('SaveAs error:', e)
      return false
    }
  }, [workspaceId, activeId, closedTabs, patchTab])

  // "Guardar" — overwrites existing file silently; opens dialog if new
  const handleSave = useCallback(async (tab) => {
    if (!tab) return false
    const currentTab = tabsRef.current?.find(t => t.id === tab.id) || tab
    const textToSave = (currentTab.id === activeRef.current?.id && editorRef.current)
      ? editorRef.current.state.doc.toString()
      : currentTab.sql
    if (!textToSave.trim()) return false

    if (currentTab.savedPath) {
      try {
        const api = await go()
        await api.WriteFile(currentTab.savedPath, textToSave)
        patchTab(currentTab.id, { sql: textToSave, savedSql: textToSave })
        setCopyToast(`Guardado: ${currentTab.savedPath.split(/[\\/]/).pop()}`)
        setTimeout(() => setCopyToast(''), 2500)
        // Immediately persist state to database store
        try {
          const nextTabs = (tabsRef.current || []).map(t =>
            t.id === currentTab.id
              ? { id: t.id, title: t.title, sql: textToSave, savedPath: currentTab.savedPath }
              : { id: t.id, title: t.title, sql: t.sql, savedPath: t.savedPath || '' }
          )
          await api.SaveQueryState(workspaceId, { tabs: nextTabs, activeId, closed: closedTabs, updatedAt: 0 })
          lastSaved.current = JSON.stringify({ tabs: nextTabs, activeId, closed: closedTabs })
        } catch { /* ignore */ }
        return true
      } catch (e) {
        console.error('Save error:', e)
        return false
      }
    } else {
      return await handleSaveAs(currentTab, textToSave)
    }
  }, [workspaceId, activeId, closedTabs, handleSaveAs, patchTab])

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  const handleSaveAsRef = useRef(handleSaveAs)
  handleSaveAsRef.current = handleSaveAs

    const activeRef = useRef(active)
  activeRef.current = active

  const runQueryRef = useRef(runQuery)
  runQueryRef.current = runQuery

  const addTabRef = useRef(addTab)
  addTabRef.current = addTab

  const toggleResultsRef = useRef(toggleResults)
  toggleResultsRef.current = toggleResults

  const onOpenTableDefinitionRef = useRef(onOpenTableDefinition)
  onOpenTableDefinitionRef.current = onOpenTableDefinition

  const onOpenTableRelationsRef = useRef(onOpenTableRelations)
  onOpenTableRelationsRef.current = onOpenTableRelations

  const onOpenTableScriptsRef = useRef(onOpenTableScripts)
  onOpenTableScriptsRef.current = onOpenTableScripts

  const [copyToast, setCopyToast] = useState('')

  const openQueryInNewTab = useCallback((sqlText, tabTitle, autoRun = false) => {
    const t = createTab({ sql: sqlText, title: tabTitle || 'Consulta', savedSql: '' })
    setTabs(prev => [...prev, t])
    setActiveId(t.id)
    if (autoRun) {
      setTimeout(() => {
        runQueryRef.current?.(t, sqlText)
      }, 60)
    }
  }, [createTab])

  const handleSelectTop100 = useCallback((target) => {
    if (!target) return
    const clean = stripQuotes(target)
    let sqlText = ''
    if (dbType === 'SQL_SERVER') {
      sqlText = `SELECT TOP 100 * FROM ${clean};`
    } else {
      sqlText = `SELECT * FROM ${clean} LIMIT 100;`
    }
    openQueryInNewTab(sqlText, `TOP 100 ${clean}`, true)
  }, [dbType, openQueryInNewTab])

  const handleGenerateScript = useCallback(async (target, scriptId) => {
    if (!target) return
    const clean = stripQuotes(target)
    let schema = ''
    let tableName = clean
    if (clean.includes('.')) {
      const parts = clean.split('.')
      schema = parts[0]
      tableName = parts.slice(1).join('.')
    } else {
      schema = dbType === 'POSTGRESQL' ? 'public' : 'dbo'
    }

    try {
      const api = await go()
      const list = await api.GenerateTableScripts(workspaceId, schema, tableName)
      if (list && list.length > 0) {
        const found = list.find(s => s.id === scriptId) || list[0]
        openQueryInNewTab(found.sql, `${tableName} (${found.label})`, false)
      } else {
        openQueryInNewTab(`-- No se pudieron generar scripts para ${clean}`, clean, false)
      }
    } catch (e) {
      console.error(e)
    }
  }, [workspaceId, dbType, openQueryInNewTab])

  const handleCopyName = useCallback((target) => {
    if (!target) return
    const clean = stripQuotes(target)
    try {
      navigator.clipboard?.writeText(clean)
      setCopyToast(`Copiado: ${clean}`)
      setTimeout(() => setCopyToast(''), 1800)
    } catch { /* ignore */ }
  }, [])

  const getTargetIdentifier = useCallback(() => {
    let text = currentSelection()
    if (!text && editorRef.current) {
      const view = editorRef.current
      const { head } = view.state.selection.main
      text = getIdentifierAtCursor(view.state, head)
    }
    return text ? stripQuotes(text) : ''
  }, [])

  // F5 executes query; Ctrl+N opens a new query tab (prevents WebView2 reload / new window)
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e) => {
      if (e.key === 'F5') {
        const wasHandledByEditor = e.defaultPrevented || editorRef.current?.hasFocus
        e.preventDefault()
        const cur = activeRef.current
        if (!wasHandledByEditor && cur && !cur.running && cur.sql?.trim()) {
          runQueryRef.current?.(cur, currentSelection())
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        addTabRef.current?.()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        handleOpenSqlFileRef.current?.()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        handleSaveRef.current?.(activeRef.current)
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        if (!editorRef.current?.hasFocus) {
          toggleResultsRef.current?.()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        if (!wasHandledByEditor) {
          const target = getTargetIdentifier()
          if (target) handleSelectTop100(target)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        if (!wasHandledByEditor) {
          const target = getTargetIdentifier()
          if (target) onOpenTableRelationsRef.current?.(target)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        if (!wasHandledByEditor) {
          const target = getTargetIdentifier()
          if (target) handleCopyName(target)
        }
      } else if (e.altKey && (e.key === 'F1' || e.code === 'F1')) {
        e.preventDefault()
        if (!wasHandledByEditor) {
          const target = getTargetIdentifier()
          if (target) onOpenTableDefinitionRef.current?.(target)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, getTargetIdentifier, handleSelectTop100, handleCopyName])

  return (
    <div ref={workspaceRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-surface-600 flex-shrink-0 overflow-x-auto"
           style={{ background: 'rgba(11,16,26,0.8)' }}>
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            onContextMenu={(e) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: t.id }) }}
            className={clsx(
              'group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-medium cursor-pointer select-none whitespace-nowrap transition-colors',
              t.id === activeId
                ? 'text-brand-light bg-surface-900 border border-surface-600 border-b-transparent -mb-px'
                : 'text-slate-500 hover:text-slate-300 hover:bg-surface-700/40'
            )}
          >
            <Table2 className="w-3.5 h-3.5" />
            {t.title}
            {isQueryTabDirty(t) && (
              <span className="w-1.5 h-1.5 rounded-full bg-white flex-shrink-0 opacity-80" title="Cambios sin guardar" />
            )}
            {tabs.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); requestCloseTab(t.id) }}
                className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-slate-600"
                title="Cerrar pestaña"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setPlusMenu({ x: e.clientX, y: e.clientY })
          }}
          className="p-1.5 rounded text-slate-500 hover:text-brand-light hover:bg-surface-700/50 mb-0.5"
          title="Nueva pestaña de consulta (Ctrl+N) · Clic derecho para abrir .sql"
        >
          <Plus className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        {connLabel && (
          <span className="text-[10px] text-slate-600 px-2 whitespace-nowrap">Conectado a {connLabel}</span>
        )}
      </div>

      {active && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
            <button
              onClick={() => runQuery(active, currentSelection())}
              disabled={active.running || !active.sql.trim()}
              className="btn-primary text-xs py-1.5 px-3"
              title="Ejecutar (F5). Si hay texto seleccionado, ejecuta solo la selección"
            >
              {active.running
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Play className="w-3.5 h-3.5" />}
              Ejecutar
            </button>
            {active.running && (
              <button onClick={() => cancelQuery(active)} className="btn-danger text-xs py-1.5 px-3">
                <Ban className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}
            <button onClick={() => clearEditor(active)} className="btn-secondary text-xs py-1.5 px-3">
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              title="Historial de consultas ejecutadas en esta base de datos"
            >
              <History className="w-3.5 h-3.5 text-sky-300" />
              Historial
            </button>
            <div className="relative">
              <button
                onClick={() => setShowClosed(v => !v)}
                disabled={closedTabs.length === 0}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                title="Pestañas cerradas recientemente"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Cerradas
                {closedTabs.length > 0 && (
                  <span className="px-1.5 rounded-full text-[10px] bg-sky-400/20 text-sky-300 font-mono font-bold">{closedTabs.length}</span>
                )}
              </button>
              {showClosed && closedTabs.length > 0 && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowClosed(false)} />
                  <div className="absolute left-0 top-full mt-1 z-40 w-80 max-h-80 overflow-auto rounded-xl border border-surface-600 shadow-2xl shadow-black/60 py-1"
                       style={{ background: '#111B2C' }}>
                    {closedTabs.map(c => (
                      <button key={c.id} onClick={() => reopenClosed(c)}
                              className="w-full text-left px-3 py-1.5 hover:bg-surface-700/50 block">
                        <span className="block text-xs text-slate-200 truncate">{c.title}</span>
                        <span className="block text-[10px] font-mono text-slate-500 truncate">{c.sql.replace(/\s+/g, ' ').slice(0, 70)}</span>
                      </button>
                    ))}
                    <button onClick={() => { setClosedTabs([]); setShowClosed(false) }}
                            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-500 hover:text-red-400 border-t border-surface-700/60">
                      Vaciar lista
                    </button>
                  </div>
                </>
              )}
            </div>
            {/* Zoom text control */}
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-surface-800/80 border border-surface-600/70 text-slate-400 select-none"
              title="Zoom de texto: Ctrl + Rueda del ratón o Ctrl +/- (clic para reiniciar a 100%)"
            >
              <button
                onClick={() => changeFontSize(-1)}
                disabled={fontSize <= MIN_FONT_SIZE}
                className="hover:text-white px-1 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Reducir texto (Ctrl - o Ctrl+Rueda abajo)"
              >
                −
              </button>
              <button
                onClick={resetFontSize}
                className="font-mono text-[11px] hover:text-brand-light px-1 transition-colors min-w-[36px] text-center"
                title="Reiniciar tamaño a 100% (12px)"
              >
                {Math.round((fontSize / DEFAULT_FONT_SIZE) * 100)}%
              </button>
              <button
                onClick={() => changeFontSize(1)}
                disabled={fontSize >= MAX_FONT_SIZE}
                className="hover:text-white px-1 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Aumentar texto (Ctrl + o Ctrl+Rueda arriba)"
              >
                +
              </button>
            </div>

            <div className="flex-1" />
            <span className="text-[10px] text-slate-600">F5 ejecuta · selección = solo eso</span>
          </div>

          {/* Editor */}
          <div className={clsx('px-3', showResults ? 'flex-shrink-0' : 'flex-1 overflow-hidden pb-3 min-h-0')}>
            <div
              className={clsx('rounded-lg overflow-hidden', showResults ? 'resize-y' : 'h-full')}
              style={{
                ...(showResults ? { height: 176, minHeight: 80 } : {}),
                border: '1px solid rgba(36,51,80,0.8)',
              }}
            >
              <SqlEditor
                key={active.id}
                value={active.sql}
                onChange={sqlText => patchTab(active.id, { sql: sqlText })}
                dbType={dbType}
                schema={schema}
                autocompletes={autocompletes}
                fontSize={fontSize}
                viewRef={editorRef}
                onSave={() => handleSaveRef.current?.(active)}
                onOpenSql={handleOpenSqlFile}
                onRun={selection => runQuery(active, selection)}
                onAltF1={table => onOpenTableDefinition?.(table)}
                onSelectTop100={handleSelectTop100}
                onOpenRelations={table => onOpenTableRelations?.(table)}
                onOpenScripts={table => onOpenTableScripts?.(table)}
                onGenerateScript={handleGenerateScript}
                onCopyName={handleCopyName}
                onToggleResults={toggleResults}
              />
            </div>
          </div>

          {/* Results */}
          <div className={clsx('flex-1 overflow-hidden px-3 pb-3 pt-1', !showResults && 'hidden')}>
            <ResultArea
              tab={active}
              fontSize={fontSize}
              onInsertScript={set => setInsertTarget({ set, sql: active.lastSql || active.sql })}
              onOpenCell={setViewer}
            />
          </div>
        </>
      )}

      

      {/* INSERT script generator */}
      {insertTarget && (
        <InsertScriptModal
          workspaceId={workspaceId}
          set={insertTarget.set}
          sql={insertTarget.sql}
          dbType={dbType}
          onClose={() => setInsertTarget(null)}
          onOpenInQuery={onOpenInQuery}
        />
      )}

      {/* Query history */}
      {showHistory && (
        <QueryHistoryModal
          workspaceId={workspaceId}
          dbLabel={connLabel || 'esta base de datos'}
          onClose={() => setShowHistory(false)}
          onOpen={(sqlText, autoRun) => {
            setShowHistory(false)
            openQueryInNewTab(sqlText, titleFromSql(sqlText), autoRun)
          }}
        />
      )}

      {/* JSON / XML cell viewer */}
      {viewer && (
        <StructuredViewerModal
          value={viewer.value}
          hint={viewer.hint}
          subtitle={viewer.subtitle}
          onClose={() => setViewer(null)}
        />
      )}

      {/* New tab menu (right-click on + button) */}
      {plusMenu && (
        <NewTabContextMenu
          x={plusMenu.x}
          y={plusMenu.y}
          onClose={() => setPlusMenu(null)}
          onOpenSql={() => { setPlusMenu(null); handleOpenSqlFile() }}
          onNewTab={() => { setPlusMenu(null); addTab() }}
        />
      )}

      {/* Tab context menu (right-click on tab) */}
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          tab={tabs.find(t => t.id === tabMenu.tabId)}
          onClose={() => setTabMenu(null)}
          onSave={(tab) => { setTabMenu(null); handleSaveRef.current?.(tab) }}
          onSaveAs={(tab) => { setTabMenu(null); handleSaveAsRef.current?.(tab) }}
          onCloseTab={(tab) => { setTabMenu(null); requestCloseTab(tab.id) }}
        />
      )}

      {/* Copy Toast feedback */}
      {copyToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#18191a] border border-brand/70 text-white text-xs px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 pointer-events-none transition-all">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{copyToast}</span>
        </div>
      )}

      {/* Confirm close tab with unsaved changes */}
      {tabToClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass rounded-2xl w-[440px] max-w-[95vw] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up border border-surface-600">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-600">
              <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white">¿Guardar cambios?</h2>
                <p className="text-xs text-slate-400 mt-0.5 truncate" title={tabToClose.title}>
                  {tabToClose.title}
                </p>
              </div>
            </div>

            <div className="px-6 py-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                La consulta tiene cambios sin guardar. Si la cierras sin guardar, los cambios se perderán.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-surface-600 bg-surface-900/40">
              <button
                type="button"
                onClick={() => setTabToClose(null)}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscardAndClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-white hover:bg-red-500/20 border border-red-500/30 transition-colors"
              >
                No guardar
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveAndClose}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultArea({ tab, fontSize, onInsertScript, onOpenCell }) {
  if (tab.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm overflow-auto h-full">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <pre className="whitespace-pre-wrap font-mono" style={{ margin: 0, fontSize: `${fontSize}px` }}>{tab.error}</pre>
      </div>
    )
  }

  if (tab.running) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin text-brand-light" />
        <span className="text-sm">Ejecutando consulta…</span>
      </div>
    )
  }

  if (!tab.result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
        <Table2 className="w-8 h-8 opacity-40" />
        <span className="text-xs">Los resultados aparecerán aquí.</span>
      </div>
    )
  }

  const { sets = [], message = '', durationMs = 0 } = tab.result

  return (
    <div className="flex flex-col h-full gap-2 overflow-auto">
      <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
        <span>{message}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{durationMs} ms</span>
      </div>
      {sets.map((set, i) => (
        <ResultGrid key={i} set={set} index={i} total={sets.length} fontSize={fontSize} onInsertScript={onInsertScript} onOpenCell={onOpenCell} />
      ))}
    </div>
  )
}

// A JSON / XML cell shows only its beginning on one line; the whole value opens in the viewer.
const SUMMARY_CHARS = 100
function summarize(value) {
  const oneLine = value.slice(0, SUMMARY_CHARS * 2).replace(/\s+/g, ' ').trim()
  return oneLine.length > SUMMARY_CHARS || value.length > SUMMARY_CHARS * 2 ? `${oneLine.slice(0, SUMMARY_CHARS)}…` : oneLine
}

const cellText = (v) => (v === null || v === undefined ? '' : String(v))
const MIN_GRID_HEIGHT = 80

function ResultGrid({ set, index, total, fontSize, onInsertScript, onOpenCell }) {
  const { columns = [], rows = [], types = [] } = set
  const [height, setHeight] = useState(null) // null = automatic (up to 45% of the window)
  const [sel, setSel] = useState(null) // { r, c } selected cell
  const [menu, setMenu] = useState(null) // { x, y, r, c }
  const boxRef = useRef(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const copy = (text) => { try { navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ } }
  const copyCell = (r, c) => copy(cellText(rows[r]?.[c]))
  const copyRow = (r) => copy(rows[r].map(cellText).join('\t'))
  const copyColumn = (c, withHeader) => copy([...(withHeader ? [columns[c]] : []), ...rows.map(row => cellText(row[c]))].join('\n'))
  const copyAll = () => copy([columns.join('\t'), ...rows.map(row => row.map(cellText).join('\t'))].join('\n'))

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !window.getSelection()?.toString() && sel) {
      e.preventDefault()
      copyCell(sel.r, sel.c)
    }
  }

  // Drag the bottom edge to resize this result set, like Management Studio.
  const startResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = boxRef.current?.getBoundingClientRect().height || 300
    const move = (ev) => setHeight(Math.max(MIN_GRID_HEIGHT, startH + ev.clientY - startY))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-1">
        {total > 1 && (
          <span className="text-[10px] text-slate-500">Resultado {index + 1} · {rows.length} fila(s)</span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onInsertScript?.(set)}
          disabled={rows.length === 0}
          className="btn-secondary text-[11px] py-1 px-2"
          title="Generar un script INSERT con las filas de este resultado"
        >
          <FileCode2 className="w-3 h-3" />
          Script As Insert
        </button>
      </div>
      {set.truncated && (
        <div className="text-[11px] text-amber-400 mb-1">
          Mostrando solo las primeras {rows.length} filas; hay más. Sube el límite o acota la consulta.
        </div>
      )}
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="overflow-auto rounded-t-xl border border-surface-600 outline-none select-text"
        style={height ? { height } : { maxHeight: '45vh' }}
      >
        <table className="border-collapse" style={{ fontSize: `${Math.min(fontSize || 12, 20)}px` }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ background: '#111B2C' }}>
              <th className="px-2 py-1.5 text-right text-slate-600 font-normal border-r border-surface-700/60 w-10">#</th>
              {columns.map((c, i) => (
                <th key={i} className="px-3 py-1.5 text-left font-medium text-slate-300 whitespace-nowrap border-r border-surface-700/60">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="text-center py-6 text-slate-500">
                  Sin filas.
                </td>
              </tr>
            ) : rows.map((row, r) => (
              <tr key={r} className={r % 2 === 0 ? 'hover:bg-surface-700/30' : 'bg-surface-800/30 hover:bg-surface-700/30'}>
                <td className="px-2 py-1 text-right text-slate-600 font-mono border-r border-surface-700/60">{r + 1}</td>
                {row.map((cell, c) => {
                  // JSON / XML values open in a viewer when clicked.
                  const structured = onOpenCell ? detectType(cell, types[c]) : null
                  return (
                    <td
                      key={c}
                      className={`px-3 py-1 font-mono whitespace-nowrap border-r border-surface-700/60 align-top ${
                        sel && sel.r === r && sel.c === c ? 'outline outline-1 -outline-offset-1 outline-brand-light bg-brand-dark/30 ' : ''}${
                        structured ? 'max-w-[320px] overflow-hidden text-ellipsis text-sky-300 cursor-pointer hover:bg-sky-500/10 underline decoration-dotted underline-offset-2' : 'text-slate-200'}`}
                      title={structured ? `Clic para ver como ${structured.toUpperCase()}` : undefined}
                      onClick={() => {
                        setSel({ r, c })
                        if (!structured) return
                        if (window.getSelection()?.toString()) return // the user is selecting text, not opening
                        onOpenCell({ value: cell, hint: structured, subtitle: `${columns[c]} · fila ${r + 1}` })
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSel({ r, c })
                        setMenu({ x: e.clientX, y: e.clientY, r, c })
                      }}
                    >
                      {cell === null
                        ? <span className="text-slate-600 italic">NULL</span>
                        : cell === ''
                        ? <span className="text-slate-600">(vacío)</span>
                        : structured
                        ? summarize(cell)
                        : cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setHeight(null)}
        className="h-2 flex-shrink-0 cursor-row-resize rounded-b-xl border border-t-0 border-surface-600 bg-surface-800/60 hover:bg-brand-dark/50 transition-colors"
        title="Arrastra para cambiar el alto · doble clic para restablecer"
      />
      {menu && (
        <div
          className="fixed z-50 min-w-[190px] rounded-lg border border-surface-600/90 py-1 text-xs shadow-2xl select-none"
          style={{ top: menu.y, left: menu.x, background: '#18191a' }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {[
            ['Copiar celda', () => copyCell(menu.r, menu.c)],
            ['Copiar fila', () => copyRow(menu.r)],
            ['Copiar columna', () => copyColumn(menu.c, false)],
            ['Copiar columna con encabezado', () => copyColumn(menu.c, true)],
            ['Copiar todo con encabezados', copyAll],
          ].map(([label, fn]) => (
            <button
              key={label}
              type="button"
              onClick={() => { fn(); setMenu(null) }}
              className="w-full px-3 py-1.5 text-left text-slate-200 hover:text-white hover:bg-brand-dark/40"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
