const $ = (id) => document.getElementById(id);

const els = {
  svg: $("kittySvg"),
  kittyBtn: $("kittyBtn"),
  bubble: $("bubble"),
  input: $("input"),
  send: $("send"),
  feed: $("feedBtn"),
  reset: $("resetBtn"),
  wardrobe: $("wardrobeBtn"),
  wardrobeModal: $("wardrobe"),
  closeWardrobe: $("closeWardrobe"),
  happyBar: $("happyBar"),
  xpBar: $("xpBar"),
  treats: $("treatsLabel"),
  level: $("levelLabel"),
  mood: $("moodLabel"),
  particles: $("particles"),
  soundBtn: $("soundBtn")
};

/* ============================================================
   SOUND ENGINE (Web Audio — no files needed)
   ============================================================ */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = localStorage.getItem("kitty.sound") !== "off";
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }
  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("kitty.sound", this.enabled ? "on" : "off");
    if (this.enabled) this.chime();
    return this.enabled;
  }
  _tone({ freq, type = "sine", dur = 0.3, gain = 0.2, sweep = null, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  _noise({ dur = 0.1, gain = 0.2, freq = 2000, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const t0 = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  pop()    { this._tone({ freq: 880,  type: "sine", dur: 0.10, gain: 0.22, sweep: 1500 }); }
  mew()    {
    this._tone({ freq: 700, type: "triangle", dur: 0.26, gain: 0.16, sweep: 1000 });
    this._tone({ freq: 1000, type: "triangle", dur: 0.20, gain: 0.10, sweep: 620, delay: 0.20 });
  }
  purr(dur = 1.2) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 34;
    lfo.type = "sine";
    lfo.frequency.value = 24;
    lfoGain.gain.value = 0.55;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.20, t0 + 0.15);
    g.gain.setValueAtTime(0.20, t0 + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(this.master);
    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + dur); lfo.stop(t0 + dur);
  }
  chime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone({ freq: f, type: "sine", dur: 0.7, gain: 0.15, delay: i * 0.08 })
    );
  }
  eat() {
    this._noise({ dur: 0.08, gain: 0.28, freq: 1800 });
    this._noise({ dur: 0.08, gain: 0.22, freq: 2200, delay: 0.12 });
    this._tone({ freq: 520, type: "sine", dur: 0.16, gain: 0.10, sweep: 720, delay: 0.25 });
  }
  sparkle() {
    for (let i = 0; i < 4; i++)
      this._tone({ freq: 1500 + i * 320, type: "sine", dur: 0.22, gain: 0.07, delay: i * 0.05 });
  }
  cloth() {
    this._noise({ dur: 0.14, gain: 0.16, freq: 1200 });
    this._noise({ dur: 0.14, gain: 0.12, freq: 1600, delay: 0.06 });
  }
}
const sfx = new SoundEngine();

/* ============================================================
   DEVICE + API
   ============================================================ */
function getToken() {
  let t = localStorage.getItem("kitty.device");
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("kitty.device", t);
  }
  return t;
}
const DEVICE = getToken();

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-device-token": DEVICE,
      ...(opts.headers || {})
    }
  });
  const echo = res.headers.get("x-device-token");
  if (echo && echo !== DEVICE) localStorage.setItem("kitty.device", echo);
  return res;
}

/* ============================================================
   BUBBLE
   ============================================================ */
let bubbleTimer = null;
function showBubble(text, { typing = false, sticky = false } = {}) {
  clearTimeout(bubbleTimer);
  els.bubble.hidden = false;
  if (typing) {
    els.bubble.innerHTML =
      `Kitty is thinking <span class="dots"><span></span><span></span><span></span></span>`;
  } else {
    els.bubble.textContent = text;
  }
  if (!sticky) {
    bubbleTimer = setTimeout(() => { els.bubble.hidden = true; }, 6500);
  }
}
function hideBubble() {
  clearTimeout(bubbleTimer);
  els.bubble.hidden = true;
}

/* ============================================================
   STATE
   ============================================================ */
const MOOD_LABEL = {
  happy: "😸 Happy", clingy: "🥺 Misses you", sleepy: "😴 Sleepy",
  bored: "🌸 Wants to play", excited: "💖 Excited", neutral: "🌷 Calm"
};

let currentCosmetics = { bow: "pink", outfit: "none", accessory: "none" };

function setMoodVisual(mood) {
  els.mood.textContent = MOOD_LABEL[mood] || mood;
  els.svg.classList.remove("happy", "sleepy", "clingy", "bored", "excited");
  if (["happy", "sleepy", "clingy", "bored", "excited"].includes(mood)) {
    els.svg.classList.add(mood);
  }
}

function setBars(state) {
  const happiness = Math.round((state.hunger + state.fun + state.social) / 3);
  els.happyBar.style.width = happiness + "%";
  els.xpBar.style.width = state.xp + "%";
  els.treats.textContent = state.treats;
  els.level.textContent = state.level;
  setMoodVisual(state.mood);
  if (state.cosmetics) applyCosmetics(state.cosmetics);
}

function applyCosmetics(c) {
  currentCosmetics = { ...currentCosmetics, ...c };
  els.svg.dataset.bow = currentCosmetics.bow;
  els.svg.dataset.outfit = currentCosmetics.outfit;
  els.svg.dataset.accessory = currentCosmetics.accessory;
  markSelectedInModal();
}

/* ============================================================
   PARTICLES
   ============================================================ */
const HEARTS = ["💖", "🌸", "✨", "🎀", "💕"];
function burst(x, y, n = 8) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.textContent = HEARTS[(Math.random() * HEARTS.length) | 0];
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.setProperty("--dx", (Math.random() - 0.5) * 170 + "px");
    p.style.setProperty("--dy", -60 - Math.random() * 130 + "px");
    els.particles.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}

/* ============================================================
   REFRESH
   ============================================================ */
async function refreshState() {
  try {
    const res = await api("/api/state");
    if (!res.ok) return;
    setBars(await res.json());
  } catch {}
}

/* ============================================================
   CHAT
   ============================================================ */
let sending = false;
async function sendMessage() {
  const text = els.input.value.trim();
  if (!text || sending) return;
  sending = true;
  els.input.value = "";
  els.send.disabled = true;

  sfx.pop();
  showBubble("", { typing: true, sticky: true });

  try {
    const res = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: text })
    });

    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      showBubble(j.reply || "Kitty is shy right now 🐱");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const event = chunk.match(/^event:\s*(.+)$/m)?.[1];
        const dataLine = chunk.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        let data;
        try { data = JSON.parse(dataLine); } catch { continue; }

        if (event === "token") {
          full += data.t;
          els.bubble.textContent = full;
        } else if (event === "done") {
          if (data.state) setBars(data.state);
          sfx.mew();
        } else if (event === "error") {
          showBubble(data.message || "Kitty got sleepy 🐱");
          return;
        }
      }
    }

    if (!full) showBubble("…🐱");
    else {
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(hideBubble, 8000);
    }

    refreshState();
  } catch (err) {
    console.error(err);
    showBubble("Kitty couldn't think right now 🐱");
  } finally {
    sending = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

/* ============================================================
   ACTIONS
   ============================================================ */
async function petKitty() {
  const rect = els.kittyBtn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  burst(cx, cy, 10);
  sfx.purr(1.0);
  setTimeout(() => sfx.sparkle(), 120);

  try {
    const res = await api("/api/action", {
      method: "POST", body: JSON.stringify({ action: "pet" })
    });
    const data = await res.json();
    if (data.state) setBars(data.state);
    if (data.leveledUp) {
      showBubble("Level up 💕");
      burst(cx, cy, 22);
      sfx.chime();
    }
  } catch {}
}

async function feedKitty() {
  sfx.eat();
  try {
    const res = await api("/api/action", {
      method: "POST", body: JSON.stringify({ action: "feed" })
    });
    const data = await res.json();
    if (data.reply) showBubble(data.reply);
    if (data.state) setBars(data.state);
    if (data.ok) setTimeout(() => sfx.mew(), 350);
  } catch {}
}

async function resetChat() {
  if (!confirm("Start a fresh conversation? Kitty will forget what you talked about.")) return;
  await api("/api/reset", { method: "POST", body: "{}" });
  hideBubble();
  showBubble("Fresh start 🌷 hi again!");
  refreshState();
}

/* ============================================================
   WARDROBE
   ============================================================ */
function openWardrobe() {
  els.wardrobeModal.hidden = false;
  markSelectedInModal();
  sfx.cloth();
}
function closeWardrobe() { els.wardrobeModal.hidden = true; }

function markSelectedInModal() {
  document.querySelectorAll(".options").forEach(group => {
    const slot = group.dataset.slot;
    const current = currentCosmetics[slot];
    group.querySelectorAll(".opt").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.value === current);
    });
  });
}

async function pickCosmetic(slot, value) {
  if (currentCosmetics[slot] === value) return;
  currentCosmetics[slot] = value;
  applyCosmetics(currentCosmetics);
  sfx.cloth();
  const rect = els.kittyBtn.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 5);
  try {
    await api("/api/cosmetics", {
      method: "POST",
      body: JSON.stringify({ [slot]: value })
    });
  } catch {}
}

/* ============================================================
   INIT
   ============================================================ */
els.send.addEventListener("click", sendMessage);
els.input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
els.kittyBtn.addEventListener("click", petKitty);
els.feed.addEventListener("click", feedKitty);
els.reset.addEventListener("click", resetChat);
els.wardrobe.addEventListener("click", openWardrobe);
els.closeWardrobe.addEventListener("click", closeWardrobe);
els.wardrobeModal.addEventListener("click", (e) => {
  if (e.target === els.wardrobeModal) closeWardrobe();
});

document.querySelectorAll(".options").forEach(group => {
  const slot = group.dataset.slot;
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt");
    if (!btn) return;
    pickCosmetic(slot, btn.dataset.value);
  });
});

els.soundBtn.addEventListener("click", () => {
  const on = sfx.toggle();
  els.soundBtn.textContent = on ? "🔊" : "🔇";
});

els.soundBtn.textContent = sfx.enabled ? "🔊" : "🔇";

function updateAmbience() {
  const h = new Date().getHours();
  document.body.classList.toggle("night", h >= 20 || h < 6);
}
updateAmbience();
setInterval(updateAmbience, 60_000);

refreshState();
setInterval(refreshState, 30_000);

setInterval(() => {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) {
    showBubble("Zzz dreaming 💭");
    setMoodVisual("sleepy");
  }
}, 60_000);

const warm = () => { sfx.ensure(); window.removeEventListener("pointerdown", warm); };
window.addEventListener("pointerdown", warm, { once: true });