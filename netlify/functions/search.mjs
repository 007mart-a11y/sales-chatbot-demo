// netlify/functions/search.mjs
export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { message, thread_id, mode, site_context } = await request.json();

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Missing message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_MAIN = process.env.ASSISTANT_ID;
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const selectedMode = mode === "demo" ? "demo" : "main";
    const assistant_id =
      selectedMode === "demo" ? ASSISTANT_ID_DEMO : ASSISTANT_ID_MAIN;

    if (!assistant_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            selectedMode === "demo"
              ? "Missing ASSISTANT_ID_DEMO"
              : "Missing ASSISTANT_ID",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
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

      if (!threadRes.ok) {
        const t = await threadRes.text();
        return new Response(JSON.stringify({ ok: false, error: "Thread create failed", details: t }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      const threadJson = await threadRes.json();
      tid = threadJson.id;
    }

    // 2) Add user message (prepend site context for DEMO if available)
    let finalMessage = message;

    if (selectedMode === "demo" && site_context && typeof site_context === "string") {
      // Kontext dáme dopředu, ale krátce (aby se to dalo tokenově)
      finalMessage =
        `KONTEXT Z WEBU (shrnutí):\n${site_context}\n\n` +
        `DOTAZ ZÁKAZNÍKA:\n${message}`;
    }

    const addMsgRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "user",
        content: finalMessage,
      }),
    });

    if (!addMsgRes.ok) {
      const t = await addMsgRes.text();
      return new Response(JSON.stringify({ ok: false, error: "Add message failed", details: t }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3) Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id,
      }),
    });

    if (!runRes.ok) {
      const t = await runRes.text();
      return new Response(JSON.stringify({ ok: false, error: "Run create failed", details: t }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const runJson = await runRes.json();
    const runId = runJson.id;

    // 4) Poll until completed
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let status = runJson.status;

    for (let i = 0; i < 60; i++) {
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled" || status === "expired") {
        break;
      }
      await sleep(500);

      const pollRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs/${runId}`, {
        method: "GET",
        headers,
      });

      if (!pollRes.ok) {
        const t = await pollRes.text();
        return new Response(JSON.stringify({ ok: false, error: "Run poll failed", details: t }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      const pollJson = await pollRes.json();
      status = pollJson.status;
    }

    if (status !== "completed") {
      return new Response(
        JSON.stringify({ ok: false, error: "Run not completed", details: status, thread_id: tid }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5) Get last assistant message
    const msgsRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages?limit=10`, {
      method: "GET",
      headers,
    });

    if (!msgsRes.ok) {
      const t = await msgsRes.text();
      return new Response(JSON.stringify({ ok: false, error: "Read messages failed", details: t }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const msgsJson = await msgsRes.json();
    const items = msgsJson.data || [];

    const lastAssistant = items.find((m) => m.role === "assistant");
    const answer =
      lastAssistant?.content?.[0]?.text?.value ||
      "Omlouvám se, nepodařilo se získat odpověď.";

    return new Response(JSON.stringify({ ok: true, answer, thread_id: tid }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unhandled error", details: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
