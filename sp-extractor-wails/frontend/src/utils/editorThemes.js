import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'

export const EDITOR_FONTS = [
  { id: 'Consolas', name: 'Consolas', family: 'Consolas, ui-monospace, monospace' },
  { id: 'JetBrains Mono', name: 'JetBrains Mono', family: '"JetBrains Mono", Consolas, monospace' },
  { id: 'Fira Code', name: 'Fira Code', family: '"Fira Code", Consolas, monospace' },
  { id: 'Cascadia Code', name: 'Cascadia Code', family: '"Cascadia Code", Consolas, monospace' },
  { id: 'Menlo', name: 'Menlo', family: 'Menlo, Consolas, monospace' },
  { id: 'Courier New', name: 'Courier New', family: '"Courier New", Courier, monospace' },
  { id: 'ui-monospace', name: 'Monospace del Sistema', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
]

export const EDITOR_THEMES = [
  {
    id: 'one-dark',
    name: 'One Dark (Predeterminado)',
    description: 'Tema oscuro clásico inspirado en Atom',
    bg: '#18191A',
    gutterBg: '#18191A',
    activeLine: 'rgba(255, 255, 255, 0.03)',
    colors: { keyword: '#e06c75', string: '#98c379', number: '#d19a66', comment: '#5c6370' },
  },
  {
    id: 'ssms-dark',
    name: 'SSMS Classic Dark',
    description: 'Inspirado en SQL Server Management Studio Dark',
    bg: '#1e1e1e',
    gutterBg: '#1e1e1e',
    activeLine: '#262626',
    colors: { keyword: '#569cd6', string: '#d69d85', number: '#b5cea8', comment: '#57a64a' },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Famoso tema oscuro con toques violeta y rosa',
    bg: '#282a36',
    gutterBg: '#282a36',
    activeLine: '#343746',
    colors: { keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4' },
  },
  {
    id: 'monokai',
    name: 'Monokai Pro',
    description: 'Cálido, vibrante y legendario entre programadores',
    bg: '#272822',
    gutterBg: '#272822',
    activeLine: '#3e3d32',
    colors: { keyword: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e' },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    description: 'Estilo moderno y nítido de GitHub',
    bg: '#0d1117',
    gutterBg: '#0d1117',
    activeLine: '#161b22',
    colors: { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e' },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Paleta ártica fría, limpia y elegante',
    bg: '#2e3440',
    gutterBg: '#2e3440',
    activeLine: '#3b4252',
    colors: { keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88' },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'Baja fatiga visual con tonos ámbar y azul verdoso',
    bg: '#002b36',
    gutterBg: '#073642',
    activeLine: '#073642',
    colors: { keyword: '#268bd2', string: '#2aa198', number: '#b58900', comment: '#586e75' },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    description: 'Profundo azul noche con acentos neón',
    bg: '#1a1b26',
    gutterBg: '#1a1b26',
    activeLine: '#24283b',
    colors: { keyword: '#7aa2f7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89' },
  },
  {
    id: 'high-contrast',
    name: 'Alto Contraste',
    description: 'Fondo negro profundo con colores de máxima visibilidad',
    bg: '#000000',
    gutterBg: '#000000',
    activeLine: '#161616',
    colors: { keyword: '#00ffff', string: '#ffff00', number: '#ff9900', comment: '#00ff66' },
  },
]

function createCustomThemeExtension(themeDef) {
  const { bg, gutterBg, activeLine, colors } = themeDef

  const themeStyle = EditorView.theme({
    '&': {
      backgroundColor: bg,
      color: '#d4d4d4',
    },
    '.cm-gutters': {
      backgroundColor: gutterBg,
      borderRight: '1px solid rgba(255, 255, 255, 0.08)',
      color: colors.comment || '#64748b',
    },
    '.cm-activeLine': {
      backgroundColor: activeLine,
    },
    '.cm-activeLineGutter': {
      backgroundColor: activeLine,
    },
    '.cm-cursor': {
      borderLeftColor: colors.keyword || '#569cd6',
    },
  }, { dark: true })

  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: colors.keyword, fontWeight: '700' },
    { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#d4d4d4' },
    { tag: [tags.function(tags.variableName), tags.labelName], color: '#dcdcaa' },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: colors.number },
    { tag: [tags.definition(tags.name), tags.separator], color: '#d4d4d4' },
    { tag: [tags.typeName, tags.className, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: '#4ec9b0' },
    { tag: [tags.number], color: colors.number },
    { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.special(tags.string)], color: '#d4d4d4' },
    { tag: [tags.meta, tags.comment], color: colors.comment, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: colors.keyword, textDecoration: 'underline' },
    { tag: tags.heading, fontWeight: 'bold', color: colors.keyword },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: colors.number },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: colors.string },
    { tag: tags.invalid, color: '#f87171' },
  ])

  return [themeStyle, syntaxHighlighting(highlightStyle)]
}

export function getEditorThemeExtension(themeId) {
  if (themeId === 'one-dark') {
    return [oneDark]
  }
  const found = EDITOR_THEMES.find(t => t.id === themeId)
  if (!found) {
    return [oneDark]
  }
  return createCustomThemeExtension(found)
}

export function makeFontTheme(size = 12, family = 'Consolas') {
  const found = EDITOR_FONTS.find(f => f.id === family)
  const fontStack = found ? found.family : `${family}, Consolas, monospace`

  return EditorView.theme({
    '&': {
      fontSize: `${size}px`,
    },
    '.cm-scroller': {
      fontFamily: fontStack,
      overflow: 'auto',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      fontSize: `${size}px`,
      fontFamily: fontStack,
    },
  })
}
