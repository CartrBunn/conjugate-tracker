import { useEffect, useState, type KeyboardEvent } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  value: number | null;
  /** Persist the new value (null = cleared). Resolve to an error message, or null on success. */
  onSave: (value: number | null) => Promise<string | null>;
  label: string;
  /** Grid position, used for Enter-to-move-down. */
  row: number;
  col: number;
  grid: string;
}

/** A numeric grid cell that saves on blur and shows saving / saved / error. */
export default function NumberCell({ value, onSave, label, row, col, grid }: Props) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  async function commit() {
    const trimmed = text.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setState("error");
      setError("Enter a number");
      return;
    }
    if (next === value) return;
    setState("saving");
    const err = await onSave(next);
    setError(err);
    setState(err ? "error" : "saved");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const nextCell = document.querySelector<HTMLInputElement>(
      `input[data-grid="${grid}"][data-row="${row + 1}"][data-col="${col}"]`,
    );
    if (nextCell) nextCell.focus();
    else e.currentTarget.blur();
  }

  return (
    <input
      className="cell"
      data-state={state}
      data-grid={grid}
      data-row={row}
      data-col={col}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      title={error ?? undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value.replace(/[^\d.]/g, ""));
        if (state !== "saving") setState("idle");
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
