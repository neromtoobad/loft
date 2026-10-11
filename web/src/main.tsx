import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { LoftProvider } from "./state.tsx";
import "./lib/install.ts";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LoftProvider>
      <App />
    </LoftProvider>
  </StrictMode>,
);

// Makes Loft installable to the Home Screen (see public/sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
