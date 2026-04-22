import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";

const VOICE_KEY = "aethrix.voice";
const AUTOSPEAK_KEY = "aethrix.autoSpeak";
const WEBSEARCH_KEY = "aethrix.webSearch";

const VOICES = [
  { id: "alloy", label: "Alloy — neutral" },
  { id: "verse", label: "Verse — warm" },
  { id: "ballad", label: "Ballad — calm" },
  { id: "ash", label: "Ash — energetic" },
  { id: "sage", label: "Sage — thoughtful" },
  { id: "coral", label: "Coral — bright" },
];

export default function Settings() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState<string>("free");
  const [voice, setVoice] = useState<string>(localStorage.getItem(VOICE_KEY) || "alloy");
  const [autoSpeak, setAutoSpeak] = useState<boolean>(localStorage.getItem(AUTOSPEAK_KEY) === "true");
  const [webPref, setWebPref] = useState<boolean>(localStorage.getItem(WEBSEARCH_KEY) !== "false");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, subscription_tier")
        .eq("user_id", user.id)
        .single();
      if (data) {
        setDisplayName(data.display_name || "");
        setTier(data.subscription_tier || "free");
      }
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("user_id", user.id);
    localStorage.setItem(VOICE_KEY, voice);
    localStorage.setItem(AUTOSPEAK_KEY, String(autoSpeak));
    localStorage.setItem(WEBSEARCH_KEY, String(webPref));
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/chat")} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="font-mono text-lg text-primary text-glow-green">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        <section className="space-y-3">
          <h2 className="font-mono text-sm text-muted-foreground">Account</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>
          <p className="text-xs text-muted-foreground">Email: {user?.email}</p>
          <p className="text-xs text-muted-foreground">Plan: <span className="text-primary font-mono uppercase">{tier}</span></p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => navigate("/pricing")}>Manage plan</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>Open dashboard</Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-sm text-muted-foreground">Voice</h2>
          <div className="space-y-2">
            <Label>AI voice</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
            <div>
              <p className="text-sm">Auto-read replies aloud</p>
              <p className="text-xs text-muted-foreground">Aethrix will speak every answer.</p>
            </div>
            <Switch checked={autoSpeak} onCheckedChange={setAutoSpeak} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-sm text-muted-foreground">Knowledge</h2>
          <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
            <div>
              <p className="text-sm">Allow web search</p>
              <p className="text-xs text-muted-foreground">Aethrix can pull live info from the web when you ask about news, current events, or "search/find/look up" topics.</p>
            </div>
            <Switch checked={webPref} onCheckedChange={setWebPref} />
          </div>
        </section>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" className="text-destructive" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
          <Button onClick={save} disabled={saving} className="glow-green">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save changes
          </Button>
        </div>
      </main>
    </div>
  );
}