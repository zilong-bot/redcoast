package claude

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// agyMonitorFile is a monitor file as homeserver's agy-monitor writes it.
const agyMonitorFile = `{"collected_at":"2026-11-14T07:02:47Z","agy_version":"1.5.9","runtime":"agy",
"roles":{"chat":{"runtime":"agy","model":"Gemini 4 Carbon (High)"},"lead":{"runtime":"agy","model":"Gemini 4 Carbon (High)"},"worker":{"runtime":"agy"}},
"health":{"state":"ok","detail":"","checked_at":"2026-11-14T07:02:47Z","last_ok_at":"2026-11-14T07:02:47Z"},
"quota":{"read_at":"2026-11-14T07:02:47Z","groups":[{"name":"Gemini Models","buckets":[
 {"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.75,"reset_time":"2026-11-21T05:22:53Z"},
 {"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":1.2,"reset_time":"2026-11-14T10:22:53Z"}]}]},
"history":[{"at":"2026-11-14T06:57:47Z","remaining":{"gemini-5h":0.99,"gemini-weekly":-0.5}}],
"agents":[{"name":"thread-d0-1","role":"thread","thread":"D0/1.2","parent":"","kind":"agy","model":"","state":"active",
 "started_at":"2026-11-14T06:00:00Z","status":"working"},
 {"name":"j-lead","role":"lead","job":"j","thread":"","parent":"x","kind":"claude","model":"sonnet","state":"ended",
 "started_at":"2026-11-14T05:00:00Z","ended_at":"2026-11-14T05:30:00Z"}],
"unknown_key":"kept out"}`

func writeAgyMonitor(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "monitor.json")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAgyMonitorReadsTheFile(t *testing.T) {
	m := readAgyMonitor(writeAgyMonitor(t, agyMonitorFile))
	if !m.Configured || m.Error != "" || m.UpdatedAt.IsZero() || m.Runtime != "agy" || m.AgyVersion != "1.5.9" {
		t.Fatalf("readAgyMonitor = %+v", m)
	}
	if m.Roles == nil || m.Roles.Chat.Runtime != "agy" || m.Roles.Lead.Model != "Gemini 4 Carbon (High)" || m.Roles.Worker.Model != "" {
		t.Errorf("roles = %+v", m.Roles)
	}
	if m.Health == nil || m.Health.State != "ok" || m.Health.LastOKAt.IsZero() {
		t.Errorf("health = %+v", m.Health)
	}
	b := m.Quota.Groups[0].Buckets
	if len(b) != 2 || b[0].RemainingFraction != 0.75 || b[1].RemainingFraction != 1 || b[0].ResetTime.IsZero() {
		t.Errorf("buckets = %+v (a fraction over 1 is clamped)", b)
	}
	if len(m.History) != 1 || m.History[0].Remaining["gemini-weekly"] != 0 {
		t.Errorf("history = %+v (a fraction under 0 is clamped)", m.History)
	}
	if len(m.Agents) != 2 || m.Agents[0].Kind != "agy" || m.Agents[0].Status != "working" || !m.Agents[0].EndedAt.IsZero() ||
		m.Agents[1].EndedAt.IsZero() || m.Agents[1].Model != "sonnet" {
		t.Errorf("agents = %+v", m.Agents)
	}
}

func TestAgyMonitorWithoutAFileSaysWhyAndNamesNoPath(t *testing.T) {
	dir := t.TempDir()
	if m := readAgyMonitor(""); m.Configured || m.Error != "" || m.History == nil || m.Agents == nil {
		t.Errorf("no file set: %+v", m)
	}
	if m := readAgyMonitor(filepath.Join(dir, "none.json")); !m.Configured || m.Error != "no reading yet" {
		t.Errorf("missing file: %+v", m)
	}
	for _, content := range []string{"not json", `{"runtime":"agy"}`, strings.Repeat(" ", agyMonitorMaxBytes+1)} {
		m := readAgyMonitor(writeAgyMonitor(t, content))
		if m.Error == "" || m.Quota != nil || len(m.Agents) != 0 || strings.Contains(m.Error, dir) {
			t.Errorf("%.20q: %+v", content, m)
		}
	}
}

func TestAgyMonitorRouteServesTheFile(t *testing.T) {
	d := &Dashboard{cfg: DashboardConfig{AgyMonitorFile: writeAgyMonitor(t, agyMonitorFile)}}
	rec := httptest.NewRecorder()
	d.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/agy.json", nil))
	var m AgyMonitor
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &m) != nil || len(m.Agents) != 2 {
		t.Errorf("GET /agy.json = %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "unknown_key") {
		t.Error("a key the monitor does not know is passed through")
	}
}
