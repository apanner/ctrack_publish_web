package instance

import (
	"fmt"
	"os"
	"path/filepath"
)

// Lock provides a single-instance mutex file under ~/.ctrack-engine.
type Lock struct {
	name string
	path string
	file *os.File
}

func New(name string) *Lock {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	return &Lock{
		name: name,
		path: filepath.Join(home, ".ctrack-engine", name),
	}
}

func (l *Lock) Acquire() bool {
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return false
	}
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return false
	}
	_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())
	l.file = f
	return true
}

func (l *Lock) Release() {
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
	_ = os.Remove(l.path)
}
