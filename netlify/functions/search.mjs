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

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: message
    });

    // 🔑 TOTO JE KLÍČ – oficiální helper
    const answer = response.output_text;

    return new Response(
      JSON.stringify({
        ok: true,
        answer: answer || "Asistent nevrátil odpověď."
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
