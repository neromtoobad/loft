import { useEffect, useState } from "react";
import { Icon } from "./icons.tsx";
import { passkeyHint } from "./lib/keys.ts";
import { Add } from "./screens/add.tsx";
import { Ask, RequestPage } from "./screens/ask.tsx";
import { PotPage, Pots } from "./screens/pots.tsx";
import { Claim } from "./screens/claim.tsx";
import { CorridorPage } from "./screens/corridor.tsx";
import { Home } from "./screens/home.tsx";
import { Me } from "./screens/me.tsx";
import { Schedule } from "./screens/schedule.tsx";
import { Send } from "./screens/send.tsx";
import { Welcome } from "./screens/welcome.tsx";
import { useLoft } from "./state.tsx";
import { CreatureAvatar, isCreature } from "./cast.tsx";
import { LoftMark } from "./screens/ui.tsx";

export type Route = "/" | "/send" | "/schedule" | "/me" | "/add" | "/c" | "/ask" | "/r" | "/pots" | "/p" | "/corridor";

export function navigate(to: string) {
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useRoute(): Route {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (["/send", "/schedule", "/me", "/add", "/c", "/ask", "/r", "/pots", "/p", "/corridor"].includes(path) ? path : "/") as Route;
}

export function App() {
  const route = useRoute();
  const { session, vault, busy } = useLoft();

  // Your creature's colours theme the whole app (see [data-creature] in styles.css).
  const creature = isCreature(vault?.character) ? vault.character : null;
  useEffect(() => {
    if (creature) document.documentElement.dataset.creature = creature;
    else delete document.documentElement.dataset.creature;
  }, [creature]);

  let screen;
  if (route === "/c") screen = <Claim />;
  // Shared request and pot links open for anyone; they offer a Loft inline.
  else if (route === "/r") screen = <RequestPage />;
  else if (route === "/p") screen = <PotPage />;
  else if (route === "/corridor") screen = <CorridorPage />;
  else if (!session || !vault) screen = <Welcome returning={Boolean(passkeyHint())} />;
  else if (route === "/send") screen = <Send />;
  else if (route === "/schedule") screen = <Schedule />;
  else if (route === "/me") screen = <Me />;
  else if (route === "/add") screen = <Add />;
  else if (route === "/ask") screen = <Ask />;
  else if (route === "/pots") screen = <Pots />;
  else screen = <Home />;

  // The tab bar belongs to the signed-in app; flows (send, claim, sign-up) get the whole screen.
  const tabs = Boolean(session && vault) && ["/", "/schedule", "/me", "/add"].includes(route);
  // On a computer, a sidebar replaces the tab bar on every signed-in screen except claiming a link.
  const side = Boolean(session && vault) && route !== "/c";

  return (
    <main className={`shell ${tabs ? "" : "no-tabs"} ${side ? "with-side" : ""} route-${route.slice(1) || "home"}`}>
      {side && <SideNav route={route} />}
      {screen}
      {tabs && <TabBar route={route} />}
      {busy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="spinner" aria-hidden /> {busy}…
        </div>
      )}
    </main>
  );
}

function TabBar({ route }: { route: Route }) {
  const items: { to: Route; label: string; icon: keyof typeof Icon }[] = [
    { to: "/", label: "Home", icon: "home" },
    { to: "/send", label: "Send", icon: "send" },
    { to: "/schedule", label: "Schedule", icon: "calendar" },
    { to: "/me", label: "You", icon: "user" },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((it) => {
        const Glyph = Icon[it.icon];
        return (
          <button key={it.to} className={route === it.to ? "on" : ""} aria-current={route === it.to ? "page" : undefined} onClick={() => navigate(it.to)}>
            <Glyph size={21} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Navigation on a computer: everything one click away, in a column on the left. */
function SideNav({ route }: { route: Route }) {
  const { vault, lock } = useLoft();
  const items: { to: string; match: Route; label: string; icon: keyof typeof Icon }[] = [
    { to: "/", match: "/", label: "Home", icon: "home" },
    { to: "/send", match: "/send", label: "Send", icon: "send" },
    { to: "/add", match: "/add", label: "Add money", icon: "plus" },
    { to: "/schedule", match: "/schedule", label: "Schedule", icon: "calendar" },
    { to: "/ask", match: "/ask", label: "Ask the family", icon: "receive" },
    { to: "/pots", match: "/pots", label: "Family pots", icon: "user" },
    { to: "/corridor", match: "/corridor", label: "Corridor stats", icon: "arrow" },
  ];
  return (
    <nav className="sidenav" aria-label="Main">
      <button className="brand" onClick={() => navigate("/")}>
        <LoftMark size={26} /> Loft
      </button>
      <div className="sidenav-items">
        {items.map((it) => {
          const Glyph = Icon[it.icon];
          const on = route === it.match || (it.match === "/pots" && route === "/p") || (it.match === "/ask" && route === "/r");
          return (
            <button key={it.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => navigate(it.to)}>
              <Glyph size={19} />
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>
      <button className={`sidenav-me ${route === "/me" ? "on" : ""}`} onClick={() => navigate("/me")}>
        <CreatureAvatar kind={vault?.character} name={vault?.name ?? ""} size={34} />
        <span>
          <strong>{vault?.name}</strong>
          <small>{vault?.handle ? `@${vault.handle}` : "Your account"}</small>
        </span>
      </button>
      <button className="sidenav-lock" onClick={() => (lock(), navigate("/"))}>
        <Icon.lock size={16} /> Lock
      </button>
    </nav>
  );
}
