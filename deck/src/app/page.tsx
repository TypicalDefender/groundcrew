import { Board } from "@/components/board";
import { FleetStatus } from "@/app/fleetStatus";

export default function Home(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold" style={{ color: "var(--text-strong)" }}>
          Board
        </h1>
        <FleetStatus />
      </div>
      <Board />
    </div>
  );
}
