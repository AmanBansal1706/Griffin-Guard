package logging

import (
	"context"
	"log"
	"sync/atomic"
	"sync"
	"time"
)

type Sink interface {
	Write(context.Context, Event) error
}

type Queue struct {
	ch      chan Event
	sink    Sink
	wal     *WAL
	cb      *CircuitBreaker
	wg      sync.WaitGroup
	closed  atomic.Bool
	dropped uint64
}

func NewQueue(size int, workers int, sink Sink, wal *WAL) *Queue {
	q := &Queue{
		ch:     make(chan Event, size),
		sink:   sink,
		wal:    wal,
		cb:     NewCircuitBreaker(10, 10*time.Second),
	}
	for i := 0; i < workers; i++ {
		q.wg.Add(1)
		go q.worker()
	}
	return q
}

func (q *Queue) Enqueue(e Event) {
	if q.closed.Load() {
		_ = q.wal.Append(e)
		return
	}
	select {
	case q.ch <- e:
	default:
		_ = q.wal.Append(e)
	}
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for e := range q.ch {
		if !q.cb.Allow() {
			_ = q.wal.Append(e)
			continue
		}
		if err := q.sink.Write(context.Background(), e); err != nil {
			q.cb.RecordFailure()
			_ = q.wal.Append(e)
			continue
		}
		q.cb.RecordSuccess()
	}
}

func (q *Queue) Healthy() bool {
	return q.cb.Allow() || len(q.ch) < cap(q.ch)
}

func (q *Queue) Close() {
	if q.closed.Swap(true) {
		return
	}
	close(q.ch)
	q.wg.Wait()
}

func (q *Queue) ReplayWAL() {
	if err := q.wal.Replay(func(e Event) error {
		return q.sink.Write(context.Background(), e)
	}); err != nil {
		log.Printf("wal replay failed: %v", err)
	}
}

func (q *Queue) drainContext(ctx context.Context) error {
	for {
		if len(q.ch) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}
