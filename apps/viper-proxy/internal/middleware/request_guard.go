package middleware

import (
	"io"
	"net/http"
	"strings"
)

func RequestGuard(maxBytes int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > maxBytes {
			http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			ct := r.Header.Get("Content-Type")
			if ct == "" || !isAllowedContentType(ct) {
				http.Error(w, "content-type required", http.StatusUnsupportedMediaType)
				return
			}
		}
		// Keep upstream auth headers intact; redaction happens in logging path.
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		next.ServeHTTP(w, r)
	})
}

func ReadBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	return io.ReadAll(r.Body)
}

func isAllowedContentType(contentType string) bool {
	lower := strings.ToLower(contentType)
	return strings.Contains(lower, "application/json") || strings.Contains(lower, "text/event-stream")
}
