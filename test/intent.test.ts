// Plain-language requests: the model call (with the API stubbed) and the rules fallback.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { intentEngine, parseIntent, ruleIntent } from "../server/intent.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.KIMI_API_KEY;
});

describe("intent", () => {
  it("prefers Claude, then Kimi, then the rules", () => {
    assert.equal(intentEngine(), null);
    process.env.KIMI_API_KEY = "k";
    assert.equal(intentEngine(), "kimi");
    process.env.ANTHROPIC_API_KEY = "a";
    assert.equal(intentEngine(), "claude");
  });

  it("asks Claude's Messages API and reads the JSON out of its reply", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    let sent: any;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = { url, headers: init.headers, body: JSON.parse(String(init.body)) };
      const reply = '```json\n{"kind":"send","recipient":"Mum","amount":50000,"currency":"NGN","mode":"fixed","cadence":null,"weekday":null,"count":null,"note":"school fees","explanation":"Send ₦50,000 to Mum for school fees."}\n```';
      return new Response(JSON.stringify({ content: [{ type: "text", text: reply }] }), { status: 200 });
    }) as typeof fetch;
    const intent = await parseIntent("abeg send Mama 50k for school fees", ["Mum"], "claude");
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent.headers["x-api-key"], "test-key");
    assert.equal(sent.headers["anthropic-version"], "2023-06-01");
    assert.match(sent.body.model, /^claude-/);
    assert.match(sent.body.messages[0].content, /Contacts: Mum/);
    assert.deepEqual(
      { kind: intent.kind, recipient: intent.recipient, amount: intent.amount, currency: intent.currency, note: intent.note },
      { kind: "send", recipient: "Mum", amount: 50000, currency: "NGN", note: "school fees" },
    );
  });

  it("reads spoken numbers without a model", () => {
    const i = ruleIntent("send Mum fifty thousand naira", ["Mum"]);
    assert.deepEqual([i.kind, i.recipient, i.amount, i.currency], ["send", "Mum", 50000, "NGN"]);
  });
});
