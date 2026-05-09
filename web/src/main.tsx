import "./lib/engine-ipc-shim"
import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Root } from './Root.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
)

const w = window as Window & { ipcRenderer?: { on: (c: string, fn: (e: unknown, m: unknown) => void) => unknown } }
w.ipcRenderer?.on("main-process-message", (_event, message) => {
  console.log(message)
})
