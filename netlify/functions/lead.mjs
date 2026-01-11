export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
    if (!SHEETS_WEBAPP_URL) throw new Error("Missing SHEETS_WEBAPP_URL");

    const payload = await request.json();

    const r = await fetch(SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    return new Response(JSON.stringify({ ok: true, status: r.status, body: text }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "Lead failed", details: err?.message || String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
