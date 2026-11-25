import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
})
after(() => server.close())
const { ResultArea } = await server.ssrLoadModule('/src/components/QueryWorkspace.jsx')
const { default: BookmarkToolbar } = await server.ssrLoadModule('/src/components/BookmarkToolbar.jsx')

test('shows bookmark controls only for procedure scripts', () => {
  const render = sql => renderToStaticMarkup(createElement(BookmarkToolbar, {
    sql, positions: [0], viewRef: { current: null },
  }))
  assert.equal(render('SELECT 1'), '')
  const html = render('ALTER PROC dbo.p AS SELECT 1')
  for (const label of [
    'Agregar marcador en la línea del cursor',
    'Quitar marcador de la línea del cursor',
    'Marcador anterior',
    'Marcador siguiente',
  ]) assert.ok(html.includes(label), label)
})

function renderResult(result, activeResultTab = 'results', error = '') {
  return renderToStaticMarkup(createElement(ResultArea, {
    tab: { result, activeResultTab, error, running: false },
    fontSize: 12,
  }))
}

test('renders SELECT results when Go serializes absent PRINT messages as null', () => {
  const html = renderResult({
    sets: [{ columns: ['value'], types: ['INT'], rows: [['42']], truncated: false }],
    messages: null,
    message: '1 conjunto(s) de resultados, 1 fila(s).',
    durationMs: 1,
    rowCount: 1,
  })
  assert.match(html, /value/)
  assert.match(html, />42<\/td>/)
})

test('renders a command summary without PRINT messages', () => {
  const html = renderResult({
    sets: [], messages: null, message: '3 fila(s) afectada(s).', durationMs: 1, rowCount: 0,
  }, 'messages')
  assert.match(html, /3 fila\(s\) afectada\(s\)\./)
})

test('keeps PRINT output visible', () => {
  const html = renderResult({
    sets: [],
    messages: [{ kind: 'info', text: 'Proceso completado', number: 0, line: 1, proc: '' }],
    message: 'Comando ejecutado correctamente.', durationMs: 1, rowCount: 0,
  }, 'messages')
  assert.match(html, /Proceso completado/)
})

test('renders SQL execution errors without a response', () => {
  assert.match(renderResult(null, 'messages', 'Invalid object name'), /Invalid object name/)
})
