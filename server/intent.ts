// Turns "send mum 50k every Friday" into a transfer the app can show for
// confirmation. The model (Claude or Kimi, whichever key is set) only sees the
// sentence and contact nicknames, never addresses or balances, and nothing
// executes without the user confirming.

export type Intent = {
  kind: "send" | "schedule" | "unknown";
  recipient: string | null;
  amount: number | null;
  currency: "USD" | "NGN" | null;
  mode: "fixed" | "topup";
  cadence: "daily" | "weekly" | "monthly" | null;
  weekday: number | null; // 0 = Sunday
  count: number | null;
  note: string | null;
  explanation: string;
};

const SYSTEM = `You turn a remittance request into JSON for a money app that sends US dollars (AUSD) to family, mostly in Nigeria.
Reply with one JSON object only, with these keys:
- kind: "send" for a one-off transfer, "schedule" for a repeating one, "unknown" if it isn't a request to send money.
- recipient: the person exactly as they appear in the contacts list, or the name the user wrote if they're not in it, or null.
- amount: a number. "50k" means 50000. null if missing.
- currency: "NGN" when the user means naira (₦, naira, or a large round number like 50k for a Nigerian recipient with no currency), otherwise "USD".
- mode: "topup" when the user wants to keep someone's balance at a level ("keep mum at $100", "top up to"), otherwise "fixed".
- cadence: "daily", "weekly", "monthly" or null.
- weekday: 0-6 (Sunday = 0) if a day of the week is named, else null.
- count: how many times, if the user says ("for 3 months" weekly = 13), else null.
- note: a short message to attach if the user included one ("for school fees"), else null.
- explanation: one short plain-English sentence describing what will happen, for the confirm screen.`;

export type Engine = "claude" | "kimi";

/** Which model reads requests: Claude if its key is set, else Kimi, else none (the rules below). */
export function intentEngine(): Engine | null {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.KIMI_API_KEY) return "kimi";
  return null;
}

function prompt(text: string, contacts: string[]) {
  return `Today is ${new Date().toDateString()}.\nContacts: ${contacts.length ? contacts.join(", ") : "(none)"}\nRequest: ${text}`;
}

async function askClaude(text: string, contacts: string[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(text, contacts) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const out = (json.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  // The reply is one JSON object; take it even if the model wraps it in prose or a fence.
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Claude didn't return JSON");
  return out.slice(start, end + 1);
}

async function askKimi(text: string, contacts: string[]): Promise<string> {
  const res = await fetch(`${process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1"}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.KIMI_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.KIMI_MODEL ?? "kimi-k2.6",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt(text, contacts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Kimi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices[0].message.content;
}

export async function parseIntent(text: string, contacts: string[], engine: Engine): Promise<Intent> {
  const raw = engine === "claude" ? await askClaude(text, contacts) : await askKimi(text, contacts);
  const parsed = JSON.parse(raw) as Partial<Intent>;
  return {
    kind: parsed.kind === "send" || parsed.kind === "schedule" ? parsed.kind : "unknown",
    recipient: parsed.recipient ?? null,
    amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null,
    currency: parsed.currency === "NGN" ? "NGN" : parsed.currency === "USD" ? "USD" : null,
    mode: parsed.mode === "topup" ? "topup" : "fixed",
    cadence: parsed.cadence ?? null,
    weekday: typeof parsed.weekday === "number" ? parsed.weekday : null,
    count: typeof parsed.count === "number" ? parsed.count : null,
    note: parsed.note ?? null,
    explanation: parsed.explanation ?? "",
  };
}

// ---------------------------------------------------------------- fallback

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, k: 1_000, million: 1_000_000, m: 1_000_000 };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "fifty thousand" → 50000, "2.5k" → 2500, "50,000" → 50000. Returns null if there's no number. */
export function readAmount(text: string): number | null {
  const digits = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i);
  if (digits) {
    const n = Number(digits[1].replace(/,/g, ""));
    const scale = digits[2] ? SCALES[digits[2].toLowerCase()] : 1;
    return n * scale;
  }
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of text.toLowerCase().split(/[\s-]+/)) {
    if (word in UNITS && (word !== "a" || seen === false)) {
      if (word === "a") continue; // only counts before a scale ("a hundred")
      current += UNITS[word];
      seen = true;
    } else if (word in SCALES && word.length > 1) {
      current = (current || 1) * SCALES[word];
      if (SCALES[word] >= 1000) {
        total += current;
        current = 0;
      }
      seen = true;
    } else if (seen && word !== "and") {
      break;
    }
  }
  return seen ? total + current : null;
}

/**
 * A rule-based reading of the common phrasings, used when Kimi isn't
 * configured: "send mum fifty thousand naira", "send @tunde $20 every friday".
 */
export function ruleIntent(text: string, contacts: string[]): Intent {
  const t = text.trim();
  const lower = t.toLowerCase();
  const amount = readAmount(lower);
  const currency = /₦|naira|\bngn\b/.test(lower) ? "NGN" : /\$|dollar|\busd\b/.test(lower) ? "USD" : amount && amount >= 1000 ? "NGN" : "USD";
  const contact = contacts.find((c) => lower.includes(c.replace(/^@/, "").toLowerCase()));
  const named = t.match(/\b(?:send|give|pay)\s+(@?[A-Za-z][\w.]*)/i)?.[1];
  const recipient = contact ?? (named && !/^\d/.test(named) ? named : null);
  const weekday = DAYS.findIndex((d) => lower.includes(d));
  const cadence = /every day|daily/.test(lower)
    ? "daily"
    : /every week|weekly|every (sun|mon|tues|wednes|thurs|fri|satur)day/.test(lower)
      ? "weekly"
      : /every month|monthly/.test(lower)
        ? "monthly"
        : null;
  const note = t.match(/\bfor\s+(.+)$/i)?.[1]?.replace(/[.!]$/, "") ?? null;
  const kind = !/\b(send|give|pay|transfer)\b/i.test(t) || amount === null ? "unknown" : cadence ? "schedule" : "send";
  const shown = amount === null ? "" : currency === "NGN" ? `₦${amount.toLocaleString("en-NG")}` : `$${amount.toLocaleString("en-US")}`;
  return {
    kind,
    recipient,
    amount,
    currency,
    mode: /top ?up|keep .* at/.test(lower) ? "topup" : "fixed",
    cadence,
    weekday: weekday >= 0 ? weekday : null,
    count: null,
    note: note && !DAYS.some((d) => note.toLowerCase().includes(d)) ? note : null,
    explanation:
      kind === "unknown" ? "" : `Send ${shown} to ${recipient ?? "someone"}${cadence ? `, ${cadence}` : ""}${note ? ` for ${note}` : ""}.`,
  };
}
