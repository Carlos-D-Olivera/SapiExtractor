import { Prec } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import {
  search, SearchQuery, setSearchQuery, getSearchQuery,
  findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel,
} from '@codemirror/search'

// Search / replace bar shared by the query editor and the read-only definition viewer.
// Colours come from the editor theme (via currentColor) and the app theme (CSS variables),
// so it follows both settings.

const MAX_COUNT = 5000 // matches counted before showing "5000+"

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') el.className = v
    else if (v !== undefined && v !== null) el.setAttribute(k, v)
  })
  kids.forEach(k => el.append(k))
  return el
}

function createPanel(view) {
  let query = getSearchQuery(view.state)
  const readOnly = view.state.readOnly

  const findInput = h('input', {
    class: 'cm-sx-input', placeholder: 'Buscar', 'aria-label': 'Buscar', spellcheck: 'false',
    autocomplete: 'off', 'main-field': 'true',
  })
  findInput.value = query.search
  const replaceInput = h('input', {
    class: 'cm-sx-input', placeholder: 'Reemplazar', 'aria-label': 'Reemplazar', spellcheck: 'false', autocomplete: 'off',
  })
  replaceInput.value = query.replace

  const count = h('span', { class: 'cm-sx-count' })

  const toggle = (label, title, on) => {
    const b = h('button', { type: 'button', class: 'cm-sx-btn cm-sx-toggle', title, 'aria-label': title, 'aria-pressed': String(on) }, label)
    b.classList.toggle('on', on)
    b.dataset.on = on ? '1' : '0'
    b.addEventListener('click', () => {
      const next = b.dataset.on !== '1'
      b.dataset.on = next ? '1' : '0'
      b.classList.toggle('on', next)
      b.setAttribute('aria-pressed', String(next))
      commit(true)
      findInput.focus()
    })
    return b
  }
  const caseBtn = toggle('Aa', 'Coincidir mayúsculas y minúsculas', query.caseSensitive)
  const wordBtn = toggle('ab', 'Palabra completa', query.wholeWord)
  const regexBtn = toggle('.*', 'Expresión regular', query.regexp)
  const isOn = (b) => b.dataset.on === '1'
  const setOn = (b, on) => { b.dataset.on = on ? '1' : '0'; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }

  const action = (label, title, fn, cls = '') => {
    const b = h('button', { type: 'button', class: `cm-sx-btn ${cls}`, title, 'aria-label': title }, label)
    b.addEventListener('click', () => { fn(); })
    return b
  }

  function buildQuery() {
    return new SearchQuery({
      search: findInput.value,
      caseSensitive: isOn(caseBtn),
      regexp: isOn(regexBtn),
      wholeWord: isOn(wordBtn),
      replace: replaceInput.value,
    })
  }

  // From the cursor, selects the first match (wrapping around) so typing already "goes to" the word.
  function jumpToFirst(q) {
    if (!q.valid) return
    const { from } = view.state.selection.main
    let m = q.getCursor(view.state, from).next()
    if (m.done) m = q.getCursor(view.state).next()
    if (m.done) return
    view.dispatch({
      selection: { anchor: m.value.from, head: m.value.to },
      effects: EditorView.scrollIntoView(m.value.from, { y: 'center' }),
      userEvent: 'select.search',
    })
  }

  function commit(jump) {
    const q = buildQuery()
    if (!q.eq(query)) {
      query = q
      view.dispatch({ effects: setSearchQuery.of(q) })
    }
    if (jump) jumpToFirst(q)
    updateCount()
  }

  function updateCount() {
    const q = getSearchQuery(view.state)
    count.classList.remove('none')
    if (!q.search) { count.textContent = ''; return }
    if (!q.valid) { count.textContent = 'Expresión inválida'; count.classList.add('none'); return }
    const sel = view.state.selection.main
    const cur = q.getCursor(view.state)
    let n = 0
    let idx = 0
    for (let m = cur.next(); !m.done; m = cur.next()) {
      n++
      if (!idx && m.value.from === sel.from && m.value.to === sel.to) idx = n
      if (n >= MAX_COUNT) break
    }
    if (n === 0) { count.textContent = 'Sin resultados'; count.classList.add('none'); return }
    count.textContent = `${idx ? `${idx} de ` : ''}${n}${n >= MAX_COUNT ? '+' : ''}`
  }

  findInput.addEventListener('input', () => commit(true))
  replaceInput.addEventListener('input', () => commit(false))

  const closeBtn = action('✕', 'Cerrar (Esc)', () => { closeSearchPanel(view); view.focus() }, 'cm-sx-close')
  const row1 = h('div', { class: 'cm-sx-row' },
    findInput, count,
    action('↑', 'Anterior (Shift+Enter)', () => { commit(false); findPrevious(view) }),
    action('↓', 'Siguiente (Enter)', () => { commit(false); findNext(view) }),
    caseBtn, wordBtn, regexBtn,
    h('span', { class: 'cm-sx-grow' }),
    closeBtn,
  )
  const dom = h('div', { class: 'cm-sx' }, row1)

  if (!readOnly) {
    dom.append(h('div', { class: 'cm-sx-row' },
      replaceInput,
      action('Reemplazar', 'Reemplazar la coincidencia actual', () => { commit(false); replaceNext(view) }, 'cm-sx-text'),
      action('Todo', 'Reemplazar todas las coincidencias', () => { commit(false); replaceAll(view) }, 'cm-sx-text'),
    ))
  }

  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === findInput) {
      e.preventDefault()
      commit(false)
      ;(e.shiftKey ? findPrevious : findNext)(view)
      return
    }
    if (runScopeHandlers(view, e, 'search-panel')) { e.preventDefault(); return }
    if (e.key === 'Enter' && e.target === replaceInput) { e.preventDefault(); commit(false); replaceNext(view) }
  })

  return {
    dom,
    top: true,
    mount() { findInput.select() },
    update(u) {
      let queryChanged = false
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(setSearchQuery) && !e.value.eq(query)) {
            query = e.value
            queryChanged = true
            findInput.value = query.search
            replaceInput.value = query.replace
            setOn(caseBtn, query.caseSensitive)
            setOn(wordBtn, query.wholeWord)
            setOn(regexBtn, query.regexp)
          }
        }
      }
      if (queryChanged || u.docChanged || u.selectionSet) updateCount()
    },
  }
}

const panelTheme = Prec.high(EditorView.theme({
  '.cm-panels': { zIndex: '20' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid rgba(128, 128, 128, 0.25)' },
  '.cm-sx': { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', fontSize: '12px', fontFamily: 'inherit' },
  '.cm-sx-row': { display: 'flex', alignItems: 'center', gap: '4px' },
  '.cm-sx-grow': { flex: '1' },
  '.cm-sx-input': {
    width: '240px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128, 128, 128, 0.35)',
    background: 'color-mix(in srgb, currentColor 7%, transparent)',
    color: 'inherit',
    outline: 'none',
    fontSize: '12px',
  },
  '.cm-sx-input:focus': {
    borderColor: 'rgb(var(--brand-accent, 0 119 182))',
    boxShadow: '0 0 0 1px rgb(var(--brand-accent, 0 119 182) / 0.6)',
  },
  '.cm-sx-count': { minWidth: '72px', padding: '0 6px', fontSize: '11px', opacity: '0.7', whiteSpace: 'nowrap' },
  '.cm-sx-count.none': { color: '#f87171', opacity: '1' },
  '.cm-sx-btn': {
    minWidth: '26px',
    height: '26px',
    padding: '0 6px',
    border: '1px solid transparent',
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '12px',
    opacity: '0.8',
  },
  '.cm-sx-btn:hover': { background: 'color-mix(in srgb, currentColor 14%, transparent)', opacity: '1' },
  '.cm-sx-toggle.on': {
    background: 'rgb(var(--brand-accent, 0 119 182) / 0.35)',
    borderColor: 'rgb(var(--brand-accent, 0 119 182) / 0.8)',
    color: 'var(--brand-light, #C2E7FF)',
    opacity: '1',
  },
  '.cm-sx-text': { border: '1px solid rgba(128, 128, 128, 0.35)', padding: '0 10px' },
  // While searching, the "same word as the selection" highlight would mix its colour with the matches.
  '&:has(.cm-sx) .cm-selectionMatch': { backgroundColor: 'transparent' },
  // Matches in the document: all of them, and the current one stronger.
  '.cm-searchMatch': {
    backgroundColor: 'rgba(250, 204, 21, 0.28)',
    outline: '1px solid rgba(250, 204, 21, 0.55)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(249, 115, 22, 0.55)',
    outline: '1px solid rgb(249, 115, 22)',
  },
}))

// Extension to add to an editor (its keymap must include searchKeymap).
export const editorSearch = [search({ top: true, createPanel }), panelTheme]
