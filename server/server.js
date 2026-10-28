// server/server.js
require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// CEP panel chạy từ file:// nên origin là null — cho phép tất cả
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "25mb" }));

/* ── Health ── */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ──────────────────────────────────────────────
   /api/read-file
   Đọc file PNG từ đường dẫn trên máy rồi trả về base64.
   Dùng sau khi exportSelectionAsImage() của ExtendScript lưu file.
────────────────────────────────────────────── */
app.post("/api/read-file", (req, res) => {
  const { path: filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "Missing path." });

  // Bảo mật: chỉ cho phép đọc trong thư mục temp hệ thống
  const resolved = path.resolve(filePath);
  const tmpDir   = require("os").tmpdir();
  if (!resolved.startsWith(tmpDir) && !resolved.startsWith(path.join(tmpDir))) {
    return res.status(403).json({ error: "Access denied: path outside temp directory." });
  }

  try {
    const buf    = fs.readFileSync(resolved);
    const base64 = buf.toString("base64");
    return res.json({ base64 });
  } catch (err) {
    return res.status(500).json({ error: "Could not read file: " + err.message });
  }
});

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function normalizeOcrText(rawText) {
  if (!rawText) return rawText;
  return rawText
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((para) =>
      para.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .join("\n\n");
}

function parseGeminiJson(data) {
  const parts  = data?.candidates?.[0]?.content?.parts || [];
  const rawText = parts.map((p) => p.text || "").join("");
  try {
    return { parsed: JSON.parse(rawText.replace(/```json|```/g, "").trim()), rawText };
  } catch {
    return { parsed: null, rawText };
  }
}

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function geminiHeaders(apiKey) {
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}

const LANG_NAMES = {
  vie: "Vietnamese", eng: "English", chs: "Chinese (Simplified)",
  cht: "Chinese (Traditional)", jpn: "Japanese", kor: "Korean",
  fre: "French",  ger: "German", spa: "Spanish", por: "Portuguese",
  ita: "Italian", rus: "Russian", ara: "Arabic", tha: "Thai"
};

/* ──────────────────────────────────────────────
   /api/ocr-translate
   Gộp OCR + dịch thành 1 lần gọi Gemini duy nhất.
   body: { imageBase64, sourceLangHint, targetLang, apiKey, model }
   API key được client truyền lên — không cần .env cho key nữa.
────────────────────────────────────────────── */
app.post("/api/ocr-translate", async (req, res) => {
  const { imageBase64, sourceLangHint, targetLang, apiKey, model } = req.body || {};

  if (!apiKey)       return res.status(400).json({ error: "API key is required." });
  if (!imageBase64)  return res.status(400).json({ error: "No image provided." });
  if (!targetLang)   return res.status(400).json({ error: "targetLang is required." });

  const usedModel = model || "gemini-2.0-flash-lite";

  const hintLine =
    sourceLangHint && sourceLangHint !== "auto" && LANG_NAMES[sourceLangHint]
      ? `3. The text is likely in ${LANG_NAMES[sourceLangHint]}. Confirm or correct if wrong.\n`
      : "3. Detect the source language automatically.\n";

  const prompt =
    "Perform OCR and translation in one step on the attached image.\n\n" +
    "Steps:\n" +
    "1. Read all visible text. Join wrapped lines into continuous sentences/paragraphs; " +
    "keep visually distinct blocks separate.\n" +
    "2. Silently fix obvious OCR-style recognition errors before proceeding.\n" +
    hintLine +
    `4. Translate the extracted text into ${targetLang} with natural, fluent phrasing — ` +
    "not a literal word-for-word translation.\n\n" +
    "Respond with ONLY raw JSON (no markdown, no fences):\n" +
    '{"ocrText":"...","detectedLanguage":"...","translatedText":"..."}';

  try {
    const response = await axios.post(
      geminiUrl(usedModel),
      {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: imageBase64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      },
      { headers: geminiHeaders(apiKey) }
    );

    const { parsed, rawText } = parseGeminiJson(response.data);
    if (!parsed) return res.status(502).json({ error: "Gemini returned invalid JSON: " + rawText });

    return res.json({
      ocrText:         parsed.ocrText         || "",
      detectedLanguage: parsed.detectedLanguage || "",
      translatedText:  parsed.translatedText   || ""
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    return res.status(502).json({ error: "Gemini request failed: " + detail });
  }
});

/* ──────────────────────────────────────────────
   /api/translate
   Chỉ dịch text (không kèm ảnh) — dùng khi người dùng sửa OCR text
   hoặc đổi ngôn ngữ đích.
   body: { text, targetLang, apiKey, model }
────────────────────────────────────────────── */
app.post("/api/translate", async (req, res) => {
  const { text, targetLang, apiKey, model } = req.body || {};

  if (!apiKey)            return res.status(400).json({ error: "API key is required." });
  if (!text?.trim())      return res.status(400).json({ error: "No text to translate." });
  if (!targetLang)        return res.status(400).json({ error: "targetLang is required." });

  const usedModel  = model || "gemini-2.0-flash-lite";
  const cleanedText = normalizeOcrText(text);

  const prompt =
    "You are a professional translator for OCR-extracted text (may have minor errors).\n\n" +
    "Steps:\n" +
    "1. Silently correct obvious OCR mistakes (0/O, 1/l, merged/split words).\n" +
    "2. Detect the source language.\n" +
    `3. Translate into ${targetLang} with natural, fluent phrasing.\n` +
    "4. Preserve meaning, tone, and reasonable formatting.\n\n" +
    "Respond with ONLY raw JSON (no markdown, no fences):\n" +
    '{"detectedLanguage":"...","translatedText":"..."}\n\n' +
    "TEXT:\n" + cleanedText;

  try {
    const response = await axios.post(
      geminiUrl(usedModel),
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      },
      { headers: geminiHeaders(apiKey) }
    );

    const { parsed, rawText } = parseGeminiJson(response.data);
    if (!parsed) return res.json({ translatedText: rawText.trim(), detectedLanguage: "" });

    return res.json({
      translatedText:   parsed.translatedText   || "",
      detectedLanguage: parsed.detectedLanguage  || ""
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    return res.status(502).json({ error: "Gemini request failed: " + detail });
  }
});

app.listen(PORT, () => {
  console.log(`OCR Translate server running at http://localhost:${PORT}`);
});