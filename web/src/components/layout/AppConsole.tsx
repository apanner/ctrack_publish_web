import { useState, useRef, useEffect } from "react"
import { useAppLogStore, type LogEntry, type LogLevel } from "@/store/app-log-store"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, Trash2, Maximize2, Minimize2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"

const levelColors: Record<LogLevel, string> = {
  info: "text-gray-300",
  warn: "text-amber-400",
  error: "text-red-400",
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "." + String(d.getMilliseconds()).padStart(3, "0")
}

export function AppConsole() {
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [height] = useState(120)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { entries, clear } = useAppLogStore()

  useEffect(() => {
    if (collapsed) return
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length, collapsed, maximized])

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = entries.map(e => `[${formatTime(e.timestamp)}] [${e.level.toUpperCase()}] ${e.message}`).join("\n")
    navigator.clipboard.writeText(text)
    // Optional: Toast notification
    alert("Console logs copied to clipboard")
  }

  return (
    <div className={cn(
      "flex-shrink-0 border-t border-[#404040] bg-[#0D0D0D] flex flex-col transition-all duration-300 z-50",
      maximized ? "fixed inset-0 h-full border-t-0" : ""
    )}>
      <div className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-[#404040]">
        <button
          type="button"
          onClick={() => !maximized && setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left hover:text-gray-300 hover:bg-[#1A1A1A] rounded px-1 py-0.5 -mx-1"
        >
          <span>Console</span>
          {maximized && <span className="text-primary text-[9px]">(Maximized)</span>}
          {!maximized && (collapsed ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />)}
        </button>
        <span className="flex items-center gap-2">
          {entries.length > 0 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-gray-500 hover:text-white"
                onClick={handleCopy}
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-gray-500 hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation()
                  clear()
                }}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Clear
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-500 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              setMaximized(m => !m)
              if (collapsed) setCollapsed(false)
            }}
          >
            {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
        </span>
      </div>
      {(!collapsed || maximized) && (
        <div
          className="overflow-y-auto font-mono text-[11px] leading-relaxed select-text flex-1"
          style={maximized ? {} : { minHeight: 80, maxHeight: height }}
        >
          {entries.length === 0 ? (
            <div className="p-3 text-gray-600">No logs yet. Drop files or publish to see activity.</div>
          ) : (
            <div className="p-2 space-y-0.5">
              {entries.map((e: LogEntry) => (
                <div key={e.id} className={cn("flex gap-2 font-medium", levelColors[e.level])}>
                  <span className="flex-shrink-0 text-gray-600 opacity-50 select-none">{formatTime(e.timestamp)}</span>
                  <span className={cn(
                    "flex-shrink-0 uppercase font-bold w-12 text-[9px] tracking-wider py-0.5 px-1 rounded-sm bg-white/5 text-center select-none",
                    e.level === 'error' ? "bg-red-500/10 text-red-500" :
                      e.level === 'warn' ? "bg-amber-500/10 text-amber-500" : "text-gray-500"
                  )}>{e.level}</span>
                  <span className="break-all whitespace-pre-wrap">{e.message}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
