package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
)

// Hub is a minimal SSE bus for job status events (Go-native API parity layer).
type Hub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[chan []byte]struct{})}
}

func (h *Hub) Broadcast(event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	frame := []byte("event:" + event + "\ndata:" + string(data) + "\n\n")
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- frame:
		default:
		}
	}
}

func (h *Hub) ServeStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, ch)
		h.mu.Unlock()
		close(ch)
	}()

	_, _ = w.Write([]byte("event:connected\ndata:{}\n\n"))
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			if _, err := w.Write(frame); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// StartNativeAPI starts the Go HTTP surface used during the Node→Go migration.
func StartNativeAPI(addr string, hub *Hub) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","runtime":"go-shell"}`))
	})
	mux.HandleFunc("/api/stream", hub.ServeStream)
	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		log.Printf("[ctrack-engine-go] listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[ctrack-engine-go] api error: %v", err)
		}
	}()
	return srv
}
