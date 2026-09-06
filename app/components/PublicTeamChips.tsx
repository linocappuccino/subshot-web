import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { Member } from "@/lib/types";

const ROLE_LABEL_KEYS: Record<Member["role"], TranslationKey> = {
  owner: "roles.owner",
  projektleiter: "roles.projectLead",
  editor: "roles.editor",
};

/** Owner + members chip list for the public "Szenenpreview" page (#268) —
 * React counterpart to share_view.py's _team_html. */
export function PublicTeamChips({ team }: { team: Member[] }) {
  const { t } = useLanguage();
  if (team.length === 0) return null;
  return (
    <div className="rounded-2xl bg-[#212121] border border-white/[0.06] p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-white/50 uppercase tracking-wide mb-2.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" /><path d="M2.5 19c0-3.3 2.9-5.8 6.5-5.8s6.5 2.5 6.5 5.8" />
          <path d="M16.3 5a3.2 3.2 0 0 1 0 6.2M21.5 19c0-2.7-2-5-4.8-5.6" />
        </svg>
        {t("projectInfoBox.team")}
      </div>
      <div className="flex flex-wrap gap-2">
        {team.map((m) => (
          <span key={m.user_id} className="inline-flex items-center gap-1.5 text-xs text-white/80 bg-white/[0.06] rounded-full px-2.5 py-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            {m.name || m.email}
            <span className="text-[10px] font-semibold text-white/45 uppercase">{t(ROLE_LABEL_KEYS[m.role])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
