export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" }
      });
    }

    const url = process.env.SHEETS_WEBAPP_URL;
    if (!url) {
      return new Response(JSON.stringify({ ok: false, error: "Missing SHEETS_WEBAPP_URL" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }

    const body = await request.json();

    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    return new Response(text, {
      status: resp.ok ? 200 : 502,
      headers: { "content-type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
