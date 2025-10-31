// recorder.js — Wavebox Recorder + Visualizer (final, polished)

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

let accentColor = getComputedStyle(document.documentElement)
  .getPropertyValue("--accent")
  .trim() || "#1db954";

// Update accent color dynamically if theme changes
const accentPicker = document.getElementById("accentPicker");
if (accentPicker) {
  accentPicker.addEventListener("input", e => {
    accentColor = e.target.value;
  });
}

// === UI Toggle ===
recordToggleBtn.addEventListener("click", () => {
  recordPanel.classList.toggle("visible");
});

// === Populate Microphones ===
async function populateMics() {
  micSelect.innerHTML = "";
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");

    if (mics.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No microphone found";
      opt.disabled = true;
      micSelect.appendChild(opt);
      return;
    }

    for (const mic of mics) {
      const opt = document.createElement("option");
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`;
      micSelect.appendChild(opt);
    }
  } catch (err) {
    console.error("Failed to enumerate devices:", err);
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
    const constraints = {
      audio: {
        deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
        noiseSuppression: noiseToggle.checked,
        echoCancellation: true,
        channelCount: 1
      }
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

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    levelMeterInterval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = Math.min(100, (avg / 255) * 100);
      levelMeterFill.style.width = `${level}%`;
    }, 50);

    drawWaveform();

    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
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

      stream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
    };

    mediaRecorder.start();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    playBtn.disabled = true;
    saveBtn.disabled = true;
    uploadBtn.disabled = true;

  } catch (err) {
    console.error("Mic error:", err);
    statusEl.textContent = "❌ Unable to access microphone.";
  }
}

// === Stop Recording ===
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// === Playback with Waveform ===
playBtn.addEventListener("click", async () => {
  if (!recordedAudio.src) return;
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
  };
});

// === Download ===
saveBtn.addEventListener("click", () => {
  if (!audioBlob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(audioBlob);
  a.download = "recording.mp3";
  a.click();
});

// === Upload ===
uploadBtn.addEventListener("click", async () => {
  if (!audioBlob) return;

  const nowPath = document.getElementById("now-path").textContent.trim();
  if (!nowPath || !nowPath.endsWith(".mp3")) {
    statusEl.textContent = "⚠️ No valid audio path selected.";
    return;
  }

  const rel = nowPath.replace(/^\/+/, ""); // normalize
  statusEl.textContent = "⬆️ Uploading...";

  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  form.append("path", rel); // ✅ send full relative path (fixed)

  try {
    const res = await fetch("/sounds/api/upload", { method: "POST", body: form });
    const data = await res.json();

    if (data.ok) {
      statusEl.textContent = "✅ Uploaded successfully!";
      disableRecordingForExisting();
    } else {
      statusEl.textContent = `❌ Upload failed: ${data.error || "Unknown error."}`;
    }
  } catch (err) {
    console.error("Upload error:", err);
    statusEl.textContent = "❌ Network or server error.";
  }
});

// === Button Bindings ===
startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

// === Disable recording if file already exists ===
async function disableRecordingForExisting() {
  const nowPath = document.getElementById("now-path").textContent.trim();
  if (!nowPath || !nowPath.endsWith(".mp3")) return;

  const rel = nowPath.replace(/^\/+/, "");
  try {
    const res = await fetch(`/sounds/api/exists?path=${encodeURIComponent(rel)}`);
    const data = await res.json();

    if (data.ok && data.exists) {
      startBtn.disabled = true;
      stopBtn.disabled = true;
      uploadBtn.disabled = true;
      playBtn.disabled = true;
      saveBtn.disabled = true;
      statusEl.textContent = "⚠️ Recording already exists for this line.";
    } else {
      startBtn.disabled = false;
      statusEl.textContent = "";
    }
  } catch (err) {
    console.error("Check exists failed:", err);
  }
}

// === React to current audio path changes ===
const observer = new MutationObserver(disableRecordingForExisting);
observer.observe(document.getElementById("now-path"), { childList: true });

// === Init ===
(async function initRecorder() {
  await populateMics();
  disableRecordingForExisting();
})();
