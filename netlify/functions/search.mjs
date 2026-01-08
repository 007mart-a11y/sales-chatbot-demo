import OpenAI from "openai";

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const { message } = await request.json().catch(() => ({}));
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Missing message" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Jsi testovací chatbot asistent pro firmy. " +
            "Odpovídej srozumitelně, prakticky a stručně. " +
            "Nevymýšlej si informace a klidně přiznej nejistotu."
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    // ✅ SPRÁVNÉ VYTAŽENÍ ODPOVĚDI
    let answer = "Bez odpovědi";

    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === "message" && item.content) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) {
              answer = part.text;
              break;
            }
          }
        }
        if (answer !== "Bez odpovědi") break;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      answer
    }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Server error",
      details: String(err?.message || err)
    }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
