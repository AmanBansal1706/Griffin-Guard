package logging

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
)

type WAL struct {
	mu   sync.Mutex
	path string
}

func NewWAL(path string) (*WAL, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return &WAL{path: path}, nil
}

func (w *WAL) Append(e Event) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	return enc.Encode(e)
}

func (w *WAL) Replay(fn func(Event) error) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_RDONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	reader := bufio.NewReader(f)
	acked := make([][]byte, 0, 128)
	pending := make([][]byte, 0, 128)

	for {
		line, err := reader.ReadBytes('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		if len(bytes.TrimSpace(line)) > 0 {
			var e Event
			if jerr := json.Unmarshal(line, &e); jerr == nil {
				if ferr := fn(e); ferr == nil {
					acked = append(acked, line)
				} else {
					pending = append(pending, line)
				}
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
	}

	tmpPath := w.path + ".tmp"
	tmp, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	for _, p := range pending {
		if _, err := tmp.Write(p); err != nil {
			_ = tmp.Close()
			return err
		}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if len(acked) > 0 {
		if err := os.Rename(tmpPath, w.path); err != nil {
			return err
		}
	} else {
		_ = os.Remove(tmpPath)
	}
	return nil
}
