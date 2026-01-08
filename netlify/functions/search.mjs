import OpenAI from "openai";

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

    if (!process.env.ASSISTANT_ID) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing ASSISTANT_ID" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // 1️⃣ vytvoříme thread (konverzaci)
    const thread = await client.beta.threads.create();

    // 2️⃣ pošleme zprávu uživatele
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message
    });

    // 3️⃣ spustíme asistenta
    const run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID
    });

    // 4️⃣ počkáme na dokončení
    let status = run.status;
    let runResult = run;

    while (status !== "completed" && status !== "failed") {
      await new Promise((r) => setTimeout(r, 500));
      runResult = await client.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );
      status = runResult.status;
    }

    if (status === "failed") {
      throw new Error("Assistant run failed");
    }

    // 5️⃣ vytáhneme poslední odpověď asistenta
    const messages = await client.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find(
      (m) => m.role === "assistant"
    );

    const answer =
      lastMessage?.content?.[0]?.text?.value ||
      "Asistent nevrátil odpověď.";

    return new Response(
      JSON.stringify({
        ok: true,
        answer
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Server error",
        details: String(err?.message || err)
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
