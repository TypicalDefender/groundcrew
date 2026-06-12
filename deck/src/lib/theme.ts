/**
 * Deck design tokens. One module owns the palette; components consume these
 * (or the matching CSS custom properties in `globals.css`) instead of raw
 * hex values, so the board, drawer, and chips stay on one visual language.
 */

export const surface = {
  /** Page background. */
  page: "#F7F7F7",
  /** Cards and raised panels. */
  card: "#FFFFFF",
  /** Subtle fills inside cards (input wells, hover rows). */
  muted: "rgba(0, 0, 0, 0.05)",
} as const;

export const navigation = {
  /** Top bar / sidebar background. */
  gradient: "linear-gradient(90deg, #001529 0%, #00101F 79%)",
  itemText: "#F7F7F799",
  itemSelectedText: "#FFFFFF",
  itemSelectedFill: "#FFFFFF0D",
  sectionTitle: "#F7F7F766",
  divider: "#F7F7F71A",
} as const;

export const text = {
  strong: "#17181E",
  base: "#282932",
  muted: "rgba(0, 0, 0, 0.6)",
  inactive: "rgba(0, 0, 0, 0.35)",
  inverted: "#FFFFFFE6",
} as const;

/** @public part of the deck's design token surface */
export const accent = {
  primary: "#1890FF",
  primaryHover: "#329DFF",
  link: "#146BF8",
  linkHover: "#065BE5",
  secondary: "#26222B",
  secondaryHover: "#46404D",
} as const;

export const semantic = {
  danger: "#DD1717",
  dangerHover: "#B31414",
  warning: "#CE7210",
  pending: "#EF6C00",
  success: "#2FB690",
  negative: "#F06868",
  neutral: "#D9D9D9",
} as const;

export const border = {
  base: "#0000001A",
  muted: "#0000000D",
  strong: "#00000026",
  primaryTint: "#1890FF33",
  errorTint: "#DD171733",
} as const;

/** @public part of the deck's design token surface */
export const button = {
  disabledText: "#878787",
  disabledFill: "#D7D7D7",
  outline: "#DDDDDD",
} as const;

/** 6%-opacity tinted chip background + solid text, per chip tone. */
export interface ChipTone {
  background: string;
  text: string;
}

export const chip = {
  success: { background: "#2FB6900F", text: "#2FB690" },
  error: { background: "#DD17170F", text: "#DD1717" },
  warning: { background: "#CE72100F", text: "#CE7210" },
  pending: { background: "#EF6C000F", text: "#EF6C00" },
  info: { background: "#1890FF14", text: "#1890FF" },
  muted: { background: "#0000000D", text: "rgba(0, 0, 0, 0.6)" },
} as const satisfies Record<string, ChipTone>;

/** Pulse states are visualized as colored dots; `active` also pulses. */
export const pulseDot: Record<
  "active" | "ready" | "idle" | "awaiting-input" | "blocked" | "gone",
  string
> = {
  active: "#2FB690",
  ready: "#4a9bff",
  idle: "#D9D9D9",
  "awaiting-input": "#fab958",
  blocked: "#ff5a5a",
  gone: "rgba(0, 0, 0, 0.35)",
};
