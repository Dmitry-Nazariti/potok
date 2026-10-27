import { createAccount, createGoal, createRecurring, createTransaction, insertDefaultCategories, resetAll, setStrategy } from "./db.js";
import { STRATEGY_PRESETS } from "./defaults.js";
import { addDays, advanceDate, formatISO, parseISO, todayISO } from "./util.js";

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function between(random, min, max) {
  return Math.round((min + (max - min) * random()) / 10) * 10;
}

function occurrenceOnOrBefore(day, today) {
  const current = parseISO(today);
  let cursor = new Date(current.getFullYear(), current.getMonth(), 1);
  cursor.setDate(Math.min(day, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()));
  if (formatISO(cursor) > today) cursor.setMonth(cursor.getMonth() - 1);
  cursor.setDate(Math.min(day, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()));
  return formatISO(cursor);
}

function nextMonthly(day, today) {
  const last = occurrenceOnOrBefore(day, today);
  if (last === today) return today;
  return advanceDate("monthly", last, day);
}

export function seedDemo() {
  resetAll();
  const categories = insertDefaultCategories();
  const byName = Object.fromEntries(categories.map((item) => [item.name, item]));
  const card = createAccount({ name: "Дебетовая карта", type: "checking", openingBalance: 42000, color: "#e0b15a" });
  const cash = createAccount({ name: "Наличные", type: "cash", openingBalance: 9000, color: "#9caf72" });
  const savings = createAccount({ name: "Накопительный", type: "savings", openingBalance: 90000, color: "#7ea0b8" });
  setStrategy({ ...STRATEGY_PRESETS[0], monthlyIncomeHint: 172000, safetyBuffer: 10000 });

  const today = todayISO();
  const salaryNext = nextMonthly(10, today);
  const rentNext = nextMonthly(1, today);
  const salary = createRecurring({
    name: "Зарплата",
    accountId: card.id,
    categoryId: byName["Зарплата"].id,
    type: "income",
    amount: 172000,
    cadence: "monthly",
    dayOfMonth: 10,
    nextDate: salaryNext,
    kind: "salary",
  });
  const rent = createRecurring({
    name: "Аренда",
    accountId: card.id,
    categoryId: byName["Жильё"].id,
    type: "expense",
    amount: 48000,
    cadence: "monthly",
    dayOfMonth: 1,
    nextDate: rentNext,
    kind: "bill",
  });
  const utils = createRecurring({
    name: "ЖКХ",
    accountId: card.id,
    categoryId: byName["Жильё"].id,
    type: "expense",
    amount: 5400,
    cadence: "monthly",
    dayOfMonth: 8,
    nextDate: nextMonthly(8, today),
    kind: "bill",
  });
  const phone = createRecurring({
    name: "МТС",
    accountId: card.id,
    categoryId: byName["Связь"].id,
    type: "expense",
    amount: 750,
    cadence: "monthly",
    dayOfMonth: 18,
    nextDate: nextMonthly(18, today),
    kind: "subscription",
  });
  const plus = createRecurring({
    name: "Яндекс Плюс",
    accountId: card.id,
    categoryId: byName["Подписки"].id,
    type: "expense",
    amount: 399,
    cadence: "monthly",
    dayOfMonth: 4,
    nextDate: nextMonthly(4, today),
    kind: "subscription",
  });
  const spotify = createRecurring({
    name: "Spotify",
    accountId: card.id,
    categoryId: byName["Подписки"].id,
    type: "expense",
    amount: 199,
    cadence: "monthly",
    dayOfMonth: 9,
    nextDate: nextMonthly(9, today),
    kind: "subscription",
  });
  const ivi = createRecurring({
    name: "Иви",
    accountId: card.id,
    categoryId: byName["Подписки"].id,
    type: "expense",
    amount: 399,
    cadence: "monthly",
    dayOfMonth: 21,
    nextDate: nextMonthly(21, today),
    kind: "subscription",
  });
  const saveRec = createRecurring({
    name: "Перевод в подушку",
    accountId: card.id,
    transferAccountId: savings.id,
    type: "transfer",
    amount: 20000,
    cadence: "monthly",
    dayOfMonth: 12,
    nextDate: nextMonthly(12, today),
    kind: "savings",
  });

  const pastMonths = [-3, -2, -1, 0];
  const random = rng(20261027);
  const cafeScale = [0.45, 0.7, 1.05, 1.85];
  pastMonths.forEach((shift, index) => {
    const anchor = parseISO(today);
    anchor.setMonth(anchor.getMonth() + shift);
    const stamp = formatISO(anchor);
    const salaryDate = occurrenceOnOrBefore(10, stamp);
    if (salaryDate < today && salaryDate.slice(0, 7) === stamp.slice(0, 7)) {
      createTransaction({
        accountId: card.id,
        categoryId: byName["Зарплата"].id,
        type: "income",
        amount: 172000,
        date: salaryDate,
        description: "Зарплата",
        source: "recurring",
        recurringId: salary.id,
      });
    }
    const rentDate = occurrenceOnOrBefore(1, stamp);
    if (rentDate < today && rentDate.slice(0, 7) === stamp.slice(0, 7)) {
      createTransaction({
        accountId: card.id,
        categoryId: byName["Жильё"].id,
        type: "expense",
        amount: 48000,
        date: rentDate,
        description: "Аренда",
        source: "recurring",
        recurringId: rent.id,
      });
    }
    for (const [rec, day, amount, name, category] of [
      [utils, 8, 5400, "ЖКХ", "Жильё"],
      [phone, 18, 750, "МТС", "Связь"],
      [plus, 4, 399, "Яндекс Плюс", "Подписки"],
      [spotify, 9, 199, "Spotify", "Подписки"],
      [ivi, 21, 399, "Иви", "Подписки"],
    ]) {
      const date = occurrenceOnOrBefore(day, stamp);
      if (date < today && date.slice(0, 7) === stamp.slice(0, 7)) {
        createTransaction({
          accountId: card.id,
          categoryId: byName[category].id,
          type: "expense",
          amount,
          date,
          description: name,
          source: "recurring",
          recurringId: rec.id,
        });
      }
    }
    const saveDate = occurrenceOnOrBefore(12, stamp);
    if (saveDate < today && saveDate.slice(0, 7) === stamp.slice(0, 7)) {
      const amount = index === 3 ? 8000 : index === 2 ? 15000 : 20000;
      createTransaction({
        accountId: card.id,
        transferAccountId: savings.id,
        type: "transfer",
        amount,
        date: saveDate,
        description: "Перевод в подушку",
        source: "recurring",
        recurringId: saveRec.id,
      });
    }
    const monthStart = `${stamp.slice(0, 7)}-01`;
    for (let n = 0; n < 7; n++) {
      const date = addDays(monthStart, Math.floor(random() * 27));
      if (date >= today || date.slice(0, 7) !== stamp.slice(0, 7)) continue;
      createTransaction({
        accountId: random() > 0.85 ? cash.id : card.id,
        categoryId: byName["Продукты"].id,
        type: "expense",
        amount: between(random, 890, 4200),
        date,
        description: pick(random, ["Пятёрочка", "ВкусВилл", "Перекрёсток", "Магнит"]),
        source: "manual",
      });
    }
    const cafeCount = 2 + index;
    for (let n = 0; n < cafeCount; n++) {
      const date = addDays(monthStart, Math.floor(random() * 27));
      if (date >= today || date.slice(0, 7) !== stamp.slice(0, 7)) continue;
      createTransaction({
        accountId: card.id,
        categoryId: byName["Кафе и доставка"].id,
        type: "expense",
        amount: Math.round(between(random, 450, 1800) * cafeScale[index]),
        date,
        description: pick(random, ["Кофемания", "Додо Пицца", "Яндекс Еда", "Surf Coffee"]),
        source: "manual",
      });
    }
    for (let n = 0; n < 3; n++) {
      const date = addDays(monthStart, 2 + Math.floor(random() * 24));
      if (date >= today || date.slice(0, 7) !== stamp.slice(0, 7)) continue;
      createTransaction({
        accountId: card.id,
        categoryId: byName["Транспорт"].id,
        type: "expense",
        amount: between(random, 180, 890),
        date,
        description: pick(random, ["Метро", "Яндекс Go"]),
        source: "manual",
      });
    }
  });

  const bonusDate = addDays(occurrenceOnOrBefore(10, addDays(today, -40)), 3);
  if (bonusDate < today) {
    createTransaction({
      accountId: card.id,
      categoryId: byName["Премия"].id,
      type: "income",
      amount: 30000,
      date: bonusDate,
      description: "Квартальная премия",
      source: "manual",
    });
  }
  createTransaction({
    accountId: card.id,
    transferAccountId: savings.id,
    type: "transfer",
    amount: 285000,
    date: addDays(today, -88),
    description: "Перенос на накопительный",
    source: "manual",
  });
  const jacketDate = addDays(today, -12);
  createTransaction({
    accountId: card.id,
    categoryId: byName["Маркетплейсы"].id,
    type: "expense",
    amount: 23990,
    date: jacketDate,
    description: "Wildberries — пуховик",
    source: "manual",
  });
  createTransaction({
    accountId: card.id,
    categoryId: null,
    type: "expense",
    amount: 640,
    date: addDays(today, -2),
    description: "Кофемания",
    source: "manual",
  });
  createTransaction({
    accountId: card.id,
    categoryId: null,
    type: "expense",
    amount: 640,
    date: addDays(today, -1),
    description: "Кофемания",
    source: "manual",
  });
  createGoal({
    name: "Подушка на 3 месяца",
    targetAmount: 520000,
    savedAmount: 430000,
    deadline: advanceDate("monthly", today, 1).slice(0, 8) + "01",
    priority: 1,
    notes: "Три месяца обязательных расходов",
  });
  return { ok: true };
}

export function seedEmpty(input = {}) {
  resetAll();
  const categories = insertDefaultCategories();
  const salaryCategory = categories.find((item) => item.name === "Зарплата");
  const account = createAccount({
    name: input.accountName || "Основная карта",
    type: "checking",
    openingBalance: input.balance || 0,
    color: "#e0b15a",
  });
  const preset = STRATEGY_PRESETS.find((item) => item.id === input.strategyId) || STRATEGY_PRESETS[0];
  setStrategy({
    ...preset,
    monthlyIncomeHint: input.salary || null,
    safetyBuffer: input.buffer ?? 0,
  });
  if (input.salary > 0 && input.payday) {
    const nextDate = nextMonthly(Number(input.payday), todayISO());
    createRecurring({
      name: "Зарплата",
      accountId: account.id,
      categoryId: salaryCategory.id,
      type: "income",
      amount: input.salary,
      cadence: "monthly",
      dayOfMonth: Number(input.payday),
      nextDate,
      kind: "salary",
    });
  }
  return { ok: true, account };
}
