// netlify/functions/search.mjs
export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID = process.env.ASSISTANT_ID;

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    if (!ASSISTANT_ID) {
      return new Response(JSON.stringify({ ok: false, error: "Missing ASSISTANT_ID" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await request.json().catch(() => ({}));
    const userMessage = (body.message || body.query || "").toString().trim();
    const incomingThreadId = (body.thread_id || "").toString().trim();

    if (!userMessage) {
      return new Response(JSON.stringify({ ok: false, error: "Missing message" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    // 1) Thread: použij existující, nebo vytvoř nový
    let threadId = incomingThreadId;
    if (!threadId) {
      const t = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const tJson = await t.json();
      if (!t.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: "Failed to create thread", details: tJson }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
      }
      threadId = tJson.id;
    }

    // 2) Přidej user message do threadu
    const m = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "user",
        content: userMessage,
      }),
    });
    const mJson = await m.json();
    if (!m.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to add message", details: mJson, thread_id: threadId }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    // 3) Spusť run
    const r = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
      }),
    });
    const rJson = await r.json();
    if (!r.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create run", details: rJson, thread_id: threadId }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    // 4) Polling dokud run neskončí
    const runId = rJson.id;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    let status = rJson.status;
    let lastRunJson = rJson;

    for (let i = 0; i < 30; i++) {
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled" || status === "expired") break;

      await sleep(700);

      const rr = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        method: "GET",
        headers,
      });
      lastRunJson = await rr.json();
      if (!rr.ok) break;
      status = lastRunJson.status;
    }

    if (status !== "completed") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Run did not complete",
          status,
          details: lastRunJson,
          thread_id: threadId,
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    // 5) Vytáhni poslední odpověď asistenta z thread messages
    const msgs = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=20`, {
      method: "GET",
      headers,
    });
    const msgsJson = await msgs.json();
    if (!msgs.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to read messages", details: msgsJson, thread_id: threadId }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const items = Array.isArray(msgsJson.data) ? msgsJson.data : [];
    const lastAssistant = items.find((x) => x.role === "assistant");

    // content může být pole; typicky text
    let answer = "";
    if (lastAssistant?.content?.length) {
      const part = lastAssistant.content[0];
      answer = part?.text?.value || "";
    }

    return new Response(JSON.stringify({ ok: true, answer, thread_id: threadId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
