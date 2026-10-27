import { isValidDate, money } from "./util.js";

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((item) => item.trim()) || "";
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  const tab = (line.match(/\t/g) || []).length;
  if (tab > comma && tab > semi) return "\t";
  return semi > comma ? ";" : ",";
}

function parseLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function headerKey(value) {
  const text = value.toLowerCase().replace(/ё/g, "е").trim();
  if (/дата|date|posted/.test(text)) return "date";
  if (/описан|назначен|detail|description|merchant|комментар/.test(text)) return "description";
  if (/категор/.test(text)) return "category";
  if (/приход|зачислен|credit|income/.test(text)) return "credit";
  if (/расход|списан|debit|outcome/.test(text)) return "debit";
  if (/сумм|amount|sum|value/.test(text)) return "amount";
  return null;
}

function parseDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    return isValidDate(iso) ? iso : null;
  }
  match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (match) {
    const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  const text = String(value).replace(/\s/g, "").replace(/₽|руб\.?/gi, "").replace(",", ".");
  const n = Number(text);
  return Number.isFinite(n) ? money(n) : null;
}

export function parseCsv(text) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) return { rows: [], warnings: ["Файл пустой"] };
  const delimiter = detectDelimiter(cleaned);
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim());
  const head = parseLine(lines[0], delimiter).map(headerKey);
  const hasHeader = head.some(Boolean);
  const rows = [];
  const warnings = [];
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const cells = parseLine(lines[i], delimiter);
    if (cells.every((cell) => !cell)) continue;
    let date;
    let description = "";
    let category = "";
    let amount = null;
    if (hasHeader) {
      const bag = {};
      head.forEach((key, index) => {
        if (key) bag[key] = cells[index] || "";
      });
      date = parseDate(bag.date);
      description = bag.description || "";
      category = bag.category || "";
      if (bag.credit || bag.debit) {
        const credit = parseAmount(bag.credit) || 0;
        const debit = parseAmount(bag.debit) || 0;
        amount = money(credit - Math.abs(debit));
      } else amount = parseAmount(bag.amount);
    } else {
      date = parseDate(cells[0]);
      amount = parseAmount(cells[1]);
      description = cells[2] || "";
    }
    if (!date || amount == null || amount === 0) {
      if (cells.join("").length > 2) warnings.push(`Строка ${i + 1} пропущена`);
      continue;
    }
    rows.push({
      date,
      amount: Math.abs(amount),
      type: amount > 0 ? "income" : "expense",
      description: description.trim(),
      category,
    });
  }
  return { delimiter, hasHeader, rows, warnings: warnings.slice(0, 8) };
}
