import { createHmac, timingSafeEqual } from "node:crypto";
import { Driver } from "@ydbjs/core";
import { query } from "@ydbjs/query";
import { MetadataCredentialsProvider } from "@ydbjs/auth/metadata";
import { Int64 } from "@ydbjs/value/primitive";

// SellerKit Studio API: first production stage.
// Read-only public functionality: authenticated Telegram profile/balance.
// There are deliberately NO public credit, purchase or generation methods.
const FRONTEND_ORIGIN = "https://danil12-32.github.io";
const MAX_AUTH_AGE_SECONDS = 12 * 60 * 60;
let queryPromise;

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
  const sql = await ydbQuery();
  // Column users.telegram_id is Utf8, so Telegram ID must be stored as a string.
  const id = String(telegramId);

  // Atomic create-on-first-login. No trial credits until actual AI launch.
  const row = await sql.begin(async tx => {
    const [rows] = await tx`
      SELECT telegram_id, balance, trial_used, referral_rewarded
      FROM users
      WHERE telegram_id = ${id}
    `;
    if (rows.length) return rows[0];

    await tx`
      INSERT INTO users
        (telegram_id, balance, trial_used, referral_rewarded, created_at)
      VALUES
        (${id}, ${new Int64(0n)}, ${false}, ${false}, CurrentUtcTimestamp())
    `;
    return { balance: 0, trial_used: false, referral_rewarded: false };
  });

  return {
    telegramId,
    balance: Number(row.balance ?? 0),
    trialUsed: Boolean(row.trial_used),
    referralRewarded: Boolean(row.referral_rewarded)
  };
}

export async function handler(event) {
  const method = String(event.httpMethod || event.requestContext?.http?.method || "").toUpperCase();
  const origin = event.headers?.origin || event.headers?.Origin || "";

  if (method === "OPTIONS") return response(204, {}, origin);
  if (method === "GET") return response(200, {
    success: true, service: "SellerKit Studio API", status: "online"
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
  if (!body || body.action !== "me") {
    return response(400, { error: "UNSUPPORTED_ACTION" }, origin);
  }
  const telegramUser = verifiedTelegramUser(body.initData);
  if (!telegramUser) {
    return response(401, { error: "INVALID_TELEGRAM_AUTH" }, origin);
  }

  try {
    const user = await profile(telegramUser.id);
    return response(200, { success: true, ...user }, origin);
  } catch (error) {
    console.error("SellerKit API /me failed:", error?.message || "internal error");
    return response(503, { error: "DATABASE_UNAVAILABLE" }, origin);
  }
}
