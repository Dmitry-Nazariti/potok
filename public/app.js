const state = {
  view: "overview",
  meta: null,
  bundle: null,
  overview: null,
  transactions: [],
  month: "",
  q: "",
  type: "",
  accountId: "",
  modal: null,
  pending: null,
  importPreview: null,
  ai: null,
  busy: false,
};

const NAV = [
  ["overview", "Обзор"],
  ["transactions", "Операции"],
  ["salary", "Зарплата"],
  ["budgets", "Бюджеты"],
  ["goals", "Цели"],
  ["agents", "Агенты"],
  ["import", "Импорт"],
  ["settings", "Настройки"],
];

const CREW = [
  ["Касса", "Считает, сколько можно потратить до зарплаты, и вычитает платежи, которые спишутся раньше выплаты."],
  ["Бюджет", "Сравнивает факт с лимитом и с темпом месяца. Не предлагает просто поднять потолок."],
  ["Подход", "Проверяет, совпадают ли нужды, желания и накопления с рамкой, которую вы выбрали."],
  ["Прогноз", "Смотрит на 60 дней: повторы по своим датам, обычные траты — по вашему темпу."],
  ["Аномалии", "Замечает нетипичные для вас чеки и возможные двойные списания."],
  ["Категории", "Предлагает категории по вашим прошлым пометкам и словам в назначении."],
];

const ACTION_LABEL = {
  create_rule: "Закрепить правило",
  set_strategy: "Применить подход",
  set_buffer: "Поставить буфер",
  apply_categories: "Разложить",
  adjust_budget: "Обновить лимит",
};

const $ = (html) => html;
const app = document.querySelector("#app");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function color(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#8a8678";
}
function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function pretty(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(parseISO(iso));
}
function prettyShort(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseISO(iso)).replace(/\.$/, "");
}
function accountTypeLabel(type) {
  return {
    checking: "Дебетовая карта",
    cash: "Наличные",
    savings: "Накопительный счёт",
    credit: "Кредитная карта",
    investment: "Инвестиции",
  }[type] || type;
}
function monthTitle(key) {
  if (!key) return "";
  const text = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(parseISO(`${key}-01`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function shiftMonth(key, delta) {
  const date = parseISO(`${key}-01`);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function fmt(value, currency = state.overview?.currency || state.bundle?.strategy?.currency || "RUB") {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
  }).format(n);
}
function toast(message, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind === "bad" ? "bad" : ""}`;
  el.textContent = message;
  document.querySelector("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}
function accounts() { return state.bundle?.accounts || []; }
function categories() { return state.bundle?.categories || []; }
function catName(id) { return categories().find((item) => item.id === Number(id))?.name || "—"; }
function accName(id) { return accounts().find((item) => item.id === Number(id))?.name || "—"; }
function options(list, value, labeler, placeholder) {
  const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
  return head + list.map((item) => `<option value="${item.id}" ${String(item.id) === String(value) ? "selected" : ""}>${esc(labeler(item))}</option>`).join("");
}

function shell(content) {
  return `
    <div class="layout">
      <aside>
        <div class="brand"><strong><i></i>Поток</strong><span>личный финансовый поток</span></div>
        <nav>
          ${NAV.map(([id, label]) => `<button type="button" data-act="nav" data-view="${id}" class="${state.view === id ? "active" : ""}">${label}</button>`).join("")}
        </nav>
        <div class="aside-foot">База лежит на этом компьютере. Модель ничего не видит, пока вы сами не нажмёте «Спросить модель».</div>
      </aside>
      <main>${content}</main>
    </div>
    ${state.modal ? modal() : ""}
  `;
}

function render() {
  if (!state.meta) {
    app.innerHTML = `<div class="onboard"><p class="kicker">Поток</p><h1>Открываю учёт…</h1></div>`;
    return;
  }
  if (state.meta.empty || state.view === "onboard") {
    app.innerHTML = onboard();
    return;
  }
  const views = { overview, transactions, salary, budgets, goals, agents, import: importView, settings };
  app.innerHTML = shell((views[state.view] || overview)());
}

function onboard() {
  return `
    <div class="onboard">
      <p class="kicker">Поток</p>
      <h1>Учёт, из которого видно, что менять</h1>
      <p class="sub">Зарплата, обязательные платежи, дневной лимит и агенты, которые говорят конкретно: где утечка и что сделать до следующей выплаты. Это не банк и не инвестсовет.</p>
      <div class="onboard-grid">
        <button type="button" class="card choice" data-act="demo">
          <strong>Посмотреть на примере</strong>
          <span class="sub">Три месяца вымышленной жизни: зарплата, аренда раньше выплаты, кафе, которое растёт, и подушка. Потом можно всё стереть.</span>
        </button>
        <form class="card" data-form="empty">
          <strong>Свой учёт</strong>
          <div class="form-grid" style="margin-top:12px">
            <label>Счёт<input name="accountName" value="Основная карта" required></label>
            <label>Сейчас на счёте<input name="balance" type="number" step="0.01" value="0"></label>
            <label>Зарплата в месяц<input name="salary" type="number" step="1" placeholder="необязательно"></label>
            <label>День выплаты<input name="payday" type="number" min="1" max="28" placeholder="10"></label>
            <label class="wide">Подход
              <select name="strategyId">
                ${(state.meta.presets || []).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="actions"><button class="btn" type="submit">Начать</button></div>
        </form>
      </div>
    </div>`;
}

function overview() {
  const data = state.overview;
  if (!data) return `<p>Считаю…</p>`;
  const selected = data.selected || data.current;
  const accountsList = data.accounts || [];
  const totalBalance = accountsList.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
  const typeOrder = ["checking", "credit", "savings", "cash", "investment"];
  const sortedAccounts = [...accountsList].sort((a, b) => {
    const ai = typeOrder.indexOf(a.type);
    const bi = typeOrder.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.id - b.id;
  });
  return `
    <div class="top">
      <div>
        <p class="kicker">${pretty(data.today)}</p>
        <h1>Обзор</h1>
      </div>
      <div class="ring-wrap">
        <div>
          <div class="kicker">Индекс потока</div>
          <strong>${healthWord(data.health)}</strong>
        </div>
        <div class="ring" style="--p:${data.health}"><strong>${data.health}</strong></div>
      </div>
    </div>
    <div class="grid-2">
      <section class="hero">
        <div class="kicker">Баланс</div>
        <div class="hero-num ${totalBalance < 0 ? "bad" : "good"}">${fmt(totalBalance)}</div>
        <p class="sub">${heroText(data)}</p>
        <div class="accounts" style="margin-top:16px;flex-direction:column;align-items:stretch;gap:8px">
          ${sortedAccounts.map((item) => `
            <div class="line" style="padding:6px 0;border-bottom:1px solid var(--line)">
              <span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color(item.color)};margin-right:8px"></i>${esc(item.name)} · <span class="note">${esc(accountTypeLabel(item.type))}</span></span>
              <b class="amt">${fmt(item.balance)}</b>
            </div>`).join("") || `<p class="note">Счетов пока нет. Добавьте карту или наличные в настройках — позже сюда же смогут подтягиваться остатки из банка.</p>`}
        </div>
      </section>
      <section class="card">
        <div class="kicker">Расходы на месяц</div>
        <h2 style="margin:8px 0 12px">${fmt(selected.expense || 0)}</h2>
        ${planRow("Нужды", selected.needs || 0, "var(--info)", selected.expense || 1)}
        ${planRow("Желания", selected.wants || 0, "var(--accent)", selected.expense || 1)}
        ${planRow("В накопления", selected.savings || 0, "var(--olive)", selected.expense || 1)}
        <p class="note">${monthTitle(state.month)}${data.salary ? ` · до зарплаты свободно ${fmt(data.safe)}` : ""}</p>
        <button type="button" class="btn" data-act="open-salary" style="margin-top:12px">Зарплата пришла</button>
      </section>
    </div>
    <div class="grid-4">
      ${stat("Доходы", selected.income, "pos")}
      ${stat("Расходы", selected.expense, "neg")}
      ${stat("В накопления", selected.savings)}
      ${stat("Норма", `${selected.savingsRate}%`, selected.savingsRate >= (data.strategy?.savingsPct || 0) ? "pos" : "")}
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="section-head"><h2>60 дней вперёд</h2><span class="note">переменные ${fmt(data.forecast.variableDaily)} / день</span></div>
        ${chart(data.forecast.points)}
        <p class="note">Нижняя точка: ${fmt(data.forecast.min.balance)} · ${pretty(data.forecast.min.date)}</p>
      </section>
      <section class="card">
        <div class="section-head"><h2>Ближайшее</h2></div>
        <div class="upcoming">
          ${(data.upcoming || []).map((item) => `<div><span>${pretty(item.date)} · ${esc(item.name)}${item.overdue ? " · просрочено" : ""}</span><b class="amt ${item.type === "income" ? "in" : "out"}">${item.type === "income" ? "+" : "−"}${fmt(item.amount)}</b></div>`).join("") || `<p class="note">Повторов пока нет.</p>`}
        </div>
      </section>
    </div>
    <section class="section">
      <div class="section-head">
        <h2>${monthTitle(state.month)}</h2>
        <div class="row">
          <button type="button" class="btn-ghost" data-act="month" data-delta="-1">←</button>
          <button type="button" class="btn-ghost" data-act="month" data-delta="1">→</button>
        </div>
      </div>
      ${allocation(selected, data.strategy)}
      <div class="bars" style="margin-top:16px">
        ${selected.categories.filter((item) => item.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 6).map(bar).join("") || `<p class="note">В этом месяце расходов нет.</p>`}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Что менять</h2><button type="button" class="btn-ghost" data-act="nav" data-view="agents">Все агенты</button></div>
      <div class="recs">${(data.recommendations || []).slice(0, 3).map(recCard).join("") || `<div class="card empty">Пока тихо. Добавьте операции — агенты заговорят по фактам.</div>`}</div>
    </section>`;
}

function healthWord(n) {
  if (n >= 80) return "Ровно";
  if (n >= 60) return "Есть напряжение";
  return "Нужно внимание";
}
function heroText(data) {
  if (!data.salary) return "Остатки по счетам. День и сумма зарплаты помогут считать свободные деньги до выплаты. Позже сюда же можно будет подтянуть данные из банка.";
  if (data.paydayOverdue) return `Выплата с ${prettyShort(data.salary.nextDate)} не отмечена. Пока она не внесена, эти деньги в план не входят.`;
  if (data.safe < 0) return `До ${prettyShort(data.nextPayday)} обязательные платежи ${fmt(data.obligationTotal)} больше свободных денег. Крупные желания лучше не начинать.`;
  const days = data.daysUntilPayday ?? data.safeDays;
  return `Свободно до зарплаты: ${fmt(data.safe)} · около ${fmt(data.daily)} в день · ${days} дн. до ${prettyShort(data.nextPayday)}.`;
}
function planRow(label, amount, paint, maxHint) {
  const max = Math.max(Math.abs(maxHint ?? state.overview?.paycheck?.income ?? 1), 1);
  const width = Math.max(0, Math.min(100, (Math.abs(amount) / max) * 100));
  return `<div class="split"><span>${label}</span><div class="mini"><span style="width:${width}%;background:${paint}"></span></div><b class="amt">${fmt(amount)}</b></div>`;
}
function stat(label, value, kind) {
  const text = typeof value === "number" ? fmt(value) : value;
  return `<div class="stat"><span class="note">${label}</span><b class="${kind || ""}">${text}</b></div>`;
}
function allocation(selected, strategy) {
  if (!strategy) return "";
  const rows = [
    ["Нужды", selected.needsRate, strategy.needsPct, "var(--info)"],
    ["Желания", selected.wantsRate, strategy.wantsPct, "var(--accent)"],
    ["Накопления", selected.savingsRate, strategy.savingsPct, "var(--olive)"],
  ];
  return rows.map(([label, fact, target, paint]) => `
    <div class="split"><span>${label}</span><div class="mini"><span style="width:${Math.min(100, fact)}%;background:${paint}"></span></div><span class="note">${fact}% · цель ${target}%</span></div>`).join("");
}
function bar(item) {
  const cap = item.budget || item.spent || 1;
  const width = Math.max(4, Math.min(100, (item.spent / cap) * 100));
  const over = item.budget != null && item.spent > item.budget;
  return `<div class="bar-row"><span>${esc(item.name)}</span><div class="track"><span style="width:${width}%;background:${over ? "var(--clay)" : color(item.color)}"></span></div><b class="amt">${fmt(item.spent)}${item.budget != null ? ` / ${fmt(item.budget)}` : ""}</b></div>`;
}
function chart(points) {
  if (!points?.length) return "";
  const w = 640;
  const h = 180;
  const pad = 12;
  const values = points.map((item) => item.balance);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const x = (i) => pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const line = points.map((item, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(item.balance).toFixed(1)}`).join(" ");
  const zero = y(0);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Прогноз остатка">
    <line x1="${pad}" x2="${w - pad}" y1="${zero}" y2="${zero}" stroke="rgba(232,241,250,.18)" />
    <path d="${line} L${x(points.length - 1).toFixed(1)},${zero} L${x(0)},${zero} Z" fill="rgba(77,163,255,.15)" />
    <path d="${line}" fill="none" stroke="#4da3ff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}
function recCard(item) {
  const action = ACTION_LABEL[item.actionType];
  return `<article class="rec ${esc(item.severity)}">
    <header><em>${esc(item.agent)}${item.source === "model" ? " · модель" : ""}</em></header>
    <strong>${esc(item.title)}</strong>
    <p>${esc(item.body)}</p>
    <div class="row">
      ${action ? `<button type="button" class="btn" data-act="accept" data-id="${item.id}">${action}</button>` : ""}
      <button type="button" class="btn-ghost" data-act="dismiss" data-id="${item.id}">Скрыть</button>
    </div>
  </article>`;
}

function transactions() {
  return `
    <div class="top"><div><p class="kicker">Журнал</p><h1>Операции</h1></div>
      <div class="row">
        <button type="button" class="btn" data-act="open-tx" data-type="expense">Расход</button>
        <button type="button" class="btn-ghost" data-act="open-tx" data-type="income">Доход</button>
        <button type="button" class="btn-ghost" data-act="open-transfer">Перевод</button>
      </div>
    </div>
    <div class="filters">
      <input id="q" placeholder="Поиск" value="${esc(state.q)}">
      <select id="type">${options([{ id: "", name: "Все типы" }, { id: "expense", name: "Расходы" }, { id: "income", name: "Доходы" }, { id: "transfer", name: "Переводы" }], state.type, (item) => item.name)}</select>
      <select id="accountId">${options(accounts(), state.accountId, (item) => item.name, "Все счета")}</select>
      <input id="month" type="month" value="${esc(state.month)}">
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Дата</th><th>Описание</th><th>Категория</th><th>Счёт</th><th class="num">Сумма</th></tr></thead>
        <tbody>
          ${state.transactions.map((tx) => `<tr class="clickable" data-act="edit-tx" data-id="${tx.id}">
            <td>${pretty(tx.date)}</td>
            <td>${esc(tx.description || "Без описания")}</td>
            <td>${esc(tx.type === "transfer" ? "Перевод" : catName(tx.categoryId))}</td>
            <td>${esc(accName(tx.accountId))}</td>
            <td class="num ${tx.type === "income" ? "ok-text" : tx.type === "expense" ? "danger-text" : ""}">${tx.type === "income" ? "+" : tx.type === "expense" ? "−" : ""}${fmt(tx.amount)}</td>
          </tr>`).join("") || `<tr><td colspan="5" class="empty">Операций нет. Добавьте первую или импортируйте выписку.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function salary() {
  const data = state.overview;
  const recurring = state.bundle?.recurring || [];
  return `
    <div class="top"><div><p class="kicker">Выплаты и повторы</p><h1>Зарплата</h1></div>
      <div class="row">
        <button type="button" class="btn" data-act="open-salary">Зарплата пришла</button>
        <button type="button" class="btn-ghost" data-act="open-recurring">Новый повтор</button>
      </div>
    </div>
    <div class="grid-2">
      <section class="hero">
        <div class="kicker">${data?.salary ? `Следующая ${pretty(data.salary.nextDate)}` : "График не задан"}</div>
        <div class="hero-num">${data?.salary ? fmt(data.salary.amount) : "—"}</div>
        <p class="sub">${data?.paydayOverdue ? "Дата прошла, поступление не отмечено." : data?.paydayToday ? "Сегодня день выплаты. Отметьте, когда деньги будут на счёте." : "Отмечать стоит факт, а не ожидание. Прогноз сам подставит будущие даты."}</p>
      </section>
      <section class="card">
        <h2>Куда уйдёт выплата</h2>
        <div class="line"><span>Обязательные до следующей</span><b>${fmt(data?.paycheck.bills || 0)}</b></div>
        <div class="line"><span>Норма накоплений</span><b>${fmt(data?.paycheck.savings || 0)}</b></div>
        <div class="line"><span>Останется на жизнь</span><b class="${(data?.paycheck.left || 0) < 0 ? "danger-text" : "ok-text"}">${fmt(data?.paycheck.left || 0)}</b></div>
        <p class="note">Подписки сейчас ${fmt(data?.subscriptionMonthly || 0)} в месяц.</p>
      </section>
    </div>
    <section class="section">
      <h2>Повторы</h2>
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr><th>Название</th><th>Тип</th><th>Следующая</th><th class="num">Сумма</th><th></th></tr></thead>
          <tbody>
            ${recurring.map((item) => `<tr>
              <td>${esc(item.name)}${item.active ? "" : " · пауза"}</td>
              <td>${esc(kindLabel(item.kind))}</td>
              <td>${pretty(item.nextDate)}</td>
              <td class="num">${fmt(item.amount)}</td>
              <td class="num"><button type="button" class="btn-ghost" data-act="post-recurring" data-id="${item.id}">Провести</button> <button type="button" class="btn-ghost" data-act="edit-recurring" data-id="${item.id}">Править</button></td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty">Повторов нет.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`;
}
function kindLabel(kind) {
  return { salary: "Зарплата", bill: "Платёж", subscription: "Подписка", savings: "Накопления", other: "Другое" }[kind] || kind;
}

function budgets() {
  const selected = state.overview?.selected || state.overview?.current;
  const groups = ["needs", "wants", "savings"];
  const labels = state.meta.groups || {};
  return `
    <div class="top"><div><p class="kicker">${monthTitle(state.month)}</p><h1>Бюджеты</h1></div>
      <button type="button" class="btn-ghost" data-act="open-category">Категория</button>
    </div>
    <p class="sub">Лимит — это обещание себе, не прогноз. Пустое поле значит «без лимита». Агент не предлагает его поднять, когда вы уже вышли за него.</p>
    ${groups.map((group) => {
      const items = categories().filter((item) => item.kind === "expense" && item.group === group);
      if (!items.length) return "";
      return `<section class="section"><h2>${esc(labels[group] || group)}</h2><div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Категория</th><th class="num">Факт</th><th class="num">Лимит</th><th>Темп</th></tr></thead>
        <tbody>${items.map((item) => {
          const fact = selected?.categories?.find((row) => row.id === item.id);
          return `<tr>
            <td>${esc(item.name)}</td>
            <td class="num">${fmt(fact?.spent || 0)}</td>
            <td class="num"><input data-field="budget" data-id="${item.id}" type="number" min="0" step="100" value="${item.monthlyBudget ?? ""}" style="width:120px"></td>
            <td>${fact?.budget != null ? (fact.spent > fact.budget ? "лимит превышен" : `ещё ${fmt(fact.remaining)}`) : "без лимита"}</td>
          </tr>`;
        }).join("")}</tbody></table></div></section>`;
    }).join("")}`;
}

function goals() {
  const goals = state.bundle?.goals || [];
  return `
    <div class="top"><div><p class="kicker">Запас</p><h1>Цели</h1></div><button type="button" class="btn" data-act="open-goal">Новая цель</button></div>
    <div class="grid-3">
      ${goals.map((goal) => {
        const pct = Math.min(100, Math.round((goal.savedAmount / goal.targetAmount) * 100));
        return `<article class="goal">
          <div class="kicker">${goal.status === "done" ? "Закрыта" : `приоритет ${goal.priority}`}</div>
          <h2>${esc(goal.name)}</h2>
          <b>${fmt(goal.savedAmount)}</b> <span class="note">из ${fmt(goal.targetAmount)}</span>
          <div class="progress track"><span style="width:${pct}%;background:var(--brass)"></span></div>
          <p class="note">${goal.deadline ? `срок ${pretty(goal.deadline)}` : "без срока"} · ${esc(goal.notes || "")}</p>
          <div class="row"><button type="button" class="btn" data-act="open-contribute" data-id="${goal.id}">Отложить</button></div>
        </article>`;
      }).join("") || `<div class="card empty">Целей нет. Подушка на 3 месяца обязательных расходов — нормальный первый ориентир.</div>`}
    </div>`;
}

function agents() {
  const recs = state.overview?.recommendations || [];
  return `
    <div class="top"><div><p class="kicker">Расчёт, не лозунги</p><h1>Агенты</h1></div>
      <div class="row">
        <button type="button" class="btn" data-act="run-agents">Пересчитать</button>
        <button type="button" class="btn-ghost" data-act="narrate" ${state.overview?.ai?.configured ? "" : "disabled"} title="Нужен ключ в настройках">Спросить модель</button>
      </div>
    </div>
    <p class="sub">Шесть агентов считают локально. Модель, если подключена, только пересказывает уже посчитанное и не меняет цифры сама. Это не налоговая и не инвестиционная рекомендация.</p>
    <div class="grid-3" style="margin-top:16px">
      ${CREW.map(([name, text]) => `<article class="agent"><div class="kicker">${name}</div><p>${text}</p></article>`).join("")}
    </div>
    <section class="section"><h2>Открытые рекомендации</h2><div class="recs" style="margin-top:12px">${recs.map(recCard).join("") || `<div class="card empty">Открытых рекомендаций нет.</div>`}</div></section>`;
}

function importView() {
  const preview = state.importPreview;
  return `
    <div class="top"><div><p class="kicker">Выписка</p><h1>Импорт</h1></div></div>
    <p class="sub">CSV с колонками «дата», «сумма», «описание» или отдельно приход и расход. Разделитель запятая, точка с запятой или таб. Пример: samples/statement.csv</p>
    <div class="card">
      <div class="row">
        <input id="csv-file" type="file" accept=".csv,text/csv,text/plain">
        <label style="flex:1">Счёт для импорта<select id="import-account">${options(accounts(), accounts()[0]?.id, (item) => item.name)}</select></label>
      </div>
      <label style="margin-top:12px">Или вставьте текст<textarea id="csv-text" placeholder="Дата;Сумма;Описание"></textarea></label>
      <div class="row" style="margin-top:12px"><button type="button" class="btn" data-act="preview-csv">Разобрать</button></div>
    </div>
    ${preview ? `<section class="section"><div class="section-head"><h2>${preview.rows.length} строк</h2><button type="button" class="btn" data-act="commit-csv">Импортировать</button></div>
      <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Описание</th><th>Категория</th><th class="num">Сумма</th></tr></thead>
      <tbody>${preview.rows.slice(0, 40).map((row) => `<tr><td>${pretty(row.date)}</td><td>${esc(row.description)}</td><td>${esc(row.categoryName || "—")}</td><td class="num">${row.type === "income" ? "+" : "−"}${fmt(row.amount)}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">${(preview.warnings || []).join(" · ")}</p></section>` : ""}`;
}

function settings() {
  const strategy = state.bundle?.strategy;
  const ai = state.ai || {};
  return `
    <div class="top"><div><p class="kicker">Рамка</p><h1>Настройки</h1></div></div>
    <div class="grid-2">
      <form class="card" data-form="strategy">
        <h2>Подход к тратам</h2>
        <p class="note">Доли нужд, желаний и накоплений. Сумма должна быть 100.</p>
        <div class="row" style="margin:12px 0">
          ${(state.meta.presets || []).map((item) => `<button type="button" class="btn-ghost" data-act="preset" data-id="${item.id}">${esc(item.name)}</button>`).join("")}
        </div>
        <div class="form-grid">
          <label class="wide">Название<input name="name" value="${esc(strategy?.name || "")}"></label>
          <label>Нужды, %<input name="needsPct" type="number" value="${strategy?.needsPct ?? 50}"></label>
          <label>Желания, %<input name="wantsPct" type="number" value="${strategy?.wantsPct ?? 30}"></label>
          <label>Накопления, %<input name="savingsPct" type="number" value="${strategy?.savingsPct ?? 20}"></label>
          <label>Буфер, не трогать<input name="safetyBuffer" type="number" value="${strategy?.safetyBuffer ?? 0}"></label>
        </div>
        <div class="actions"><button class="btn" type="submit">Сохранить подход</button></div>
      </form>
      <form class="card" data-form="ai">
        <h2>Модель</h2>
        <p class="note">Необязательно. Ключ остаётся в локальной базе. Сейчас: ${ai.configured ? esc(ai.keyHint || "задан") : "не подключена"}.</p>
        <div class="form-grid" style="margin-top:12px">
          <label class="wide">Адрес API<input name="baseUrl" value="${esc(ai.baseUrl || "https://api.openai.com/v1")}"></label>
          <label class="wide">Модель<input name="model" value="${esc(ai.model || "gpt-4o-mini")}"></label>
          <label class="wide">Ключ<input name="apiKey" type="password" placeholder="${ai.configured ? "не менять" : "sk-..."}" autocomplete="off"></label>
        </div>
        <div class="actions">
          <button class="btn" type="submit">Сохранить</button>
          <button type="button" class="btn-ghost" data-act="test-ai">Проверить</button>
          <button type="button" class="btn-ghost" data-act="clear-key">Удалить ключ</button>
        </div>
      </form>
    </div>
    <section class="section">
      <div class="section-head"><h2>Счета</h2><button type="button" class="btn-ghost" data-act="open-account">Добавить</button></div>
      <div class="accounts">${(state.overview?.accounts || accounts()).map((item) => `<button type="button" class="chip" data-act="edit-account" data-id="${item.id}"><i style="background:${color(item.color)}"></i>${esc(item.name)} · ${fmt(item.balance ?? item.openingBalance)}</button>`).join("")}</div>
    </section>
    <section class="section card">
      <h2>Данные</h2>
      <p class="note">Экспорт — это JSON на диске. Сброс удаляет операции безвозвратно. Демо заменяет текущий учёт примером.</p>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn-ghost" data-act="export">Экспорт JSON</button>
        <button type="button" class="btn-ghost" data-act="demo">Загрузить демо</button>
        <button type="button" class="btn-danger" data-act="reset">Стереть всё</button>
      </div>
    </section>`;
}

function modal() {
  const m = state.modal;
  return `<div class="modal-back"><div class="modal"><h2>${esc(m.title)}</h2>${m.body}</div></div>`;
}

function txForm(tx = {}, type = "expense") {
  const kind = tx.type || type;
  return `<form data-form="tx">
    <input type="hidden" name="id" value="${tx.id || ""}">
    <div class="form-grid">
      <label>Тип<select name="type">
        ${["expense", "income"].map((item) => `<option value="${item}" ${kind === item ? "selected" : ""}>${item === "expense" ? "Расход" : "Доход"}</option>`).join("")}
      </select></label>
      <label>Сумма<input name="amount" type="number" min="0.01" step="0.01" required value="${tx.amount || ""}"></label>
      <label>Дата<input name="date" type="date" required value="${tx.date || state.meta.today}"></label>
      <label>Счёт<select name="accountId" required>${options(accounts(), tx.accountId || accounts()[0]?.id, (item) => item.name)}</select></label>
      <label class="wide">Категория<select name="categoryId">${options(categories().filter((item) => item.kind === (kind === "income" ? "income" : "expense")), tx.categoryId, (item) => item.name, "Без категории")}</select></label>
      <label class="wide">Описание<input name="description" value="${esc(tx.description || "")}" placeholder="Пятёрочка, аренда, зарплата"></label>
      <label class="wide">Заметка<input name="notes" value="${esc(tx.notes || "")}"></label>
    </div>
    <div class="actions"><button class="btn" type="submit">Сохранить</button>${tx.id ? `<button type="button" class="btn-danger" data-act="delete-tx" data-id="${tx.id}">Удалить</button>` : ""}<button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div>
  </form>`;
}

function openModal(title, body) {
  state.modal = { title, body };
  render();
}

async function refresh() {
  const [bundle, overviewData] = await Promise.all([
    api("/api/bundle"),
    api(`/api/overview?month=${state.month}`),
  ]);
  state.bundle = bundle;
  state.overview = overviewData;
  state.meta.empty = false;
  if (state.view === "transactions") {
    const params = new URLSearchParams({ month: state.month });
    if (state.q) params.set("q", state.q);
    if (state.type) params.set("type", state.type);
    if (state.accountId) params.set("accountId", state.accountId);
    state.transactions = await api(`/api/transactions?${params}`);
  }
  if (state.view === "settings") state.ai = await api("/api/ai");
  render();
}

function clean(data) {
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (value === "") out[key] = null;
    else if (/Id$|amount|Balance|Budget|Pct|payday|salary|priority|dayOfMonth|safetyBuffer|targetAmount|savedAmount/.test(key) && value != null) out[key] = Number(value);
  }
  return out;
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const data = clean(Object.fromEntries(new FormData(form).entries()));
  try {
    if (form.dataset.form === "empty") {
      await api("/api/onboard", { method: "POST", body: { mode: "empty", ...data } });
      state.meta.empty = false;
      state.view = "overview";
      await refresh();
      toast("Учёт создан");
    } else if (form.dataset.form === "tx") {
      if (data.id) await api(`/api/transactions/${data.id}`, { method: "PATCH", body: data });
      else await api("/api/transactions", { method: "POST", body: data });
      state.modal = null;
      await refresh();
      toast("Операция сохранена");
    } else if (form.dataset.form === "transfer") {
      await api("/api/transfers", { method: "POST", body: data });
      state.modal = null;
      await refresh();
      toast("Перевод записан");
    } else if (form.dataset.form === "salary") {
      const result = await api("/api/salary/receive", { method: "POST", body: { ...data, ...state.pending } });
      if (result.needsConfirm) {
        state.pending = { ...data, confirm: true };
        toast(result.message, "bad");
        return;
      }
      state.pending = null;
      state.modal = null;
      await refresh();
      toast("Зарплата внесена");
    } else if (form.dataset.form === "recurring") {
      if (data.id) await api(`/api/recurring/${data.id}`, { method: "PATCH", body: data });
      else await api("/api/recurring", { method: "POST", body: data });
      state.modal = null;
      await refresh();
      toast("Повтор сохранён");
    } else if (form.dataset.form === "goal") {
      await api("/api/goals", { method: "POST", body: data });
      state.modal = null;
      await refresh();
    } else if (form.dataset.form === "contribute") {
      await api(`/api/goals/${data.id}/contribute`, { method: "POST", body: data });
      state.modal = null;
      await refresh();
      toast("Отложено");
    } else if (form.dataset.form === "account") {
      if (data.id) await api(`/api/accounts/${data.id}`, { method: "PATCH", body: data });
      else await api("/api/accounts", { method: "POST", body: data });
      state.modal = null;
      await refresh();
    } else if (form.dataset.form === "category") {
      await api("/api/categories", { method: "POST", body: data });
      state.modal = null;
      await refresh();
    } else if (form.dataset.form === "strategy") {
      await api("/api/strategy", { method: "PUT", body: data });
      await refresh();
      toast("Подход сохранён");
    } else if (form.dataset.form === "ai") {
      state.ai = await api("/api/ai", { method: "PUT", body: data });
      toast("Настройки модели сохранены");
      await refresh();
    }
  } catch (error) {
    toast(error.message, "bad");
  }
}

async function onClick(event) {
  if (event.target.classList?.contains("modal-back")) {
    state.modal = null;
    render();
    return;
  }
  const el = event.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  try {
    if (act === "nav") {
      state.view = el.dataset.view;
      state.modal = null;
      await refresh();
    } else if (act === "month") {
      state.month = shiftMonth(state.month, Number(el.dataset.delta));
      await refresh();
    } else if (act === "demo") {
      if (!state.meta.empty && !confirm("Демо заменит текущий учёт. Продолжить?")) return;
      await api("/api/demo", { method: "POST", body: {} });
      state.meta.empty = false;
      state.view = "overview";
      await refresh();
      toast("Демо загружено");
    } else if (act === "reset") {
      if (!confirm("Стереть все счета, операции и цели?")) return;
      await api("/api/reset", { method: "POST", body: {} });
      state.meta.empty = true;
      state.view = "onboard";
      render();
    } else if (act === "open-tx") {
      openModal(el.dataset.type === "income" ? "Доход" : "Расход", txForm({}, el.dataset.type));
    } else if (act === "edit-tx") {
      const tx = state.transactions.find((item) => item.id === Number(id));
      if (tx) openModal("Операция", txForm(tx));
    } else if (act === "delete-tx") {
      await api(`/api/transactions/${id}`, { method: "DELETE" });
      state.modal = null;
      await refresh();
    } else if (act === "open-transfer") {
      openModal("Перевод", `<form data-form="transfer"><div class="form-grid">
        <label>Сумма<input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label>Дата<input name="date" type="date" value="${state.meta.today}"></label>
        <label>Откуда<select name="accountId">${options(accounts(), accounts()[0]?.id, (item) => item.name)}</select></label>
        <label>Куда<select name="transferAccountId">${options(accounts(), accounts()[1]?.id || accounts()[0]?.id, (item) => item.name)}</select></label>
        <label class="wide">Описание<input name="description" value="Перевод"></label>
      </div><div class="actions"><button class="btn" type="submit">Перевести</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "open-salary") {
      const salary = state.overview?.salary;
      state.pending = null;
      openModal("Зарплата пришла", `<form data-form="salary"><div class="form-grid">
        <label>Что это<select name="payKind"><option value="salary">Основная зарплата</option><option value="advance">Аванс</option><option value="bonus">Премия</option></select></label>
        <label>Сумма<input name="amount" type="number" step="0.01" value="${salary?.amount || ""}" required></label>
        <label>Дата<input name="date" type="date" value="${state.meta.today}"></label>
        <label>Счёт<select name="accountId">${options(accounts(), salary?.accountId || accounts()[0]?.id, (item) => item.name)}</select></label>
      </div><p class="note">Основная зарплата сдвигает график. Аванс и премия график не трогают. Если выплата уже есть за последние 10 дней, придётся подтвердить ещё раз.</p>
      <div class="actions"><button class="btn" type="submit">Внести</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "open-recurring" || act === "edit-recurring") {
      const item = (state.bundle?.recurring || []).find((row) => row.id === Number(id)) || {};
      openModal(item.id ? "Повтор" : "Новый повтор", `<form data-form="recurring"><input type="hidden" name="id" value="${item.id || ""}"><div class="form-grid">
        <label class="wide">Название<input name="name" required value="${esc(item.name || "")}"></label>
        <label>Сумма<input name="amount" type="number" step="0.01" required value="${item.amount || ""}"></label>
        <label>Следующая дата<input name="nextDate" type="date" required value="${item.nextDate || state.meta.today}"></label>
        <label>Тип<select name="type">${["expense", "income", "transfer"].map((kind) => `<option value="${kind}" ${(item.type || "expense") === kind ? "selected" : ""}>${kind === "income" ? "Доход" : kind === "transfer" ? "Перевод" : "Расход"}</option>`).join("")}</select></label>
        <label>Роль<select name="kind">${["salary", "bill", "subscription", "savings", "other"].map((kind) => `<option value="${kind}" ${(item.kind || "bill") === kind ? "selected" : ""}>${kindLabel(kind)}</option>`).join("")}</select></label>
        <label>Счёт<select name="accountId">${options(accounts(), item.accountId || accounts()[0]?.id, (row) => row.name)}</select></label>
        <label>Категория<select name="categoryId">${options(categories(), item.categoryId, (row) => row.name, "Без категории")}</select></label>
        <label>Куда, если перевод<select name="transferAccountId">${options(accounts(), item.transferAccountId, (row) => row.name, "Не перевод")}</select></label>
        <label>День месяца<input name="dayOfMonth" type="number" min="1" max="28" value="${item.dayOfMonth || ""}"></label>
      </div><div class="actions"><button class="btn" type="submit">Сохранить</button>${item.id ? `<button type="button" class="btn-danger" data-act="delete-recurring" data-id="${item.id}">Удалить</button>` : ""}<button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "delete-recurring") {
      await api(`/api/recurring/${id}`, { method: "DELETE" });
      state.modal = null;
      await refresh();
    } else if (act === "post-recurring") {
      await api(`/api/recurring/${id}/post`, { method: "POST", body: {} });
      await refresh();
      toast("Проведено");
    } else if (act === "open-goal") {
      openModal("Цель", `<form data-form="goal"><div class="form-grid">
        <label class="wide">Название<input name="name" required placeholder="Подушка"></label>
        <label>Сумма<input name="targetAmount" type="number" min="1" required></label>
        <label>Уже есть<input name="savedAmount" type="number" value="0"></label>
        <label>Срок<input name="deadline" type="date"></label>
        <label>Приоритет<input name="priority" type="number" value="1"></label>
      </div><div class="actions"><button class="btn" type="submit">Создать</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "open-contribute") {
      const savings = accounts().find((item) => item.type === "savings");
      openModal("Отложить на цель", `<form data-form="contribute"><input type="hidden" name="id" value="${id}"><div class="form-grid">
        <label>Сумма<input name="amount" type="number" min="1" required></label>
        <label>Дата<input name="date" type="date" value="${state.meta.today}"></label>
        <label>Со счёта<select name="fromAccountId">${options(accounts(), accounts()[0]?.id, (item) => item.name, "Только отметить")}</select></label>
        <label>На счёт<select name="toAccountId">${options(accounts(), savings?.id, (item) => item.name, "Не переводить")}</select></label>
      </div><div class="actions"><button class="btn" type="submit">Отложить</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "open-account" || act === "edit-account") {
      const item = accounts().find((row) => row.id === Number(id)) || {};
      openModal(item.id ? "Счёт" : "Новый счёт", `<form data-form="account"><input type="hidden" name="id" value="${item.id || ""}"><div class="form-grid">
        <label class="wide">Название<input name="name" required value="${esc(item.name || "")}"></label>
        <label>Тип<select name="type">${(state.meta.accountTypes || []).map((row) => `<option value="${row.id}" ${(item.type || "checking") === row.id ? "selected" : ""}>${esc(row.label)}</option>`).join("")}</select></label>
        <label>Начальный остаток<input name="openingBalance" type="number" step="0.01" value="${item.openingBalance ?? 0}"></label>
      </div><p class="note">Для кредита укажите долг отрицательным числом. Накопления не входят в «можно потратить».</p>
      <div class="actions"><button class="btn" type="submit">Сохранить</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "open-category") {
      openModal("Категория", `<form data-form="category"><div class="form-grid">
        <label class="wide">Название<input name="name" required></label>
        <label>Тип<select name="kind"><option value="expense">Расход</option><option value="income">Доход</option></select></label>
        <label>Группа<select name="group"><option value="needs">Нужды</option><option value="wants">Желания</option><option value="savings">Накопления</option></select></label>
        <label>Лимит<input name="monthlyBudget" type="number" step="100"></label>
        <label>Слова через запятую<input name="keywords" placeholder="кофе, додо"></label>
      </div><div class="actions"><button class="btn" type="submit">Создать</button><button type="button" class="btn-ghost" data-act="close-modal">Отмена</button></div></form>`);
    } else if (act === "accept") {
      await api(`/api/recommendations/${id}/accept`, { method: "POST", body: {} });
      await refresh();
      toast("Принято");
    } else if (act === "dismiss") {
      await api(`/api/recommendations/${id}/dismiss`, { method: "POST", body: {} });
      await refresh();
    } else if (act === "run-agents") {
      await api("/api/agents/run", { method: "POST", body: {} });
      await refresh();
      toast("Агенты пересчитали");
    } else if (act === "narrate") {
      el.disabled = true;
      const result = await api("/api/agents/run", { method: "POST", body: { narrate: true } });
      if (!result.narration?.ok) throw new Error(result.narration?.error || "Модель не ответила");
      await refresh();
      toast("Сводка модели готова");
    } else if (act === "preview-csv") {
      const text = document.querySelector("#csv-text").value;
      state.importPreview = await api("/api/import/preview", { method: "POST", body: { text } });
      render();
    } else if (act === "commit-csv") {
      const accountId = document.querySelector("#import-account").value;
      const result = await api("/api/import/commit", { method: "POST", body: { accountId, rows: state.importPreview.rows } });
      state.importPreview = null;
      state.view = "transactions";
      await refresh();
      toast(`Импортировано: ${result.created}`);
    } else if (act === "preset") {
      const preset = state.meta.presets.find((item) => item.id === el.dataset.id);
      if (!preset) return;
      await api("/api/strategy", { method: "PUT", body: preset });
      await refresh();
      toast(preset.name);
    } else if (act === "test-ai") {
      const result = await api("/api/ai/test", { method: "POST", body: {} });
      toast(result.briefing || "Связь есть");
    } else if (act === "clear-key") {
      state.ai = await api("/api/ai", { method: "PUT", body: { clearKey: true } });
      await refresh();
      toast("Ключ удалён");
    } else if (act === "export") {
      const data = await api("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "potok-export.json";
      link.click();
    } else if (act === "close-modal") {
      state.modal = null;
      render();
    }
  } catch (error) {
    toast(error.message, "bad");
  }
}

function onChange(event) {
  const target = event.target;
  if (target.name === "type" && target.form?.dataset.form === "tx") {
    const kind = target.value === "income" ? "income" : "expense";
    const select = target.form.querySelector("[name=categoryId]");
    select.innerHTML = options(categories().filter((item) => item.kind === kind), "", (item) => item.name, "Без категории");
  } else if (target.id === "type" || target.id === "accountId" || target.id === "month") {
    state[target.id === "month" ? "month" : target.id] = target.value;
    refresh().catch((error) => toast(error.message, "bad"));
  } else if (target.id === "csv-file" && target.files?.[0]) {
    target.files[0].text().then((text) => {
      document.querySelector("#csv-text").value = text;
    });
  } else if (target.dataset.field === "budget") {
    const value = target.value === "" ? null : Number(target.value);
    api(`/api/categories/${target.dataset.id}`, { method: "PATCH", body: { monthlyBudget: value } })
      .then(() => refresh())
      .then(() => toast("Лимит обновлён"))
      .catch((error) => toast(error.message, "bad"));
  }
}

document.addEventListener("submit", onSubmit);
document.addEventListener("click", onClick);
document.addEventListener("change", onChange);
document.addEventListener("input", (event) => {
  if (event.target.id !== "q") return;
  state.q = event.target.value;
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => refresh().catch((error) => toast(error.message, "bad")), 280);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) {
    state.modal = null;
    render();
  }
});

api("/api/meta").then((meta) => {
  state.meta = meta;
  state.month = meta.today.slice(0, 7);
  if (meta.empty) render();
  else return refresh();
}).catch((error) => {
  app.innerHTML = `<div class="onboard"><h1>Не удалось открыть Поток</h1><p>${esc(error.message)}</p></div>`;
});
