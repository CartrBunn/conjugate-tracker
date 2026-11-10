import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatCode, isMonday, localToday, mondayOnOrAfter, shortDate } from "../lib/program";
import { supabase } from "../lib/supabase";

// Athletes are numbers only; the app stores no names. The coach keeps the number list.
interface Group {
  id: string;
  team_id: string;
  name: string;
  join_code: string;
}
interface Cycle {
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "active" | "closed";
}
interface Program {
  id: string;
  name: string;
}
interface Athlete {
  id: string;
  number: number;
  active: boolean;
}
interface PinRow {
  athlete_id: string;
  number: number;
  pin: string;
}

export default function GroupPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [number, setNumber] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PinRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [cycleName, setCycleName] = useState("");
  const [cycleProgram, setCycleProgram] = useState("");
  const [cycleStart, setCycleStart] = useState(mondayOnOrAfter(localToday()));

  const load = useCallback(async () => {
    const [g, a] = await Promise.all([
      supabase.from("groups").select("id, team_id, name, join_code").eq("id", groupId).single(),
      supabase.from("athletes").select("id, number, active").eq("group_id", groupId).order("number"),
    ]);
    if (g.error || a.error) return setError((g.error ?? a.error)!.message);
    setGroup(g.data);
    setAthletes(a.data);
    const [c, p] = await Promise.all([
      supabase.from("cycles").select("id, name, start_date, status").eq("group_id", groupId).order("start_date", { ascending: false }),
      supabase.from("programs").select("id, name").eq("team_id", g.data.team_id).order("created_at"),
    ]);
    if (c.error || p.error) return setError((c.error ?? p.error)!.message);
    setCycles(c.data);
    setPrograms(p.data);
    setCycleProgram((cur) => cur || p.data[0]?.id || "");
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  function fail(msg: string) {
    setFlash(null);
    setError(msg);
  }

  async function addAthlete(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("add_athlete", {
      p_group: groupId,
      p_number: number ? Number(number) : null,
    });
    if (error) return fail(error.message);
    setError(null);
    setFlash(`Athlete #${data[0].number} added. PIN: ${data[0].pin}. Write it down — it can't be shown again.`);
    setNumber("");
    load();
  }

  async function resetPin(a: Athlete) {
    const { data, error } = await supabase.rpc("reset_athlete_pin", { p_athlete: a.id });
    if (error) return fail(error.message);
    setError(null);
    setFlash(`New PIN for athlete #${a.number}: ${data}`);
  }

  async function signOutDevices(a: Athlete) {
    const { data, error } = await supabase.rpc("revoke_athlete_devices", { p_athlete: a.id });
    if (error) return fail(error.message);
    setError(null);
    setFlash(`Signed athlete #${a.number} out of ${data} device(s).`);
  }

  async function toggleActive(a: Athlete) {
    const { error } = await supabase.from("athletes").update({ active: !a.active }).eq("id", a.id);
    if (error) return fail(error.message);
    load();
  }

  async function rotateCode() {
    if (!confirm("Make a new join code? The old one stops working for new sign-ins. Signed-in phones stay signed in.")) return;
    const { error } = await supabase.rpc("rotate_join_code", { p_group: groupId });
    if (error) return fail(error.message);
    load();
  }

  async function createCycle(e: FormEvent) {
    e.preventDefault();
    if (!group) return;
    if (!isMonday(cycleStart)) return fail("Cycles start on a Monday.");
    const { data, error } = await supabase
      .from("cycles")
      .insert({
        team_id: group.team_id,
        group_id: group.id,
        program_id: cycleProgram,
        name: cycleName.trim() || `${group.name} · ${shortDate(cycleStart)}`,
        start_date: cycleStart,
        status: cycleStart <= localToday() ? "active" : "planned",
      })
      .select("id")
      .single();
    if (error) return fail(error.message);
    navigate(`/coach/cycles/${data.id}`);
  }

  async function printSheet() {
    if (!confirm("This resets every athlete's PIN in this group, then shows a sheet to print. Continue?")) return;
    const { data, error } = await supabase.rpc("reset_group_pins", { p_group: groupId });
    if (error) return fail(error.message);
    setSheet(data);
  }

  if (!group) return error ? <p className="err">{error}</p> : <p className="muted">Loading…</p>;

  if (sheet)
    return (
      <div className="card">
        <div className="spread noprint">
          <button className="btn ghost" onClick={() => setSheet(null)}>
            ← Back
          </button>
          <button className="btn solid" onClick={() => window.print()}>
            Print
          </button>
        </div>
        <h1>{group.name}</h1>
        <p>
          Go to the team site, tap <strong>I'm an athlete</strong>, enter code{" "}
          <span className="code">{formatCode(group.join_code)}</span>, then your athlete number and PIN.
        </p>
        <p className="muted small">Cut into slips: one number + PIN per athlete.</p>
        <ul className="list">
          {sheet.map((r) => (
            <li key={r.athlete_id} className="spread">
              <span>
                Athlete <strong className="pin" style={{ fontSize: 22, letterSpacing: ".05em" }}>#{r.number}</strong>
              </span>
              <span>
                PIN <span className="pin" style={{ fontSize: 22 }}>{r.pin}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  const activeCount = athletes.filter((a) => a.active).length;

  return (
    <>
      <Link to="/coach" className="small">
        ← All groups
      </Link>
      <div className="spread">
        <h1>{group.name}</h1>
        <div className="row">
          <span className="code">{formatCode(group.join_code)}</span>
          <button className="btn" onClick={rotateCode}>
            ↻ New code
          </button>
        </div>
      </div>

      {flash && <p className="notice ok">{flash}</p>}
      {error && <p className="err">{error}</p>}

      <section className="card">
        <h3>Cycles</h3>
        {cycles.length > 0 && (
          <ul className="list">
            {cycles.map((c) => (
              <li key={c.id} className="spread">
                <Link to={`/coach/cycles/${c.id}`}>
                  <strong>{c.name}</strong>
                </Link>
                <span className="muted small">
                  starts {shortDate(c.start_date)} · {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {programs.length === 0 ? (
          <p className="muted">
            Import a program on the <Link to="/coach">coach home page</Link> first.
          </p>
        ) : (
          <form className="stack" onSubmit={createCycle}>
            <div className="row">
              <label>
                Program
                <select value={cycleProgram} onChange={(e) => setCycleProgram(e.target.value)}>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start (a Monday)
                <input type="date" required value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} />
              </label>
            </div>
            <label>
              Name (optional)
              <input type="text" placeholder={`${group.name} · ${shortDate(cycleStart)}`} value={cycleName} onChange={(e) => setCycleName(e.target.value)} />
            </label>
            {!isMonday(cycleStart) && <p className="err small">Pick a Monday.</p>}
            <button className="btn solid" disabled={!cycleProgram || !isMonday(cycleStart)}>
              Start a cycle
            </button>
          </form>
        )}
      </section>

      <form className="card" onSubmit={addAthlete}>
        <h3>Add athlete</h3>
        <p className="muted small">
          Athletes are numbers only — the app stores no names. Keep your own list of who has which number.
        </p>
        <div className="row">
          <label>
            Athlete number (blank = next free number)
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="auto"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </label>
        </div>
        <button className="btn solid">Add and make PIN</button>
      </form>

      <section className="card">
        <div className="spread">
          <h3>Roster ({activeCount})</h3>
          <button className="btn" onClick={printSheet} disabled={activeCount === 0}>
            Reset &amp; print PIN sheet
          </button>
        </div>
        <ul className="list">
          {athletes.map((a) => (
            <li key={a.id} className="spread" style={{ opacity: a.active ? 1 : 0.5 }}>
              <strong>Athlete #{a.number}</strong>
              <span className="row">
                {a.active && (
                  <>
                    <button className="btn ghost small" onClick={() => resetPin(a)}>
                      Reset PIN
                    </button>
                    <button className="btn ghost small" onClick={() => signOutDevices(a)}>
                      Sign out phones
                    </button>
                  </>
                )}
                <button className="btn ghost small" onClick={() => toggleActive(a)}>
                  {a.active ? "Deactivate" : "Reactivate"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
