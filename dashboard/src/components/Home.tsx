import {
  agyHealth,
  roleName,
  type AgyMonitor,
  type FleetRole,
} from "../lib/agy";
import { routeHref } from "../lib/route";
import { accountState } from "../lib/stats";
import type { Dashboard } from "../lib/types";
import { AgyMeter } from "./Agy";
import { Empty, Meter, PageHead, Status } from "./ui";

/** One of fleet's settings, as a large card: what a role runs on now. */
function SettingCard({
  title,
  note,
  role,
}: {
  title: string;
  note: string;
  role: FleetRole | undefined;
}) {
  return (
    <div className="big-card">
      <div className="k">{title}</div>
      <div className="big">{role === undefined ? "—" : roleName(role)}</div>
      <div className="small muted">{note}</div>
    </div>
  );
}

/** Claude Code's quota: each account's two windows, as on Accounts. */
function ClaudeQuota({ data, now }: { data: Dashboard | null; now: Date }) {
  return (
    <div className="big-card">
      <div className="card-head">
        <span className="title">Claude Code</span>
        <a href={routeHref({ view: "accounts" })} className="text-link small">
          Accounts
        </a>
      </div>
      {data === null ? (
        <p className="muted">Loading…</p>
      ) : data.accounts.length === 0 ? (
        <Empty title="No accounts." />
      ) : (
        data.accounts.map((a) => (
          <div className="quota-block" key={a.alias}>
            <div className="quota-name">
              <span className="client-name">{a.alias}</span>
              <Status state={accountState(a, data.soft, data.hard, now)} />
            </div>
            {(["5h", "7d"] as const).map((w) => (
              <div className="quota-line" key={w}>
                <span className="win-label">{w === "5h" ? "5 h" : "7 d"}</span>
                <Meter
                  quota={a.quota[w]}
                  window={w}
                  soft={data.soft}
                  hard={data.hard}
                  paused={a.paused_until !== undefined}
                  now={now}
                />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** Antigravity's quota: each model group's two windows, as on its page. */
function AntigravityQuota({ m, now }: { m: AgyMonitor | null; now: Date }) {
  return (
    <div className="big-card">
      <div className="card-head">
        <span className="title">Antigravity</span>
        <a href={routeHref({ view: "agy" })} className="text-link small">
          Overview
        </a>
      </div>
      {m === null ? (
        <p className="muted">Loading…</p>
      ) : !m.configured ? (
        <Empty title="Not monitored here." />
      ) : (m.quota?.groups ?? []).length === 0 ? (
        <Empty title="No quota reading.">
          {m.error ?? m.health?.detail ?? ""}
        </Empty>
      ) : (
        <>
          <div className="quota-name">
            <span className="small muted">Health</span>
            <Status state={agyHealth(m)} />
          </div>
          {(m.quota?.groups ?? []).map((g) => (
            <div className="quota-block" key={g.name}>
              <div className="quota-name">
                <span className="client-name">{g.name}</span>
              </div>
              {(["5h", "weekly"] as const).map((w) => (
                <div className="quota-line" key={w}>
                  <span className="win-label">
                    {w === "5h" ? "5 h" : "7 d"}
                  </span>
                  <AgyMeter
                    bucket={g.buckets.find((b) => b.window === w)}
                    monitor={m}
                    now={now}
                  />
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Home: the whole setup at a glance. What the Slack bot answers on and what
 * the work runs on, then how much quota each backend has left; the upright
 * mark on a bar is an even pace through its window.
 */
export function Home({
  data,
  agy,
  now,
}: {
  data: Dashboard | null;
  agy: AgyMonitor | null;
  now: Date;
}) {
  const roles = agy?.roles;
  const work =
    roles === undefined
      ? undefined
      : roleName(roles.lead) === roleName(roles.worker)
        ? roles.lead
        : undefined;
  return (
    <>
      <PageHead
        title="Home"
        sub="What answers in Slack, what does the work, and the quota both backends have left"
      />
      <div className="home-grid">
        <SettingCard
          title="Chat"
          note="The Slack bot: new threads start on it"
          role={roles?.chat}
        />
        <SettingCard
          title="Work"
          note={
            roles !== undefined && work === undefined
              ? `Leads on ${roleName(roles.lead)}, workers on ${roleName(roles.worker)}`
              : "Leads and workers of new jobs start on it"
          }
          role={work ?? roles?.lead}
        />
        <ClaudeQuota data={data} now={now} />
        <AntigravityQuota m={agy} now={now} />
      </div>
      <p className="small muted">
        Change the backend with the switch-runtime skill (ask in Slack), or on
        the machine: <code>set-runtime.py claude|agy</code>. The upright mark on
        a bar is an even pace through its window.
      </p>
    </>
  );
}
