import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "./index.js";

const origin = "https://danil12-32.github.io";

test("Yandex Cloud entrypoint is exported", () => {
  assert.equal(typeof handler, "function");
});

test("GET health check succeeds and reports version", async () => {
  const result = await handler({ httpMethod: "GET", headers: { origin } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Access-Control-Allow-Origin"], origin);
  const body = JSON.parse(result.body);
  assert.equal(body.success, true);
  assert.equal(body.status, "online");
  assert.match(body.build, /^sellerkit-/);
});

test("OPTIONS preflight returns CORS response", async () => {
  const result = await handler({ httpMethod: "OPTIONS", headers: { origin } });
  assert.equal(result.statusCode, 204);
  assert.equal(result.headers["Access-Control-Allow-Origin"], origin);
});

test("invalid POST action is rejected before Telegram/YDB access", async () => {
  const result = await handler({
    httpMethod: "POST",
    headers: { origin },
    body: JSON.stringify({ action: "invalid_test" })
  });
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).error, "UNSUPPORTED_ACTION");
});
