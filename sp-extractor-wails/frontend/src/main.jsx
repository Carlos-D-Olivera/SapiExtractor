import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'
import { applyAppTheme, getSavedAppTheme } from './utils/uiThemes'

// Apply the saved UI theme immediately upon application launch
applyAppTheme(getSavedAppTheme())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
