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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const normalizeUrl = (raw) => {
    let url = String(raw || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return url;
  };

  const truncate = (s, max) => {
    const t = String(s || "");
    if (t.length <= max) return t;
    return t.slice(0, max) + "\n…(zkráceno)";
  };

  // ---- Direct fetch scrape (HTML -> text) ----
  async function directScrape(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timeout));

    const html = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        sample: html.slice(0, 500),
      };
    }

    const pick = (re) => {
      const m = html.match(re);
      return m && m[1] ? String(m[1]).replace(/\s+/g, " ").trim() : "";
    };

    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);

    // HTML -> text
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    // Headings fallback
    const headings = [];
    for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) headings.push(m[1]);
    for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) headings.push(m[1]);

    const cleanInline = (s) =>
      String(s || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const hText = headings.map(cleanInline).filter(Boolean).slice(0, 12);

    const summaryParts = [];
    if (title) summaryParts.push(`TITLE: ${title}`);
    if (metaDesc) summaryParts.push(`META: ${metaDesc}`);
    if (hText.length) summaryParts.push(`HEADINGS:\n- ${hText.join("\n- ")}`);

    const summary = summaryParts.join("\n").trim();

    // Když je text moc krátký, pořád vrať aspoň něco
    if (!text || text.length < 200) {
      text = [summary, `URL: ${url}`].filter(Boolean).join("\n\n").trim();
    } else if (summary) {
      text = [summary, text].join("\n\n").trim();
    }

    return { ok: true, text };
  }

  // ---- Jina fallback (returns readable text) ----
  async function jinaScrape(url) {
    // r.jina.ai/<url>
    // supports both http and https; keep original scheme
    const jinaUrl = `https://r.jina.ai/${url}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Některé weby se chovají líp s malým delay
    await sleep(150);

    const res = await fetch(jinaUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Jina je proxy – tady user-agent není tak kritický
        Accept: "text/plain,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timeout));

    const txt = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        sample: txt.slice(0, 500),
      };
    }

    // Jina občas vrací hodně balastu, ale většinou použitelné.
    let text = String(txt || "").trim();
    return { ok: true, text };
  }

  try {
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const body = await request.json().catch(() => ({}));
    const url = normalizeUrl(body.url);
    if (!url) return json({ ok: false, error: "Missing url" }, 400);

    // 1) direct
    const direct = await directScrape(url);

    // Heuristika: kdy jít na fallback
    const directText = direct.ok ? String(direct.text || "") : "";
    const shouldFallback =
      !direct.ok ||
      !directText ||
      directText.length < 400 || // moc krátké = často blok / prázdno
      /access denied|forbidden|cloudflare|captcha|verify you are human/i.test(directText);

    let finalText = direct.ok ? directText : "";
    let used = direct.ok ? "direct" : "direct_failed";

    // 2) fallback jina
    if (shouldFallback) {
      const jina = await jinaScrape(url);
      if (jina.ok && String(jina.text || "").trim().length > 200) {
        finalText = String(jina.text || "").trim();
        used = "jina";
      } else if (!direct.ok) {
        // direct fail + jina fail
        return json(
          {
            ok: false,
            error: "Scrape failed (direct + jina)",
            url,
            direct,
            jina,
          },
          502
        );
      }
    }

    // Ořez
    const MAX = 12000;
    finalText = truncate(finalText, MAX);

    return json(
      {
        ok: true,
        url,
        text: finalText,
        meta: {
          chars: finalText.length,
          used,
          direct_ok: !!direct.ok,
        },
      },
      200
    );
  } catch (err) {
    return json({ ok: false, error: "Scrape crashed", details: String(err) }, 500);
  }
};
