export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const { message, thread_id, mode } = await request.json();

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID = process.env.ASSISTANT_ID; // SALES / HLAVNÍ
    const ASSISTANT_ID_DEMO = process.env.ASSISTANT_ID_DEMO; // DEMO

    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    if (!ASSISTANT_ID) throw new Error("Missing ASSISTANT_ID (sales)");
    if (!ASSISTANT_ID_DEMO) throw new Error("Missing ASSISTANT_ID_DEMO (demo)");

    const cleanMode = mode === "sales" ? "sales" : "demo";
    const assistantId = cleanMode === "sales" ? ASSISTANT_ID : ASSISTANT_ID_DEMO;

    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "openai-beta": "assistants=v2",
    };

    // 1) THREAD
    let activeThreadId = thread_id;
    if (!activeThreadId) {
      const tRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const tJson = await tRes.json();
      if (!tRes.ok) throw new Error(`Thread create failed: ${JSON.stringify(tJson)}`);
      activeThreadId = tJson.id;
    }

    // 2) MESSAGE
    const mRes = await fetch(`https://api.openai.com/v1/threads/${activeThreadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "user",
        content: String(message || "").slice(0, 6000),
      }),
    });
    const mJson = await mRes.json();
    if (!mRes.ok) throw new Error(`Message create failed: ${JSON.stringify(mJson)}`);

    // 3) RUN
    const rRes = await fetch(`https://api.openai.com/v1/threads/${activeThreadId}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: assistantId }),
    });
    const rJson = await rRes.json();
    if (!rRes.ok) throw new Error(`Run create failed: ${JSON.stringify(rJson)}`);

    // 4) POLL
    const runId = rJson.id;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 800));

      const sRes = await fetch(
        `https://api.openai.com/v1/threads/${activeThreadId}/runs/${runId}`,
        { method: "GET", headers }
      );
      const sJson = await sRes.json();
      if (!sRes.ok) throw new Error(`Run status failed: ${JSON.stringify(sJson)}`);

      if (sJson.status === "completed") break;
      if (["failed", "cancelled", "expired"].includes(sJson.status)) {
        throw new Error(`Run ${sJson.status}: ${JSON.stringify(sJson)}`);
      }
      if (i === 59) throw new Error("Run timeout");
    }

    // 5) READ ANSWER
    const listRes = await fetch(
      `https://api.openai.com/v1/threads/${activeThreadId}/messages?limit=10`,
      { method: "GET", headers }
    );
    const listJson = await listRes.json();
    if (!listRes.ok) throw new Error(`Messages list failed: ${JSON.stringify(listJson)}`);

    const lastAssistant = (listJson.data || []).find((m) => m.role === "assistant");
    let answer = "";
    if (lastAssistant && Array.isArray(lastAssistant.content)) {
      answer = lastAssistant.content
        .filter((p) => p.type === "text" && p.text?.value)
        .map((p) => p.text.value)
        .join("\n\n")
        .trim();
    }

    return new Response(
      JSON.stringify({ ok: true, answer, thread_id: activeThreadId, mode: cleanMode }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Search failed",
        details: err?.message || String(err),
      }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
};
