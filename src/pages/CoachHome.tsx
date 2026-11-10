import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import templateUrl from "../../supabase/seed/example-program.json?url";
import { formatCode, parseProgram } from "../lib/program";
import { supabase } from "../lib/supabase";

interface Team {
  id: string;
  name: string;
}
interface Group {
  id: string;
  name: string;
  join_code: string;
}
interface Program {
  id: string;
  name: string;
}

export default function CoachHome() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase.from("teams").select("id, name").order("name");
    if (error) return setError(error.message);
    setTeams(data);
    setTeamId((cur) => cur ?? data[0]?.id ?? null);
  }, []);

  const loadTeam = useCallback(async (id: string) => {
    const [g, p] = await Promise.all([
      supabase.from("groups").select("id, name, join_code").eq("team_id", id).order("name"),
      supabase.from("programs").select("id, name").eq("team_id", id).order("created_at"),
    ]);
    if (g.error || p.error) return setError((g.error ?? p.error)!.message);
    setGroups(g.data);
    setPrograms(p.data);
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);
  useEffect(() => {
    if (teamId) loadTeam(teamId);
  }, [teamId, loadTeam]);

  async function createTeam(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("create_team", { p_name: newTeam });
    if (error) return setError(error.message);
    setNewTeam("");
    setTeamId(data as string);
    loadTeams();
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    if (!teamId) return;
    const { error } = await supabase.from("groups").insert({ team_id: teamId, name: newGroup.trim() });
    if (error) return setError(error.message);
    setNewGroup("");
    loadTeam(teamId);
  }

  async function refreshCode(g: Group) {
    if (!confirm(`Make a new join code for ${g.name}? The old code stops working for new sign-ins. Phones already signed in stay signed in.`))
      return;
    const { error } = await supabase.rpc("rotate_join_code", { p_group: g.id });
    if (error) return setError(error.message);
    if (teamId) loadTeam(teamId);
  }

  async function importProgram(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again
    if (!file || !teamId) return;
    setError(null);
    let program;
    try {
      program = parseProgram(JSON.parse(await file.text()));
    } catch (err) {
      return setError(`Couldn't import ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    setImporting(true);
    const { error } = await supabase.from("programs").insert({ team_id: teamId, ...program });
    setImporting(false);
    if (error) return setError(error.message);
    loadTeam(teamId);
  }

  if (teams === null) return <p className="muted">Loading…</p>;

  return (
    <>
      {error && <p className="err">{error}</p>}

      {teams.length === 0 ? (
        <form className="card" onSubmit={createTeam}>
          <h1>Create your team</h1>
          <label>
            Team name
            <input type="text" required value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="e.g. Central Track & Field" />
          </label>
          <button className="btn solid">Create team</button>
        </form>
      ) : (
        <>
          <div className="spread">
            <h1>{teams.find((t) => t.id === teamId)?.name}</h1>
            {teams.length > 1 && (
              <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} style={{ width: "auto" }}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <section className="card">
            <h3>Groups</h3>
            {groups.length === 0 && <p className="muted">No groups yet.</p>}
            <ul className="list">
              {groups.map((g) => (
                <li key={g.id} className="spread">
                  <Link to={`/coach/groups/${g.id}`}>
                    <strong>{g.name}</strong>
                  </Link>
                  <span className="row muted small">
                    Code <span className="code" style={{ fontSize: 18 }}>{formatCode(g.join_code)}</span>
                    <button
                      className="btn ghost small"
                      onClick={() => refreshCode(g)}
                      aria-label={`Make a new join code for ${g.name}`}
                      title="Make a new join code"
                    >
                      ↻ New code
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={createGroup}>
              <input type="text" required placeholder="New group, e.g. Sprinters" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} style={{ flex: 1 }} />
              <button className="btn">Add group</button>
            </form>
          </section>

          <section className="card">
            <h3>Programs</h3>
            {programs.length === 0 ? (
              <p className="muted">No programs yet. Import a program JSON file to start.</p>
            ) : (
              <ul className="list">
                {programs.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
            )}
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={importProgram} hidden />
            <div className="row">
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? "Importing…" : "Import program (.json)"}
              </button>
              <a className="small" href={templateUrl} download="program-template.json">
                Download template
              </a>
            </div>
          </section>
        </>
      )}
    </>
  );
}
