package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"vipergo/apps/viper-proxy/internal/config"
	"vipergo/apps/viper-proxy/internal/health"
	"vipergo/apps/viper-proxy/internal/logging"
	"vipergo/apps/viper-proxy/internal/metrics"
	"vipergo/apps/viper-proxy/internal/middleware"
	"vipergo/apps/viper-proxy/internal/proxy"
	"vipergo/apps/viper-proxy/internal/security/input"
	"vipergo/apps/viper-proxy/internal/server"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	wal, err := logging.NewWAL(cfg.WALPath)
	if err != nil {
		log.Fatalf("wal init failed: %v", err)
	}
	sink, err := newLogSink(cfg)
	if err != nil {
		log.Fatalf("log sink init failed: %v", err)
	}
	queue := logging.NewQueue(cfg.LogQueueSize, cfg.LogWorkers, sink, wal)
	queue.ReplayWAL()

	engine, err := input.NewONNXEngine(cfg.ModelPath, cfg.ONNXEndpoint)
	if err != nil {
		log.Fatalf("scanner init failed: %v", err)
	}
	classifier := input.NewClassifier(input.NewTokenizer(), engine)
	gw, err := proxy.NewGateway(cfg.UpstreamURL, classifier, cfg.ThreatScoreThreshold, queue, cfg.StreamTerminateOnLeak, cfg.ScannerFailOpen)
	if err != nil {
		log.Fatalf("gateway init failed: %v", err)
	}

	mux := http.NewServeMux()
	statusFn := func() health.Status {
		degraded := !engine.IsReady() || !queue.Healthy()
		return health.Status{
			ProxyReady:    true,
			ScannerReady:  engine.IsReady() || cfg.ScannerFailOpen,
			LoggerReady:   queue.Healthy(),
			Degraded:      degraded,
			QueueDepth:    queue.QueueDepth(),
			QueueCapacity: queue.QueueCapacity(),
			Version:       "v5.0",
		}
	}
	mux.Handle("/healthz/public", health.Handler(func() health.Status {
		s := statusFn()
		s.QueueDepth = 0
		s.QueueCapacity = 0
		return s
	}))
	mux.Handle("/healthz/operator", health.Handler(statusFn))
	mux.Handle("/healthz", health.Handler(statusFn))
	mux.HandleFunc("/debug/events", debugEventsHandler(cfg))
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(metrics.GetSnapshot())
	})
	mux.Handle("/", middleware.Recovery(middleware.RequestGuard(cfg.RequestMaxBytes, gw)))

	srv := server.New(cfg, mux)
	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutdown requested")
	_ = srv.Stop(context.Background())
	queue.Close()
}

func newLogSink(cfg config.Config) (logging.Sink, error) {
	switch cfg.LogSink {
	case "local":
		return logging.NewLocalWriter(cfg.LocalLogPath), nil
	case "s3":
		awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(), awsconfig.WithRegion(cfg.LogRegion))
		if err != nil {
			return nil, err
		}
		return logging.NewS3Writer(s3.NewFromConfig(awsCfg), cfg.LogBucket), nil
	default:
		return nil, errors.New("unsupported log sink")
	}
}

func debugEventsHandler(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setDebugCORSHeaders(w, cfg.DebugEventsAllowOrigin)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !cfg.AllowDebugEvents {
			http.Error(w, "debug endpoint disabled", http.StatusNotFound)
			return
		}
		provided := r.Header.Get("X-Debug-Token")
		if cfg.DebugEventsToken != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(cfg.DebugEventsToken)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		events := logging.SnapshotLiveEvents(cfg.DebugEventsMax)
		_ = json.NewEncoder(w).Encode(events)
	}
}

func setDebugCORSHeaders(w http.ResponseWriter, allowOrigin string) {
	origin := strings.TrimSpace(allowOrigin)
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-Debug-Token")
}
