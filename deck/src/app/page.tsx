import { FleetStatus } from "@/app/fleetStatus";
import { pulseDot } from "@/lib/theme";

const PULSE_LEGEND = ["active", "ready", "idle", "awaiting-input", "blocked", "gone"] as const;

export default function Home(): React.ReactElement {
  return (
    <section
      className="rounded-lg border p-6"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
    >
      <h1 className="text-lg font-bold" style={{ color: "var(--text-strong)" }}>
        The deck is online
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        The board arrives next: live tasks, pulse, CI, and review state at a glance.
      </p>
      <ul className="mt-5 flex flex-wrap gap-4">
        {PULSE_LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 rounded-full ${state === "active" ? "pulse-dot-active" : ""}`}
              style={{ backgroundColor: pulseDot[state] }}
            />
            <span style={{ color: "var(--text-base)" }}>{state}</span>
          </li>
        ))}
      </ul>
      <FleetStatus />
    </section>
  );
}
