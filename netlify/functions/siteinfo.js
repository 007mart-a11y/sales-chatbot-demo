// netlify/functions/siteinfo.js

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function normalizeUrl(input) {
  const raw = (input || "").toString().trim();
  if (!raw) throw new Error("Missing url");

  let u = raw;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;

  const parsed = new URL(u);
  parsed.hash = "";
  return parsed.toString();
}

function guessCompanyName(url, title) {
  try {
    if (title) return title.split("|")[0].split("-")[0].trim().slice(0, 60);
    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = host.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Vaše firma";
  }
}

function clip(s, n) {
  return (s || "").toString().slice(0, n);
}

function cleanupText(s) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

// r.jina.ai umí:
// https://r.jina.ai/http://example.com
// https://r.jina.ai/https://example.com
function toJina(url) {
  const u = new URL(url);
  return `https://r.jina.ai/${u.protocol}//${u.host}${u.pathname}${u.search}`;
}

function extractTitle(markdownText) {
  // jina často vrací něco jako "# Title" na začátku
  const lines = (markdownText || "").split("\n").map((x) => x.trim());
  const h1 = lines.find((l) => l.startsWith("# "));
  if (h1) return h1.replace(/^#\s+/, "").trim().slice(0, 140);

  // fallback: první neprázdný řádek
  const first = lines.find((l) => l.length > 3);
  return (first || "").slice(0, 140);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    // umožníme i GET pro rychlý test:
    // /.netlify/functions/siteinfo?url=https://...
    let inputUrl = "";
    if (event.httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      inputUrl = qs.url || "";
    } else if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      inputUrl = body.url || "";
    } else {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const normalized = normalizeUrl(inputUrl);
    const jinaUrl = toJina(normalized);

    // Timeout trošku větší – jina bývá rychlá
    const { res, text } = await fetchWithTimeout(jinaUrl, 20000);

    if (!res.ok) {
      return json(502, {
        ok: false,
        error: "Failed to load via jina",
        details: { status: res.status, statusText: res.statusText },
      });
    }

    const cleaned = cleanupText(text);

    // Z toho uděláme krátký „site_context“ pro demo asistenta (tokenově)
    const title = extractTitle(cleaned);
    const companyName = guessCompanyName(normalized, title);

    // Konkrétní „shrnutí“ (hlava + výcuc textu)
    const summary =
      `URL: ${normalized}\n` +
      (title ? `Název: ${title}\n` : "") +
      `Obsah webu (výcuc):\n` +
      clip(cleaned, 6000);

    return json(200, {
      ok: true,
      url: normalized,
      companyName,
      title: title || "",
      summary, // <- tohle posílej do search.mjs jako site_context
    });
  } catch (e) {
    return json(500, { ok: false, error: "Failed to fetch site", details: String(e?.message || e) });
  }
};
