// AGY (the Google Antigravity CLI) and fleet, as GET /agy.json gives them: a
// file a timer of the user who runs them writes (homeserver's agy-monitor).
// AGY talks to Google itself, so the gateway sees none of its traffic; what
// the page shows of it is its quota readings, its health and fleet's agents.
import { useEffect, useState } from "react";
import {
  arrayOf,
  isBoolean,
  isNumber,
  isString,
  object,
  optional,
  recordOf,
} from "./guard";
import { poller, stopped } from "./poll";
import type { State } from "./stats";

export interface AgyBucket {
  id: string;
  name: string;
  window: string; // "5h" or "weekly"
  remaining_fraction: number;
  reset_time?: string;
}

export interface AgyGroup {
  name: string;
  buckets: AgyBucket[];
}

interface AgyHealth {
  state: string; // ok, exhausted, signed_out, error
  detail?: string;
  checked_at?: string;
  last_ok_at?: string;
}

export interface AgyReading {
  at: string;
  remaining: Record<string, number>;
}

export interface FleetAgent {
  name: string;
  role: string;
  job?: string;
  thread?: string;
  parent?: string;
  kind: string; // claude or agy
  model?: string;
  state: string; // starting, active, ended
  status?: string; // herdr's, for a live agent
  started_at: string;
  ended_at?: string;
}

/** A backend (claude or agy) and the model it starts with. */
export interface FleetRole {
  runtime: string;
  model?: string;
}

/** What each role starts on now: chat answers in Slack, lead and worker do the work. */
export interface FleetRoles {
  chat: FleetRole;
  lead: FleetRole;
  worker: FleetRole;
}

export interface AgyMonitor {
  configured: boolean;
  error?: string;
  updated_at?: string;
  collected_at?: string;
  agy_version?: string;
  runtime?: string;
  roles?: FleetRoles;
  health?: AgyHealth;
  quota?: { read_at?: string; groups: AgyGroup[] };
  history: AgyReading[];
  agents: FleetAgent[];
}

const isBucket = object<AgyBucket>({
  id: isString,
  name: isString,
  window: isString,
  remaining_fraction: isNumber,
  reset_time: optional(isString),
});

const isMonitor = object<AgyMonitor>({
  configured: isBoolean,
  error: optional(isString),
  updated_at: optional(isString),
  collected_at: optional(isString),
  agy_version: optional(isString),
  runtime: optional(isString),
  roles: optional(
    object<FleetRoles>({
      chat: object<FleetRole>({ runtime: isString, model: optional(isString) }),
      lead: object<FleetRole>({ runtime: isString, model: optional(isString) }),
      worker: object<FleetRole>({
        runtime: isString,
        model: optional(isString),
      }),
    }),
  ),
  health: optional(
    object<AgyHealth>({
      state: isString,
      detail: optional(isString),
      checked_at: optional(isString),
      last_ok_at: optional(isString),
    }),
  ),
  quota: optional(
    object<{ read_at?: string; groups: AgyGroup[] }>({
      read_at: optional(isString),
      groups: arrayOf(
        object<AgyGroup>({ name: isString, buckets: arrayOf(isBucket) }),
      ),
    }),
  ),
  history: arrayOf(
    object<AgyReading>({ at: isString, remaining: recordOf(isNumber) }),
  ),
  agents: arrayOf(
    object<FleetAgent>({
      name: isString,
      role: isString,
      job: optional(isString),
      thread: optional(isString),
      parent: optional(isString),
      kind: isString,
      model: optional(isString),
      state: isString,
      status: optional(isString),
      started_at: isString,
      ended_at: optional(isString),
    }),
  ),
});

export function parseAgyMonitor(text: string): AgyMonitor {
  const m: unknown = JSON.parse(text);
  if (!isMonitor(m)) throw new Error("not an AGY monitor answer");
  return m;
}

/**
 * GET /agy.json now and every everyMs; null until the first answer, and a
 * monitor that is not configured when the gateway has no such route.
 */
export function useAgy(everyMs: number): AgyMonitor | null {
  const [monitor, setMonitor] = useState<AgyMonitor | null>(null);
  useEffect(() => {
    const loads = poller(async (signal) => {
      try {
        const response = await fetch("./agy.json", {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const m = parseAgyMonitor(await response.text());
        if (!signal.aborted) setMonitor(m);
      } catch (e) {
        if (!stopped(signal))
          setMonitor({
            configured: false,
            error: String(e),
            history: [],
            agents: [],
          });
      }
    }, 3 * everyMs);
    loads.run();
    const timer = setInterval(loads.run, everyMs);
    return () => {
      loads.stop();
      clearInterval(timer);
    };
  }, [everyMs]);
  return monitor;
}

export const AGY_WINDOW_MS: Record<string, number> = {
  "5h": 5 * 3600_000,
  weekly: 7 * 24 * 3600_000,
};

export function windowLabel(window: string): string {
  return window === "5h"
    ? "5 h window"
    : window === "weekly"
      ? "7 d window"
      : window;
}

/** The share of a bucket used, from 0 to 1. */
export function used(b: AgyBucket): number {
  return 1 - b.remaining_fraction;
}

/**
 * How far through its window a bucket is, as the even pace's mark: the
 * window ends at its reset, so it began one window before. by is the points
 * used beyond an even pace. An unused limit's window has not started
 * (Google starts it at the first use, so its reset stays a whole window
 * away): its mark is at the start, idle. Null without a reset in the future.
 */
export function agyPace(
  b: AgyBucket,
  now: Date,
): { elapsed: number; by: number; idle: boolean } | null {
  const span = AGY_WINDOW_MS[b.window];
  if (span === undefined || b.reset_time === undefined) return null;
  if (used(b) <= 0) return { elapsed: 0, by: 0, idle: true };
  const left = Date.parse(b.reset_time) - now.getTime();
  if (left <= 0 || left > span) return null;
  const elapsed = 1 - left / span;
  return { elapsed, by: Math.round((used(b) - elapsed) * 100), idle: false };
}

/** A bucket's used share at each reading, oldest first. */
export function usedReadings(
  history: AgyReading[],
  id: string,
): { at: string; utilization: number }[] {
  return history.flatMap((r) => {
    const left = r.remaining[id];
    return left === undefined ? [] : [{ at: r.at, utilization: 1 - left }];
  });
}

const BURN_SPAN_MS = 3600_000;

/**
 * When a bucket runs out at the rate of the last hour of readings: null when
 * it is not being used, when that comes after its reset, or with too few
 * readings. A rise in what is left (the window refilling) restarts the span.
 */
export function runsOutAt(
  history: AgyReading[],
  b: AgyBucket,
  now: Date,
): Date | null {
  const readings = usedReadings(history, b.id).filter(
    (r) => Date.parse(r.at) >= now.getTime() - BURN_SPAN_MS,
  );
  let first = 0;
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    if (
      prev !== undefined &&
      cur !== undefined &&
      cur.utilization < prev.utilization
    )
      first = i;
  }
  const a = readings[first];
  const z = readings.at(-1);
  if (a === undefined || z === undefined || a === z) return null;
  const ms = Date.parse(z.at) - Date.parse(a.at);
  const rate = (z.utilization - a.utilization) / ms;
  if (ms <= 0 || rate <= 0) return null;
  const at = new Date(Date.parse(z.at) + (1 - z.utilization) / rate);
  if (b.reset_time !== undefined && at.getTime() >= Date.parse(b.reset_time))
    return null;
  return at;
}

const HOUR_MS = 3600_000;

/**
 * The points of a bucket used in each of the 25 UTC hours up to now, oldest
 * first: the rise in its used share between readings, credited to the hour
 * of the later one. A fall (the window refilling) counts as none.
 */
export function usedPerHour(
  history: AgyReading[],
  id: string,
  now: Date,
): { hour: string; points: number }[] {
  const last = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const hours: { hour: string; points: number }[] = [];
  const index = new Map<number, { hour: string; points: number }>();
  for (let t = last - 24 * HOUR_MS; t <= last; t += HOUR_MS) {
    const h = { hour: new Date(t).toISOString(), points: 0 };
    hours.push(h);
    index.set(t, h);
  }
  const readings = usedReadings(history, id);
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    if (prev === undefined || cur === undefined) continue;
    const rise = cur.utilization - prev.utilization;
    const h = index.get(Math.floor(Date.parse(cur.at) / HOUR_MS) * HOUR_MS);
    if (h !== undefined && rise > 0) h.points += rise * 100;
  }
  return hours;
}

/** AGY's health as a state word, from the monitor. */
export function agyHealth(m: AgyMonitor): State {
  if (!m.configured) return { tone: "off", word: "Not set up" };
  if (m.error !== undefined) return { tone: "warn", word: "No reading" };
  return (
    HEALTH_STATES[m.health?.state ?? ""] ?? { tone: "bad", word: "Failing" }
  );
}

const HEALTH_STATES: Record<string, State> = {
  ok: { tone: "ok", word: "Working" },
  exhausted: { tone: "bad", word: "Quota used up" },
  signed_out: { tone: "bad", word: "Signed out" },
};

/** The bucket with the least left, over every group. */
export function tightest(
  m: AgyMonitor,
): { group: AgyGroup; bucket: AgyBucket } | null {
  let best: { group: AgyGroup; bucket: AgyBucket } | null = null;
  for (const group of m.quota?.groups ?? [])
    for (const bucket of group.buckets)
      if (
        best === null ||
        bucket.remaining_fraction < best.bucket.remaining_fraction
      )
        best = { group, bucket };
  return best;
}

/** A role's backend and model, as the page names them. */
export function roleName(r: FleetRole): string {
  return r.model === undefined || r.model === ""
    ? runtimeName(r.runtime)
    : `${runtimeName(r.runtime)} · ${r.model}`;
}

export function runtimeName(kind: string | undefined): string {
  return kind === "agy" ? "Antigravity" : kind === "pi" ? "Pi" : "Claude Code";
}

/** A live agent first, newest first within each. */
export function agentOrder(a: FleetAgent, b: FleetAgent): number {
  const ended = (x: FleetAgent) => (x.state === "ended" ? 1 : 0);
  const byState = ended(a) - ended(b);
  return byState !== 0
    ? byState
    : Date.parse(b.started_at) - Date.parse(a.started_at);
}

/** A fleet agent's state as a word with a tone. */
export function agentState(a: FleetAgent): State {
  if (a.state === "ended") return { tone: "off", word: "Ended" };
  if (a.state === "starting") return { tone: "info", word: "Starting" };
  const status = a.status ?? "";
  return (
    AGENT_STATES[status] ?? {
      tone: "off",
      word: status === "" ? "Unknown" : status,
    }
  );
}

const AGENT_STATES: Record<string, State> = {
  working: { tone: "ok", word: "Working" },
  idle: { tone: "info", word: "Idle" },
  done: { tone: "info", word: "Idle" },
  blocked: { tone: "warn", word: "Blocked" },
  gone: { tone: "bad", word: "Gone from herdr" },
};
