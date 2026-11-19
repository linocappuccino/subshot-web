// 2026-11-19, Lino: «wenn man mit dem mobile auf der canvas ist und videos anschauen will, soll man das video anklicken
// können und es soll dann im fullscreen modus geöffnet werden … aber nur auf mobile». ONE player at a time: a black
// overlay with the video centred (object-contain → 9:16 and 16:9 both fit) and a close button; on iOS the native
// fullscreen (webkitEnterFullscreen) is tried as soon as the video can play, elsewhere requestFullscreen. Closing
// removes the <video> again (src cleared, load()).

/** phone = touch + narrow (not by user agent): pointer coarse and width < 768 px */
export function isPhoneBoard(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
}

let current: { overlay: HTMLDivElement; video: HTMLVideoElement } | null = null;

export function closeVideoFullscreen() {
  if (!current) return;
  const { overlay, video } = current;
  current = null;
  try { video.pause(); } catch { /* */ }
  video.removeAttribute("src");
  try { video.load(); } catch { /* */ }
  if (document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => {});
  overlay.remove();
}

export function openVideoFullscreen(src: string, poster?: string | null, title?: string) {
  if (!src || typeof document === "undefined") return;
  closeVideoFullscreen();
  document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => { if (!m.paused) m.pause(); });
  const overlay = document.createElement("div");
  overlay.setAttribute("data-video-fullscreen", "");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", title || "Video");
  Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "2147483000", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" });
  const video = document.createElement("video");
  video.src = src;
  if (poster) video.poster = poster;
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  // 2026-11-19 — no download / picture-in-picture from the player's own menu (clients only get files the team
  // allowed, through the board's download button; the team has its own button too)
  video.setAttribute("controlslist", "nodownload noplaybackrate");
  video.disablePictureInPicture = true;
  Object.assign(video.style, { width: "100%", height: "100%", objectFit: "contain", background: "#000" });
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("data-video-fullscreen-close", "");
  close.setAttribute("aria-label", "Close");
  close.textContent = "✕";
  Object.assign(close.style, { position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: "12px", width: "44px", height: "44px",
    borderRadius: "22px", border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", fontSize: "20px", lineHeight: "44px", zIndex: "1" });
  close.addEventListener("click", (e) => { e.stopPropagation(); closeVideoFullscreen(); });
  overlay.append(video, close);
  document.body.appendChild(overlay);
  current = { overlay, video };
  // native fullscreen where the platform offers it; the overlay stays as the fallback
  const v = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  video.addEventListener("webkitendfullscreen", () => closeVideoFullscreen());
  try {
    if (typeof v.webkitEnterFullscreen === "function") {
      video.addEventListener("loadedmetadata", () => { try { v.webkitEnterFullscreen!(); } catch { /* overlay stays */ } }, { once: true });
    } else if (overlay.requestFullscreen) {
      void overlay.requestFullscreen().catch(() => {});
      const onFs = () => {
        if (!document.fullscreenElement) { document.removeEventListener("fullscreenchange", onFs); closeVideoFullscreen(); }
      };
      document.addEventListener("fullscreenchange", onFs);
    }
  } catch { /* overlay stays */ }
  void video.play().catch(() => {});
}
