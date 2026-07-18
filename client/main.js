// main.js - Electron main process + HTTP server cho CEP panel
const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const express = require("express");
const cors = require("cors");

// ---------- Cấu hình đường dẫn config ----------
function getConfigPath() {
  const baseDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  return path.join(baseDir, "config.json");
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return { geminiApiKey: "", geminiModel: "gemini-2.0-flash-lite" }; // đổi model mặc định
  }
}

function saveConfigFile(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

// ---------- Hàm tiện ích (OCR normalize, prompt, parse) ----------
function normalizeOcrText(rawText) {
  if (!rawText) return rawText;
  const normalized = rawText.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n\s*\n+/);
  const joined = paragraphs
    .map((para) =>
      para
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
    )
    .filter((para) => para.length > 0);
  return joined.join("\n\n");
}

const LANGUAGE_NAMES = {
  vie: "Vietnamese",
  eng: "English",
  chs: "Chinese (Simplified)",
  cht: "Chinese (Traditional)",
  jpn: "Japanese",
  kor: "Korean",
  fre: "French",
  ger: "German",
  spa: "Spanish",
  por: "Portuguese",
  ita: "Italian",
  rus: "Russian",
  ara: "Arabic",
  tha: "Thai"
};

function buildOcrTranslatePrompt(sourceLangHint, targetLang) {
  const hintLine =
    sourceLangHint && sourceLangHint !== "auto" && LANGUAGE_NAMES[sourceLangHint]
      ? "3. The text is likely in " + LANGUAGE_NAMES[sourceLangHint] +
        ". Confirm this, or correct it if the image clearly shows a different language.\n"
      : "3. Detect the source language automatically.\n";

  return (
    "You will perform OCR and translation in a single step on the attached image.\n\n" +
    "Steps:\n" +
    "1. Read all text visible in the image. Lines may wrap purely due to layout, not " +
    "because each line is a separate sentence — join wrapped lines into continuous " +
    "sentences/paragraphs, but keep visually distinct text blocks separate.\n" +
    "2. Mentally correct obvious OCR-style mistakes before using the text further " +
    "(do not mention these corrections in your output).\n" +
    hintLine +
    "4. Translate the extracted text into " + targetLang + ", producing natural, fluent " +
    "phrasing a native speaker would use — not a literal word-for-word translation.\n\n" +
    "Respond with ONLY raw JSON (no markdown, no code fences, no explanation) in exactly " +
    "this shape:\n" +
    '{"ocrText":"<the text exactly as extracted from the image>","detectedLanguage":"<source language name>","translatedText":"<translation>"}'
  );
}

function parseGeminiJson(geminiResponseData) {
  const candidates = geminiResponseData.candidates || [];
  const parts = (candidates[0] && candidates[0].content && candidates[0].content.parts) || [];
  const rawText = parts.map((p) => p.text || "").join("");
  try {
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    return { parsed: JSON.parse(cleaned), rawText };
  } catch (e) {
    return { parsed: null, rawText };
  }
}

function geminiErrorDetail(err) {
  return err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
}

// ---------- Logic xử lý Gemini (dùng chung) ----------
async function processOCRTranslate(imageBase64, sourceLangHint, targetLang, apiKey, model) {
  if (!apiKey) throw new Error("Gemini API key is not set.");
  if (!imageBase64) throw new Error("No image to process.");

  const prompt = buildOcrTranslatePrompt(sourceLangHint, targetLang);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const geminiResponse = await axios.post(
    url,
    {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: imageBase64 } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    },
    { headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey } }
  );

  const { parsed, rawText } = parseGeminiJson(geminiResponse.data);
  if (!parsed) throw new Error("Gemini did not return valid JSON: " + rawText);

  return {
    ocrText: parsed.ocrText || "",
    detectedLanguage: parsed.detectedLanguage || "",
    translatedText: parsed.translatedText || ""
  };
}

async function processTranslate(text, targetLang, apiKey, model) {
  if (!apiKey) throw new Error("Gemini API key is not set.");
  if (!text || !text.trim()) throw new Error("No text to translate.");

  const cleanedText = normalizeOcrText(text);
  const prompt =
    "You are a professional translator working with text extracted via OCR, so it may contain " +
    "minor recognition errors, broken line breaks, or stray characters.\n\n" +
    "Steps:\n" +
    "1. Read the TEXT below and mentally correct obvious OCR mistakes (e.g. 0/O, 1/l, " +
    "merged/split words) before translating — do not mention these corrections in your output.\n" +
    "2. Detect the source language.\n" +
    "3. Translate the corrected text into " + targetLang + ", producing natural, fluent phrasing " +
    "a native speaker would use — not a literal word-for-word translation.\n" +
    "4. Preserve the original meaning, tone, and any line breaks/formatting where reasonable.\n" +
    "5. If a word/phrase is ambiguous, choose the most contextually likely meaning rather than " +
    "the most literal one.\n\n" +
    "Respond with ONLY raw JSON (no markdown, no code fences, no explanation) in exactly this shape:\n" +
    '{"detectedLanguage":"<source language name>","translatedText":"<translation>"}\n\n' +
    "TEXT:\n" + cleanedText;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const geminiResponse = await axios.post(
    url,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    },
    { headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey } }
  );

  const { parsed, rawText } = parseGeminiJson(geminiResponse.data);
  if (!parsed) {
    // fallback: trả về raw text nếu không parse được
    return { translatedText: rawText.trim(), detectedLanguage: "" };
  }

  return {
    translatedText: parsed.translatedText || "",
    detectedLanguage: parsed.detectedLanguage || ""
  };
}

// ---------- Khởi tạo Express server ----------
const expressApp = express();
const port = 3000;

expressApp.use(cors());
expressApp.use(express.json({ limit: '50mb' }));

// Route health check
expressApp.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Route đọc file ảnh tạm
expressApp.post('/api/read-file', (req, res) => {
  const { path: filePath } = req.body;
  try {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString('base64');
    res.json({ base64 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route OCR + Translate
expressApp.post('/api/ocr-translate', async (req, res) => {
  try {
    const { imageBase64, sourceLangHint, targetLang, apiKey, model } = req.body;
    const result = await processOCRTranslate(imageBase64, sourceLangHint, targetLang, apiKey, model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route chỉ dịch text
expressApp.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang, apiKey, model } = req.body;
    const result = await processTranslate(text, targetLang, apiKey, model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Electron main window ----------
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 720,
    minWidth: 320,
    minHeight: 520,
    title: "OCR Translate",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  // Khởi động HTTP server trước khi tạo cửa sổ (hoặc sau cũng được)
  expressApp.listen(port, () => {
    console.log(`✅ HTTP server running at http://localhost:${port}`);
  });
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

// ---------- IPC Handlers (vẫn giữ cho cửa sổ Electron nếu cần) ----------
ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("save-config", (event, config) => {
  saveConfigFile(config);
  return { ok: true };
});

ipcMain.handle("paste-image", () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { error: "Clipboard does not contain an image. Take a screenshot first." };
  }
  const base64 = image.toPNG().toString("base64");
  return { base64 };
});

// Các handler cũ gọi lại hàm chung (nếu bạn muốn giữ tương thích với cửa sổ Electron)
ipcMain.handle("ocr-translate-image", async (event, args) => {
  try {
    const config = loadConfig();
    const apiKey = config.geminiApiKey;
    const model = config.geminiModel || "gemini-2.0-flash-lite";
    const result = await processOCRTranslate(args.imageBase64, args.sourceLangHint, args.targetLang, apiKey, model);
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("translate-text", async (event, args) => {
  try {
    const config = loadConfig();
    const apiKey = config.geminiApiKey;
    const model = config.geminiModel || "gemini-2.0-flash-lite";
    const result = await processTranslate(args.text, args.targetLang, apiKey, model);
    return result;
  } catch (err) {
    return { error: err.message };
  }
});