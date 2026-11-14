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

// agyUsage is the data of `agy -p /usage --output-format json`, as agy 1.5.8 gives it.
const agyUsage = `{"description":"Within each group...","groups":[
{"name":"Gemini Models","description":"Models within this group: Gemini 4 Carbon","buckets":[
 {"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.75,"reset_time":"2026-11-21T05:22:53Z"},
 {"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":1.2,"reset_time":"2026-11-14T10:22:53Z"}]},
{"name":"Claude and GPT models","buckets":[{"id":"3p-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":1}]}]}`

func TestAgyQuotaReadsTheCLIUsageData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	if err := os.WriteFile(path, []byte(agyUsage), 0o644); err != nil {
		t.Fatal(err)
	}
	q := readAgyQuota(path)
	if !q.Configured || q.Error != "" || len(q.Groups) != 2 || q.UpdatedAt.IsZero() {
		t.Fatalf("readAgyQuota = %+v", q)
	}
	g := q.Groups[0]
	if g.Name != "Gemini Models" || len(g.Buckets) != 2 || g.Buckets[0].Window != "weekly" ||
		g.Buckets[0].RemainingFraction != 0.75 || g.Buckets[0].ResetTime.IsZero() {
		t.Errorf("first group = %+v", g)
	}
	if g.Buckets[1].RemainingFraction != 1 {
		t.Errorf("a fraction over 1 is not clamped: %v", g.Buckets[1].RemainingFraction)
	}
}

func TestAgyQuotaWithoutAReadingSaysWhyAndNamesNoPath(t *testing.T) {
	dir := t.TempDir()
	if q := readAgyQuota(""); q.Configured || q.Error != "" || q.Groups == nil {
		t.Errorf("no file set: %+v", q)
	}
	if q := readAgyQuota(filepath.Join(dir, "none.json")); !q.Configured || q.Error != "no reading yet" {
		t.Errorf("missing file: %+v", q)
	}
	bad := filepath.Join(dir, "bad.json")
	for _, content := range []string{"not json", `{"groups":[]}`, strings.Repeat(" ", agyQuotaMaxBytes+1)} {
		if err := os.WriteFile(bad, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		q := readAgyQuota(bad)
		if q.Error == "" || len(q.Groups) != 0 || strings.Contains(q.Error, dir) {
			t.Errorf("%.20q: %+v", content, q)
		}
	}
}

func TestAgyQuotaRouteServesTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	if err := os.WriteFile(path, []byte(agyUsage), 0o644); err != nil {
		t.Fatal(err)
	}
	d := &Dashboard{cfg: DashboardConfig{AgyQuotaFile: path}}
	rec := httptest.NewRecorder()
	d.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/agy-quota.json", nil))
	var q AgyQuota
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &q) != nil || len(q.Groups) != 2 {
		t.Errorf("GET /agy-quota.json = %d %s", rec.Code, rec.Body.String())
	}
}
