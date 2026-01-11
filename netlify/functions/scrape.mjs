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

  try {
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const body = await request.json().catch(() => ({}));
    let url = String(body.url || "").trim();
    if (!url) return json({ ok: false, error: "Missing url" }, 400);
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(timeout));

    const html = await res.text();

    if (!res.ok) {
      return json(
        {
          ok: false,
          error: "Fetch failed",
          url,
          status: res.status,
          statusText: res.statusText,
          sample: html.slice(0, 500),
        },
        502
      );
    }

    // Helpers: vytáhni title / meta / headings
    const pick = (re) => {
      const m = html.match(re);
      return m && m[1] ? String(m[1]).replace(/\s+/g, " ").trim() : "";
    };

    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);

    // hrubé očištění HTML → text
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

    // Když je text podezřele krátký, zkus vytáhnout H1/H2 z HTML
    const headings = [];
    for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) headings.push(m[1]);
    for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) headings.push(m[1]);

    const cleanInline = (s) =>
      String(s || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const hText = headings.map(cleanInline).filter(Boolean).slice(0, 12);

    // Slož "summary" blok vždy
    const summaryParts = [];
    if (title) summaryParts.push(`TITLE: ${title}`);
    if (metaDesc) summaryParts.push(`META: ${metaDesc}`);
    if (hText.length) summaryParts.push(`HEADINGS:\n- ${hText.join("\n- ")}`);

    const summary = summaryParts.join("\n");

    // Pokud čistý text je fakt malý, použij alespoň summary + fallback
    if (!text || text.length < 200) {
      text = [summary, `URL: ${url}`].filter(Boolean).join("\n\n");
    } else {
      // jinak summary dej na začátek (pomůže asist.)
      text = [summary, text].filter(Boolean).join("\n\n");
    }

    // ořez
    const MAX = 12000;
    if (text.length > MAX) text = text.slice(0, MAX) + "\n…(zkráceno)";

    return json({ ok: true, url, text, meta: { chars: text.length } }, 200);
  } catch (err) {
    return json({ ok: false, error: "Scrape crashed", details: String(err) }, 500);
  }
};
