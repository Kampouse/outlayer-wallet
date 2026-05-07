import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { NearWalletProvider } from './contexts/NearWalletContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <NearWalletProvider>
      <App />
    </NearWalletProvider>
  </BrowserRouter>,
)
