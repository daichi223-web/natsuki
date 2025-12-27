import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode temporarily disabled to prevent double mount issues with PTY
createRoot(document.getElementById('root')!).render(
  <App />
)
