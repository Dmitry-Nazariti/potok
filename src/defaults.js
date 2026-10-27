export const VERSION = "1.0.0";

export const STRATEGY_PRESETS = [
  { id: "balance", name: "Баланс 50/30/20", needsPct: 50, wantsPct: 30, savingsPct: 20 },
  { id: "buffer", name: "Сначала подушка", needsPct: 50, wantsPct: 20, savingsPct: 30 },
  { id: "strict", name: "Жёсткая экономия", needsPct: 55, wantsPct: 15, savingsPct: 30 },
  { id: "comfort", name: "Комфорт", needsPct: 45, wantsPct: 40, savingsPct: 15 },
];

export const GROUP_LABELS = {
  income: "Доходы",
  needs: "Нужды",
  wants: "Желания",
  savings: "Накопления",
};

export const ACCOUNT_TYPES = [
  { id: "checking", label: "Дебетовая карта" },
  { id: "cash", label: "Наличные" },
  { id: "savings", label: "Накопительный счёт" },
  { id: "credit", label: "Кредитная карта" },
  { id: "investment", label: "Инвестиции" },
];

export const DEFAULT_CATEGORIES = [
  ["Зарплата", "income", "income", "◆", "#4da3ff", null, "зарплата,оклад,salary"],
  ["Аванс", "income", "income", "◇", "#6eb0ff", null, "аванс"],
  ["Премия", "income", "income", "★", "#9dceff", null, "премия,бонус"],
  ["Подработка", "income", "income", "✚", "#7eb6e8", null, "фриланс,подработка,гонорар"],
  ["Прочий доход", "income", "income", "•", "#b7a48a", null, "кэшбэк,процент,возврат"],
  ["Жильё", "expense", "needs", "⌂", "#d4785a", 55000, "аренда,жкх,квартира,коммунал,ипотека"],
  ["Продукты", "expense", "needs", "▤", "#9caf72", 28000, "пятерочка,магнит,перекресток,лента,вкусвилл,продукты,азбука,дикси,верный"],
  ["Транспорт", "expense", "needs", "→", "#7ea0b8", 8000, "метро,такси,яндекс go,яндекс.го,бензин,азс,ржд,каршеринг,лукойл"],
  ["Связь", "expense", "needs", "⌁", "#8aa0b4", 1500, "мтс,билайн,мегафон,теле2,ростелеком,интернет,связь"],
  ["Здоровье", "expense", "needs", "+", "#7eae98", 5000, "аптека,клиника,врач,стоматолог,36.6,ригла"],
  ["Кафе и доставка", "expense", "wants", "☕", "#e0a15a", 8000, "кофе,кафе,ресторан,додо,яндекс еда,delivery,бар,кофейня,кофемания"],
  ["Подписки", "expense", "wants", "↻", "#b48ab8", 2500, "netflix,spotify,кинопоиск,иви,плюс,steam,подписка,icloud,youtube"],
  ["Одежда", "expense", "wants", "◇", "#d4788a", 6000, "lamoda,zara,одежда,обувь,uniqlo"],
  ["Развлечения", "expense", "wants", "✶", "#7e8ec4", 5000, "кино,театр,концерт,игры"],
  ["Маркетплейсы", "expense", "wants", "▣", "#c4a06a", 7000, "ozon,wildberries,яндекс маркет,авито,маркетплейс"],
  ["Образование", "expense", "wants", "✎", "#6a9ec4", 4000, "курс,книга,литрес,нетология,skillbox"],
  ["Накопления", "expense", "savings", "▣", "#4da3ff", null, "накопления,вклад,подушка"],
  ["Прочее", "expense", "wants", "•", "#8a8678", null, ""],
];

export const ACCOUNT_COLORS = ["#4da3ff", "#5ecf9a", "#7eb6e8", "#f0816a", "#9b8cff", "#6ec8d4"];
