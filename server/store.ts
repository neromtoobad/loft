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
  `);
  // Columns added after launch.
  for (const sql of ["ALTER TABLE links ADD COLUMN recipient TEXT", "ALTER TABLE profiles ADD COLUMN character TEXT"]) {
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
  };
}
