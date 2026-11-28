(() => {
  const element = (id) => document.getElementById(id);
  const telegram = window.Telegram?.WebApp;
  const name = String(telegram?.initDataUnsafe?.user?.first_name || "").split(/\s+[|｜]\s+/, 1)[0].trim().slice(0, 40);
  const tips = [
    "Обложка должна сразу отвечать на два вопроса. Что это и зачем мне?",
    "Один слайд — одна мысль. Остальные аргументы разнеси по галерее.",
    "Проверь главный слайд в размере выдачи. Мелкий текст в ленте почти исчезает.",
    "Покажи товар в деле. Покупателю проще представить, как он им воспользуется.",
    "Вынеси важный размер на отдельный кадр. На фото без масштаба легко ошибиться.",
    "УТП работает лучше, когда его можно увидеть прямо на фото.",
    "Начни разбор карточки с первого кадра, заголовка и вопросов из отзывов.",
    "Если на обложке всё выделено, глаз не понимает, куда смотреть первым.",
    "Дай покупателю разглядеть товар. Оставь отступ между ним и текстом.",
    "Фраза «удобно в дороге» лучше работает вместе с кадром, где видно почему.",
    "Для сравнения двух обложек меняй один элемент за раз.",
    "Прочитай заголовок вслух. Если он звучит как список ключей, убери повторы."
  ];

  function greet() {
    const hour = new Date().getHours();
    const hello = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : hour < 23 ? "Добрый вечер" : "Доброй ночи";
    element("homeGreeting").textContent = name ? hello + ", " + name : hello;
    const slot = Math.floor(Date.now() / 7_200_000);
    const next = tips[(slot + Math.floor(slot / tips.length)) % tips.length];
    element("homeDesignTip").textContent = next;
  }

  greet();
  setInterval(() => { if (!document.hidden) greet(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) greet(); });

  const userId = telegram?.initDataUnsafe?.user?.id;
  const storageKey = userId ? "sellerkit-assistant-dialogs:" + userId : null;
  let dialogs = [];
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) dialogs = saved.filter(dialog =>
        dialog && typeof dialog.id === "string" && Array.isArray(dialog.messages) &&
        dialog.messages.length > 0 && typeof dialog.title === "string"
      ).slice(0, 30);
    } catch {}
  }
  let current = null;
  let request = null;
  let accessRequest = null;
  let available = false;
  let accessText = "";
  let usage = null;
  let usageTimer;

  const history = element("assistantHistory");
  const question = element("assistantQuestion");
  const status = element("assistantStatus");
  const accessNode = element("assistantAccess");
  const usageNode = element("assistantUsage");

  function readableAnswer(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*$/gm, "")
      .replace(/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/gm, "")
      .replace(/[ \t]+#{1,6}[ \t]*$/gm, "")
      .replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/!?\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, bold, underline) => bold ?? underline)
      .replace(/(^|[\s([{"«–—])(?:\*([^*\s\n][^*\n]*?)\*|_([^_\s\n][^_\n]*?)_)(?=$|[\s.,!?;:)\]}"»–—])/gm,
        (_, before, a, b) => before + (a ?? b))
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
      .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
      .trim();
  }

  function renderHistory() {
    history.replaceChildren();
    element("assistantEmpty").hidden = dialogs.length > 0;
    for (const dialog of dialogs) {
      const button = document.createElement("button");
      button.className = "assistantHistoryRow";
      button.type = "button";
      const title = document.createElement("strong");
      title.textContent = dialog.title;
      const preview = document.createElement("small");
      preview.textContent = readableAnswer(dialog.messages.at(-1)?.content);
      button.append(title, preview);
      button.onclick = () => start(dialog);
      history.append(button);
    }
  }

  function appendMessage(role, content) {
    const bubble = document.createElement("p");
    bubble.className = role === "user" ? "assistantBubble assistantBubbleUser" : "assistantBubble";
    bubble.textContent = role === "assistant" ? readableAnswer(content) : content;
    element("assistantMessages").append(bubble);
  }

  function renderThread() {
    if (!current) return;
    element("assistantTitle").textContent = current.title || "Новый диалог";
    element("assistantMessages").replaceChildren();
    if (!current.messages.length) appendMessage("assistant", "Я ИИ-дизайнер SellerKit. Расскажи, что продаёшь и что хочешь улучшить в карточке или тексте.\n\nРазработка @danyaaarrrrr52");
    for (const message of current.messages) appendMessage(message.role, message.content);
    if (request?.dialog === current) appendMessage("user", request.text);
    element("assistantSuggestions").hidden = current.messages.length > 0 || request?.dialog === current;
    const list = element("assistantMessages");
    list.scrollTop = list.scrollHeight;
  }

  function renderControls() {
    accessNode.textContent = accessText;
    usageNode.hidden = !available || !usage;
    usageNode.textContent = usage ? "Использовано " + (usage.dailyLimit - usage.remaining) + " из " + usage.dailyLimit + " запросов" : "";
    element("assistantSend").disabled = !available || Boolean(request);
    question.readOnly = request?.dialog === current && Boolean(request);
  }

  function updateUsage(next) {
    if (!next) return;
    const { dailyLimit, remaining, resetAt } = next;
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || !Number.isSafeInteger(remaining) ||
        remaining < 0 || remaining > dailyLimit || !Number.isFinite(resetAt) || resetAt <= Date.now()) return;
    if (usage && (resetAt < usage.resetAt || (resetAt === usage.resetAt && remaining > usage.remaining))) return;

    usage = { dailyLimit, remaining, resetAt };
    clearTimeout(usageTimer);
    usageTimer = setTimeout(() => {
      usage = null;
      renderControls();
      if (element("assistant").classList.contains("active")) refreshAccess();
    }, resetAt - Date.now());
  }

  async function api(action, fields = {}) {
    const result = await fetch(SELLERKIT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action, initData: telegram.initData, ...fields }),
      signal: AbortSignal.timeout(33000)
    });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) throw Object.assign(new Error(data.error || "ASSISTANT_UNAVAILABLE"), { resetAt: data.resetAt, usage: data.usage });
    return data;
  }

  function refreshAccess() {
    if (accessRequest) return accessRequest;
    if (!telegram?.initData) {
      available = false;
      accessText = "Для переписки открой SellerKit через Telegram.";
      renderControls();
      return;
    }
    accessText = "Проверяем доступ…";
    renderControls();
    accessRequest = api("assistant_access").then((access) => {
      available = access.available === true;
      updateUsage(access.usage);
      accessText = available
        ? (access.until ? "Доступ до " + new Date(access.until).toLocaleDateString("ru-RU") + " · " : "")
          + "до " + access.dailyLimit + " запросов в день"
        : "Переписка доступна в течение оплаченного срока подписки.";
    }).catch(error => {
      available = false;
      accessText = error.message === "INVALID_TELEGRAM_AUTH"
        ? "Сессия устарела. Закрой и снова открой SellerKit в Telegram."
        : "Не удалось проверить доступ к чату. Открой раздел ещё раз.";
    }).finally(() => {
      accessRequest = null;
      renderControls();
    });
    return accessRequest;
  }

  function overview() {
    current = null;
    element("assistantOverview").hidden = false;
    element("assistantThread").hidden = true;
    renderHistory();
    renderControls();
  }

  function start(dialog = null) {
    if (!element("assistant").classList.contains("active")) openPage("assistant");
    current = dialog || { id: crypto.randomUUID(), title: "", messages: [] };
    element("assistantOverview").hidden = true;
    element("assistantThread").hidden = false;
    question.value = request?.dialog === current ? request.text : "";
    status.textContent = request?.dialog === current ? "Готовлю ответ…" : "";
    renderThread();
    renderControls();
  }

  function save(dialog) {
    dialogs = [dialog, ...dialogs.filter(item => item.id !== dialog.id)].slice(0, 30);
    try {
      if (!storageKey) return false;
      localStorage.setItem(storageKey, JSON.stringify(dialogs));
      return true;
    } catch {
      return false;
    }
  }

  element("assistantForm").onsubmit = async event => {
    event.preventDefault();
    const text = question.value.trim();
    if (!text || !current || !available || request) return;
    const dialog = current;
    request = { dialog, text };
    status.textContent = "Готовлю ответ…";
    renderThread();
    renderControls();

    try {
      const messages = dialog.messages.slice(-8).map(({ role, content }) => ({
        role, content: (role === "assistant" ? readableAnswer(content) || content : content).slice(0, 1800)
      }));
      const data = await api("assistant_chat", { question: text, history: messages });
      updateUsage(data.usage);
      const answer = typeof data.answer === "string" ? readableAnswer(data.answer) : "";
      if (!answer) throw Error("ASSISTANT_UNAVAILABLE");
      dialog.title ||= text.slice(0, 56);
      dialog.messages = [...dialog.messages, { role: "user", content: text }, { role: "assistant", content: answer }].slice(-80);
      const saved = save(dialog);
      if (current === dialog) {
        question.value = "";
        status.textContent = saved ? "" : "Диалог сохранён до закрытия страницы.";
      }
      if (!current) renderHistory();
    } catch (error) {
      updateUsage(error.usage);
      let message = {
        ASSISTANT_LIMIT: "Дневной лимит исчерпан. Попробуй позже.",
        ASSISTANT_TIMEOUT: "Ответ задержался. Попробуй задать вопрос ещё раз.",
        INVALID_ASSISTANT_INPUT: "Проверь текст вопроса. Максимум 2 000 символов.",
        INVALID_TELEGRAM_AUTH: "Сессия устарела. Открой SellerKit заново в Telegram."
      }[error.message] || "Ответ пока недоступен. Попробуй ещё раз.";
      if (error.message === "ASSISTANT_LIMIT" && Number.isFinite(error.resetAt)) {
        const reset = new Date(error.resetAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
        message = "Дневной лимит исчерпан. Восстановится " + reset + ".";
      }
      if (error.message === "ASSISTANT_ACCESS_REQUIRED") {
        available = false;
        accessText = "Переписка доступна в течение оплаченного срока подписки.";
        message = "Проверь срок доступа в профиле.";
      }
      if (current === dialog) status.textContent = message;
    } finally {
      request = null;
      renderThread();
      renderControls();
    }
  };

  question.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && matchMedia("(pointer: fine)").matches) {
      event.preventDefault();
      element("assistantForm").requestSubmit();
    }
  });
  for (const button of element("assistantSuggestions").querySelectorAll("button")) {
    button.onclick = () => {
      if (question.readOnly) return;
      question.value = button.textContent;
      question.focus();
    };
  }
  for (const button of document.querySelectorAll("[data-assistant-new]")) button.onclick = () => start();
  for (const button of document.querySelectorAll("[data-assistant-open]")) button.onclick = () => openPage("assistant");
  element("assistantBack").onclick = overview;

  window.sellerDesigner = { open() { overview(); refreshAccess(); } };
})();
