// Client-side image compression — a pre-optimization, not the source of
// truth. The server (see backend/lib/mediaProcessing.js) always re-compresses
// and generates its own thumbnail regardless of what arrives here; this just
// shrinks the upload so it leaves the browser faster and uses less of the
// person's data plan. Video is deliberately NOT compressed client-side —
// real video re-encoding needs something like ffmpeg.wasm (a multi-MB
// WASM download and a slow encode on the sender's device), so video is
// uploaded as-is and the backend's ffmpeg pipeline does that work instead.

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.85;
const SKIP_IF_UNDER_BYTES = 800 * 1024; // not worth re-encoding small images

// Formats the browser's <canvas> can't reliably decode/re-encode across
// browsers (notably HEIC/HEIF from iPhones in some browsers). Sent as-is —
// the server's sharp pipeline (built with libheif) handles these fine.
const SKIP_COMPRESSION_TYPES = new Set(["image/heic", "image/heif", "image/svg+xml"]);

function loadImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("couldn't decode that image"));
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("compression produced no output"))),
      mimeType,
      quality
    );
  });
}

// Returns { blob, fileName } — either the compressed result, or the
// original File unchanged (wrapped in the same shape) if compression
// wasn't applicable or didn't help.
export async function compressImageIfNeeded(file) {
  const original = { blob: file, fileName: file.name };

  if (!file.type.startsWith("image/") || SKIP_COMPRESSION_TYPES.has(file.type)) {
    return original;
  }
  if (file.size < SKIP_IF_UNDER_BYTES) {
    return original;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    if (img.naturalWidth <= MAX_DIMENSION && img.naturalHeight <= MAX_DIMENSION && file.size < 2 * 1024 * 1024) {
      // Already small enough dimension-wise and not huge — skip.
      return original;
    }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // PNG stays PNG (lossless — canvas doesn't expose an easy "does this
    // actually use alpha" check, and re-encoding a transparent PNG as JPEG
    // would silently destroy transparency). Everything else becomes a
    // quality-limited JPEG, which is what most camera-roll photos already are.
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const quality = outputType === "image/jpeg" ? JPEG_QUALITY : undefined;
    const blob = await canvasToBlob(canvas, outputType, quality);

    if (blob.size >= file.size) {
      // Recompression sometimes loses to a well-optimized original — don't
      // ship something bigger than what we started with.
      return original;
    }

    const fileName = outputType === "image/jpeg" ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
    return { blob, fileName };
  } catch (err) {
    console.warn("[image compression] skipped, sending original:", err.message);
    return original;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
