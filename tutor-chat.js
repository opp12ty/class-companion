// Netlify serverless function: calls Google's Gemini API server-side so the
// API key is never exposed to students in the browser.
//
// Gemini has a genuine FREE tier (no credit card required, Flash model),
// which is why this build uses it instead of a paid API. Free tiers are
// rate-limited per day — see the README for what that means in practice.
//
// Requires an environment variable set in the Netlify site dashboard:
//   GEMINI_API_KEY = your key from https://aistudio.google.com/apikey
// (Site settings -> Environment variables -> Add a variable)

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server is missing GEMINI_API_KEY. Add it in Netlify: Site settings > Environment variables."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { system, messages } = payload;
  if (!system || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing system prompt or messages" }) };
  }

  // Gemini expects {role, parts:[{text}]} with roles "user" / "model"
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const model = "gemini-2.5-flash";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent?key=" +
    apiKey;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: contents,
        generationConfig: { maxOutputTokens: 600 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data.error ? data.error.message : "Gemini API error";
      // Friendly message if the free daily limit has been hit
      if (response.status === 429) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reply:
              "The free tutor quota for today has been used up by the class. Please try again tomorrow, or ask your teacher — this happens because we're on the free tier for now."
          })
        };
      }
      return { statusCode: response.status, body: JSON.stringify({ error: message }) };
    }

    const candidate = (data.candidates || [])[0];
    const parts = candidate && candidate.content && candidate.content.parts ? candidate.content.parts : [];
    const reply = parts.map((p) => p.text || "").join("\n").trim() || "Sorry, I couldn't process that.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error reaching the tutor. Please try again." })
    };
  }
};
