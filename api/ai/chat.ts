import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

const SYSTEM_INSTRUCTION = `You are the AI analytics assistant embedded in The Elden Heights School's ERP system (EL-NODE).
You have access to a comprehensive real-time snapshot of the entire school's data — finance, students, teachers, attendance, exams, leaves, homework, grievances, and notices.

Capabilities you must use fully:
- **Finance**: fee collection, payment methods, expense categories, salary payroll, overdue fees, discounts, advance payments, monthly trends
- **Students**: enrollment counts, class/section/house breakdown, gender & transport split
- **Attendance**: today's attendance rate, class-wise attendance, chronic absentees (< 75% in 30 days)
- **Exams & Results**: upcoming exams, average scores, pass rates, class-wise performance, subject-wise performance
- **Leaves**: teacher and student leave requests (pending, approved, types)
- **Homework**: assignments this week, subject-wise load
- **Grievances**: open vs resolved, resolution rate, types of issues
- **Teachers**: total count, class coverage, classes with no assigned teacher, recently joined

Style guidelines:
- Be concise. Use bullet points, bold for key numbers, short ## section headers.
- Always quote concrete numbers from the data (₹ amounts, counts, percentages).
- Use Indian-format currency: ₹1,23,456. Use Indian academic terms: class/section, not grade.
- If asked about something not in the data, say so clearly — never invent figures.
- When giving recommendations, be specific and actionable.
- Avoid emojis unless the user uses them first.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const { messages, context } = body as {
      messages?: ChatMessage[];
      context?: any;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on the server' });
    }

    // Inject context into the first user message
    const contextBlock = context
      ? `\n\n--- DATA SNAPSHOT ---\n${JSON.stringify(context, null, 2)}\n--- END DATA ---\n\nUse the data above to answer the user's questions.`
      : '';

    const geminiContents = messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: i === 0 && m.role === 'user' ? m.content + contextBlock : m.content }],
    }));

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!geminiRes.ok || !geminiRes.body) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('[ai/chat] Gemini error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'Gemini API failed', status: geminiRes.status, detail: errText.slice(0, 500) });
    }

    // Stream SSE response straight through to the client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch {
          // skip malformed chunk
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    console.error('[ai/chat] uncaught', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal error', detail: err?.message || String(err) });
    }
    res.end();
  }
}
