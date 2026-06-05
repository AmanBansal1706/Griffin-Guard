package logging

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type LocalWriter struct {
	path string
	mu   sync.Mutex
}

func NewLocalWriter(path string) *LocalWriter {
	return &LocalWriter{path: path}
}

func (l *LocalWriter) Write(_ context.Context, e Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	return enc.Encode(e)
}
