import fs from "node:fs";
import path from "node:path";
import { narrate } from "./ai.js";
import { briefingPayload, monthSlice, runAgents } from "./agents.js";
import { publicDir } from "./config.js";
import { maskAccount, parseAlfaExcel } from "./alfaExcel.js";
import { parseCsv } from "./csv.js";
import {
  ACCOUNT_TYPES,
  GROUP_LABELS,
  STRATEGY_PRESETS,
  VERSION,
} from "./defaults.js";
import {
  aiSettings,
  getImportBatch,
  runAlfaExcelImport,
  contributeGoal,
  createAccount,
  createCategory,
  createGoal,
  createRecurring,
  createRule,
  createTransaction,
  createTransfer,
  deleteRecurring,
  deleteRule,
  deleteTransaction,
  exportAll,
  getCategory,
  getRecommendation,
  isEmpty,
  lastAgentRun,
  listAccounts,
  listCategories,
  listGoals,
  listRecommendations,
  listRecurring,
  listRules,
  listTransactions,
  postRecurring,
  receiveSalary,
  replaceModelNotes,
  resetAll,
  saveAiSettings,
  setRecommendationStatus,
  setStrategy,
  snapshot,
  updateAccount,
  updateCategory,
  updateGoal,
  updateRecurring,
  updateTransaction,
  ensureStrategy,
  getStrategy,
} from "./db.js";
import { seedDemo, seedEmpty } from "./seed.js";
import { isValidDate, monthKey, todayISO } from "./util.js";

const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([A-Za-z]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  }) + "$");
  routes.push({ method, re, keys, handler });
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(res, error) {
  const message = error?.message || "Ошибка";
  const code = /не найден/.test(message) ? 404 : 400;
  json(res, code, { error: message });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("Слишком большой запрос");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Некорректный JSON");
  }
}

function idOf(params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Error("Некорректный идентификатор");
  return id;
}

route("GET", "/api/meta", (_req, res) => {
  json(res, 200, {
    version: VERSION,
    name: "Поток",
    empty: isEmpty(),
    presets: STRATEGY_PRESETS,
    groups: GROUP_LABELS,
    accountTypes: ACCOUNT_TYPES,
    today: todayISO(),
  });
});

route("GET", "/api/overview", (req, res, _params, url) => {
  const month = url.searchParams.get("month") || monthKey(todayISO());
  const analysis = runAgents({ persist: true });
  const snap = snapshot();
  const selected = month === monthKey(snap.today) ? analysis.metrics.current : monthSlice(snap, month);
  const ai = aiSettings();
  json(res, 200, {
    ...analysis.metrics,
    selected,
    recommendations: listRecommendations("open"),
    lastRun: lastAgentRun(),
    ai: { configured: ai.configured, model: ai.model, baseUrl: ai.baseUrl },
    strategy: getStrategy(),
  });
});

route("GET", "/api/transactions", (_req, res, _params, url) => {
  json(res, 200, listTransactions({
    month: url.searchParams.get("month") || undefined,
    accountId: url.searchParams.get("accountId") || undefined,
    categoryId: url.searchParams.get("categoryId") || undefined,
    type: url.searchParams.get("type") || undefined,
    q: url.searchParams.get("q") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  }));
});

route("POST", "/api/transactions", async (req, res) => {
  json(res, 201, createTransaction(await readBody(req)));
});

route("PATCH", "/api/transactions/:id", async (req, res, params) => {
  json(res, 200, updateTransaction(idOf(params), await readBody(req)));
});

route("DELETE", "/api/transactions/:id", (_req, res, params) => {
  json(res, 200, deleteTransaction(idOf(params)));
});

route("POST", "/api/transfers", async (req, res) => {
  json(res, 201, createTransfer(await readBody(req)));
});

route("GET", "/api/accounts", (_req, res) => json(res, 200, listAccounts()));
route("POST", "/api/accounts", async (req, res) => json(res, 201, createAccount(await readBody(req))));
route("PATCH", "/api/accounts/:id", async (req, res, params) => json(res, 200, updateAccount(idOf(params), await readBody(req))));

route("GET", "/api/categories", (_req, res) => json(res, 200, listCategories()));
route("POST", "/api/categories", async (req, res) => json(res, 201, createCategory(await readBody(req))));
route("PATCH", "/api/categories/:id", async (req, res, params) => json(res, 200, updateCategory(idOf(params), await readBody(req))));

route("GET", "/api/recurring", (_req, res) => json(res, 200, listRecurring()));
route("POST", "/api/recurring", async (req, res) => json(res, 201, createRecurring(await readBody(req))));
route("PATCH", "/api/recurring/:id", async (req, res, params) => json(res, 200, updateRecurring(idOf(params), await readBody(req))));
route("DELETE", "/api/recurring/:id", (_req, res, params) => json(res, 200, deleteRecurring(idOf(params))));
route("POST", "/api/recurring/:id/post", async (req, res, params) => {
  const body = await readBody(req);
  json(res, 200, postRecurring(idOf(params), body.date));
});

route("POST", "/api/salary/receive", async (req, res) => {
  json(res, 200, receiveSalary(await readBody(req)));
});

route("GET", "/api/goals", (_req, res) => json(res, 200, listGoals()));
route("POST", "/api/goals", async (req, res) => json(res, 201, createGoal(await readBody(req))));
route("PATCH", "/api/goals/:id", async (req, res, params) => json(res, 200, updateGoal(idOf(params), await readBody(req))));
route("POST", "/api/goals/:id/contribute", async (req, res, params) => {
  json(res, 200, contributeGoal(idOf(params), await readBody(req)));
});

route("GET", "/api/strategy", (_req, res) => json(res, 200, ensureStrategy()));
route("PUT", "/api/strategy", async (req, res) => json(res, 200, setStrategy(await readBody(req))));

route("GET", "/api/rules", (_req, res) => json(res, 200, listRules()));
route("POST", "/api/rules", async (req, res) => json(res, 201, createRule(await readBody(req))));
route("DELETE", "/api/rules/:id", (_req, res, params) => json(res, 200, deleteRule(idOf(params))));

route("GET", "/api/recommendations", (_req, res) => json(res, 200, listRecommendations("open")));

route("POST", "/api/recommendations/:id/accept", (_req, res, params) => {
  const rec = getRecommendation(idOf(params));
  if (!rec) throw new Error("Рекомендация не найдена");
  const payload = rec.actionPayload || {};
  if (rec.actionType === "adjust_budget") updateCategory(payload.categoryId, { monthlyBudget: payload.monthlyBudget });
  else if (rec.actionType === "create_rule") createRule(payload);
  else if (rec.actionType === "set_strategy") setStrategy(payload);
  else if (rec.actionType === "set_buffer") setStrategy({ safetyBuffer: payload.amount });
  else if (rec.actionType === "apply_categories") {
    for (const item of payload.assignments || []) {
      const category = getCategory(item.categoryId);
      if (!category) continue;
      updateTransaction(item.transactionId, { categoryId: item.categoryId });
    }
  }
  json(res, 200, setRecommendationStatus(rec.id, "accepted"));
});

route("POST", "/api/recommendations/:id/dismiss", (_req, res, params) => {
  json(res, 200, setRecommendationStatus(idOf(params), "dismissed"));
});

route("POST", "/api/agents/run", async (req, res) => {
  const body = await readBody(req);
  const result = runAgents({ persist: true });
  let narration = null;
  if (body.narrate) {
    const snap = snapshot();
    const payload = briefingPayload({ ...result, strategyName: snap.strategy.name, needsPct: snap.strategy.needsPct, wantsPct: snap.strategy.wantsPct, savingsPct: snap.strategy.savingsPct });
    narration = await narrate(aiSettings(), payload);
    if (narration.ok) {
      const modelRecs = [
        {
          agent: "Сводка",
          fingerprint: `narrator:${todayISO()}`,
          severity: "info",
          title: "Сводка модели",
          body: narration.briefing,
          actionType: null,
          source: "model",
        },
        ...(narration.tips || []).filter((tip) => tip?.title && tip?.body).map((tip, index) => ({
          agent: "Сводка",
          fingerprint: `narrator:tip:${todayISO()}:${index}`,
          severity: ["info", "warning", "critical"].includes(tip.severity) ? tip.severity : "info",
          title: String(tip.title).slice(0, 140),
          body: String(tip.body).slice(0, 800),
          actionType: null,
          source: "model",
        })),
      ];
      replaceModelNotes(modelRecs);
    }
  }
  json(res, 200, {
    health: result.metrics.health,
    count: listRecommendations("open").length,
    narration,
    recommendations: listRecommendations("open"),
  });
});

route("POST", "/api/onboard", async (req, res) => {
  const body = await readBody(req);
  if (body.mode === "demo") json(res, 200, seedDemo());
  else json(res, 200, seedEmpty(body));
});

route("POST", "/api/demo", (_req, res) => json(res, 200, seedDemo()));
route("POST", "/api/reset", (_req, res) => {
  resetAll();
  json(res, 200, { ok: true });
});

route("GET", "/api/export", (_req, res) => json(res, 200, exportAll()));

route("POST", "/api/import/preview", async (req, res) => {
  const body = await readBody(req);
  const parsed = parseCsv(body.text || "");
  const snap = snapshot();
  const suggestions = parsed.rows.slice(0, 200).map((row) => {
    const pattern = row.description.toLowerCase();
    const category = snap.categories.find((item) => item.keywords.split(",").some((key) => key && pattern.includes(key.trim().toLowerCase())));
    return { ...row, categoryId: category?.id || null, categoryName: category?.name || row.category || "" };
  });
  json(res, 200, { ...parsed, rows: suggestions, total: parsed.rows.length });
});

route("POST", "/api/import/commit", async (req, res) => {
  const body = await readBody(req);
  if (!body.accountId) throw new Error("Выберите счёт");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let created = 0;
  for (const row of rows) {
    if (!isValidDate(row.date) || !(Number(row.amount) > 0)) continue;
    createTransaction({
      accountId: body.accountId,
      categoryId: row.categoryId || null,
      type: row.type === "income" ? "income" : "expense",
      amount: row.amount,
      date: row.date,
      description: row.description || "Импорт",
      source: "import",
    });
    created++;
  }
  json(res, 200, { created });
});

// --- Alfa-Online Excel import. Body: raw .xlsx (octet-stream / spreadsheetml) or multipart/form-data with field "file". ---
async function readRaw(req, limit = 10_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Слишком большой файл");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new Error("Нет boundary в multipart");
  const boundary = Buffer.from("--" + (m[1] || m[2]).trim());
  const fields = {};
  let file = null;
  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buffer.slice(start, start + 2).toString() === "--") break;
    const headEnd = buffer.indexOf("\r\n\r\n", start);
    if (headEnd === -1) break;
    const head = buffer.slice(start, headEnd).toString("utf8");
    const next = buffer.indexOf(boundary, headEnd);
    if (next === -1) break;
    const body = buffer.slice(headEnd + 4, next - 2);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    if (/filename="/i.test(head)) file = body;
    else if (name) fields[name] = body.toString("utf8");
    pos = next;
  }
  return { fields, file };
}

async function readUpload(req, url) {
  const type = String(req.headers["content-type"] || "");
  const raw = await readRaw(req);
  const params = Object.fromEntries(url.searchParams);
  if (type.startsWith("multipart/form-data")) {
    const { fields, file } = parseMultipart(raw, type);
    return { file, params: { ...params, ...fields } };
  }
  return { file: raw, params };
}

const truthy = (v) => v === true || v === "true" || v === "1";

route("POST", "/api/import/alfa/preview", async (req, res, _params, url) => {
  const { file, params } = await readUpload(req, url);
  if (!file?.length) throw new Error("Файл не передан");
  const parsed = await parseAlfaExcel(file, { includeHolds: truthy(params.includeHolds) });
  const limit = Math.min(Number(params.limit) || 50, 500);
  const importable = parsed.rows.filter((row) => !row.skipped);
  json(res, 200, {
    meta: { ...parsed.meta, accountNumber: maskAccount(parsed.meta.accountNumber), client: undefined },
    counts: {
      total: parsed.rows.length,
      importable: importable.length,
      holds: parsed.rows.filter((row) => row.hold).length,
      skipped: parsed.rows.length - importable.length,
      errors: parsed.errors.length,
      income: importable.filter((row) => row.type === "income").length,
      expense: importable.filter((row) => row.type === "expense").length,
    },
    rows: parsed.rows.slice(0, limit),
    errors: parsed.errors,
  });
});

route("POST", "/api/import/alfa/commit", async (req, res, _params, url) => {
  const { file, params } = await readUpload(req, url);
  if (!file?.length) throw new Error("Файл не передан");
  if (!params.accountId) throw new Error("Выберите счёт");
  const batch = await runAlfaExcelImport({ accountId: params.accountId, input: file, includeHolds: truthy(params.includeHolds) });
  json(res, 200, { batchId: batch.id, status: batch.status, stats: batch.stats });
});

route("GET", "/api/import/batches/:id", (_req, res, params) => {
  const batch = getImportBatch(idOf(params));
  if (!batch) throw new Error("Импорт не найден");
  json(res, 200, batch);
});

route("GET", "/api/ai", (_req, res) => {
  const ai = aiSettings();
  json(res, 200, { configured: ai.configured, baseUrl: ai.baseUrl, model: ai.model, keyHint: ai.keyHint });
});

route("PUT", "/api/ai", async (req, res) => json(res, 200, saveAiSettings(await readBody(req))));

route("POST", "/api/ai/test", async (_req, res) => {
  const result = await narrate(aiSettings(), {
    today: todayISO(),
    note: "Проверка связи. Ответь короткой сводкой, что связь есть, без финансовых советов.",
    findings: [],
  });
  json(res, result.ok ? 200 : 400, result);
});

route("GET", "/api/bundle", (_req, res) => {
  ensureStrategy();
  json(res, 200, {
    empty: isEmpty(),
    accounts: listAccounts(),
    categories: listCategories(),
    recurring: listRecurring(),
    goals: listGoals(),
    strategy: getStrategy(),
    rules: listRules(),
    presets: STRATEGY_PRESETS,
  });
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res, urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Не найдено");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

export function handleRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const match = routes.find((item) => item.method === req.method && item.re.test(url.pathname));
  if (!match) {
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(res, decodeURIComponent(url.pathname));
    return json(res, 404, { error: "Маршрут не найден" });
  }
  const values = url.pathname.match(match.re).slice(1);
  const params = Object.fromEntries(match.keys.map((key, index) => [key, values[index]]));
  Promise.resolve()
    .then(() => match.handler(req, res, params, url))
    .catch((error) => {
      if (!res.headersSent) fail(res, error);
    });
}

