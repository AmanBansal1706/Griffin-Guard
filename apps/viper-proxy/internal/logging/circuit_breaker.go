package logging

import (
	"sync/atomic"
	"time"
)

type CircuitBreaker struct {
	failures      atomic.Int64
	openedUntilNs atomic.Int64
	threshold     int64
	openWindow    time.Duration
}

func NewCircuitBreaker(threshold int64, openWindow time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		threshold:  threshold,
		openWindow: openWindow,
	}
}

func (c *CircuitBreaker) Allow() bool {
	return time.Now().UnixNano() >= c.openedUntilNs.Load()
}

func (c *CircuitBreaker) RecordSuccess() {
	c.failures.Store(0)
}

func (c *CircuitBreaker) RecordFailure() {
	n := c.failures.Add(1)
	if n >= c.threshold {
		c.openedUntilNs.Store(time.Now().Add(c.openWindow).UnixNano())
		c.failures.Store(0)
	}
}
