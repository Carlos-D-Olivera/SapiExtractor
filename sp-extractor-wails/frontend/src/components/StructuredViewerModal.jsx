import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  X, Braces, FileCode2, ChevronRight, ChevronDown, Copy, Check, Search, ChevronsDownUp, ChevronsUpDown, AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'
import {
  parseStructured, toTree, countNodes, prettyText, minifyJson, highlight, sniff,
} from '../utils/structured'

const PAGE = 100 // children rendered per node before "show more"
const HIGHLIGHT_LIMIT = 500_000 // characters; larger texts are shown without colours

const KIND_STYLE = {
  string: 'text-emerald-300',
  number: 'text-amber-300',
  boolean: 'text-fuchsia-300',
  null: 'text-slate-500 italic',
  leaf: 'text-emerald-300',
  attr: 'text-emerald-300',
  text: 'text-emerald-300',
  cdata: 'text-emerald-300',
  comment: 'text-slate-500 italic',
  pi: 'text-slate-400',
}

const KIND_LABEL = {
  object: 'objeto', array: 'arreglo', string: 'texto', number: 'número', boolean: 'booleano', null: 'null',
  element: 'elemento', leaf: 'elemento', attr: 'atributo', text: 'texto', cdata: 'CDATA', comment: 'comentario', pi: 'instrucción',
}

const isContainer = (n) => n.children !== null && n.children !== undefined

// Plain JS value of a JSON subtree (for "copy value").
function toJs(n) {
  switch (n.kind) {
    case 'object': return Object.fromEntries(n.children.map(c => [c.key, toJs(c)]))
    case 'array': return n.children.map(toJs)
    default: return n.value
  }
}

const valueText = (n) => (n.value === null || n.value === undefined ? 'null' : String(n.value))

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  })
}

export default function StructuredViewerModal({ value, hint, title, subtitle, onClose }) {
  const parsed = useMemo(() => parseStructured(value, hint), [value, hint])
  const failed = !!parsed.error
  const tree = useMemo(() => (failed ? null : toTree(parsed)), [parsed, failed])
  const pretty = useMemo(() => (failed ? '' : prettyText(parsed)), [parsed, failed])
  const nodeCount = useMemo(() => (tree ? countNodes(tree) : 0), [tree])
  const type = parsed.type || hint || 'json'

  const [tab, setTab] = useState(failed ? 'raw' : 'tree')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState('')
  const [expanded, setExpanded] = useState(() => initialExpanded(tree))

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const flash = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 1400)
  }, [])

  const copy = useCallback(async (text, msg) => {
    await copyText(text)
    flash(msg)
  }, [flash])

  // Search: which nodes match, which must stay visible, and which ancestors open.
  const search = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !tree) return null
    const hits = new Set()
    const visible = new Set()
    const open = new Set()
    const walk = (n) => {
      const own = (n.key !== null && n.key !== undefined && String(n.key).toLowerCase().includes(q))
        || (n.value !== null && n.value !== undefined && String(n.value).toLowerCase().includes(q))
      let below = false
      ;(n.children || []).forEach(c => { if (walk(c)) below = true })
      if (own) hits.add(n.id)
      if (own || below) visible.add(n.id)
      if (below) open.add(n.id)
      return own || below
    }
    walk(tree)
    return { hits, visible, open }
  }, [query, tree])

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const expandAll = () => {
    const all = new Set()
    const walk = (n) => { if (isContainer(n)) { all.add(n.id); n.children.forEach(walk) } }
    walk(tree)
    setExpanded(all)
  }
  const collapseAll = () => setExpanded(new Set(tree ? [tree.id] : []))

  const highlighted = useMemo(
    () => (pretty && pretty.length <= HIGHLIGHT_LIMIT ? highlight(pretty, type) : null),
    [pretty, type],
  )

  const Icon = type === 'json' ? Braces : FileCode2
  const tabs = failed ? [['raw', 'Original']] : [['tree', 'Árbol'], ['pretty', 'Formateado'], ['raw', 'Original']]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass rounded-2xl w-[1000px] max-w-[95vw] h-[86vh] overflow-hidden shadow-2xl shadow-black/60 animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-surface-600 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-brand-dark/40 border border-brand-dark/50">
              <Icon className="w-4 h-4 text-brand-light" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">
                {title || (type === 'json' ? 'Visor JSON' : 'Visor XML')}
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-brand-dark/60 text-brand-light uppercase">{type}</span>
                {parsed.fragment && <span className="ml-1.5 text-[10px] text-amber-300">fragmento (varias raíces)</span>}
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {subtitle ? `${subtitle} · ` : ''}{value.length.toLocaleString()} caracteres{tree ? ` · ${nodeCount.toLocaleString()} nodos` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-600 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-700/60 flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-1">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                      className={clsx('px-3 py-1 rounded-md text-xs font-medium transition-all',
                        tab === id ? 'bg-brand-dark/60 text-white' : 'text-slate-400 hover:text-slate-200 bg-white/5')}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'tree' && (
            <>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input className="input-field pl-7 py-1 text-xs w-64" placeholder="Buscar clave o valor…"
                       value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              {search && <span className="text-[11px] text-slate-500">{search.hits.size} coincidencia(s)</span>}
              <button onClick={expandAll} className="btn-secondary text-[11px] py-1 px-2" title="Expandir todo"><ChevronsUpDown className="w-3.5 h-3.5" /></button>
              <button onClick={collapseAll} className="btn-secondary text-[11px] py-1 px-2" title="Contraer todo"><ChevronsDownUp className="w-3.5 h-3.5" /></button>
            </>
          )}

          <div className="flex-1" />
          {type === 'json' && !failed && (
            <button onClick={() => copy(minifyJson(parsed.data), 'JSON minificado copiado')} className="btn-secondary text-[11px] py-1 px-2">
              <Copy className="w-3 h-3" /> Minificado
            </button>
          )}
          <button onClick={() => copy(tab === 'raw' ? value : pretty || value, tab === 'raw' ? 'Original copiado' : 'Copiado')} className="btn-secondary text-[11px] py-1 px-2">
            <Copy className="w-3 h-3" /> Copiar {tab === 'raw' ? 'original' : 'formateado'}
          </button>
        </div>

        {failed && (
          <div className="flex items-start gap-2 mx-4 mt-3 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>No se pudo interpretar como {type.toUpperCase()}: {parsed.error}. Se muestra el texto original.</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto m-4 rounded-xl border border-surface-600" style={{ background: '#18191A' }}>
          {tab === 'tree' && tree && (
            <div className="py-1 text-xs font-mono">
              <TreeRow node={tree} depth={0} expanded={expanded} toggle={toggle} search={search}
                       selected={selected} onSelect={setSelected} />
            </div>
          )}
          {tab === 'pretty' && (
            highlighted !== null
              ? <pre className="p-4 text-xs font-mono whitespace-pre text-slate-200" style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: highlighted }} />
              : <pre className="p-4 text-xs font-mono whitespace-pre text-slate-200" style={{ margin: 0 }}>{pretty}</pre>
          )}
          {tab === 'raw' && (
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-slate-200" style={{ margin: 0 }}>{value}</pre>
          )}
        </div>

        {/* Selected node */}
        {tab === 'tree' && selected && (
          <div className="flex items-center gap-2 px-4 pb-3 text-xs flex-shrink-0 flex-wrap">
            <span className="text-slate-500">{KIND_LABEL[selected.kind]}</span>
            <code className="font-mono text-sky-300 truncate max-w-[55%]" title={selected.path}>{selected.path || '(raíz)'}</code>
            {selected.path && (
              <button onClick={() => copy(selected.path, type === 'json' ? 'Ruta JSON copiada' : 'XPath copiado')}
                      className="btn-secondary text-[11px] py-0.5 px-2">Copiar ruta</button>
            )}
            {(!isContainer(selected) || type === 'json') && (
              <button
                onClick={() => copy(isContainer(selected) ? JSON.stringify(toJs(selected), null, 2) : valueText(selected), 'Valor copiado')}
                className="btn-secondary text-[11px] py-0.5 px-2">Copiar valor</button>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-[#18191a] border border-brand/70 text-white text-xs px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 pointer-events-none">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------- tree

// Containers open by default down to the second level.
function initialExpanded(tree) {
  const open = new Set()
  const walk = (n, d) => { if (isContainer(n) && d < 2) { open.add(n.id); n.children.forEach(c => walk(c, d + 1)) } }
  if (tree) walk(tree, 0)
  return open
}

// JSON/XML found inside a string value: it keeps its own expansion state.
function NestedTree({ tree, depth, selected, onSelect }) {
  const [expanded, setExpanded] = useState(() => initialExpanded(tree))
  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  return <TreeRow node={tree} depth={depth} expanded={expanded} toggle={toggle} search={null} selected={selected} onSelect={onSelect} />
}

function Preview({ node }) {
  if (node.kind === 'object') return <span className="text-slate-500">{`{${node.count}}`}</span>
  if (node.kind === 'array') return <span className="text-slate-500">{`[${node.count}]`}</span>
  if (node.kind === 'element') return <span className="text-slate-500">{`<${node.count}>`}</span>
  if (node.kind === 'string' || node.kind === 'leaf' || node.kind === 'attr' || node.kind === 'text' || node.kind === 'cdata') {
    const v = node.value ?? ''
    return <span className={KIND_STYLE[node.kind]}>{node.kind === 'string' ? JSON.stringify(v) : v === '' ? <i className="text-slate-600">(vacío)</i> : v}</span>
  }
  return <span className={KIND_STYLE[node.kind]}>{valueText(node)}</span>
}

function TreeRow({ node, depth, expanded, toggle, search, selected, onSelect }) {
  const [limit, setLimit] = useState(PAGE)
  const [nestedOpen, setNestedOpen] = useState(false)

  const container = isContainer(node)
  const open = search ? search.open.has(node.id) : expanded.has(node.id)
  const dim = search && !search.hits.has(node.id)

  // A string that itself holds JSON/XML can be opened in place.
  const nestedType = !container && (node.kind === 'string' || node.kind === 'leaf' || node.kind === 'attr' || node.kind === 'text' || node.kind === 'cdata')
    ? sniff(node.value) : null
  const nested = useMemo(() => {
    if (!nestedOpen || !nestedType) return null
    const p = parseStructured(node.value)
    return p.error ? { error: p.error } : { tree: toTree(p) }
  }, [nestedOpen, nestedType, node.value])

  if (search && !search.visible.has(node.id)) return null

  const kids = container && open ? node.children.filter(c => !search || search.visible.has(c.id)) : []
  const shown = kids.slice(0, limit)

  return (
    <>
      <div
        onClick={() => { onSelect(node); if (container) toggle(node.id) }}
        className={clsx('flex items-start gap-1 pr-3 py-[2px] cursor-pointer hover:bg-surface-700/30', selected?.id === node.id && 'bg-brand-dark/30')}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <span className="w-4 flex-shrink-0 mt-0.5 text-slate-500">
          {container && (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
        </span>
        {node.key !== null && node.key !== undefined && (
          <>
            <span className={clsx(node.kind === 'attr' ? 'text-orange-300' : 'text-sky-300', search?.hits.has(node.id) && 'bg-yellow-400/25 rounded')}>
              {typeof node.key === 'number' ? node.key : node.key}
            </span>
            <span className="text-slate-600">:</span>
          </>
        )}
        <span className={clsx('min-w-0 break-all whitespace-pre-wrap', dim && 'opacity-60', search?.hits.has(node.id) && 'bg-yellow-400/10 rounded')}>
          <Preview node={node} />
        </span>
        {nestedType && (
          <button
            onClick={(e) => { e.stopPropagation(); setNestedOpen(o => !o) }}
            className="ml-1 px-1.5 rounded border border-sky-500/40 text-sky-300 text-[10px] flex-shrink-0 hover:bg-sky-500/10"
            title={`Este texto contiene ${nestedType.toUpperCase()}: ${nestedOpen ? 'ocultar' : 'abrir aquí'}`}
          >
            {nestedOpen ? 'ocultar' : nestedType.toUpperCase()}
          </button>
        )}
      </div>

      {nested?.error && (
        <div className="text-[11px] text-red-300" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>No se pudo interpretar: {nested.error}</div>
      )}
      {nested?.tree && <NestedTree tree={nested.tree} depth={depth + 1} selected={selected} onSelect={onSelect} />}

      {shown.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle}
                 search={search} selected={selected} onSelect={onSelect} />
      ))}
      {kids.length > shown.length && (
        <button onClick={() => setLimit(l => l + PAGE * 5)} className="text-[11px] text-sky-300 hover:underline"
                style={{ paddingLeft: 8 + (depth + 1) * 16 + 20 }}>
          Mostrar {Math.min(PAGE * 5, kids.length - shown.length)} más ({kids.length - shown.length} restantes)
        </button>
      )}
    </>
  )
}
