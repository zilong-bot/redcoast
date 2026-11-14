import {
  formatClock,
  formatHourSpan,
  formatPercent,
  formatUntil,
} from "../lib/format";
import {
  agentOrder,
  agyHealth,
  agyPace,
  AGY_WINDOW_MS,
  runsOutAt,
  tightest,
  used,
  usedPerHour,
  usedReadings,
  windowLabel,
  type AgyBucket,
  type AgyMonitor,
} from "../lib/agy";
import { routeHref } from "../lib/route";
import type { Tone } from "../lib/stats";
import { HourBars, QuotaCurve } from "./charts";
import { AgentsTable } from "./Fleet";
import { Ago, Empty, PageHead, PaceText, Section, Status, Time } from "./ui";

// The quota tiers of AGY's limits: Google gives no soft limit, so these only
// ink the bar.
function toneOf(u: number): Tone {
  return u >= 0.95 ? "bad" : u >= 0.8 ? "warn" : "ok";
}

/**
 * One AGY limit: the used share as a bar with the even pace through the
 * window as a hollow mark (as the Claude windows have), then the reset, the
 * pace and, at the last hour's rate, when it runs out.
 */
export function AgyMeter({
  bucket,
  monitor,
  now,
}: {
  bucket: AgyBucket | undefined;
  monitor: AgyMonitor;
  now: Date;
}) {
  if (bucket === undefined)
    return <span className="muted small">No reading</span>;
  const u = used(bucket);
  const p = agyPace(bucket, now);
  const out = runsOutAt(monitor.history, bucket, now);
  return (
    <div className={`meter s-${toneOf(u)}`}>
      <div className="track">
        <div
          className="fill"
          style={{ width: `${String(Math.min(u, 1) * 100)}%` }}
        />
        {p === null ? null : (
          <div
            className="even"
            // Kept inside the track, so a mark near either end does not
            // stick out past the bars of the rows above and below.
            style={{
              left: `clamp(calc(var(--t-height-meter) / 2), ${(Math.min(p.elapsed, 1) * 100).toFixed(1)}%, calc(100% - var(--t-height-meter) / 2))`,
            }}
            title={`Even pace: ${formatPercent(p.elapsed)} of the window has passed`}
          />
        )}
      </div>
      <span className="pct">{formatPercent(u)}</span>
      <span className="when">
        <span>
          {bucket.reset_time === undefined ? (
            "reset unknown"
          ) : (
            <Time iso={bucket.reset_time}>
              resets {formatUntil(bucket.reset_time, now)}
            </Time>
          )}
        </span>
        {p === null ? null : <PaceText by={p.by} />}
        {out === null ? null : (
          <span className="s-warn" title="At the rate of the last hour">
            runs out {formatUntil(out.toISOString(), now)}
          </span>
        )}
      </span>
    </div>
  );
}

/** The quota of every model group, one row each, its two windows side by side. */
function QuotaTable({ m, now }: { m: AgyMonitor; now: Date }) {
  const groups = m.quota?.groups ?? [];
  if (groups.length === 0)
    return (
      <Empty title="No quota reading.">
        {m.error ??
          m.health?.detail ??
          "The monitor has not read Antigravity's quota yet."}
      </Empty>
    );
  return (
    <div className="table-wrap scroll">
      <table className="quota-table">
        <thead>
          <tr>
            <th scope="col">Model group</th>
            <th scope="col" className="win">
              5 h window
            </th>
            <th scope="col" className="win">
              7 d window
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.name}>
              <td className="two wrap">
                <div className="client-name">{g.name}</div>
              </td>
              {(["5h", "weekly"] as const).map((w) => (
                <td className="two" key={w}>
                  <AgyMeter
                    bucket={g.buckets.find((b) => b.window === w)}
                    monitor={m}
                    now={now}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stale(m: AgyMonitor, now: Date): boolean {
  return (
    m.collected_at !== undefined &&
    now.getTime() - Date.parse(m.collected_at) > 5 * 60_000
  );
}

/** Why there is nothing to show: the gateway has no monitor file set. */
function NotSetUp() {
  return (
    <Empty title="Antigravity is not monitored here.">
      This gateway has no <code>agy_monitor_file</code> configured.
    </Empty>
  );
}

/** The three facts at the top of the Antigravity pages. */
function AgyStrip({ m, now }: { m: AgyMonitor; now: Date }) {
  const t = tightest(m);
  const live = m.agents.filter((a) => a.kind === "agy" && a.state !== "ended");
  return (
    <div className="strip three">
      <div>
        <div className="k">Health</div>
        <div className="v">
          <Status state={agyHealth(m)} pill />
        </div>
        <div className="reason">
          {m.health?.state === "ok" || m.health?.detail === undefined ? (
            m.health?.checked_at === undefined ? null : (
              <>
                Checked <Ago iso={m.health.checked_at} now={now} />
              </>
            )
          ) : (
            m.health.detail
          )}
        </div>
      </div>
      <div>
        <div className="k">Antigravity agents</div>
        <div className="v">
          <span className="num">{live.length}</span> live
        </div>
        <div className="reason">
          <a
            href={routeHref({ view: "agents", arg: "agy" })}
            className="text-link"
          >
            View
          </a>
        </div>
      </div>
      <div>
        <div className="k">Least left</div>
        <div className="v">
          {t === null ? (
            "—"
          ) : (
            <>
              <span className="num">
                {formatPercent(t.bucket.remaining_fraction)}
              </span>{" "}
              left
            </>
          )}
        </div>
        <div className="reason">
          {t === null
            ? null
            : `${t.group.name}, ${windowLabel(t.bucket.window)}`}
        </div>
      </div>
    </div>
  );
}

function headSub(m: AgyMonitor, now: Date) {
  return (
    <>
      Google Antigravity CLI (AGY)
      {m.agy_version === undefined || m.agy_version === ""
        ? ""
        : ` · v${m.agy_version}`}
      {m.collected_at === undefined ? null : (
        <>
          {" "}
          · read <Ago iso={m.collected_at} now={now} />
          {stale(m, now) ? (
            <>
              {" "}
              <Status state={{ tone: "warn", word: "stale" }} />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

/** Each hour's use of a group's 5 h window, from the quota readings. */
function UsedPerHour({ m, now }: { m: AgyMonitor; now: Date }) {
  const groups = (m.quota?.groups ?? []).flatMap((g) => {
    const b = g.buckets.find((x) => x.window === "5h");
    return b === undefined ? [] : [{ g, b }];
  });
  if (groups.length === 0) return <Empty title="No quota readings yet." />;
  return (
    <div className="two-col even">
      {groups.map(({ g, b }) => {
        const hours = usedPerHour(m.history, b.id, now);
        const total = hours.reduce((s, h) => s + h.points, 0);
        return (
          <div className="panel" key={b.id}>
            <h3 className="panel-title">{g.name}</h3>
            <HourBars
              label={`${g.name}: ${total.toFixed(1)} points of the 5 h window used over the last 24 h`}
              hours={hours.map((h) => h.hour)}
              values={hours.map((h) => h.points)}
              tip={(i) => {
                const h = hours[i];
                return h === undefined ? null : (
                  <>
                    <b>{formatHourSpan(h.hour)}</b>
                    <br />
                    Used: {h.points.toFixed(1)} points of the 5 h window
                  </>
                );
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** AGY → Overview: health, the runtime, the quota and the last day's use. */
export function AgyOverview({ m, now }: { m: AgyMonitor | null; now: Date }) {
  if (m === null) return <p className="muted">Loading…</p>;
  if (!m.configured) return <NotSetUp />;
  const live = m.agents.filter((a) => a.kind === "agy" && a.state !== "ended");
  return (
    <>
      <PageHead title="Antigravity" sub={headSub(m, now)} />
      <AgyStrip m={m} now={now} />
      <Section
        title="Quota"
        note="Used share of each limit; the hollow mark is an even pace through the window"
      >
        <QuotaTable m={m} now={now} />
      </Section>
      <Section
        title="Used per hour"
        note="Points of each group's 5 h window, last 24 h, UTC, from the quota readings"
      >
        <UsedPerHour m={m} now={now} />
      </Section>
      <Section
        title="Live Antigravity agents"
        action={
          <a
            href={routeHref({ view: "agents", arg: "agy" })}
            className="text-link"
          >
            All Antigravity agents
          </a>
        }
      >
        <AgentsTable agents={[...live].sort(agentOrder)} now={now} />
      </Section>
    </>
  );
}

/** AGY → Quota: each group's two windows with their history. */
export function AgyQuota({ m, now }: { m: AgyMonitor | null; now: Date }) {
  if (m === null) return <p className="muted">Loading…</p>;
  if (!m.configured) return <NotSetUp />;
  const groups = m.quota?.groups ?? [];
  return (
    <>
      <PageHead title="Quota" sub={headSub(m, now)} />
      {groups.length === 0 ? (
        <QuotaTable m={m} now={now} />
      ) : (
        groups.map((g) => (
          <Section key={g.name} title={g.name}>
            <div className="two-col even">
              {(["5h", "weekly"] as const).map((w) => {
                const b = g.buckets.find((x) => x.window === w);
                const span = AGY_WINDOW_MS[w] ?? 1;
                const to = now.getTime();
                const readings =
                  b === undefined
                    ? []
                    : usedReadings(m.history, b.id).filter(
                        (r) => Date.parse(r.at) >= to - span,
                      );
                return (
                  <div className="panel" key={w}>
                    <h3 className="panel-title">{windowLabel(w)}</h3>
                    <AgyMeter bucket={b} monitor={m} now={now} />
                    {readings.length === 0 ? null : (
                      <>
                        <QuotaCurve
                          label={`${g.name}, ${windowLabel(w)}: ${String(readings.length)} readings`}
                          readings={readings}
                          from={to - span}
                          to={to}
                          soft={null}
                          reset={null}
                        />
                        <div className="curve-axis">
                          <span>{w === "5h" ? "5 h" : "7 d"} ago</span>
                          <span>now</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        ))
      )}
      <Section title="Readings">
        <p className="muted small">
          A reading is Antigravity&apos;s own <code>/usage</code>, taken every 5
          minutes without spending quota
          {m.quota?.read_at === undefined ? null : (
            <>; the last at {formatClock(m.quota.read_at)} UTC</>
          )}
          . {m.history.length} readings kept, up to 8 days.
        </p>
      </Section>
    </>
  );
}
