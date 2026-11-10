import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DAY_TYPE_LABEL, parseProgram, type DayName, type DayType, type Family, type Week } from "../lib/program";
import {
  blankDay,
  blankMove,
  blankWeek,
  changedLockedDays,
  copyWeek,
  draftErrors,
  fromDraft,
  lockedDays,
  toDraft,
  type Draft,
  type DraftDay,
  type DraftMove,
  type DraftWeek,
} from "../lib/programDraft";
import { supabase } from "../lib/supabase";

const DAYS: DayName[] = ["Mon", "Tue", "Thu", "Fri"];
const TYPES: DayType[] = ["DL", "DU", "ML", "MU"];
const FAMILIES: Family[] = ["squat", "bench", "deadlift"];

/** Locked program days for a saved program: days with logged results in any cycle using it. */
async function loadLocks(programId: string, weeks: Week[]): Promise<Set<string>> {
  const c = await supabase.from("cycles").select("id, start_date").eq("program_id", programId);
  if (c.error) throw c.error;
  if (c.data.length === 0) return new Set();
  const l = await supabase.from("logs").select("cycle_id, performed_on").in("cycle_id", c.data.map((x) => x.id));
  if (l.error) throw l.error;
  const start = new Map(c.data.map((x) => [x.id, x.start_date as string]));
  return lockedDays(weeks, l.data.map((x) => ({ start_date: start.get(x.cycle_id)!, performed_on: x.performed_on })));
}

export default function ProgramEditor() {
  const { programId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !programId;
  const [teamId, setTeamId] = useState<string | null>(params.get("team"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Week[]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [cycleCount, setCycleCount] = useState(0);
  const [known, setKnown] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const ex = await supabase.from("exercises").select("name").order("name");
    if (!ex.error) setKnown([...new Set(ex.data.map((e) => e.name as string))]);
    if (isNew) {
      setDraft({ name: "", weeks: [blankWeek()], videos: {} });
      return;
    }
    const p = await supabase.from("programs").select("team_id, name, weeks, videos").eq("id", programId).single();
    if (p.error) return setError(p.error.message);
    let file;
    try {
      file = parseProgram(p.data);
    } catch (err) {
      return setError(`This program couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      setLocked(await loadLocks(programId!, file.weeks));
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    const c = await supabase.from("cycles").select("id", { count: "exact", head: true }).eq("program_id", programId);
    setCycleCount(c.count ?? 0);
    setTeamId(p.data.team_id);
    setSaved(file.weeks);
    setDraft(toDraft(file));
    setDirty(false);
  }, [programId, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /** Apply a mutation to a copy of the draft. */
  const edit = (fn: (d: Draft) => void) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
    setDirty(true);
    setFlash(null);
  };

  const lastLockedWeek = useMemo(() => Math.max(0, ...[...locked].map((k) => Number(k.split(":")[0]))), [locked]);
  const names = useMemo(() => {
    const s = new Set(known);
    draft?.weeks.forEach((w) => w.days.forEach((d) => [d.main, ...d.circuit, ...d.gpp].forEach((m) => m.name.trim() && s.add(m.name.trim()))));
    return [...s].sort();
  }, [known, draft]);
  const cats = useMemo(() => {
    const s = new Set(["Power", "Post. Chain", "Quad/Knee", "Hip/Glute", "Core", "Upper Pull", "Upper Push"]);
    draft?.weeks.forEach((w) => w.days.forEach((d) => d.gpp.forEach((m) => m.cat.trim() && s.add(m.cat.trim()))));
    return [...s];
  }, [draft]);

  async function save() {
    if (!draft || !teamId) return;
    const problems = draftErrors(draft);
    if (problems.length) return setError(problems.join(" "));
    const file = fromDraft(draft);
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const { data, error } = await supabase.from("programs").insert({ team_id: teamId, ...file }).select("id").single();
        if (error) throw error;
        setDirty(false);
        navigate(`/coach/programs/${data.id}`, { replace: true });
        return;
      }
      // Re-check locks against the latest saved version: someone may have logged since this page loaded.
      const cur = await supabase.from("programs").select("weeks").eq("id", programId).single();
      if (cur.error) throw cur.error;
      const latest = cur.data.weeks as Week[];
      const nowLocked = await loadLocks(programId!, latest);
      const broken = changedLockedDays(latest, file.weeks, nowLocked);
      if (broken.length) {
        setLocked(nowLocked);
        throw new Error(
          `These days already have logged results and can't change: ${broken.map((k) => k.replace(":", " ")).map((k) => `Week ${k}`).join(", ")}. Reload to see the current version.`,
        );
      }
      const { error } = await supabase.from("programs").update(file).eq("id", programId);
      if (error) throw error;
      setSaved(file.weeks);
      setLocked(nowLocked);
      setDirty(false);
      setFlash("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft || isNew) return;
    if (cycleCount > 0) return setError(`This program is used by ${cycleCount} cycle${cycleCount > 1 ? "s" : ""}. Delete those cycles first.`);
    if (!confirm(`Delete "${draft.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("programs").delete().eq("id", programId);
    if (error) return setError(error.message);
    setDirty(false);
    navigate("/coach");
  }

  if (error && !draft) return <p className="err">{error}</p>;
  if (!draft) return <p className="muted">Loading…</p>;

  const isLocked = (wi: number, d: DraftDay) => locked.has(`${wi + 1}:${d.day}`) && saved[wi]?.days.some((x) => x.day === d.day);

  return (
    <>
      <div className="spread">
        <Link to="/coach" className="small">
          ← Coach home
        </Link>
        {dirty && <span className="small muted">Unsaved changes</span>}
      </div>

      <section className="card">
        <h1>{isNew ? "New program" : "Edit program"}</h1>
        <label>
          Program name
          <input type="text" value={draft.name} onChange={(e) => edit((d) => (d.name = e.target.value))} placeholder="e.g. Winter Strength 2027" />
        </label>
        {cycleCount > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Used by {cycleCount} cycle{cycleCount > 1 ? "s" : ""}. Changes show up for athletes right away. Days with logged
            results are locked 🔒.
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          A video link belongs to the exercise name, so it shows everywhere that exercise appears.
        </p>
      </section>

      <datalist id="ex-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="gpp-cats">
        {cats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {draft.weeks.map((w, wi) => (
        <WeekEditor
          key={w.id}
          week={w}
          index={wi}
          videos={draft.videos}
          weekLocked={w.days.some((d) => isLocked(wi, d))}
          canRemove={wi + 1 > lastLockedWeek}
          isLocked={(d) => isLocked(wi, d)}
          edit={(fn) => edit((d) => fn(d.weeks[wi], d))}
          onRemove={() => {
            if (w.days.length && !confirm(`Remove week ${wi + 1}?`)) return;
            edit((d) => d.weeks.splice(wi, 1));
          }}
          onDuplicate={() => edit((d) => d.weeks.push(copyWeek(d.weeks[wi])))}
        />
      ))}

      <button className="btn" onClick={() => edit((d) => d.weeks.push(d.weeks.length ? copyWeek(d.weeks[d.weeks.length - 1]) : blankWeek()))}>
        + Add week{draft.weeks.length ? " (copies the last week)" : ""}
      </button>

      <div className="savebar">
        {error && <p className="err">{error}</p>}
        {flash && <p className="ok">{flash}</p>}
        <div className="row">
          <button className="btn solid" onClick={save} disabled={busy || (!dirty && !isNew)}>
            {busy ? "Saving…" : isNew ? "Create program" : "Save changes"}
          </button>
          {dirty && !isNew && (
            <button className="btn ghost" onClick={() => load()} disabled={busy}>
              Discard changes
            </button>
          )}
          {!isNew && (
            <button className="btn danger" onClick={remove} disabled={busy} style={{ marginLeft: "auto" }}>
              Delete program
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function WeekEditor(props: {
  week: DraftWeek;
  index: number;
  videos: Record<string, string>;
  weekLocked: boolean;
  canRemove: boolean;
  isLocked: (d: DraftDay) => boolean;
  edit: (fn: (w: DraftWeek, d: Draft) => void) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { week: w, index, edit, weekLocked } = props;
  const addDay = blankDay(w);
  return (
    <details className="card wk" open={index === 0}>
      <summary>
        <span className="wk-title">Week {index + 1}</span>
        <span className="muted small">
          {w.block || "—"} · {w.days.map((d) => d.day).join(" ") || "no days"}
          {weekLocked && " · 🔒"}
        </span>
      </summary>

      <fieldset disabled={weekLocked} className="bare">
        <div className="row">
          <label>
            Block
            <input type="text" value={w.block} onChange={(e) => edit((x) => (x.block = e.target.value))} placeholder="Block 1 · Build" />
          </label>
          <label style={{ flex: "0 1 120px" }}>
            Max-effort focus
            <select value={w.max} onChange={(e) => edit((x) => (x.max = e.target.value as "Upper" | "Lower"))}>
              <option>Upper</option>
              <option>Lower</option>
            </select>
          </label>
          <label style={{ flex: "0 1 100px" }}>
            Speed %
            <input type="number" inputMode="decimal" value={w.pct} onChange={(e) => edit((x) => (x.pct = e.target.value))} />
          </label>
        </div>
      </fieldset>

      {w.days.map((day, di) => (
        <DayEditor
          key={day.id}
          day={day}
          videos={props.videos}
          locked={props.isLocked(day)}
          usedDays={w.days.filter((_, i) => i !== di).map((x) => x.day)}
          edit={(fn) => edit((x, d) => fn(x.days[di], d))}
          onRemove={() => {
            if (!confirm(`Remove ${day.day} from week ${index + 1}?`)) return;
            edit((x) => x.days.splice(di, 1));
          }}
        />
      ))}

      <div className="row">
        {addDay && (
          <button className="btn" onClick={() => edit((x) => x.days.push(blankDay(x)!))}>
            + Add day
          </button>
        )}
        <button className="btn ghost" onClick={props.onDuplicate}>
          Duplicate week
        </button>
        {props.canRemove ? (
          <button className="btn ghost danger-text" onClick={props.onRemove}>
            Remove week
          </button>
        ) : (
          <span className="small muted">Can't remove: this or a later week has logged results.</span>
        )}
      </div>
    </details>
  );
}

function DayEditor(props: {
  day: DraftDay;
  videos: Record<string, string>;
  locked: boolean;
  usedDays: DayName[];
  edit: (fn: (day: DraftDay, d: Draft) => void) => void;
  onRemove: () => void;
}) {
  const { day, edit, locked } = props;
  const setVideo = (name: string, url: string) =>
    edit((_, d) => {
      if (name.trim()) d.videos[name.trim()] = url;
    });
  return (
    <div className="dayed" data-locked={locked || undefined}>
      <div className="spread">
        <strong className="dayed-title">
          {day.day} · {DAY_TYPE_LABEL[day.type]}
        </strong>
        {locked ? (
          <span className="small muted">🔒 Has logged results</span>
        ) : (
          <button className="btn ghost small danger-text" onClick={props.onRemove}>
            Remove day
          </button>
        )}
      </div>

      <fieldset disabled={locked} className="bare stack">
        <div className="row">
          <label style={{ flex: "0 1 110px" }}>
            Day
            <select value={day.day} onChange={(e) => edit((x) => (x.day = e.target.value as DayName))}>
              {DAYS.map((d) => (
                <option key={d} disabled={props.usedDays.includes(d)}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Session type
            <select value={day.type} onChange={(e) => edit((x) => (x.type = e.target.value as DayType))}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {DAY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <MoveList
          title="Circuit"
          moves={day.circuit}
          videos={props.videos}
          setVideo={setVideo}
          edit={(fn) => edit((x) => fn(x.circuit))}
        />

        <div className="sub">
          <div className="sub-title">Main lift</div>
          <div className="row">
            <label style={{ flex: "2 1 200px" }}>
              Exercise
              <input type="text" list="ex-names" value={day.main.name} onChange={(e) => edit((x) => (x.main.name = e.target.value))} placeholder="e.g. Speed Box Squat" />
            </label>
            <label style={{ flex: "0 1 80px" }}>
              Sets
              <input type="text" inputMode="numeric" value={day.main.sets} onChange={(e) => edit((x) => (x.main.sets = e.target.value))} placeholder="8" />
            </label>
            <label style={{ flex: "1 1 120px" }}>
              Reps
              <input type="text" value={day.main.reps} onChange={(e) => edit((x) => (x.main.reps = e.target.value))} placeholder="2 or 3RM" />
            </label>
          </div>
          <div className="row">
            <label style={{ flex: "0 1 130px" }}>
              Lift family
              <select value={day.main.key} onChange={(e) => edit((x) => (x.main.key = e.target.value as Family))}>
                {FAMILIES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: "0 1 110px" }}>
              % of max
              <input type="number" inputMode="decimal" value={day.main.pct} onChange={(e) => edit((x) => (x.main.pct = e.target.value))} placeholder="blank = none" />
            </label>
            <label style={{ flex: "2 1 200px" }}>
              Video link
              <input
                type="url"
                value={props.videos[day.main.name.trim()] ?? ""}
                onChange={(e) => setVideo(day.main.name, e.target.value)}
                placeholder="https://youtube.com/…"
                disabled={!day.main.name.trim()}
              />
            </label>
          </div>
          <label>
            Coaching note
            <input type="text" value={day.main.note} onChange={(e) => edit((x) => (x.main.note = e.target.value))} placeholder="e.g. Explode off the box." />
          </label>
        </div>

        <MoveList
          title="GPP / accessories"
          withCat
          moves={day.gpp}
          videos={props.videos}
          setVideo={setVideo}
          edit={(fn) => edit((x) => fn(x.gpp))}
        />
      </fieldset>
    </div>
  );
}

function MoveList(props: {
  title: string;
  withCat?: boolean;
  moves: DraftMove[];
  videos: Record<string, string>;
  setVideo: (name: string, url: string) => void;
  edit: (fn: (list: DraftMove[]) => void) => void;
}) {
  const { moves, edit } = props;
  return (
    <div className="sub">
      <div className="sub-title">{props.title}</div>
      {moves.length === 0 && <p className="small muted" style={{ margin: 0 }}>None.</p>}
      {moves.map((m, i) => (
        <div key={m.id} className="mvrow">
          <span className="mvnum">{i + 1}</span>
          <div className="mvfields">
            <div className="row">
              <label style={{ flex: "2 1 180px" }}>
                Exercise
                <input type="text" list="ex-names" value={m.name} onChange={(e) => edit((l) => (l[i].name = e.target.value))} />
              </label>
              <label style={{ flex: "0 1 70px" }}>
                Sets
                <input type="text" inputMode="numeric" value={m.sets} onChange={(e) => edit((l) => (l[i].sets = e.target.value))} />
              </label>
              <label style={{ flex: "1 1 100px" }}>
                Reps / time
                <input type="text" value={m.reps} onChange={(e) => edit((l) => (l[i].reps = e.target.value))} placeholder="10 or 30 sec" />
              </label>
            </div>
            <div className="row">
              {props.withCat && (
                <label style={{ flex: "1 1 130px" }}>
                  Category
                  <input type="text" list="gpp-cats" value={m.cat} onChange={(e) => edit((l) => (l[i].cat = e.target.value))} />
                </label>
              )}
              <label style={{ flex: "2 1 200px" }}>
                Video link
                <input
                  type="url"
                  value={props.videos[m.name.trim()] ?? ""}
                  onChange={(e) => props.setVideo(m.name, e.target.value)}
                  placeholder={m.name.trim() ? "https://youtube.com/…" : "Name the exercise first"}
                  disabled={!m.name.trim()}
                />
              </label>
            </div>
          </div>
          <div className="mvctl">
            <button className="btn ghost small" aria-label="Move up" disabled={i === 0} onClick={() => edit((l) => l.splice(i - 1, 0, ...l.splice(i, 1)))}>
              ↑
            </button>
            <button className="btn ghost small" aria-label="Move down" disabled={i === moves.length - 1} onClick={() => edit((l) => l.splice(i + 1, 0, ...l.splice(i, 1)))}>
              ↓
            </button>
            <button className="btn ghost small danger-text" aria-label={`Remove ${m.name || "exercise"}`} onClick={() => edit((l) => l.splice(i, 1))}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => edit((l) => l.push(blankMove()))}>
        + Add exercise
      </button>
    </div>
  );
}
