import { useEffect, useState } from "react";
import { formatPercent, formatUntil } from "../lib/format";
import {
  arrayOf,
  isBoolean,
  isNumber,
  isString,
  object,
  optional,
} from "../lib/guard";
import { poller, stopped } from "../lib/poll";
import type { Tone } from "../lib/stats";
import { Ago, Empty, Section, Status, Time } from "./ui";

/** One limit of an agy model group, as /agy-quota.json gives it. */
interface AgyBucket {
  id: string;
  name: string;
  window: string;
  remaining_fraction: number;
  reset_time?: string;
}

interface AgyGroup {
  name: string;
  description?: string;
  buckets: AgyBucket[];
}

/** GET /agy-quota.json: the Google Antigravity CLI's quota, read from a file a timer writes. */
interface AgyQuota {
  configured: boolean;
  updated_at?: string;
  groups: AgyGroup[];
  error?: string;
}

// The timer writes every 5 minutes; a reading older than this is flagged.
const STALE_MS = 20 * 60 * 1000;
const EVERY_MS = 60 * 1000;

const isAgyQuota = object<AgyQuota>({
  configured: isBoolean,
  updated_at: optional(isString),
  groups: arrayOf(
    object<AgyGroup>({
      name: isString,
      description: optional(isString),
      buckets: arrayOf(
        object<AgyBucket>({
          id: isString,
          name: isString,
          window: isString,
          remaining_fraction: isNumber,
          reset_time: optional(isString),
        }),
      ),
    }),
  ),
  error: optional(isString),
});

function parseAgyQuota(text: string): AgyQuota {
  const q: unknown = JSON.parse(text);
  if (!isAgyQuota(q)) throw new Error("not an agy quota answer");
  return q;
}

/** Fetches /agy-quota.json now and every minute; null until the first answer. */
function useAgyQuota(): AgyQuota | null {
  const [quota, setQuota] = useState<AgyQuota | null>(null);
  useEffect(() => {
    const loads = poller(async (signal) => {
      try {
        const response = await fetch("agy-quota.json", {
          cache: "no-store",
          signal,
        });
        // An older gateway has no such route: show nothing.
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const q = parseAgyQuota(await response.text());
        if (!signal.aborted) setQuota(q);
      } catch (e) {
        if (!stopped(signal))
          setQuota({ configured: false, groups: [], error: String(e) });
      }
    }, 3 * EVERY_MS);
    loads.run();
    const timer = setInterval(loads.run, EVERY_MS);
    return () => {
      loads.stop();
      clearInterval(timer);
    };
  }, []);
  return quota;
}

function toneOf(used: number): Tone {
  return used >= 0.95 ? "bad" : used >= 0.8 ? "warn" : "ok";
}

/** A used-share bar, inked like the Claude windows' bars. */
function AgyMeter({
  bucket,
  now,
}: {
  bucket: AgyBucket | undefined;
  now: Date;
}) {
  if (bucket === undefined)
    return <span className="muted small">No reading</span>;
  const used = 1 - bucket.remaining_fraction;
  return (
    <div className={`meter s-${toneOf(used)}`}>
      <div className="track">
        <div
          className="fill"
          style={{ width: `${String(Math.min(used, 1) * 100)}%` }}
        />
      </div>
      <span className="pct">{formatPercent(used)}</span>
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
      </span>
    </div>
  );
}

/**
 * The Antigravity CLI's quota, by model group: the share of each group's
 * 5-hour and weekly limits used. Nothing at all when the gateway has no
 * quota file configured.
 */
export function AgyQuotaSection({ now }: { now: Date }) {
  const quota = useAgyQuota();
  if (quota?.configured !== true) return null;
  const stale =
    quota.updated_at !== undefined &&
    now.getTime() - Date.parse(quota.updated_at) > STALE_MS;
  const note =
    quota.updated_at === undefined ? (
      "Google Antigravity CLI (agy), used share of each limit"
    ) : (
      <>
        Google Antigravity CLI (agy), used share of each limit · read{" "}
        <Ago iso={quota.updated_at} now={now} />
        {stale ? (
          <>
            {" "}
            <Status state={{ tone: "warn", word: "stale" }} />
          </>
        ) : null}
      </>
    );
  return (
    <Section title="Antigravity quota" note={note}>
      {quota.groups.length === 0 ? (
        <Empty title="No agy quota reading.">
          {quota.error ?? "The quota file has no groups."}
        </Empty>
      ) : (
        <div className="table-wrap scroll">
          <table className="quota-table">
            <thead>
              <tr>
                <th scope="col">Model group</th>
                <th scope="col" className="win">
                  5 h window
                </th>
                <th scope="col" className="win">
                  Weekly window
                </th>
              </tr>
            </thead>
            <tbody>
              {quota.groups.map((g) => (
                <tr key={g.name}>
                  <td className="two wrap">
                    <div className="client-name">{g.name}</div>
                  </td>
                  {(["5h", "weekly"] as const).map((w) => (
                    <td className="two" key={w}>
                      <AgyMeter
                        bucket={g.buckets.find((b) => b.window === w)}
                        now={now}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
