export const SYSTEM_ICON_KEYS = [
  "archive",
  "book",
  "bot",
  "brain",
  "briefcase",
  "building",
  "calendar",
  "chartColumn",
  "chartLine",
  "checkBadge",
  "clipboard",
  "clapperboard",
  "clock",
  "coffee",
  "crown",
  "edit",
  "fileText",
  "flask",
  "folder",
  "folderOpen",
  "flame",
  "gem",
  "handshake",
  "hammer",
  "hardHat",
  "heartPulse",
  "lightbulb",
  "link",
  "lobster",
  "megaphone",
  "messageSquare",
  "microscope",
  "monitor",
  "palette",
  "package",
  "party",
  "pin",
  "puzzle",
  "receipt",
  "refresh",
  "rocket",
  "ruler",
  "search",
  "settings",
  "shield",
  "smartphone",
  "sparkles",
  "target",
  "trash",
  "users",
  "wrench",
  "warning",
  "zap",
] as const;

export type SystemIconKey = (typeof SYSTEM_ICON_KEYS)[number];

const SYSTEM_ICON_KEY_SET = new Set<string>(SYSTEM_ICON_KEYS);
const LOBSTER_AVATAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <defs>
    <linearGradient id="lobsterGradient" x1="18" y1="16" x2="102" y2="104" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFB347" />
      <stop offset="1" stop-color="#FF5F6D" />
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="28" fill="#FFF3E3" />
  <path d="M60 16C34 16 21 38 21 56C21 73 34 92 46 97V106H54V99C58 100 62 100 66 99V106H74V97C86 92 99 73 99 56C99 38 86 16 60 16Z" fill="url(#lobsterGradient)" />
  <path d="M24 46C12 42 8 50 12 58C16 66 24 63 28 55C31 50 28 47 24 46Z" fill="url(#lobsterGradient)" />
  <path d="M96 46C108 42 112 50 108 58C104 66 96 63 92 55C89 50 92 47 96 46Z" fill="url(#lobsterGradient)" />
  <path d="M46 20Q38 10 34 13" stroke="#FF7A18" stroke-width="4.5" stroke-linecap="round" />
  <path d="M74 20Q82 10 86 13" stroke="#FF7A18" stroke-width="4.5" stroke-linecap="round" />
  <circle cx="47" cy="40" r="5.5" fill="#101828" />
  <circle cx="73" cy="40" r="5.5" fill="#101828" />
  <circle cx="48.5" cy="38.5" r="1.5" fill="#FFF8EF" />
  <circle cx="74.5" cy="38.5" r="1.5" fill="#FFF8EF" />
</svg>
`.trim();

export const LOBSTER_AVATAR_DATA_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  LOBSTER_AVATAR_SVG,
)}`;

export const LEGACY_EMOJI_TO_ICON_KEY: Record<string, SystemIconKey> = {
  "\u23F0": "clock",
  "\u26A0\uFE0F": "warning",
  "\u26A1": "zap",
  "\u2728": "sparkles",
  "\u2705": "checkBadge",
  "\u{1F4AC}": "messageSquare",
  "\u{1F493}": "heartPulse",
  "\u{1F4A1}": "lightbulb",
  "\u{1F48E}": "gem",
  "\u{1F4BB}": "monitor",
  "\u{1F4C1}": "folder",
  "\u{1F4C2}": "folderOpen",
  "\u{1F4C4}": "fileText",
  "\u{1F4C5}": "calendar",
  "\u{1F4CA}": "chartColumn",
  "\u{1F4C8}": "chartLine",
  "\u{1F4CB}": "clipboard",
  "\u{1F4CC}": "pin",
  "\u{1F4DA}": "book",
  "\u{1F4E3}": "megaphone",
  "\u{1F4E2}": "megaphone",
  "\u{1F4E6}": "package",
  "\u{1F4F1}": "smartphone",
  "\u{1F504}": "refresh",
  "\u{1F50D}": "search",
  "\u{1F517}": "link",
  "\u{1F527}": "wrench",
  "\u{1F4DD}": "edit",
  "\u{1F3C5}": "checkBadge",
  "\u{1F3E2}": "building",
  "\u{1F3D7}\uFE0F": "hardHat",
  "\u{1F451}": "crown",
  "\u{1F464}": "users",
  "\u{1F465}": "users",
  "\u{1F380}": "sparkles",
  "\u{1F389}": "party",
  "\u{1F396}\uFE0F": "checkBadge",
  "\u{1F3AF}": "target",
  "\u{1F3A8}": "palette",
  "\u{1F3AA}": "party",
  "\u{1F3AC}": "clapperboard",
  "\u{1F41A}": "lobster",
  "\u{1F980}": "lobster",
  "\u{1F990}": "lobster",
  "\u{1F99E}": "lobster",
  "\u{1F9E0}": "brain",
  "\u{1F9E9}": "puzzle",
  "\u{1F9EA}": "flask",
  "\u{1F9F0}": "wrench",
  "\u{1F6E0}\uFE0F": "hammer",
  "\u{1F6E1}\uFE0F": "shield",
  "\u{1F5C2}\uFE0F": "folderOpen",
  "\u{1F5C4}\uFE0F": "archive",
  "\u{1F5D1}\uFE0F": "trash",
  "\u{1F5DC}\uFE0F": "archive",
  "\u{1F916}": "bot",
  "\u{1F91D}": "handshake",
  "\u{1F680}": "rocket",
  "\u2615": "coffee",
  "\u{1F525}": "flame",
};

export function isSystemIconKey(value: string): value is SystemIconKey {
  return SYSTEM_ICON_KEY_SET.has(value);
}

export function normalizeSystemIcon(
  value: string | null | undefined,
  fallback: SystemIconKey,
): SystemIconKey {
  const normalized = value?.trim() || "";
  if (!normalized) {
    return fallback;
  }

  if (isSystemIconKey(normalized)) {
    return normalized;
  }

  return LEGACY_EMOJI_TO_ICON_KEY[normalized] ?? fallback;
}
