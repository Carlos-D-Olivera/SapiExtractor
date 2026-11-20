import { Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, runScopeHandlers } from '@codemirror/view'
import { search, searchKeymap, SearchQuery, getSearchQuery, setSearchQuery, searchPanelOpen, findNext, findPrevious, closeSearchPanel, replaceNext, replaceAll } from '@codemirror/search'

export function* iterSearchMatches(state, query) {
  if (!query.valid) return
  for (const { from, to } of query.getCursor(state)) yield { from, to }
}

export function selectedMatchIndex(matches, selection) {
  let lo = 0, hi = matches.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (matches[mid].from < selection.from) lo = mid + 1
    else hi = mid
  }
  return matches[lo]?.from === selection.from && matches[lo]?.to === selection.to ? lo : -1
}

const publishMatches = StateEffect.define()
const requestSearchJump = StateEffect.define()
const emptyMatches = { matches: [], currentIndex: -1, pending: false }
export const searchMatchState = StateField.define({
  create: () => emptyMatches,
  update(value, tr) {
    if (!searchPanelOpen(tr.state)) return emptyMatches
    const query = getSearchQuery(tr.state)
    if (tr.docChanged || !query.eq(getSearchQuery(tr.startState)) || !searchPanelOpen(tr.startState)) {
      value = { ...emptyMatches, pending: query.valid }
    }
    for (const effect of tr.effects) if (effect.is(publishMatches) && effect.value.doc === tr.state.doc) {
      value = { matches: effect.value.matches, pending: false, currentIndex: -1 }
    }
    const currentIndex = selectedMatchIndex(value.matches, tr.state.selection.main)
    return currentIndex === value.currentIndex ? value : { ...value, currentIndex }
  },
})

const matchIndexer = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.generation = 0; this.schedule() }
  update(update) {
    for (const tr of update.transactions) for (const effect of tr.effects) {
      if (effect.is(requestSearchJump)) this.jumpRequest = effect.value
    }
    if (update.docChanged || !getSearchQuery(update.state).eq(getSearchQuery(update.startState)) || searchPanelOpen(update.state) !== searchPanelOpen(update.startState)) this.schedule()
    else if (this.jumpRequest && !update.state.field(searchMatchState).pending) {
      clearTimeout(this.jumpTimer)
      this.jumpTimer = setTimeout(() => {
        if (this.view.isDestroyed) return
        const range = this.takeJump(this.view.state.field(searchMatchState).matches)
        if (range) this.view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'center' }), userEvent: 'select.search' })
      }, 0)
    }
  }
  takeJump(matches) {
    const request = this.jumpRequest
    this.jumpRequest = null
    if (!request || request.doc !== this.view.state.doc || !request.query.eq(getSearchQuery(this.view.state)) || !request.selection.eq(this.view.state.selection)) return null
    return matches.find(match => match.from >= request.selection.main.from) || matches[0] || null
  }
  schedule() {
    clearTimeout(this.timer)
    clearTimeout(this.jumpTimer)
    this.worker?.terminate(); this.worker = null
    const generation = ++this.generation
    const state = this.view.state, query = getSearchQuery(state)
    if (!searchPanelOpen(state) || !query.valid) return
    this.timer = setTimeout(() => {
      // A cursor can scan the whole document before returning a single absent/rare
      // match. Run the native CodeMirror query in a disposable worker, not the UI.
      this.worker = new Worker(new URL('./editorSearch.worker.js', import.meta.url), { type: 'module' })
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation || data.generation !== generation || this.view.isDestroyed || state.doc !== this.view.state.doc) return
        const range = this.takeJump(data.matches)
        const effects = [publishMatches.of({ doc: state.doc, matches: data.matches })]
        if (range) effects.push(EditorView.scrollIntoView(range.from, { y: 'center' }))
        this.view.dispatch({ effects, ...(range ? { selection: { anchor: range.from, head: range.to }, userEvent: 'select.search' } : {}) })
        this.worker?.terminate(); this.worker = null
      }
      this.worker.onerror = event => { console.error('No se pudo indexar la búsqueda', event.message); this.worker?.terminate(); this.worker = null }
      this.worker.postMessage({ generation, doc: state.doc.toString(), wordChars: state.languageDataAt('wordChars', state.selection.main.head), query: { search: query.search, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regexp: query.regexp, literal: query.literal } })
    }, 50)
  }
  destroy() { this.generation++; clearTimeout(this.timer); clearTimeout(this.jumpTimer); this.worker?.terminate() }
})

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

  const count = h('span', { class: 'cm-sx-count', role: 'status', 'aria-label': 'Coincidencias' })

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

  // Select the first result after the worker finishes; never scan the SQL on input.
  function commit(jump) {
    const q = buildQuery()
    const effects = []
    if (!q.eq(getSearchQuery(view.state))) effects.push(setSearchQuery.of(q))
    if (jump && q.valid) effects.push(requestSearchJump.of({ query: q, doc: view.state.doc, selection: view.state.selection }))
    if (effects.length) view.dispatch({ effects })
    query = q
    updateCount()
  }

  function updateCount() {
    const q = getSearchQuery(view.state)
    const { matches, currentIndex, pending } = view.state.field(searchMatchState)
    count.classList.remove('none')
    findInput.setAttribute('aria-invalid', String(!!q.search && !q.valid))
    if (!q.search) { count.textContent = ''; return }
    if (!q.valid) { count.textContent = 'Expresión inválida'; count.classList.add('none'); return }
    if (pending) { count.textContent = 'Buscando…'; return }
    if (!matches.length) { count.textContent = 'Sin resultados'; count.classList.add('none'); return }
    count.textContent = (currentIndex >= 0 ? (currentIndex + 1) + ' de ' : '') + matches.length
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
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearchPanel(view); view.focus(); return }
    if (runScopeHandlers(view, e, 'search-panel')) { e.preventDefault(); return }
    if (e.key === 'Enter' && e.target === replaceInput) { e.preventDefault(); commit(false); replaceNext(view) }
  })

  updateCount()

  return {
    dom,
    top: true,
    mount() { findInput.select() },
    update(u) {
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(setSearchQuery) && !e.value.eq(query)) {
            query = e.value
            findInput.value = query.search
            replaceInput.value = query.replace
            setOn(caseBtn, query.caseSensitive)
            setOn(wordBtn, query.wholeWord)
            setOn(regexBtn, query.regexp)
          }
        }
      }
      updateCount()
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
  '&:has(.cm-sx) .cm-selectionMatch': { backgroundColor: 'transparent !important' },
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

export function createEditorSearch() {
  return [search({ top: true, createPanel }), searchMatchState, matchIndexer, keymap.of(searchKeymap), panelTheme]
}
