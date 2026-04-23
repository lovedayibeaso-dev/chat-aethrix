import { AudioLines, Loader2, Mic, MicOff, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VoiceOverlayProps {
  open: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  transcript: string;
  onClose: () => void;
  onOrbClick: () => void;
  onStopSpeaking: () => void;
}

export function VoiceOverlay({
  open,
  isRecording,
  isProcessing,
  isSpeaking,
  transcript,
  onClose,
  onOrbClick,
  onStopSpeaking,
}: VoiceOverlayProps) {
  if (!open) return null;

  const status = isRecording ? "Listening" : isProcessing ? "Thinking" : isSpeaking ? "Speaking" : "Ready";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-5 w-5" />
          <span className="font-mono text-sm">Chat Aethrix</span>
        </div>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="relative mb-8 flex h-56 w-56 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-primary/20 animate-aethrix-ripple" />
          <span className="absolute inset-5 rounded-full border border-primary/25 animate-aethrix-ripple-delayed" />
          <button
            type="button"
            onClick={onOrbClick}
            className="voice-orb relative z-10 flex h-36 w-36 items-center justify-center rounded-full border border-primary/25 bg-card text-primary transition-transform duration-300 hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={isRecording ? "Stop listening" : "Start voice chat"}
          >
            {isProcessing ? (
              <Loader2 className="h-10 w-10 animate-spin" />
            ) : isRecording ? (
              <MicOff className="h-10 w-10" />
            ) : isSpeaking ? (
              <AudioLines className="h-10 w-10 animate-aethrix-pulse" />
            ) : (
              <Mic className="h-10 w-10" />
            )}
          </button>
        </div>

        <div className="space-y-3 max-w-sm">
          <p className="text-lg font-semibold text-foreground">{status}</p>
          <p className="min-h-[3.5rem] text-sm text-muted-foreground">
            {transcript || "Tap the glowing orb to talk with Aethrix."}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 px-6 pb-10">
        <Button variant="outline" className="gap-2 border-border/50 bg-card/60" onClick={onOrbClick}>
          {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {isRecording ? "Stop" : "Speak"}
        </Button>
        <Button
          variant="outline"
          className="gap-2 border-border/50 bg-card/60"
          onClick={onStopSpeaking}
          disabled={!isSpeaking}
        >
          {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          Stop voice
        </Button>
      </div>
    </div>
  );
}