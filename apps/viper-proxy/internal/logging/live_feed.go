package logging

import "sync"

var (
	liveMu     sync.RWMutex
	liveEvents []Event
	liveCap    = 5000
)

func PublishLiveEvent(e Event) {
	liveMu.Lock()
	defer liveMu.Unlock()
	liveEvents = append(liveEvents, e)
	if len(liveEvents) > liveCap {
		liveEvents = liveEvents[len(liveEvents)-liveCap:]
	}
}

func SnapshotLiveEvents(limit int) []Event {
	liveMu.RLock()
	defer liveMu.RUnlock()
	if limit <= 0 || limit > len(liveEvents) {
		limit = len(liveEvents)
	}
	out := make([]Event, limit)
	copy(out, liveEvents[len(liveEvents)-limit:])
	return out
}
