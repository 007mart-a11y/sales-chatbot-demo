// netlify/functions/search.mjs
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders });

    if (request.method !== "POST") {
      return j({ ok: false, error: "Method not allowed" }, 405);
    }

    const { message, thread_id, mode, site_context } = await request.json();

    if (!message || typeof message !== "string") {
      return j({ ok: false, error: "Missing message" }, 400);
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_MAIN = process.env.ASSISTANT_ID;
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;

    if (!OPENAI_API_KEY) return j({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);

    const selectedMode = mode === "demo" ? "demo" : "main";
    const assistant_id = selectedMode === "demo" ? ASSISTANT_ID_DEMO : ASSISTANT_ID_MAIN;

    if (!assistant_id) {
      return j(
        {
          ok: false,
          error: selectedMode === "demo" ? "Missing ASSISTANT_ID_DEMO" : "Missing ASSISTANT_ID",
        },
        500
      );
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    // 1) Create thread if not provided
    let tid = thread_id;
    if (!tid) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      if (!threadRes.ok) return j({ ok: false, error: "Thread create failed", details: await threadRes.text() }, 500);

      const threadJson = await threadRes.json();
      tid = threadJson.id;
    }

    // 2) Add user message (prepend site context for DEMO if available)
    let finalMessage = message;

    if (selectedMode === "demo" && site_context && typeof site_context === "string") {
      finalMessage = `KONTEXT Z WEBU:\n${site_context}\n\nDOTAZ UŽIVATELE:\n${message}`;
    }

    const addMsgRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: finalMessage }),
    });

    if (!addMsgRes.ok) return j({ ok: false, error: "Add message failed", details: await addMsgRes.text() }, 500);

    // 3) Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id }),
    });

    if (!runRes.ok) return j({ ok: false, error: "Run create failed", details: await runRes.text() }, 500);

    const runJson = await runRes.json();
    const runId = runJson.id;

    // 4) Poll until completed
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

      if (!pollRes.ok) return j({ ok: false, error: "Run poll failed", details: await pollRes.text() }, 500);

      const pollJson = await pollRes.json();
      status = pollJson.status;
    }

    if (status !== "completed") {
      return j({ ok: false, error: "Run not completed", details: status, thread_id: tid }, 500);
    }

    // 5) Get last assistant message
    const msgsRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages?limit=10`, {
      method: "GET",
      headers,
    });

    if (!msgsRes.ok) return j({ ok: false, error: "Read messages failed", details: await msgsRes.text() }, 500);

    const msgsJson = await msgsRes.json();
    const items = msgsJson.data || [];
    const lastAssistant = items.find((m) => m.role === "assistant");
    const answer = lastAssistant?.content?.[0]?.text?.value || "Omlouvám se, nepodařilo se získat odpověď.";

    return j({ ok: true, answer, thread_id: tid }, 200);
  } catch (err) {
    return j({ ok: false, error: "Unhandled error", details: String(err?.message || err) }, 500);
  }
};
