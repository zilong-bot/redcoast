package claude

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

// agyQuotaMaxBytes bounds the quota file read: the CLI's answer is a few hundred bytes.
const agyQuotaMaxBytes = 64 << 10

// AgyQuota is GET /agy-quota.json: the quota of the Google Antigravity CLI (`agy`)
// account that runs beside this gateway. agy keeps its login to itself, so the
// gateway does not ask Google: a timer of the user that runs agy writes the `data` of
// `agy -p /usage --output-format json` to a file, which this reads. Configured is false
// when no file is set; Error says why a set file gave no reading; UpdatedAt is the
// file's modification time, so the page can tell a stale reading.
type AgyQuota struct {
	Configured bool       `json:"configured"`
	UpdatedAt  time.Time  `json:"updated_at,omitzero"`
	Groups     []AgyGroup `json:"groups"`
	Error      string     `json:"error,omitempty"`
}

// AgyGroup is one pool of models that share their limits, such as "Gemini Models".
type AgyGroup struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Buckets     []AgyBucket `json:"buckets"`
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

// readAgyQuota reads the quota file at path. A file that is missing, too large or not
// the CLI's shape gives an Error and no groups; the text names no path or content.
func readAgyQuota(path string) AgyQuota {
	q := AgyQuota{Configured: path != "", Groups: []AgyGroup{}}
	if path == "" {
		return q
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		q.Error = "no reading yet"
		return q
	}
	if err != nil {
		q.Error = "quota file unreadable"
		return q
	}
	defer f.Close()
	if info, err := f.Stat(); err == nil {
		q.UpdatedAt = info.ModTime().UTC()
	}
	data, err := io.ReadAll(io.LimitReader(f, agyQuotaMaxBytes+1))
	if err != nil || len(data) > agyQuotaMaxBytes {
		q.Error = "quota file unreadable"
		return q
	}
	var file struct {
		Groups []AgyGroup `json:"groups"`
	}
	if err := json.Unmarshal(data, &file); err != nil || len(file.Groups) == 0 {
		q.Error = "quota file is not the CLI's usage data"
		return q
	}
	for _, g := range file.Groups {
		for i, b := range g.Buckets {
			g.Buckets[i].RemainingFraction = min(max(b.RemainingFraction, 0), 1)
		}
		if g.Buckets == nil {
			g.Buckets = []AgyBucket{}
		}
	}
	q.Groups = file.Groups
	return q
}
