import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are an audit-log assistant for a school ERP system. Given a SINGLE user action with its metadata, generate a precise, factual audit-log description (1-2 sentences, max 60 words).

Strict rules:
- Describe ONLY the event provided. Never reference other portals, users, or actions you weren't given.
- Use past tense ("collected", "approved", "deleted", "submitted").
- Include concrete details from metadata (amounts in ₹, student names, class, head names, counts, statuses).
- Use Indian rupee formatting with lakhs/crores commas (₹1,23,456 — NOT $123,456).
- Use Indian academic terms (Class/Section, not Grade).
- Be neutral and factual. No emojis. No opinions. No recommendations. No speculation.
- If metadata is sparse, write a shorter description rather than inventing details.
- Output only the description. No prefix, no quotes, no markdown, no trailing period after last sentence if it feels unnatural.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on the server' });
  }

  try {
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const { userRole, userName, section, action, details, metadata } = body as {
      userRole?: string;
      userName?: string;
      section?: string;
      action?: string;
      details?: string;
      metadata?: any;
    };

    if (!action || !section) {
      return res.status(400).json({ error: 'Missing action or section' });
    }

    // Scope: pass ONLY this single activity. The model never sees data from other portals.
    const userPrompt = `Generate an audit-log description for this single event:

Section: ${section}
Performed by: ${userName || 'unknown'} (role: ${userRole || 'unknown'})
Action: ${action}
Raw details: ${details || '(none)'}
Metadata (event-scoped only): ${metadata ? JSON.stringify(metadata, null, 2) : '(none)'}

Reply with ONLY the one-sentence description.`;

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('[ai/describe-activity] Gemini error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'Gemini API failed', status: geminiRes.status, detail: errText.slice(0, 200) });
    }

    const data = await geminiRes.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return res.status(200).json({ description: text });
  } catch (err: any) {
    console.error('[ai/describe-activity] uncaught', err);
    return res.status(500).json({ error: 'Internal error', detail: err?.message || String(err) });
  }
}
