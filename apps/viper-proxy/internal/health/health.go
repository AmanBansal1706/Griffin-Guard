package health

import (
	"encoding/json"
	"net/http"
)

type Status struct {
	ProxyReady   bool `json:"proxy_ready"`
	ScannerReady bool `json:"scanner_ready"`
	LoggerReady  bool `json:"logger_ready"`
	Version      string `json:"version"`
}

func Handler(statusFn func() Status) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := statusFn()
		if !status.ProxyReady || !status.ScannerReady || !status.LoggerReady {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(status)
	})
}
