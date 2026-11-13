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
const SERVER_BUILD = "sellerkit-ydb-diagnostic-2";
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

  // telegram_id is Utf8 in the existing SellerKit table.
  const id = String(telegramId);

  // Separate single-statement queries do not need an explicit sql.begin()
  // transaction. Do not UPSERT a default row: that could reset paid credits.
  async function readUser() {
    try {
      const resultSets = await sql`
        SELECT telegram_id, balance, trial_used, referral_rewarded
        FROM users
        WHERE telegram_id = ${id}
      `;
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
        INSERT INTO users
          (telegram_id, balance, trial_used, referral_rewarded, created_at)
        VALUES
          (${id}, ${new Int64(0n)}, ${false}, ${false}, CurrentUtcTimestamp())
      `;
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
