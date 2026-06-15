import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import AssistantGate from './AssistantGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AssistantGate />
  </StrictMode>,
)
