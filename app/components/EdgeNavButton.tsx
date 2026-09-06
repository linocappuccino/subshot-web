"use client";

/** Rand-Navigationsbutton zwischen Workflow-Bereichen (Ideen/Szenen/
 * Postproduction) — extracted 2026-07-17 into ein eigenes shared File (war
 * vorher lokal in der Szenen/Ideen-Seite), sobald die Postproduction-Seite
 * ihren eigenen "zurück zu Szenen"-Button brauchte (Lino: "diese Buttons
 * müssen IMMER sichtbar sein damit man im Workflow vor und zurück kann").
 *
 * Sieben Runden Lino-Feedback zum genauen Look, jede eine andere Richtung
 * als die vorherige — vom animierten Rand-Content über einen runden
 * "liquid glass"-Button mit Glanzpunkt/Verlaufsrand/Glow, bis hierher.
 *
 * Siebte Runde (2026-07-19, Lino: "passt mir noch nicht... machen wir hier
 * einfach nur grosse < oder > in weiss die glowen und sich leicht bewegen.
 * beim mouseover animieren sie leicht und zeigen den Namen der nächste
 * oder rückgängigen Pipeline an") — der gesamte runde Glas-Button (Glanz-
 * Gradient, Verlaufsrand-Mask-Trick, Inset-Rim-Shadow) ist komplett raus,
 * ebenso der Maus-Näherungs-Scale-Effekt (REVEAL_ZONE_PX/mousemove-
 * Listener) — beides war nie Teil der neuen Beschreibung. Nur noch der
 * reine Chevron-Glyph selbst, weiss, mit einem sanft pulsierenden
 * drop-shadow-Glow UND einer leichten Dauerbewegung in Zeigerichtung
 * (kein Button-Hintergrund mehr, der Klick-Bereich bleibt trotzdem ein
 * 64x64 unsichtbarer Hit-Bereich für Maus/Touch). Hover verstärkt Glow +
 * Skalierung; das Tooltip-Label bleibt unverändert (war schon separat vom
 * Button-Look, brauchte keine Änderung). */
export function EdgeNavButton({
  side, onClick, ariaLabel, label,
}: {
  side: "left" | "right";
  onClick: () => void;
  ariaLabel: string;
  label: string;
}) {
  return (
    <div
      style={side === "right" ? { right: 28 } : { left: 28 }}
      // `group` fuers Tooltip-Hover, `flex-row-reverse` fuer die rechte
      // Seite: der Button bleibt trotz Tooltip-Sibling das aeussere
      // Element (Tooltip waechst nach INNEN, zur Bildschirmmitte hin).
      className={`group fixed top-1/2 -translate-y-1/2 z-30 flex items-center gap-3 ${side === "right" ? "flex-row-reverse" : ""}`}
    >
      {/* 2026-08-26 — Lino: "wir entfernen uns von Übergangsanimationen,
          soll super schnell sein". The endless nudge+pulse `animate` loop
          and the entry/exit spring above are gone; hover/tap feedback is
          now a plain CSS `transition` (hardware-accelerated, no JS-driven
          animation loop running the whole time this button is on screen). */}
      <button
        onClick={onClick}
        aria-label={ariaLabel}
        className="flex items-center justify-center w-16 h-16 text-white transition-transform duration-150 hover:scale-[1.18] active:scale-95"
        style={{ filter: "drop-shadow(0 0 10px rgba(255,255,255,0.45)) drop-shadow(0 0 22px rgba(255,255,255,0.2))" }}
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {side === "right" ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
        </svg>
      </button>
      {/* Tooltip: unsichtbar+leicht hinter dem Button versteckt (translate
          Richtung "hinter" den Button), schiebt sich beim Hover sichtbar
          nach aussen. Reine CSS-Transition (kein Framer-State) reicht,
          `group-hover` traegt die Hover-Erkennung. */}
      <span
        className={`pointer-events-none select-none whitespace-nowrap rounded-lg border border-white/15 bg-black/75 px-3 py-1.5 text-sm font-medium text-white opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 ${
          side === "right" ? "translate-x-2 group-hover:translate-x-0" : "-translate-x-2 group-hover:translate-x-0"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
