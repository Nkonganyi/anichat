export const AVATAR_OPTIONS = [
  { id: "sakura", emoji: "🌸", gradient: ["#FF6FA5", "#E24E85"] },
  { id: "moonlight", emoji: "🌙", gradient: ["#8FB8FF", "#5C7FE0"] },
  { id: "ember", emoji: "🔥", gradient: ["#FF9F6E", "#E2653F"] },
  { id: "frost", emoji: "❄️", gradient: ["#9EE7F5", "#5CB8CC"] },
  { id: "starlight", emoji: "⭐", gradient: ["#FFD166", "#E2A63F"] },
  { id: "shadow", emoji: "🌑", gradient: ["#8B7FC7", "#5A4E8E"] },
  { id: "storm", emoji: "⚡", gradient: ["#C9B8E8", "#9885C4"] },
  { id: "bloom", emoji: "🌷", gradient: ["#F5A6C9", "#D66FA0"] },
  { id: "nova", emoji: "💫", gradient: ["#7FE7C4", "#4EC49A"] },
  { id: "twilight", emoji: "🌆", gradient: ["#B18FE0", "#6E4EA8"] },
];

export function getAvatar(id) {
  return AVATAR_OPTIONS.find((a) => a.id === id) || AVATAR_OPTIONS[0];
}

export const STICKERS = [
  { id: "sparkle-cheer", glyph: "🌟🎉🌟", label: "Sparkle Cheer" },
  { id: "hype-burst", glyph: "✨💥✨", label: "Hype Burst" },
  { id: "crying-laughing", glyph: "😭💗", label: "Crying Laughing" },
  { id: "heart-eyes", glyph: "😍💖", label: "Heart Eyes" },
  { id: "fighting-spirit", glyph: "🔥⚔️🔥", label: "Fighting Spirit" },
  { id: "shocked", glyph: "😱❗", label: "Shocked" },
  { id: "sleepy", glyph: "😴💤", label: "Sleepy" },
  { id: "blush", glyph: "😳🌸", label: "Blush" },
];

export function getSticker(id) {
  return STICKERS.find((s) => s.id === id) || { id, glyph: "❓", label: id };
}

export const QUICK_EMOJI = [
  "😂", "😭", "🔥", "💀", "😍", "🥹", "😱", "👀",
  "💯", "🎉", "🥰", "😤", "🙏", "✨", "😳", "🫡",
];
