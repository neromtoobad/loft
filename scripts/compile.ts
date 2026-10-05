// Compiles contracts/*.sol with solc-js into out/<Name>.json ({ abi, bytecode }).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import solc from "solc";

const sources = Object.fromEntries(
  readdirSync("contracts")
    .filter((f) => f.endsWith(".sol"))
    .map((f) => [f, { content: readFileSync(`contracts/${f}`, "utf8") }]),
);

const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        evmVersion: "prague",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);

const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

for (const file of Object.keys(output.contracts)) {
  for (const [name, c] of Object.entries<any>(output.contracts[file])) {
    if (!c.evm.bytecode.object) continue; // interfaces
    writeFileSync(`out/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2));
    if (name === "LoftEscrow") writeFileSync("shared/escrow-abi.json", JSON.stringify(c.abi, null, 2));
    console.log(`out/${name}.json  ${c.evm.bytecode.object.length / 2} bytes`);
  }
}
