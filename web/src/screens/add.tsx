import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { useLoft } from "../state.tsx";
import { TopBar } from "./ui.tsx";

/** Your Loft address as a QR code, for topping up from a wallet or exchange on Monad. */
export function Add() {
  const { session, config } = useLoft();
  const [copied, setCopied] = useState(false);
  const address = session?.account.address ?? "";

  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(address);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [address]);

  if (!session) return null;
  return (
    <section className="add">
      <TopBar title="Add money" />
      <p className="lede">
        Send Agora dollars (AUSD) on Monad to this address from any wallet or exchange. They show up here in about a second.
      </p>
      <div className="qr" aria-label="QR code of your Loft address" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mono address">{address}</p>
      <button
        className="primary big"
        onClick={async () => {
          await navigator.clipboard?.writeText(address).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy address"}
      </button>
      <p className="fineprint">
        Only send AUSD on {config?.network === "testnet" ? "Monad testnet" : "Monad"}. Other tokens or networks sent here won't show as dollars.
      </p>
    </section>
  );
}
