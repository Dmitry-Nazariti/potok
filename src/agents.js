import { lastAgentRun, markAgentRun, snapshot, syncRecommendations } from "./db.js";
import {
  addDays,
  advanceDate,
  clamp,
  daysBetween,
  daysInMonth,
  money,
  monthEnd,
  monthKey,
  monthStart,
  normalizePattern,
  roundPct,
  shiftMonth,
  sum,
} from "./util.js";

const SEVERITY = { critical: 0, warning: 1, info: 2, positive: 3 };

function rub(amount, currency = "RUB") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
  }).format(Math.round(amount));
}

function catOf(snap, id) {
  return snap.categories.find((item) => item.id === id) || null;
}

function accountOf(snap, id) {
  return snap.accounts.find((item) => item.id === id) || null;
}

function monthTransactions(snap, month) {
  return snap.transactions.filter((tx) => tx.date.slice(0, 7) === month);
}

function isSavingsTransfer(snap, tx) {
  if (tx.type !== "transfer") return false;
  return accountOf(snap, tx.transferAccountId)?.type === "savings";
}

function groupSpend(snap, month, group) {
  return sum(
    monthTransactions(snap, month).filter((tx) => tx.type === "expense" && catOf(snap, tx.categoryId)?.group === group),
    (tx) => tx.amount,
  );
}

function savingsMoved(snap, month) {
  const tagged = groupSpend(snap, month, "savings");
  const transfers = sum(
    monthTransactions(snap, month).filter((tx) => isSavingsTransfer(snap, tx)),
    (tx) => tx.amount,
  );
  return money(tagged + transfers);
}

function withoutOutliers(list) {
  if (list.length < 5) return list;
  const amounts = list.map((tx) => tx.amount).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  const cap = Math.max(median * 3, median + 7000);
  const filtered = list.filter((tx) => tx.amount <= cap);
  return filtered.length >= 3 ? filtered : list;
}

function suggestCategory(description, snap) {
  const pattern = normalizePattern(description);
  if (!pattern) return null;
  const memory = snap.memory.find((item) => item.pattern === pattern)
    || snap.memory.find((item) => item.pattern.length > 3 && (pattern.includes(item.pattern) || item.pattern.includes(pattern)));
  if (memory) return { categoryId: memory.categoryId, confidence: 0.95, via: "memory" };
  for (const category of snap.categories) {
    if (category.archived) continue;
    const keys = String(category.keywords || "")
      .split(",")
      .map((item) => normalizePattern(item))
      .filter((item) => item.length > 2);
    if (keys.some((key) => pattern.includes(key))) return { categoryId: category.id, confidence: 0.8, via: "keyword" };
  }
  return null;
}

function scheduledDates(rec, today, until) {
  const dates = [];
  if (!rec.active) return dates;
  let cursor = rec.nextDate;
  let guard = 0;
  while (guard < 80) {
    const date = cursor < today ? today : cursor;
    const overdue = cursor < today;
    if (date > until && !overdue) break;
    dates.push({ date, scheduled: cursor, overdue });
    const next = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
    if (next <= cursor) break;
    cursor = next;
    guard++;
    if (!overdue && cursor > until) break;
  }
  return dates;
}

function billsBetween(snap, fromInclusive, untilExclusive) {
  const items = [];
  for (const rec of snap.recurring) {
    if (!rec.active || rec.type !== "expense") continue;
    let cursor = rec.nextDate;
    let guard = 0;
    while (cursor < fromInclusive && guard < 80) {
      const next = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
      if (next <= cursor) break;
      cursor = next;
      guard++;
    }
    while (cursor < untilExclusive && guard < 80) {
      items.push({
        id: rec.id,
        name: rec.name,
        amount: rec.amount,
        date: cursor,
        kind: rec.kind,
        categoryId: rec.categoryId,
      });
      const next = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
      if (next <= cursor) break;
      cursor = next;
      guard++;
    }
  }
  return items;
}

function collectObligations(snap, today, until, { exclusiveEnd = false } = {}) {
  const items = [];
  for (const rec of snap.recurring) {
    if (!rec.active || rec.type !== "expense") continue;
    for (const slot of scheduledDates(rec, today, until)) {
      if (slot.date < today) continue;
      if (exclusiveEnd ? slot.date >= until : slot.date > until) continue;
      if (slot.overdue || (slot.date >= today && (exclusiveEnd ? slot.date < until : slot.date <= until))) {
        items.push({
          id: rec.id,
          name: rec.name,
          amount: rec.amount,
          date: slot.overdue ? today : slot.date,
          scheduled: slot.scheduled,
          overdue: slot.overdue,
          kind: rec.kind,
          categoryId: rec.categoryId,
        });
      }
    }
  }
  return items;
}

function buildForecast(snap, today, liquid) {
  const until = addDays(today, 60);
  const variable = snap.transactions.filter((tx) => {
    if (tx.type !== "expense" || tx.source === "recurring") return false;
    if (tx.date < addDays(today, -30) || tx.date > today) return false;
    const group = catOf(snap, tx.categoryId)?.group;
    return group === "needs" || group === "wants" || !tx.categoryId;
  });
  const baseline = withoutOutliers(variable);
  const oldest = baseline.reduce((min, tx) => (min && min < tx.date ? min : tx.date), null);
  const span = oldest ? clamp(daysBetween(oldest, today) + 1, 1, 30) : 30;
  const variableDaily = baseline.length ? sum(baseline, (tx) => tx.amount) / span : 0;
  const eventsByDate = new Map();
  for (const rec of snap.recurring) {
    if (!rec.active) continue;
    for (const slot of scheduledDates(rec, today, until)) {
      const date = slot.date;
      if (date > until) continue;
      if (!eventsByDate.has(date)) eventsByDate.set(date, []);
      eventsByDate.get(date).push({
        name: rec.name,
        amount: rec.amount,
        type: rec.type,
        kind: rec.kind,
        overdue: slot.overdue,
        toSavings: rec.type === "transfer" && accountOf(snap, rec.transferAccountId)?.type === "savings",
      });
    }
  }
  let balance = liquid;
  const points = [];
  let min = { date: today, balance: liquid };
  for (let i = 0; i <= 60; i++) {
    const date = addDays(today, i);
    if (i > 0) balance = money(balance - variableDaily);
    const events = eventsByDate.get(date) || [];
    for (const event of events) {
      if (event.type === "income") balance = money(balance + event.amount);
      else if (event.type === "expense") balance = money(balance - event.amount);
      else if (event.toSavings || event.kind === "savings") balance = money(balance - event.amount);
    }
    points.push({
      date,
      balance,
      events: events.map((event) => event.name),
    });
    if (balance < min.balance) min = { date, balance };
  }
  return { points, variableDaily: money(variableDaily), min, until };
}

function monthSlice(snap, month) {
  const currency = snap.strategy.currency || "RUB";
  const start = `${month}-01`;
  const isCurrent = month === monthKey(snap.today);
  const day = isCurrent ? Number(snap.today.slice(8, 10)) : daysInMonth(start);
  const dim = daysInMonth(start);
  const income = sum(
    monthTransactions(snap, month).filter((tx) => tx.type === "income"),
    (tx) => tx.amount,
  );
  const needs = groupSpend(snap, month, "needs");
  const wants = groupSpend(snap, month, "wants");
  const savings = savingsMoved(snap, month);
  const expense = money(needs + wants);
  const base = income || snap.strategy.monthlyIncomeHint || 0;
  const categories = snap.categories
    .filter((category) => !category.archived && category.kind === "expense")
    .map((category) => {
      const txs = monthTransactions(snap, month).filter((tx) => tx.type === "expense" && tx.categoryId === category.id);
      const spent = sum(txs, (tx) => tx.amount);
      const recurringSpent = sum(txs.filter((tx) => tx.source === "recurring"), (tx) => tx.amount);
      const budget = category.monthlyBudget;
      const pace = budget == null ? null : money((budget * day) / dim);
      const variableSpent = money(spent - recurringSpent);
      const projected = isCurrent && day > 0 ? money(recurringSpent + (variableSpent / day) * dim) : spent;
      return {
        id: category.id,
        name: category.name,
        group: category.group,
        icon: category.icon,
        color: category.color,
        spent,
        budget,
        pace,
        projected,
        remaining: budget == null ? null : money(budget - spent),
      };
    })
    .filter((category) => category.spent > 0 || category.budget != null);
  return {
    month,
    label: start,
    income,
    expense,
    needs,
    wants,
    savings,
    net: money(income - expense - savings),
    savingsRate: base > 0 ? roundPct((savings / base) * 100) : 0,
    needsRate: base > 0 ? roundPct((needs / base) * 100) : 0,
    wantsRate: base > 0 ? roundPct((wants / base) * 100) : 0,
    base,
    categories,
    currency,
  };
}

export function buildMetrics(snap = snapshot()) {
  const today = snap.today;
  const currency = snap.strategy.currency || "RUB";
  const accounts = snap.accounts
    .filter((account) => !account.archived)
    .map((account) => ({ ...account, balance: money(snap.balances.get(account.id) || 0) }));
  const liquid = money(
    accounts.filter((account) => account.type === "checking" || account.type === "cash").reduce((total, account) => total + account.balance, 0),
  );
  const savingsBalance = money(accounts.filter((account) => account.type === "savings").reduce((total, account) => total + account.balance, 0));
  const netWorth = money(accounts.reduce((total, account) => total + account.balance, 0));
  const salary = snap.recurring.find((item) => item.active && item.kind === "salary") || null;
  const paydayOverdue = Boolean(salary && salary.nextDate < today);
  const paydayToday = Boolean(salary && salary.nextDate === today);
  const nextPayday = salary ? salary.nextDate : null;
  const daysUntilPayday = salary && salary.nextDate >= today ? daysBetween(today, salary.nextDate) : salary ? 0 : null;
  const horizon = salary && salary.nextDate > today ? salary.nextDate : null;
  const obligations = horizon
    ? collectObligations(snap, today, horizon, { exclusiveEnd: true })
    : collectObligations(snap, today, addDays(today, 30));
  const obligationTotal = sum(obligations, (item) => item.amount);
  const buffer = snap.strategy.safetyBuffer || 0;
  const safe = money(liquid - buffer - obligationTotal);
  const safeDays = horizon ? Math.max(daysUntilPayday, 1) : 30;
  const daily = money(safe / safeDays);
  const following = salary ? advanceDate(salary.cadence, salary.nextDate < today ? today : salary.nextDate, salary.dayOfMonth) : null;
  const planStart = salary ? (salary.nextDate < today ? today : salary.nextDate) : today;
  const planBills = salary ? billsBetween(snap, planStart, following) : [];
  const expectedIncome = salary?.amount || snap.strategy.monthlyIncomeHint || 0;
  const savingsTarget = money((expectedIncome * snap.strategy.savingsPct) / 100);
  const planBillTotal = sum(planBills, (item) => item.amount);
  const leftForLife = money(expectedIncome - planBillTotal - savingsTarget);
  const forecast = buildForecast(snap, today, liquid);
  const current = monthSlice(snap, monthKey(today));
  const previous = monthSlice(snap, monthKey(shiftMonth(today, -1)));
  const last7 = snap.transactions.filter((tx) => tx.type === "expense" && tx.date >= addDays(today, -6) && tx.date <= today && catOf(snap, tx.categoryId)?.group === "wants");
  const burn7 = money(sum(last7, (tx) => tx.amount) / 7);
  const subscriptions = snap.recurring.filter((item) => item.active && item.kind === "subscription");
  const subscriptionMonthly = sum(subscriptions, (item) => (item.cadence === "weekly" ? item.amount * 4.345 : item.cadence === "biweekly" ? item.amount * 2.17 : item.amount));
  const upcoming = [];
  for (const rec of snap.recurring.filter((item) => item.active)) {
    for (const slot of scheduledDates(rec, today, addDays(today, 21))) {
      if (slot.date > addDays(today, 21)) continue;
      upcoming.push({
        id: rec.id,
        name: rec.name,
        amount: rec.amount,
        date: slot.overdue ? today : slot.date,
        type: rec.type,
        kind: rec.kind,
        overdue: slot.overdue,
      });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ru"));
  let health = 100;
  if (!salary) health -= 8;
  if (safe < 0) health -= 28;
  else if (safe < buffer) health -= 8;
  if (forecast.min.balance < 0 && daysBetween(today, forecast.min.date) <= 35) health -= 18;
  if (current.base > 0 && current.savingsRate + 2 < snap.strategy.savingsPct) health -= 10;
  const overruns = current.categories.filter((category) => category.budget != null && category.projected > category.budget * 1.05);
  health -= Math.min(24, overruns.length * 6);
  health = clamp(Math.round(health), 0, 100);
  return {
    today,
    currency,
    accounts,
    liquid,
    savingsBalance,
    netWorth,
    salary,
    paydayOverdue,
    paydayToday,
    nextPayday,
    daysUntilPayday,
    obligations,
    obligationTotal,
    buffer,
    safe,
    daily,
    safeDays,
    paycheck: {
      income: expectedIncome,
      bills: planBillTotal,
      savings: savingsTarget,
      left: leftForLife,
      next: following,
      items: planBills,
    },
    forecast,
    current,
    previous,
    burn7,
    subscriptionMonthly: money(subscriptionMonthly),
    subscriptions,
    upcoming: upcoming.slice(0, 8),
    health,
    empty: accounts.length === 0,
  };
}

function push(list, item) {
  list.push(item);
}

export function analyze(snap = snapshot()) {
  const metrics = buildMetrics(snap);
  const recs = [];
  const fmt = (n) => rub(n, metrics.currency);
  const { today, salary, strategy } = { ...metrics, strategy: snap.strategy };

  if (!salary) {
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:missing",
      severity: "warning",
      title: "Зарплата не задана",
      body: "Без даты и суммы выплаты нельзя честно сказать, сколько можно потратить до следующих денег. Добавьте зарплату как повтор — это займёт минуту.",
      actionType: null,
    });
  } else if (metrics.paydayOverdue) {
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:overdue",
      severity: "warning",
      title: `Зарплата с ${salary.nextDate} не отмечена`,
      body: `Ожидалась выплата ${fmt(salary.amount)}. Если деньги уже пришли, отметьте получение — иначе прогноз считает, что их ещё нет. Если задерживают, не планируйте траты из этой суммы.`,
      actionType: null,
    });
  } else if (metrics.paydayToday) {
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:today",
      severity: "info",
      title: "Сегодня день зарплаты",
      body: `По плану придёт ${fmt(salary.amount)}. После поступления отложите ${fmt(metrics.paycheck.savings)} и оставьте ${fmt(metrics.paycheck.bills)} на обязательные платежи до следующей выплаты. На жизнь останется ${fmt(metrics.paycheck.left)}.`,
      actionType: null,
    });
  }

  if (salary && metrics.safe < 0) {
    const bill = [...metrics.obligations].sort((a, b) => b.amount - a.amount)[0];
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:gap",
      severity: "critical",
      title: `До зарплаты не хватает ${fmt(Math.abs(metrics.safe))}`,
      body: bill
        ? `На картах и в наличных ${fmt(metrics.liquid)}. До ${metrics.nextPayday} нужно закрыть обязательные платежи на ${fmt(metrics.obligationTotal)}${metrics.buffer ? ` и буфер ${fmt(metrics.buffer)}` : ""}. Крупнейший — «${bill.name}» ${fmt(bill.amount)}${bill.date !== today ? ` ${bill.date}` : ""}. Не планируйте желания, пока этот разрыв не закрыт.`
        : `Свободных денег меньше, чем уже зарезервированный буфер и ближайшие платежи.`,
      actionType: null,
    });
  } else if (salary && metrics.nextPayday > today) {
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:allowance",
      severity: "info",
      title: `До зарплаты можно ${fmt(metrics.safe)}`,
      body: `Это около ${fmt(metrics.daily)} в день на ${metrics.daysUntilPayday} дн. Обязательные платежи до выплаты уже вычтены (${fmt(metrics.obligationTotal)}). Буфер: ${fmt(metrics.buffer)}.`,
      actionType: null,
    });
  }

  if (salary && metrics.paycheck.income > 0 && metrics.paycheck.left < 0) {
    const drop = Math.min(10, Math.max(0, snap.strategy.savingsPct - 5));
    push(recs, {
      agent: "Касса",
      fingerprint: "salary:plan-gap",
      severity: "critical",
      title: "Зарплаты не хватает на текущий подход",
      body: `Выплата ${fmt(metrics.paycheck.income)} минус обязательные ${fmt(metrics.paycheck.bills)} и норма накоплений ${fmt(metrics.paycheck.savings)} даёт ${fmt(metrics.paycheck.left)}. Либо снизьте постоянные платежи, либо временно уменьшите долю накоплений — жизнь на минусе не сходится.`,
      actionType: drop >= 5 ? "set_strategy" : null,
      actionPayload: drop >= 5 ? {
        name: "Временно мягче",
        needsPct: snap.strategy.needsPct,
        wantsPct: money(snap.strategy.wantsPct + drop),
        savingsPct: money(snap.strategy.savingsPct - drop),
      } : null,
    });
  }

  for (const category of metrics.current.categories) {
    if (category.budget == null || category.group === "savings") continue;
    const left = money(category.budget - category.spent);
    if (category.spent > category.budget) {
      push(recs, {
        agent: "Бюджет",
        fingerprint: `budget:over:${category.id}`,
        severity: "critical",
        title: `${category.name}: лимит уже превышен`,
        body: `Потрачено ${fmt(category.spent)} из ${fmt(category.budget)}. Сверх плана ${fmt(category.spent - category.budget)}. До конца месяца эта категория должна стоять на паузе, иначе дневной лимит — фикция.`,
        actionType: "create_rule",
        actionPayload: { name: `Стоп: ${category.name}`, categoryId: category.id, monthlyLimit: category.budget },
      });
    } else if (category.projected > category.budget * 1.08 && category.spent > (category.pace || 0)) {
      push(recs, {
        agent: "Бюджет",
        fingerprint: `budget:pace:${category.id}`,
        severity: "warning",
        title: `${category.name} обгоняет план`,
        body: `Сейчас ${fmt(category.spent)} при темпе месяца ${fmt(category.pace)}. Если так пойдёт дальше, выйдет около ${fmt(category.projected)} при лимите ${fmt(category.budget)}. До конца месяца можно ещё ${fmt(left)}.`,
        actionType: "create_rule",
        actionPayload: { name: `Лимит: ${category.name}`, categoryId: category.id, monthlyLimit: category.budget },
      });
    }
  }

  for (const rule of snap.rules.filter((item) => item.active && item.monthlyLimit != null)) {
    const spent = rule.categoryId
      ? sum(monthTransactions(snap, monthKey(today)).filter((tx) => tx.type === "expense" && tx.categoryId === rule.categoryId), (tx) => tx.amount)
      : 0;
    if (spent > rule.monthlyLimit) {
      push(recs, {
        agent: "Бюджет",
        fingerprint: `rule:${rule.id}`,
        severity: "warning",
        title: `Правило «${rule.name}» нарушено`,
        body: `Лимит ${fmt(rule.monthlyLimit)}, факт ${fmt(spent)}. Правило имеет смысл, только если следующий платёж в этой категории вы откладываете осознанно.`,
        actionType: null,
      });
    }
  }

  const base = metrics.current.base;
  if (base > 0) {
    const wantTarget = money((base * snap.strategy.wantsPct) / 100);
    const saveTarget = money((base * snap.strategy.savingsPct) / 100);
    const wantGap = money(metrics.current.wants - wantTarget);
    const saveGap = money(saveTarget - metrics.current.savings);
    if (wantGap > Math.max(1500, base * 0.03)) {
      const worst = metrics.current.categories
        .filter((category) => category.group === "wants")
        .sort((a, b) => b.spent - a.spent)[0];
      push(recs, {
        agent: "Подход",
        fingerprint: "approach:wants",
        severity: wantGap > base * 0.08 ? "warning" : "info",
        title: `Желания выше подхода на ${fmt(wantGap)}`,
        body: worst
          ? `Подход «${snap.strategy.name}» оставляет на желания ${snap.strategy.wantsPct}% (${fmt(wantTarget)}). Факт — ${fmt(metrics.current.wants)}. Больше всего уходит в «${worst.name}»: ${fmt(worst.spent)}. Режьте эту категорию, а не «всё понемногу».`
          : `На желания ушло ${fmt(metrics.current.wants)} при плане ${fmt(wantTarget)}.`,
        actionType: null,
      });
    }
    if (saveGap > Math.max(2000, base * 0.04) && Number(today.slice(8, 10)) >= 8) {
      push(recs, {
        agent: "Подход",
        fingerprint: "approach:savings",
        severity: "warning",
        title: `До нормы накоплений не хватает ${fmt(saveGap)}`,
        body: `Цель подхода — ${snap.strategy.savingsPct}% (${fmt(saveTarget)}). Отложено ${fmt(metrics.current.savings)}. Удобный момент — день зарплаты: переведите сумму сразу, до кафе и маркетплейсов.`,
        actionType: null,
      });
    }
    if (metrics.current.savingsRate >= snap.strategy.savingsPct && metrics.current.wantsRate <= snap.strategy.wantsPct + 1 && metrics.safe >= 0) {
      push(recs, {
        agent: "Подход",
        fingerprint: "approach:ok",
        severity: "positive",
        title: "Подход в этом месяце держится",
        body: `Накопления ${metrics.current.savingsRate}% при цели ${snap.strategy.savingsPct}%. Желания ${metrics.current.wantsRate}% при потолке ${snap.strategy.wantsPct}%. Менять рамку не нужно — держите дневной лимит ${fmt(Math.max(metrics.daily, 0))}.`,
        actionType: null,
      });
    }
  }

  if (metrics.daily > 0 && metrics.burn7 > metrics.daily * 1.35 && metrics.burn7 - metrics.daily > 200) {
    push(recs, {
      agent: "Подход",
      fingerprint: "approach:burn",
      severity: "warning",
      title: "Последние 7 дней быстрее лимита",
      body: `Желания идут темпом ${fmt(metrics.burn7)} в день, а до зарплаты можно ${fmt(metrics.daily)}. Если не сбавить, лимит кончится раньше выплаты. На этой неделе желания — только из оставшейся дневной суммы.`,
      actionType: null,
    });
  }

  const prevWants = new Map(metrics.previous.categories.map((category) => [category.id, category.spent]));
  const rising = metrics.current.categories
    .filter((category) => category.group === "wants" && category.spent > 2000)
    .map((category) => ({ ...category, delta: money(category.spent - (prevWants.get(category.id) || 0)) }))
    .filter((category) => category.delta > 2500 && category.spent > (prevWants.get(category.id) || 0) * 1.4)
    .sort((a, b) => b.delta - a.delta)[0];
  if (rising) {
    push(recs, {
      agent: "Подход",
      fingerprint: `approach:rise:${rising.id}`,
      severity: "info",
      title: `${rising.name}: +${fmt(rising.delta)} к прошлому месяцу`,
      body: `Было ${fmt(prevWants.get(rising.id) || 0)}, стало ${fmt(rising.spent)}. Это не «жизнь подорожала» само по себе — посмотрите операции этой категории и решите, какая из них была лишней.`,
      actionType: null,
    });
  }

  if (metrics.forecast.min.balance < 0) {
    push(recs, {
      agent: "Прогноз",
      fingerprint: "forecast:gap",
      severity: daysBetween(today, metrics.forecast.min.date) <= 21 ? "critical" : "warning",
      title: `Прогноз уходит в минус ${metrics.forecast.min.date}`,
      body: `Если тратить как в последние недели (${fmt(metrics.forecast.variableDaily)} переменных в день) и провести все повторы, свободный остаток опустится до ${fmt(metrics.forecast.min.balance)}. Это ещё не приговор: пауза в желаниях сдвигает дату.`,
      actionType: null,
    });
  } else if (metrics.forecast.min.balance < Math.max(metrics.buffer, 5000) && metrics.forecast.min.balance >= 0) {
    push(recs, {
      agent: "Прогноз",
      fingerprint: "forecast:thin",
      severity: "info",
      title: "Запас по прогнозу тонкий",
      body: `Самая низкая точка 60 дней — ${fmt(metrics.forecast.min.balance)} ${metrics.forecast.min.date}. Имеет смысл не опускать буфер ниже этой суммы.`,
      actionType: "set_buffer",
      actionPayload: { amount: Math.max(0, Math.round(metrics.forecast.min.balance / 1000) * 1000) },
    });
  }

  if (metrics.subscriptionMonthly >= 1500) {
    push(recs, {
      agent: "Прогноз",
      fingerprint: "forecast:subs",
      severity: metrics.subscriptionMonthly > (metrics.paycheck.income || 1) * 0.08 ? "warning" : "info",
      title: `Подписки: ${fmt(metrics.subscriptionMonthly)} в месяц`,
      body: `За год это ${fmt(metrics.subscriptionMonthly * 12)}. Список: ${metrics.subscriptions.map((item) => item.name).join(", ") || "—"}. Отключите то, чем не пользовались 30 дней — это самый дешёвый способ поменять подход.`,
      actionType: null,
    });
  }

  const recent = snap.transactions.filter((tx) => tx.date >= addDays(today, -50));
  const anomalies = [];
  for (const tx of recent) {
    if (tx.type !== "expense") continue;
    const peers = snap.transactions.filter((item) => item.type === "expense" && item.categoryId === tx.categoryId && item.id !== tx.id && item.date < tx.date);
    if (peers.length < 4) continue;
    const amounts = peers.map((item) => item.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (tx.amount >= Math.max(median * 2.8, median + 6000) && tx.amount >= 4000) {
      anomalies.push(tx);
    }
  }
  for (const tx of anomalies.slice(0, 3)) {
    const category = catOf(snap, tx.categoryId);
    push(recs, {
      agent: "Аномалии",
      fingerprint: `anomaly:${tx.id}`,
      severity: "warning",
      title: `Нетипичная трата: ${tx.description || category?.name || "операция"}`,
      body: `${fmt(tx.amount)} ${tx.date}${category ? `, категория «${category.name}»` : ""}. Для вас это сильно выше обычного чека. Если покупка разовая — просто знайте, что она съела дневной лимит на много дней вперёд.`,
      actionType: null,
    });
  }

  const seen = new Set();
  for (const tx of recent.filter((item) => item.type === "expense")) {
    const key = `${tx.accountId}|${tx.amount}|${normalizePattern(tx.description)}`;
    if (!normalizePattern(tx.description) || seen.has(tx.id)) continue;
    const twin = recent.find((item) => item.id !== tx.id && item.type === "expense" && item.accountId === tx.accountId && item.amount === tx.amount && normalizePattern(item.description) === normalizePattern(tx.description) && Math.abs(daysBetween(item.date, tx.date)) <= 2);
    if (!twin) continue;
    seen.add(tx.id);
    seen.add(twin.id);
    push(recs, {
      agent: "Аномалии",
      fingerprint: `dup:${Math.min(tx.id, twin.id)}:${Math.max(tx.id, twin.id)}`,
      severity: "info",
      title: `Похоже на повтор: ${tx.description || "операция"}`,
      body: `Две операции по ${fmt(tx.amount)} (${tx.date} и ${twin.date}). Если это двойное списание — удалите лишнюю. Если нет, ничего делать не нужно.`,
      actionType: null,
    });
  }

  const uncategorized = snap.transactions.filter((tx) => !tx.categoryId && tx.type !== "transfer" && tx.date >= addDays(today, -60));
  const assignments = [];
  for (const tx of uncategorized) {
    const suggestion = suggestCategory(tx.description, snap);
    if (suggestion) assignments.push({ transactionId: tx.id, categoryId: suggestion.categoryId, description: tx.description, amount: tx.amount });
  }
  if (uncategorized.length) {
    const title = uncategorized.length % 10 === 1 && uncategorized.length % 100 !== 11
      ? `${uncategorized.length} операция без категории`
      : uncategorized.length % 10 >= 2 && uncategorized.length % 10 <= 4 && (uncategorized.length % 100 < 12 || uncategorized.length % 100 > 14)
        ? `${uncategorized.length} операции без категории`
        : `${uncategorized.length} операций без категории`;
    push(recs, {
      agent: "Категории",
      fingerprint: "categories:missing",
      severity: "info",
      title,
      body: assignments.length
        ? `Можно разложить ${assignments.length} по знакомым названиям: ${assignments.slice(0, 4).map((item) => item.description || "без описания").join(", ")}. Остальные лучше разметить вручную — от этого зависит честность бюджета.`
        : "Без категорий бюджет и подход считаются вслепую. Разметьте хотя бы крупные траты.",
      actionType: assignments.length ? "apply_categories" : null,
      actionPayload: assignments.length ? { assignments } : null,
    });
  }

  const repeated = findRepeatedManual(snap, today);
  for (const item of repeated.slice(0, 2)) {
    push(recs, {
      agent: "Категории",
      fingerprint: `recurring-suggest:${item.key}`,
      severity: "info",
      title: `«${item.name}» похоже на регулярный платёж`,
      body: `Сумма около ${fmt(item.amount)} встречалась ${item.count} мес. Если завести повтор, прогноз увидит дату, а не размажет платёж по дням.`,
      actionType: null,
    });
  }

  recs.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return { metrics, recommendations: recs.slice(0, 14) };
}

function findRepeatedManual(snap, today) {
  const buckets = new Map();
  for (const tx of snap.transactions) {
    if (tx.type !== "expense" || tx.source === "recurring" || tx.amount < 1500) continue;
    if (tx.date < addDays(today, -120)) continue;
    const key = normalizePattern(tx.description);
    if (key.length < 4) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tx);
  }
  const out = [];
  for (const [key, list] of buckets) {
    const months = new Set(list.map((tx) => tx.date.slice(0, 7)));
    if (months.size < 2 || list.length < 2) continue;
    const amount = sum(list, (tx) => tx.amount) / list.length;
    const drift = list.some((tx) => Math.abs(tx.amount - amount) / amount > 0.15);
    if (drift) continue;
    out.push({ key, name: list[0].description, amount: money(amount), count: months.size });
  }
  return out;
}

export function runAgents({ persist = true } = {}) {
  const snap = snapshot();
  const result = analyze(snap);
  let stored = [];
  if (persist) {
    stored = syncRecommendations(result.recommendations);
    markAgentRun();
  }
  return { ...result, stored, lastRun: lastAgentRun() };
}

export function briefingPayload(result) {
  const m = result.metrics;
  return {
    today: m.today,
    currency: m.currency,
    health: m.health,
    liquid: m.liquid,
    safeToSpend: m.safe,
    dailyAllowance: m.daily,
    daysUntilPayday: m.daysUntilPayday,
    nextPayday: m.nextPayday,
    obligations: m.obligations.map((item) => ({ name: item.name, amount: item.amount, date: item.date })),
    paycheck: m.paycheck,
    month: {
      income: m.current.income,
      expense: m.current.expense,
      needs: m.current.needs,
      wants: m.current.wants,
      savings: m.current.savings,
      savingsRate: m.current.savingsRate,
      wantsRate: m.current.wantsRate,
    },
    strategy: {
      name: result.strategyName,
      needsPct: result.needsPct,
      wantsPct: result.wantsPct,
      savingsPct: result.savingsPct,
    },
    topCategories: m.current.categories
      .filter((item) => item.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 6)
      .map((item) => ({ name: item.name, spent: item.spent, budget: item.budget })),
    forecastLow: m.forecast.min,
    variableDaily: m.forecast.variableDaily,
    findings: result.recommendations.map((item) => ({ agent: item.agent, severity: item.severity, title: item.title, body: item.body })),
  };
}

export { monthSlice, rub };
