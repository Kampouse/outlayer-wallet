import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import {
  PersistQueryClientProvider,
  persistQueryClientRestore,
} from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { NearWalletProvider } from './contexts/NearWalletContext'
import App from './App'
import './index.css'

const CACHE_KEY = 'outlayer:queryCache'
const MAX_AGE = 30 * 60_000 // 30 min

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,             // always refetch on mount
      gcTime: MAX_AGE,            // match persistence TTL
      retry: 1,
      refetchOnWindowFocus: true,
      placeholderData: (prev) => prev,
    },
  },
})

const persister = createAsyncStoragePersister({
  storage: window.localStorage,
  key: CACHE_KEY,
})

// Sync restore from localStorage before first paint (no flash)
persistQueryClientRestore({
  queryClient,
  persister,
  maxAge: MAX_AGE,
})

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: MAX_AGE }}
    >
      <NearWalletProvider>
        <App />
      </NearWalletProvider>
    </PersistQueryClientProvider>
  </BrowserRouter>,
)

// Register service worker in production
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
