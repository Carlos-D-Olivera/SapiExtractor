export const UI_THEMES = [
  {
    id: 'dark-blue',
    name: 'Azul Sapi (Predeterminado)',
    description: 'Estilo clásico con tonos azul marino y cian luminosos',
    preview: {
      bg: '#0A0F19',
      surface: '#0D1520',
      accent: '#0077B6',
      light: '#C2E7FF',
    },
    vars: {
      '--app-bg': '#0A0F19',
      '--surface-900': '10 15 25',
      '--surface-800': '13 21 32',
      '--surface-700': '17 27 44',
      '--surface-600': '22 34 54',
      '--surface-500': '28 42 66',
      '--surface-400': '36 51 80',
      '--brand-dark': '0 74 119',
      '--brand-accent': '0 119 182',
      '--brand-light': '#C2E7FF',
      '--brand-glow': '0 150 199',
      '--bg-editor': '#18191A',
      '--glass-bg': 'rgba(13, 21, 32, 0.75)',
      '--glass-border': 'rgba(0, 74, 119, 0.35)',
      '--glass-hover-bg': 'rgba(22, 34, 54, 0.85)',
      '--glass-hover-border': 'rgba(0, 119, 182, 0.5)',
    },
  },
  {
    id: 'dark-carbon',
    name: 'Carbón Puro (OLED / Pitch Black)',
    description: 'Negro absoluto con acentos zafiro y contraste cristalino',
    preview: {
      bg: '#050505',
      surface: '#0d0d0d',
      accent: '#2563eb',
      light: '#93c5fd',
    },
    vars: {
      '--app-bg': '#050505',
      '--surface-900': '5 5 5',
      '--surface-800': '13 13 13',
      '--surface-700': '20 20 20',
      '--surface-600': '32 32 32',
      '--surface-500': '45 45 45',
      '--surface-400': '65 65 65',
      '--brand-dark': '30 58 138',
      '--brand-accent': '37 99 235',
      '--brand-light': '#93c5fd',
      '--brand-glow': '59 130 246',
      '--bg-editor': '#0c0c0c',
      '--glass-bg': 'rgba(13, 13, 13, 0.85)',
      '--glass-border': 'rgba(37, 99, 235, 0.35)',
      '--glass-hover-bg': 'rgba(25, 25, 25, 0.9)',
      '--glass-hover-border': 'rgba(59, 130, 246, 0.55)',
    },
  },
  {
    id: 'dark-slate',
    name: 'Gris Slate (VS Code Dark)',
    description: 'Gris neutro moderno estilo VS Code con acentos celestes',
    preview: {
      bg: '#0b0f17',
      surface: '#131b26',
      accent: '#0ea5e9',
      light: '#bae6fd',
    },
    vars: {
      '--app-bg': '#0b0f17',
      '--surface-900': '11 15 23',
      '--surface-800': '19 27 38',
      '--surface-700': '28 39 54',
      '--surface-600': '40 54 74',
      '--surface-500': '55 72 96',
      '--surface-400': '75 95 122',
      '--brand-dark': '3 105 161',
      '--brand-accent': '14 165 233',
      '--brand-light': '#bae6fd',
      '--brand-glow': '56 189 248',
      '--bg-editor': '#141c26',
      '--glass-bg': 'rgba(19, 27, 38, 0.8)',
      '--glass-border': 'rgba(14, 165, 233, 0.35)',
      '--glass-hover-bg': 'rgba(28, 39, 54, 0.9)',
      '--glass-hover-border': 'rgba(56, 189, 248, 0.55)',
    },
  },
  {
    id: 'dark-purple',
    name: 'Medianoche Violeta',
    description: 'Índigo místico profundo con acentos violeta y amatista',
    preview: {
      bg: '#090514',
      surface: '#120a24',
      accent: '#8b5cf6',
      light: '#ddd6fe',
    },
    vars: {
      '--app-bg': '#090514',
      '--surface-900': '9 5 20',
      '--surface-800': '18 10 36',
      '--surface-700': '28 16 54',
      '--surface-600': '42 24 78',
      '--surface-500': '58 33 105',
      '--surface-400': '78 45 138',
      '--brand-dark': '91 33 182',
      '--brand-accent': '139 92 246',
      '--brand-light': '#ddd6fe',
      '--brand-glow': '167 139 250',
      '--bg-editor': '#120a24',
      '--glass-bg': 'rgba(18, 10, 36, 0.8)',
      '--glass-border': 'rgba(139, 92, 246, 0.35)',
      '--glass-hover-bg': 'rgba(28, 16, 54, 0.9)',
      '--glass-hover-border': 'rgba(167, 139, 250, 0.55)',
    },
  },
  {
    id: 'dark-emerald',
    name: 'Matrix Esmeralda',
    description: 'Fondo bosque nocturno con acentos esmeralda y menta',
    preview: {
      bg: '#040d08',
      surface: '#081a10',
      accent: '#10b981',
      light: '#a7f3d0',
    },
    vars: {
      '--app-bg': '#040d08',
      '--surface-900': '4 13 8',
      '--surface-800': '8 26 16',
      '--surface-700': '13 38 24',
      '--surface-600': '20 54 35',
      '--surface-500': '28 74 48',
      '--surface-400': '38 98 64',
      '--brand-dark': '6 95 70',
      '--brand-accent': '16 185 129',
      '--brand-light': '#a7f3d0',
      '--brand-glow': '52 211 153',
      '--bg-editor': '#07180f',
      '--glass-bg': 'rgba(8, 26, 16, 0.8)',
      '--glass-border': 'rgba(16, 185, 129, 0.35)',
      '--glass-hover-bg': 'rgba(13, 38, 24, 0.9)',
      '--glass-hover-border': 'rgba(52, 211, 153, 0.55)',
    },
  },
  {
    id: 'dark-amber',
    name: 'Cyberpunk Ámbar',
    description: 'Fondo cálido oscuro con intensos toques dorados y ámbar',
    preview: {
      bg: '#0f0b04',
      surface: '#1c1508',
      accent: '#f59e0b',
      light: '#fde68a',
    },
    vars: {
      '--app-bg': '#0f0b04',
      '--surface-900': '15 11 4',
      '--surface-800': '28 21 8',
      '--surface-700': '41 31 12',
      '--surface-600': '59 45 18',
      '--surface-500': '82 62 25',
      '--surface-400': '110 84 34',
      '--brand-dark': '146 64 14',
      '--brand-accent': '245 158 11',
      '--brand-light': '#fde68a',
      '--brand-glow': '251 191 36',
      '--bg-editor': '#181207',
      '--glass-bg': 'rgba(28, 21, 8, 0.8)',
      '--glass-border': 'rgba(245, 158, 11, 0.35)',
      '--glass-hover-bg': 'rgba(41, 31, 12, 0.9)',
      '--glass-hover-border': 'rgba(251, 191, 36, 0.55)',
    },
  },
  {
    id: 'dark-crimson',
    name: 'Rubí Carmesí',
    description: 'Elegancia oscura con intensos tonos rubí y carmesí',
    preview: {
      bg: '#120406',
      surface: '#1e080b',
      accent: '#f43f5e',
      light: '#fecdd3',
    },
    vars: {
      '--app-bg': '#120406',
      '--surface-900': '18 4 6',
      '--surface-800': '30 8 11',
      '--surface-700': '43 12 16',
      '--surface-600': '61 18 24',
      '--surface-500': '87 26 34',
      '--surface-400': '120 35 47',
      '--brand-dark': '159 18 57',
      '--brand-accent': '244 63 94',
      '--brand-light': '#fecdd3',
      '--brand-glow': '251 113 133',
      '--bg-editor': '#1c080b',
      '--glass-bg': 'rgba(30, 8, 11, 0.8)',
      '--glass-border': 'rgba(244, 63, 94, 0.35)',
      '--glass-hover-bg': 'rgba(43, 12, 16, 0.9)',
      '--glass-hover-border': 'rgba(251, 113, 133, 0.55)',
    },
  },
  {
    id: 'dark-cobalt',
    name: 'Cobalto Real',
    description: 'Azul cobalto majestuoso y gran legibilidad profesional',
    preview: {
      bg: '#040a14',
      surface: '#071224',
      accent: '#0284c7',
      light: '#bae6fd',
    },
    vars: {
      '--app-bg': '#040a14',
      '--surface-900': '4 10 20',
      '--surface-800': '7 18 36',
      '--surface-700': '11 28 56',
      '--surface-600': '18 42 82',
      '--surface-500': '25 58 112',
      '--surface-400': '35 77 145',
      '--brand-dark': '3 105 161',
      '--brand-accent': '2 132 199',
      '--brand-light': '#bae6fd',
      '--brand-glow': '56 189 248',
      '--bg-editor': '#09152b',
      '--glass-bg': 'rgba(7, 18, 36, 0.8)',
      '--glass-border': 'rgba(2, 132, 199, 0.35)',
      '--glass-hover-bg': 'rgba(11, 28, 56, 0.9)',
      '--glass-hover-border': 'rgba(56, 189, 248, 0.55)',
    },
  },
]

export function applyAppTheme(themeId) {
  const theme = UI_THEMES.find(t => t.id === themeId) || UI_THEMES[0]
  const root = document.documentElement

  root.setAttribute('data-theme', theme.id)

  // Apply CSS custom properties
  Object.entries(theme.vars).forEach(([key, val]) => {
    root.style.setProperty(key, val)
  })

  // Persist to localStorage
  try {
    localStorage.setItem('sp_extractor_app_theme', theme.id)
  } catch { /* ignore */ }

  return theme
}

export function getSavedAppTheme() {
  try {
    const saved = localStorage.getItem('sp_extractor_app_theme')
    if (saved && UI_THEMES.some(t => t.id === saved)) {
      return saved
    }
  } catch { /* ignore */ }
  return 'dark-blue'
}
