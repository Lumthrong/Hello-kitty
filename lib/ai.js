const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CHAT_MODEL = process.env.CHAT_MODEL || "openai/gpt-oss-120b";
const FAST_MODEL = process.env.FAST_MODEL || "llama-3.1-8b-instant";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.AI_API_KEY}`
  };
}

export async function streamChat({ systemPrompt, messages, onToken }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 200,
      temperature: 0.7,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    })
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          full += token;
          onToken?.(token);
        }
      } catch {}
    }
  }

  return full;
}

export async function extractMemory({ existingFacts, transcript }) {
  const factList = existingFacts.length
    ? existingFacts.map(f => `- ${f}`).join("\n")
    : "(empty)";

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: FAST_MODEL,
      max_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are a memory extractor for a cute AI companion.\n` +
            `Return ONLY JSON: { "facts": ["..."], "summary": "..." | null }\n` +
            `Facts: only NEW, durable details about the user (name, age, pets, hobbies, likes/dislikes, important people, ongoing situations). Max 3. No greetings, no mood-of-the-moment, no duplicates of existing memory.\n` +
            `Summary: one short sentence about what was just discussed, or null if trivial.`
        },
        {
          role: "user",
          content: `Existing memory:\n${factList}\n\nRecent conversation:\n${transcript}`
        }
      ]
    })
  });

  if (!res.ok) return { facts: [], summary: null };
  const data = await res.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter(f => typeof f === "string" && f.trim())
        : [],
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : null
    };
  } catch {
    return { facts: [], summary: null };
  }
}

export async function summarizeHistory({ existingSummary, messages }) {
  const transcript = messages
    .map(m => `${m.role === "user" ? "User" : "Kitty"}: ${m.content}`)
    .join("\n");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: FAST_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Compress the conversation into 2–3 short sentences preserving only what matters for future continuity. Return plain text, no preamble."
        },
        {
          role: "user",
          content: `${existingSummary ? `Previous summary: ${existingSummary}\n\n` : ""}New conversation:\n${transcript}`
        }
      ]
    })
  });

  if (!res.ok) return existingSummary || "";
  const data = await res.json();
  return data.choices[0].message.content.trim();
}