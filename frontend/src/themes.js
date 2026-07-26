// Theme ids/tokens only — no trademarked titles used as user-facing labels,
// no logos, no character artwork. Just original color/type/motif systems
// evocative of each series' visual identity. Keep this list in sync with
// backend/routes/users.js VALID_THEMES.

export const THEME_OPTIONS = [
  {
    id: "voyage",
    name: "Pirate King's Voyage",
    fontDisplay: "'Baloo 2', sans-serif",
    fontBody: "'Inter', sans-serif",
    colors: {
      bg1: "#12456B",
      bg2: "#072A46",
      surface: "#0F3A5C",
      surfaceLight: "#1B5A85",
      accent: "#FFB74D",
      accentDeep: "#E68A2E",
      secondary: "#E8483C",
      text: "#FDF6EC",
      muted: "#8FB8D8",
      online: "#7FE7C4",
      offline: "#E8483C",
    },
    motifs: ["🏴‍☠️", "⚓", "🌊", "☀️"],
  },
  {
    id: "requiem",
    name: "Soul Reaper's Requiem",
    fontDisplay: "'Cinzel', serif",
    fontBody: "'Inter', sans-serif",
    colors: {
      bg1: "#232328",
      bg2: "#0A0A0C",
      surface: "#1C1C21",
      surfaceLight: "#2E2E35",
      accent: "#E63946",
      accentDeep: "#B22B37",
      secondary: "#D8D8DC",
      text: "#F2F2F2",
      muted: "#8A8A92",
      online: "#7FE7C4",
      offline: "#E63946",
    },
    motifs: ["🌙", "⚔️", "✦", "🕸️"],
  },
  {
    id: "shadow-leaf",
    name: "Shadow of the Leaf",
    fontDisplay: "'Baloo 2', sans-serif",
    fontBody: "'Inter', sans-serif",
    colors: {
      bg1: "#3D2414",
      bg2: "#1A0F08",
      surface: "#33200F",
      surfaceLight: "#4E2F1B",
      accent: "#FF7A00",
      accentDeep: "#E56600",
      secondary: "#4A9B4E",
      text: "#FDF3E7",
      muted: "#C9A98A",
      online: "#7FE7C4",
      offline: "#FF7A00",
    },
    motifs: ["🍃", "🌀", "⚡", "🍥"],
  },
];

export function getTheme(id) {
  return THEME_OPTIONS.find((t) => t.id === id) || THEME_OPTIONS[0];
}

// Pushes a theme's tokens onto :root as CSS variables so every existing
// component (which reads var(--bg-1) etc.) re-skins instantly.
export function applyTheme(theme) {
  const root = document.documentElement.style;
  root.setProperty("--bg-1", theme.colors.bg1);
  root.setProperty("--bg-2", theme.colors.bg2);
  root.setProperty("--surface", theme.colors.surface);
  root.setProperty("--surface-light", theme.colors.surfaceLight);
  root.setProperty("--accent", theme.colors.accent);
  root.setProperty("--accent-deep", theme.colors.accentDeep);
  root.setProperty("--secondary", theme.colors.secondary);
  root.setProperty("--text", theme.colors.text);
  root.setProperty("--muted", theme.colors.muted);
  root.setProperty("--online", theme.colors.online);
  root.setProperty("--offline", theme.colors.offline);
  root.setProperty("--font-display", theme.fontDisplay);
  root.setProperty("--font-body", theme.fontBody);
}
