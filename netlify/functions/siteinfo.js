// netlify/functions/siteinfo.js
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(statusCode, obj) {
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

  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error("URL is not valid");
  }

  parsed.hash = "";
  return parsed.toString();
}

function decodeEntities(s) {
  return (s || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripTags(s) {
  return (s || "").replace(/<[^>]*>/g, " ");
}

function pickTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().slice(0, 140) : "";
}

function pickMetaDescription(html) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]*>/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*>/i);

  if (!m) return "";
  const tag = m[0];
  const c = tag.match(/content=["']([^"']+)["']/i);
  return c ? decodeEntities(c[1]).trim().slice(0, 320) : "";
}

function pickH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? decodeEntities(stripTags(m[1])).trim().slice(0, 180) : "";
}

function cleanText(html) {
  let t = (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]*>/g, " ");

  t = decodeEntities(t);
  t = t.replace(/\s+/g, " ").trim();

  // oříznutí aby to nebylo megadlouhé
  return t.slice(0, 7000);
}

function guessCompanyName(url, title, h1) {
  try {
    const cand = (h1 || "").trim() || (title || "").trim();
    if (cand) return cand.split("|")[0].split("-")[0].trim().slice(0, 60);

    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = host.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Vaše firma";
  }
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DemoSiteInfo/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const html = await res.text();

    return { res, html, contentType };
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const normalized = normalizeUrl(body.url);

    // 1) primárně zkus https (už je normalizované)
    let out;
    try {
      out = await fetchWithTimeout(normalized, 12000);
    } catch (e) {
      // 2) fallback: zkus http (některé weby mají divné redirecty)
      const tryHttp = normalized.replace(/^https:\/\//i, "http://");
      out = await fetchWithTimeout(tryHttp, 12000);
    }

    const { res, html, contentType } = out;

    if (!res.ok) {
      return resp(502, {
        ok: false,
        error: "Site returned non-OK status",
        details: { status: res.status, statusText: res.statusText },
      });
    }

    if (!contentType.includes("text/html")) {
      return resp(422, {
        ok: false,
        error: "URL did not return HTML",
        details: { contentType: contentType || "unknown" },
      });
    }

    const clipped = (html || "").slice(0, 300000);

    const title = pickTitle(clipped);
    const desc = pickMetaDescription(clipped);
    const h1 = pickH1(clipped);
    const text = cleanText(clipped);

    const summary = [
      title ? `Title: ${title}` : "",
      desc ? `Popis: ${desc}` : "",
      h1 ? `H1: ${h1}` : "",
      text ? `Text: ${text.slice(0, 2800)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const finalUrl = res.url || normalized;
    const companyName = guessCompanyName(finalUrl, title, h1);

    return resp(200, {
      ok: true,
      url: finalUrl,
      companyName,
      title: title || "",
      description: desc || "",
      h1: h1 || "",
      summary,
    });
  } catch (e) {
    return resp(500, {
      ok: false,
      error: "Failed to fetch site",
      details: String(e?.message || e),
    });
  }
};
