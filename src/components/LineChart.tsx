import { useId, useMemo, useState, type PointerEvent } from "react";
import { shortDate } from "../lib/program";

// One-series progress line. Single series → no legend; the card title names it.
// 2px line, 8px markers with a 2px surface ring, recessive grid, hover/tap tooltip.

export interface Point {
  date: string; // YYYY-MM-DD
  value: number;
}

const W = 320;
const H = 140;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

export default function LineChart({ points, unit, label }: { points: Point[]; unit: string; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const t = sorted.map((p) => Date.parse(p.date));
    const v = sorted.map((p) => p.value);
    const t0 = Math.min(...t);
    const t1 = Math.max(...t);
    let lo = Math.min(...v);
    let hi = Math.max(...v);
    const padV = Math.max((hi - lo) * 0.15, hi * 0.03, 1);
    lo -= padV;
    hi += padV;
    const x = (ms: number) => (t1 === t0 ? (PAD.left + W - PAD.right) / 2 : PAD.left + ((ms - t0) / (t1 - t0)) * (W - PAD.left - PAD.right));
    const y = (val: number) => PAD.top + (1 - (val - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const pts = sorted.map((p, k) => ({ ...p, x: x(t[k]), y: y(p.value) }));
    const ticks = niceTicks(lo, hi).filter((tk) => tk >= lo && tk <= hi);
    return { pts, ticks, y };
  }, [points]);

  if (!geo.pts.length) return null;
  const path = geo.pts.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = geo.pts[0];
  const last = geo.pts.at(-1)!;
  const shown = hover === null ? null : geo.pts[hover];

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    geo.pts.forEach((p, k) => {
      if (Math.abs(p.x - sx) < Math.abs(geo.pts[best].x - sx)) best = k;
    });
    setHover(best);
  }

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={`${id}-t`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: H }}
      >
        <title id={`${id}-t`}>
          {label}: {first.value} {unit} on {shortDate(first.date)}
          {geo.pts.length > 1 ? `, ${last.value} ${unit} on ${shortDate(last.date)}` : ""}
        </title>
        {geo.ticks.map((tk) => (
          <g key={tk}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={geo.y(tk)} y2={geo.y(tk)} />
            <text className="axis" x={PAD.left - 6} y={geo.y(tk) + 4} textAnchor="end">
              {tk}
            </text>
          </g>
        ))}
        <text className="axis" x={first.x} y={H - 6} textAnchor={geo.pts.length > 1 ? "start" : "middle"}>
          {shortDate(first.date).replace(/^\w+ /, "")}
        </text>
        {geo.pts.length > 1 && (
          <text className="axis" x={last.x} y={H - 6} textAnchor="end">
            {shortDate(last.date).replace(/^\w+ /, "")}
          </text>
        )}
        {geo.pts.length > 1 && <path className="series-line" d={path} />}
        {shown && <line className="crosshair" x1={shown.x} x2={shown.x} y1={PAD.top} y2={H - PAD.bottom} />}
        {geo.pts.map((p, k) => (
          <circle key={p.date} className="series-dot" cx={p.x} cy={p.y} r={k === hover ? 5.5 : 4} />
        ))}
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {shown && (
        <div className="tip" style={{ left: `${(shown.x / W) * 100}%`, top: shown.y - 8 }}>
          <strong>
            {shown.value} {unit}
          </strong>
          <span>{shortDate(shown.date)}</span>
        </div>
      )}
    </div>
  );
}
