import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, ChatMessage, ChatMessageContent } from "@/lib/chat-stream";
import { useVoiceRecorder, useTextToSpeech } from "@/lib/voice";
import { uploadChatAttachment, generateImage } from "@/lib/chat-features";
import { detectImageIntent, shouldAutoSearchWeb } from "@/lib/chat-intents";
import { VoiceOverlay } from "@/components/chat/VoiceOverlay";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import {
  Sparkles, Plus, Send, Trash2, Menu, X, LogOut, Settings, Loader2,
  Copy, RefreshCw, Check, LayoutDashboard, Volume2, VolumeX,
  Paperclip, Search, Pencil, AudioLines,
} from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

interface Attachment {
  id?: string;
  url: string;
  type: string; // mime type
  previewUrl?: string;
  isUploading?: boolean;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  generatedImage?: string;
}

const STARTER_PROMPTS = [
  "What really happened at Area 51?",
  "Generate an image of an ancient pyramid at sunset",
  "Search the web: latest UFO disclosure news",
  "Explain the mystery of the Bermuda Triangle",
];

export default function Chat() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => localStorage.getItem("aethrix.autoSpeak") === "true");
  const ttsVoice = (typeof window !== "undefined" && localStorage.getItem("aethrix.voice")) || "alloy";
  const allowWebSearch = (typeof window === "undefined") || localStorage.getItem("aethrix.webSearch") !== "false";
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialPromptSent = useRef(false);

  const recorder = useVoiceRecorder();
  const tts = useTextToSpeech();

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  // Daily limit check
  useEffect(() => {
    if (!user) return;
    const checkLimit = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("daily_message_count, last_message_date, subscription_tier")
        .eq("user_id", user.id)
        .single();
      if (!profile) return;
      const today = new Date().toISOString().split("T")[0];
      const isNewDay = profile.last_message_date !== today;
      const currentCount = isNewDay ? 0 : profile.daily_message_count;
      const tier = profile.subscription_tier || "free";
      const limits: Record<string, number> = { free: 10, pro: 100, premium: 999999 };
      const limit = limits[tier] || limits.free;
      setLimitReached(currentCount >= limit);
    };
    checkLimit();
  }, [user, messages.length]);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setConversations(data);
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Handle initial prompt from navigation state
  useEffect(() => {
    if (!user || authLoading || initialPromptSent.current) return;
    const state = location.state as { prompt?: string } | null;
    if (state?.prompt) {
      initialPromptSent.current = true;
      window.history.replaceState({}, document.title);
      setTimeout(() => sendMessage(state.prompt), 500);
    }
  }, [user, authLoading, location.state]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConvo) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeConvo)
        .order("created_at", { ascending: true });
      if (data) {
        setMessages(data.map((m) => parseStoredMessage(m.id, m.role, m.content)));
      }
    })();
  }, [activeConvo]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop voice playback when leaving
  useEffect(() => () => tts.stop(), []);

  const createConversation = async (firstMessage: string) => {
    if (!user) return null;
    const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? "..." : "");
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title })
      .select()
      .single();
    if (error) { toast.error("Failed to create conversation"); return null; }
    setConversations((prev) => [data, ...prev]);
    setActiveConvo(data.id);
    return data.id;
  };

  // ---- Image generation flow ----
  const handleImageGeneration = async (prompt: string, convoId: string) => {
    setIsStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "🎨 Generating your image..." },
    ]);

    const { imageUrl, error } = await generateImage(prompt);

    if (error || !imageUrl) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `⚠️ ${error || "Couldn't generate the image."}`,
        };
        return updated;
      });
      setIsStreaming(false);
      toast.error(error || "Image generation failed");
      return;
    }

    const replyText = "Here's your image:";
    const finalMsg: Message = {
      role: "assistant",
      content: replyText,
      generatedImage: imageUrl,
    };
    setMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = finalMsg;
      return updated;
    });

    await supabase.from("messages").insert({
      conversation_id: convoId,
      role: "assistant",
      content: serializeMessage(replyText, undefined, imageUrl),
    });

    setIsStreaming(false);
  };

  // ---- Main send ----
  const sendMessage = async (text?: string) => {
    const messageText = (text ?? input).trim();
    if ((!messageText && pendingAttachments.length === 0) || isStreaming) return;
    if (uploadingFile || pendingAttachments.some((attachment) => attachment.isUploading)) {
      toast.error("Please wait for the image to finish uploading.");
      return;
    }

    if (limitReached) {
      toast.error("You've reached your daily limit.", {
        action: { label: "Upgrade", onClick: () => navigate("/pricing") },
        duration: 5000,
      });
      return;
    }

    const attachments = pendingAttachments;
    setInput("");
    setPendingAttachments([]);

    const imageIntent = detectImageIntent(messageText);
    const useWebSearch = allowWebSearch && shouldAutoSearchWeb(messageText);

    let convoId = activeConvo;
    if (!convoId) {
      convoId = await createConversation(messageText || "Image upload");
      if (!convoId) return;
    }

    const userMsg: Message = {
      role: "user",
      content: messageText,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);

    await supabase.from("messages").insert({
      conversation_id: convoId,
      role: "user",
      content: serializeMessage(messageText, attachments),
    });

    // Image generation shortcut
    if (imageIntent.shouldGenerate && attachments.length === 0) {
      await handleImageGeneration(imageIntent.prompt, convoId);
      return;
    }

    setIsStreaming(true);
    let assistantContent = "";

    // Build messages with multimodal content for the API
    const apiMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: buildApiContent(m.content, m.attachments),
    }));
    apiMessages.push({
      role: "user",
      content: buildApiContent(messageText, attachments),
    });

    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token || "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    await streamChat({
      messages: apiMessages,
      accessToken,
      webSearch: useWebSearch,
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent };
          return updated;
        });
      },
      onDone: async () => {
        setIsStreaming(false);
        if (assistantContent && convoId) {
          await supabase.from("messages").insert({
            conversation_id: convoId,
            role: "assistant",
            content: serializeMessage(assistantContent),
          });

          // Voice mode (overlay open or auto-speak preference): speak the reply automatically
          if (voiceOverlayOpen || autoSpeak) {
            const result = await tts.speak(assistantContent, ttsVoice);
            if (!result.ok && result.error) {
              toast.error(result.error);
            }
          }
        }
      },
      onError: (err) => {
        setIsStreaming(false);
        if (err === "DAILY_LIMIT_REACHED") {
          setLimitReached(true);
          setMessages((prev) => prev.filter((m) => m.content !== ""));
          return;
        }
        toast.error(err);
        setMessages((prev) => prev.filter((m) => m.content !== ""));
      },
    });
  };

  const regenerateResponse = async (msgIndex: number) => {
    if (isStreaming || !activeConvo) return;
    const newMessages = messages.slice(0, msgIndex);
    setMessages(newMessages);
    setIsStreaming(true);

    let assistantContent = "";
    const apiMessages: ChatMessage[] = newMessages.map((m) => ({
      role: m.role,
      content: buildApiContent(m.content, m.attachments),
    }));

    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token || "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const lastUserMessage = [...newMessages].reverse().find((message) => message.role === "user");
    const useWebSearch = lastUserMessage ? shouldAutoSearchWeb(lastUserMessage.content) : false;

    await streamChat({
      messages: apiMessages,
      accessToken,
      webSearch: useWebSearch,
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent };
          return updated;
        });
      },
      onDone: async () => {
        setIsStreaming(false);
        if (assistantContent && activeConvo) {
          await supabase.from("messages").insert({
            conversation_id: activeConvo,
            role: "assistant",
            content: serializeMessage(assistantContent),
          });
        }
      },
      onError: (err) => {
        setIsStreaming(false);
        toast.error(err);
        setMessages((prev) => prev.filter((m) => m.content !== ""));
      },
    });
  };

  // ---- Voice recording ----
  const handleMicClick = async () => {
    if (recorder.isRecording) {
      const { text, error } = await recorder.stopAndTranscribe();
      if (error) {
        toast.error(error);
        return;
      }
      if (text) {
        setVoiceTranscript(text);
        if (voiceOverlayOpen) {
          // Voice mode: send immediately
          sendMessage(text);
        } else {
          setInput((prev) => (prev ? prev + " " : "") + text);
        }
      }
      return;
    }
    const { ok, error } = await recorder.start();
    if (!ok && error) toast.error(error);
  };

  const openVoiceOverlay = async () => {
    const primeResult = await tts.prime();
    if (!primeResult.ok && primeResult.error) {
      toast.error(primeResult.error);
      return;
    }
    setVoiceTranscript("");
    setVoiceOverlayOpen(true);
  };

  const closeVoiceOverlay = () => {
    tts.stop();
    if (recorder.isRecording) recorder.cancel();
    setVoiceOverlayOpen(false);
  };

  // ---- File upload ----
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported right now.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const tempId = crypto.randomUUID();
    setPendingAttachments((prev) => [
      ...prev,
      { id: tempId, url: previewUrl, previewUrl, type: file.type, isUploading: true },
    ]);

    setUploadingFile(true);
    const { url, error } = await uploadChatAttachment(file, user.id);
    setUploadingFile(false);

    if (error || !url) {
      URL.revokeObjectURL(previewUrl);
      setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== tempId));
      toast.error(error || "Upload failed");
      return;
    }

    setPendingAttachments((prev) =>
      prev.map((attachment) =>
        attachment.id === tempId
          ? { id: tempId, url, previewUrl, type: file.type, isUploading: false }
          : attachment
      )
    );
    toast.success("Image attached");
  };

  const copyMessage = async (content: string, idx: number) => {
    await navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const deleteConversation = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvo === id) {
      setActiveConvo(null);
      setMessages([]);
    }
  };

  const startRename = (c: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(c.id);
    setRenameValue(c.title);
  };

  const submitRename = async (id: string) => {
    const title = renameValue.trim() || "Untitled";
    await supabase.from("conversations").update({ title }).eq("id", id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    setRenamingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  const filteredConvos = searchQuery.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 bg-card border-r border-border/50 flex flex-col overflow-hidden flex-shrink-0`}
      >
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-mono font-bold text-sm text-primary text-glow-green">CHAT AETHRIX</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-3 space-y-2">
          <Button
            onClick={() => { setActiveConvo(null); setMessages([]); setSidebarOpen(false); }}
            className="w-full justify-start gap-2 font-mono text-xs glow-green"
            size="sm"
          >
            <Plus className="h-4 w-4" /> New Chat
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-7 text-xs font-mono bg-muted/30 border-border/50"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-3 scrollbar-dark">
          <div className="space-y-1 pb-4">
            {filteredConvos.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                  activeConvo === c.id
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => { if (renamingId !== c.id) { setActiveConvo(c.id); setSidebarOpen(false); } }}
              >
                {renamingId === c.id ? (
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => submitRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 text-xs font-mono"
                  />
                ) : (
                  <span className="flex-1 truncate font-mono text-xs">{c.title}</span>
                )}
                <button
                  onClick={(e) => startRename(c, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity"
                  aria-label="Rename"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive transition-opacity"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {filteredConvos.length === 0 && (
              <p className="text-xs text-muted-foreground/60 font-mono text-center py-4">No chats found</p>
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border/50 space-y-1">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate("/dashboard")}>
            <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate("/settings")}>
            <Settings className="h-3.5 w-3.5" /> Settings
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate("/pricing")}>
            <Sparkles className="h-3.5 w-3.5" /> Upgrade Plan
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-destructive" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </Button>
        </div>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-border/50 flex items-center px-3 gap-2 flex-shrink-0">
          {!sidebarOpen && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-8 w-8 text-muted-foreground">
              <Menu className="h-4 w-4" />
            </Button>
          )}
          <span className="font-mono text-xs text-muted-foreground truncate flex-1">
            {activeConvo ? conversations.find((c) => c.id === activeConvo)?.title || "Chat" : "New Chat"}
          </span>
          {tts.isSpeaking && (
            <Button variant="ghost" size="sm" onClick={tts.stop} className="h-7 gap-1 text-xs text-primary">
              <VolumeX className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-dark">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6">
              <Sparkles className="h-16 w-16 text-primary/30 mb-6" />
              <h2 className="text-2xl font-bold text-foreground mb-2">Ask Aethrix</h2>
              <p className="text-sm text-muted-foreground mb-2 text-center">
                Chat, generate images, search the web, upload photos, or talk with voice.
              </p>
              <p className="text-xs text-muted-foreground/60 mb-8 font-mono">
                💡 Try one of these to get started
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl w-full">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="text-left px-4 py-3 rounded-lg border border-border/50 bg-card/50 hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm text-muted-foreground hover:text-foreground font-mono"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className="max-w-[85%] group">
                    <div
                      className={`rounded-lg px-4 py-3 text-sm ${
                        msg.role === "user"
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "bg-card border border-border/50 text-foreground"
                      }`}
                    >
                      {/* User attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {msg.attachments.map((a, ai) => (
                            <img
                              key={ai}
                              src={a.url}
                              alt="Attachment"
                              className="max-h-48 rounded border border-border/50"
                            />
                          ))}
                        </div>
                      )}

                      {msg.role === "assistant" ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:text-foreground prose-headings:text-primary prose-strong:text-primary prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:rounded">
                          <ReactMarkdown>{msg.content || "..."}</ReactMarkdown>
                        </div>
                      ) : (
                        msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}

                      {/* Generated image */}
                      {msg.generatedImage && (
                        <img
                          src={msg.generatedImage}
                          alt="Generated"
                          className="mt-3 rounded-lg border border-primary/20 max-w-full"
                        />
                      )}
                    </div>

                    {/* Action buttons */}
                    {msg.content && (
                      <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={() => copyMessage(msg.content, i)}
                          className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                          title="Copy"
                        >
                          {copiedIdx === i ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        {msg.role === "assistant" && !isStreaming && (
                          <>
                            <button
                              onClick={() => regenerateResponse(i)}
                              className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                              title="Regenerate"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                if (tts.isSpeaking) {
                                  tts.stop();
                                } else {
                                  const r = await tts.speak(msg.content, ttsVoice);
                                  if (!r.ok && r.error) toast.error(r.error);
                                }
                              }}
                              className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                              title={tts.isSpeaking ? "Stop voice" : "Read aloud"}
                            >
                              {tts.isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isStreaming && messages[messages.length - 1]?.content === "" && (
                <div className="flex items-center gap-2 text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs font-mono">Aethrix is thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border/50 p-3 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Pending attachments preview */}
            {pendingAttachments.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {pendingAttachments.map((a, i) => (
                  <div key={i} className="relative">
                    <img src={a.previewUrl ?? a.url} alt="" className="h-16 w-16 object-cover rounded border border-border/50" />
                    {a.isUploading && (
                      <div className="absolute inset-0 rounded bg-background/70 flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </div>
                    )}
                    <button
                      onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || uploadingFile}
                className="h-10 w-10 flex-shrink-0 text-muted-foreground hover:text-primary"
                title="Attach image"
              >
                {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>

              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    recorder.isProcessing
                      ? "Transcribing..."
                      : "Ask anything"
                  }
                  className="bg-muted/50 border-border/50 focus:border-primary resize-none pr-24 min-h-[52px] max-h-[200px] font-mono text-sm scrollbar-dark"
                  rows={1}
                  disabled={isStreaming || recorder.isProcessing || uploadingFile}
                />
                {input.trim() || pendingAttachments.length > 0 ? (
                  <Button
                    size="icon"
                    onClick={() => sendMessage()}
                    disabled={isStreaming || uploadingFile || pendingAttachments.some((a) => a.isUploading)}
                    className="absolute right-2 bottom-2 h-9 w-9 glow-green"
                    title="Send"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    onClick={openVoiceOverlay}
                    disabled={isStreaming}
                    className="absolute right-2 bottom-2 h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
                    title="Voice mode"
                    aria-label="Open voice mode"
                  >
                    <AudioLines className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/40 mt-2 font-mono">
              Chat Aethrix may produce inaccurate information. For educational purposes only.
            </p>
          </div>
        </div>
      </div>

      <VoiceOverlay
        open={voiceOverlayOpen}
        isRecording={recorder.isRecording}
        isProcessing={recorder.isProcessing || isStreaming}
        isSpeaking={tts.isSpeaking}
        transcript={voiceTranscript}
        onClose={closeVoiceOverlay}
        onOrbClick={handleMicClick}
        onStopSpeaking={tts.stop}
      />
    </div>
  );
}

// ----- Helpers for storing/parsing messages with attachments + images -----

interface StoredMessage {
  text: string;
  attachments?: Attachment[];
  generatedImage?: string;
}

function serializeMessage(text: string, attachments?: Attachment[], generatedImage?: string): string {
  if (!attachments?.length && !generatedImage) return text;
  const payload: StoredMessage = { text };
  if (attachments?.length) payload.attachments = attachments;
  if (generatedImage) payload.generatedImage = generatedImage;
  return `__JSON__${JSON.stringify(payload)}`;
}

function parseStoredMessage(id: string, role: string, content: string): Message {
  const r = role === "assistant" ? "assistant" : "user";
  if (content.startsWith("__JSON__")) {
    try {
      const parsed: StoredMessage = JSON.parse(content.slice(8));
      return {
        id,
        role: r,
        content: parsed.text || "",
        attachments: parsed.attachments,
        generatedImage: parsed.generatedImage,
      };
    } catch {
      // fall through
    }
  }
  return { id, role: r, content };
}

function buildApiContent(text: string, attachments?: Attachment[]): ChatMessageContent {
  if (!attachments?.length) return text;
  const parts: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  if (text) parts.push({ type: "text", text });
  for (const a of attachments) {
    parts.push({ type: "image_url", image_url: { url: a.url } });
  }
  return parts;
}
