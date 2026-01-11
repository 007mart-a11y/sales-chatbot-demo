// netlify/functions/search.mjs
export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const { message, thread_id, mode, site_context } = await request.json();

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Missing message" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID_MAIN = process.env.ASSISTANT_ID;      // HLAVNÍ / SALES
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO;  // DEMO

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const selectedMode = mode === "demo" ? "demo" : "main";
    const assistant_id = selectedMode === "demo" ? ASSISTANT_ID_DEMO : ASSISTANT_ID_MAIN;

    if (!assistant_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: selectedMode === "demo"
            ? "Missing ASSISTANT_ID_DEMO"
            : "Missing ASSISTANT_ID",
        }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };

    // 1) THREAD
    let tid = thread_id;
    if (!tid) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      const threadText = await threadRes.text();
      let threadJson = {};
      try { threadJson = threadText ? JSON.parse(threadText) : {}; } catch {}

      if (!threadRes.ok || !threadJson.id) {
        return new Response(
          JSON.stringify({ ok: false, error: "Thread create failed", details: threadText }),
          { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      }

      tid = threadJson.id;
    }

    // 2) USER MESSAGE (už bez přidávání webu do textu)
    const addMsgRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    });

    if (!addMsgRes.ok) {
      const t = await addMsgRes.text();
      return new Response(JSON.stringify({ ok: false, error: "Add message failed", details: t }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // 3) RUN (DEMO dostane web přes additional_instructions)
    const additional_instructions =
      (selectedMode === "demo" && site_context && typeof site_context === "string" && site_context.trim())
        ? `KONTEXT Z WEBU (homepage / shrnutí):\n${site_context}\n\n` +
          `Pravidla:\n` +
          `- Odpovídej jako chatbot této firmy.\n` +
          `- Drž se kontextu. Když info není v kontextu, řekni to stručně a navrhni doplňující otázku.\n` +
          `- Nesbírej kontakt, neuzavírej poptávku.\n`
        : "";

    const runRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id,
        additional_instructions,
      }),
    });

    const runText = await runRes.text();
    let runJson = {};
    try { runJson = runText ? JSON.parse(runText) : {}; } catch {}

    if (!runRes.ok || !runJson.id) {
      return new Response(JSON.stringify({ ok: false, error: "Run create failed", details: runText }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const runId = runJson.id;

    // 4) POLL
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let status = runJson.status;

    for (let i = 0; i < 60; i++) {
      if (status === "completed") break;
      if (["failed", "cancelled", "expired"].includes(status)) break;

      await sleep(500);

      const pollRes = await fetch(`https://api.openai.com/v1/threads/${tid}/runs/${runId}`, {
        method: "GET",
        headers,
      });

      const pollText = await pollRes.text();
      let pollJson = {};
      try { pollJson = pollText ? JSON.parse(pollText) : {}; } catch {}

      if (!pollRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: "Run poll failed", details: pollText }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      status = pollJson.status;
    }

    if (status !== "completed") {
      return new Response(
        JSON.stringify({ ok: false, error: "Run not completed", details: status, thread_id: tid }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // 5) READ ANSWER
    const msgsRes = await fetch(`https://api.openai.com/v1/threads/${tid}/messages?limit=10`, {
      method: "GET",
      headers,
    });

    const msgsText = await msgsRes.text();
    let msgsJson = {};
    try { msgsJson = msgsText ? JSON.parse(msgsText) : {}; } catch {}

    if (!msgsRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Read messages failed", details: msgsText }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const items = msgsJson.data || [];
    const lastAssistant = items.find((m) => m.role === "assistant");

    let answer = "";
    if (lastAssistant && Array.isArray(lastAssistant.content)) {
      answer = lastAssistant.content
        .filter((p) => p.type === "text" && p.text?.value)
        .map((p) => p.text.value)
        .join("\n\n")
        .trim();
    }

    return new Response(JSON.stringify({ ok: true, answer: answer || "", thread_id: tid }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unhandled error", details: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
