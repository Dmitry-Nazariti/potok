import os from "node:os";
import path from "node:path";

process.env.POTOK_DB = path.join(os.tmpdir(), `potok-check-${Date.now()}.sqlite`);

const { seedDemo } = await import("./seed.js");
const { snapshot, listTransactions } = await import("./db.js");
const { runAgents } = await import("./agents.js");
const { parseCsv } = await import("./csv.js");

seedDemo();
const snap = snapshot();
const result = runAgents();
const metrics = result.metrics;
const titles = result.recommendations.map((item) => `${item.severity}: ${item.agent} — ${item.title}`);

console.log(JSON.stringify({
  accounts: metrics.accounts.map((item) => ({ name: item.name, balance: item.balance })),
  liquid: metrics.liquid,
  safe: metrics.safe,
  daily: metrics.daily,
  health: metrics.health,
  nextPayday: metrics.nextPayday,
  obligations: metrics.obligations.map((item) => `${item.date} ${item.name} ${item.amount}`),
  income: metrics.current.income,
  expense: metrics.current.expense,
  wants: metrics.current.wants,
  savings: metrics.current.savings,
  tx: snap.transactions.length,
  recs: titles,
}, null, 2));

const problems = [];
if (!snap.accounts.length) problems.push("нет счетов");
if (!snap.transactions.length) problems.push("нет операций");
if (!metrics.salary) problems.push("нет зарплаты");
if (!Number.isFinite(metrics.safe)) problems.push("safe не число");
if (!result.recommendations.length) problems.push("агенты молчат");
if (metrics.accounts.some((item) => item.type === "checking" && item.balance < 0)) problems.push("карта в минусе");

const csv = parseCsv("Дата;Сумма;Описание\n26.10.2026;-2140;Пятёрочка\n24.10.2026;5000;Подработка\n");
if (csv.rows.length !== 2) problems.push("csv разобран неверно");
if (csv.rows[0].type !== "expense") problems.push("расход не распознан");
if (!listTransactions({ q: "Пятёрочка" }).length && !listTransactions({ q: "Пятерочка" }).length) {
  problems.push("поиск операций пуст");
}

// Alfa Excel import on a real sample (contains personal data; lives outside the repo).
const fs = await import("node:fs");
const sample = process.env.POTOK_ALFA_SAMPLE || "/workspace/potok-samples/alfa-online-statement.xlsx";
if (fs.existsSync(sample)) {
  const { parseAlfaExcel } = await import("./alfaExcel.js");
  const { db, runAlfaExcelImport } = await import("./db.js");
  const count = () => db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
  const parsed = await parseAlfaExcel(sample);
  const withId = parsed.rows.filter((row) => row.externalId && !row.skipped);
  const holds = parsed.rows.filter((row) => row.skipReason === "hold");
  if (withId.length < 300) problems.push(`alfa: мало строк с externalId (${withId.length})`);
  if (!holds.length) problems.push("alfa: холды не пропущены");
  if (parsed.rows.some((row) => !(row.amountAbs > 0))) problems.push("alfa: сумма <= 0");
  const card = snap.accounts.find((item) => item.type === "checking") || snap.accounts[0];
  const before = count();
  const first = await runAlfaExcelImport({ accountId: card.id, input: sample });
  const afterFirst = count();
  const second = await runAlfaExcelImport({ accountId: card.id, input: fs.readFileSync(sample) });
  const afterSecond = count();
  if (afterFirst - before !== first.stats.inserted) problems.push("alfa: inserted не совпадает с приростом");
  if (afterSecond !== afterFirst || second.stats.inserted !== 0) problems.push("alfa: повторный импорт создал дубли");
  console.log("ALFA", JSON.stringify({ rows: parsed.rows.length, first: first.stats, second: second.stats, txAdded: afterFirst - before }));
} else {
  console.log("ALFA sample not found, skipped");
}

if (problems.length) {
  console.error("SELFCHECK FAILED:", problems.join("; "));
  process.exit(1);
}
console.log("SELFCHECK OK");
