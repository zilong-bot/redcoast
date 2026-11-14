import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  ExternalLink,
  Gauge,
  Globe,
  LayoutDashboard,
  List,
  Settings,
  Monitor as MonitorIcon,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Terminal,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  providerHref,
  routeHref,
  VIEW_NAMES,
  type Route,
  type View,
} from "../lib/route";
import { roleName, type AgyMonitor, type FleetRoles } from "../lib/agy";
import { clientRows, healthState } from "../lib/stats";
import type { Dashboard } from "../lib/types";
import { PALETTES, type Palette, type Theme } from "../lib/useData";
import { providerName } from "../lib/words";
import { Ago } from "./ui";

function ProviderIcon({ provider }: { provider: string | undefined }) {
  return provider === "codex" ? (
    <Cpu className="icon" aria-hidden="true" />
  ) : (
    <Terminal className="icon" aria-hidden="true" />
  );
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The provider of this gateway, and a menu of the other providers'
 * dashboards when the gateway lists any. Choosing one opens that
 * dashboard on the same view: each provider is its own process.
 */
function ProviderMenu({ data, route }: { data: Dashboard; route: Route }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (
        !(e.target instanceof Node) ||
        boxRef.current?.contains(e.target) !== true
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const provider = data.gateway.provider;
  const name = providerName(provider);
  const health = healthState(data);
  const links = (data.gateway.dashboards ?? []).flatMap((d) => {
    const href = providerHref(d.url, routeHref(route));
    return href === null ? [] : [{ ...d, href }];
  });
  const face = (
    <>
      <ProviderIcon provider={provider} />
      <span className="label">{name}</span>
      <span className={`status s-${health.tone}`}>
        <span className="dot" />
        <span className="kind">{health.word}</span>
      </span>
    </>
  );
  if (links.length === 0) {
    return (
      <div className="provider">
        <div className="provider-button static">{face}</div>
      </div>
    );
  }
  return (
    <div className="provider" ref={boxRef}>
      <button
        type="button"
        ref={buttonRef}
        className="provider-button"
        aria-expanded={open}
        aria-controls="provider-links"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {face}
        <ChevronDown className="icon sm" aria-hidden="true" />
      </button>
      {open ? (
        <nav className="menu" id="provider-links" aria-label="Providers">
          <a
            className="menu-item"
            aria-current="page"
            href={routeHref(route)}
            onClick={() => {
              setOpen(false);
            }}
          >
            <ProviderIcon provider={provider} />
            <span className="grow">
              <span className="name">{name}</span>
              <span className="host mono">{host(location.origin)}</span>
            </span>
            <Check className="icon sm" aria-hidden="true" />
          </a>
          {links.map((d) => {
            return (
              <a
                key={d.provider}
                className="menu-item"
                href={d.href}
                title={`Opens ${d.url}`}
              >
                <ProviderIcon provider={d.provider} />
                <span className="grow">
                  <span className="name">{providerName(d.provider)}</span>
                  <span className="host mono">{host(d.url)}</span>
                </span>
                <ExternalLink className="icon sm faint" aria-hidden="true" />
              </a>
            );
          })}
          <div className="menu-note">
            Each provider serves its own dashboard. Choosing one opens it, on
            the same page.
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function NavItem({
  view,
  current,
  icon: Icon,
  count,
}: {
  view: View;
  current: View;
  icon: LucideIcon;
  count?: number;
}) {
  return (
    <a
      href={routeHref({ view })}
      aria-current={view === current ? "page" : undefined}
    >
      <Icon className="icon" aria-hidden="true" />
      {VIEW_NAMES[view]}
      {count === undefined ? null : <span className="count">{count}</span>}
    </a>
  );
}

// The rows of Clients: one per machine and program, or per active machine
// from a gateway that does not report programs.
function clientCount(data: Dashboard): number {
  return data.clients === undefined
    ? data.machines.filter((m) => m.revoked_at === undefined).length
    : clientRows(data).length;
}

export function Sidebar({
  data,
  agy = null,
  route,
}: {
  data: Dashboard | null;
  agy?: AgyMonitor | null;
  route: Route;
}) {
  // A client's page is one of Clients; an account's, and adding one, of Manage.
  const v =
    route.view === "client"
      ? "clients"
      : route.view === "account" || route.view === "add"
        ? "manage"
        : route.view;
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="brand">redcoast</div>
      {data === null ? null : <ProviderMenu data={data} route={route} />}
      <nav className="nav" aria-label="Pages">
        <div className="nav-section">Redcoast</div>
        <div className="nav-group">Traffic</div>
        <NavItem view="overview" current={v} icon={LayoutDashboard} />
        <NavItem
          view="clients"
          current={v}
          icon={Terminal}
          {...(data === null ? {} : { count: clientCount(data) })}
        />
        <NavItem
          view="sessions"
          current={v}
          icon={List}
          {...(data === null ? {} : { count: data.sessions.length })}
        />
        <div className="nav-group">Upstream</div>
        <NavItem
          view="accounts"
          current={v}
          icon={User}
          {...(data === null ? {} : { count: data.accounts.length })}
        />
        <NavItem view="manage" current={v} icon={Settings} />
        <NavItem view="exits" current={v} icon={Globe} />
        {agy?.configured !== true ? null : (
          <>
            <div className="nav-section">Antigravity</div>
            <NavItem view="agy" current={v} icon={Sparkles} />
            <NavItem view="agy-quota" current={v} icon={Gauge} />
            <div className="nav-section">Fleet</div>
            <NavItem
              view="agents"
              current={v}
              icon={Bot}
              count={agy.agents.filter((a) => a.state !== "ended").length}
            />
          </>
        )}
      </nav>
      <nav className="nav nav-bottom" aria-label="Gateway">
        <NavItem view="monitor" current={v} icon={Activity} />
      </nav>
    </aside>
  );
}

const THEMES: { theme: Theme; label: string; icon: LucideIcon }[] = [
  { theme: "system", label: "System theme", icon: MonitorIcon },
  { theme: "light", label: "Light theme", icon: Sun },
  { theme: "dark", label: "Dark theme", icon: Moon },
];

/**
 * What the Slack bot answers on and what the work runs on now: fleet's
 * setting, shown on every page. The page only shows it; it changes in Slack
 * (the switch-runtime skill) or on the machine.
 */
function Roles({ roles }: { roles: FleetRoles }) {
  const work = roleName(roles.lead);
  const workers = roleName(roles.worker);
  return (
    <span
      className="roles"
      title="fleet's setting for new sessions; change it with the switch-runtime skill"
    >
      <span className="role">
        <span className="k">Chat</span>
        {roleName(roles.chat)}
      </span>
      <span
        className="role"
        title={
          work === workers ? undefined : `Leads: ${work}; workers: ${workers}`
        }
      >
        <span className="k">Work</span>
        {work === workers ? work : `${work} / ${workers}`}
      </span>
    </span>
  );
}

export function Topbar({
  data,
  agy = null,
  root,
  crumbs,
  now,
  theme,
  setTheme,
  palette,
  setPalette,
  reload,
}: {
  data: Dashboard | null;
  agy?: AgyMonitor | null;
  root: string;
  crumbs: ReactNode[];
  now: Date;
  theme: Theme;
  setTheme: (t: Theme) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
  reload: () => void;
}) {
  return (
    <header className="topbar">
      <ol className="crumbs" aria-label="Breadcrumb">
        <li>{root}</li>
        {crumbs.map((c, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- the trail's places are its order
          <li key={i}>
            <ChevronRight className="icon sm" aria-hidden="true" />
            {c}
          </li>
        ))}
      </ol>
      <div className="tools">
        {agy?.roles === undefined ? null : <Roles roles={agy.roles} />}
        {data === null ? null : (
          <span className="item">
            <Clock className="icon sm" aria-hidden="true" />
            Updated <Ago iso={data.at} now={now} />
          </span>
        )}
        <div className="seg" role="group" aria-label="Palette">
          {PALETTES.map(({ palette: p, label }) => (
            <button
              key={p}
              type="button"
              aria-pressed={palette === p}
              aria-label={`${label} colours`}
              title={label}
              onClick={() => {
                setPalette(p);
              }}
            >
              <span className={`sw sw-${p}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map(({ theme: t, label, icon: Icon }) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              aria-label={label}
              title={label}
              onClick={() => {
                setTheme(t);
              }}
            >
              <Icon className="icon sm" aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={reload}>
          <RefreshCw className="icon sm" aria-hidden="true" />
          Refresh
        </button>
      </div>
    </header>
  );
}
