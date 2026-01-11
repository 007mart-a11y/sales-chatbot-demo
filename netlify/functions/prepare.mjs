// netlify/functions/demo_prepare.mjs
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return m ? m[1].trim() : "";
}

function extractThemeColor(html) {
  const m = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return m ? m[1].trim() : "";
}

async function fetchWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Missing url" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!ASSISTANT_ID_DEMO) {
      return new Response(JSON.stringify({ ok: false, error: "Missing ASSISTANT_ID_DEMO" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Normalize URL
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

    // Fetch homepage HTML
    const pageRes = await fetchWithTimeout(normalized, 12000);
    if (!pageRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Web fetch failed", details: pageRes.status }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const html = await pageRes.text();
    const title = extractTitle(html);
    const desc = extractMetaDescription(html);
    const themeColor = extractThemeColor(html);

    // Extract text and cap
    const rawText = stripHtml(html);
    const cappedText = rawText.length > 18000 ? rawText.slice(0, 18000) : rawText;

    // Use Assistants DEMO to create short structured summary
    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    const threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const threadJson = await threadRes.json();
    const tid = threadJson.id;

    const prompt =
      `Z textu webu vytvoř krátké SHRNUJÍCÍ "karty" pro DEMO chatbot.\n` +
      `Cíl: aby chatbot odpovídal jako zákaznická podpora a rozuměl, co firma dělá.\n\n` +
      `Vrať to v češtině, maximálně 1200 znaků, strukturovaně:\n` +
      `1) Název firmy / brand (pokud jde vyčíst)\n` +
      `2) Co firma dělá (1–2 věty)\n` +
      `3) Typické služby / nabídka (3–6 bodů)\n` +
      `4) Typické dotazy zákazníků (3 body)\n` +
      `5) Jak odpovídat: stručně, konkrétně, bez vymýšlení. Když info není na webu, tak to přiznej a zeptej se.\n\n` +
      `TEXT WEBU:\n${cappedText}`;

    await fetch(`https://api.openai.com/v1/threads/${tid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: prompt }),
    });

    const runRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: ASSISTANT_ID_DEMO }),
    });
    const runJson = await runRes.json();
    const runId = runJson.id;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let status = runJson.status;

    for (let i = 0; i < 60; i++) {
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled" || status === "expired") break;
      await sleep(500);

      const pollRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs/${runId}`, {
        method: "GET",
        headers,
      });
      const pollJson = await pollRes.json();
      status = pollJson.status;
    }

    if (status !== "completed") {
      return new Response(JSON.stringify({ ok: false, error: "Summarize not completed", details: status }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const msgsRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages?limit=10`, {
      method: "GET",
      headers,
    });
    const msgsJson = await msgsRes.json();
    const lastAssistant = (msgsJson.data || []).find((m) => m.role === "assistant");
    const summary = lastAssistant?.content?.[0]?.text?.value || "";

    // derive a friendly name
    const siteName = title || desc || normalized.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

    return new Response(
      JSON.stringify({
        ok: true,
        url: normalized,
        site_name: siteName,
        meta_title: title,
        meta_description: desc,
        theme_color: themeColor || "",
        summary,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unhandled error", details: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
