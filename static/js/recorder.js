// recorder.js — Wavebox Recorder + Visualizer (with enhanced console logging)

let mediaRecorder = null;
let recordedChunks = [];
let audioBlob = null;
let stream = null;
let analyser = null;
let micSource = null;
let audioCtx = null;
let levelMeterInterval = null;
let animationFrame = null;

const micSelect = document.getElementById("micSelect");
const noiseToggle = document.getElementById("noiseSuppressionToggle");
const recordPanel = document.getElementById("recordPanel");
const recordToggleBtn = document.getElementById("recordToggleBtn");

const startBtn = document.getElementById("recordStartBtn");
const stopBtn = document.getElementById("recordStopBtn");
const playBtn = document.getElementById("recordPlayBtn");
const saveBtn = document.getElementById("recordSaveBtn");
const uploadBtn = document.getElementById("recordUploadBtn");
const statusEl = document.getElementById("recordStatus");
const recordedAudio = document.getElementById("recordedAudio");
const levelMeterFill = document.getElementById("levelMeter");

// === Styled Console Logging Helper ===
function logInfo(msg, ...args) {
  console.log(`%c🎙️ [Wavebox Recorder]%c ${msg}`, "color:#1db954;font-weight:bold", "color:inherit", ...args);
}
function logWarn(msg, ...args) {
  console.warn(`%c🎙️ [Wavebox Recorder]%c ${msg}`, "color:#e2b93d;font-weight:bold", "color:inherit", ...args);
}
function logError(msg, ...args) {
  console.error(`%c🎙️ [Wavebox Recorder]%c ${msg}`, "color:#ff5555;font-weight:bold", "color:inherit", ...args);
}

// === Waveform Canvas ===
const canvas = document.createElement("canvas");
canvas.width = 400;
canvas.height = 60;
canvas.style.width = "100%";
canvas.style.height = "60px";
canvas.style.background = "#0e0e0e";
canvas.style.borderRadius = "6px";
canvas.style.marginTop = "6px";
recordPanel.insertBefore(canvas, recordedAudio);
const ctx2d = canvas.getContext("2d");

let accentColor =
  getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim() || "#1db954";

// === Accent color dynamic update ===
const accentPicker = document.getElementById("accentPicker");
if (accentPicker) {
  accentPicker.addEventListener("input", (e) => {
    accentColor = e.target.value;
    logInfo(`Accent color changed to ${accentColor}`);
  });
}

// === Recorder Panel Toggle ===
recordToggleBtn.addEventListener("click", () => {
  recordPanel.classList.toggle("visible");
  logInfo(`Record panel ${recordPanel.classList.contains("visible") ? "opened" : "closed"}.`);
});

// === Populate Microphones ===
async function populateMics() {
  micSelect.innerHTML = "";
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");

    if (mics.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No microphone found";
      opt.disabled = true;
      micSelect.appendChild(opt);
      logWarn("No microphones detected.");
      return;
    }

    for (const mic of mics) {
      const opt = document.createElement("option");
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`;
      micSelect.appendChild(opt);
    }
    logInfo(`Found ${mics.length} microphone(s).`);
  } catch (err) {
    logError("Failed to enumerate devices:", err);
  }
}

// === Waveform Visualizer ===
function drawWaveform() {
  if (!analyser) return;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  ctx2d.fillStyle = "#0e0e0e";
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = accentColor;
  ctx2d.shadowBlur = 10;
  ctx2d.shadowColor = accentColor;
  ctx2d.beginPath();

  const sliceWidth = canvas.width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
    x += sliceWidth;
  }

  ctx2d.lineTo(canvas.width, canvas.height / 2);
  ctx2d.stroke();
  ctx2d.shadowBlur = 0;

  animationFrame = requestAnimationFrame(drawWaveform);
}

function stopWaveform() {
  cancelAnimationFrame(animationFrame);
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

// === Start Recording ===
async function startRecording() {
  try {
    logInfo("Initializing microphone...");
    const constraints = {
      audio: {
        deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
        noiseSuppression: noiseToggle.checked,
        echoCancellation: true,
        channelCount: 1,
      },
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    audioCtx = new AudioContext();
    micSource = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    micSource.connect(analyser);

    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    statusEl.textContent = "🔴 Recording...";
    logInfo("Recording started.");

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    levelMeterInterval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = Math.min(100, (avg / 255) * 100);
      levelMeterFill.style.width = `${level}%`;
    }, 50);

    drawWaveform();

    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
      if (levelMeterInterval) clearInterval(levelMeterInterval);
      stopWaveform();
      levelMeterFill.style.width = "0%";

      audioBlob = new Blob(recordedChunks, { type: "audio/webm" });
      recordedAudio.src = URL.createObjectURL(audioBlob);
      recordedAudio.style.display = "block";

      playBtn.disabled = false;
      saveBtn.disabled = false;
      uploadBtn.disabled = false;
      statusEl.textContent = "✅ Recording complete.";

      stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close();

      logInfo("Recording stopped. Blob ready:", audioBlob);
    };

    mediaRecorder.start();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    playBtn.disabled = true;
    saveBtn.disabled = true;
    uploadBtn.disabled = true;
  } catch (err) {
    logError("Microphone error:", err);
    statusEl.textContent = "❌ Unable to access microphone.";
  }
}

// === Stop Recording ===
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    logInfo("Stopping recording...");
  } else {
    logWarn("Stop pressed, but recorder not active.");
  }
}

// === Playback with Waveform ===
playBtn.addEventListener("click", async () => {
  if (!recordedAudio.src) return;
  logInfo("Playing recorded audio...");
  const actx = new AudioContext();
  const src = actx.createMediaElementSource(recordedAudio);
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  analyser.connect(actx.destination);
  drawWaveform();
  recordedAudio.play();
  recordedAudio.onended = () => {
    stopWaveform();
    actx.close();
    logInfo("Playback finished.");
  };
});

// === Download ===
saveBtn.addEventListener("click", () => {
  if (!audioBlob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(audioBlob);
  a.download = "recording.mp3";
  a.click();
  logInfo("Recording downloaded.");
});

// === Upload ===
uploadBtn.addEventListener("click", async () => {
  if (!audioBlob) return;

  const nowPath = document.getElementById("now-path").textContent.trim();
  if (!nowPath || !nowPath.endsWith(".mp3")) {
    statusEl.textContent = "⚠️ No valid audio path selected.";
    logWarn("Upload aborted: invalid or missing path.");
    return;
  }

  const rel = nowPath.replace(/^\/+/, "");
  statusEl.textContent = "⬆️ Uploading...";
  logInfo(`Uploading recording for path: ${rel}`);

  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  form.append("path", rel);

  try {
    const res = await fetch("/sounds/api/upload", { method: "POST", body: form });
    const data = await res.json();

    if (data.ok) {
      statusEl.textContent = "✅ Uploaded successfully!";
      logInfo("Upload success:", data.entry);
      disableRecordingForExisting();
    } else {
      statusEl.textContent = `❌ Upload failed: ${data.error || "Unknown error."}`;
      logError("Upload failed:", data);
    }
  } catch (err) {
    logError("Upload network error:", err);
    statusEl.textContent = "❌ Network or server error.";
  }
});

// === Disable recording if file already exists or is locked in ===
async function disableRecordingForExisting() {
  const nowPath = document.getElementById("now-path").textContent.trim();
  if (!nowPath || !nowPath.endsWith(".mp3")) return;

  const rel = nowPath.replace(/^\/+/, "");
  logInfo(`Checking existence for path: ${rel}`);
  try {
    const res = await fetch(`/sounds/api/exists?path=${encodeURIComponent(rel)}`);
    const data = await res.json();

    if (!data.ok) return logWarn("Exists check returned not-ok.");

    const disableAll = () => {
      startBtn.disabled = true;
      stopBtn.disabled = true;
      uploadBtn.disabled = true;
      playBtn.disabled = true;
      saveBtn.disabled = true;
    };

    recordPanel.classList.remove("locked", "pending");

    if (data.exists && data.status === "accepted") {
      disableAll();
      recordPanel.classList.add("locked");
      const acceptedAt = data.accepted_at
        ? new Date(data.accepted_at * 1000).toLocaleString()
        : "unknown time";
      statusEl.innerHTML = `✅ <b>Locked In</b> — final version accepted<br><small>${acceptedAt}</small>`;
      statusEl.style.color = "var(--accent)";
      logInfo(`Line locked in (accepted) at ${acceptedAt}`);
    } else if (data.exists && data.status === "pending") {
      disableAll();
      recordPanel.classList.add("pending");
      statusEl.textContent = "⚠️ Pending review (already uploaded).";
      statusEl.style.color = "var(--muted, #aaa)";
      logInfo("Line already uploaded and pending.");
    } else {
      // Allow new recording
      recordPanel.classList.remove("locked", "pending");
      startBtn.disabled = false;
      stopBtn.disabled = true;
      uploadBtn.disabled = true;
      playBtn.disabled = true;
      saveBtn.disabled = true;
      statusEl.textContent = "";
      statusEl.style.color = "";
      logInfo("Line available for new recording.");
    }
  } catch (err) {
    logError("Exists check failed:", err);
  }
}

// === Observe now-path changes ===
const observer = new MutationObserver(disableRecordingForExisting);
observer.observe(document.getElementById("now-path"), { childList: true });

// === Button bindings ===
startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

// === Init ===
(async function initRecorder() {
  logInfo("Initializing recorder UI...");
  await populateMics();
  disableRecordingForExisting();
  logInfo("Recorder ready.");
})();
