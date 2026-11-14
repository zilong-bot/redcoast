import { describe, expect, it } from "vitest";
import {
  agentOrder,
  agentState,
  agyHealth,
  agyPace,
  parseAgyMonitor,
  roleName,
  runtimeName,
  runsOutAt,
  tightest,
  usedPerHour,
  type AgyBucket,
  type AgyMonitor,
  type FleetAgent,
} from "./agy";

const now = new Date("2026-11-14T08:30:00Z");

function bucket(over: Partial<AgyBucket> = {}): AgyBucket {
  return {
    id: "gemini-5h",
    name: "Five Hour Limit Remaining",
    window: "5h",
    remaining_fraction: 0.6,
    reset_time: "2026-11-14T10:00:00Z",
    ...over,
  };
}

function monitor(over: Partial<AgyMonitor> = {}): AgyMonitor {
  return { configured: true, history: [], agents: [], ...over };
}

function agent(over: Partial<FleetAgent> = {}): FleetAgent {
  return {
    name: "thread-a",
    role: "thread",
    kind: "agy",
    state: "active",
    started_at: "2026-11-14T08:00:00Z",
    ...over,
  };
}

describe("parseAgyMonitor", () => {
  it("takes the monitor's answer and refuses another shape", () => {
    const m = parseAgyMonitor(
      JSON.stringify({
        configured: true,
        runtime: "agy",
        health: { state: "ok" },
        quota: { groups: [{ name: "Gemini Models", buckets: [bucket()] }] },
        history: [{ at: now.toISOString(), remaining: { "gemini-5h": 0.6 } }],
        agents: [agent()],
      }),
    );
    expect(m.runtime).toBe("agy");
    expect(m.quota?.groups[0]?.buckets[0]?.id).toBe("gemini-5h");
    expect(() => parseAgyMonitor('{"configured": true}')).toThrow();
  });
});

describe("agyPace", () => {
  it("places the even pace by the time left to the reset", () => {
    // 1.5 h of 5 h left: 70% of the window has passed, 40% is used.
    const p = agyPace(bucket(), now);
    expect(p?.elapsed).toBeCloseTo(0.7);
    expect(p?.by).toBe(-30);
  });
  it("has none without a reset ahead within the window", () => {
    const noReset = bucket();
    delete noReset.reset_time;
    expect(agyPace(noReset, now)).toBeNull();
    expect(
      agyPace(bucket({ reset_time: "2026-11-14T08:00:00Z" }), now),
    ).toBeNull();
    expect(
      agyPace(bucket({ reset_time: "2026-11-15T08:00:00Z" }), now),
    ).toBeNull();
    // An unused limit's window has not started: its mark sits at the start.
    expect(agyPace(bucket({ remaining_fraction: 1 }), now)).toEqual({
      elapsed: 0,
      by: 0,
      idle: true,
    });
  });
});

describe("runsOutAt", () => {
  const at = (min: number) =>
    new Date(now.getTime() - min * 60_000).toISOString();
  it("projects the last hour's rate to empty, before the reset", () => {
    // 10 points in 20 minutes, 40 left: empty in 80 minutes, before 10:00.
    const history = [
      { at: at(20), remaining: { "gemini-5h": 0.5 } },
      { at: at(0), remaining: { "gemini-5h": 0.4 } },
    ];
    const out = runsOutAt(history, bucket({ remaining_fraction: 0.4 }), now);
    expect(out?.toISOString()).toBe("2026-11-14T09:50:00.000Z");
  });
  it("is null when idle, after the reset, or across a refill", () => {
    const flat = [
      { at: at(20), remaining: { "gemini-5h": 0.4 } },
      { at: at(0), remaining: { "gemini-5h": 0.4 } },
    ];
    expect(runsOutAt(flat, bucket(), now)).toBeNull();
    const slow = [
      { at: at(60), remaining: { "gemini-5h": 0.41 } },
      { at: at(0), remaining: { "gemini-5h": 0.4 } },
    ];
    expect(runsOutAt(slow, bucket(), now)).toBeNull();
    const refill = [
      { at: at(30), remaining: { "gemini-5h": 0.1 } },
      { at: at(10), remaining: { "gemini-5h": 1 } },
      { at: at(0), remaining: { "gemini-5h": 1 } },
    ];
    expect(runsOutAt(refill, bucket(), now)).toBeNull();
  });
});

describe("usedPerHour", () => {
  it("credits each rise to the hour of the later reading, and no fall", () => {
    const history = [
      { at: "2026-11-14T06:50:00Z", remaining: { "gemini-5h": 0.9 } },
      { at: "2026-11-14T07:10:00Z", remaining: { "gemini-5h": 0.8 } },
      { at: "2026-11-14T07:40:00Z", remaining: { "gemini-5h": 0.75 } },
      { at: "2026-11-14T08:10:00Z", remaining: { "gemini-5h": 1 } },
    ];
    const hours = usedPerHour(history, "gemini-5h", now);
    expect(hours).toHaveLength(25);
    const seven = hours.find((h) => h.hour === "2026-11-14T07:00:00.000Z");
    expect(seven?.points).toBeCloseTo(15);
    expect(hours.at(-1)?.points).toBe(0);
  });
});

describe("states", () => {
  it("reads the health and the tightest limit", () => {
    expect(agyHealth(monitor({ health: { state: "ok" } })).tone).toBe("ok");
    expect(agyHealth(monitor({ health: { state: "signed_out" } })).word).toBe(
      "Signed out",
    );
    expect(agyHealth(monitor({ configured: false })).tone).toBe("off");
    const low = bucket({ id: "w", window: "weekly", remaining_fraction: 0.2 });
    const m = monitor({
      quota: { groups: [{ name: "Gemini Models", buckets: [bucket(), low] }] },
    });
    expect(tightest(m)?.bucket.id).toBe("w");
  });
  it("lists live agents first, newest first", () => {
    const old = agent({ name: "old", started_at: "2026-11-14T07:00:00Z" });
    const ended = agent({
      name: "ended",
      state: "ended",
      started_at: "2026-11-14T08:20:00Z",
    });
    const sorted = [ended, old, agent()].sort(agentOrder).map((a) => a.name);
    expect(sorted).toEqual(["thread-a", "old", "ended"]);
    expect(agentState(agent({ status: "working" })).word).toBe("Working");
    expect(agentState(ended).word).toBe("Ended");
  });
});

describe("names", () => {
  it("names a backend in full, and a role by its backend and model", () => {
    expect(runtimeName("agy")).toBe("Antigravity");
    expect(runtimeName("claude")).toBe("Claude Code");
    expect(roleName({ runtime: "claude", model: "opus" })).toBe(
      "Claude Code · opus",
    );
    expect(roleName({ runtime: "agy" })).toBe("Antigravity");
  });
});
