export async function handler(event) {
  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url) {
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Missing url" }) };
    }

    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 DemoBot"
      }
    });

    const html = await res.text();

    // velmi jednoduché čištění HTML
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000); // limit kvůli rychlosti

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        context: text
      })
    };

  } catch (e) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: false,
        context: "",
        error: String(e)
      })
    };
  }
}
