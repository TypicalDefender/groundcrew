import type { ChipTone } from "@/lib/theme";

/** Tinted status chip: 6%-opacity fill, solid text, no border. */
export function Chip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
      style={{ background: tone.background, color: tone.text }}
    >
      {children}
    </span>
  );
}

/** Pulse indicator: colored dot; the active state breathes (reduced-motion aware). */
export function PulseDot({
  color,
  active,
  label,
}: {
  color: string;
  active: boolean;
  label: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5" title={`pulse: ${label}`}>
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${active ? "pulse-dot-active" : ""}`}
        style={{ backgroundColor: color }}
      />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </span>
  );
}

/** Agent identity badge using the agent's configured color as its accent. */
export function AgentBadge({
  agent,
  color,
}: {
  agent: string | undefined;
  color: string | undefined;
}): React.ReactElement | undefined {
  if (agent === undefined) {
    return undefined;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--border-muted)", color: "var(--text-base)" }}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color ?? "var(--semantic-neutral)" }}
      />
      {agent}
    </span>
  );
}
