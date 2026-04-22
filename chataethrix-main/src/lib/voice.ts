import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Records mic audio and transcribes it via the speech-to-text edge function.
 * Falls back gracefully with clear, actionable error messages.
 */
export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        return {
          ok: false,
          error: "Microphone is not supported in this browser. Try Chrome, Edge, or Safari.",
        };
      }

      // Pre-check permission state for a clearer error message on Android/Chrome
      try {
        if ("permissions" in navigator) {
          const status = await (navigator.permissions as Permissions).query({
            name: "microphone" as PermissionName,
          });
          if (status.state === "denied") {
            return {
              ok: false,
              error: "Microphone is blocked. Tap the lock icon in your browser address bar, allow Microphone, then try again.",
            };
          }
        }
      } catch {
        // Safari/Firefox may not support the query — ignore and try directly
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      return { ok: true };
    } catch (err: any) {
      const name = err?.name || "";
      let msg = "Could not access microphone.";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        msg =
          "Microphone permission denied. Click the lock icon in your browser address bar, allow microphone, then try again.";
      } else if (name === "NotFoundError") {
        msg = "No microphone found on this device.";
      } else if (name === "NotReadableError") {
        msg = "Your microphone is being used by another app. Close other apps and try again.";
      } else if (name === "AbortError") {
        msg = "Microphone access was interrupted. Please try again.";
      }
      return { ok: false, error: msg };
    }
  }, []);

  const stopAndTranscribe = useCallback(
    async (): Promise<{ text: string | null; error?: string }> => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return { text: null };

      const blob: Blob = await new Promise((resolve) => {
        recorder.onstop = () => {
          const b = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          resolve(b);
        };
        try {
          recorder.requestData();
        } catch {}
        recorder.stop();
      });

      // Stop tracks
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      setIsRecording(false);

      if (blob.size < 1000) {
        return { text: null, error: "Recording was too short. Try again." };
      }

      setIsProcessing(true);
      try {
        const base64 = await blobToBase64(blob);
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token || "";

        const resp = await fetch(`${FUNCTIONS_URL}/speech-to-text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ audio: base64, mimeType: blob.type }),
        });

        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          return { text: null, error: j.error || "Transcription failed" };
        }
        const data = await resp.json();
        return { text: (data.text || "").trim() };
      } catch (e) {
        return { text: null, error: e instanceof Error ? e.message : "Transcription failed" };
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const cancel = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    setIsProcessing(false);
  }, []);

  return { isRecording, isProcessing, start, stopAndTranscribe, cancel };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

/**
 * Plays AI text as speech using the text-to-speech edge function.
 * The fetch call is made *after* a user gesture, but Audio playback is
 * still allowed because it's the same gesture-initiated call chain.
 */
export function useTextToSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const getAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    audioContextRef.current = new AudioContextCtor();
    return audioContextRef.current;
  }, []);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const prime = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const context = getAudioContext();
    if (!context) {
      return { ok: false, error: "Audio playback is not supported in this browser." };
    }

    if (context.state !== "running") {
      await context.resume();
    }

    return { ok: true };
  }, [getAudioContext]);

  const speak = useCallback(
    async (text: string, voice: string = "alloy"): Promise<{ ok: boolean; error?: string }> => {
      stop();
      if (!text.trim()) return { ok: false, error: "No text to speak" };

      try {
        const primed = await prime();
        if (!primed.ok) return primed;

        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token || "";

        const resp = await fetch(`${FUNCTIONS_URL}/text-to-speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ text, voice }),
        });

        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          return { ok: false, error: j.error || "Voice playback failed" };
        }

        const context = getAudioContext();
        if (!context) {
          return { ok: false, error: "Audio playback is not supported in this browser." };
        }

        const audioBuffer = await resp.arrayBuffer();
        const decoded = await context.decodeAudioData(audioBuffer.slice(0));
        const source = context.createBufferSource();
        source.buffer = decoded;
        source.connect(context.destination);
        sourceRef.current = source;
        setIsSpeaking(true);

        source.onended = () => {
          setIsSpeaking(false);
          if (sourceRef.current === source) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
          }
        };

        source.start(0);
        return { ok: true };
      } catch (e) {
        setIsSpeaking(false);
        return { ok: false, error: e instanceof Error ? e.message : "Voice playback failed" };
      }
    },
    [getAudioContext, prime, stop]
  );

  return { isSpeaking, speak, stop, prime };
}
