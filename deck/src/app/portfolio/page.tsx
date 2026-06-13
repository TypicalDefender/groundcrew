import { PortfolioView } from "@/components/portfolioView";

export default function PortfolioPage(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold" style={{ color: "var(--text-strong)" }}>
          Portfolio
        </h1>
        <a href="/" className="text-sm" style={{ color: "var(--accent-link)" }}>
          ← Board
        </a>
      </div>
      <PortfolioView />
    </div>
  );
}
