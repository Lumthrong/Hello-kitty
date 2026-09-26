import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  getUserByToken,
  getState,
  updateState,
  addMessage,
  getRecentMessages,
  getMessagesBefore,
  getFacts,
  addFact,
  getLatestSummary,
  saveSummary,
  countMessagesAfter,
  resetUser,
  getCosmetics,
  setCosmetics
} from "./lib/db.js";
import { streamChat, extractMemory, summarizeHistory } from "./lib/ai.js";
import { buildSystemPrompt } from "./lib/prompt.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ */
/* rate limiter (per device token)                                     */
/* ------------------------------------------------------------------ */
const buckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;

function rateLimit(req, res, next) {
  const token = req.deviceToken;
  const now = Date.now();
  const b = buckets.get(token) || { count: 0, reset: now + RATE_WINDOW_MS };
  if (now > b.reset) {
    b.count = 0;
    b.reset = now + RATE_WINDOW_MS;
  }
  b.count++;
  buckets.set(token, b);
  if (b.count > RATE_MAX) {
    return res
      .status(429)
      .json({ reply: "Kitty needs a tiny nap 🐱 try again in a minute." });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* device token middleware                                             */
/* ------------------------------------------------------------------ */
function ensureDevice(req, res, next) {
  let token = req.headers["x-device-token"] || req.body?.deviceToken;
  if (typeof token !== "string" || token.length < 8 || token.length > 128) {
    token = crypto.randomBytes(24).toString("hex");
  }
  req.deviceToken = token;
  res.setHeader("x-device-token", token);
  req.user = getUserByToken(token);
  next();
}

/* ------------------------------------------------------------------ */
/* needs decay                                                         */
/* ------------------------------------------------------------------ */
const clamp = v => Math.max(0, Math.min(100, v));

function applyDecay(userId) {
  const s = getState(userId);
  const now = Date.now();
  const elapsed = now - s.last_decay;
  if (elapsed < 1000) return s;

  const minutes = elapsed / 60000;
  const hunger = clamp(s.hunger - minutes * 0.5);
  const fun = clamp(s.fun - minutes * 0.3);
  const social = clamp(s.social - minutes * 0.4);

  let mood = "neutral";
  if (social < 30) mood = "clingy";
  else if (fun < 20) mood = "bored";
  else if (fun > 70 && social > 70) mood = "happy";

  updateState(userId, { hunger, fun, social, mood, last_decay: now });
  return { ...s, hunger, fun, social, mood };
}

/* ------------------------------------------------------------------ */
/* streaming chat                                                      */
/* ------------------------------------------------------------------ */
app.post("/api/chat", ensureDevice, rateLimit, async (req, res) => {
  const raw = req.body?.message;
  if (typeof raw !== "string" || !raw.trim()) {
    return res.json({ reply: "Say something to Kitty 🐱" });
  }
  const text = raw.trim().slice(0, 500);
  const userId = req.user.id;

  const state = applyDecay(userId);
  addMessage(userId, "user", text);
  updateState(userId, { last_interaction: Date.now() });

  const facts = getFacts(userId);
  const summary = getLatestSummary(userId)?.content || "";
  const recent = getRecentMessages(userId, 12).map(m => ({
    role: m.role,
    content: m.content
  }));

  const systemPrompt = buildSystemPrompt({
    mood: state.mood,
    facts,
    summary,
    level: state.level
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let full = "";
  try {
    full = await streamChat({
      systemPrompt,
      messages: recent,
      onToken: t => send("token", { t })
    });
  } catch (err) {
    console.error("streamChat:", err.message);
    send("error", { message: "Kitty couldn't think right now 🐱" });
    return res.end();
  }

  const replyText = full.trim() || "…🐱";
  const msgId = addMessage(userId, "assistant", replyText);

  const s = getState(userId);
  const newXp = s.xp + 5;
  updateState(userId, {
    social: clamp(s.social + 6),
    fun: clamp(s.fun + 4),
    xp: newXp >= 100 ? 0 : newXp,
    level: newXp >= 100 ? s.level + 1 : s.level
  });

  send("done", { reply: replyText, state: getState(userId) });
  res.end();

  runMemoryPipeline(userId, msgId).catch(err =>
    console.error("memory pipeline:", err.message)
  );
});

/* ------------------------------------------------------------------ */
/* background memory updates                                           */
/* ------------------------------------------------------------------ */
async function runMemoryPipeline(userId, lastMessageId) {
  const recent = getRecentMessages(userId, 6);
  if (recent.length < 2) return;

  const transcript = recent
    .map(m => `${m.role === "user" ? "User" : "Kitty"}: ${m.content}`)
    .join("\n");

  const existingFacts = getFacts(userId);
  const { facts } = await extractMemory({ existingFacts, transcript });
  for (const f of facts) addFact(userId, f.trim());

  const latest = getLatestSummary(userId);
  const coversUpTo = latest?.covers_up_to_message_id || 0;
  if (countMessagesAfter(userId, coversUpTo) >= 20) {
    const older = getMessagesBefore(userId, lastMessageId, 30);
    if (older.length) {
      const compressed = await summarizeHistory({
        existingSummary: latest?.content || "",
        messages: older
      });
      if (compressed) saveSummary(userId, compressed, lastMessageId);
    }
  }
}

/* ------------------------------------------------------------------ */
/* state + actions                                                     */
/* ------------------------------------------------------------------ */
app.get("/api/state", ensureDevice, (req, res) => {
  const state = applyDecay(req.user.id);
  res.json({ ...state, cosmetics: getCosmetics(req.user.id) });
});

app.post("/api/action", ensureDevice, rateLimit, (req, res) => {
  const { action } = req.body || {};
  const userId = req.user.id;
  const s = applyDecay(userId);

  if (action === "feed") {
    if (s.treats <= 0) return res.json({ ok: false, reply: "Need treats 💔" });
    updateState(userId, {
      treats: s.treats - 1,
      hunger: clamp(s.hunger + 20),
      last_interaction: Date.now()
    });
    return res.json({ ok: true, reply: "Yummy 🍰", state: getState(userId) });
  }

  if (action === "pet") {
    const xp = s.xp + 10;
    const leveledUp = xp >= 100;
    updateState(userId, {
      treats: s.treats + 1,
      fun: clamp(s.fun + 6),
      social: clamp(s.social + 4),
      xp: leveledUp ? 0 : xp,
      level: leveledUp ? s.level + 1 : s.level,
      mood: "excited",
      last_interaction: Date.now()
    });
    return res.json({ ok: true, leveledUp, state: getState(userId) });
  }

  res.status(400).json({ ok: false });
});

app.post("/api/reset", ensureDevice, (req, res) => {
  resetUser(req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* cosmetics                                                           */
/* ------------------------------------------------------------------ */
const ALLOWED = {
  bow: ["pink", "blue", "star", "flower", "none"],
  outfit: ["none", "dress", "overalls", "sweater", "princess", "pajamas"],
  accessory: ["none", "necklace", "glasses"]
};

app.get("/api/cosmetics", ensureDevice, (req, res) => {
  res.json(getCosmetics(req.user.id));
});

app.post("/api/cosmetics", ensureDevice, (req, res) => {
  const current = getCosmetics(req.user.id);
  const next = { ...current };
  for (const key of ["bow", "outfit", "accessory"]) {
    const val = req.body?.[key];
    if (typeof val === "string" && ALLOWED[key].includes(val)) {
      next[key] = val;
    }
  }
  setCosmetics(req.user.id, next);
  res.json(next);
});

/* ------------------------------------------------------------------ */
app.listen(PORT, () => {
  console.log(`🎀 Kitty running on http://localhost:${PORT}`);
});