// 2026-07-21 — Idea images can now also be real video files (mp4/mov/webm),
// see AuthVideo.tsx. GIFs are NOT included here — a plain <img src="...gif">
// already autoplays natively in every browser, no <video> treatment needed.
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(url);
}

export type VideoMetadata = { duration: number | undefined; width: number | undefined; height: number | undefined };

// 2026-07-29 — used right after a video upload hits 100% to read
// duration/dimensions off an in-memory <video> element before calling
// /complete. Root-caused a real "stuck at 100%" bug: with several uploads
// finishing around the same time, the browser's metadata decode for one of
// them could simply never fire EITHER `loadedmetadata` OR `error` (observed
// live, not theoretical — two real video_versions sat in `status=uploading`
// for 6+ minutes with /complete never called). The 3 call sites used to
// each hand-roll this same unguarded Promise; centralized here with a hard
// timeout so a stuck decode can no longer block the upload from completing
// — falls back to `undefined` fields exactly like the existing `onerror`
// path already did, callers don't need to distinguish "failed" from "timed
// out".
export function readVideoMetadata(file: File, timeoutMs = 5000): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    let settled = false;
    const finish = (result: VideoMetadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(el.src);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ duration: undefined, width: undefined, height: undefined }), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => finish({ duration: el.duration, width: el.videoWidth || undefined, height: el.videoHeight || undefined });
    el.onerror = () => finish({ duration: undefined, width: undefined, height: undefined });
    el.src = URL.createObjectURL(file);
  });
}
