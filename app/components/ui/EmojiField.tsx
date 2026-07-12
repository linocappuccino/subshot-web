"use client";

import { Menu } from "./Menu";

/** There's no cross-browser API to open the OS emoji keyboard
 * programmatically, and the earlier version of this component relied on
 * that (focus a hidden input, hope the person knows their OS emoji
 * shortcut) — from the outside that just looked like "the plus button does
 * nothing" since focusing an empty input has no visible effect on desktop.
 * An actual in-app grid is the only reliable fix.
 *
 * Was a ~40-emoji curated set — Lino asked for the full Apple emoji catalog,
 * scrollable, same as the iOS app already got (2026-07-11, see
 * EmojiPickerField.swift's identical categories). Mirrored 1:1 here instead
 * of re-curating a second list, so both clients offer exactly the same set. */
const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  { name: "Film & Projekt", emojis: [
    "🎬", "🎥", "📹", "🎞️", "📽️", "🎙️", "🎧", "🎵", "🎶", "📝", "📋",
    "📌", "📍", "🗓️", "📅", "⏰", "⏱️", "⭐️", "🔥", "💡", "🎯", "✅",
    "🚀", "🏆", "🎉", "✨", "🎭", "🖼️", "📸", "📷", "🎨", "🎤", "📺",
    "💻", "🖥️", "🎮", "📀", "💾", "🔊", "🔦", "🎇", "🎆",
  ] },
  { name: "Smileys", emojis: [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂",
    "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛",
    "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏",
    "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩",
    "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶",
    "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶",
    "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴",
    "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕",
    "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "👽",
    "🤖", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾",
  ] },
  { name: "Menschen", emojis: [
    "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟",
    "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊",
    "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🙏", "✍️", "💅", "🤳",
    "💪", "🦾", "👀", "👁️", "👤", "👥", "🧑", "👶", "🧒", "👦", "👧",
    "🧑‍🦱", "🧑‍🦰", "🧑‍🦳", "🧑‍🦲", "👨", "👩", "🧓", "👴", "👵", "🙍", "🙎",
    "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "🧑‍💼", "🧑‍🎓", "🧑‍🏫",
    "🧑‍⚕️", "🧑‍🌾", "🧑‍🍳", "🧑‍🎤", "🧑‍🎨", "🧑‍✈️", "🧑‍🚀", "🧑‍🚒", "👮", "🕵️", "💂",
    "👷", "🤴", "👸", "👳", "👲", "🧕", "🤵", "👰", "🤰", "🤱",
  ] },
  { name: "Natur", emojis: [
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁",
    "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦",
    "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛",
    "🦋", "🐌", "🐞", "🐜", "🦟", "🦗", "🕷️", "🕸️", "🐢", "🐍", "🦎",
    "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬",
    "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🐘", "🦛",
    "🦏", "🐪", "🐫", "🦒", "🦘", "🐃", "🐂", "🐄", "🐎", "🐖", "🐑",
    "🐐", "🦙", "🐕", "🐩", "🐈", "🐓", "🦃", "🦤", "🦚", "🦜", "🦢",
    "🌵", "🎄", "🌲", "🌳", "🌴", "🌱", "🌿", "☘️", "🍀", "🎍", "🎋",
    "🍃", "🍂", "🍁", "🍄", "🐚", "🌾", "💐", "🌷", "🌹", "🥀", "🌺",
    "🌸", "🌼", "🌻", "🌞", "🌝", "🌛", "🌜", "🌚", "🌕", "🌖", "☀️",
    "🌤️", "⛅️", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️",
    "⛄️", "🌬️", "💨", "🌪️", "🌫️", "🌈", "☂️", "☔️", "⚡️", "🔥", "💧",
    "🌊",
  ] },
  { name: "Essen", emojis: [
    "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈",
    "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬",
    "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐",
    "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓",
    "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆",
    "🌮", "🌯", "🥗", "🥘", "🫕", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱",
    "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡",
    "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫",
    "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "🍼", "☕️", "🍵", "🧃",
    "🥤", "🍶", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾",
  ] },
  { name: "Aktivität", emojis: [
    "⚽️", "🏀", "🏈", "⚾️", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀",
    "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🥅", "⛳️", "🪁", "🏹", "🎣",
    "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️",
    "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘",
    "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈", "🥉",
    "🏅", "🎖️", "🏵️", "🎗️", "🎫", "🎟️", "🎪", "🤹", "🎨", "🎭", "🩰",
  ] },
  { name: "Reisen", emojis: [
    "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻",
    "🚚", "🚛", "🚜", "🛵", "🏍️", "🛺", "🚲", "🛴", "🚨", "🚔", "🚍",
    "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅",
    "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺",
    "🛰️", "🚀", "🛸", "🚁", "🛶", "⛵️", "🚤", "🛥️", "🛳️", "⛴️", "🚢",
    "⚓️", "⛽️", "🚧", "🚦", "🚥", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯",
    "🏟️", "🎡", "🎢", "🎠", "⛲️", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️",
    "🏔️", "🗻", "🏕️", "⛺️", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢",
    "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "🏛️",
    "⛪️", "🕌", "🕍", "🛕", "🕋",
  ] },
  { name: "Symbole", emojis: [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️",
    "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💯", "💢", "💥", "💫",
    "💦", "💨", "🕳️", "💣", "💬", "👁️‍🗨️", "🗨️", "🗯️", "💭", "💤", "✅",
    "❌", "❓", "❗️", "⚠️", "🚫", "🔞", "📵", "🚭", "♻️", "✳️", "✴️",
    "❇️", "©️", "®️", "™️", "🔟", "🔢", "🔤", "🅰️", "🆎", "🆑", "🆒",
    "🆓", "🆔", "🆕", "🆖", "🆗", "🆘", "🆙", "🆚", "🈁", "🈂️", "🈷️",
    "㊙️", "㊗️", "🈵", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫️",
    "⚪️", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛️", "⬜️", "◼️",
    "◻️", "◾️", "◽️", "▪️", "▫️", "🔶", "🔷", "🔸", "🔹", "🔺", "🔻",
    "💠", "🔘", "🔳", "🔲",
  ] },
  { name: "Flaggen", emojis: [
    "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🇨🇭", "🇩🇪", "🇦🇹", "🇺🇸", "🇬🇧",
    "🇫🇷", "🇮🇹", "🇪🇸", "🇵🇹", "🇳🇱", "🇧🇪", "🇸🇪", "🇳🇴", "🇩🇰", "🇫🇮", "🇮🇪",
    "🇵🇱", "🇬🇷", "🇹🇷", "🇷🇺", "🇺🇦", "🇨🇦", "🇲🇽", "🇧🇷", "🇦🇷", "🇯🇵", "🇰🇷",
    "🇨🇳", "🇮🇳", "🇦🇺", "🇿🇦", "🇪🇬",
  ] },
];

/** Same one-emoji convention as the iOS FolderEditSheet/ProjectEditSheet.
 * Round tile — dashed "+" when empty, the emoji itself once set, with a
 * small "x" badge to clear it. Clicking opens a small in-app grid (via the
 * shared Menu component — reused for its click-outside/positioning, not for
 * its usual MenuItem list styling) instead of relying on an invisible
 * focused input. */
export function EmojiField({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  return (
    <div className="relative inline-block w-12 h-12">
      <Menu
        align="start"
        trigger={
          <button
            type="button"
            aria-label="Emoji auswählen"
            className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 bg-white/5 flex items-center justify-center text-2xl leading-none hover:border-white/40 transition-colors"
          >
            {value || (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
          </button>
        }
      >
        {(close) => (
          // Vertically scrolling, grouped by category (Lino: "einfach wenn
          // sich die Emoji auswahl öffnet nach unten scrollen können") —
          // capped height so the popover itself never grows off-screen.
          <div className="w-[280px] max-h-[320px] overflow-y-auto p-2">
            {EMOJI_CATEGORIES.map((category) => (
              <div key={category.name} className="mb-2 last:mb-0">
                <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">{category.name}</div>
                <div className="grid grid-cols-8 gap-0.5">
                  {category.emojis.map((emoji, i) => (
                    <button
                      key={`${emoji}-${i}`}
                      type="button"
                      onClick={() => {
                        onChange(emoji);
                        close();
                      }}
                      className="w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Menu>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Emoji entfernen"
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none flex items-center justify-center hover:bg-red-500 transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}
