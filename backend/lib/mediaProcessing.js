// Shared image/video compression pipeline (Milestone 17).
//
// Both the DM and group "send a file" routes funnel image/video uploads
// through here. Documents (pdf, zip, etc.) never touch this module — they
// stay on the plain generic-file path that Milestone 16 already built.
//
// Images are resized + re-encoded with sharp. Videos are transcoded +
// thumbnailed with ffmpeg (via ffmpeg-static, so no system ffmpeg install
// is required — the binary ships inside node_modules).

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const IMAGE_MAX_DIMENSION = 1920; // full version — plenty for viewing, not archival-original
const IMAGE_THUMB_DIMENSION = 400;
const IMAGE_QUALITY = 82;

const VIDEO_MAX_WIDTH = 1280; // full (compressed) version
const VIDEO_CRF = 28; // higher = smaller/lower quality; 28 is a reasonable "chat app" default
const THUMB_MAX_WIDTH = 400;

function categoryForMimeType(mimetype) {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return null;
}

// sharp can't reliably decode a handful of formats browsers still send
// (e.g. HEIC without extra libheif support in some environments). If
// metadata reading fails outright, the caller falls back to treating this
// as a generic file rather than a broken "image" message.
async function processImage(originalPath, uploadDir, baseName) {
  const image = sharp(originalPath, { failOn: "none" }).rotate(); // .rotate() with no args = auto-orient from EXIF, then strip it
  const metadata = await image.metadata();
  const hasAlpha = !!metadata.hasAlpha;
  const format = hasAlpha ? "png" : "jpeg";
  const ext = hasAlpha ? ".png" : ".jpg";

  const fullPath = path.join(uploadDir, `${baseName}_full${ext}`);
  const thumbPath = path.join(uploadDir, `${baseName}_thumb${ext}`);

  let fullPipeline = sharp(originalPath, { failOn: "none" }).rotate().resize({
    width: IMAGE_MAX_DIMENSION,
    height: IMAGE_MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });
  fullPipeline = format === "jpeg" ? fullPipeline.jpeg({ quality: IMAGE_QUALITY }) : fullPipeline.png({ compressionLevel: 8 });
  await fullPipeline.toFile(fullPath);

  let thumbPipeline = sharp(originalPath, { failOn: "none" }).rotate().resize({
    width: IMAGE_THUMB_DIMENSION,
    height: IMAGE_THUMB_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });
  thumbPipeline = format === "jpeg" ? thumbPipeline.jpeg({ quality: IMAGE_QUALITY }) : thumbPipeline.png({ compressionLevel: 8 });
  await thumbPipeline.toFile(thumbPath);

  return {
    type: "image",
    fullPath,
    thumbPath,
    durationSeconds: null,
  };
}

function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err || !data?.format?.duration) return resolve(null);
      resolve(Math.round(data.format.duration));
    });
  });
}

function transcodeVideo(originalPath, fullPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(originalPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-crf", String(VIDEO_CRF),
        "-preset", "veryfast",
        "-movflags", "+faststart", // lets the browser start playback before the whole file downloads
        "-vf", `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`, // never upscale, only cap width; -2 keeps height even (required by libx264)
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(fullPath);
  });
}

function extractThumbnail(originalPath, uploadDir, thumbFilename, atSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(originalPath)
      .on("end", resolve)
      .on("error", reject)
      .screenshots({
        timestamps: [atSeconds],
        filename: thumbFilename,
        folder: uploadDir,
        size: `${THUMB_MAX_WIDTH}x?`,
      });
  });
}

async function processVideo(originalPath, uploadDir, baseName) {
  const fullPath = path.join(uploadDir, `${baseName}_full.mp4`);
  const thumbFilename = `${baseName}_thumb.jpg`;
  const thumbPath = path.join(uploadDir, thumbFilename);

  const duration = await probeDuration(originalPath);
  // Grab the thumbnail frame a little into the clip (not frame 0, which is
  // often a black/blank flash frame on phone-recorded video), but never
  // past the end of a very short clip.
  const thumbAt = duration && duration > 1 ? Math.min(1, duration * 0.1) : 0;

  await transcodeVideo(originalPath, fullPath);
  await extractThumbnail(originalPath, uploadDir, thumbFilename, thumbAt);

  return {
    type: "video",
    fullPath,
    thumbPath,
    durationSeconds: duration,
  };
}

// Returns null if this file isn't an image/video (caller should fall back
// to the generic-file path), or throws if it IS one but processing failed
// (caller should also fall back to generic-file, but log the failure —
// a corrupt/unsupported upload shouldn't just vanish).
async function processMediaUpload(file) {
  const category = categoryForMimeType(file.mimetype);
  if (!category) return null;

  const uploadDir = path.dirname(file.path);
  const baseName = path.basename(file.path, path.extname(file.path));

  const result =
    category === "image"
      ? await processImage(file.path, uploadDir, baseName)
      : await processVideo(file.path, uploadDir, baseName);

  // The original raw upload has been superseded by the full/thumb pair —
  // no reason to keep three copies of the same media on disk.
  fs.unlink(file.path, () => {});

  return result;
}

// Route-facing helper: given a just-uploaded multer file (stored under
// uploads/files/), returns the fields to insert into messages/group_messages.
// Falls back to a plain 'file' record — using the original untouched upload —
// if the file isn't image/video, or if it is but processing blew up (e.g. a
// corrupt or codec AniChat's ffmpeg build doesn't support). A failed
// compression attempt should never cost someone their upload.
async function resolveMediaFields(file) {
  const genericFallback = () => ({
    type: "file",
    relativeContentPath: `files/${file.filename}`,
    relativeThumbnailPath: null,
    fileName: file.originalname,
    fileSizeBytes: file.size,
    durationSeconds: null,
  });

  const category = categoryForMimeType(file.mimetype);
  if (!category) return genericFallback();

  try {
    const processed = await processMediaUpload(file);
    const fullStat = fs.statSync(processed.fullPath);
    return {
      type: processed.type,
      relativeContentPath: `files/${path.basename(processed.fullPath)}`,
      relativeThumbnailPath: `files/${path.basename(processed.thumbPath)}`,
      fileName: file.originalname,
      fileSizeBytes: fullStat.size,
      durationSeconds: processed.durationSeconds,
    };
  } catch (err) {
    console.error(`[media processing] failed for ${file.originalname} (${file.mimetype}):`, err.message);
    return genericFallback();
  }
}

module.exports = { processMediaUpload, categoryForMimeType, resolveMediaFields };
