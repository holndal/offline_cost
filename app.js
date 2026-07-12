"use strict";

const SHOP_CSV_URL = "shop.csv";
const AFF_CSV_URL = "aff.csv";
const elements = {
  shop: document.getElementById("shop"),
  price: document.getElementById("price"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  count: document.getElementById("count"),
  status: document.getElementById("status"),
};

/** @type {Array<ShopRow>} */
let rows = [];

/** @type {Array<{aliases: string[], url: string}>} */
let affiliates = [];

/**
 * @typedef {object} ShopRow
 * @property {string} shop
 * @property {string} searchable
 * @property {number} rate
 * @property {number} truncateRate
 * @property {number} truncateUnit
 * @property {string} method
 * @property {string} normalizedSearchable
 * @property {string[]} normalizedTerms
 * @property {number} index
 */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60),
    )
    .toLocaleLowerCase("ja-JP")
    .replace(/\s+/g, "");
}

function parseCsv(text) {
  const result = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) {
        result.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) {
    result.push(row);
  }

  return result;
}

function toNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function parseShopRows(csvText) {
  const table = parseCsv(csvText.trim());
  if (table.length < 2) return [];

  const headers = table[0].map((header) => header.trim());
  const index = (name) => headers.indexOf(name);
  const shopIndex = index("お店");
  const searchableIndex = index("検索用");
  const rateIndex = index("還元率");
  const truncateRateIndex = index("切り捨て");
  const truncateUnitIndex = index("切り捨て単位");
  const methodIndex = index("支払方法");

  return table.slice(1).map((record, rowIndex) => {
    const searchable = (record[searchableIndex] ?? "").trim();
    const normalizedTerms = searchable
      .split("/")
      .map((term) => normalizeText(term))
      .filter(Boolean);
    const normalizedSearchable = normalizedTerms.join("/");

    return {
      shop: (record[shopIndex] ?? "").trim(),
      searchable,
      rate: toNumber(record[rateIndex]),
      truncateRate: toNumber(record[truncateRateIndex]),
      truncateUnit: Math.max(0, toNumber(record[truncateUnitIndex])),
      method: (record[methodIndex] ?? "").trim(),
      normalizedSearchable,
      normalizedTerms,
      index: rowIndex,
    };
  });
}

function parseAffiliateRows(csvText) {
  return parseCsv(csvText)
    .map((record) => {
      const name = (record[0] ?? "").trim();
      const url = (record[1] ?? "").trim();
      const aliases = name
        .split("/")
        .map((alias) => normalizeText(alias))
        .filter(Boolean);

      return { aliases, url };
    })
    .filter((record) => record.aliases.length > 0 && record.url !== "");
}

function getAffiliateUrl(method) {
  const normalizedMethod = normalizeText(method);
  const match = affiliates.find((affiliate) =>
    affiliate.aliases.some((alias) => alias === normalizedMethod),
  );

  return match?.url ?? "";
}

function formatYen(value) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 2,
  }).format(round2(value));
}

function formatInt(value) {
  return String(Math.trunc(value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function calculateReward(row, price) {
  const baseReward = (price * row.rate) / 100;
  const stepCount = row.truncateUnit > 0 ? Math.floor(price / row.truncateUnit) : 0;
  const stepReward = (stepCount * row.truncateUnit * row.truncateRate) / 100;
  const reward = baseReward + stepReward;
  const effectiveRate = price > 0 ? (reward / price) * 100 : 0;

  return {
    baseReward,
    stepCount,
    stepReward,
    reward,
    effectiveRate,
  };
}

function isAll(row) {
  return normalizeText(row.searchable) === "all";
}

function matchesQuery(row, query) {
  if (isAll(row)) return true;
  if (!query) return false;

  return row.normalizedTerms.some((term) => (
    term.includes(query) || query.includes(term)
  ));
}

function getPrice() {
  const value = Number.parseInt(elements.price.value, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function makeBadge(kind) {
  if (kind === "all") {
    return `<span class="badge badge-all">ALL</span>`;
  }
  return `<span class="badge badge-match">MATCH</span>`;
}

function renderMethodName(row) {
  const method = escapeHtml(row.method);
  const url = getAffiliateUrl(row.method);

  if (!url) {
    return `<span class="method">${method}</span>`;
  }

  return `
    <a
      class="method method-link"
      href="${escapeHtml(url)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="${method} の申込ページを別タブで開く"
    >${method}</a>
  `;
}

function render() {
  const query = normalizeText(elements.shop.value);
  const price = getPrice();

  const results = rows
    .filter((row) => matchesQuery(row, query))
    .map((row) => ({
      ...row,
      calculation: calculateReward(row, price),
      all: isAll(row),
    }))
    .sort((a, b) => {
      const rewardDiff = b.calculation.reward - a.calculation.reward;
      if (Math.abs(rewardDiff) > 0.000001) return rewardDiff;
      const rateDiff = b.calculation.effectiveRate - a.calculation.effectiveRate;
      if (Math.abs(rateDiff) > 0.000001) return rateDiff;
      return a.index - b.index;
    });

  elements.count.textContent = `${results.length}件`;
  elements.empty.hidden = results.length !== 0;

  if (results.length === 0) {
    elements.list.innerHTML = "";
    return;
  }

  elements.list.innerHTML = results.map((row) => {
    const calc = row.calculation;
    const parts = [];
    if (row.rate !== 0) {
      parts.push(
        `通常: ${formatYen(price)} × ${formatPercent(row.rate)} = ${formatYen(calc.baseReward)}円`,
      );
    }
    if (row.truncateRate !== 0 && row.truncateUnit > 0) {
      parts.push(
        `切捨: ${formatInt(price)}//${formatInt(row.truncateUnit)} × ${formatInt(row.truncateUnit)} × ${formatPercent(row.truncateRate)} = ${formatYen(calc.stepReward)}円`,
      );
    }
    const formula = parts.join(" / ");
    const formulaHtml = formula ? `<div class="formula">${formula}</div>` : "";

    return `
      <li class="result-item ${row.all ? "" : "match"}">
        <div class="main-info">
          <div class="method-row">
            ${renderMethodName(row)}
            ${makeBadge(row.all ? "all" : "match")}
          </div>
          <div class="shop">${escapeHtml(row.shop)}（検索用: ${escapeHtml(row.searchable)}）</div>
          ${formulaHtml}
        </div>
        <div class="reward-box" aria-label="還元額">
          <div>
            <div class="reward">${formatYen(calc.reward)}円</div>
            <div class="reward-label">還元額</div>
          </div>
          <div class="rate">実質 ${formatPercent(calc.effectiveRate)}</div>
        </div>
      </li>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
}

async function init() {
  try {
    const [shopResponse, affResponse] = await Promise.all([
      fetch(SHOP_CSV_URL, { cache: "no-cache" }),
      fetch(AFF_CSV_URL, { cache: "no-cache" }),
    ]);

    if (!shopResponse.ok) {
      throw new Error(`shop.csvの読み込みに失敗しました (${shopResponse.status})`);
    }
    if (!affResponse.ok) {
      throw new Error(`aff.csvの読み込みに失敗しました (${affResponse.status})`);
    }

    const [shopCsvText, affCsvText] = await Promise.all([
      shopResponse.text(),
      affResponse.text(),
    ]);
    rows = parseShopRows(shopCsvText);
    affiliates = parseAffiliateRows(affCsvText);

    elements.shop.addEventListener("input", render);
    elements.price.addEventListener("input", render);

    render();
    setStatus(
      `準備完了: ${rows.length}件の支払い方法 / ${affiliates.length}件のリンクを読み込みました`,
      "ok",
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "読み込みに失敗しました", "warn");
  }

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (error) {
      console.warn("Service Worker registration failed", error);
      setStatus("オンライン表示は可能ですが、オフライン機能の登録に失敗しました", "warn");
    }
  }
}

init();
