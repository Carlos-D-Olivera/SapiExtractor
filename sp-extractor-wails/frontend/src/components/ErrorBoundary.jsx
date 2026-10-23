import { Component } from 'react'
import { AlertCircle } from 'lucide-react'

// Shows the error instead of leaving the whole window blank when a panel throws while rendering.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Panel error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex-1 m-4 flex items-start gap-2 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs overflow-auto">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
        <div className="min-w-0">
          <p className="font-semibold mb-1">{this.props.title || 'Error al mostrar este panel'}</p>
          <pre className="whitespace-pre-wrap font-mono" style={{ margin: 0 }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button className="btn-secondary text-xs py-1 px-2 mt-2" onClick={() => { this.setState({ error: null }); this.props.onReset?.() }}>
            Cerrar
          </button>
        </div>
      </div>
    )
  }
}
