import crypto from "node:crypto";
import ExcelJS from "exceljs";

// Alfa-Online "Выписка по счету" (.xlsx). Layout verified on a real sample:
// header at row 20, data from row 21; A date, B posting date (HOLD for holds),
// D bank code, E bank category, L description, M signed amount, O status.
const HEADER_ROW = 20;

function text(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join("").trim();
    if ("result" in v) return String(v.result ?? "").trim();
    if ("text" in v) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
}

export function parseRuDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseRuAmount(value) {
  const cleaned = String(value).replace(/[\s\u00a0\u202f]/g, "").replace(/RU[RB]$/i, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function maskAccount(number) {
  const s = String(number || "");
  return s.length > 8 ? `${s.slice(0, 4)}****${s.slice(-4)}` : s ? "****" : "";
}

function normDesc(s) {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function holdId(row) {
  const cents = Math.round(row.amountAbs * 100);
  const key = [row.happenedOn, cents, row.type, normDesc(row.description)].join("|");
  return "alfa:h:" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export async function parseAlfaExcel(input, { includeHolds = false } = {}) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(input)) await wb.xlsx.load(input);
  else await wb.xlsx.readFile(input);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("В файле нет листов");
  const cell = (r, c) => text(ws.getRow(r).getCell(c));

  if (cell(HEADER_ROW, "A") !== "Дата операции" || cell(HEADER_ROW, "D") !== "Код" || !cell(HEADER_ROW, "M").startsWith("Сумма")) {
    throw new Error("Не похоже на выписку Альфа-Онлайн: не найден заголовок операций в строке 20");
  }

  const meta = { accountNumber: "", periodFrom: null, periodTo: null, currency: "", currentBalance: null, client: "" };
  for (let r = 1; r < HEADER_ROW; r++) {
    const label = cell(r, "A");
    if (label === "Номер счета") meta.accountNumber = cell(r, "C");
    if (label === "Валюта счета") meta.currency = cell(r, "C");
    if (label === "Клиент") meta.client = cell(r, "C");
    const right = cell(r, "K");
    const period = /с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/.exec(right);
    if (period) {
      meta.periodFrom = parseRuDate(period[1]);
      meta.periodTo = parseRuDate(period[2]);
    }
    if (/баланс/i.test(right)) meta.currentBalance = parseRuAmount(cell(r, "N"));
  }
  if (meta.currency === "RUR") meta.currency = "RUB";

  const rows = [];
  const errors = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const rawDate = cell(r, "A");
    if (!rawDate) continue;
    const happenedOn = parseRuDate(rawDate);
    if (!happenedOn) continue; // footer: signatures, totals
    const amount = parseRuAmount(cell(r, "M"));
    if (amount == null || amount === 0) {
      errors.push({ row: r, reason: "Некорректная сумма" });
      continue;
    }
    const posting = cell(r, "B");
    const code = cell(r, "D");
    const row = {
      row: r,
      happenedOn,
      postingOn: parseRuDate(posting),
      code,
      categoryBank: cell(r, "E"),
      description: cell(r, "L"),
      amountAbs: Math.abs(amount),
      type: amount < 0 ? "expense" : "income",
      status: cell(r, "O"),
      hold: posting.toUpperCase() === "HOLD" || !code,
      externalId: code ? `alfa:${code}` : null,
    };
    if (row.hold && !code) {
      if (includeHolds) row.externalId = holdId(row);
      else {
        row.skipped = true;
        row.skipReason = "hold";
      }
    }
    rows.push(row);
  }
  return { meta, rows, errors };
}
