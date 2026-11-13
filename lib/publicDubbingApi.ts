import { ApiError } from "./api";
import type { DubbingSection, DubbingTake } from "./board";

/** 2026-11-12, Lino: «🎙️ Live-Dubbing» — the external speaker's link (no login, one node only) */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export interface PublicDubbing {
  node: { id: string; title: string; name?: string; duration?: number; languages: string[]; sections: DubbingSection[]; src: string | null; video_ar?: number; sound_mode?: "none" | "split" | "full"; language_flags?: Record<string, string> };
  /** 2026-11-13: the link is fixed to this language (else the speaker picks) */
  fixed_lang?: string | null;
  project_name: string;
  takes: DubbingTake[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {
      // keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const publicDubbingApi = {
  saveSections: (token: string, sections: DubbingSection[]) =>
    fetch(`${BASE_URL}/dubbing-share/${token}/sections`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections }) }).then((r) =>
      handle<{ sections: DubbingSection[] }>(r),
    ),
  get: (token: string) => fetch(`${BASE_URL}/dubbing-share/${token}`, { cache: "no-store" }).then((r) => handle<PublicDubbing>(r)),
  uploadTake: async (token: string, wav: Blob, sectionId: string, lang: string, seconds: number, speakerName: string) => {
    const t = await fetch(`${BASE_URL}/dubbing-share/${token}/upload`, { method: "POST" }).then((r) => handle<{ key: string; upload_url: string }>(r));
    const put = await fetch(t.upload_url, { method: "PUT", headers: { "Content-Type": "audio/wav" }, body: wav });
    if (!put.ok) throw new ApiError(put.status, "Upload fehlgeschlagen");
    const r = await fetch(`${BASE_URL}/dubbing-share/${token}/takes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: t.key, section_id: sectionId, lang, duration: seconds, speaker_name: speakerName }),
    }).then((x) => handle<{ takes: DubbingTake[] }>(x));
    return r.takes;
  },
};
