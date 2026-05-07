import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NearWalletProvider } from './contexts/NearWalletContext'
import App from './App'
import './index.css'

const CACHE_KEY = 'outlayer:queryCache'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60_000,     // 10 min before refetch
      gcTime: 30 * 60_000,        // 30 min cache
      retry: 1,
      refetchOnWindowFocus: true,
      placeholderData: (prev) => prev,
    },
  },
})

// Restore query cache from localStorage (sync — runs before first paint)
try {
  const stored = localStorage.getItem(CACHE_KEY)
  if (stored) {
    const { clientState, timestamp } = JSON.parse(stored)
    if (Date.now() - timestamp < 30 * 60_000) {
      queryClient.getQueryCache().restore(clientState)
    } else {
      localStorage.removeItem(CACHE_KEY)
    }
  }
} catch {}

// Save query cache to localStorage on changes
queryClient.getQueryCache().subscribe((event) => {
  if (event?.type === 'updated' || event?.type === 'added') {
    try {
      const clientState = queryClient.getQueryCache().build()
      localStorage.setItem(CACHE_KEY, JSON.stringify({ clientState, timestamp: Date.now() }))
    } catch {}
  }
})

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <NearWalletProvider>
        <App />
      </NearWalletProvider>
    </QueryClientProvider>
  </BrowserRouter>,
)
