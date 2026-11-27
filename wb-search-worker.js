let rows = [];
let matches = [];
let loading;
const alphabet = new Intl.Collator("ru");
const prefix = new URL("./wb-keywords/", self.location.href);

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

async function getJson(url, cache) {
  const response = await fetch(url, { cache });
  if (!response.ok) throw Error("HTTP " + response.status);
  return response.json();
}

async function readKeywords() {
  const manifest = await getJson(new URL("manifest.json", prefix), "no-store");
  if (!Array.isArray(manifest.parts) || !manifest.parts.length ||
      !Number.isSafeInteger(manifest.count) || manifest.count < 1) {
    throw Error("Неверный формат базы");
  }

  const loaded = [];
  // Limit concurrent downloads and parsing so the full set fits on mobile devices.
  for (let start = 0; start < manifest.parts.length; start += 2) {
    const batch = await Promise.all(manifest.parts.slice(start, start + 2)
      .map(part => getJson(new URL(part, prefix), "force-cache")));
    for (const part of batch) {
      if (!Array.isArray(part)) throw Error("Неверный формат базы");
      for (const row of part) {
        loaded.push({
          query: row[0], volume: row[1], previous: row[2], daily: row[3],
          category: row[4], words: " " + normalize(row[0]) + " "
        });
      }
    }
  }
  if (loaded.length !== manifest.count) throw Error("База загрузилась не полностью");
  rows = loaded;
  self.postMessage({
    type: "ready", count: rows.length,
    period: manifest.period, previousPeriod: manifest.previousPeriod
  });
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

function search({ query, min, sort }) {
  const words = normalize(query).split(" ").filter(Boolean).map(word => " " + word + " ");
  if (!words.length) return [];
  const list = rows.filter(row => row.volume >= min && words.every(word => row.words.includes(word)));
  if (sort === "growth") list.sort((a, b) => (b.volume - b.previous) - (a.volume - a.previous));
  else if (sort === "alpha") list.sort((a, b) => alphabet.compare(a.query, b.query));
  else list.sort((a, b) => b.volume - a.volume);
  return list;
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
    await load();
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
