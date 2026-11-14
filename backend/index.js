import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Driver } from "@ydbjs/core";
import { query } from "@ydbjs/query";
import { MetadataCredentialsProvider } from "@ydbjs/auth/metadata";
import { Int64, Text } from "@ydbjs/value/primitive";

// SellerKit Studio API: first production stage.
// Read-only public functionality: authenticated Telegram profile/balance.
// There are deliberately NO public credit, purchase or generation methods.
const FRONTEND_ORIGIN = "https://danil12-32.github.io";
const MAX_AUTH_AGE_SECONDS = 12 * 60 * 60;
const SERVER_BUILD = "sellerkit-support-inbox-7";
const BUG_CATEGORIES = Object.freeze({
  balance: "Баланс и оплата",
  ai: "AI Studio",
  seo: "SEO и аналитика",
  calc: "Юнит-экономика",
  app: "Вход и работа приложения",
  other: "Другая ошибка"
});
// A lightweight per-instance cooldown; use a shared rate limiter before scaling up.
const reportLastSent = new Map();
let queryPromise;
let ydbPingSuccessful = false;

function classifyYdbError(error, fallback) {
  // Return only fixed diagnostic labels, never raw DB errors or credentials.
  const details = String(error?.message || "") + " " + String(error?.code || "");
  if (/UNAUTHENTICATED|UNAUTHORIZED|INVALID.TOKEN|AUTHENTICATION|TOKEN.EXPIRED/i.test(details)) return "YDB_AUTH_FAILED";
  if (/PERMISSION_DENIED|ACCESS_DENIED|ACCESS DENIED|PERMISSION DENIED|NOT ENOUGH RIGHTS|FORBIDDEN/i.test(details)) return "YDB_ACCESS_DENIED";
  if (/TYPE.MISMATCH|TYPE ANNOTATION|INCOMPATIBLE TYPES|CANNOT CONVERT|TYPE ERROR/i.test(details)) return "YDB_TYPE_MISMATCH";
  if (/PATH DOES NOT EXIST|PATH NOT FOUND|UNKNOWN TABLE|UNKNOWN COLUMN|COLUMN NOT FOUND|TABLE DOES NOT EXIST/i.test(details)) return "YDB_SCHEMA_NOT_FOUND";
  if (/DEADLINE_EXCEEDED|ETIMEDOUT|ECONNREFUSED|ECONNRESET|UNAVAILABLE|NETWORK ERROR/i.test(details)) return "YDB_NETWORK_FAILED";
  return fallback;
}

function response(statusCode, payload, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (origin === FRONTEND_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN;
    headers["Vary"] = "Origin";
  }
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function verifiedTelegramUser(raw) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  if (typeof raw !== "string" || raw.length < 25 || raw.length > 16384) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  const date = Number(params.get("auth_date"));
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(date) || date > now + 60 ||
      date < now - MAX_AUTH_AGE_SECONDS) return null;

  const dataCheck = [...params.entries()]
    // Telegram's bot-token HMAC includes the "signature" parameter if present.
    // Only "hash" is excluded. Removing "signature" rejects genuine Mini App sessions.
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)) return null;
  try {
    const user = JSON.parse(params.get("user") || "");
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return user;
  } catch {
    return null;
  }
}

async function ydbQuery() {
  if (!queryPromise) {
    queryPromise = (async () => {
      const endpoint = process.env.YDB_ENDPOINT;
      const database = process.env.YDB_DATABASE;
      if (!endpoint || !database) throw new Error("YDB environment is incomplete");
      const uri = endpoint.replace(/\/$/, "") + "/" + database.replace(/^\/+/, "");
      const driver = new Driver(uri, {
        credentialsProvider: new MetadataCredentialsProvider()
      });
      await driver.ready();
      return query(driver, { poolOptions: { maxSize: 8 } });
    })().catch(error => {
      queryPromise = undefined;
      throw error;
    });
  }
  return queryPromise;
}

async function profile(telegramId) {
  let sql;
  try {
    sql = await ydbQuery();
  } catch (error) {
    console.error("YDB init:", error?.message || "unknown");
    throw new Error("YDB_CONNECTION_FAILED");
  }

  // Verify that the YDB driver can execute *any* query before testing users.
  // A failed SELECT 1 points to connection / service credentials, not the users table.
  if (!ydbPingSuccessful) {
    try {
      const check = await sql`SELECT 1 AS ok;`;
      if (!Array.isArray(check)) throw new Error("UNEXPECTED_PING_RESULT");
      ydbPingSuccessful = true;
    } catch (error) {
      console.error("YDB ping failed:", error?.message || "unknown");
      throw new Error(classifyYdbError(error, "YDB_PING_FAILED"));
    }
  }

  // The actual YDB users.telegram_id primary key is NOT NULL Int64.
  // Telegram IDs were already validated as positive safe integers.
  const id = new Int64(BigInt(telegramId));

  // Separate single-statement queries do not need an explicit sql.begin()
  // transaction. Do not UPSERT a default row: that could reset paid credits.
  async function readUser() {
    try {
      const resultSets = await sql`
        DECLARE $tgId AS Int64;
        SELECT telegram_id, balance, trial_used, referral_rewarded
        FROM users
        WHERE telegram_id = $tgId;
      `.parameter("tgId", id);
      if (!Array.isArray(resultSets) || !Array.isArray(resultSets[0])) {
        throw new Error("BAD_YDB_RESULT");
      }
      return resultSets[0];
    } catch (error) {
      if (error?.message === "BAD_YDB_RESULT") {
        console.error("YDB SELECT returned unexpected result shape");
        throw new Error("YDB_RESULT_FORMAT_FAILED");
      }
      console.error("YDB SELECT:", error?.message || "unknown");
      throw new Error(classifyYdbError(error, "YDB_SELECT_FAILED"));
    }
  }

  let rows = await readUser();
  if (rows.length === 0) {
    // New user: insert just once. On simultaneous first opens the second
    // request may see a primary-key conflict; a re-read recovers safely.
    try {
      await sql`
        DECLARE $tgId AS Int64;
        DECLARE $initialBalance AS Int64;
        INSERT INTO users
          (telegram_id, balance, trial_used, referral_rewarded, created_at)
        VALUES
          ($tgId, $initialBalance, false, false, CurrentUtcTimestamp());
      `
        .parameter("tgId", id)
        .parameter("initialBalance", new Int64(0n));
    } catch (error) {
      console.error("YDB INSERT:", error?.message || "unknown");
      rows = await readUser();
      if (rows.length === 0) throw new Error("YDB_INSERT_FAILED");
    }
    if (rows.length === 0) rows = await readUser();
    if (rows.length === 0) throw new Error("YDB_INSERT_FAILED");
  }

  const row = rows[0];
  const balance = Number(row.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error("YDB_BALANCE_FORMAT_FAILED");
  }

  return {
    telegramId,
    balance,
    trialUsed: Boolean(row.trial_used),
    referralRewarded: Boolean(row.referral_rewarded)
  };
}



async function supportSql() {
  try { return await ydbQuery(); }
  catch (error) {
    console.error("Support YDB connection:", classifyYdbError(error, "YDB_CONNECTION_FAILED"));
    throw new Error("SUPPORT_STORAGE_UNAVAILABLE");
  }
}

async function findSavedReport(sql, reportId) {
  const [rows] = await sql`
    DECLARE $reportId AS Utf8;
    SELECT telegram_id FROM support_reports WHERE report_id = $reportId;
  `.parameter("reportId", new Text(reportId));
  return Array.isArray(rows) && rows.length ? String(rows[0].telegram_id) : null;
}

async function saveReport(telegramUser, category, description, reportId) {
  const sql = await supportSql();
  const name = [telegramUser.first_name, telegramUser.last_name]
    .filter(x => typeof x === "string").join(" ").slice(0, 100) || "Пользователь";
  const username = typeof telegramUser.username === "string"
    ? telegramUser.username.slice(0, 40) : "";
  const id = new Int64(BigInt(telegramUser.id));

  try {
    await sql`
      DECLARE $reportId AS Utf8;
      DECLARE $userId AS Int64;
      DECLARE $name AS Utf8;
      DECLARE $username AS Utf8;
      DECLARE $category AS Utf8;
      DECLARE $description AS Utf8;
      INSERT INTO support_reports
        (report_id, telegram_id, sender_name, username, category, description, created_at)
      VALUES
        ($reportId, $userId, $name, $username, $category, $description, CurrentUtcTimestamp());
    `
      .parameter("reportId", new Text(reportId))
      .parameter("userId", id)
      .parameter("name", new Text(name))
      .parameter("username", new Text(username))
      .parameter("category", new Text(category))
      .parameter("description", new Text(description));
    return { created: true, name, username };
  } catch (error) {
    // Retried request after a lost HTTP response: don't create duplicate tickets.
    try {
      const originalOwner = await findSavedReport(sql, reportId);
      if (originalOwner === String(telegramUser.id)) return { created: false, name, username };
    } catch {}
    console.error("Support YDB INSERT failed:", classifyYdbError(error, "SUPPORT_INSERT_FAILED"));
    throw new Error("SUPPORT_STORAGE_UNAVAILABLE");
  }
}

// Telegram push is best-effort. Storing the ticket in YDB is the source of truth.
let skipTelegramPushUntil = 0;
async function pushReportToTelegram(telegramUser, category, description, reportId, name, username) {
  if (Date.now() < skipTelegramPushUntil) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SELLERKIT_SUPPORT_CHAT_ID;
  if (!token || !chatId) return false;
  const message = [
    "🐞 Новое обращение SellerKit #" + reportId.slice(0, 8),
    "Раздел: " + (BUG_CATEGORIES[category] || category),
    "Пользователь: " + name + (username ? " (@" + username + ")" : ""),
    "Telegram ID: " + telegramUser.id,
    "",
    "Описание:",
    description,
    "",
    "Полная копия обращения сохранена в YDB и доступна в SellerKit → Обращения."
  ].join("\n");

  try {
    const result = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(2200)
    });
    const parsed = await result.json().catch(() => ({}));
    if (result.ok && parsed?.ok === true) return true;
    console.error("Support Telegram push rejected:", result.status);
    if (result.status >= 500 || result.status === 429) skipTelegramPushUntil = Date.now() + 60000;
    return false;
  } catch (error) {
    console.error("Support Telegram push timed out / unavailable:", error?.name || "unknown");
    skipTelegramPushUntil = Date.now() + 5 * 60000;
    return false;
  }
}

async function sendSupportReport(telegramUser, body) {
  const category = body.category;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (typeof category !== "string" ||
      !Object.prototype.hasOwnProperty.call(BUG_CATEGORIES, category) ||
      description.length < 15 || description.length > 1800) {
    return { status: 400, payload: { error: "INVALID_SUPPORT_REPORT" } };
  }

  // Browser reuses this ID when the same form is retried after a network issue.
  const reportId = typeof body.reportId === "string"
    && /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(body.reportId)
    ? body.reportId : randomUUID();
  const now = Date.now();
  const id = telegramUser.id;
  const previous = reportLastSent.get(id);
  if (previous && now - previous.at < 60000 && previous.reportId !== reportId) {
    return { status: 429, payload: { error: "REPORT_RATE_LIMIT" } };
  }
  if (reportLastSent.size > 2000) reportLastSent.clear();
  reportLastSent.set(id, { at: now, reportId });

  try {
    const saved = await saveReport(telegramUser, category, description, reportId);
    const notified = saved.created
      ? await pushReportToTelegram(telegramUser, category, description, reportId, saved.name, saved.username)
      : false;
    return {
      status: 200,
      payload: { success: true, saved: true, notified, reportId, build: SERVER_BUILD }
    };
  } catch (error) {
    if (reportLastSent.get(id)?.reportId === reportId) reportLastSent.delete(id);
    const code = error?.message === "SUPPORT_STORAGE_UNAVAILABLE"
      ? error.message : "SUPPORT_SAVE_FAILED";
    return { status: 503, payload: { error: code, build: SERVER_BUILD } };
  }
}

async function listSupportReports() {
  try {
    const sql = await supportSql();
    const [rows] = await sql`
      SELECT report_id, telegram_id, sender_name, username, category, description, created_at
      FROM support_reports
      ORDER BY created_at DESC
      LIMIT 50;
    `;
    if (!Array.isArray(rows)) throw new Error("BAD_SUPPORT_RESULT");
    return {
      status: 200,
      payload: {
        success: true,
        reports: rows.map(row => ({
          reportId: String(row.report_id),
          telegramId: String(row.telegram_id),
          senderName: String(row.sender_name || ""),
          username: String(row.username || ""),
          category: String(row.category || ""),
          description: String(row.description || ""),
          createdAt: row.created_at instanceof Date
            ? row.created_at.toISOString() : String(row.created_at || "")
        }))
      }
    };
  } catch (error) {
    console.error("List support reports:", classifyYdbError(error, "SUPPORT_LIST_FAILED"));
    return { status: 503, payload: { error: "SUPPORT_STORAGE_UNAVAILABLE" } };
  }
}

export async function handler(event) {
  const method = String(event.httpMethod || event.requestContext?.http?.method || "").toUpperCase();
  const origin = event.headers?.origin || event.headers?.Origin || "";

  if (method === "OPTIONS") return response(204, {}, origin);
  if (method === "GET") return response(200, {
    success: true, service: "SellerKit Studio API", status: "online", build: SERVER_BUILD
  }, origin);
  if (method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" }, origin);

  let body;
  try {
    const content = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body;
    body = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return response(400, { error: "INVALID_JSON" }, origin);
  }
  if (!body || !["me", "report_error", "list_reports"].includes(body.action)) {
    return response(400, { error: "UNSUPPORTED_ACTION" }, origin);
  }
  let telegramUser;
  try {
    telegramUser = verifiedTelegramUser(body.initData);
  } catch (error) {
    if (String(error?.message || "").includes("TELEGRAM_BOT_TOKEN is not configured")) {
      console.error("Telegram initData verification unavailable: bot token missing");
      return response(503, { error: "SERVER_AUTH_NOT_CONFIGURED", build: SERVER_BUILD }, origin);
    }
    console.error("Telegram initData verification error:", error?.name || "unknown");
    return response(503, { error: "SERVER_AUTH_FAILED", build: SERVER_BUILD }, origin);
  }
  if (!telegramUser) {
    return response(401, { error: "INVALID_TELEGRAM_AUTH", build: SERVER_BUILD }, origin);
  }

  if (body.action === "report_error") {
    const sent = await sendSupportReport(telegramUser, body);
    return response(sent.status, sent.payload, origin);
  }
  if (body.action === "list_reports") {
    if (!process.env.SELLERKIT_SUPPORT_CHAT_ID ||
        String(telegramUser.id) !== process.env.SELLERKIT_SUPPORT_CHAT_ID) {
      return response(403, { error: "FORBIDDEN" }, origin);
    }
    const listed = await listSupportReports();
    return response(listed.status, listed.payload, origin);
  }

  try {
    const user = await profile(telegramUser.id);
    return response(200, { success: true, ...user }, origin);
  } catch (error) {
    console.error("SellerKit API /me failed:", error?.message || "internal error");
    // Codes are safe diagnostics only; never return raw database errors or credentials.
    const safeCodes = new Set([
      "YDB_CONNECTION_FAILED",
      "YDB_SELECT_FAILED",
      "YDB_INSERT_FAILED",
      "YDB_RESULT_FORMAT_FAILED",
      "YDB_BALANCE_FORMAT_FAILED",
      "YDB_PING_FAILED",
      "YDB_AUTH_FAILED",
      "YDB_ACCESS_DENIED",
      "YDB_TYPE_MISMATCH",
      "YDB_SCHEMA_NOT_FOUND",
      "YDB_NETWORK_FAILED"
    ]);
    const stage = safeCodes.has(error?.message) ? error.message : "YDB_TRANSACTION_FAILED";
    return response(503, { error: "DATABASE_UNAVAILABLE", stage, build: SERVER_BUILD }, origin);
  }
}
