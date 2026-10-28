// renderer.js — CEP panel UI logic
// Giao tiếp với Photoshop qua CSInterface (evalScript),
// giao tiếp với server qua fetch() đến localhost.

/* ── CSInterface helper ── */
const cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;

function evalScript(fnCall) {
  return new Promise((resolve) => {
    if (!cs) { resolve("ERROR:CSInterface not available"); return; }
    cs.evalScript(fnCall, (result) => resolve(result || ""));
  });
}

/* ── State ── */
let imageBase64 = null;   // PNG xuất từ PS selection
let serverUrl   = "http://localhost:3000";

/* ── Đường dẫn cài đặt extension (khác nhau tùy máy/tùy user) ──
   Lấy động qua CSInterface, KHÔNG được hard-code, để panel chạy đúng
   trên máy của bất kỳ ai cài extension (Win10, Win11, mọi username). */
function getExtensionPath() {
  if (!cs) return "";
  try {
    return cs.getSystemPath(SystemPath.EXTENSION) || "";
  } catch (e) {
    return "";
  }
}

// Escape để nhúng an toàn vào chuỗi truyền cho evalScript (tránh lỗi khi path
// chứa dấu \ hoặc ký tự đặc biệt trong tên user, ví dụ "Nguyễn Văn A").
function escapeForExtendScript(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);

const statusDot     = $("statusDot");
const statusText    = $("statusText");
const settingsBtn   = $("settingsBtn");
const settingsPanel = $("settingsPanel");
const geminiApiKey  = $("geminiApiKey");
const geminiModel   = $("geminiModel");
const serverUrlEl   = $("serverUrl");
const saveSettingsBtn = $("saveSettingsBtn");
const revealKeyBtn  = $("revealKeyBtn");
const ocrLang       = $("ocrLang");
const targetLang    = $("targetLang");
const captureBtn    = $("captureBtn");
const runBtn        = $("runBtn");
const previewWrap   = $("previewWrap");
const previewThumb  = $("previewThumb");
const clearBtn      = $("clearBtn");
const ocrResult     = $("ocrResult");
const detectedLang  = $("detectedLang");
const translatedResult = $("translatedResult");
const copyOcrBtn    = $("copyOcrBtn");
const copyTranslationBtn = $("copyTranslationBtn");
const statusMsg     = $("statusMsg");
// ── DOM refs cho nút Start/Stop Server ──
const startServerBtn = document.getElementById("startServerBtn");
const stopServerBtn = document.getElementById("stopServerBtn");

// ── Sự kiện Start Server ──
if (startServerBtn) {
  startServerBtn.addEventListener("click", async () => {
    if (!cs) {
      setStatus("CSInterface not available", true);
      return;
    }
    setStatus("Starting server...", false, true);
    try {
      const extensionPath = getExtensionPath();
      if (!extensionPath) {
        setStatus("Could not resolve extension path.", true);
        return;
      }
      const result = await evalScript(`startNodeServer("${escapeForExtendScript(extensionPath)}")`);
      if (result.startsWith("OK:")) {
        setStatus("Server start command sent.", false);
        setTimeout(checkServer, 3000);
      } else {
        setStatus("Error: " + result, true);
      }
    } catch (err) {
      setStatus("Error: " + err.message, true);
    }
  });
}

// ── Sự kiện Stop Server ──
if (stopServerBtn) {
  stopServerBtn.addEventListener("click", async () => {
    if (!cs) {
      setStatus("CSInterface not available", true);
      return;
    }
    setStatus("Stopping server...", false, true);
    try {
      const extensionPath = getExtensionPath();
      if (!extensionPath) {
        setStatus("Could not resolve extension path.", true);
        return;
      }
      const result = await evalScript(`stopNodeServer("${escapeForExtendScript(extensionPath)}")`);
      if (result.startsWith("OK:")) {
        setStatus("Server stop command sent.", false);
        setTimeout(checkServer, 2000);
      } else {
        setStatus("Error: " + result, true);
      }
    } catch (err) {
      setStatus("Error: " + err.message, true);
    }
  });
}
/* ── Persist settings in localStorage ── */
function loadSettings() {
  try {
    const raw = localStorage.getItem("ocr-translate-settings");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.apiKey)     geminiApiKey.value  = s.apiKey;
    if (s.model)      geminiModel.value   = s.model;
    if (s.serverUrl)  { serverUrlEl.value = s.serverUrl; serverUrl = s.serverUrl; }
  } catch (e) {}
}

function saveSettings() {
  const s = {
    apiKey:    geminiApiKey.value.trim(),
    model:     geminiModel.value.trim() || "gemini-2.0-flash-lite",
    serverUrl: serverUrlEl.value.trim() || "http://localhost:3000"
  };
  localStorage.setItem("ocr-translate-settings", JSON.stringify(s));
  serverUrl = s.serverUrl;
  setStatus("Settings saved.", false);
  settingsPanel.hidden = true;
  settingsBtn.setAttribute("aria-expanded", "false");
  checkServer();
}

/* ── Status helpers ── */
function setStatus(msg, isError = false, isLoading = false) {
  statusMsg.textContent = msg;
  statusMsg.className = "status-msg" + (isError ? " error" : isLoading ? " loading" : "");
}

function setDot(state) {   // "checking" | "online" | "offline"
  statusDot.className = "status-dot " + state;
  statusText.textContent = state === "checking" ? "Checking…"
                         : state === "online"   ? "Server online"
                         :                        "Server offline";
}

/* ── Server health check ── */
async function checkServer() {
  setDot("checking");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const r = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeoutId); // hủy timer nếu fetch thành công sớm
    if (r.ok) { setDot("online"); return true; }
    setDot("offline"); return false;
  } catch (err) {
    clearTimeout(timeoutId);
    setDot("offline"); return false;
  }
}

/* ── Settings panel toggle ── */
settingsBtn.addEventListener("click", () => {
  const open = !settingsPanel.hidden;
  settingsPanel.hidden = open;
  settingsBtn.setAttribute("aria-expanded", String(!open));
});

saveSettingsBtn.addEventListener("click", saveSettings);

/* ── API key reveal toggle ── */
revealKeyBtn.addEventListener("click", () => {
  const isPass = geminiApiKey.type === "password";
  geminiApiKey.type = isPass ? "text" : "password";
  // Swap icon
  $("eyeIcon").innerHTML = isPass
    ? `<path d="M2 2l16 16M6.7 6.8A7 7 0 0 0 3.1 10S6.6 17 10 17a6.9 6.9 0 0 0 3.4-.9M9.9 4.1C9.9 4 10 4 10 4c3.4 0 6.9 7 6.9 7a13 13 0 0 1-1.5 2.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
    : `<path d="M1 10s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/>`;
});

/* ── Capture from Photoshop selection ── */
captureBtn.addEventListener("click", async () => {
  if (!cs) {
    setStatus("CSInterface not available — are you running inside Photoshop?", true);
    return;
  }

  setStatus("Exporting selection...", false, true);
  captureBtn.disabled = true;

  try {
    // Tạo path tạm — dùng thư mục temp của hệ thống
    const tmpPath = await evalScript(`Folder.temp.fsName + "/ocr_translate_tmp.png"`);
    const cleanPath = tmpPath.replace(/\\/g, "/");

    const result = await evalScript(`exportSelectionAsImage("${cleanPath}")`);

    if (!result.startsWith("OK:")) {
      setStatus("Photoshop error: " + result.replace("ERROR:", ""), true);
      return;
    }

    // Đọc file PNG → base64 qua server endpoint
    const r = await fetch(`${serverUrl}/api/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cleanPath })
    });
    const data = await r.json();

    if (data.error) { setStatus(data.error, true); return; }

    imageBase64 = data.base64;
    previewThumb.src = "data:image/png;base64," + imageBase64;
    previewWrap.hidden = false;
    runBtn.disabled = false;
    setStatus("Selection captured.");
  } catch (err) {
    setStatus("Capture failed: " + err.message, true);
  } finally {
    captureBtn.disabled = false;
  }
});

/* ── Clear image ── */
clearBtn.addEventListener("click", () => {
  imageBase64 = null;
  previewThumb.src = "";
  previewWrap.hidden = true;
  runBtn.disabled = true;
  setStatus("");
});

/* ── Run OCR + Translate ── */
runBtn.addEventListener("click", async () => {
  if (!imageBase64) { setStatus("No image captured.", true); return; }

  runBtn.disabled = true;
  setStatus("Processing…", false, true);
  ocrResult.value = "";
  translatedResult.value = "";
  detectedLang.textContent = "";

  try {
    const apiKey = geminiApiKey.value.trim();
    if (!apiKey) {
      setStatus("API key not set. Open Settings (⚙).", true);
      return;
    }

    const r = await fetch(`${serverUrl}/api/ocr-translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        sourceLangHint: ocrLang.value,
        targetLang:     targetLang.value,
        apiKey:         apiKey,
        model:          geminiModel.value.trim() || "gemini-2.0-flash-lite"
      })
    });

    const data = await r.json();

    if (data.error) { setStatus(data.error, true); return; }

    ocrResult.value        = data.ocrText        || "";
    translatedResult.value = data.translatedText  || "";
    detectedLang.textContent = data.detectedLanguage ? `· ${data.detectedLanguage}` : "";
    setStatus("Done.");
  } catch (err) {
    setStatus("Request failed: " + err.message, true);
  } finally {
    runBtn.disabled = false;
  }
});

/* ── Re-translate when OCR text is edited ── */
let retranslateTimer = null;
ocrResult.addEventListener("input", () => {
  clearTimeout(retranslateTimer);
  retranslateTimer = setTimeout(retranslate, 1200);
});

async function retranslate() {
  const text = ocrResult.value.trim();
  if (!text) return;

  const apiKey = geminiApiKey.value.trim();
  if (!apiKey) return;

  setStatus("Re-translating…", false, true);
  try {
    const r = await fetch(`${serverUrl}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        targetLang: targetLang.value,
        apiKey,
        model: geminiModel.value.trim() || "gemini-2.0-flash-lite"
      })
    });
    const data = await r.json();
    if (data.error) { setStatus(data.error, true); return; }
    translatedResult.value = data.translatedText || "";
    detectedLang.textContent = data.detectedLanguage ? `· ${data.detectedLanguage}` : "";
    setStatus("Done.");
  } catch (err) {
    setStatus("Re-translate failed: " + err.message, true);
  }
}

/* ── Copy buttons ── */
function copyText(el, btn) {
  if (!el.value) return;
  const textarea = document.createElement('textarea');
  textarea.value = el.value;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  const orig = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

copyOcrBtn.addEventListener("click",         () => copyText(ocrResult,        copyOcrBtn));
copyTranslationBtn.addEventListener("click", () => copyText(translatedResult, copyTranslationBtn));

/* ── Init ── */
loadSettings();
checkServer();