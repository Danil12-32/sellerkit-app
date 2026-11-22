// Called after the application has persisted an order with the user's Telegram ID.
export const plans = Object.freeze({
  week: { days: 7, rubles: 350, credits: 30 },
  month: { days: 30, rubles: 990, credits: 120 },
  plus: { days: 30, rubles: 1250, credits: 300 }
});

export async function createPayment({orderId, planId, method}, env = process.env) {
  const plan = Object.hasOwn(plans, planId) && plans[planId];
  if (!plan || !["sbp", "card"].includes(method) || typeof orderId !== "string" || !orderId.trim()) {
    throw new Error("INVALID_ORDER");
  }
  if (!env.PLATEGA_MERCHANT_ID || !env.PLATEGA_SECRET) throw new Error("MERCHANT_NOT_CONFIGURED");
  const response = await fetch("https://app.platega.io/transaction/process", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MerchantId": env.PLATEGA_MERCHANT_ID, "X-Secret": env.PLATEGA_SECRET },
    body: JSON.stringify({
      paymentMethod: method === "sbp" ? 2 : 11,
      paymentDetails: { amount: plan.rubles, currency: "RUB" },
      description: "SellerKit Studio · доступ на " + plan.days + " дн.",
      payload: orderId,
      return: "https://t.me/CardLab1_Bot",
      failedUrl: "https://t.me/CardLab1_Bot"
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("PLATEGA_HTTP_" + response.status);
  const data = await response.json();
  const url = new URL(data.redirect);
  if (url.protocol !== "https:" || !data.transactionId) throw new Error("INVALID_CHECKOUT");
  return {transactionId: data.transactionId, url: url.href};
}

// Persist this result exactly once per confirmed transaction, in the same
// transaction as the order's transition to paid. Notify only after commit.
export function confirmedTerm(planId, currentUntilMs, nowMs) {
  if (!Object.hasOwn(plans, planId)) throw new Error("INVALID_PLAN");
  if (![nowMs,currentUntilMs].every(Number.isSafeInteger)) throw new Error("INVALID_DATE");
  const renewing = currentUntilMs > nowMs;
  const until = Math.max(currentUntilMs, nowMs) + plans[planId].days * 86400000;
  const date = new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Novokuznetsk"}).format(until);
  return { until, message: "Оплата получена! Подписка " + (renewing ? "продлена" : "активна") + " до " + date + "." };
}
