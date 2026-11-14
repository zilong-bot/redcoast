package claude

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

// agyMonitorMaxBytes bounds the monitor file read: eight days of quota readings every
// five minutes and a day of agents stay well under it.
const agyMonitorMaxBytes = 4 << 20

// AgyMonitor is GET /agy.json: AGY (the Google Antigravity CLI) and fleet as a timer of
// the user who runs them writes them to a file (homeserver's agy-monitor). The gateway
// does not log in to Google or read fleet: AGY talks to Google itself. Configured is
// false when no file is set; Error says why a set file gave nothing; the rest is the
// file's, with UpdatedAt its modification time, so the page can tell a stale file.
type AgyMonitor struct {
	Configured  bool         `json:"configured"`
	Error       string       `json:"error,omitempty"`
	UpdatedAt   time.Time    `json:"updated_at,omitzero"`
	CollectedAt time.Time    `json:"collected_at,omitzero"`
	AgyVersion  string       `json:"agy_version,omitempty"`
	Runtime     string       `json:"runtime,omitempty"` // claude or agy: what fleet starts new sessions on
	Roles       *FleetRoles  `json:"roles,omitempty"`
	Health      *AgyHealth   `json:"health,omitempty"`
	Quota       *AgyQuota    `json:"quota,omitempty"`
	History     []AgyReading `json:"history"`
	Agents      []FleetAgent `json:"agents"`
}

// FleetRoles are the backend and model each role starts on now: Chat the thread agents
// that answer in Slack, Lead and Worker the agents that do a job's work.
type FleetRoles struct {
	Chat   FleetRole `json:"chat"`
	Lead   FleetRole `json:"lead"`
	Worker FleetRole `json:"worker"`
}

// FleetRole is a backend (claude or agy) and the model it starts with; empty when the
// backend's default is not known.
type FleetRole struct {
	Runtime string `json:"runtime"`
	Model   string `json:"model,omitempty"`
}

// AgyHealth is whether the last quota reading worked: State is ok, exhausted (a limit
// is used up), signed_out or error, with Detail saying why.
type AgyHealth struct {
	State     string    `json:"state"`
	Detail    string    `json:"detail,omitempty"`
	CheckedAt time.Time `json:"checked_at,omitzero"`
	LastOKAt  time.Time `json:"last_ok_at,omitzero"`
}

// AgyQuota is the latest reading of `agy -p /usage`.
type AgyQuota struct {
	ReadAt time.Time  `json:"read_at,omitzero"`
	Groups []AgyGroup `json:"groups"`
}

// AgyGroup is one pool of models that share their limits, such as "Gemini Models".
type AgyGroup struct {
	Name    string      `json:"name"`
	Buckets []AgyBucket `json:"buckets"`
}

// AgyBucket is one limit of a group: Window is "5h" or "weekly", RemainingFraction
// what is left of it, from 0 to 1, and ResetTime when it is full again.
type AgyBucket struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Window            string    `json:"window"`
	RemainingFraction float64   `json:"remaining_fraction"`
	ResetTime         time.Time `json:"reset_time,omitzero"`
}

// AgyReading is one earlier quota reading: each bucket's remaining fraction by its ID.
type AgyReading struct {
	At        time.Time          `json:"at"`
	Remaining map[string]float64 `json:"remaining"`
}

// FleetAgent is one of fleet's agents, live or ended lately: Kind is the backend it
// runs on (claude or agy), State fleet's (starting, active, ended) and Status herdr's
// for a live one (working, idle, done, blocked, or gone when herdr has none).
type FleetAgent struct {
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Job       string    `json:"job,omitempty"`
	Thread    string    `json:"thread,omitempty"`
	Parent    string    `json:"parent,omitempty"`
	Kind      string    `json:"kind"`
	Model     string    `json:"model,omitempty"`
	State     string    `json:"state"`
	Status    string    `json:"status,omitempty"`
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at,omitzero"`
}

// readAgyMonitor reads the monitor file at path. A file that is missing, too large or
// not the monitor's shape gives an Error and nothing else; the text names no path or
// content. Fractions are kept within 0 and 1.
func readAgyMonitor(path string) AgyMonitor {
	m := AgyMonitor{Configured: path != "", History: []AgyReading{}, Agents: []FleetAgent{}}
	if path == "" {
		return m
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		m.Error = "no reading yet"
		return m
	}
	if err != nil {
		m.Error = "monitor file unreadable"
		return m
	}
	defer f.Close()
	var updated time.Time
	if info, err := f.Stat(); err == nil {
		updated = info.ModTime().UTC()
	}
	data, err := io.ReadAll(io.LimitReader(f, agyMonitorMaxBytes+1))
	if err != nil || len(data) > agyMonitorMaxBytes {
		m.Error = "monitor file unreadable"
		return m
	}
	var file AgyMonitor
	if err := json.Unmarshal(data, &file); err != nil || file.CollectedAt.IsZero() {
		m.Error = "monitor file is not agy-monitor's"
		return m
	}
	file.Configured, file.Error, file.UpdatedAt = true, "", updated
	if file.History == nil {
		file.History = []AgyReading{}
	}
	if file.Agents == nil {
		file.Agents = []FleetAgent{}
	}
	if file.Quota != nil {
		for _, g := range file.Quota.Groups {
			for i := range g.Buckets {
				g.Buckets[i].RemainingFraction = clampFraction(g.Buckets[i].RemainingFraction)
			}
		}
	}
	for _, r := range file.History {
		for id, v := range r.Remaining {
			r.Remaining[id] = clampFraction(v)
		}
	}
	return file
}

func clampFraction(v float64) float64 {
	return min(max(v, 0), 1)
}
