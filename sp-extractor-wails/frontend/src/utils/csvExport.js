// Serialize the values as displayed by the query engine, preserving leading zeroes.
export function buildCsv(set, {
  columnIndexes, delimiter = ',', includeHeaders = true, nullValue = '',
  quoteAll = false, bom = false, lineEnding = '\r\n', maxRows = Infinity,
} = {}) {
  if (![',', ';', '\t', '|'].includes(delimiter)) throw new Error('Separador CSV inválido.')
  const columns = set?.columns || [], rows = set?.rows || []
  const selected = columnIndexes == null ? null : new Set(columnIndexes)
  const indexes = columns.map((_, i) => i).filter(i => selected == null || selected.has(i))
  if (!indexes.length) return ''
  const field = value => {
    const text = String(value ?? nullValue)
    return quoteAll || text === '' || text.includes(delimiter) || /["\r\n]/.test(text)
      ? '"' + text.replaceAll('"', '""') + '"' : text
  }
  const lines = []
  if (includeHeaders) lines.push(indexes.map(i => field(columns[i])).join(delimiter))
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) lines.push(indexes.map(i => field(rows[r]?.[i])).join(delimiter))
  return (bom ? '\ufeff' : '') + (lines.length ? lines.join(lineEnding) + lineEnding : '')
}
