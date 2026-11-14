import { formatSpan } from "../lib/format";
import {
  agentOrder,
  agentState,
  runtimeName,
  type AgyMonitor,
  type FleetAgent,
} from "../lib/agy";
import { routeHref } from "../lib/route";
import { Empty, PageHead, Section, Status, Time } from "./ui";

/** Where an agent belongs: its job, else its Slack thread. */
function place(a: FleetAgent) {
  if (a.job !== undefined && a.job !== "") return <>job {a.job}</>;
  if (a.thread !== undefined && a.thread !== "")
    return <span className="mono small">{a.thread}</span>;
  return <span className="faint">—</span>;
}

/** fleet's agents: name, role, place, runtime, start, how long, state. */
export function AgentsTable({
  agents,
  now,
}: {
  agents: FleetAgent[];
  now: Date;
}) {
  if (agents.length === 0) return <Empty title="No agents." />;
  return (
    <div className="table-wrap scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Role</th>
            <th scope="col">Job or thread</th>
            <th scope="col">Runtime</th>
            <th scope="col">Started</th>
            <th scope="col" className="n">
              Ran
            </th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const end =
              a.ended_at === undefined ? now.getTime() : Date.parse(a.ended_at);
            return (
              <tr key={`${a.name}-${a.started_at}`}>
                <td className="mono small wrap">{a.name}</td>
                <td>{a.role}</td>
                <td className="wrap">{place(a)}</td>
                <td>
                  {runtimeName(a.kind)}
                  {a.model === undefined || a.model === "" ? null : (
                    <span className="faint"> · {a.model}</span>
                  )}
                </td>
                <td>
                  <Time iso={a.started_at}>
                    {new Date(a.started_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Time>
                </td>
                <td className="n">
                  {formatSpan(end - Date.parse(a.started_at))}
                </td>
                <td>
                  <Status state={agentState(a)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const FILTERS = [
  { arg: undefined, label: "All" },
  { arg: "claude", label: "Claude Code" },
  { arg: "agy", label: "AGY" },
] as const;

/**
 * Fleet → Agents: every fleet agent live now or ended in the last 24 h, on
 * whichever backend, filtered by runtime with `#/agents/<kind>`.
 */
export function Agents({
  m,
  now,
  kind,
}: {
  m: AgyMonitor | null;
  now: Date;
  kind: string | undefined;
}) {
  if (m === null) return <p className="muted">Loading…</p>;
  if (!m.configured)
    return (
      <Empty title="fleet is not monitored here.">
        This gateway has no <code>agy_monitor_file</code> configured.
      </Empty>
    );
  const all = [...m.agents].sort(agentOrder);
  const shown = kind === undefined ? all : all.filter((a) => a.kind === kind);
  const live = all.filter((a) => a.state !== "ended");
  return (
    <>
      <PageHead
        title="Agents"
        sub={
          <>
            fleet&apos;s agents, live and ended in the last 24 h · {live.length}{" "}
            live · new sessions start on {runtimeName(m.runtime)}
          </>
        }
      />
      <Section
        title="Agents"
        action={
          <nav className="seg" aria-label="Runtime">
            {FILTERS.map((f) => {
              const n =
                f.arg === undefined
                  ? all.length
                  : all.filter((a) => a.kind === f.arg).length;
              return (
                <a
                  key={f.label}
                  href={routeHref({ view: "agents", arg: f.arg })}
                  aria-current={kind === f.arg ? "page" : undefined}
                >
                  {f.label}
                  <span className="count">&nbsp;{n}</span>
                </a>
              );
            })}
          </nav>
        }
      >
        <AgentsTable agents={shown} now={now} />
      </Section>
    </>
  );
}
