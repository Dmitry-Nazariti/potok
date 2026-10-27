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

if (problems.length) {
  console.error("SELFCHECK FAILED:", problems.join("; "));
  process.exit(1);
}
console.log("SELFCHECK OK");
