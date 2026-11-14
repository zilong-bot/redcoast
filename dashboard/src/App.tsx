import { useEffect, useState, type ReactNode } from "react";
import { AccountDetail } from "./components/AccountDetail";
import { AgyOverview, AgyQuota } from "./components/Agy";
import { Agents } from "./components/Fleet";
import { Home } from "./components/Home";
import { Accounts } from "./components/Accounts";
import { AddAccount } from "./components/AddAccount";
import { Client } from "./components/Client";
import { Clients } from "./components/Clients";
import { Exits } from "./components/Exits";
import { ManageAccounts } from "./components/ManageAccounts";
import { Monitor } from "./components/Monitor";
import { Overview } from "./components/Overview";
import { Sessions } from "./components/Sessions";
import { Sidebar, Topbar } from "./components/Shell";
import { Status } from "./components/ui";
import { useAgy, type AgyMonitor } from "./lib/agy";
import { formatAgo, isStale } from "./lib/format";
import { parseClient, routeHref, VIEW_NAMES, type Route } from "./lib/route";
import type { Dashboard } from "./lib/types";
import { useData, useNow, usePalette, useRoute, useTheme } from "./lib/useData";
import { providerName } from "./lib/words";

const REFRESH_MS = 30_000;

/** The page of route over data. */
export function Page({
  data,
  agy = null,
  now,
  route,
  reload,
}: {
  data: Dashboard;
  agy?: AgyMonitor | null;
  now: Date;
  route: Route;
  reload: () => void;
}) {
  switch (route.view) {
    case "home":
      return <Home data={data} agy={agy} now={now} />;
    case "overview":
      return <Overview data={data} now={now} reload={reload} />;
    case "clients":
      return <Clients data={data} now={now} />;
    case "client": {
      const c = parseClient(route.arg);
      return c === null ? (
        <Clients data={data} now={now} />
      ) : (
        <Client data={data} now={now} machine={c.machine} client={c.client} />
      );
    }
    case "sessions":
      return <Sessions data={data} now={now} machine={route.arg} />;
    case "accounts":
      return <Accounts data={data} now={now} reload={reload} />;
    case "manage":
      return <ManageAccounts data={data} now={now} />;
    case "account":
      return (
        <AccountDetail data={data} now={now} arg={route.arg} reload={reload} />
      );
    case "add":
      return (
        <AddAccount data={data} now={now} arg={route.arg} reload={reload} />
      );
    case "exits":
      return <Exits data={data} now={now} />;
    case "monitor":
      return <Monitor data={data} now={now} focus={route.arg} />;
    case "agy":
      return <AgyOverview m={agy} now={now} />;
    case "agy-quota":
      return <AgyQuota m={agy} now={now} />;
    case "agents":
      return <Agents m={agy} now={now} kind={route.arg} />;
  }
}

function crumbs(data: Dashboard | null, route: Route): ReactNode[] {
  const trail: ReactNode[] = [];
  if (route.view === "home") return trail;
  if (rootOf(route) !== "Gateway") {
    trail.push(VIEW_NAMES[route.view]);
    return trail;
  }
  // Without a provider the trail's first place, "Gateway", already names it.
  if (data?.gateway.provider !== undefined)
    trail.push(
      <a href={routeHref({ view: "overview" })}>
        {providerName(data.gateway.provider)}
      </a>,
    );
  if (route.view === "sessions" && route.arg !== undefined) {
    trail.push(<a href={routeHref({ view: "sessions" })}>Sessions</a>);
    trail.push(route.arg);
  } else if (route.view === "client") {
    const c = parseClient(route.arg);
    trail.push(<a href={routeHref({ view: "clients" })}>Clients</a>);
    trail.push(
      c === null
        ? VIEW_NAMES.client
        : `${c.machine} · ${c.client === "" ? "unknown program" : c.client}`,
    );
  } else if (route.view === "account" || route.view === "add") {
    trail.push(<a href={routeHref({ view: "manage" })}>Manage</a>);
    trail.push(
      route.view === "add"
        ? VIEW_NAMES.add
        : ((route.arg ?? "").split("/")[0] ?? ""),
    );
  } else trail.push(VIEW_NAMES[route.view]);
  return trail;
}

/** The trail's first place: the page group the view is in. */
function rootOf(route: Route): string {
  if (route.view === "home") return "Home";
  if (route.view === "agy" || route.view === "agy-quota") return "Antigravity";
  if (route.view === "agents") return "Fleet";
  return "Gateway";
}

export function App() {
  const { data, fetchError, reload } = useData("./dashboard.json", REFRESH_MS);
  const agy = useAgy(REFRESH_MS);
  const now = useNow(1_000);
  const route = useRoute();
  const [theme, setTheme] = useTheme();
  const [palette, setPalette] = usePalette();
  const routeKey = `${route.view}:${route.arg ?? ""}`;
  const [openAtRoute, setOpenAtRoute] = useState<string | null>(null);
  const navOpen = openAtRoute === routeKey;
  const closeNav = () => {
    setOpenAtRoute(null);
  };
  useEffect(() => {
    if (!navOpen) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenAtRoute(null);
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
    };
  }, [navOpen]);
  return (
    <div className="shell">
      {navOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={closeNav}
        />
      ) : null}
      <Sidebar
        data={data}
        agy={agy}
        route={route}
        open={navOpen}
        onClose={closeNav}
      />
      <div className="main">
        <Topbar
          data={data}
          agy={agy}
          root={rootOf(route)}
          crumbs={crumbs(data, route)}
          now={now}
          theme={theme}
          setTheme={setTheme}
          palette={palette}
          setPalette={setPalette}
          reload={reload}
          navOpen={navOpen}
          onToggleNav={() => {
            setOpenAtRoute(navOpen ? null : routeKey);
          }}
        />
        <main className="content">
          {fetchError === null ? null : (
            <div role="alert" className="alert">
              <Status
                state={{ tone: "bad", word: `Could not read: ${fetchError}` }}
              />
              {data === null
                ? null
                : ` Showing the data of ${formatAgo(data.at, now)}.`}
            </div>
          )}
          {data !== null && fetchError === null && isStale(data.at, now) ? (
            <div role="alert" className="alert">
              <Status
                state={{
                  tone: "warn",
                  word: `The data is from ${formatAgo(data.at, now)}, older than the refresh interval.`,
                }}
              />
            </div>
          ) : null}
          {data === null ? (
            fetchError === null ? (
              <p className="muted">Loading…</p>
            ) : null
          ) : (
            <Page
              data={data}
              agy={agy}
              now={now}
              route={route}
              reload={reload}
            />
          )}
        </main>
      </div>
    </div>
  );
}
