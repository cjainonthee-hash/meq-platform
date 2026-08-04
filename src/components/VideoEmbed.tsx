"use client";

/**
 * Renders a video link as a live preview. Handles the common cases a lecturer
 * will paste: YouTube, Vimeo, Google Drive, and direct video files (.mp4 etc).
 * Anything it does not recognise falls back to a plain "open link".
 */

type Kind =
  | { type: "youtube"; src: string }
  | { type: "vimeo"; src: string }
  | { type: "drive"; src: string }
  | { type: "file"; src: string }
  | { type: "link"; src: string };

export function classifyVideo(raw: string): Kind {
  const url = raw.trim();
  if (!url) return { type: "link", src: url };

  // YouTube: youtu.be/ID or youtube.com/watch?v=ID or /embed/ID or /shorts/ID
  const yt =
    url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/) ??
    null;
  if (yt) return { type: "youtube", src: `https://www.youtube.com/embed/${yt[1]}` };

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { type: "vimeo", src: `https://player.vimeo.com/video/${vimeo[1]}` };

  // Google Drive: /file/d/ID/... -> preview embed
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive)
    return { type: "drive", src: `https://drive.google.com/file/d/${drive[1]}/preview` };

  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)) return { type: "file", src: url };

  return { type: "link", src: url };
}

export function VideoEmbed({ url }: { url: string }) {
  const v = classifyVideo(url);
  if (!url.trim()) return null;

  if (v.type === "file") {
    return (
      <video
        src={v.src}
        controls
        className="mt-1 max-h-96 w-full rounded-md border border-slate-200 bg-black"
      />
    );
  }

  if (v.type === "youtube" || v.type === "vimeo" || v.type === "drive") {
    return (
      <div className="mt-1 aspect-video w-full overflow-hidden rounded-md border border-slate-200 bg-black">
        <iframe
          src={v.src}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <a
      href={v.src}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-block text-sm text-brand hover:underline"
    >
      ▶ เปิดวิดีโอในแท็บใหม่ (ตัวอย่างในหน้านี้แสดงไม่ได้)
    </a>
  );
}
