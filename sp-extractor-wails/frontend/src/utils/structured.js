// Detection, parsing and formatting of JSON / XML values found in query results.

// ------------------------------------------------------------------ detection

/** Cheap check on the shape of the text; does not parse. Returns 'json' | 'xml' | null. */
export function sniff(value) {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t.length < 2) return null
  const a = t[0]
  const z = t[t.length - 1]
  if ((a === '{' && z === '}') || (a === '[' && z === ']')) return 'json'
  if (a === '<' && z === '>') return 'xml'
  return null
}

/** Type of a result cell: by its shape, or by the column's declared type (json / xml). */
export function detectType(value, typeName) {
  if (value === null || value === undefined || value === '') return null
  const shape = sniff(value)
  if (shape) return shape
  const tn = (typeName || '').toLowerCase()
  if (tn.includes('json')) return 'json'
  if (tn.includes('xml')) return 'xml'
  return null
}

// -------------------------------------------------------------------- parsing

function xmlError(text) {
  const m = /error on line \d+ at column \d+: [^\n]*/i.exec(text)
  return (m ? m[0] : text.split('\n')[0]).slice(0, 300)
}

function parseXmlText(s) {
  const doc = new DOMParser().parseFromString(s, 'application/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  return err ? { error: xmlError(err.textContent || '') } : { doc }
}

/**
 * Parses a JSON or XML string.
 * Returns { type, data } (json), { type, doc, fragment } (xml) or { type, error }.
 */
export function parseStructured(value, hint) {
  const text = String(value).trim()
  const type = hint || sniff(text)
  if (type === 'json') {
    try {
      return { type, data: JSON.parse(text) }
    } catch (e) {
      return { type, error: e.message }
    }
  }
  if (type === 'xml') {
    const first = parseXmlText(text)
    if (!first.error) return { type, doc: first.doc, fragment: false, declaration: declarationOf(text) }
    // Results of FOR XML without ROOT hold several top-level elements: wrap them.
    const body = text.replace(/^<\?xml[^>]*\?>\s*/i, '')
    const wrapped = parseXmlText(`<__fragment__>${body}</__fragment__>`)
    if (!wrapped.error) return { type, doc: wrapped.doc, fragment: true, declaration: declarationOf(text) }
    return { type, error: first.error }
  }
  return { type: null, error: 'El valor no es JSON ni XML.' }
}

function declarationOf(text) {
  const m = /^<\?xml[^>]*\?>/i.exec(text)
  return m ? m[0] : ''
}

// ----------------------------------------------------------------------- tree
//
// node: { id, key, kind, value, children, path, count }
//   kind: object | array | string | number | boolean | null          (JSON)
//         element | leaf | attr | text | cdata | comment | pi        (XML)

let nextId = 1
const node = (props) => ({ id: nextId++, children: null, ...props })

const IDENT = /^[A-Za-z_$][\w$]*$/

function jsonPath(parent, key) {
  if (typeof key === 'number') return `${parent}[${key}]`
  return IDENT.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function buildJson(v, key, path) {
  if (v === null) return node({ key, path, kind: 'null', value: null })
  if (Array.isArray(v)) {
    const n = node({ key, path, kind: 'array', count: v.length })
    n.children = v.map((x, i) => buildJson(x, i, jsonPath(path, i)))
    return n
  }
  switch (typeof v) {
    case 'object': {
      const keys = Object.keys(v)
      const n = node({ key, path, kind: 'object', count: keys.length })
      n.children = keys.map(k => buildJson(v[k], k, jsonPath(path, k)))
      return n
    }
    case 'string': return node({ key, path, kind: 'string', value: v })
    case 'number': return node({ key, path, kind: 'number', value: v })
    default: return node({ key, path, kind: 'boolean', value: v })
  }
}

export function jsonToTree(data) {
  return buildJson(data, null, '$')
}

const significantNodes = (el) => Array.from(el.childNodes).filter(c => {
  if (c.nodeType === 1 || c.nodeType === 4 || c.nodeType === 8 || c.nodeType === 7) return true
  return c.nodeType === 3 && c.nodeValue.trim() !== ''
})

function buildXmlElement(el, path) {
  const attrs = Array.from(el.attributes || [])
  const kids = significantNodes(el)
  const onlyText = kids.length > 0 && kids.every(c => c.nodeType === 3 || c.nodeType === 4)
  // <name>text</name> or <name/> with no attributes: a single leaf line.
  if (attrs.length === 0 && (kids.length === 0 || onlyText)) {
    return node({ key: el.tagName, path, kind: 'leaf', value: kids.map(c => c.nodeValue).join('').trim() })
  }

  const children = attrs.map(a => node({ key: `@${a.name}`, path: `${path}/@${a.name}`, kind: 'attr', value: a.value }))
  const seen = {}
  const total = {}
  kids.forEach(c => { if (c.nodeType === 1) total[c.tagName] = (total[c.tagName] || 0) + 1 })
  kids.forEach(c => {
    if (c.nodeType === 1) {
      seen[c.tagName] = (seen[c.tagName] || 0) + 1
      const step = total[c.tagName] > 1 ? `${c.tagName}[${seen[c.tagName]}]` : c.tagName
      children.push(buildXmlElement(c, `${path}/${step}`))
    } else if (c.nodeType === 4) {
      children.push(node({ key: '#cdata', path: `${path}/text()`, kind: 'cdata', value: c.nodeValue }))
    } else if (c.nodeType === 8) {
      children.push(node({ key: '#comment', path: `${path}/comment()`, kind: 'comment', value: c.nodeValue.trim() }))
    } else if (c.nodeType === 7) {
      children.push(node({ key: `?${c.target}`, path, kind: 'pi', value: c.data }))
    } else {
      children.push(node({ key: '#text', path: `${path}/text()`, kind: 'text', value: c.nodeValue.trim() }))
    }
  })
  const n = node({ key: el.tagName, path, kind: 'element', count: children.length })
  n.children = children
  return n
}

export function xmlToTree(parsed) {
  const root = parsed.doc.documentElement
  if (parsed.fragment) {
    const kids = significantNodes(root)
    const total = {}
    const seen = {}
    kids.forEach(c => { if (c.nodeType === 1) total[c.tagName] = (total[c.tagName] || 0) + 1 })
    const n = node({ key: 'Fragmento XML', path: '', kind: 'element', count: kids.length })
    n.children = kids.map(c => {
      if (c.nodeType !== 1) return node({ key: '#text', path: '', kind: 'text', value: (c.nodeValue || '').trim() })
      seen[c.tagName] = (seen[c.tagName] || 0) + 1
      return buildXmlElement(c, `/${total[c.tagName] > 1 ? `${c.tagName}[${seen[c.tagName]}]` : c.tagName}`)
    })
    return n
  }
  return buildXmlElement(root, `/${root.tagName}`)
}

/** Builds the tree for a successful parse result. */
export function toTree(parsed) {
  return parsed.type === 'json' ? jsonToTree(parsed.data) : xmlToTree(parsed)
}

/** Number of nodes in a tree. */
export function countNodes(n) {
  return 1 + (n.children ? n.children.reduce((s, c) => s + countNodes(c), 0) : 0)
}

// ----------------------------------------------------------------- formatting

export function prettyJson(data) {
  return JSON.stringify(data, null, 2)
}

export function minifyJson(data) {
  return JSON.stringify(data)
}

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => escXml(s).replace(/"/g, '&quot;')

function serialize(n, depth, out) {
  const pad = '  '.repeat(depth)
  if (n.nodeType === 8) return out.push(`${pad}<!--${n.nodeValue}-->`)
  if (n.nodeType === 7) return out.push(`${pad}<?${n.target} ${n.data}?>`)
  if (n.nodeType === 4) return out.push(`${pad}<![CDATA[${n.nodeValue}]]>`)
  if (n.nodeType === 3) return out.push(pad + escXml(n.nodeValue.trim()))

  const attrs = Array.from(n.attributes || []).map(a => ` ${a.name}="${escAttr(a.value)}"`).join('')
  const kids = significantNodes(n)
  if (kids.length === 0) return out.push(`${pad}<${n.tagName}${attrs}/>`)
  if (kids.every(c => c.nodeType === 3) && kids.length === 1) {
    return out.push(`${pad}<${n.tagName}${attrs}>${escXml(kids[0].nodeValue.trim())}</${n.tagName}>`)
  }
  out.push(`${pad}<${n.tagName}${attrs}>`)
  kids.forEach(c => serialize(c, depth + 1, out))
  out.push(`${pad}</${n.tagName}>`)
}

/** Indented XML text. */
export function prettyXml(parsed) {
  const out = []
  if (parsed.declaration) out.push(parsed.declaration)
  const root = parsed.doc.documentElement
  if (parsed.fragment) significantNodes(root).forEach(c => serialize(c, 0, out))
  else serialize(root, 0, out)
  return out.join('\n')
}

/** Formatted text of a parse result. */
export function prettyText(parsed) {
  return parsed.type === 'json' ? prettyJson(parsed.data) : prettyXml(parsed)
}

// --------------------------------------------------------------- highlighting
// These return HTML. Every piece of user text is escaped before it is wrapped.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`

export function highlightJson(text) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index))
    if (m[1] !== undefined) out += span(m[2] ? 'tok-key' : 'tok-string', m[1]) + esc(m[2] || '')
    else if (m[3] !== undefined) out += span('tok-literal', m[3])
    else out += span('tok-number', m[0])
    last = re.lastIndex
  }
  return out + esc(text.slice(last))
}

export function highlightXml(text) {
  const re = /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|(<\?[\s\S]*?\?>)|(<\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?>)/g
  const attrRe = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index))
    if (m[1] !== undefined) out += span('tok-comment', m[1])
    else if (m[2] !== undefined) out += span('tok-string', m[2])
    else if (m[3] !== undefined) out += span('tok-comment', m[3])
    else {
      let attrs = ''
      let a = 0
      let am
      attrRe.lastIndex = 0
      while ((am = attrRe.exec(m[6])) !== null) {
        attrs += esc(m[6].slice(a, am.index)) + span('tok-attr', am[1]) + esc(am[2]) + span('tok-string', am[3])
        a = attrRe.lastIndex
      }
      attrs += esc(m[6].slice(a))
      out += esc(m[4]) + span('tok-tag', m[5]) + attrs + esc(m[7])
    }
    last = re.lastIndex
  }
  return out + esc(text.slice(last))
}

export function highlight(text, type) {
  return type === 'json' ? highlightJson(text) : highlightXml(text)
}
