let rows = [];
let matches = [];
let loading;
const workerUrl = new URL(self.location.href);
const period = workerUrl.searchParams.get("period") || "week";
const prefix = new URL("./wb-keywords/", workerUrl);

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

async function getJson(url, cache) {
  const response = await fetch(url, { cache });
  if (!response.ok) throw Error("HTTP " + response.status);
  return response.json();
}

function appendRows(target, part) {
  if (!Array.isArray(part)) throw Error("Неверный формат базы");
  for (const row of part) {
    target.push({
      query: row[0], volume: row[1], previous: row[2], daily: row[3],
      category: row[4], words: " " + normalize(row[0]) + " "
    });
  }
}

async function readKeywords() {
  const periods = await getJson(new URL("periods.json", prefix), "no-store");
  const source = Object.hasOwn(periods, period) ? periods[period] : null;
  if (!source) {
    self.postMessage({ type: "unavailable" });
    return false;
  }

  const sourceUrl = new URL(source.path, prefix);
  const data = await getJson(sourceUrl, "no-store");
  const loaded = [];
  if (source.format === "rows") {
    appendRows(loaded, data.rows);
  } else {
    if (!Array.isArray(data.parts) || !data.parts.length ||
        !Number.isSafeInteger(data.count) || data.count < 1) {
      throw Error("Неверный формат базы");
    }
    // Limit concurrent downloads and parsing so the full set fits on mobile devices.
    for (let start = 0; start < data.parts.length; start += 2) {
      const batch = await Promise.all(data.parts.slice(start, start + 2)
        .map(part => getJson(new URL(part, sourceUrl), "force-cache")));
      for (const part of batch) appendRows(loaded, part);
    }
    if (loaded.length !== data.count) throw Error("База загрузилась не полностью");
  }
  if (!loaded.length || !data.period) throw Error("Неверный формат базы");
  rows = loaded;
  self.postMessage({
    type: "ready", count: rows.length,
    period: data.period, previousPeriod: data.previousPeriod
  });
  return true;
}

function load() {
  if (!loading) {
    loading = readKeywords().catch(error => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

function search({ query, min }) {
  const words = normalize(query).split(" ").filter(Boolean).map(word => " " + word + " ");
  if (!words.length) return [];
  return rows.filter(row => row.volume >= min && words.every(word => row.words.includes(word)))
    .sort((a, b) => b.volume - a.volume);
}

function csvCell(value) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function exportMatches() {
  const lines = [["Запрос", "За период", "Предыдущий период", "В день", "Категория"].map(csvCell).join(";")];
  for (const row of matches) {
    lines.push([row.query, row.volume, row.previous, row.daily, row.category].map(csvCell).join(";"));
  }
  return new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

self.addEventListener("message", async ({ data }) => {
  try {
    if (!await load()) return;
    if (data.type === "search") {
      matches = search(data);
      const results = matches.slice(0, 100).map(({ words, ...row }) => row);
      self.postMessage({ type: "results", id: data.id, count: matches.length, results });
    }
    if (data.type === "export") self.postMessage({ type: "csv", file: exportMatches() });
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message });
  }
});
