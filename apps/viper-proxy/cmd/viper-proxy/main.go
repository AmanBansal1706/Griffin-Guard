package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"vipergo/apps/viper-proxy/internal/config"
	"vipergo/apps/viper-proxy/internal/health"
	"vipergo/apps/viper-proxy/internal/logging"
	"vipergo/apps/viper-proxy/internal/middleware"
	"vipergo/apps/viper-proxy/internal/proxy"
	"vipergo/apps/viper-proxy/internal/security/input"
	"vipergo/apps/viper-proxy/internal/server"
)

func main() {
	cfg := config.Load()

	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(), awsconfig.WithRegion(cfg.LogRegion))
	if err != nil {
		log.Fatalf("aws config failed: %v", err)
	}
	wal, err := logging.NewWAL(cfg.WALPath)
	if err != nil {
		log.Fatalf("wal init failed: %v", err)
	}
	queue := logging.NewQueue(cfg.LogQueueSize, cfg.LogWorkers, logging.NewS3Writer(s3.NewFromConfig(awsCfg), cfg.LogBucket), wal)
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
	mux.Handle("/healthz", health.Handler(func() health.Status {
		return health.Status{
			ProxyReady:   true,
			ScannerReady: engine.IsReady() || cfg.ScannerFailOpen,
			LoggerReady:  queue.Healthy(),
			Version:      "v5.0",
		}
	}))
	mux.HandleFunc("/debug/events", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		events := logging.SnapshotLiveEvents(500)
		_ = json.NewEncoder(w).Encode(events)
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
