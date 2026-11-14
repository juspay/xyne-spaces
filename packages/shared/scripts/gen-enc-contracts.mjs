// Prints the encryption contract rows for every request contract, from the built
// registry (run `pnpm run build` first).
import { REQUEST_CONTRACTS, contractToRule } from '../dist/enc-contracts/index.js';

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlJson = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;

const rows = REQUEST_CONTRACTS.map((contract) => {
  const rule = contractToRule(contract);
  return `  (${[
    sqlString(rule.type),
    sqlString(rule.value),
    rule.revision,
    sqlJson(rule.fields),
    sqlJson(rule.extractionPolicy ?? {}),
  ].join(', ')})`;
});

console.log(
  `INSERT INTO "enc_contract_entries" ("type","value","revision","fields","extractionPolicy") VALUES\n${rows.join(',\n')}\nON CONFLICT ("type","value","revision") DO NOTHING;`,
);
