// netlify/functions/search-demo.mjs
export default async (request) => {
  try {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "content-type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    if (!ASSISTANT_ID_DEMO) {
      return new Response(JSON.stringify({ ok: false, error: "Missing ASSISTANT_ID_DEMO" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const body = await request.json().catch(() => ({}));
    const message = String(body.message || body.query || "").trim();
    const incomingThreadId = String(body.thread_id || "").trim();

    // context ze scrapu homepage (frontend si ho uloží do localStorage a posílá sem)
    let context = String(body.context || "").trim();

    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: "Missing message" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // omezíme délku kontextu, ať to zbytečně nebobtná
    const MAX_CONTEXT_CHARS = 9000;
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "\n…(zkráceno)";
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    // 1) Thread: použij existující, nebo vytvoř nový
    let thread_id = incomingThreadId;
    if (!thread_id) {
      const tRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const tJson = await tRes.json();
      if (!tRes.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: "Failed to create thread", details: tJson }),
          { status: 502, headers: corsHeaders }
        );
      }
      thread_id = tJson.id;
    }

    // 2) Přidej user message do threadu (DEMO instrukce + kontext + dotaz)
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
    const mJson = await mRes.json();
    if (!mRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to add message", details: mJson, thread_id }),
        { status: 502, headers: corsHeaders }
      );
    }

    // 3) Spusť run (DEMO asistent)
    const rRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: ASSISTANT_ID_DEMO }),
    });
    const rJson = await rRes.json();
    if (!rRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create run", details: rJson, thread_id }),
        { status: 502, headers: corsHeaders }
      );
    }

    // 4) Polling do dokončení
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
      last = await rr.json();
      if (!rr.ok) break;
      status = last.status;
    }

    if (status !== "completed") {
      return new Response(
        JSON.stringify({ ok: false, error: "Run did not complete", status, details: last, thread_id }),
        { status: 502, headers: corsHeaders }
      );
    }

    // 5) Načti poslední odpověď asistenta
    const listRes = await fetch(`https://api.openai.com/v1/threads/${thread_id}/messages?limit=20`, {
      method: "GET",
      headers,
    });
    const listJson = await listRes.json();
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to read messages", details: listJson, thread_id }),
        { status: 502, headers: corsHeaders }
      );
    }

    const items = Array.isArray(listJson.data) ? listJson.data : [];
    const lastAssistant = items.find((x) => x.role === "assistant");

    let answer = "";
    if (lastAssistant?.content?.length) {
      answer = lastAssistant.content?.[0]?.text?.value || "";
    }

    return new Response(JSON.stringify({ ok: true, answer, thread_id }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
