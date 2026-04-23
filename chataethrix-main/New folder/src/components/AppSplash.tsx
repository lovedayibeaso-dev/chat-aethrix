import { Sparkles } from "lucide-react";

export function AppSplash() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5 animate-aethrix-fade-in">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-primary/25 bg-card/80 shadow-[0_0_40px_hsl(var(--primary)/0.2)] animate-aethrix-pulse">
          <Sparkles className="h-9 w-9 text-primary" />
        </div>
        <div className="space-y-2 text-center">
          <p className="font-mono text-2xl tracking-[0.3em] text-primary text-glow-green">CHAT AETHRIX</p>
          <div className="mx-auto h-px w-24 bg-primary/30" />
        </div>
      </div>
    </div>
  );
}