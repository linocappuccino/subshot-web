"use client";

/** 2026-11-12, Lino: «🎙️ Live-Dubbing» — an external speaker records through this link without a login: the
 * studio of exactly ONE Live-Dubbing node (video, sections, script), nothing else of the project. */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BoardDubbingContext, DubbingStudio, type BoardDubbingApi } from "@/app/components/board/BoardDubbing";
import type { DubbingElement, DubbingTake } from "@/lib/board";
import { publicDubbingApi, type PublicDubbing } from "@/lib/publicDubbingApi";

const NAME_KEY = "subshot-dubbing-speaker";

export default function DubbingSpeakerPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicDubbing | null>(null);
  const [takes, setTakes] = useState<DubbingTake[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // private mode
    }
    publicDubbingApi
      .get(token)
      .then((d) => {
        setData(d);
        setTakes(d.takes);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Dieser Link ist nicht mehr gültig."));
  }, [token]);

  if (error) return <div className="min-h-screen bg-[#111214] text-white flex items-center justify-center p-6 text-center">{error}</div>;
  if (!data) return <div className="min-h-screen bg-[#111214] text-white/40 flex items-center justify-center">Lädt …</div>;
  if (!name) {
    return (
      <div className="min-h-screen bg-[#111214] text-white flex items-center justify-center p-6">
        <form
          className="w-full max-w-sm flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim();
            if (!n) return;
            try {
              localStorage.setItem(NAME_KEY, n);
            } catch {
              // ignore
            }
            setName(n);
          }}
        >
          <div className="text-3xl">🎙️</div>
          <h1 className="text-xl font-bold">{data.node.title || "Live-Dubbing"}</h1>
          <p className="text-sm text-white/60">{data.project_name} · Du nimmst hier deine Sprachaufnahmen auf. Wie heisst du?</p>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Dein Name" className="rounded-lg bg-white/10 px-3 py-2.5 outline-none focus:ring-2 focus:ring-rose-400" />
          <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-rose-500 py-2.5 font-semibold disabled:opacity-40">
            Weiter zum Studio
          </button>
        </form>
      </div>
    );
  }

  const el = { ...data.node, type: "dubbing", x: 0, y: 0, w: 0, h: 0, z: 0, src: data.node.src } as DubbingElement;
  const api: BoardDubbingApi = {
    takes: () => publicDubbingApi.get(token).then((d) => d.takes),
    uploadTake: (_n, wav, sectionId, lang, seconds) => publicDubbingApi.uploadTake(token, wav, sectionId, lang, seconds, name),
    best: async () => takes,
    remove: async () => takes,
    exportUrl: async () => "",
    uploadVideo: async () => {
      throw new Error("nicht erlaubt");
    },
  };
  return (
    <BoardDubbingContext.Provider value={api}>
      <DubbingStudio
        el={el}
        editable
        canChoose={false}
        takes={takes}
        setTakes={setTakes}
        initialLang={el.languages[0] ?? ""}
        onCommit={(patch) => {
          // 2026-11-12, Lino: speakers add / adjust sections and paste the script (deleting stays with the team)
          if (!patch.sections) return;
          const sections = patch.sections;
          setData((d) => (d ? { ...d, node: { ...d.node, sections } } : d));
          publicDubbingApi.saveSections(token, sections).catch(() => {
            setError("Die Abschnitte konnten nicht gespeichert werden. Bitte neu laden.");
          });
        }}
        header={<span className="ml-auto text-xs text-white/50">Sprecher·in: {name}</span>}
      />
    </BoardDubbingContext.Provider>
  );
}
