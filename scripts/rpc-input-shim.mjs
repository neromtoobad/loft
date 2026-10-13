// The tevm fork reads call data only from `data`; Go clients (the CRE simulator)
// send it as `input`. This JSON-RPC proxy on :8547 copies one to the other.
import { createServer } from "node:http";
const UPSTREAM = "http://localhost:8545";
const fix = (msg) => {
  for (const p of Array.isArray(msg.params) ? msg.params : [])
    if (p && typeof p === "object" && p.input && !p.data) p.data = p.input;
  return msg;
};
createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  let msg = JSON.parse(body);
  msg = Array.isArray(msg) ? msg.map(fix) : fix(msg);
  const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(await r.text());
}).listen(8547, () => console.log("rpc shim :8547 -> :8545"));
