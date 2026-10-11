// Everything the server keeps is either public (handles, inbox public keys)
// or ciphertext it can't read (vaults, notes). SQLite via node:sqlite.
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type Store = ReturnType<typeof openStore>;

export function openStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(`${dir}/loft.db`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS vaults (
      address TEXT PRIMARY KEY,
      blob TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      address TEXT PRIMARY KEY,
      handle TEXT UNIQUE,
      inbox_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      sealed TEXT NOT NULL,
      tx_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_recipient ON notes (recipient, id);
    CREATE TABLE IF NOT EXISTS links (
      claim_key TEXT PRIMARY KEY,
      sealed TEXT,
      tx_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- Family pots: the money and its rules live onchain; the title and who
    -- chipped in (by the name they chose) are public and kept here.
    CREATE TABLE IF NOT EXISTS pots (
      escrow TEXT NOT NULL,
      pot_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      organizer TEXT NOT NULL,
      beneficiary TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (escrow, pot_id)
    );
    CREATE TABLE IF NOT EXISTS pot_contributions (
      escrow TEXT NOT NULL,
      pot_id INTEGER NOT NULL,
      contributor TEXT NOT NULL,
      name TEXT NOT NULL,
      amount TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- "Ask the family": a request someone can pay with one tap.
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      name TEXT NOT NULL,
      amount TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      paid_by TEXT,
      paid_tx TEXT,
      paid_at INTEGER
    );
  `);
  // Columns added after launch.
  for (const sql of [
    "ALTER TABLE links ADD COLUMN recipient TEXT",
    "ALTER TABLE profiles ADD COLUMN character TEXT",
    "ALTER TABLE pots ADD COLUMN beneficiary_name TEXT",
    "ALTER TABLE requests ADD COLUMN paid_name TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch {
      // already there
    }
  }

  const lower = (a: string) => a.toLowerCase();

  return {
    getVault(address: string) {
      return db.prepare("SELECT blob, version, updated_at FROM vaults WHERE address = ?").get(lower(address)) as
        | { blob: string; version: number; updated_at: number }
        | undefined;
    },

    /** Optimistic concurrency: a write must name the version it replaces. */
    putVault(address: string, blob: string, expectedVersion: number) {
      const current = this.getVault(address);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion) return { ok: false as const, version: currentVersion };
      db.prepare(
        `INSERT INTO vaults (address, blob, version, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET blob = excluded.blob, version = excluded.version, updated_at = excluded.updated_at`,
      ).run(lower(address), blob, currentVersion + 1, Date.now());
      return { ok: true as const, version: currentVersion + 1 };
    },

    getProfile(address: string) {
      return db.prepare("SELECT address, handle, inbox_key, character FROM profiles WHERE address = ?").get(lower(address)) as
        | { address: string; handle: string | null; inbox_key: string; character: string | null }
        | undefined;
    },

    findHandle(handle: string) {
      return db.prepare("SELECT address, handle, inbox_key, character FROM profiles WHERE handle = ?").get(handle.toLowerCase()) as
        | { address: string; handle: string; inbox_key: string; character: string | null }
        | undefined;
    },

    putProfile(address: string, handle: string | null, inboxKey: string, character: string | null) {
      const owner = handle ? this.findHandle(handle) : undefined;
      if (owner && owner.address !== lower(address)) return false;
      db.prepare(
        `INSERT INTO profiles (address, handle, inbox_key, character, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET handle = excluded.handle, inbox_key = excluded.inbox_key,
           character = excluded.character, updated_at = excluded.updated_at`,
      ).run(lower(address), handle?.toLowerCase() ?? null, inboxKey, character, Date.now());
      return true;
    },

    addNote(recipient: string, sealed: string, txHash: string | null) {
      db.prepare("INSERT INTO notes (recipient, sealed, tx_hash, created_at) VALUES (?, ?, ?, ?)").run(
        lower(recipient), sealed, txHash, Date.now(),
      );
    },

    notesFor(recipient: string, afterId = 0) {
      return db
        .prepare("SELECT id, sealed, tx_hash, created_at FROM notes WHERE recipient = ? AND id > ? ORDER BY id LIMIT 200")
        .all(lower(recipient), afterId) as { id: number; sealed: string; tx_hash: string | null; created_at: number }[];
    },

    putLink(claimKey: string, sealed: string | null, txHash: string) {
      db.prepare("INSERT OR REPLACE INTO links (claim_key, sealed, tx_hash, created_at) VALUES (?, ?, ?, ?)").run(
        lower(claimKey), sealed, txHash, Date.now(),
      );
    },

    getLink(claimKey: string) {
      return db.prepare("SELECT sealed, tx_hash, created_at, recipient FROM links WHERE claim_key = ?").get(lower(claimKey)) as
        | { sealed: string | null; tx_hash: string; created_at: number; recipient: string | null }
        | undefined;
    },

    setLinkRecipient(claimKey: string, recipient: string) {
      db.prepare("UPDATE links SET recipient = ? WHERE claim_key = ?").run(lower(recipient), lower(claimKey));
    },

    putPot(escrow: string, potId: number, p: { title: string; organizer: string; beneficiary: string; beneficiaryName: string; txHash: string }) {
      db.prepare(
        "INSERT OR REPLACE INTO pots (escrow, pot_id, title, organizer, beneficiary, beneficiary_name, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(lower(escrow), potId, p.title, lower(p.organizer), lower(p.beneficiary), p.beneficiaryName, p.txHash, Date.now());
    },

    getPot(escrow: string, potId: number) {
      return db
        .prepare("SELECT title, organizer, beneficiary, beneficiary_name, tx_hash, created_at FROM pots WHERE escrow = ? AND pot_id = ?")
        .get(lower(escrow), potId) as
        | { title: string; organizer: string; beneficiary: string; beneficiary_name: string | null; tx_hash: string; created_at: number }
        | undefined;
    },

    /** Pots someone organized, is the beneficiary of, or chipped into. */
    potsFor(escrow: string, address: string) {
      return db
        .prepare(
          `SELECT DISTINCT p.pot_id FROM pots p LEFT JOIN pot_contributions c ON c.escrow = p.escrow AND c.pot_id = p.pot_id
           WHERE p.escrow = ? AND (p.organizer = ? OR p.beneficiary = ? OR c.contributor = ?) ORDER BY p.pot_id DESC LIMIT 50`,
        )
        .all(lower(escrow), lower(address), lower(address), lower(address))
        .map((r) => (r as { pot_id: number }).pot_id);
    },

    addContribution(escrow: string, potId: number, c: { contributor: string; name: string; amount: string; txHash: string }) {
      db.prepare(
        "INSERT INTO pot_contributions (escrow, pot_id, contributor, name, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(lower(escrow), potId, lower(c.contributor), c.name, c.amount, c.txHash, Date.now());
    },

    contributions(escrow: string, potId: number) {
      return db
        .prepare("SELECT contributor, name, amount, tx_hash, created_at FROM pot_contributions WHERE escrow = ? AND pot_id = ? ORDER BY created_at")
        .all(lower(escrow), potId) as { contributor: string; name: string; amount: string; tx_hash: string; created_at: number }[];
    },

    putRequest(r: { id: string; requester: string; name: string; amount: string; note: string }) {
      db.prepare("INSERT INTO requests (id, requester, name, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        r.id, lower(r.requester), r.name, r.amount, r.note, Date.now(),
      );
    },

    getRequest(id: string) {
      return db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
        | {
            id: string;
            requester: string;
            name: string;
            amount: string;
            note: string;
            created_at: number;
            paid_by: string | null;
            paid_tx: string | null;
            paid_at: number | null;
            paid_name: string | null;
          }
        | undefined;
    },

    requestsBy(requester: string) {
      return db.prepare("SELECT * FROM requests WHERE requester = ? ORDER BY created_at DESC LIMIT 50").all(lower(requester)) as {
        id: string;
        requester: string;
        name: string;
        amount: string;
        note: string;
        created_at: number;
        paid_by: string | null;
        paid_tx: string | null;
        paid_at: number | null;
        paid_name: string | null;
      }[];
    },

    markRequestPaid(id: string, payer: string, txHash: string, name: string | null) {
      db.prepare("UPDATE requests SET paid_by = ?, paid_tx = ?, paid_at = ?, paid_name = ? WHERE id = ? AND paid_tx IS NULL").run(
        lower(payer), txHash, Date.now(), name, id,
      );
    },
  };
}
