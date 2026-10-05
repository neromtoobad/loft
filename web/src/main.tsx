import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { LoftProvider } from "./state.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LoftProvider>
      <App />
    </LoftProvider>
  </StrictMode>,
);
