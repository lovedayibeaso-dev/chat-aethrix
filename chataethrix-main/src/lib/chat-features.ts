import { supabase } from "@/integrations/supabase/client";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const BUCKET = "chat-attachments";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

/**
 * Uploads a user-selected image/file to the chat-attachments bucket
 * and returns its public URL.
 */
export async function uploadChatAttachment(
  file: File,
  userId: string
): Promise<{ url: string | null; error?: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { url: null, error: "File too large (max 20 MB)." };
  }

  const optimizedFile = await optimizeImageForChat(file);

  const ext = optimizedFile.name.split(".").pop() || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, optimizedFile, {
    contentType: optimizedFile.type,
    upsert: false,
  });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

/**
 * Calls the generate-image edge function and returns a data URL.
 */
export async function generateImage(
  prompt: string
): Promise<{ imageUrl: string | null; error?: string }> {
  try {
    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token || "";

    const resp = await fetch(`${FUNCTIONS_URL}/generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ prompt }),
    });

    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      return { imageUrl: null, error: j.error || "Image generation failed" };
    }
    const data = await resp.json();
    return { imageUrl: data.imageUrl || null };
  } catch (e) {
    return { imageUrl: null, error: e instanceof Error ? e.message : "Image generation failed" };
  }
}

async function optimizeImageForChat(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const largestSide = Math.max(bitmap.width, bitmap.height);

    if (largestSide <= MAX_IMAGE_DIMENSION && file.size <= 4 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / largestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.84);
    });

    if (!blob) return file;

    const fileName = file.name.replace(/\.[^.]+$/, "") || "attachment";
    return new File([blob], `${fileName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
