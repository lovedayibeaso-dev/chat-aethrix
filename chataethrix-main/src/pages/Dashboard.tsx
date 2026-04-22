import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Sparkles, MessageSquare, Settings, LogOut, User, Crown,
  ArrowLeft, Save, Loader2,
} from "lucide-react";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [messageCount, setMessageCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "subscription" | "settings">("profile");

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    // Load profile
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile) {
        setDisplayName(profile.display_name || "");
        setAvatarUrl(profile.avatar_url || "");
      } else {
        setDisplayName(user.user_metadata?.display_name || "");
      }
    })();

    // Count messages
    (async () => {
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("role", "user");
      setMessageCount(count || 0);
    })();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({
        user_id: user.id,
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error("Failed to save profile");
    else toast.success("Profile saved!");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    { id: "subscription" as const, label: "Subscription", icon: Crown },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background bg-grid">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary text-glow-green" />
          <span className="font-mono font-bold text-lg text-primary text-glow-green">CHAT AETHRIX</span>
        </div>
        <div className="flex gap-2">
          <Link to="/chat">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground font-mono">
              <ArrowLeft className="h-4 w-4" /> Back to Chat
            </Button>
          </Link>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">
          <span className="text-primary text-glow-green">Dashboard</span>
        </h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground">Messages Sent</span>
            </div>
            <span className="text-2xl font-bold text-foreground">{messageCount}</span>
          </div>
          <div className="p-4 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground">Current Plan</span>
            </div>
            <span className="text-2xl font-bold text-primary">Free</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border/50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-mono transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="p-6 rounded-lg border border-border/50 bg-card/50">
              <h3 className="text-lg font-bold font-mono text-foreground mb-4">Your Profile</h3>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">Email</label>
                  <Input value={user?.email || ""} disabled className="bg-muted/30 border-border/50" />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">Display Name</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    className="bg-muted/50 border-border/50 focus:border-primary"
                  />
                </div>
                <Button onClick={saveProfile} disabled={saving} className="glow-green font-mono gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Profile
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "subscription" && (
          <div className="space-y-6">
            <div className="p-6 rounded-lg border border-border/50 bg-card/50">
              <h3 className="text-lg font-bold font-mono text-foreground mb-4">Subscription</h3>
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-foreground">Free Plan</span>
                  <span className="text-xs font-mono text-primary px-2 py-0.5 rounded-full border border-primary/30">Active</span>
                </div>
                <p className="text-xs text-muted-foreground">Limited chats and image generations per day.</p>
              </div>
              <Link to="/pricing">
                <Button className="glow-green font-mono gap-2">
                  <Crown className="h-4 w-4" /> Upgrade Plan
                </Button>
              </Link>
            </div>

            <div className="p-6 rounded-lg border border-border/50 bg-card/50">
              <h3 className="text-lg font-bold font-mono text-foreground mb-4">Usage</h3>
              <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-muted-foreground">Daily Messages</span>
                  <span className="text-foreground">{Math.min(messageCount, 10)} / 10</span>
                </div>
                <Progress value={Math.min(messageCount, 10) * 10} className="h-2" />
              </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="p-6 rounded-lg border border-border/50 bg-card/50">
              <h3 className="text-lg font-bold font-mono text-foreground mb-4">Account Settings</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-3 border-b border-border/30">
                  <div>
                    <p className="text-sm text-foreground font-mono">Email Notifications</p>
                    <p className="text-xs text-muted-foreground">Receive updates about new features</p>
                  </div>
                  <Button variant="outline" size="sm" className="font-mono text-xs">Manage</Button>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border/30">
                  <div>
                    <p className="text-sm text-foreground font-mono">Delete Account</p>
                    <p className="text-xs text-muted-foreground">Permanently delete your account and data</p>
                  </div>
                  <Button variant="outline" size="sm" className="font-mono text-xs text-destructive border-destructive/30 hover:bg-destructive/10">Delete</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
