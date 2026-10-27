export async function narrate(settings, payload) {
  if (!settings?.key) {
    return { ok: false, error: "Ключ модели не задан" };
  }
  const base = String(settings.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model: settings.model || "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "Ты финансовый редактор личного учёта. Пиши по-русски, коротко, на «вы», без морали и без инвестиционных советов. Не выдумывай числа: используй только JSON. Не предлагай кредиты, казино и сомнительные схемы. Верни только JSON вида {\"briefing\":\"4-6 предложений\",\"tips\":[{\"title\":\"\",\"body\":\"\",\"severity\":\"info\"}]}. tips максимум 3.",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, error: `Модель ответила ${response.status}: ${raw.slice(0, 240)}` };
    }
    const data = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content || "";
    const parsed = parseModelJson(text);
    if (!parsed?.briefing) return { ok: false, error: "Модель не вернула понятную сводку" };
    return { ok: true, briefing: String(parsed.briefing).slice(0, 1600), tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 3) : [] };
  } catch (error) {
    const message = error.name === "AbortError" ? "Модель не ответила за 25 секунд" : error.message;
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function parseModelJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
