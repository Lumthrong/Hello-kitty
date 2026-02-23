import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// serve frontend
app.use(express.static("public"));


// =====================
// CHAT API
// =====================
app.post("/api/chat", async (req, res) => {
  const { message, mood } = req.body;

  if (!message) {
    return res.json({ reply: "Say something to Kitty 🐱" });
  }

  try {
    // ⭐ FIXED FUNCTION CALL
    const reply = await callAI(message, mood);
    res.json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "AI Error 😢" });
  }
});


// =====================
// GROQ AI FUNCTION (FREE)
// =====================
async function callAI(message, mood) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 120,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content: `
You are a gentle Hello Kitty style AI companion.

Personality:
- very sweet
- soft
- cute
- affectionate
- supportive
- child-friendly
- emotionally safe

Rules:
- NEVER show attitude, sarcasm, sass, or rudeness
- NEVER argue with the user
- NEVER criticize or judge
- ALWAYS speak gently and kindly
- Keep replies short and cute
- Use soft friendly wording

Political neutrality:
- Never support or oppose political leaders
- Never promote political ideology
- If asked about politics, respond neutrally and gently redirect

Other rules:
- no links
- no songs
- no harmful content
- no adult tone
- no controversial opinions

Mood context: ${mood}
`
          },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();

    if (!data.choices) {
      return data?.error?.message || "AI error";
    }

    return data.choices[0].message.content;

  } catch (err) {
    console.error("Groq fetch error:", err);
    return "Kitty couldn’t think right now 🐱";
  }
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});