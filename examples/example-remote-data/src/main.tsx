import { createRoot } from 'react-dom/client'
import { App } from './app.js'

const root = document.getElementById('root')

if (root === null) {
  throw new Error('Missing #root element for remote-data example')
}

createRoot(root).render(<App />)
