import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Move } from "../lib/program";

// Circuit timer: 30 s work / 15 s change between moves,
// 2 rounds, 60 s rest between rounds. Beeps on each change, keeps the screen awake while running.

interface Step {
  kind: "work" | "rest";
  seconds: number;
  label: string;
  tag: string;
}

export function buildSequence(circuit: Move[], rounds = 2): Step[] {
  const seq: Step[] = [];
  for (let r = 1; r <= rounds; r++) {
    circuit.forEach((mv, i) => {
      seq.push({ kind: "work", seconds: 30, label: mv.name, tag: `Round ${r} · Go` });
      if (i < circuit.length - 1)
        seq.push({ kind: "rest", seconds: 15, label: `Next: ${circuit[i + 1].name}`, tag: `Round ${r} · Change` });
    });
    if (r < rounds) seq.push({ kind: "rest", seconds: 60, label: `Next: ${circuit[0].name}`, tag: `Rest before round ${r + 1}` });
  }
  return seq;
}

export default function CircuitTimer({ circuit }: { circuit: Move[] }) {
  const seq = useMemo(() => buildSequence(circuit), [circuit]);
  const total = useMemo(() => seq.reduce((a, s) => a + s.seconds, 0), [seq]);
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(seq[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  const beep = useCallback((freq: number, ms: number) => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current ??= new AC();
      const o = audio.current.createOscillator();
      const g = audio.current.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.25;
      o.connect(g);
      g.connect(audio.current.destination);
      o.start();
      o.stop(audio.current.currentTime + ms / 1000);
    } catch {
      /* sound is optional */
    }
  }, []);

  const releaseLock = useCallback(() => {
    lock.current?.release().catch(() => {});
    lock.current = null;
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    releaseLock();
    setI(0);
    setLeft(seq[0]?.seconds ?? 0);
  }, [seq, releaseLock]);

  // New day → fresh timer.
  useEffect(() => reset(), [reset]);
  useEffect(() => releaseLock, [releaseLock]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const remaining = (endAt.current - Date.now()) / 1000;
      if (remaining > 0) return setLeft(remaining);
      setI((cur) => {
        const next = cur + 1;
        if (next >= seq.length) {
          setRunning(false);
          releaseLock();
          beep(520, 600);
          setLeft(0);
          return next;
        }
        endAt.current = Date.now() + seq[next].seconds * 1000;
        setLeft(seq[next].seconds);
        beep(seq[next].kind === "work" ? 880 : 440, 250);
        return next;
      });
    }, 200);
    return () => clearInterval(id);
  }, [running, seq, beep, releaseLock]);

  function toggle() {
    if (i >= seq.length) {
      reset();
      return;
    }
    if (running) {
      setRunning(false);
      releaseLock();
      return;
    }
    endAt.current = Date.now() + left * 1000;
    setRunning(true);
    beep(880, 250);
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request("screen").then((l) => (lock.current = l)).catch(() => {});
  }

  if (!seq.length) return null;
  const done = i >= seq.length;
  const step = done ? null : seq[i];
  const started = running || i > 0 || left < seq[0].seconds;
  const elapsed = seq.slice(0, i).reduce((a, s) => a + s.seconds, 0) + (step ? step.seconds - left : 0);

  return (
    <div className="timer">
      <div className={`phase ${step?.kind ?? ""}`}>{done ? "Circuit done" : started ? step!.tag : "Ready"}</div>
      <div className="clock" aria-live="off">
        {done ? "✓" : Math.ceil(left)}
      </div>
      <div className="now">{done ? "On to the main lift" : step!.label}</div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${(100 * elapsed) / total}%` }} />
      </div>
      <div className="ctl">
        <button className="act solid" type="button" onClick={toggle}>
          {done ? "Run again" : running ? "Pause" : started ? "Resume" : "Start timer"}
        </button>
        <button className="act" type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
