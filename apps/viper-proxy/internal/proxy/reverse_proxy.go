package proxy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"vipergo/apps/viper-proxy/internal/logging"
	"vipergo/apps/viper-proxy/internal/security/input"
	"vipergo/apps/viper-proxy/internal/security/output"
)

type Gateway struct {
	upstream        *url.URL
	client          *http.Client
	classifier      *input.Classifier
	threshold       float64
	logQueue        *logging.Queue
	terminateOnLeak bool
	scannerFailOpen bool
}

func NewGateway(upstream string, classifier *input.Classifier, threshold float64, logQueue *logging.Queue, terminateOnLeak bool, scannerFailOpen bool) (*Gateway, error) {
	u, err := url.Parse(upstream)
	if err != nil {
		return nil, err
	}
	return &Gateway{
		upstream:        u,
		client: &http.Client{
			Timeout: 90 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1024,
				MaxIdleConnsPerHost: 512,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		classifier:      classifier,
		threshold:       threshold,
		logQueue:        logQueue,
		terminateOnLeak: terminateOnLeak,
		scannerFailOpen: scannerFailOpen,
	}, nil
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	requestID := uuid.NewString()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err = r.Body.Close(); err != nil {
		http.Error(w, "failed to close request body", http.StatusBadRequest)
		return
	}

	score, scoreErr := g.classifier.Score(r.Context(), string(body))
	if scoreErr != nil && !g.scannerFailOpen {
		http.Error(w, "scanner unavailable", http.StatusServiceUnavailable)
		return
	}
	if score > g.threshold {
		http.Error(w, input.ExplainDecision(score, g.threshold), http.StatusForbidden)
		event := logging.Event{
			Timestamp:    time.Now().UTC(),
			RequestID:    requestID,
			Method:       r.Method,
			Path:         r.URL.Path,
			Upstream:     g.upstream.String(),
			InputScore:   score,
			InputBlocked: true,
			Action:       "block_input",
			StatusCode:   http.StatusForbidden,
			LatencyMs:    time.Since(start).Milliseconds(),
			PolicyVersion: "v5.0",
		}
		g.logQueue.Enqueue(event)
		logging.PublishLiveEvent(event)
		return
	}

	upstreamURL := g.upstream.ResolveReference(&url.URL{
		Path:     strings.TrimRight(g.upstream.Path, "/") + "/" + strings.TrimLeft(r.URL.Path, "/"),
		RawQuery: r.URL.RawQuery,
	})
	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		http.Error(w, "failed to build upstream request", http.StatusBadGateway)
		return
	}
	upstreamReq.Header = r.Header.Clone()

	resp, err := g.client.Do(upstreamReq)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	streamRes, streamErr := output.InterceptAndWrite(w, resp.Body, g.terminateOnLeak)
	if streamErr != nil {
		if !errors.Is(streamErr, context.Canceled) {
			http.Error(w, "stream interception failed", http.StatusBadGateway)
		}
		return
	}

	action := "allow"
	if streamRes.AnyLeakSeen && streamRes.Terminated {
		action = "terminate_stream"
	} else if streamRes.AnyLeakSeen {
		action = "redact_stream"
	}
	event := logging.Event{
		Timestamp:     time.Now().UTC(),
		RequestID:     requestID,
		Method:        r.Method,
		Path:          r.URL.Path,
		Upstream:      g.upstream.String(),
		InputScore:    score,
		InputBlocked:  false,
		OutputLeak:    streamRes.AnyLeakSeen,
		LeakTypes:     streamRes.LeakTypes,
		Action:        action,
		StatusCode:    resp.StatusCode,
		LatencyMs:     time.Since(start).Milliseconds(),
		PolicyVersion: "v5.0",
	}
	g.logQueue.Enqueue(event)
	logging.PublishLiveEvent(event)
}
