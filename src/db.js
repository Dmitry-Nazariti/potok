import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath, dataDir } from "./config.js";
import { ACCOUNT_COLORS, DEFAULT_CATEGORIES, STRATEGY_PRESETS } from "./defaults.js";
import {
  advanceDate,
  isValidDate,
  isoStamp,
  money,
  monthEnd,
  monthStart,
  nextAfter,
  normalizePattern,
  todayISO,
} from "./util.js";

fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath());
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking','cash','savings','credit','investment')),
    currency TEXT NOT NULL DEFAULT 'RUB',
    opening_balance REAL NOT NULL DEFAULT 0,
    color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    group_name TEXT NOT NULL CHECK (group_name IN ('income','needs','wants','savings')),
    icon TEXT NOT NULL DEFAULT '•',
    color TEXT NOT NULL DEFAULT '#8a8678',
    monthly_budget REAL,
    keywords TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount REAL NOT NULL CHECK (amount > 0),
    happened_on TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    recurring_id INTEGER,
    transfer_account_id INTEGER,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS recurring (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount REAL NOT NULL CHECK (amount > 0),
    cadence TEXT NOT NULL CHECK (cadence IN ('monthly','weekly','biweekly')),
    day_of_month INTEGER,
    next_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'bill' CHECK (kind IN ('salary','bill','subscription','savings','other')),
    transfer_account_id INTEGER,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount REAL NOT NULL CHECK (target_amount > 0),
    saved_amount REAL NOT NULL DEFAULT 0,
    deadline TEXT,
    priority INTEGER NOT NULL DEFAULT 2,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS strategy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    needs_pct REAL NOT NULL,
    wants_pct REAL NOT NULL,
    savings_pct REAL NOT NULL,
    monthly_income_hint REAL,
    safety_buffer REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'RUB',
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY,
    agent TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity TEXT NOT NULL,
    action_type TEXT,
    action_payload TEXT,
    source TEXT NOT NULL DEFAULT 'rules',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER,
    monthly_limit REAL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS category_memory (
    pattern TEXT PRIMARY KEY,
    category_id INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1
  ) STRICT;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(happened_on);
  CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_rec_fp ON recommendations(fingerprint);
`);

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalance: row.opening_balance,
    color: row.color,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
  };
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    group: row.group_name,
    icon: row.icon,
    color: row.color,
    monthlyBudget: row.monthly_budget,
    keywords: row.keywords,
    sortOrder: row.sort_order,
    archived: Boolean(row.archived),
  };
}

function mapTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    type: row.type,
    amount: row.amount,
    date: row.happened_on,
    description: row.description,
    notes: row.notes,
    source: row.source,
    recurringId: row.recurring_id,
    transferAccountId: row.transfer_account_id,
    createdAt: row.created_at,
  };
}

function mapRecurring(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id,
    categoryId: row.category_id,
    type: row.type,
    amount: row.amount,
    cadence: row.cadence,
    dayOfMonth: row.day_of_month,
    nextDate: row.next_date,
    active: Boolean(row.active),
    notes: row.notes,
    kind: row.kind,
    transferAccountId: row.transfer_account_id,
    createdAt: row.created_at,
  };
}

function mapGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_amount,
    savedAmount: row.saved_amount,
    deadline: row.deadline,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapStrategy(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    needsPct: row.needs_pct,
    wantsPct: row.wants_pct,
    savingsPct: row.savings_pct,
    monthlyIncomeHint: row.monthly_income_hint,
    safetyBuffer: row.safety_buffer,
    currency: row.currency,
    updatedAt: row.updated_at,
  };
}

function mapRec(row) {
  if (!row) return null;
  return {
    id: row.id,
    agent: row.agent,
    fingerprint: row.fingerprint,
    title: row.title,
    body: row.body,
    severity: row.severity,
    actionType: row.action_type,
    actionPayload: row.action_payload ? JSON.parse(row.action_payload) : null,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    monthlyLimit: row.monthly_limit,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

export function getSetting(key, fallback = null) {
  const row = one("SELECT value FROM settings WHERE key = ?", key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    String(value),
  );
}

export function listAccounts({ includeArchived = false } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM accounts ORDER BY archived, id"
    : "SELECT * FROM accounts WHERE archived = 0 ORDER BY id";
  return all(sql).map(mapAccount);
}

export function getAccount(id) {
  return mapAccount(one("SELECT * FROM accounts WHERE id = ?", id));
}

export function createAccount(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Укажите название счёта");
  const types = ["checking", "cash", "savings", "credit", "investment"];
  const type = types.includes(input.type) ? input.type : "checking";
  const color = input.color || ACCOUNT_COLORS[listAccounts({ includeArchived: true }).length % ACCOUNT_COLORS.length];
  const result = run(
    `INSERT INTO accounts (name, type, currency, opening_balance, color, archived, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    name,
    type,
    input.currency || "RUB",
    money(input.openingBalance || 0),
    color,
    isoStamp(),
  );
  return getAccount(Number(result.lastInsertRowid));
}

export function updateAccount(id, input) {
  const current = getAccount(id);
  if (!current) throw new Error("Счёт не найден");
  const types = ["checking", "cash", "savings", "credit", "investment"];
  run(
    `UPDATE accounts SET name = ?, type = ?, opening_balance = ?, color = ?, archived = ? WHERE id = ?`,
    String(input.name ?? current.name).trim() || current.name,
    types.includes(input.type) ? input.type : current.type,
    input.openingBalance != null ? money(input.openingBalance) : current.openingBalance,
    input.color || current.color,
    input.archived != null ? (input.archived ? 1 : 0) : current.archived ? 1 : 0,
    id,
  );
  return getAccount(id);
}

export function listCategories({ includeArchived = false } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM categories ORDER BY sort_order, id"
    : "SELECT * FROM categories WHERE archived = 0 ORDER BY sort_order, id";
  return all(sql).map(mapCategory);
}

export function getCategory(id) {
  return mapCategory(one("SELECT * FROM categories WHERE id = ?", id));
}

export function createCategory(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Укажите название категории");
  const kind = input.kind === "income" ? "income" : "expense";
  const groups = kind === "income" ? ["income"] : ["needs", "wants", "savings"];
  const group = groups.includes(input.group) ? input.group : groups[0];
  const order = one("SELECT COALESCE(MAX(sort_order), 0) AS n FROM categories").n + 1;
  const result = run(
    `INSERT INTO categories (name, kind, group_name, icon, color, monthly_budget, keywords, sort_order, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    name,
    kind,
    group,
    input.icon || "•",
    input.color || "#8a8678",
    input.monthlyBudget == null || input.monthlyBudget === "" ? null : money(input.monthlyBudget),
    String(input.keywords || ""),
    order,
  );
  return getCategory(Number(result.lastInsertRowid));
}

export function updateCategory(id, input) {
  const current = getCategory(id);
  if (!current) throw new Error("Категория не найдена");
  const kind = input.kind === "income" || input.kind === "expense" ? input.kind : current.kind;
  const groups = kind === "income" ? ["income"] : ["needs", "wants", "savings"];
  const group = groups.includes(input.group) ? input.group : current.group;
  let budget = current.monthlyBudget;
  if (input.monthlyBudget === null || input.monthlyBudget === "") budget = null;
  else if (input.monthlyBudget != null) budget = money(input.monthlyBudget);
  run(
    `UPDATE categories SET name = ?, kind = ?, group_name = ?, icon = ?, color = ?, monthly_budget = ?, keywords = ?, archived = ? WHERE id = ?`,
    String(input.name ?? current.name).trim() || current.name,
    kind,
    group,
    input.icon || current.icon,
    input.color || current.color,
    budget,
    input.keywords != null ? String(input.keywords) : current.keywords,
    input.archived != null ? (input.archived ? 1 : 0) : current.archived ? 1 : 0,
    id,
  );
  return getCategory(id);
}

export function rememberCategory(description, categoryId) {
  const pattern = normalizePattern(description);
  if (!pattern || !categoryId) return;
  run(
    `INSERT INTO category_memory (pattern, category_id, hits) VALUES (?, ?, 1)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, hits = hits + 1`,
    pattern,
    categoryId,
  );
}

export function listMemory() {
  return all("SELECT pattern, category_id AS categoryId, hits FROM category_memory");
}

function assertTx(input, { requireAccount = true } = {}) {
  const amount = money(input.amount);
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  const date = input.date || todayISO();
  if (!isValidDate(date)) throw new Error("Некорректная дата");
  const type = input.type;
  if (!["income", "expense", "transfer"].includes(type)) throw new Error("Некорректный тип операции");
  if (requireAccount && !getAccount(input.accountId)) throw new Error("Счёт не найден");
  if (input.categoryId && !getCategory(input.categoryId)) throw new Error("Категория не найдена");
  return { amount, date, type };
}

export function createTransaction(input) {
  const { amount, date, type } = assertTx(input);
  if (type === "transfer") {
    if (!getAccount(input.transferAccountId)) throw new Error("Укажите счёт назначения");
    if (Number(input.transferAccountId) === Number(input.accountId)) throw new Error("Счета перевода должны отличаться");
  }
  const result = run(
    `INSERT INTO transactions
      (account_id, category_id, type, amount, happened_on, description, notes, source, recurring_id, transfer_account_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.accountId,
    input.categoryId || null,
    type,
    amount,
    date,
    String(input.description || "").trim(),
    String(input.notes || "").trim(),
    input.source || "manual",
    input.recurringId || null,
    type === "transfer" ? input.transferAccountId : null,
    isoStamp(),
  );
  if (input.categoryId && input.description) rememberCategory(input.description, input.categoryId);
  return getTransaction(Number(result.lastInsertRowid));
}

export function getTransaction(id) {
  return mapTx(one("SELECT * FROM transactions WHERE id = ?", id));
}

export function updateTransaction(id, input) {
  const current = getTransaction(id);
  if (!current) throw new Error("Операция не найдена");
  const next = {
    accountId: input.accountId ?? current.accountId,
    categoryId: input.categoryId === undefined ? current.categoryId : input.categoryId,
    type: input.type || current.type,
    amount: input.amount ?? current.amount,
    date: input.date || current.date,
    description: input.description ?? current.description,
    notes: input.notes ?? current.notes,
    transferAccountId: input.transferAccountId === undefined ? current.transferAccountId : input.transferAccountId,
  };
  const checked = assertTx(next);
  if (checked.type === "transfer") {
    if (!getAccount(next.transferAccountId)) throw new Error("Укажите счёт назначения");
  }
  run(
    `UPDATE transactions SET account_id = ?, category_id = ?, type = ?, amount = ?, happened_on = ?, description = ?, notes = ?, transfer_account_id = ? WHERE id = ?`,
    next.accountId,
    next.categoryId || null,
    checked.type,
    checked.amount,
    checked.date,
    String(next.description || "").trim(),
    String(next.notes || "").trim(),
    checked.type === "transfer" ? next.transferAccountId : null,
    id,
  );
  if (next.categoryId && next.description) rememberCategory(next.description, next.categoryId);
  return getTransaction(id);
}

export function deleteTransaction(id) {
  const current = getTransaction(id);
  if (!current) throw new Error("Операция не найдена");
  run("DELETE FROM transactions WHERE id = ?", id);
  return { ok: true };
}

export function listTransactions(filters = {}) {
  const where = [];
  const params = [];
  if (filters.month) {
    where.push("happened_on >= ? AND happened_on <= ?");
    params.push(monthStart(filters.month + "-01"), monthEnd(filters.month + "-01"));
  }
  if (filters.from) {
    where.push("happened_on >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("happened_on <= ?");
    params.push(filters.to);
  }
  if (filters.accountId) {
    where.push("(account_id = ? OR transfer_account_id = ?)");
    params.push(filters.accountId, filters.accountId);
  }
  if (filters.categoryId) {
    where.push("category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.type) {
    where.push("type = ?");
    params.push(filters.type);
  }
  if (filters.q) {
    where.push("(description LIKE ? OR notes LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const sql = `SELECT * FROM transactions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY happened_on DESC, id DESC LIMIT ?`;
  params.push(Math.min(Number(filters.limit) || 500, 2000));
  return all(sql, ...params).map(mapTx);
}

export function createTransfer(input) {
  return createTransaction({
    ...input,
    type: "transfer",
    description: input.description || "Перевод",
    source: input.source || "transfer",
  });
}

export function listRecurring() {
  return all("SELECT * FROM recurring ORDER BY active DESC, next_date, id").map(mapRecurring);
}

export function getRecurring(id) {
  return mapRecurring(one("SELECT * FROM recurring WHERE id = ?", id));
}

export function createRecurring(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Укажите название");
  const amount = money(input.amount);
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  if (!getAccount(input.accountId)) throw new Error("Счёт не найден");
  const cadence = ["monthly", "weekly", "biweekly"].includes(input.cadence) ? input.cadence : "monthly";
  const type = ["income", "expense", "transfer"].includes(input.type) ? input.type : "expense";
  const kinds = ["salary", "bill", "subscription", "savings", "other"];
  const kind = kinds.includes(input.kind) ? input.kind : type === "income" ? "salary" : "bill";
  const nextDate = input.nextDate || todayISO();
  if (!isValidDate(nextDate)) throw new Error("Некорректная дата");
  const day = input.dayOfMonth || Number(nextDate.slice(8, 10));
  const result = run(
    `INSERT INTO recurring
      (name, account_id, category_id, type, amount, cadence, day_of_month, next_date, active, notes, kind, transfer_account_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    name,
    input.accountId,
    input.categoryId || null,
    type,
    amount,
    cadence,
    day,
    nextDate,
    String(input.notes || ""),
    kind,
    input.transferAccountId || null,
    isoStamp(),
  );
  return getRecurring(Number(result.lastInsertRowid));
}

export function updateRecurring(id, input) {
  const current = getRecurring(id);
  if (!current) throw new Error("Повтор не найден");
  const nextDate = input.nextDate || current.nextDate;
  if (!isValidDate(nextDate)) throw new Error("Некорректная дата");
  const amount = input.amount != null ? money(input.amount) : current.amount;
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  run(
    `UPDATE recurring SET name = ?, account_id = ?, category_id = ?, type = ?, amount = ?, cadence = ?, day_of_month = ?, next_date = ?, active = ?, notes = ?, kind = ?, transfer_account_id = ? WHERE id = ?`,
    String(input.name ?? current.name).trim() || current.name,
    input.accountId || current.accountId,
    input.categoryId === undefined ? current.categoryId : input.categoryId || null,
    input.type || current.type,
    amount,
    input.cadence || current.cadence,
    input.dayOfMonth || Number(nextDate.slice(8, 10)),
    nextDate,
    input.active != null ? (input.active ? 1 : 0) : current.active ? 1 : 0,
    input.notes != null ? String(input.notes) : current.notes,
    input.kind || current.kind,
    input.transferAccountId === undefined ? current.transferAccountId : input.transferAccountId || null,
    id,
  );
  return getRecurring(id);
}

export function deleteRecurring(id) {
  if (!getRecurring(id)) throw new Error("Повтор не найден");
  run("DELETE FROM recurring WHERE id = ?", id);
  return { ok: true };
}

export function postRecurring(id, date) {
  const rec = getRecurring(id);
  if (!rec) throw new Error("Повтор не найден");
  const when = date || (rec.nextDate <= todayISO() ? rec.nextDate : todayISO());
  if (!isValidDate(when)) throw new Error("Некорректная дата");
  const recent = one(
    "SELECT happened_on FROM transactions WHERE recurring_id = ? AND happened_on >= ? AND happened_on <= ? LIMIT 1",
    id,
    addDaysSafe(when, -2),
    when,
  );
  if (recent) throw new Error(`Этот повтор уже проведён ${recent.happened_on}`);
  const tx = createTransaction({
    accountId: rec.accountId,
    categoryId: rec.categoryId,
    type: rec.type,
    amount: rec.amount,
    date: when,
    description: rec.name,
    notes: rec.notes,
    source: "recurring",
    recurringId: rec.id,
    transferAccountId: rec.transferAccountId,
  });
  let next = rec.nextDate;
  if (next <= when) {
    while (next <= when) next = advanceDate(rec.cadence, next, rec.dayOfMonth);
  } else {
    next = advanceDate(rec.cadence, next, rec.dayOfMonth);
  }
  updateRecurring(id, { nextDate: next, dayOfMonth: rec.dayOfMonth });
  return { transaction: tx, recurring: getRecurring(id) };
}

export function materializeDue(asOf = todayISO()) {
  const posted = [];
  for (const rec of listRecurring()) {
    if (!rec.active) continue;
    let guard = 0;
    while (rec.nextDate <= asOf && guard < 36) {
      const result = postRecurring(rec.id);
      posted.push(result.transaction);
      rec.nextDate = result.recurring.nextDate;
      guard++;
    }
  }
  return posted;
}

export function listGoals() {
  return all("SELECT * FROM goals ORDER BY status = 'done', priority, id").map(mapGoal);
}

export function getGoal(id) {
  return mapGoal(one("SELECT * FROM goals WHERE id = ?", id));
}

export function createGoal(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Укажите цель");
  const target = money(input.targetAmount);
  if (!(target > 0)) throw new Error("Сумма цели должна быть больше нуля");
  const saved = money(input.savedAmount || 0);
  const result = run(
    `INSERT INTO goals (name, target_amount, saved_amount, deadline, priority, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    name,
    target,
    saved,
    input.deadline || null,
    Number(input.priority) || 2,
    String(input.notes || ""),
    saved >= target ? "done" : "active",
    isoStamp(),
  );
  return getGoal(Number(result.lastInsertRowid));
}

export function updateGoal(id, input) {
  const current = getGoal(id);
  if (!current) throw new Error("Цель не найдена");
  const target = input.targetAmount != null ? money(input.targetAmount) : current.targetAmount;
  const saved = input.savedAmount != null ? money(input.savedAmount) : current.savedAmount;
  if (!(target > 0)) throw new Error("Сумма цели должна быть больше нуля");
  const status = input.status || (saved >= target ? "done" : current.status === "done" ? "active" : current.status);
  run(
    `UPDATE goals SET name = ?, target_amount = ?, saved_amount = ?, deadline = ?, priority = ?, notes = ?, status = ? WHERE id = ?`,
    String(input.name ?? current.name).trim() || current.name,
    target,
    saved,
    input.deadline === undefined ? current.deadline : input.deadline || null,
    input.priority || current.priority,
    input.notes != null ? String(input.notes) : current.notes,
    status,
    id,
  );
  return getGoal(id);
}

export function contributeGoal(id, input) {
  const goal = getGoal(id);
  if (!goal) throw new Error("Цель не найдена");
  const amount = money(input.amount);
  if (!(amount > 0)) throw new Error("Сумма должна быть больше нуля");
  let transaction = null;
  if (input.fromAccountId && input.toAccountId) {
    transaction = createTransfer({
      accountId: input.fromAccountId,
      transferAccountId: input.toAccountId,
      amount,
      date: input.date || todayISO(),
      description: `Цель: ${goal.name}`,
      source: "goal",
    });
  }
  const updated = updateGoal(id, { savedAmount: money(goal.savedAmount + amount) });
  return { goal: updated, transaction };
}

export function getStrategy() {
  return mapStrategy(one("SELECT * FROM strategy WHERE id = 1"));
}

export function setStrategy(input) {
  const current = getStrategy();
  const needs = Number(input.needsPct ?? current?.needsPct ?? 50);
  const wants = Number(input.wantsPct ?? current?.wantsPct ?? 30);
  const savings = Number(input.savingsPct ?? current?.savingsPct ?? 20);
  if ([needs, wants, savings].some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
    throw new Error("Доли должны быть от 0 до 100");
  }
  if (Math.round(needs + wants + savings) !== 100) {
    throw new Error("Нужды, желания и накопления должны давать 100%");
  }
  const name = String(input.name || current?.name || "Свой подход").trim();
  const hint = input.monthlyIncomeHint === undefined ? current?.monthlyIncomeHint ?? null : input.monthlyIncomeHint || null;
  const buffer = input.safetyBuffer != null ? money(input.safetyBuffer) : current?.safetyBuffer ?? 0;
  const currency = input.currency || current?.currency || "RUB";
  if (current) {
    run(
      `UPDATE strategy SET name = ?, needs_pct = ?, wants_pct = ?, savings_pct = ?, monthly_income_hint = ?, safety_buffer = ?, currency = ?, updated_at = ? WHERE id = 1`,
      name,
      needs,
      wants,
      savings,
      hint,
      buffer,
      currency,
      isoStamp(),
    );
  } else {
    run(
      `INSERT INTO strategy (id, name, needs_pct, wants_pct, savings_pct, monthly_income_hint, safety_buffer, currency, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name,
      needs,
      wants,
      savings,
      hint,
      buffer,
      currency,
      isoStamp(),
    );
  }
  return getStrategy();
}

export function ensureStrategy() {
  if (!getStrategy()) {
    const preset = STRATEGY_PRESETS[0];
    setStrategy(preset);
  }
  return getStrategy();
}

export function insertDefaultCategories() {
  if (one("SELECT id FROM categories LIMIT 1")) return listCategories({ includeArchived: true });
  DEFAULT_CATEGORIES.forEach((row, index) => {
    run(
      `INSERT INTO categories (name, kind, group_name, icon, color, monthly_budget, keywords, sort_order, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      row[0],
      row[1],
      row[2],
      row[3],
      row[4],
      row[5],
      row[6],
      index + 1,
    );
  });
  return listCategories();
}

export function listRules() {
  return all("SELECT * FROM rules ORDER BY active DESC, id").map(mapRule);
}

export function createRule(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Укажите название правила");
  const existing = one("SELECT id FROM rules WHERE name = ? AND active = 1", name);
  if (existing) return mapRule(one("SELECT * FROM rules WHERE id = ?", existing.id));
  const result = run(
    `INSERT INTO rules (name, category_id, monthly_limit, active, created_at) VALUES (?, ?, ?, 1, ?)`,
    name,
    input.categoryId || null,
    input.monthlyLimit != null ? money(input.monthlyLimit) : null,
    isoStamp(),
  );
  return mapRule(one("SELECT * FROM rules WHERE id = ?", Number(result.lastInsertRowid)));
}

export function deleteRule(id) {
  run("DELETE FROM rules WHERE id = ?", id);
  return { ok: true };
}

export function listRecommendations(status) {
  const rows = status
    ? all("SELECT * FROM recommendations WHERE status = ? ORDER BY id DESC", status)
    : all("SELECT * FROM recommendations ORDER BY id DESC LIMIT 100");
  const rank = { critical: 0, warning: 1, info: 2, positive: 3 };
  return rows.map(mapRec).sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.id - a.id);
}

export function getRecommendation(id) {
  return mapRec(one("SELECT * FROM recommendations WHERE id = ?", id));
}

export function syncRecommendations(produced, { closeMissing = true } = {}) {
  const open = all("SELECT * FROM recommendations WHERE status = 'open'").map(mapRec);
  const fresh = new Set(produced.map((item) => item.fingerprint));
  if (closeMissing) {
    for (const item of open) {
      if (item.source === "model") continue;
      if (!fresh.has(item.fingerprint)) run("UPDATE recommendations SET status = 'done' WHERE id = ?", item.id);
    }
  }
  const now = isoStamp();
  for (const item of produced) {
    const recentDismiss = one(
      "SELECT created_at, status FROM recommendations WHERE fingerprint = ? ORDER BY id DESC LIMIT 1",
      item.fingerprint,
    );
    if (recentDismiss?.status === "dismissed") {
      const age = Date.now() - new Date(recentDismiss.created_at).getTime();
      if (age < 14 * 86400000) continue;
    }
    const existing = one("SELECT id FROM recommendations WHERE fingerprint = ? AND status = 'open'", item.fingerprint);
    const payload = item.actionPayload ? JSON.stringify(item.actionPayload) : null;
    if (existing) {
      run(
        `UPDATE recommendations SET title = ?, body = ?, severity = ?, action_type = ?, action_payload = ?, source = ?, created_at = ? WHERE id = ?`,
        item.title,
        item.body,
        item.severity,
        item.actionType || null,
        payload,
        item.source || "rules",
        now,
        existing.id,
      );
    } else {
      run(
        `INSERT INTO recommendations (agent, fingerprint, title, body, severity, action_type, action_payload, source, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        item.agent,
        item.fingerprint,
        item.title,
        item.body,
        item.severity,
        item.actionType || null,
        payload,
        item.source || "rules",
        now,
      );
    }
  }
  return listRecommendations("open");
}

export function replaceModelNotes(produced) {
  run("UPDATE recommendations SET status = 'done' WHERE source = 'model' AND status = 'open'");
  return syncRecommendations(produced, { closeMissing: false });
}

export function setRecommendationStatus(id, status) {
  const current = getRecommendation(id);
  if (!current) throw new Error("Рекомендация не найдена");
  run("UPDATE recommendations SET status = ? WHERE id = ?", status, id);
  return getRecommendation(id);
}

export function salaryRecurring() {
  return listRecurring().find((item) => item.active && item.kind === "salary") || null;
}

export function receiveSalary(input = {}) {
  const rec = input.recurringId ? getRecurring(input.recurringId) : salaryRecurring();
  const kind = input.payKind || "salary";
  const categories = listCategories();
  const byName = Object.fromEntries(categories.map((item) => [item.name, item]));
  const category =
    kind === "advance" ? byName["Аванс"] : kind === "bonus" ? byName["Премия"] : byName["Зарплата"] || (rec ? getCategory(rec.categoryId) : null);
  const accountId = input.accountId || rec?.accountId;
  if (!accountId) throw new Error("Сначала укажите счёт для зарплаты");
  const amount = money(input.amount || rec?.amount);
  if (!(amount > 0)) throw new Error("Укажите сумму");
  const date = input.date || todayISO();
  if (!isValidDate(date)) throw new Error("Некорректная дата");
  const recent = listTransactions({ from: addDaysSafe(date, -10), to: date, type: "income" }).filter((tx) => {
    const cat = categories.find((item) => item.id === tx.categoryId);
    return cat && ["Зарплата", "Аванс"].includes(cat.name);
  });
  if (recent.length && !input.confirm) {
    return {
      needsConfirm: true,
      recent,
      message: `Похожая выплата уже есть ${recent[0].date}. Подтвердите, если это отдельное поступление.`,
    };
  }
  const tx = createTransaction({
    accountId,
    categoryId: category?.id || null,
    type: "income",
    amount,
    date,
    description: input.description || (kind === "advance" ? "Аванс" : kind === "bonus" ? "Премия" : rec?.name || "Зарплата"),
    source: "salary",
    recurringId: kind === "salary" ? rec?.id : null,
  });
  let recurring = rec;
  if (rec && kind === "salary") {
    const next = rec.nextDate <= date ? nextAfter(rec, date) : advanceDate(rec.cadence, rec.nextDate, rec.dayOfMonth);
    recurring = updateRecurring(rec.id, { nextDate: next, amount: input.updateAmount ? amount : rec.amount });
  }
  return { transaction: tx, recurring, needsConfirm: false };
}

function addDaysSafe(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function computeBalances(accounts, transactions) {
  const map = new Map(accounts.map((account) => [account.id, account.openingBalance]));
  for (const tx of transactions) {
    if (tx.type === "income") map.set(tx.accountId, money((map.get(tx.accountId) || 0) + tx.amount));
    else if (tx.type === "expense") map.set(tx.accountId, money((map.get(tx.accountId) || 0) - tx.amount));
    else if (tx.type === "transfer") {
      map.set(tx.accountId, money((map.get(tx.accountId) || 0) - tx.amount));
      if (tx.transferAccountId) map.set(tx.transferAccountId, money((map.get(tx.transferAccountId) || 0) + tx.amount));
    }
  }
  return map;
}

export function snapshot() {
  const accounts = listAccounts({ includeArchived: true });
  const categories = listCategories({ includeArchived: true });
  const transactions = all("SELECT * FROM transactions ORDER BY happened_on, id").map(mapTx);
  const recurring = listRecurring();
  const goals = listGoals();
  const strategy = ensureStrategy();
  const rules = listRules();
  const balances = computeBalances(accounts, transactions);
  return {
    accounts,
    categories,
    transactions,
    recurring,
    goals,
    strategy,
    rules,
    balances,
    memory: listMemory(),
    today: todayISO(),
  };
}

export function aiSettings() {
  const key = getSetting("ai_api_key", process.env.POTOK_API_KEY || "");
  const baseUrl = getSetting("ai_base_url", process.env.POTOK_BASE_URL || "https://api.openai.com/v1");
  const model = getSetting("ai_model", process.env.POTOK_MODEL || "gpt-4o-mini");
  return {
    configured: Boolean(key),
    baseUrl,
    model,
    key,
    keyHint: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : "",
  };
}

export function saveAiSettings(input) {
  if (input.baseUrl != null) setSetting("ai_base_url", String(input.baseUrl).trim());
  if (input.model != null) setSetting("ai_model", String(input.model).trim());
  if (input.apiKey) setSetting("ai_api_key", String(input.apiKey).trim());
  if (input.clearKey) setSetting("ai_api_key", "");
  const saved = aiSettings();
  return { configured: saved.configured, baseUrl: saved.baseUrl, model: saved.model, keyHint: saved.keyHint };
}

export function exportAll() {
  return {
    exportedAt: isoStamp(),
    accounts: listAccounts({ includeArchived: true }),
    categories: listCategories({ includeArchived: true }),
    transactions: all("SELECT * FROM transactions ORDER BY id").map(mapTx),
    recurring: listRecurring(),
    goals: listGoals(),
    strategy: getStrategy(),
    rules: listRules(),
  };
}

export function resetAll() {
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM recurring;
    DELETE FROM goals;
    DELETE FROM recommendations;
    DELETE FROM rules;
    DELETE FROM category_memory;
    DELETE FROM accounts;
    DELETE FROM categories;
    DELETE FROM strategy;
    DELETE FROM settings;
  `);
}

export function isEmpty() {
  return !one("SELECT id FROM accounts LIMIT 1");
}

export function lastAgentRun() {
  return getSetting("last_agent_run", null);
}

export function markAgentRun() {
  setSetting("last_agent_run", isoStamp());
}
