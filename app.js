/**
 * TNS Studio — app.js
 * Application principale en JavaScript vanilla
 * Prête à intégrer un backend Flask sur http://localhost:5000/api
 */

/* ============================================================
   CONFIG API — Modifier l'URL pour pointer vers votre Flask
   ============================================================ */
const API_BASE = "http://localhost:5000/api";

const API = {
  upload:   () => `${API_BASE}/upload`,
  segment:  () => `${API_BASE}/segment`,
  analyze:  () => `${API_BASE}/analyze`,
  filter:   () => `${API_BASE}/filter`,
  segments: (name) => `${API_BASE}/segments/${name}`,
};

/* ============================================================
   ÉTAT GLOBAL
   ============================================================ */
const state = {
  // --- Partie 1 : Enregistrement ---
  isRecording:    false,
  audioBlob:      null,
  audioData:      null,   // Float32Array
  recordingTime:  0,
  bitDepth:       16,
  segments:       [],
  savedFilename:  null,   // Retourné par Flask /upload

  // --- Partie 2 : Filtrage ---
  serverId:       null,   // UUID retourné par /api/analyze
  audioBuffer:    null,
  fileName:       "",
  timeData:       null,   // Float32Array
  freqData:       [],
  frequencies:    [],
  filteredTimeData: null,
  filteredFreqData: [],
  filterType:     "bandpass",
  isFiltered:     false,
  isPlaying:      false,

  // Refs Web Audio
  mediaRecorder:  null,
  audioCtxRec:    null,
  analyserRec:    null,
  timerRec:       null,
  chunksRec:      [],

  audioCtxFft:    null,
  analyserFft:    null,
  sourceNodeFft:  null,

  eqAnimRec:      null,
  eqAnimFft:      null,
  waveAnimRec:    null,
};

/* ============================================================
   NAVIGATION ONGLETS
   ============================================================ */
function switchTab(tab) {
  document.getElementById("panel-recording").classList.toggle("hidden", tab !== "recording");
  document.getElementById("panel-filtering").classList.toggle("hidden", tab !== "filtering");
  document.getElementById("tab-recording").classList.toggle("active", tab === "recording");
  document.getElementById("tab-filtering").classList.toggle("active", tab === "filtering");
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

/* ============================================================
   PARTIE 1 — ENREGISTREMENT
   ============================================================ */

function setBitDepth(depth) {
  state.bitDepth = depth;
  document.getElementById("bd-16").classList.toggle("active", depth === 16);
  document.getElementById("bd-32").classList.toggle("active", depth === 32);
}

async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  const sampleRate = parseInt(document.getElementById("sampleRate").value);
  const duration   = parseInt(document.getElementById("duration").value) || 5;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate, channelCount: 1 },
    });

    const audioCtx = new AudioContext({ sampleRate });
    const source   = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    state.audioCtxRec  = audioCtx;
    state.analyserRec  = analyser;
    state.chunksRec    = [];
    state.recordingTime = 0;
    state.segments     = [];
    renderSegmentsList([]);

    const recorder = new MediaRecorder(stream);
    state.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.chunksRec.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(state.chunksRec, { type: "audio/webm" });
      state.audioBlob = blob;

      // Décoder pour l'affichage de la forme d'onde
      const arrayBuffer = await blob.arrayBuffer();
      try {
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        state.audioData = decoded.getChannelData(0);
        drawWaveformStatic("waveCanvas", state.audioData, "primary");
        document.getElementById("waveLabel").textContent = "Signal enregistré";
      } catch {
        // Ne pas bloquer si le décodage échoue
      }

      stream.getTracks().forEach(t => t.stop());
      document.getElementById("saveBtn").disabled = false;
      document.getElementById("segBtn").disabled  = false;
      toast("Enregistrement terminé !", "success");
    };

    recorder.start(100);
    state.isRecording = true;

    // Mise à jour UI
    const btn = document.getElementById("recBtn");
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
      Arrêter &nbsp;(0s / ${duration}s)
    `;
    btn.classList.add("btn-recording");
    btn.classList.remove("btn-primary");

    document.getElementById("eq-label-rec").textContent = "● LIVE";
    document.getElementById("waveLabel").textContent = `REC ● 0s / ${duration}s`;

    // Démarrer les visualisations live
    startEqualizerAnim("eqCanvas", () => state.analyserRec, () => state.isRecording);
    startWaveformLiveAnim("waveCanvas", () => state.analyserRec, () => state.isRecording);

    // Timer auto-stop
    state.timerRec = setInterval(() => {
      state.recordingTime++;
      const btn = document.getElementById("recBtn");
      if (btn) {
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          Arrêter &nbsp;(${state.recordingTime}s / ${duration}s)
        `;
      }
      document.getElementById("waveLabel").textContent = `REC ● ${state.recordingTime}s / ${duration}s`;
      if (state.recordingTime >= duration) stopRecording();
    }, 1000);

  } catch {
    toast("Impossible d'accéder au microphone", "error");
  }
}

function stopRecording() {
  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;

  clearInterval(state.timerRec);

  const btn = document.getElementById("recBtn");
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="2" width="6" height="11" rx="3"/>
      <path d="M5 10a7 7 0 0 0 14 0"/>
    </svg>
    Enregistrer
  `;
  btn.classList.remove("btn-recording");
  btn.classList.add("btn-primary");
  document.getElementById("eq-label-rec").textContent = "Égaliseur";
}

/* --- Sauvegarde (envoi Flask) --- */
async function handleSave() {
  if (!state.audioBlob) return;
  const locuteur  = document.getElementById("locuteur").value.trim();
  const session   = document.getElementById("session").value.trim();
  const sampleRate = parseInt(document.getElementById("sampleRate").value);

  const formData = new FormData();
  formData.append("audio", state.audioBlob, "recording.wav");
  formData.append("locuteur", locuteur);
  formData.append("session", session);
  formData.append("sample_rate", sampleRate);
  formData.append("bit_depth", state.bitDepth);

  toast("Envoi vers le serveur Flask...", "info");
  try {
    const res = await fetch(API.upload(), { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.savedFilename = data.path;   // chemin relatif complet pour /api/segment
    toast(`Sauvegardé : ${data.filename}`, "success");
  } catch (err) {
    toast(`Erreur upload : ${err.message}`, "error");
  }
}

/* --- Segmentation --- */
async function handleSegment() {
  if (!state.audioData) {
    toast("Enregistrez d'abord un audio", "error");
    return;
  }

  const sampleRate    = parseInt(document.getElementById("sampleRate").value);
  const threshold     = parseFloat(document.getElementById("threshold").value);
  const minSilence    = parseInt(document.getElementById("minSilence").value);
  const samplesPerMs  = sampleRate / 1000;
  const minSilenceSamples = minSilence * samplesPerMs;

  const segs = [];
  let inVoice = false, start = 0, silenceCount = 0, segId = 0;

  for (let i = 0; i < state.audioData.length; i++) {
    const amp = Math.abs(state.audioData[i]);
    if (amp > threshold) {
      if (!inVoice) { inVoice = true; start = i; }
      silenceCount = 0;
    } else {
      silenceCount++;
      if (inVoice && silenceCount >= minSilenceSamples) {
        segs.push({
          id:    segId,
          name:  `segment_${String(++segId).padStart(3, "0")}.wav`,
          start: start / sampleRate,
          end:   (i - silenceCount) / sampleRate,
        });
        inVoice = false;
      }
    }
  }
  if (inVoice) {
    segs.push({
      id:    segId,
      name:  `segment_${String(segId + 1).padStart(3, "0")}.wav`,
      start: start / sampleRate,
      end:   state.audioData.length / sampleRate,
    });
  }

  state.segments = segs;
  renderSegmentsList(segs);
  toast(`${segs.length} segment(s) détecté(s)`, "success");

  // --- Sauvegarde des segments via Flask ---
  if (state.savedFilename) {
    try {
      const res = await fetch(API.segment(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filepath:       state.savedFilename,
          threshold,
          min_silence_ms: minSilence,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Enrichir les segments avec les URLs Flask
        data.segments.forEach((srv, i) => {
          if (state.segments[i]) state.segments[i].url = srv.url;
        });
        renderSegmentsList(state.segments);
        toast(`Segments sauvegardés (${data.segments.length})`, "success");
      }
    } catch { /* silencieux : l'aperçu client reste affiché */ }
  }
}

function renderSegmentsList(segs) {
  const el = document.getElementById("segmentsList");
  if (!segs.length) { el.classList.add("hidden"); return; }

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="segments-list-header">${segs.length} segment(s) détecté(s)</div>
    ${segs.map(seg => `
      <div class="segment-item">
        <div class="segment-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
          <span class="segment-name">${seg.name}</span>
          <span class="segment-time">${seg.start.toFixed(2)}s — ${seg.end.toFixed(2)}s</span>
        </div>
        <div class="segment-actions">
          <button class="btn-seg" title="Lire" onclick="playSegment(${seg.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <button class="btn-seg" title="Télécharger" onclick="downloadSegment(${seg.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>
      </div>
    `).join("")}
  `;
}

function playSegment(id) {
  const seg = state.segments[id];
  if (!seg || !state.audioBlob) return;
  const url = URL.createObjectURL(state.audioBlob);
  const audio = new Audio(url);
  audio.currentTime = seg.start;
  audio.play();
  toast(`Lecture : ${seg.name}`, "info");
  setTimeout(() => audio.pause(), (seg.end - seg.start) * 1000 + 200);
}

function downloadSegment(id) {
  const seg = state.segments[id];
  if (seg?.url) {
    const a = document.createElement("a");
    a.href = seg.url;
    a.download = seg.name;
    a.click();
  } else {
    toast("Sauvegardez d'abord l'enregistrement avant de segmenter", "info");
  }
}

/* ============================================================
   PARTIE 2 — FILTRAGE FFT
   ============================================================ */

function setFilterType(type) {
  state.filterType = type;
  document.getElementById("ft-bandpass").classList.toggle("active", type === "bandpass");
  document.getElementById("ft-bandstop").classList.toggle("active", type === "bandstop");
  document.getElementById("ft-bandpass").classList.remove("secondary");
  document.getElementById("ft-bandstop").classList.add("secondary");
  if (state.frequencies.length > 0) drawSpectrum();
}

function handleFileDrop(event) {
  event.preventDefault();
  document.getElementById("dropzone").classList.remove("drag-over");
  const file = event.dataTransfer.files?.[0];
  if (file) loadAudioFile(file);
}

function handleFileUpload(input) {
  const file = input.files?.[0];
  if (file) loadAudioFile(file);
}

async function loadAudioFile(file) {
  state.fileName    = file.name;
  state.isFiltered  = false;
  state.filteredTimeData = null;
  state.filteredFreqData = [];

  document.getElementById("dropzoneText").textContent = file.name;
  document.getElementById("audioFileName").textContent = file.name;

  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  state.audioCtxFft = ctx;

  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    state.audioBuffer = decoded;
    const channelData = decoded.getChannelData(0);
    state.timeData = channelData;

    document.getElementById("audioMeta").textContent =
      `${decoded.sampleRate} Hz · ${decoded.duration.toFixed(2)}s · ${decoded.numberOfChannels}ch`;

    // Affichage forme d'onde
    drawWaveformStatic("waveCanvasFft", channelData, "primary");

    // Calcul FFT via OfflineAudioContext + AnalyserNode
    const N = channelData.length;
    const fftSize = Math.min(Math.pow(2, Math.ceil(Math.log2(N))), 32768);
    const offCtx  = new OfflineAudioContext(1, fftSize, decoded.sampleRate);
    const src     = offCtx.createBufferSource();
    const analyser = offCtx.createAnalyser();
    analyser.fftSize = fftSize;

    const buf = offCtx.createBuffer(1, fftSize, decoded.sampleRate);
    buf.getChannelData(0).set(channelData.subarray(0, Math.min(N, fftSize)));
    src.buffer = buf;
    src.connect(analyser);
    analyser.connect(offCtx.destination);
    src.start();
    await offCtx.startRendering();

    const bins  = analyser.frequencyBinCount;
    const raw   = new Uint8Array(bins);
    analyser.getByteFrequencyData(raw);

    const freqs = [], amps = [];
    const bw = decoded.sampleRate / analyser.fftSize;
    for (let i = 0; i < bins; i++) {
      freqs.push(i * bw);
      amps.push(raw[i] / 255);
    }
    state.frequencies = freqs;
    state.freqData    = amps;

    drawSpectrum();
    document.getElementById("playbackRow").classList.remove("hidden");
    document.getElementById("filterBtn").disabled = false;

    startEqualizerAnim("eqCanvasFft", () => state.analyserFft, () => state.isPlaying);

    // --- Appel Flask /api/analyze (FFT serveur) ---
    try {
      const formData = new FormData();
      formData.append("audio", file);
      const res = await fetch(API.analyze(), { method: "POST", body: formData });
      if (res.ok) {
        const d = await res.json();
        state.serverId    = d.serverId;
        state.frequencies = d.frequencies;
        state.freqData    = d.freqData;
        drawSpectrum();
        toast(`Fichier chargé : ${file.name}`, "success");
      } else {
        toast(`Fichier chargé (analyse locale — Flask: ${res.status})`, "info");
      }
    } catch {
      toast(`Fichier chargé : ${file.name} (analyse locale)`, "success");
    }
  } catch {
    toast("Erreur lors du décodage audio", "error");
  }
}

function togglePlay() {
  if (!state.audioBuffer || !state.audioCtxFft) return;

  if (state.isPlaying && state.sourceNodeFft) {
    state.sourceNodeFft.stop();
    state.isPlaying = false;
    updatePlayBtn(false);
    return;
  }

  const ctx     = state.audioCtxFft;
  const source  = ctx.createBufferSource();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;

  source.buffer = state.audioBuffer;
  source.connect(analyser);
  analyser.connect(ctx.destination);

  source.onended = () => {
    state.isPlaying   = false;
    state.analyserFft = null;
    updatePlayBtn(false);
  };

  source.start();
  state.sourceNodeFft = source;
  state.analyserFft   = analyser;
  state.isPlaying     = true;
  updatePlayBtn(true);
}

function updatePlayBtn(playing) {
  document.getElementById("playIcon").innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

/* --- Appliquer le filtre (client-side preview + appel Flask) --- */
async function applyFilter() {
  if (!state.audioBuffer || !state.timeData) {
    toast("Chargez d'abord un fichier audio", "error");
    return;
  }
  const fmin = parseFloat(document.getElementById("fmin").value);
  const fmax = parseFloat(document.getElementById("fmax").value);

  if (fmin >= fmax) { toast("fmin doit être inférieur à fmax", "error"); return; }

  // --- Appel Flask /api/filter ---
  if (state.serverId) {
    try {
      const res = await fetch(API.filter(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId:   state.serverId,
          filterType: state.filterType,
          fmin, fmax,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      state.filteredTimeData = new Float32Array(data.filteredTimeData);
      state.filteredFreqData = data.filteredFreqData;
      state.filteredAudioUrl = data.audioUrl;
      state.isFiltered = true;
      document.getElementById("filteredWaveCard").classList.remove("hidden");
      drawWaveformStatic("filteredWaveCanvas", state.filteredTimeData, "secondary");
      drawSpectrum();
      document.getElementById("downloadBtn").disabled = false;
      toast("Filtre appliqué !", "success");
      return;
    } catch (err) {
      toast(`Erreur Flask : ${err.message} — aperçu local activé`, "error");
    }
  }

  // Preview côté client (masquage fréquentiel visuel)
  const sampleRate = state.audioBuffer.sampleRate;
  const bw = sampleRate / (state.frequencies.length * 2);
  const newFreqData = state.freqData.map((amp, i) => {
    const f = i * bw;
    if (state.filterType === "bandpass") return (f >= fmin && f <= fmax) ? amp : 0;
    else return (f >= fmin && f <= fmax) ? 0 : amp;
  });
  state.filteredFreqData = newFreqData;

  // Reconstruction approximative du signal temporel
  const filtered = new Float32Array(state.timeData.length);
  for (let i = 0; i < state.timeData.length; i++) {
    filtered[i] = state.timeData[i] * 0.8;
  }
  state.filteredTimeData = filtered;
  state.isFiltered = true;

  document.getElementById("filteredWaveCard").classList.remove("hidden");
  drawWaveformStatic("filteredWaveCanvas", filtered, "secondary");
  drawSpectrum();
  document.getElementById("downloadBtn").disabled = false;
  toast("Aperçu local appliqué — reconstruction complète via Flask", "info");
}

async function handleDownload() {
  if (!state.filteredTimeData) return;

  // --- Téléchargement via Flask ---
  if (state.filteredAudioUrl) {
    const a = document.createElement("a");
    a.href = state.filteredAudioUrl;
    a.download = "signal_filtre.wav";
    a.click();
    return;
  }

  toast("Appliquez d'abord le filtre pour générer le fichier WAV", "info");
}

/* ============================================================
   CANVAS — WAVEFORM STATIQUE
   ============================================================ */
function drawWaveformStatic(canvasId, data, colorKey = "primary") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx  = canvas.getContext("2d");
  const color = colorKey === "primary" ? "#33d6e2" : "#d946a8";
  const glow  = colorKey === "primary" ? "rgba(51,214,226,0.3)" : "rgba(217,70,168,0.3)";

  canvas.width  = canvas.offsetWidth * 2;
  canvas.height = canvas.style.height ? parseInt(canvas.style.height) * 2 : 200;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (data && data.length > 0) {
    const step = Math.max(1, Math.floor(data.length / canvas.width));
    const mid  = canvas.height / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = glow;
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
      const idx = Math.min(i * step, data.length - 1);
      const val = data[idx] * mid;
      i === 0 ? ctx.moveTo(i, mid + val) : ctx.lineTo(i, mid + val);
    }
    ctx.stroke();
  } else {
    const mid = canvas.height / 2;
    ctx.strokeStyle = "hsl(220,15%,25%)";
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, mid); ctx.lineTo(canvas.width, mid);
    ctx.stroke();
  }
}

/* ============================================================
   CANVAS — WAVEFORM LIVE (pendant l'enregistrement)
   ============================================================ */
function startWaveformLiveAnim(canvasId, getAnalyser, isActive) {
  let raf;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function draw() {
    const analyser = getAnalyser();
    if (!isActive() || !analyser) {
      cancelAnimationFrame(raf);
      return;
    }
    raf = requestAnimationFrame(draw);

    canvas.width  = canvas.offsetWidth * 2;
    canvas.height = parseInt(canvas.style.height || 100) * 2;
    const bufLen  = analyser.fftSize;
    const data    = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(data);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#33d6e2";
    ctx.lineWidth   = 2;
    ctx.shadowColor = "rgba(51,214,226,0.3)";
    ctx.shadowBlur  = 10;
    ctx.beginPath();

    const sliceW = canvas.width / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = data[i] / 128.0;
      const y = (v * canvas.height) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
  }
  draw();
}

/* ============================================================
   CANVAS — EQUALIZER (barres animées)
   ============================================================ */
const prevBars = {};

function startEqualizerAnim(canvasId, getAnalyser, isActive) {
  let raf;
  const canvas  = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx     = canvas.getContext("2d");
  const barCount = canvasId === "eqCanvas" ? 40 : 48;
  const h = parseInt(canvas.getAttribute("height") || 70);

  if (!prevBars[canvasId]) prevBars[canvasId] = new Array(barCount).fill(0);
  const bars = prevBars[canvasId];

  function draw() {
    raf = requestAnimationFrame(draw);

    canvas.width  = canvas.offsetWidth * 2;
    canvas.height = h * 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const analyser = getAnalyser();
    const active   = isActive();

    if (active && analyser) {
      const bufLen  = analyser.frequencyBinCount;
      const freqArr = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(freqArr);
      const step = Math.floor(bufLen / barCount);
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqArr[i * step + j];
        const target = (sum / step) / 255;
        bars[i] = bars[i] * 0.7 + target * 0.3;
      }
    } else {
      const t = Date.now() / 1000;
      for (let i = 0; i < barCount; i++) {
        const target = 0.05 + 0.03 * Math.sin(t * 2 + i * 0.5);
        bars[i] = bars[i] * 0.9 + target * 0.1;
      }
    }

    const gap      = 3;
    const barWidth = (canvas.width - (barCount - 1) * gap) / barCount;

    for (let i = 0; i < barCount; i++) {
      const barH = Math.max(4, bars[i] * canvas.height);
      const x    = i * (barWidth + gap);
      const y    = canvas.height - barH;

      const grad = ctx.createLinearGradient(x, canvas.height, x, y);
      grad.addColorStop(0,   "hsl(185, 80%, 55%)");
      grad.addColorStop(0.6, "hsl(250, 70%, 60%)");
      grad.addColorStop(1,   "hsl(320, 70%, 55%)");
      ctx.fillStyle   = grad;
      ctx.shadowColor = bars[i] > 0.5 ? "rgba(217,70,168,0.6)" : "rgba(51,214,226,0.4)";
      ctx.shadowBlur  = bars[i] > 0.5 ? 12 : 6;

      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barWidth, barH);
      }

      ctx.shadowBlur  = 0;
      ctx.fillStyle   = "rgba(255,255,255,0.9)";
      ctx.fillRect(x, y, barWidth, 2);
    }
  }

  if (prevBars[canvasId + "_raf"]) cancelAnimationFrame(prevBars[canvasId + "_raf"]);
  draw();
  prevBars[canvasId + "_raf"] = raf;
}

/* ============================================================
   CANVAS — SPECTRE FFT
   ============================================================ */
function drawSpectrum() {
  const canvas = document.getElementById("spectrumCanvas");
  if (!canvas || state.frequencies.length === 0) return;

  document.getElementById("spectrumEmpty").classList.add("hidden");
  canvas.classList.remove("hidden");

  const ctx    = canvas.getContext("2d");
  const h      = parseInt(canvas.getAttribute("height") || 220);
  canvas.width  = canvas.offsetWidth * 2;
  canvas.height = h * 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { frequencies: freqs, freqData: amps, filteredFreqData: filtAmp,
          filterType: ft, isFiltered } = state;
  const fmin = parseFloat(document.getElementById("fmin").value);
  const fmax = parseFloat(document.getElementById("fmax").value);

  const maxFreq = freqs[freqs.length - 1] || 1;
  const maxAmp  = Math.max(...amps, 0.001);
  const pad     = { top: 30, bottom: 40, left: 60, right: 20 };
  const plotW   = canvas.width  - pad.left - pad.right;
  const plotH   = canvas.height - pad.top  - pad.bottom;

  // Zone filtre
  const x1 = pad.left + (fmin / maxFreq) * plotW;
  const x2 = pad.left + (fmax / maxFreq) * plotW;
  ctx.fillStyle = ft === "bandpass"
    ? "rgba(51,214,226,0.08)" : "rgba(217,70,168,0.08)";
  ctx.fillRect(x1, pad.top, x2 - x1, plotH);
  ctx.strokeStyle = ft === "bandpass" ? "#33d6e2" : "#d946a8";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, pad.top); ctx.lineTo(x1, pad.top + plotH);
  ctx.moveTo(x2, pad.top); ctx.lineTo(x2, pad.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Grille
  ctx.strokeStyle = "hsl(220,15%,18%)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
  }

  // Étiquettes axe X (fréquences)
  ctx.fillStyle  = "hsl(215,15%,55%)";
  ctx.font       = "20px JetBrains Mono, monospace";
  ctx.textAlign  = "center";
  for (let i = 0; i <= 5; i++) {
    const f = (maxFreq * i) / 5;
    const x = pad.left + (i / 5) * plotW;
    ctx.fillText(f >= 1000 ? `${(f/1000).toFixed(1)}k` : `${Math.round(f)}`,
      x, canvas.height - 10);
  }

  // Étiquettes axe Y (amplitude)
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const amp = maxAmp * (1 - i / 4);
    const y   = pad.top + (i / 4) * plotH;
    ctx.fillText(amp.toFixed(2), pad.left - 8, y + 6);
  }

  // Courbe originale
  const drawCurve = (data, stroke, glow) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = glow;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    for (let i = 0; i < plotW; i++) {
      const idx = Math.min(Math.floor((i / plotW) * data.length), data.length - 1);
      const val = data[idx] / maxAmp;
      const x   = pad.left + i;
      const y   = pad.top + plotH - val * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  drawCurve(amps, "#33d6e2", "rgba(51,214,226,0.4)");
  if (isFiltered && filtAmp?.length) {
    drawCurve(filtAmp, "#d946a8", "rgba(217,70,168,0.4)");
  }

  // Label axe X
  ctx.fillStyle  = "hsl(215,15%,45%)";
  ctx.font       = "18px Space Grotesk, sans-serif";
  ctx.textAlign  = "center";
  ctx.fillText("Fréquence (Hz)", pad.left + plotW / 2, canvas.height - 1);
}

/* ============================================================
   DÉMARRAGE — init des visualisations idle
   ============================================================ */
window.addEventListener("load", () => {
  startEqualizerAnim("eqCanvas",    () => null, () => false);
  drawWaveformStatic("waveCanvas",  null, "primary");
  drawWaveformStatic("waveCanvasFft", null, "primary");
  drawWaveformStatic("filteredWaveCanvas", null, "secondary");

  // Redessiner les canvas sur resize
  window.addEventListener("resize", () => {
    if (state.audioData)           drawWaveformStatic("waveCanvas", state.audioData, "primary");
    if (state.timeData)            drawWaveformStatic("waveCanvasFft", state.timeData, "primary");
    if (state.filteredTimeData)    drawWaveformStatic("filteredWaveCanvas", state.filteredTimeData, "secondary");
    if (state.frequencies.length)  drawSpectrum();
  });
});
