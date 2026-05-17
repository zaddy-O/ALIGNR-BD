// _worker.js — Cloudflare Pages Advanced Mode
// Proxies /api/chat to Google Gemini API (free tier, no credit card needed).
// Translates Gemini response format to match Anthropic format so the app
// works without any changes to the front-end HTML.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ─────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Proxy /api/chat to Gemini ──────────────────────────────────────────
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return json({
          error: 'GEMINI_API_KEY is not set. Go to Cloudflare Pages → Settings → Environment Variables and add your Google Gemini API key.'
        }, 500);
      }

      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'Invalid JSON body' }, 400); }

      if (!body.messages || !Array.isArray(body.messages)) {
        return json({ error: 'Missing messages array' }, 400);
      }

      // ── Convert Anthropic message format → Gemini format ─────────────────
      // Anthropic: [{role: "user", content: "text"}]
      // Gemini:    [{role: "user", parts: [{text: "text"}]}]
      const geminiContents = body.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => c.text || '').join('') }]
      }));

      // Use gemini-2.5-flash — best free tier model (1500 req/day, fast)
      const model = 'gemini-2.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const maxTokens = body.max_tokens || 8000;

      try {
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
            },
          }),
        });

        const geminiData = await geminiRes.json();

        if (!geminiRes.ok) {
          // Surface Gemini error clearly
          const errMsg = geminiData?.error?.message || JSON.stringify(geminiData);
          return json({ error: 'Gemini API error: ' + errMsg }, geminiRes.status);
        }

        // ── Translate Gemini response → Anthropic response shape ───────────
        // So the front-end HTML (which parses Anthropic format) works unchanged.
        // Gemini: candidates[0].content.parts[0].text
        // Anthropic: content[0].text
        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const anthropicShape = {
          id: 'gemini-' + Date.now(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text }],
          model: model,
          stop_reason: geminiData?.candidates?.[0]?.finishReason || 'end_turn',
        };

        return new Response(JSON.stringify(anthropicShape), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });

      } catch (err) {
        return json({ error: 'Proxy error: ' + err.message }, 502);
      }
    }

    // ── All other requests: serve static assets ────────────────────────────
    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
