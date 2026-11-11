"use client";

/**
 * 2026-11-11, Lino: «Credits»-Node — what the project spent on AI generators (Higgsfield, Weavy (Figma), …),
 * in CHF or USD. The entries live on the server per project (every Credits node of the project shows the
 * same list); the connected AI reports each generation over MCP (credits_add), members can add / delete
 * entries here too. Members only: the share page never gets this node (server side) and has no API for it.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CreditsElement, ProjectCredits } from "@/lib/board";

export interface BoardCreditsApi {
  get: () => Promise<ProjectCredits>;
  add: (body: { credits: number; amount_usd?: number | null; description: string; source: string; date?: string }) => Promise<ProjectCredits>;
  remove: (entryId: string) => Promise<ProjectCredits>;
  setPrice: (source: string, usdPerCredit: number | null) => Promise<ProjectCredits>;
}
export const BoardCreditsContext = createContext<BoardCreditsApi | null>(null);

const fmt = (v: number) => v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCredits = (v: number) => v.toLocaleString("de-CH", { maximumFractionDigits: 2 });

export function CreditsNode({
  el,
  editable,
  onCommit,
  onMeasure,
}: {
  el: CreditsElement;
  editable: boolean;
  onCommit: (patch: Partial<Pick<CreditsElement, "currency" | "collapsed" | "title">>) => void;
  onMeasure: (h: number) => void;
}) {
  const api = useContext(BoardCreditsContext);
  const [data, setData] = useState<ProjectCredits | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const currency = el.currency ?? "CHF";

  // the card follows its content (like the Timetable)
  const cardRef = useRef<HTMLDivElement>(null);
  const hRef = useRef(el.h);
  const measure = useRef(onMeasure);
  useLayoutEffect(() => {
    hRef.current = el.h;
    measure.current = onMeasure;
  });
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const check = () => {
      const h = node.offsetHeight;
      if (Math.abs(h - hRef.current) > 1) measure.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(() => {
    if (!api) return;
    api.get().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  }, [api]);
  // always up to date: reload every 10 s while the tab is visible (the AI adds entries over MCP)
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 10000);
    return () => window.clearInterval(id);
  }, [load]);

  const money = (usd: number | null) => (usd == null ? "–" : currency === "USD" ? `$ ${fmt(usd)}` : `CHF ${fmt(usd * (data?.rate.rate ?? 0.8))}`);
  const total = data ? (currency === "USD" ? data.total_usd : data.total_chf) : 0;

  // no API = a client's share page (the server never sends this node there; a live update could) → nothing
  if (!api) return null;
  return (
    <div ref={cardRef} className="w-full rounded-xl bg-[#1d2420] border border-emerald-400/30 shadow-[0_2px_10px_rgba(0,0,0,0.35)] text-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-emerald-500/10">
        <span className="text-base">💳</span>
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{el.title || "Credits"}</span>
        <div data-no-drag className="flex shrink-0 rounded-lg bg-black/30 p-0.5 text-xs font-semibold">
          {(["CHF", "USD"] as const).map((c) => (
            <button key={c} type="button" onClick={() => editable && onCommit({ currency: c })} className={`px-2.5 py-1 rounded-md ${currency === c ? "bg-emerald-500 text-black" : "text-white/60 hover:text-white"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="text-[11px] uppercase tracking-wide text-white/45">Total ausgegeben</div>
        <div data-credits-total className="text-3xl font-bold tabular-nums">{data ? (currency === "USD" ? `$ ${fmt(total)}` : `CHF ${fmt(total)}`) : failed ? "–" : "…"}</div>
        {data && <div className="text-xs text-white/45">{fmtCredits(data.total_credits)} Credits{data.unpriced_entries > 0 && <span className="text-amber-300"> · {data.unpriced_entries} ohne Preis</span>}</div>}
      </div>
      {data && data.sources.length > 0 && (
        <div className="px-4 pb-2 flex flex-col gap-1">
          {data.sources.map((s) => (
            <div key={s.source} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{s.source}</span>
              <span className="text-xs text-white/45 tabular-nums">{fmtCredits(s.credits)} Cr.</span>
              <span className="w-28 text-right font-semibold tabular-nums">{money(s.usd)}</span>
              {editable && (
                <button data-no-drag type="button" title="Preis pro Credit (USD)" onClick={() => setPriceFor(priceFor === s.source ? null : s.source)} className="text-white/35 hover:text-white text-xs px-1">
                  ⚙
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {priceFor && data && (
        <PriceEditor
          source={priceFor}
          value={data.usd_per_credit[priceFor] ?? null}
          onSave={(v) => api.setPrice(priceFor, v).then((d) => { setData(d); setPriceFor(null); }).catch(() => setFailed(true))}
          onCancel={() => setPriceFor(null)}
        />
      )}
      <div data-no-drag className="border-t border-white/10">
        <button type="button" onClick={() => editable && onCommit({ collapsed: !el.collapsed })} className="w-full flex items-center justify-between px-4 py-2 text-xs text-white/60 hover:text-white">
          <span>{el.collapsed ? "▸" : "▾"} Einträge ({data?.entries.length ?? 0})</span>
          {editable && !el.collapsed && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setAdding((a) => !a);
              }}
              className="rounded-md bg-emerald-500/20 hover:bg-emerald-500/35 px-2 py-0.5 font-semibold text-emerald-100"
            >
              ＋ Eintrag
            </span>
          )}
        </button>
        {!el.collapsed && (
          <div className="px-3 pb-3 flex flex-col gap-1">
            {adding && data && (
              <AddEntry
                sources={data.known_sources}
                onAdd={(body) => api.add(body).then((d) => { setData(d); setAdding(false); }).catch(() => setFailed(true))}
                onCancel={() => setAdding(false)}
              />
            )}
            {data?.entries.map((e) => (
              <div key={e.id} data-credits-entry className="group/entry flex items-start gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-white/85">{e.description || "–"}</div>
                  <div className="text-white/40">{e.date ? new Date(e.date).toLocaleDateString("de-CH") : ""} · {e.source} · {fmtCredits(e.credits)} Cr.</div>
                </div>
                <div className="text-right tabular-nums font-semibold" title={e.estimated ? "geschätzt (Preis pro Credit)" : undefined}>
                  {money(e.usd)}
                  {e.estimated && <span className="text-white/35">*</span>}
                </div>
                {editable && (
                  <button type="button" title="Eintrag löschen" onClick={() => api.remove(e.id).then(setData).catch(() => setFailed(true))} className="text-white/30 hover:text-red-300 opacity-0 group-hover/entry:opacity-100">
                    ✕
                  </button>
                )}
              </div>
            ))}
            {data && data.entries.length === 0 && !adding && <p className="px-1 py-2 text-xs text-white/40">Noch keine Einträge. Claude trägt jede Higgsfield- / Weavy-Generierung über die MCP ein.</p>}
          </div>
        )}
      </div>
      {data && (
        <div className="px-4 pb-2 text-[10px] text-white/35">
          1 USD = {data.rate.rate.toFixed(4)} CHF · {data.rate.source}
          {data.rate.date ? ` · ${new Date(data.rate.date).toLocaleDateString("de-CH")}` : ""}
          {data.rate.stale ? " (nicht aktuell)" : ""}
          {data.entries.some((e) => e.estimated) && " · * geschätzt mit Preis pro Credit"}
        </div>
      )}
    </div>
  );
}

function AddEntry({ sources, onAdd, onCancel }: { sources: string[]; onAdd: (b: { credits: number; amount_usd?: number | null; description: string; source: string }) => void; onCancel: () => void }) {
  const [source, setSource] = useState(sources[0] ?? "Higgsfield");
  const [credits, setCredits] = useState("");
  const [usd, setUsd] = useState("");
  const [desc, setDesc] = useState("");
  const input = "rounded-md bg-black/30 border border-white/10 px-2 py-1 text-xs outline-none focus:border-emerald-400 select-text min-w-0";
  const num = (v: string) => Number(v.replace(",", "."));
  const ok = num(credits) > 0 || num(usd) > 0;
  return (
    <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/[0.06] p-2 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input list="credit-sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Quelle" className={`${input} flex-1`} />
        <datalist id="credit-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="decimal" placeholder="Credits" className={`${input} w-20`} />
        <input value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" placeholder="USD (opt.)" className={`${input} w-20`} />
      </div>
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Beschreibung (z. B. Storyboard Szene 3)" className={input} />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-xs text-white/60 hover:text-white">Abbrechen</button>
        <button
          type="button"
          disabled={!ok}
          onClick={() => onAdd({ source: source.trim() || "Higgsfield", credits: num(credits) || 0, amount_usd: usd.trim() ? num(usd) : null, description: desc.trim() })}
          className="rounded-md bg-emerald-500 text-black px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
        >
          Hinzufügen
        </button>
      </div>
    </div>
  );
}

function PriceEditor({ source, value, onSave, onCancel }: { source: string; value: number | null; onSave: (v: number | null) => void; onCancel: () => void }) {
  const [v, setV] = useState(value != null ? String(value) : "");
  return (
    <div data-no-drag className="mx-4 mb-2 rounded-lg border border-white/15 bg-black/30 p-2 flex items-center gap-1.5 text-xs">
      <span className="flex-1 min-w-0 truncate text-white/70">Preis pro Credit (USD) · {source}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="z. B. 0.06" className="w-20 rounded-md bg-black/40 border border-white/10 px-2 py-1 outline-none focus:border-emerald-400 select-text" />
      <button type="button" onClick={() => onSave(v.trim() ? Number(v.replace(",", ".")) : null)} className="rounded-md bg-emerald-500 text-black px-2 py-1 font-semibold">OK</button>
      <button type="button" onClick={onCancel} className="px-1 text-white/50 hover:text-white">✕</button>
    </div>
  );
}
