// netlify/functions/scrape.mjs
export default async (request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "content-type": "application/json; charset=utf-8",
  };

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: corsHeaders });

  const normalizeUrl = (input) => {
    let url = String(input || "").trim();
    if (!url) throw new Error("Missing url");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    // drop hash
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString();
    } catch {
      throw new Error("URL is not valid");
    }
  };

  const fetchText = async (url, ms = 12000) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const text = await res.text();
      return { res, text };
    } finally {
      clearTimeout(t);
    }
  };

  const pick = (html, re) => {
    const m = html.match(re);
    return m && m[1] ? String(m[1]).replace(/\s+/g, " ").trim() : "";
  };

  const decode = (s) =>
    String(s || "")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");

  const cleanInline = (s) =>
    decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  const htmlToText = (html) => {
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ");

    text = decode(text)
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  };

  const buildSummary = (url, html) => {
    const title = cleanInline(pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const metaDesc =
      cleanInline(
        pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
      ) ||
      cleanInline(
        pick(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)
      );

    const headings = [];
    for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) headings.push(m[1]);
    for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) headings.push(m[1]);

    const hText = headings.map(cleanInline).filter(Boolean).slice(0, 12);

    const parts = [];
    if (title) parts.push(`TITLE: ${title}`);
    if (metaDesc) parts.push(`META: ${metaDesc}`);
    if (hText.length) parts.push(`HEADINGS:\n- ${hText.join("\n- ")}`);
    parts.push(`URL: ${url}`);
    return parts.filter(Boolean).join("\n");
  };

  const clamp = (s, max = 12000) => {
    const t = String(s || "");
    return t.length > max ? t.slice(0, max) + "\n…(zkráceno)" : t;
  };

  try {
    if (request.method === "OPTIONS")
      return new Response("", { status: 204, headers: corsHeaders });

    if (request.method !== "POST")
      return json({ ok: false, error: "Method not allowed" }, 405);

    const body = await request.json().catch(() => ({}));
    const url = normalizeUrl(body.url);

    // 1) pokus: direct fetch
    let directOk = false;
    let directHtml = "";
    let finalText = "";

    try {
      const { res, text } = await fetchText(url, 12000);
      directHtml = text || "";
      if (res.ok && directHtml.length > 200) {
        directOk = true;
        const summary = buildSummary(res.url || url, directHtml);
        const cleaned = htmlToText(directHtml);
        finalText =
          cleaned && cleaned.length >= 200
            ? `${summary}\n\n${cleaned}`
            : summary;
      }
    } catch {
      // ignore -> fallback
    }

    // 2) fallback: jina.ai (pomůže když web blokuje fetch z Netlify nebo je JS-only)
    if (!finalText || finalText.length < 200) {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const { res, text } = await fetchText(jinaUrl, 12000);

      if (!res.ok || !text || text.trim().length < 80) {
        return json(
          {
            ok: false,
            error: "Failed to fetch site",
            details: {
              directOk,
              directHtmlSample: directHtml.slice(0, 200),
              jinaStatus: res.status,
              jinaStatusText: res.statusText,
              jinaSample: String(text || "").slice(0, 300),
            },
          },
          502
        );
      }

      // jina už vrací text → jen lehce oříznout a doplnit URL nahoře
      finalText = `URL: ${url}\n\n` + text.trim();
    }

    finalText = clamp(finalText, 12000);

    return json(
      { ok: true, url, text: finalText, meta: { chars: finalText.length, source: directOk ? "direct" : "jina" } },
      200
    );
  } catch (err) {
    return json(
      { ok: false, error: "Scrape crashed", details: String(err?.message || err) },
      500
    );
  }
};
