// netlify/functions/search-demo.mjs
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

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;

    if (!OPENAI_API_KEY) return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);
    if (!ASSISTANT_ID_DEMO) return json({ ok: false, error: "Missing ASSISTANT_ID_DEMO" }, 500);

    const body = await request.json().catch(() => ({}));
    const message = String(body.message || body.query || "").trim();
    const incomingThreadId = String(body.thread_id || "").trim();
    let context = String(body.context || "").trim();

    if (!message) return json({ ok: false, error: "Missing message" }, 400);

    const MAX_CONTEXT_CHARS = 9000;
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "\n…(zkráceno)";
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    // 1) thread
    let thread_id = incomingThreadId;
    if (!thread_id) {
      const tRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const tJson = await tRes.json().catch(() => ({}));
      if (!tRes.ok) return json({ ok: false, error: "Failed to create thread", details: tJson }, 502);
      thread_id = tJson.id;
    }

    // 2) message
    const demoUserMessage = `
Jsi DEMO chatbot (ukázka). Neptej se na kontakt, neuzavírej poptávku, nepiš "děkuji, mám vše".
Odpovídej podle kontextu webu. Když něco v kontextu není, řekni to narovinu a navrhni, co doplnit.

KONTEXT WEBU (homepage):
${context || "(KONTEXT NENÍ K DISPOZICI – odpověz obecně a navrhni co dodat.)"}

DOTAZ UŽIVATELE:
${message}
`.trim();

    const mRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: demoUserMessage }),
    });
    const mJson = await mRes.json().catch(() => ({}));
    if (!mRes.ok) {
      return json({ ok: false, error: "Failed to add message", details: mJson, thread_id }, 502);
    }

    // 3) run
    const rRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: ASSISTANT_ID_DEMO }),
    });
    const rJson = await rRes.json().catch(() => ({}));
    if (!rRes.ok) {
      return json({ ok: false, error: "Failed to create run", details: rJson, thread_id }, 502);
    }

    // 4) poll
    const run_id = rJson.id;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    let status = rJson.status;
    let last = rJson;

    for (let i = 0; i < 30; i++) {
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled" || status === "expired") break;

      await sleep(700);

      const rr = await fetch(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, {
        method: "GET",
        headers,
      });
      last = await rr.json().catch(() => ({}));
      if (!rr.ok) break;
      status = last.status;
    }

    if (status !== "completed") {
      return json({ ok: false, error: "Run did not complete", status, details: last, thread_id }, 502);
    }

    // 5) read messages
    const listRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/messages?limit=20`, {
      method: "GET",
      headers,
    });
    const listJson = await listRes.json().catch(() => ({}));
    if (!listRes.ok) {
      return json({ ok: false, error: "Failed to read messages", details: listJson, thread_id }, 502);
    }

    const items = Array.isArray(listJson.data) ? listJson.data : [];
    const lastAssistant = items.find((x) => x.role === "assistant");

    let answer = "";
    if (lastAssistant?.content?.length) {
      // někdy může být více částí, vezmeme první textovou
      const part = lastAssistant.content.find((p) => p.type === "text") || lastAssistant.content[0];
      answer = part?.text?.value || "";
    }

    return json({ ok: true, answer, thread_id }, 200);
  } catch (err) {
    // DŮLEŽITÉ: i tady CORS, ať to uvidíš ve frontendu
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
};
