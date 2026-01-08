import OpenAI from "openai";

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok:false, error:"Method not allowed" }), {
        status:405,
        headers:{ "content-type":"application/json" }
      });
    }

    const { message } = await request.json();
    if(!message){
      return new Response(JSON.stringify({ ok:false, error:"Missing message" }), {
        status:400,
        headers:{ "content-type":"application/json" }
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
        { role: "user", content: message }
      ]
    });

    return new Response(JSON.stringify({
      ok:true,
      answer: response.output_text
    }), {
      status:200,
      headers:{ "content-type":"application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      ok:false,
      error:"Server error",
      details:String(err)
    }), {
      status:500,
      headers:{ "content-type":"application/json" }
    });
  }
};
