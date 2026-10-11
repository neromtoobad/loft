// Loft is a web app: no app store, added to the Home Screen from the browser.
// This works out which phone and browser someone is on, whether Loft is
// already installed, and holds Android's install prompt for an Install button.
import { useEffect, useState } from "react";

export type Platform = "ios" | "android" | "desktop";

/** Chrome's install prompt (not in the DOM typings yet). */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// The event fires once, early, so it's caught at load and kept for later.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** On iOS, Safari keeps Share in its toolbar; Chrome and others put it by the address bar. */
export function iosBrowser(): "safari" | "other" {
  return /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) ? "other" : "safari";
}

export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return {
    installed: isInstalled(),
    platform: platform(),
    /** Android Chrome can install in one tap. */
    canPrompt: deferred !== null,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome === "accepted";
    },
  };
}

const DISMISSED = "loft.install.dismissed";

export function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

export function dismiss() {
  try {
    localStorage.setItem(DISMISSED, "1");
  } catch {
    // Private mode: the card just comes back next time.
  }
}
