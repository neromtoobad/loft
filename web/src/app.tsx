import { useEffect, useState } from "react";
import { Icon } from "./icons.tsx";
import { passkeyHint } from "./lib/keys.ts";
import { Add } from "./screens/add.tsx";
import { Claim } from "./screens/claim.tsx";
import { Home } from "./screens/home.tsx";
import { Me } from "./screens/me.tsx";
import { Schedule } from "./screens/schedule.tsx";
import { Send } from "./screens/send.tsx";
import { Welcome } from "./screens/welcome.tsx";
import { useLoft } from "./state.tsx";

export type Route = "/" | "/send" | "/schedule" | "/me" | "/add" | "/c";

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
  return (["/send", "/schedule", "/me", "/add", "/c"].includes(path) ? path : "/") as Route;
}

export function App() {
  const route = useRoute();
  const { session, vault, busy } = useLoft();

  let screen;
  if (route === "/c") screen = <Claim />;
  else if (!session || !vault) screen = <Welcome returning={Boolean(passkeyHint())} />;
  else if (route === "/send") screen = <Send />;
  else if (route === "/schedule") screen = <Schedule />;
  else if (route === "/me") screen = <Me />;
  else if (route === "/add") screen = <Add />;
  else screen = <Home />;

  // The tab bar belongs to the signed-in app; flows (send, claim, sign-up) get the whole screen.
  const tabs = Boolean(session && vault) && ["/", "/schedule", "/me", "/add"].includes(route);

  return (
    <main className={`shell ${tabs ? "" : "no-tabs"}`}>
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
            <Glyph size={22} />
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
