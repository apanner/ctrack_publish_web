import { EventEmitter } from "node:events"

/** Cross-cutting SSE broadcast for python logs, upload progress, and queue events. */
export const engineBus = new EventEmitter()
engineBus.setMaxListeners(100)
