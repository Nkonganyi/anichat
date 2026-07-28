import { useRef, useState, useCallback } from "react";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined; // let the browser pick its own default
}

const MAX_RECORDING_SECONDS = 180; // 3 minutes — keeps voice notes short, matches the 8MB server-side cap

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");

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
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
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
      setError("Couldn't access your microphone — check your browser's permission settings.");
    }
  }, [cleanupStream]);

  // Resolves with { blob, duration } once the recorder actually finishes.
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
      resultResolveRef.current = null; // don't resolve — this is a cancel, not a send
      mediaRecorderRef.current.stop();
    }
    cleanupStream();
    setIsRecording(false);
    setElapsedSeconds(0);
  }, [cleanupStream]);

  return { isRecording, elapsedSeconds, error, startRecording, stopRecording, cancelRecording, maxSeconds: MAX_RECORDING_SECONDS };
}
