import { useRef, useState, useCallback } from "react";

const MIME_CANDIDATES = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

const MAX_RECORDING_SECONDS = 60; // short circular clips, not full videos

export function useVideoNoteRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [stream, setStream] = useState(null); // exposed so a <video> preview can bind srcObject live

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);
  const resultResolveRef = useRef(null);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    clearInterval(timerRef.current);
    setStream(null);
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Video recording isn't supported in this browser.");
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 320, facingMode: "user" },
        audio: true,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Use only the base MIME type (e.g. "video/webm"), not the full
        // string with a codecs parameter (e.g. "video/webm;codecs=vp8,opus").
        // The unquoted comma inside that codecs value is legal in a Blob's
        // type, but once it lands in the multipart Content-Type header for
        // the uploaded file part, the server's multipart parser treats the
        // comma as a delimiter and mis-parses the header, reporting the
        // file as "text/plain" instead of a video type. The codecs info
        // isn't needed for storage or playback — the container format is
        // already baked into the recorded bytes — so it's safe to drop.
        const baseMimeType = (recorder.mimeType || "video/webm").split(";")[0].trim();
        const blob = new Blob(chunksRef.current, { type: baseMimeType });
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
        cleanupStream();
        if (resultResolveRef.current) {
          resultResolveRef.current({ blob, duration });
          resultResolveRef.current = null;
        }
      };

      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      recorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
        setElapsedSeconds(secs);
        if (secs >= MAX_RECORDING_SECONDS) {
          recorder.stop();
          setIsRecording(false);
        }
      }, 250);
    } catch {
      setError("Couldn't access your camera/microphone — check your browser's permission settings.");
    }
  }, [cleanupStream]);

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        resolve(null);
        return;
      }
      resultResolveRef.current = resolve;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    });
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      resultResolveRef.current = null;
      mediaRecorderRef.current.stop();
    }
    cleanupStream();
    setIsRecording(false);
    setElapsedSeconds(0);
  }, [cleanupStream]);

  return {
    isRecording,
    elapsedSeconds,
    error,
    stream,
    startRecording,
    stopRecording,
    cancelRecording,
    maxSeconds: MAX_RECORDING_SECONDS,
  };
}
