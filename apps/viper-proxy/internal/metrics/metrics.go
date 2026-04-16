package metrics

import (
	"sync"
	"sync/atomic"
)

type Snapshot struct {
	RequestsTotal           uint64            `json:"requests_total"`
	RequestsBlockedTotal    uint64            `json:"requests_blocked_total"`
	ScannerFailuresTotal    uint64            `json:"scanner_failures_total"`
	UpstreamFailuresTotal   uint64            `json:"upstream_failures_total"`
	OutputLeaksTotal        uint64            `json:"output_leaks_total"`
	StreamTerminationsTotal uint64            `json:"stream_terminations_total"`
	DecisionsByAction       map[string]uint64 `json:"decisions_by_action"`
	StatusByClass           map[string]uint64 `json:"status_by_class"`
	TotalLatencyMs          uint64            `json:"total_latency_ms"`
	AvgLatencyMs            float64           `json:"avg_latency_ms"`
}

var (
	requestsTotal           atomic.Uint64
	requestsBlockedTotal    atomic.Uint64
	scannerFailuresTotal    atomic.Uint64
	upstreamFailuresTotal   atomic.Uint64
	outputLeaksTotal        atomic.Uint64
	streamTerminationsTotal atomic.Uint64
	totalLatencyMs          atomic.Uint64

	mu        sync.Mutex
	actionMap = map[string]uint64{}
	statusMap = map[string]uint64{}
)

func RecordRequest(latencyMs int64) {
	requestsTotal.Add(1)
	if latencyMs > 0 {
		totalLatencyMs.Add(uint64(latencyMs))
	}
}

func RecordBlocked() {
	requestsBlockedTotal.Add(1)
}

func RecordScannerFailure() {
	scannerFailuresTotal.Add(1)
}

func RecordUpstreamFailure() {
	upstreamFailuresTotal.Add(1)
}

func RecordOutputLeak(terminated bool) {
	outputLeaksTotal.Add(1)
	if terminated {
		streamTerminationsTotal.Add(1)
	}
}

func RecordAction(action string) {
	mu.Lock()
	defer mu.Unlock()
	actionMap[action]++
}

func RecordStatus(code int) {
	class := "5xx"
	switch {
	case code >= 200 && code < 300:
		class = "2xx"
	case code >= 300 && code < 400:
		class = "3xx"
	case code >= 400 && code < 500:
		class = "4xx"
	}
	mu.Lock()
	defer mu.Unlock()
	statusMap[class]++
}

func GetSnapshot() Snapshot {
	s := Snapshot{
		RequestsTotal:           requestsTotal.Load(),
		RequestsBlockedTotal:    requestsBlockedTotal.Load(),
		ScannerFailuresTotal:    scannerFailuresTotal.Load(),
		UpstreamFailuresTotal:   upstreamFailuresTotal.Load(),
		OutputLeaksTotal:        outputLeaksTotal.Load(),
		StreamTerminationsTotal: streamTerminationsTotal.Load(),
		TotalLatencyMs:          totalLatencyMs.Load(),
	}

	mu.Lock()
	s.DecisionsByAction = make(map[string]uint64, len(actionMap))
	for k, v := range actionMap {
		s.DecisionsByAction[k] = v
	}
	s.StatusByClass = make(map[string]uint64, len(statusMap))
	for k, v := range statusMap {
		s.StatusByClass[k] = v
	}
	mu.Unlock()

	if s.RequestsTotal > 0 {
		s.AvgLatencyMs = float64(s.TotalLatencyMs) / float64(s.RequestsTotal)
	}
	return s
}
