/**
 * TikTok Live TTS - Core Application
 * Full-Stack Client-Side Architecture for OBS & GitHub Pages
 */

const DEFAULT_PROFILES = [
  { key: "default", voice: "es-MX-DaliaNeural", pitch: "+0Hz", rate: "+0%" },
  { key: "!normal", voice: "es-MX-DaliaNeural", pitch: "+0Hz", rate: "+0%" },
  { key: "!hombre", voice: "es-MX-JorgeNeural", pitch: "+0Hz", rate: "+0%" },
  { key: "!jorge", voice: "es-MX-JorgeNeural", pitch: "+0Hz", rate: "+0%" },
  { key: "!enojo", voice: "es-MX-JorgeNeural", pitch: "-12Hz", rate: "+18%" },
  { key: "!risa", voice: "es-MX-DaliaNeural", pitch: "+15Hz", rate: "+12%" },
  { key: "!triste", voice: "es-MX-BeatrizNeural", pitch: "-10Hz", rate: "-15%" },
  { key: "!grave", voice: "es-ES-AlvaroNeural", pitch: "-22Hz", rate: "-8%" },
  { key: "!dross", voice: "es-ES-AlvaroNeural", pitch: "-22Hz", rate: "-8%" },
  { key: "!ardilla", voice: "es-MX-DaliaNeural", pitch: "+35Hz", rate: "+25%" }
];

class AudioQueue {
  constructor(getWorkerUrl, onStateChange) {
    this.queue = [];
    this.isPlaying = false;
    this.currentAudio = null;
    this.timeoutId = null;
    this.getWorkerUrl = getWorkerUrl;
    this.onStateChange = onStateChange;
  }

  enqueue(item) {
    this.queue.push(item);
    this.onStateChange(this.queue, null);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  skipCurrent() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isPlaying = false;
    this.playNext();
  }

  clear() {
    this.queue = [];
    this.skipCurrent();
    this.onStateChange(this.queue, null);
  }

  async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.onStateChange(this.queue, null);
      return;
    }

    this.isPlaying = true;
    const current = this.queue.shift();
    this.onStateChange(this.queue, current);

    const workerUrl = (this.getWorkerUrl() || "").replace(/\/$/, "");
    if (!workerUrl) {
      console.warn("Cloudflare Worker URL no configurada");
      this.playNext();
      return;
    }

    let blobUrl = null;
    try {
      const response = await fetch(`${workerUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: current.text,
          voice: current.voice,
          pitch: current.pitch,
          rate: current.rate
        })
      });

      if (!response.ok) {
        throw new Error(`Worker TTS error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      blobUrl = URL.createObjectURL(blob);

      await new Promise((resolve) => {
        const audio = new Audio(blobUrl);
        this.currentAudio = audio;

        // Timeout de seguridad: maximo 15s por audio
        this.timeoutId = setTimeout(() => {
          console.warn("Audio playback timeout alcanzado (15s)");
          audio.pause();
          resolve();
        }, 15000);

        audio.onended = () => {
          clearTimeout(this.timeoutId);
          resolve();
        };

        audio.onerror = (err) => {
          clearTimeout(this.timeoutId);
          console.error("Error reproduciendo audio:", err);
          resolve();
        };

        audio.play().catch((err) => {
          console.error("Autoplay bloqueado o error:", err);
          clearTimeout(this.timeoutId);
          resolve();
        });
      });
    } catch (err) {
      console.error("Error al procesar audio:", err);
    } finally {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      this.currentAudio = null;
      this.isPlaying = false;
      this.playNext();
    }
  }
}

class App {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.shouldReconnect = false;
    this.profiles = this.loadProfiles();

    // DOM Elements
    this.panel = document.getElementById("control-panel");
    this.inputUser = document.getElementById("tiktok-user");
    this.inputEulerKey = document.getElementById("euler-key");
    this.inputWorkerUrl = document.getElementById("worker-url");
    this.inputGroqKey = document.getElementById("groq-key");
    this.btnToggleConnect = document.getElementById("btn-toggle-connect");
    this.btnSkip = document.getElementById("btn-skip-audio");
    this.btnClear = document.getElementById("btn-clear-queue");
    this.btnTest = document.getElementById("btn-test-tts");
    this.btnHide = document.getElementById("btn-hide-panel");
    this.btnResetProfiles = document.getElementById("btn-reset-profiles");
    this.btnAddProfile = document.getElementById("btn-add-profile");
    this.wsStatus = document.getElementById("ws-status");
    this.queueCount = document.getElementById("queue-count");
    this.nowPlaying = document.getElementById("now-playing");
    this.queueList = document.getElementById("queue-list");
    this.profilesTbody = document.getElementById("profiles-tbody");

    // OBS Elements
    this.ttsPopup = document.getElementById("tts-popup");
    this.popupUser = document.getElementById("popup-user");
    this.popupMsg = document.getElementById("popup-msg");
    this.popupAvatar = document.getElementById("popup-avatar");

    this.audioQueue = new AudioQueue(
      () => this.inputWorkerUrl.value.trim(),
      (queue, current) => this.renderQueueState(queue, current)
    );

    this.init();
  }

  init() {
    this.loadSavedSettings();
    this.renderProfiles();
    this.bindEvents();

    // Modo OBS
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("obs") === "1" || urlParams.get("obs") === "true") {
      this.panel.classList.add("hidden");
      // Autoconectar si tenemos usuario y eulerKey
      if (this.inputUser.value && this.inputEulerKey.value) {
        setTimeout(() => this.connectTikTok(), 800);
      }
    }
  }

  loadSavedSettings() {
    this.inputUser.value = localStorage.getItem("tts_tiktok_user") || "";
    this.inputEulerKey.value = localStorage.getItem("tts_euler_key") || "";
    this.inputWorkerUrl.value = localStorage.getItem("tts_worker_url") || "";
    this.inputGroqKey.value = localStorage.getItem("tts_groq_key") || "";
  }

  saveSettings() {
    localStorage.setItem("tts_tiktok_user", this.inputUser.value.trim());
    localStorage.setItem("tts_euler_key", this.inputEulerKey.value.trim());
    localStorage.setItem("tts_worker_url", this.inputWorkerUrl.value.trim());
    localStorage.setItem("tts_groq_key", this.inputGroqKey.value.trim());
  }

  loadProfiles() {
    try {
      const saved = localStorage.getItem("tts_voice_profiles");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Error cargando perfiles:", e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  }

  saveProfiles() {
    localStorage.setItem("tts_voice_profiles", JSON.stringify(this.profiles));
  }

  renderProfiles() {
    this.profilesTbody.innerHTML = "";
    this.profiles.forEach((p, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="text" data-idx="${index}" data-field="key" value="${p.key}"></td>
        <td><input type="text" data-idx="${index}" data-field="voice" value="${p.voice}"></td>
        <td><input type="text" data-idx="${index}" data-field="pitch" value="${p.pitch}"></td>
        <td><input type="text" data-idx="${index}" data-field="rate" value="${p.rate}"></td>
        <td><button class="btn small danger btn-del-profile" data-idx="${index}">X</button></td>
      `;
      this.profilesTbody.appendChild(tr);
    });
  }

  bindEvents() {
    // Inputs auto-save
    [this.inputUser, this.inputEulerKey, this.inputWorkerUrl, this.inputGroqKey].forEach(inp => {
      inp.addEventListener("change", () => this.saveSettings());
    });

    // Toggle Connect
    this.btnToggleConnect.addEventListener("click", () => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        this.disconnectTikTok();
      } else {
        this.saveSettings();
        this.connectTikTok();
      }
    });

    // Botones de cola
    this.btnSkip.addEventListener("click", () => this.audioQueue.skipCurrent());
    this.btnClear.addEventListener("click", () => this.audioQueue.clear());

    // Prueba de TTS
    this.btnTest.addEventListener("click", () => {
      this.processChatMessage("UsuarioDemo", "!ardilla Hola, probando la voz neuronal con Edge TTS!");
    });

    // Tecla 'H' para alternar panel
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "h" || e.key === "H") {
        this.panel.classList.toggle("hidden");
      }
    });
    this.btnHide.addEventListener("click", () => this.panel.classList.add("hidden"));

    // Manejo de perfiles
    this.profilesTbody.addEventListener("input", (e) => {
      const target = e.target;
      const idx = target.dataset.idx;
      const field = target.dataset.field;
      if (idx !== undefined && field) {
        this.profiles[idx][field] = target.value;
        this.saveProfiles();
      }
    });

    this.profilesTbody.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-del-profile")) {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.profiles.splice(idx, 1);
        this.saveProfiles();
        this.renderProfiles();
      }
    });

    this.btnAddProfile.addEventListener("click", () => {
      this.profiles.push({ key: "!nuevo", voice: "es-MX-DaliaNeural", pitch: "+0Hz", rate: "+0%" });
      this.saveProfiles();
      this.renderProfiles();
    });

    this.btnResetProfiles.addEventListener("click", () => {
      if (confirm("¿Restaurar perfiles de voz a los valores por defecto?")) {
        this.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
        this.saveProfiles();
        this.renderProfiles();
      }
    });
  }

  setWsStatus(status, text) {
    this.wsStatus.className = `badge ${status}`;
    this.wsStatus.textContent = text;
    if (status === "connected") {
      this.btnToggleConnect.textContent = "Desconectar";
      this.btnToggleConnect.classList.replace("primary", "danger");
    } else {
      this.btnToggleConnect.textContent = "Conectar a TikTok";
      this.btnToggleConnect.classList.replace("danger", "primary");
    }
  }

  connectTikTok() {
    const rawUser = this.inputUser.value.trim().replace(/^@/, "");
    const apiKey = this.inputEulerKey.value.trim();

    if (!rawUser || !apiKey) {
      alert("Por favor ingresa el usuario de TikTok y la API Key de EulerStream.");
      return;
    }

    this.shouldReconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const wsUrl = `wss://ws.eulerstream.com?uniqueId=${encodeURIComponent(rawUser)}&apiKey=${encodeURIComponent(apiKey)}`;
    this.setWsStatus("connecting", "Conectando...");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setWsStatus("connected", "Conectado");
        console.log("Conectado a EulerStream TikTok Live");
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingSocketMessage(msg);
        } catch (err) {
          console.error("Error al procesar mensaje del socket:", err);
        }
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        this.setWsStatus("error", "Error Conexión");
      };

      this.ws.onclose = () => {
        this.setWsStatus("error", "Desconectado");
        if (this.shouldReconnect) {
          console.log("Reconectando en 3s...");
          this.reconnectTimer = setTimeout(() => this.connectTikTok(), 3000);
        }
      };
    } catch (e) {
      console.error("Error inicializando socket:", e);
      this.setWsStatus("error", "Error Init");
    }
  }

  disconnectTikTok() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setWsStatus("", "Desconectado");
  }

  handleIncomingSocketMessage(msg) {
    // Normalizar payloads de EulerStream / TikTok Live
    // Pueden venir con event = "chat", "WebcastChatMessage", o type directo
    const eventType = msg.event || msg.type;
    const data = msg.data || msg;

    if (eventType === "chat" || eventType === "WebcastChatMessage" || eventType === "comment") {
      const username = data.nickname || data.uniqueId || (data.user && (data.user.nickname || data.user.uniqueId)) || "Espectador";
      const comment = data.comment || data.text || "";
      if (comment) {
        this.processChatMessage(username, comment);
      }
    }
  }

  async processChatMessage(username, rawText) {
    const textClean = rawText.trim();
    if (!textClean) return;

    // Clasificación híbrida de perfil de voz
    const profile = await this.classifyVoice(textClean);
    this.audioQueue.enqueue({
      username,
      text: profile.cleanedText,
      voice: profile.voice,
      pitch: profile.pitch,
      rate: profile.rate,
      rawText
    });
  }

  async classifyVoice(text) {
    const defaultProfile = this.profiles.find(p => p.key === "default") || DEFAULT_PROFILES[0];
    let cleanedText = text;

    // Paso 1: Comandos explícitos (!jorge, !ardilla, !enojo, etc.)
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    const commandProfile = this.profiles.find(p => p.key.toLowerCase() === firstWord);
    if (commandProfile) {
      cleanedText = text.slice(firstWord.length).trim();
      return { ...commandProfile, cleanedText: cleanedText || text };
    }

    // Paso 2: Reglas rápidas basadas en Regex y Emojis
    // Risa: jajaja, jejeje, xd, emojis risa
    const laughRegex = /(ja){2,}|(je){2,}|(ji){2,}|(xd)+|[😂🤣😆😹]/i;
    if (laughRegex.test(text)) {
      const p = this.profiles.find(x => x.key === "!risa") || defaultProfile;
      return { ...p, cleanedText };
    }

    // Tristeza: 😢😭💔🥺 o palabras clave
    const sadRegex = /[😢😭💔😿🥺]|(\btriste\b)|(\bllor)/i;
    if (sadRegex.test(text)) {
      const p = this.profiles.find(x => x.key === "!triste") || defaultProfile;
      return { ...p, cleanedText };
    }

    // Enojo: Mayúsculas sostenidas (>65% con longitud > 6), signos !!!, emojis furia
    const angerEmojis = /[😡🤬👿😠💢]/;
    const multipleExcl = /!{2,}/;
    const isCaps = text.length > 6 && (text.replace(/[^A-Z]/g, "").length / text.replace(/[^a-zA-Z]/g, "").length) > 0.65;
    if (angerEmojis.test(text) || multipleExcl.test(text) || isCaps) {
      const p = this.profiles.find(x => x.key === "!enojo") || defaultProfile;
      return { ...p, cleanedText };
    }

    // Paso 3: Clasificador Groq AI (Llama 3.1 8B) si hay API Key disponible
    const groqKey = this.inputGroqKey.value.trim();
    if (groqKey) {
      try {
        const groqEmotion = await this.queryGroqEmotion(groqKey, text);
        if (groqEmotion === "ENOJO") {
          return { ...(this.profiles.find(x => x.key === "!enojo") || defaultProfile), cleanedText };
        }
        if (groqEmotion === "RISA") {
          return { ...(this.profiles.find(x => x.key === "!risa") || defaultProfile), cleanedText };
        }
        if (groqEmotion === "TRISTE") {
          return { ...(this.profiles.find(x => x.key === "!triste") || defaultProfile), cleanedText };
        }
      } catch (e) {
        console.warn("Fallo clasificador Groq AI, usando default:", e);
      }
    }

    // Default
    return { ...defaultProfile, cleanedText };
  }

  async queryGroqEmotion(apiKey, text) {
    const prompt = `Clasifica la emoción del siguiente mensaje en exactamente UNA sola palabra de entre estas cuatro: NORMAL, ENOJO, RISA, TRISTE.\nMensaje: "${text}"`;
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (!resp.ok) return "NORMAL";
    const data = await resp.json();
    const result = data.choices?.[0]?.message?.content?.trim().toUpperCase() || "NORMAL";
    return result;
  }

  renderQueueState(queue, current) {
    this.queueCount.textContent = queue.length;
    if (current) {
      this.nowPlaying.textContent = `▶ [${current.username}]: ${current.text} (${current.voice})`;
      // Mostrar overlay OBS
      this.popupUser.textContent = current.username;
      this.popupMsg.textContent = current.text;
      this.popupAvatar.textContent = current.voice.includes("Jorge") || current.voice.includes("Alvaro") ? "🧔" : "🎙️";
      this.ttsPopup.classList.remove("hidden");
    } else {
      this.nowPlaying.textContent = "Sin reproducción activa";
      this.ttsPopup.classList.add("hidden");
    }

    this.queueList.innerHTML = "";
    queue.slice(0, 8).forEach((item, idx) => {
      const li = document.createElement("li");
      li.textContent = `${idx + 1}. [${item.username}]: ${item.text.slice(0, 45)}${item.text.length > 45 ? "..." : ""}`;
      this.queueList.appendChild(li);
    });
  }
}

// Inicialización
window.addEventListener("DOMContentLoaded", () => {
  window.ttsApp = new App();
});
