import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type Address, type Hex, isAddress, keccak256, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type Ctx,
  type OrderMode,
  signClaim,
  signClose,
  signLink,
  signOrder,
  signSend,
  toUnits,
} from "../../shared/money.ts";
import { type AppConfig, type IndexedPayment, type OrderInfo, api } from "./lib/api.ts";
import { open, seal, sealForLink } from "./lib/crypto.ts";
import {
  HIDDEN_LIMIT_MS,
  IDLE_LIMIT_MS,
  PROMPT_FREE_LIMIT_USD,
  type Session,
  confirmWithPasskey,
  createAccount,
  unlock,
  unlockPrivate,
} from "./lib/keys.ts";
import { type Contact, type VaultData, emptyVault, loadVault, saveVault, upsertContact } from "./lib/vault.ts";
import type { Creature } from "./cast.tsx";

const LINK_DAYS = 14;

type State = {
  config: AppConfig | null;
  rate: number | null;
  session: Session | null;
  vault: VaultData | null;
  balance: bigint | null;
  orders: OrderInfo[];
  payments: IndexedPayment[] | null;
  arrivedAt: number;
  busy: string | null;
};

type Actions = {
  create(name: string, character: Creature): Promise<void>;
  unlock(): Promise<void>;
  lock(): void;
  refresh(): Promise<void>;
  updateVault(fn: (v: VaultData) => VaultData): Promise<void>;
  sendTo(contact: Contact, amountUsd: number, note: string): Promise<Settled>;
  makeLink(amountUsd: number, note: string, label: string): Promise<Settled & { url: string }>;
  claim(claimSecret: Hex, fromName: string, note: string | undefined): Promise<Settled>;
  cancelLink(claimSecret: Hex): Promise<Hex>;
  schedule(o: {
    contact: Contact;
    amountUsd: number;
    count: number;
    period: number;
    firstDue: number;
    mode: OrderMode;
  }): Promise<Hex>;
  cancelOrder(id: number): Promise<Hex>;
  setHandle(handle: string): Promise<void>;
  setCharacter(character: Creature): Promise<void>;
  resolveRecipient(input: string): Promise<Contact>;
};

/** A confirmed transaction and how long it took from tap to confirmation. */
export type Settled = { hash: Hex; ms: number };

const LoftContext = createContext<(State & Actions) | null>(null);

export function useLoft() {
  const ctx = useContext(LoftContext);
  if (!ctx) throw new Error("useLoft outside provider");
  return ctx;
}

export function LoftProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [vault, setVault] = useState<VaultData | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  /** When money last arrived, so your creature can celebrate it. */
  const [arrivedAt, setArrivedAt] = useState(0);
  const lastBalance = useRef<bigint | null>(null);
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  // From the Envio indexer when it's configured; null means "use the vault".
  const [payments, setPayments] = useState<IndexedPayment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const vaultVersion = useRef(0);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    api.config().then(setConfig).catch(console.error);
    api.rate().then((r) => setRate(r.ngnPerUsd)).catch(console.error);
  }, []);

  const ctx = useCallback((): Ctx => {
    if (!config?.escrow) throw new Error("Loft isn't deployed on this network yet");
    return { chainId: config.chainId, ausd: config.ausd, escrow: config.escrow };
  }, [config]);

  // ------------------------------------------------------------ session

  const lock = useCallback(() => {
    setSession((s) => {
      s?.end();
      return null;
    });
    setVault(null);
    setBalance(null);
    setOrders([]);
    setPayments(null);
  }, []);

  // End the session when idle or after time in the background.
  useEffect(() => {
    if (!session) return;
    let hiddenAt = 0;
    const touch = () => {
      lastActive.current = Date.now();
    };
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_LIMIT_MS) lock();
    };
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LIMIT_MS) lock();
    }, 15_000);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session, lock]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const [b, o, a] = await Promise.all([
      api.balance(session.account.address),
      api.orders(session.account.address).catch(() => [] as OrderInfo[]),
      config?.indexer ? api.activity(session.account.address).catch(() => null) : Promise.resolve(null),
    ]);
    const next = BigInt(b.ausd);
    if (lastBalance.current !== null && next > lastBalance.current) setArrivedAt(Date.now());
    lastBalance.current = next;
    setBalance(next);
    setOrders(o);
    if (a) setPayments(a);
  }, [session, config]);

  useEffect(() => {
    refresh().catch(console.error);
    if (!session) return;
    const t = setInterval(() => refresh().catch(console.error), 8000);
    return () => clearInterval(t);
  }, [session, refresh]);

  /** Loads the vault, publishes the inbox key, and pulls in new notes. */
  const hydrate = useCallback(async (s: Session, name?: string, character?: Creature) => {
    if (!s.privateKeys) await unlockPrivate(s);
    const keys = s.privateKeys!;
    const loaded = await loadVault(s);
    vaultVersion.current = loaded.version;
    let data = loaded.data ?? emptyVault(name ?? "", character ?? null);
    if (character && data.character !== character) data = { ...data, character };
    if (name && !data.name) data = { ...data, name };

    let changed = !loaded.data;

    // A link you sent that someone received tells you where they are: they
    // join your contacts under the name you gave the link.
    const pending = data.sent.filter((s) => s.kind === "link" && s.claimKey && !s.toAddress);
    const infos = await Promise.all(pending.map((s) => api.link(s.claimKey!).catch(() => null)));
    pending.forEach((item, i) => {
      const r = infos[i]?.recipient;
      if (!r || r.toLowerCase() === s.account.address.toLowerCase()) return;
      data = {
        ...data,
        sent: data.sent.map((x) => (x.txHash === item.txHash ? { ...x, toAddress: r } : x)),
      };
      if (item.to !== "a link" && !data.contacts.some((c) => c.address.toLowerCase() === r.toLowerCase())) {
        data = upsertContact(data, { name: item.to, address: r });
      }
      changed = true;
    });

    // Contacts saved before they picked a creature: fill it in from their profile.
    const missing = data.contacts.filter((c) => !c.character).slice(0, 20);
    const profiles = await Promise.all(missing.map((c) => api.profile(c.address).catch(() => null)));
    missing.forEach((c, i) => {
      const character = profiles[i]?.character;
      if (!character) return;
      data = { ...data, contacts: data.contacts.map((x) => (x.address === c.address ? { ...x, character } : x)) };
      changed = true;
    });

    // Notes other people sealed to this inbox since last time.
    const seen = new Set(data.received.map((r) => r.txHash));
    const notes = await api.notes(s.account).catch(() => []);
    for (const n of notes) {
      if (!n.tx_hash || seen.has(n.tx_hash as Hex)) continue;
      try {
        const body = JSON.parse(await open(keys.inboxSecret, n.sealed)) as {
          from: string;
          fromAddress?: Address;
          amount: string;
          note: string;
        };
        data = { ...data, received: [{ ...body, txHash: n.tx_hash as Hex, at: n.created_at }, ...data.received] };
        const known = data.contacts.some((c) => c.address.toLowerCase() === body.fromAddress?.toLowerCase());
        if (body.fromAddress && isAddress(body.fromAddress) && !known) {
          data = upsertContact(data, { name: body.from, address: body.fromAddress });
        }
        changed = true;
      } catch {
        // Not for us, or damaged: skip it.
      }
    }

    await api.putProfile(s.account, data.handle, keys.inboxPublic, data.character ?? null).catch(console.error);
    if (changed) vaultVersion.current = await saveVault(s, data, vaultVersion.current);
    setVault(data);
  }, []);

  const withBusy = useCallback(async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }, []);

  const doCreate = useCallback(
    (name: string, character: Creature) =>
      withBusy("Creating your Loft", async () => {
        const s = await createAccount(name);
        setSession(s);
        await hydrate(s, name, character);
      }),
    [hydrate, withBusy],
  );

  const doUnlock = useCallback(
    () =>
      withBusy("Unlocking", async () => {
        const s = await unlock();
        setSession(s);
        await hydrate(s);
      }),
    [hydrate, withBusy],
  );

  const updateVault = useCallback(
    async (fn: (v: VaultData) => VaultData) => {
      if (!session || !vault) return;
      const next = fn(vault);
      setVault(next);
      try {
        vaultVersion.current = await saveVault(session, next, vaultVersion.current);
      } catch {
        // Another device wrote first: reload theirs, reapply ours.
        const fresh = await loadVault(session);
        const merged = fn(fresh.data ?? next);
        vaultVersion.current = await saveVault(session, merged, fresh.version);
        setVault(merged);
      }
    },
    [session, vault],
  );

  const stepUp = useCallback(
    async (amountUsd: number) => {
      if (session && amountUsd > PROMPT_FREE_LIMIT_USD) await confirmWithPasskey(session);
    },
    [session],
  );

  // ------------------------------------------------------------- money

  const resolveRecipient = useCallback(async (input: string): Promise<Contact> => {
    const text = input.trim();
    if (isAddress(text)) {
      const p = await api.profile(text).catch(() => null);
      return { name: p?.handle ? `@${p.handle}` : text, address: text, handle: p?.handle, inboxKey: p?.inboxKey, character: p?.character };
    }
    const handle = text.replace(/^@/, "");
    const p = await api.handle(handle);
    return { name: `@${p.handle}`, address: p.address, handle: p.handle, inboxKey: p.inboxKey, character: p.character };
  }, []);

  const sendTo = useCallback(
    (contact: Contact, amountUsd: number, note: string) =>
      withBusy("Sending", async () => {
        if (!session || !vault) throw new Error("locked");
        await stepUp(amountUsd);
        const value = toUnits(amountUsd);
        const profile = contact.inboxKey && contact.character ? null : await api.profile(contact.address).catch(() => null);
        const inboxKey = contact.inboxKey ?? profile?.inboxKey;
        const character = contact.character ?? profile?.character;
        const sealedNote = inboxKey
          ? await seal(
              inboxKey,
              JSON.stringify({
                from: vault.handle ? `@${vault.handle}` : vault.name,
                fromAddress: session.account.address,
                amount: value.toString(),
                note,
              }),
            )
          : undefined;
        // The note's hash rides onchain as the payment's ref.
        const signed = await signSend(session.account, ctx(), contact.address, value, sealedNote ? keccak256(toBytes(sealedNote)) : undefined);
        const started = performance.now();
        const { hash } = await api.send({ ...signed, sealedNote });
        const ms = performance.now() - started;
        await updateVault((v) =>
          upsertContact(
            {
              ...v,
              sent: [
                { kind: "direct", to: contact.name, toAddress: contact.address, amount: value.toString(), note, txHash: hash, at: Date.now() },
                ...v.sent,
              ],
            },
            { ...contact, inboxKey: inboxKey ?? contact.inboxKey, character: character ?? contact.character },
          ),
        );
        await refresh();
        return { hash, ms };
      }),
    [session, vault, ctx, stepUp, updateVault, refresh, withBusy],
  );

  const makeLink = useCallback(
    (amountUsd: number, note: string, label: string) =>
      withBusy("Making your link", async () => {
        if (!session || !vault) throw new Error("locked");
        await stepUp(amountUsd);
        const claimSecret = generatePrivateKey();
        const claimAccount = privateKeyToAccount(claimSecret);
        const expiry = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400;
        const value = toUnits(amountUsd);
        const signed = await signLink(session.account, ctx(), claimAccount.address, value, expiry);
        const sealedNote = await sealForLink(
          claimSecret,
          JSON.stringify({ from: vault.handle ? `@${vault.handle}` : vault.name, note }),
        );
        const started = performance.now();
        const { hash } = await api.createLink({ ...signed, sealedNote });
        const ms = performance.now() - started;
        await updateVault((v) => ({
          ...v,
          sent: [
            {
              kind: "link",
              to: label || "a link",
              amount: value.toString(),
              note,
              txHash: hash,
              at: Date.now(),
              claimSecret,
              claimKey: claimAccount.address,
            },
            ...v.sent,
          ],
        }));
        await refresh();
        // The secret rides in the fragment, which browsers never send to a server.
        return { url: `${location.origin}/c#${claimSecret.slice(2)}`, hash, ms };
      }),
    [session, vault, ctx, stepUp, updateVault, refresh, withBusy],
  );

  const claim = useCallback(
    (claimSecret: Hex, fromName: string, note: string | undefined) =>
      withBusy("Receiving", async () => {
        if (!session) throw new Error("locked");
        const claimAccount = privateKeyToAccount(claimSecret);
        const info = await api.link(claimAccount.address);
        const signed = await signClaim(claimAccount, ctx(), session.account.address);
        const started = performance.now();
        const { hash } = await api.claim(signed);
        const ms = performance.now() - started;
        await updateVault((v) => {
          let next: VaultData = {
            ...v,
            received: [{ from: fromName, amount: info.amount, note, txHash: hash, at: Date.now() }, ...v.received],
          };
          if (info.sender.toLowerCase() !== session.account.address.toLowerCase()) {
            next = upsertContact(next, {
              name: info.senderHandle ? `@${info.senderHandle}` : fromName,
              address: info.sender,
              handle: info.senderHandle,
              character: info.senderCharacter,
            });
          }
          return next;
        });
        await refresh();
        return { hash, ms };
      }),
    [session, ctx, updateVault, refresh, withBusy],
  );

  /** Taking a link back is just claiming it to yourself with its own key. */
  const cancelLink = useCallback(
    (claimSecret: Hex) =>
      withBusy("Taking it back", async () => {
        if (!session) throw new Error("locked");
        const signed = await signClaim(privateKeyToAccount(claimSecret), ctx(), session.account.address);
        const { hash } = await api.claim(signed);
        await refresh();
        return hash;
      }),
    [session, ctx, refresh, withBusy],
  );

  const schedule = useCallback<Actions["schedule"]>(
    (o) =>
      withBusy("Setting it up", async () => {
        if (!session) throw new Error("locked");
        const budgetUsd = o.amountUsd * o.count;
        await stepUp(budgetUsd);
        const signed = await signOrder(session.account, ctx(), {
          recipient: o.contact.address,
          amount: toUnits(o.amountUsd),
          budget: toUnits(budgetUsd),
          firstDue: o.firstDue,
          period: o.period,
          mode: o.mode,
        });
        const { hash } = await api.createOrder(signed);
        await updateVault((v) => upsertContact(v, o.contact));
        await refresh();
        return hash;
      }),
    [session, ctx, stepUp, updateVault, refresh, withBusy],
  );

  const cancelOrder = useCallback(
    (id: number) =>
      withBusy("Stopping it", async () => {
        if (!session) throw new Error("locked");
        const signed = await signClose(session.account, ctx(), BigInt(id));
        const { hash } = await api.closeOrder(signed);
        await refresh();
        return hash;
      }),
    [session, ctx, refresh, withBusy],
  );

  const setHandle = useCallback(
    async (handle: string) => {
      if (!session?.privateKeys) throw new Error("locked");
      await api.putProfile(session.account, handle, session.privateKeys.inboxPublic, vault?.character ?? null);
      await updateVault((v) => ({ ...v, handle }));
    },
    [session, vault, updateVault],
  );

  const setCharacter = useCallback(
    async (character: Creature) => {
      if (!session?.privateKeys) throw new Error("locked");
      await api.putProfile(session.account, vault?.handle ?? null, session.privateKeys.inboxPublic, character);
      await updateVault((v) => ({ ...v, character }));
    },
    [session, vault, updateVault],
  );

  const value: State & Actions = {
    config,
    rate,
    session,
    vault,
    balance,
    orders,
    payments,
    arrivedAt,
    busy,
    create: doCreate,
    unlock: doUnlock,
    lock,
    refresh,
    updateVault,
    sendTo,
    makeLink,
    claim,
    cancelLink,
    schedule,
    cancelOrder,
    setHandle,
    setCharacter,
    resolveRecipient,
  };
  return <LoftContext.Provider value={value}>{children}</LoftContext.Provider>;
}

export type { Address };
