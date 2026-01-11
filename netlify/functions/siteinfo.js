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
  let u = (input || "").trim();
  if (!u) throw new Error("Missing url");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return new URL(u).toString();
}

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function pick(re, html, max = 200) {
  const m = html.match(re);
  return m ? m[1].trim().slice(0, max) : "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const { url } = JSON.parse(event.body || "{}");
    const target = normalizeUrl(url);

    const res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (DemoBot)",
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      return resp(502, { ok: false, error: "Non-OK response", status: res.status });
    }

    const html = await res.text();

    const title = pick(/<title[^>]*>(.*?)<\/title>/i, html, 120);
    const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, html, 300);
    const h1 = pick(/<h1[^>]*>(.*?)<\/h1>/i, html, 150);
    const text = strip(html);

    return resp(200, {
      ok: true,
      url: res.url,
      title,
      description: desc,
      h1,
      summary: [
        title && `Title: ${title}`,
        desc && `Popis: ${desc}`,
        h1 && `H1: ${h1}`,
        `Text: ${text}`,
      ].filter(Boolean).join("\n"),
    });
  } catch (e) {
    return resp(500, {
      ok: false,
      error: "Failed to fetch site",
      details: String(e.message || e),
    });
  }
};
