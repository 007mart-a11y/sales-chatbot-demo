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
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]*>/g, " ");

  t = decodeEntities(t);
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 7000);
}

function guessCompanyName(url, title) {
  try {
    if (title) return title.split("|")[0].split("-")[0].trim().slice(0, 50);
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
        "User-Agent":
          "Mozilla/5.0 (compatible; DemoSiteInfo/1.0; +https://example.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();
    return { res, html };
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

    // 1) pokus: normal
    let out;
    try {
      out = await fetchWithTimeout(normalized, 12000);
    } catch (e) {
      // 2) fallback: když je https problém, zkus http (některé weby to divně přesměrují)
      const tryHttp = normalized.replace(/^https:\/\//i, "http://");
      out = await fetchWithTimeout(tryHttp, 12000);
    }

    const { res, html } = out;

    if (!res.ok) {
      return resp(502, {
        ok: false,
        error: "Site returned non-OK status",
        details: { status: res.status, statusText: res.statusText },
      });
    }

    const clipped = html.slice(0, 250000);

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

    const companyName = guessCompanyName(res.url || normalized, title);

    return resp(200, {
      ok: true,
      url: res.url || normalized,
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
