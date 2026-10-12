import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { installBuildDiagnostics } from '@/lib/build-info'

installBuildDiagnostics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
