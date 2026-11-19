import { foldService, foldGutter, foldKeymap, codeFolding } from '@codemirror/language'
import { keymap } from '@codemirror/view'

function getLineIndentation(lineText) {
  let count = 0
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === ' ') count++
    else if (lineText[i] === '\t') count += 4
    else break
  }
  return count
}

/**
 * Custom fold service for SQL / T-SQL:
 *  - Matches BEGIN ... END blocks (including BEGIN TRAN, BEGIN TRY, BEGIN CATCH)
 *    leaving the END line visible when folded!
 *  - Matches CASE ... END blocks leaving END visible
 *  - Matches multiline block comments /* ... * /
 *  - Matches multiline parentheses ( ... ) leaving closing ) visible
 *  - Matches CREATE / ALTER PROCEDURE|VIEW|FUNCTION|TRIGGER ... AS ... GO leaving GO visible
 */
export function sqlFoldService(state, lineStart, lineEnd) {
  const line = state.doc.lineAt(lineStart)
  const rawText = line.text
  const noComment = rawText.replace(/--.*$/, '')
  const trimmed = noComment.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()

  // 1. Block comments /* ... */
  const commentStart = rawText.indexOf('/*')
  if (commentStart !== -1 && !rawText.includes('*/')) {
    for (let ln = line.number + 1; ln <= state.doc.lines; ln++) {
      const lText = state.doc.line(ln).text
      const endIdx = lText.indexOf('*/')
      if (endIdx !== -1) {
        return { from: lineStart + commentStart + 2, to: state.doc.line(ln).from + endIdx + 2 }
      }
    }
  }

  // 2. Parentheses ( ... ) spanning multiple lines - leaves closing ) line visible
  let openParen = -1
  let parenDepth = 0
  for (let i = 0; i < noComment.length; i++) {
    if (noComment[i] === '(') {
      if (openParen === -1) openParen = i
      parenDepth++
    } else if (noComment[i] === ')') {
      parenDepth--
    }
  }
  if (openParen !== -1 && parenDepth > 0) {
    let pCount = parenDepth
    for (let ln = line.number + 1; ln <= state.doc.lines; ln++) {
      const lText = state.doc.line(ln).text.replace(/--.*$/, '').replace(/'(?:''|[^'])*'/g, ' ')
      for (let i = 0; i < lText.length; i++) {
        if (lText[i] === '(') pCount++
        else if (lText[i] === ')') {
          pCount--
          if (pCount === 0) {
            const endLine = state.doc.line(ln)
            if (endLine.number > line.number) {
              const toPos = endLine.from - 1
              if (toPos > line.to) {
                return { from: line.to, to: toPos }
              }
            }
            return { from: line.to, to: endLine.from + i }
          }
        }
      }
    }
  }

  // 3. BEGIN ... END or CASE ... END
  const isBegin = /\bBEGIN\b/i.test(upper)
  const isCase = /\bCASE\b/i.test(upper)
  const isIfOrWhile = /^(IF|WHILE)\b/i.test(upper)

  // If this line is IF or WHILE without BEGIN on the same line, check if the next
  // non-blank line starts with BEGIN. If so, let BEGIN own the fold chevron.
  if (isIfOrWhile && !isBegin) {
    let nextLn = line.number + 1
    while (nextLn <= state.doc.lines) {
      const nextText = state.doc.line(nextLn).text.replace(/--.*$/, '').trim()
      if (nextText) {
        if (/^BEGIN\b/i.test(nextText)) {
          return null
        }
        break
      }
      nextLn++
    }
  }

  const targetIsBlock = isBegin || isCase

  if (targetIsBlock) {
    let depth = 0
    for (let ln = line.number; ln <= state.doc.lines; ln++) {
      const lText = state.doc.line(ln).text.replace(/--.*$/, '').replace(/'(?:''|[^'])*'/g, ' ')
      const words = lText.match(/\b(BEGIN|CASE|END)\b/gi) || []
      for (const w of words) {
        const uw = w.toUpperCase()
        if (uw === 'BEGIN' || uw === 'CASE') depth++
        else if (uw === 'END') {
          depth--
          if (depth === 0) {
            const endLine = state.doc.line(ln)
            // Fold inner content up to before the closing line so END / END TRY / END CATCH remains visible!
            if (endLine.number > line.number) {
              const toPos = endLine.from - 1
              if (toPos > line.to) {
                return { from: line.to, to: toPos }
              }
            }
            return null
          }
        }
      }
    }
  }

  // 4. Indentation-based folding for IF / WHILE without BEGIN
  if (isIfOrWhile && !targetIsBlock) {
    const baseIndent = getLineIndentation(rawText)
    let lastFoldLine = -1
    for (let ln = line.number + 1; ln <= state.doc.lines; ln++) {
      const curLine = state.doc.line(ln)
      const curTrimmed = curLine.text.trim()
      if (!curTrimmed) continue
      const curIndent = getLineIndentation(curLine.text)
      if (curIndent > baseIndent) {
        lastFoldLine = ln
      } else {
        break
      }
    }
    if (lastFoldLine > line.number) {
      return { from: line.to, to: state.doc.line(lastFoldLine).to }
    }
  }

  // 5. CREATE / ALTER PROCEDURE|FUNCTION|TRIGGER|VIEW ... AS ... GO (leaves GO visible)
  if (/^(CREATE|ALTER)\s+(PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b/i.test(upper)) {
    let foundAs = /\bAS\b/i.test(upper)
    for (let ln = line.number + 1; ln <= state.doc.lines; ln++) {
      const lText = state.doc.line(ln).text.trim().toUpperCase()
      if (!foundAs && /^AS\b/i.test(lText)) {
        foundAs = true
        continue
      }
      if (lText === 'GO' || (ln === state.doc.lines && foundAs)) {
        const endLine = state.doc.line(ln)
        if (endLine.number > line.number) {
          const toPos = endLine.from - 1
          if (toPos > line.to) {
            return { from: line.to, to: toPos }
          }
        }
      }
    }
  }

  return null
}

/**
 * Creates custom fold gutter with SSMS/VS Code styling chevrons:
 *  - ▾ when open
 *  - ▸ when folded
 */
export function createSqlFoldGutter() {
  return foldGutter({
    markerDOM: (open) => {
      const el = document.createElement('span')
      el.className = 'cm-fold-marker'
      el.textContent = open ? '▾' : '▸'
      el.title = open ? 'Plegar bloque' : 'Desplegar bloque'
      return el
    },
  })
}

export const sqlFoldExtension = [
  foldService.of(sqlFoldService),
  createSqlFoldGutter(),
  codeFolding(),
  keymap.of(foldKeymap),
]
