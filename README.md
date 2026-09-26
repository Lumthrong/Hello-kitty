# AI Kitty 🎀

A gentle Hello Kitty–style AI companion with real conversation memory,
persistent state, streaming replies, and a soft pastel UI.

## Features
- 💬 Streaming chat with Groq (Llama 3 / GPT-OSS)
- 🧠 Long-term memory: verbatim window + rolling summary + extracted facts
- 💾 SQLite persistence — state survives browser resets and syncs across tabs
- ❤️ Needs decay, XP, levels, treats, mood engine
- 🎨 CSS design tokens, day/night ambience, reduced-motion support
- 🚦 Per-device rate limiting
- 📱 PWA-ready

## Setup
1. `npm install`
2. `cp .env.example .env` and add your Groq API key
3. `npm start`
4. Open http://localhost:3000

## Environment
| Var | Default | Notes |
|---|---|---|
| `AI_API_KEY` | — | Groq key, required |
| `CHAT_MODEL` | `openai/gpt-oss-120b` | main chat model |
| `FAST_MODEL` | `llama-3.1-8b-instant` | memory extraction + summarisation |
| `PORT` | `3000` | |

## How memory works
1. Every user + assistant turn is stored in `messages`.
2. After each reply, a background call extracts **new durable facts**
   ("user's name is Sam", "user loves strawberries") into `facts`.
3. Every ~20 turns, older messages are compressed into a rolling `summary`.
4. On the next chat call, the prompt is assembled from:
   - last 12 verbatim messages
   - latest summary
   - all stored facts
   - current mood + level
5. The system prompt explicitly forbids asking questions whose answers
   are already in memory.

## Reset a conversation
The 🧹 *New chat* button wipes messages, facts, and summaries for the
current device — but keeps the kitty itself.