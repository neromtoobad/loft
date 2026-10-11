// "Loft is a web app": how to put it on your Home Screen, for the phone and
// browser in hand. On a computer, a QR code to open it on a phone instead.
import qrcode from "qrcode-generator";
import { type ReactNode, useMemo, useState } from "react";
import { dismiss, iosBrowser, useInstall, wasDismissed } from "../lib/install.ts";
import { Label } from "./ui.tsx";

const ShareGlyph = () => (
  <svg className="glyph-inline" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
  </svg>
);

const AddGlyph = () => (
  <svg className="glyph-inline" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

const MenuGlyph = () => (
  <svg className="glyph-inline" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-label="menu">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="install-steps">
      {items.map((item, i) => (
        <li key={i}>
          <span className="step-n">{i + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** Platform-specific steps to add Loft to the Home Screen. */
export function InstallSteps() {
  const { platform } = useInstall();
  const signIn = (
    <>
      Open Loft from your Home Screen and tap <strong>Sign in</strong>. Your passkey works there too.
    </>
  );
  if (platform === "ios") {
    const safari = iosBrowser() === "safari";
    return (
      <Steps
        items={[
          safari ? (
            <>
              Tap <strong>Share</strong> <ShareGlyph /> in Safari's toolbar. If you don't see it, tap <strong>•••</strong> first.
            </>
          ) : (
            <>
              Tap <strong>Share</strong> <ShareGlyph /> next to the address bar.
            </>
          ),
          <>
            Scroll down and tap <strong>Add to Home Screen</strong> <AddGlyph />.
          </>,
          <>
            Tap <strong>Add</strong>. Loft's icon appears on your Home Screen.
          </>,
          signIn,
        ]}
      />
    );
  }
  return (
    <Steps
      items={[
        <>
          Tap the menu <MenuGlyph /> at the top right of Chrome.
        </>,
        <>
          Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
        </>,
        <>
          Tap <strong>Install</strong>. Loft's icon appears with your apps.
        </>,
        signIn,
      ]}
    />
  );
}

function OpenOnPhone() {
  const url = location.origin;
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });
  }, [url]);
  return (
    <div className="card install-card desktop">
      <div className="install-qr" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div>
        <Label>Web app · no download</Label>
        <h3>Loft lives on your phone</h3>
        <p className="muted small">
          Scan with your phone's camera to open Loft, then add it to your Home Screen. There's nothing to get from an app store. It works here too
          if this browser has passkeys.
        </p>
        <span className="mono small install-url">{url.replace(/^https?:\/\//, "")}</span>
      </div>
    </div>
  );
}

/**
 * Tells people Loft is a web app and how to install it. `where` decides the
 * tone: the welcome screen explains, Home nudges once (and can be dismissed),
 * and the You tab always keeps the steps.
 */
export function InstallCard({ where }: { where: "welcome" | "home" | "me" }) {
  const { installed, platform, canPrompt, prompt } = useInstall();
  const [open, setOpen] = useState(where === "me");
  const [hidden, setHidden] = useState(() => where === "home" && wasDismissed());
  if (installed || hidden) return null;
  if (platform === "desktop") return where === "welcome" ? <OpenOnPhone /> : null;

  return (
    <div className={`card install-card ${where}`}>
      <div className="install-head">
        <img src="/icon-192.png" alt="" width={44} height={44} className="install-icon" />
        <div>
          <Label>Web app · no download</Label>
          <h3>Add Loft to your Home Screen</h3>
        </div>
      </div>
      <p className="muted small">
        Loft runs in your browser, so there's no app store and nothing to update. Add it to your Home Screen and it opens full-screen, like any
        other app.
      </p>
      {open && <InstallSteps />}
      <div className="inline even">
        {canPrompt ? (
          <button className="primary" onClick={() => prompt()}>
            Install Loft
          </button>
        ) : (
          !open && (
            <button className="primary" onClick={() => setOpen(true)}>
              Show me how
            </button>
          )
        )}
        {where === "home" && (
          <button
            className="ghost"
            onClick={() => {
              dismiss();
              setHidden(true);
            }}
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
