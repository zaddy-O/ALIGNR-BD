export default {
  async fetch(request, env, ctx) {
    // 1. CORS Preflight Rules
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY configuration variable." }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const requestData = await request.json();
      const incomingMessage = requestData.message || "";
      
      // Determine if the frontend is executing Call 1 or Call 2
      let systemInstruction = "";
      let isStepTwo = incomingMessage.includes("slide") || incomingMessage.includes("structure") || incomingMessage.includes("template");

      if (!isStepTwo) {
        // AI CALL 1: Core Strategy Analysis
        systemInstruction = `You are a corporate strategy analyst. Analyze the user's text and extract the raw business strategic positioning, challenges, and core opportunities. Output clear, professional prose analysis. Do not output JSON.`;
      } else {
        // AI CALL 2: Presentation Layout Map
        systemInstruction = `You are a business presentation architect. Take the analysis provided and map it into a single structured JSON object matching this exact schema layout. Do not wrap output in markdown code fences.
        
        {
          "cover": { "title": "String", "subtitle": "String" },
          "snapshot": { "overview": "String", "coreChallenge": "String", "strategicFocus": "String" },
          "strengths": { "items": ["String", "String"] },
          "gaps": { "items": ["String", "String"] },
          "marketOpportunity": { "size": "String", "drivers": ["String"] },
          "quickWins": { "items": ["String", "String"] },
          "marketingStrategy": { "channels": ["String"], "positioning": "String" },
          "technology": { "infrastructure": "String", "tools": ["String"] },
          "financials": { "revenueProjection": "String", "paybackPeriod": "String" },
          "investment": { "capitalRequired": "String", "allocation": "String" }
        }`;
      }

      const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

      const geminiPayload = {
        contents: [{
          parts: [{ text: `${systemInstruction}\n\nUser Input Context:\n${incomingMessage}` }]
        }],
        generationConfig: {
          responseMimeType: isStepTwo ? "application/json" : "text/plain"
        }
      };

      const aiResponse = await fetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        throw new Error(`Google API Error: ${aiResponse.status} - ${errorText}`);
      }

      const aiData = await aiResponse.json();
      let generatedText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      generatedText = generatedText.replace(/```json/gi, '').replace(/```/g, '').trim();

      const responsePayload = {
        choices: [{
          message: {
            role: "assistant",
            content: generatedText
          }
        }]
      };

      if (isStepTwo) {
        try {
          const parsedJSON = JSON.parse(generatedText);
          Object.assign(responsePayload, parsedJSON);
        } catch (jsonErr) {
          const defaultStructure = {
            cover: { title: "Strategic Overview", subtitle: "Consulting Playbook" },
            snapshot: { overview: "Analysis complete.", coreChallenge: "Operational bounds.", strategicFocus: "Optimization." },
            strengths: { items: ["Market positioning"] }, gaps: { items: ["Scale constraints"] },
            marketOpportunity: { size: "Expanding Sector", drivers: ["Digital transformation"] },
            quickWins: { items: ["Optimize workflows"] }, marketingStrategy: { channels: ["Direct"], positioning: "Premium" },
            technology: { infrastructure: "Serverless Architecture", tools: ["Cloud Platforms"] },
            financials: { revenueProjection: "Consistent Growth", paybackPeriod: "Near-Term Return" },
            investment: { capitalRequired: "Pending Allocation", allocation: "Platform Optimization" }
          };
          Object.assign(responsePayload, defaultStructure);
          responsePayload.choices[0].message.content = JSON.stringify(defaultStructure);
        }
      }

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Pipeline Fault", details: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
