// scan.js — reads the printed name off a photographed Magic card, entirely
// in the browser, using Tesseract.js (loaded globally as `window.Tesseract`
// via a <script> tag in index.html — no server, no cost). Accuracy is
// "good enough to shortcut typing, not perfect" — the caller always shows
// the guess back to the person for confirmation before it's added.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't open that image."));
    img.src = URL.createObjectURL(file);
  });
}

// Card names sit in a band near the top of the card. Cropping to that strip
// before OCR avoids rules text/flavor text confusing the reader, and is a
// big accuracy win for free.
function cropTopStrip(imgEl, fraction = 0.16) {
  const canvas = document.createElement("canvas");
  canvas.width = imgEl.naturalWidth;
  canvas.height = Math.max(1, Math.round(imgEl.naturalHeight * fraction));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight, 0, 0, imgEl.naturalWidth, canvas.height);
  return canvas;
}

function bestGuessName(rawText) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  // Strip a trailing mana-cost-looking fragment OCR sometimes glues onto the name.
  return lines[0].replace(/[{}\d]+$/g, "").trim();
}

async function scanCardName(file, onProgress) {
  if (!window.Tesseract) {
    throw new Error("The OCR engine hasn't loaded yet — check your connection and try again.");
  }
  const img = await loadImage(file);
  const strip = cropTopStrip(img);
  const worker = await window.Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") onProgress(Math.round((m.progress || 0) * 100));
    },
  });
  try {
    const { data } = await worker.recognize(strip);
    return { guess: bestGuessName(data.text || ""), rawText: (data.text || "").trim() };
  } finally {
    await worker.terminate();
  }
}

export const Scan = { scanCardName };
