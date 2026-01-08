export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed" }),
        { status: 405, headers: { "content-type": "application/json" } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const message = body.message;

    if (!message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing message" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.ASSISTANT_ID;

    if (!apiKey || !assistantId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing env variables" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    /* 1️⃣ vytvoříme thread */
    const threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      }
    });

    const thread = await threadRes.json();

    /* 2️⃣ pošleme zprávu */
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({
        role: "user",
        content: message
      })
    });

    /* 3️⃣ spustíme asistenta */
    const runRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/runs`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2"
        },
        body: JSON.stringify({
          assistant_id: assistantId
        })
      }
    );

    let run = await runRes.json();

    /* 4️⃣ počkáme na dokončení */
    while (run.status !== "completed" && run.status !== "failed") {
      await new Promise(r => setTimeout(r, 500));

      const check = await fetch(
        `https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`,
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "OpenAI-Beta": "assistants=v2"
          }
        }
      );

      run = await check.json();
    }

    if (run.status === "failed") {
      throw new Error("Assistant run failed");
    }

    /* 5️⃣ načteme odpověď */
    const messagesRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/messages`,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "OpenAI-Beta": "assistants=v2"
        }
      }
    );

    const messages = await messagesRes.json();
    const assistantMsg = messages.data.find(m => m.role === "assistant");

    const answer =
      assistantMsg?.content?.[0]?.text?.value ||
      "Asistent nevrátil odpověď.";

    return new Response(
      JSON.stringify({ ok: true, answer }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Server error",
        details: String(err.message || err)
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
