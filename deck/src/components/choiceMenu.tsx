"use client";

export interface MenuChoice {
  key: string;
  label: string;
}

/** Small dropdown panel shared by the pause and snooze controls. */
export function ChoiceMenu({
  ariaLabel,
  align,
  choices,
  onChoose,
}: {
  ariaLabel: string;
  align: "left" | "right";
  choices: readonly MenuChoice[];
  onChoose: (key: string) => void;
}): React.ReactElement {
  return (
    <div
      className={`absolute ${align === "left" ? "left-0" : "right-0"} top-9 z-40 w-44 rounded-lg border p-1 shadow-lg`}
      style={{ background: "var(--surface-card)", borderColor: "var(--border-base)" }}
      role="menu"
      aria-label={ariaLabel}
    >
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          role="menuitem"
          onClick={() => {
            onChoose(choice.key);
          }}
          className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-black/5"
          style={{ color: "var(--text-base)" }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
