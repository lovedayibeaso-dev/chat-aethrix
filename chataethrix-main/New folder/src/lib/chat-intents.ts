const WEB_SEARCH_INTENT = /\b(search( the web)?|look up|find information|find info|latest|recent|current|today'?s|news|up[- ]to[- ]date|what'?s happening|breaking|research|learn about|browse|check online|search online)\b/i;

export function detectImageIntent(text: string): { shouldGenerate: boolean; prompt: string } {
  const raw = text.trim();
  if (!raw) return { shouldGenerate: false, prompt: "" };

  const stripped = raw.replace(/^\/(image|img)\s+/i, "").trim();
  const lower = stripped.toLowerCase();

  const explicitMatch = stripped.match(
    /^(?:please\s+)?(?:draw|generate|create|make|design|render|illustrate|show|craft|produce|imagine)(?:\s+me)?\s+(?:an?\s+)?(?:image|picture|photo|illustration|drawing|poster|logo|cover(?:\s+art)?|wallpaper)?\s*(?:of|for|showing|with)?\s*(.+)$/i
  );
  if (explicitMatch?.[1]?.trim()) {
    return { shouldGenerate: true, prompt: explicitMatch[1].trim() };
  }

  if (/^(?:image|picture|photo|illustration|drawing)\s*:/i.test(stripped)) {
    return {
      shouldGenerate: true,
      prompt: stripped.replace(/^(?:image|picture|photo|illustration|drawing)\s*:/i, "").trim(),
    };
  }

  const looksLikeQuestion = /^(who|what|when|where|why|how|can|could|would|should|is|are|do|does|did|tell|explain|summarize|compare|search|find)\b/i.test(lower) || stripped.includes("?");
  const looksLikeSearch = WEB_SEARCH_INTENT.test(lower);
  const visualCue = /\b(image|picture|photo|portrait|poster|logo|cover|wallpaper|render|illustration|art|scene|cinematic|photorealistic|3d|4k|8k|fps|flying|building|sunset|mountain|robot|city|superman)\b/i.test(lower);
  const wordCount = stripped.split(/\s+/).filter(Boolean).length;

  if (!looksLikeQuestion && !looksLikeSearch && visualCue && wordCount >= 2 && wordCount <= 24) {
    return { shouldGenerate: true, prompt: stripped };
  }

  return { shouldGenerate: false, prompt: stripped };
}

export function shouldAutoSearchWeb(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return WEB_SEARCH_INTENT.test(trimmed);
}