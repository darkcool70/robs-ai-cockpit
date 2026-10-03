//! Loops and prompt queues: prepared prompts that are sent to a session one after another,
//! each as soon as the agent has finished the previous one.
//!
//! * queue — every prompt once, in order.
//! * loop  — the prompt list again and again (`repeat` rounds, 0 = until stopped), optionally
//!   until the agent's answer contains a stop phrase (e.g. "ALL DONE").
//! * goal  — a goal instead of fixed prompts: after every answer a small supervisor model
//!   (see `goal.rs`) judges the progress and writes the next prompt, until the goal is reached,
//!   the supervisor needs the user, or `repeat` rounds are used up (0 = no limit).
//!
//! The decision logic is pure (`decide`) and unit tested; the monitor applies it every tick.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::now_iso;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub mode: String,
    pub prompts: Vec<String>,
    pub repeat: i64,
    pub delay_sec: i64,
    pub stop_phrase: Option<String>,
    /// running | paused | done | stopped
    pub state: String,
    /// Index of the next prompt to send.
    pub step: i64,
    /// Completed rounds through the prompt list.
    pub iteration: i64,
    pub last_sent_at: Option<i64>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Mode "goal": what to achieve and who supervises.
    #[serde(default)]
    pub goal: Option<GoalConfig>,
    /// Mode "goal": the supervisor's latest estimate, 0–100.
    #[serde(default)]
    pub progress: Option<i64>,
    /// Mode "goal": every supervisor verdict, oldest first.
    #[serde(default)]
    pub log: Vec<GoalStep>,
    /// Mode "goal": the next prompt, written by the supervisor, not sent yet.
    #[serde(default)]
    pub pending: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GoalConfig {
    pub goal: String,
    /// When the goal counts as reached (optional; else the supervisor's judgement).
    pub criteria: Option<String>,
    /// Account that runs the supervisor (default: the session's own account).
    pub supervisor_account_id: Option<String>,
    /// Supervisor model (default: a small one, e.g. Claude Haiku).
    pub supervisor_model: Option<String>,
    /// Put in front of the first prompt (assistants on CLIs without a system-prompt flag).
    pub preamble: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GoalStep {
    pub at: i64,
    /// continue | done | blocked | error
    pub status: String,
    pub progress: i64,
    pub summary: String,
    pub prompt: Option<String>,
    pub question: Option<String>,
}

impl Automation {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Give the loop a name".into());
        }
        if !matches!(self.mode.as_str(), "queue" | "loop" | "goal") {
            return Err("Mode must be queue, loop or goal".into());
        }
        if self.mode == "goal" {
            let Some(g) = self.goal.as_ref().filter(|g| !g.goal.trim().is_empty()) else {
                return Err("Describe the goal".into());
            };
            if g.goal.len() > 20_000 || g.criteria.as_ref().is_some_and(|c| c.len() > 20_000) {
                return Err("Goal or criteria too long".into());
            }
        } else if self.prompts.iter().all(|p| p.trim().is_empty()) {
            return Err("Add at least one prompt".into());
        }
        if self.prompts.len() > 200 || self.prompts.iter().any(|p| p.len() > 20_000) {
            return Err("Too many or too long prompts".into());
        }
        if !(0..=10_000).contains(&self.repeat) || !(0..=86_400).contains(&self.delay_sec) {
            return Err("Repeat or delay out of range".into());
        }
        Ok(())
    }

    fn prompts_clean(&self) -> Vec<&str> {
        self.prompts.iter().map(|p| p.trim()).filter(|p| !p.is_empty()).collect()
    }

    /// Total prompts to send (None = unlimited loop).
    pub fn total(&self) -> Option<i64> {
        let n = self.prompts_clean().len() as i64;
        match self.mode.as_str() {
            "goal" => (self.repeat > 0).then_some(self.repeat),
            "queue" => Some(n),
            _ if self.repeat > 0 => Some(n * self.repeat),
            _ => None,
        }
    }

    pub fn sent(&self) -> i64 {
        if self.mode == "goal" {
            return self.step;
        }
        self.iteration * self.prompts_clean().len() as i64 + self.step
    }

    /// Back to the start (keeps the configuration).
    pub fn rewind(&mut self) {
        self.step = 0;
        self.iteration = 0;
        self.last_sent_at = None;
        self.progress = None;
        self.log.clear();
        self.pending = None;
    }
}

/// What the monitor knows about the session right now.
#[derive(Debug, Clone, Default)]
pub struct Ctx<'a> {
    pub now: i64,
    pub running: bool,
    pub status: &'a str,
    /// The input box is visible and output has settled.
    pub ready: bool,
    /// The session delivers reliable "turn finished" signals (hooks / rollout).
    pub provider_signals: bool,
    /// When the agent last finished a turn (provider signal).
    pub turn_ended_at: Option<i64>,
    pub last_message: Option<&'a str>,
    /// Mode "goal": a supervisor call is in flight.
    pub supervising: bool,
    /// When the CLI process was (re)started. A prompt sent before that was interrupted.
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Wait(Option<String>),
    Send { text: String, step: i64, iteration: i64 },
    Finish(String),
    /// Mode "goal": the agent finished a turn; ask the supervisor what comes next.
    Supervise,
}

/// What the monitor hands to the goal supervisor when an agent finished a turn.
#[derive(Debug, Clone)]
pub struct SuperviseJob {
    pub session_id: String,
    pub automation: Automation,
    /// The agent's latest answer (excerpt).
    pub answer: String,
    /// The session's own account (supervisor fallback).
    pub account_id: Option<String>,
    /// Claude transcript: the full answer is read from it.
    pub transcript: Option<String>,
}

/// The first prompt of a goal: the goal itself, with the working agreement.
pub fn kickoff_prompt(a: &Automation) -> String {
    if let Some(p) = a.prompts_clean().first() {
        return p.to_string();
    }
    let g = a.goal.clone().unwrap_or_default();
    let mut s = String::new();
    if let Some(p) = g.preamble.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        s.push_str(p);
        s.push_str("\n\n");
    }
    s.push_str(&format!("GOAL: {}\n", g.goal.trim()));
    if let Some(c) = g.criteria.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        s.push_str(&format!("SUCCESS CRITERIA: {c}\n"));
    }
    s.push_str(
        "\nWork toward this goal autonomously. Start with a short plan, then implement the first step right away. \
         End every answer with a short status: what is done, how you verified it, and what comes next.",
    );
    s
}

fn decide_goal(a: &Automation, c: &Ctx) -> Decision {
    let Some(sent) = a.last_sent_at else {
        if !c.ready || c.status == "working" {
            return Decision::Wait(Some("Waiting until the session is ready".into()));
        }
        return Decision::Send { text: kickoff_prompt(a), step: 1, iteration: 0 };
    };
    let finished = match c.turn_ended_at {
        Some(t) if t > sent => Some(t),
        _ if !c.provider_signals && c.ready && c.status != "working" && c.now - sent > 8_000 => Some(sent + 8_000),
        // The session restarted after the prompt went out: that turn was cut off.
        _ if c.started_at > sent && c.ready && c.status != "working" => Some(c.started_at),
        _ => None,
    };
    let Some(t) = finished else { return Decision::Wait(Some("Working toward the goal".into())) };
    if let Some(p) = a.pending.as_deref().filter(|p| !p.trim().is_empty()) {
        let due = t + a.delay_sec * 1000;
        if c.now < due {
            return Decision::Wait(Some(format!("Next step in {} s", (due - c.now + 999) / 1000)));
        }
        if !c.ready {
            return Decision::Wait(Some("Waiting until the session is ready".into()));
        }
        return Decision::Send { text: p.to_string(), step: a.step + 1, iteration: 0 };
    }
    if c.supervising {
        return Decision::Wait(Some("Reviewing the answer…".into()));
    }
    if a.log.last().is_some_and(|l| l.at >= t && l.status == "continue") {
        // Already reviewed. (An error or a question pauses the goal; resuming reviews again.)
        return Decision::Wait(a.note.clone());
    }
    if a.repeat > 0 && a.step >= a.repeat {
        return Decision::Finish(format!("Stopped after {} rounds; the goal is not confirmed yet", a.step));
    }
    Decision::Supervise
}

pub fn decide(a: &Automation, c: &Ctx) -> Decision {
    if a.state != "running" {
        return Decision::Wait(None);
    }
    let prompts = a.prompts_clean();
    if prompts.is_empty() && a.mode != "goal" {
        return Decision::Finish("No prompts".into());
    }
    if !c.running {
        return Decision::Wait(Some("Waiting: session is not running".into()));
    }
    if c.status == "rate-limited" {
        return Decision::Wait(Some("Waiting for the usage limit to reset".into()));
    }
    if a.mode == "goal" {
        return decide_goal(a, c);
    }
    // Has the previous prompt been answered?
    let idle_since = match a.last_sent_at {
        None => {
            if !c.ready || c.status == "working" {
                return Decision::Wait(Some("Waiting until the session is ready".into()));
            }
            // Nothing sent yet: start right away (delay applies between prompts).
            None
        }
        Some(sent) => {
            let finished = match c.turn_ended_at {
                Some(t) if t > sent => Some(t),
                // No provider signals: settled output a while after sending counts as done.
                _ if !c.provider_signals && c.ready && c.status != "working" && c.now - sent > 8_000 => Some(sent + 8_000),
                // The session restarted after the prompt went out: go on with the next one.
                _ if c.started_at > sent && c.ready && c.status != "working" => Some(c.started_at),
                _ => None,
            };
            let Some(t) = finished else { return Decision::Wait(Some("Agent is working on the current prompt".into())) };
            if let (Some(phrase), Some(msg)) = (a.stop_phrase.as_deref().map(str::trim).filter(|p| !p.is_empty()), c.last_message) {
                if msg.to_lowercase().contains(&phrase.to_lowercase()) {
                    return Decision::Finish(format!("Stopped: the agent said \"{phrase}\""));
                }
            }
            if let Some(total) = a.total() {
                if a.sent() >= total {
                    return Decision::Finish(format!("Done: {total} prompt{} sent", if total == 1 { "" } else { "s" }));
                }
            }
            Some(t)
        }
    };
    if let Some(t) = idle_since {
        let due = t + a.delay_sec * 1000;
        if c.now < due {
            return Decision::Wait(Some(format!("Next prompt in {} s", (due - c.now + 999) / 1000)));
        }
        if !c.ready {
            return Decision::Wait(Some("Waiting until the session is ready".into()));
        }
    }
    let idx = a.step.clamp(0, prompts.len() as i64 - 1) as usize;
    let (mut step, mut iteration) = (idx as i64 + 1, a.iteration);
    if step >= prompts.len() as i64 {
        step = 0;
        iteration += 1;
    }
    Decision::Send { text: prompts[idx].to_string(), step, iteration }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

fn from_row(r: &Row) -> rusqlite::Result<Automation> {
    let prompts: String = r.get("prompts")?;
    Ok(Automation {
        id: r.get("id")?,
        session_id: r.get("session_id")?,
        name: r.get("name")?,
        mode: r.get("mode")?,
        prompts: serde_json::from_str(&prompts).unwrap_or_default(),
        repeat: r.get("repeat")?,
        delay_sec: r.get("delay_sec")?,
        stop_phrase: r.get("stop_phrase")?,
        state: r.get("state")?,
        step: r.get("step")?,
        iteration: r.get("iteration")?,
        last_sent_at: r.get("last_sent_at")?,
        note: r.get("note")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        goal: r.get::<_, Option<String>>("goal")?.and_then(|s| serde_json::from_str(&s).ok()),
        progress: r.get("progress")?,
        log: r.get::<_, Option<String>>("log")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        pending: r.get("pending")?,
    })
}

fn json_opt<T: Serialize>(v: &Option<T>) -> Option<String> {
    v.as_ref().and_then(|x| serde_json::to_string(x).ok())
}

pub fn list(c: &Connection, session: Option<&str>) -> AppResult<Vec<Automation>> {
    let mut st = c.prepare("SELECT * FROM automations WHERE (?1 IS NULL OR session_id=?1) ORDER BY updated_at DESC")?;
    let rows = st.query_map(params![session], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(c: &Connection, id: &str) -> AppResult<Automation> {
    c.query_row("SELECT * FROM automations WHERE id=?1", [id], from_row)
        .optional()?
        .ok_or_else(|| AppError::not_found("loop not found"))
}

pub fn running_for(c: &Connection, session: &str) -> AppResult<Option<Automation>> {
    Ok(c.query_row("SELECT * FROM automations WHERE session_id=?1 AND state='running' ORDER BY updated_at DESC LIMIT 1", [session], from_row)
        .optional()?)
}

pub fn save(c: &Connection, a: &Automation) -> AppResult<()> {
    c.execute(
        "INSERT INTO automations(id,session_id,name,mode,prompts,repeat,delay_sec,stop_phrase,state,step,iteration,last_sent_at,note,created_at,updated_at,goal,progress,log,pending)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
         ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id, name=excluded.name, mode=excluded.mode,
           prompts=excluded.prompts, repeat=excluded.repeat, delay_sec=excluded.delay_sec, stop_phrase=excluded.stop_phrase,
           state=excluded.state, step=excluded.step, iteration=excluded.iteration, last_sent_at=excluded.last_sent_at,
           note=excluded.note, updated_at=excluded.updated_at, goal=excluded.goal, progress=excluded.progress,
           log=excluded.log, pending=excluded.pending",
        params![
            a.id, a.session_id, a.name, a.mode, serde_json::to_string(&a.prompts)?, a.repeat, a.delay_sec, a.stop_phrase,
            a.state, a.step, a.iteration, a.last_sent_at, a.note, a.created_at, now_iso(),
            json_opt(&a.goal), a.progress, serde_json::to_string(&a.log)?, a.pending
        ],
    )?;
    Ok(())
}

/// Progress written by the monitor. Only applies while the loop is still running in the
/// database, so a pause/stop from the UI can never be overwritten by a late tick.
pub fn save_progress(c: &Connection, a: &Automation) -> AppResult<bool> {
    let n = c.execute(
        "UPDATE automations SET state=?2, step=?3, iteration=?4, last_sent_at=?5, note=?6, updated_at=?7, progress=?8, log=?9, pending=?10
         WHERE id=?1 AND state='running'",
        params![a.id, a.state, a.step, a.iteration, a.last_sent_at, a.note, now_iso(), a.progress, serde_json::to_string(&a.log)?, a.pending],
    )?;
    Ok(n > 0)
}

pub fn delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM automations WHERE id=?1", [id])?;
    Ok(())
}

/// Only one loop per session runs at a time.
pub fn pause_others(c: &Connection, session: &str, keep: &str) -> AppResult<()> {
    c.execute(
        "UPDATE automations SET state='paused', note='Paused: another loop started', updated_at=?3 WHERE session_id=?1 AND id!=?2 AND state='running'",
        params![session, keep, now_iso()],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub sort: i64,
}

pub fn templates(c: &Connection) -> AppResult<Vec<Template>> {
    let mut st = c.prepare("SELECT id,name,text,sort FROM templates ORDER BY sort, name")?;
    let rows = st
        .query_map([], |r| Ok(Template { id: r.get(0)?, name: r.get(1)?, text: r.get(2)?, sort: r.get(3)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save_template(c: &Connection, t: &Template) -> AppResult<()> {
    if t.name.trim().is_empty() || t.text.trim().is_empty() {
        return Err(AppError::invalid("Template needs a name and text"));
    }
    c.execute(
        "INSERT INTO templates(id,name,text,sort,created_at) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, text=excluded.text, sort=excluded.sort",
        params![t.id, t.name.trim(), t.text.trim(), t.sort, now_iso()],
    )?;
    Ok(())
}

pub fn delete_template(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM templates WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auto(mode: &str, prompts: &[&str], repeat: i64) -> Automation {
        Automation {
            id: "a".into(),
            session_id: "s".into(),
            name: "n".into(),
            mode: mode.into(),
            prompts: prompts.iter().map(|s| s.to_string()).collect(),
            repeat,
            delay_sec: 5,
            stop_phrase: None,
            state: "running".into(),
            step: 0,
            iteration: 0,
            last_sent_at: None,
            note: None,
            created_at: "t".into(),
            updated_at: "t".into(),
            goal: None,
            progress: None,
            log: vec![],
            pending: None,
        }
    }

    fn ready(now: i64) -> Ctx<'static> {
        Ctx { now, running: true, status: "waiting-for-input", ready: true, provider_signals: true, turn_ended_at: None, last_message: None, supervising: false, started_at: 0 }
    }

    fn goal_auto() -> Automation {
        let mut a = auto("goal", &[], 3);
        a.goal = Some(GoalConfig { goal: "Ship the overdue feature".into(), criteria: Some("npm test passes".into()), ..Default::default() });
        a
    }

    #[test]
    fn goal_kicks_off_then_asks_the_supervisor_then_sends_its_prompt() {
        let mut a = goal_auto();
        assert!(a.validate().is_ok());
        assert!(auto("goal", &[], 3).validate().is_err(), "a goal needs a description");
        // 1. Kickoff: the goal itself.
        let Decision::Send { text, step, .. } = decide(&a, &ready(1_000)) else { panic!("kickoff") };
        assert!(text.contains("GOAL: Ship the overdue feature") && text.contains("SUCCESS CRITERIA: npm test passes"));
        assert_eq!(step, 1);
        a.step = 1;
        a.last_sent_at = Some(1_000);
        // 2. Agent still working.
        assert!(matches!(decide(&a, &ready(2_000)), Decision::Wait(_)));
        // 3. Turn ended: supervise (once).
        let done = Ctx { turn_ended_at: Some(5_000), ..ready(6_000) };
        assert_eq!(decide(&a, &done), Decision::Supervise);
        assert!(matches!(decide(&a, &Ctx { supervising: true, ..done.clone() }), Decision::Wait(Some(m)) if m.contains("Reviewing")));
        // 4. Supervisor wrote the next prompt: sent after the delay.
        a.log.push(GoalStep { at: 6_500, status: "continue".into(), progress: 40, ..Default::default() });
        a.pending = Some("Now add tests for listOverdue".into());
        assert!(matches!(decide(&a, &Ctx { turn_ended_at: Some(5_000), ..ready(7_000) }), Decision::Wait(Some(m)) if m.contains("Next step")));
        let d = decide(&a, &Ctx { turn_ended_at: Some(5_000), ..ready(11_000) });
        assert_eq!(d, Decision::Send { text: "Now add tests for listOverdue".into(), step: 2, iteration: 0 });
        // 5. A reviewed answer without a pending prompt is not reviewed again.
        a.pending = None;
        assert!(matches!(decide(&a, &Ctx { turn_ended_at: Some(5_000), ..ready(12_000) }), Decision::Wait(_)));
        // 6. Round limit.
        a.step = 3;
        a.last_sent_at = Some(20_000);
        assert!(matches!(decide(&a, &Ctx { turn_ended_at: Some(25_000), ..ready(26_000) }), Decision::Finish(_)));
        a.rewind();
        assert_eq!((a.step, a.last_sent_at, a.log.len(), a.pending.clone()), (0, None, 0, None));
    }

    #[test]
    fn a_turn_cut_off_by_a_restart_counts_as_finished() {
        let mut a = goal_auto();
        a.step = 1;
        a.last_sent_at = Some(1_000);
        // No turn end since the prompt, but the process restarted later: review, don't hang.
        assert_eq!(decide(&a, &Ctx { started_at: 50_000, ..ready(60_000) }), Decision::Supervise);
        assert!(matches!(decide(&a, &Ctx { started_at: 500, ..ready(60_000) }), Decision::Wait(_)), "started before the prompt");
        assert!(matches!(decide(&a, &Ctx { started_at: 50_000, ready: false, ..ready(60_000) }), Decision::Wait(_)));
    }

    #[test]
    fn goal_mode_round_trips_through_the_database() {
        let c = crate::db::open_in_memory().unwrap();
        let mut a = goal_auto();
        a.log.push(GoalStep { at: 1, status: "continue".into(), progress: 30, summary: "s".into(), prompt: Some("p".into()), question: None });
        a.pending = Some("next".into());
        a.progress = Some(30);
        save(&c, &a).unwrap();
        let b = get(&c, "a").unwrap();
        assert_eq!(b.goal, a.goal);
        assert_eq!(b.log, a.log);
        assert_eq!((b.progress, b.pending.clone()), (Some(30), Some("next".into())));
        a.pending = None;
        a.progress = Some(60);
        assert!(save_progress(&c, &a).unwrap());
        assert_eq!(get(&c, "a").unwrap().progress, Some(60));
    }

    /// Apply a Send decision like the monitor does.
    fn sent(a: &mut Automation, d: &Decision, now: i64) -> String {
        match d {
            Decision::Send { text, step, iteration } => {
                a.step = *step;
                a.iteration = *iteration;
                a.last_sent_at = Some(now);
                text.clone()
            }
            other => panic!("expected Send, got {other:?}"),
        }
    }

    #[test]
    fn queue_sends_each_prompt_after_the_previous_turn() {
        let mut a = auto("queue", &["one", " ", "two"], 1);
        assert_eq!(a.total(), Some(2));
        let d = decide(&a, &ready(1_000));
        assert_eq!(sent(&mut a, &d, 1_000), "one");
        // Agent still working.
        assert!(matches!(decide(&a, &Ctx { status: "working", ..ready(3_000) }), Decision::Wait(_)));
        // Finished at 10 s → delay 5 s.
        let c = Ctx { turn_ended_at: Some(10_000), ..ready(12_000) };
        assert_eq!(decide(&a, &c), Decision::Wait(Some("Next prompt in 3 s".into())));
        let d = decide(&a, &Ctx { turn_ended_at: Some(10_000), ..ready(15_000) });
        assert_eq!(sent(&mut a, &d, 15_000), "two");
        assert_eq!((a.step, a.iteration), (0, 1));
        let done = decide(&a, &Ctx { turn_ended_at: Some(20_000), ..ready(30_000) });
        assert_eq!(done, Decision::Finish("Done: 2 prompts sent".into()));
    }

    #[test]
    fn loop_repeats_and_stops_on_phrase() {
        let mut a = auto("loop", &["next item"], 0);
        a.stop_phrase = Some("alle punkte erledigt".into());
        assert_eq!(a.total(), None);
        let mut now = 0;
        for round in 0..3 {
            now += 60_000;
            let d = decide(&a, &Ctx { turn_ended_at: a.last_sent_at.map(|t| t + 1), ..ready(now) });
            assert_eq!(sent(&mut a, &d, now), "next item", "round {round}");
        }
        assert_eq!(a.iteration, 3);
        let c = Ctx { turn_ended_at: Some(now + 5), last_message: Some("Fertig. ALLE PUNKTE ERLEDIGT"), ..ready(now + 60_000) };
        assert!(matches!(decide(&a, &c), Decision::Finish(m) if m.contains("stop") || m.contains("Stopped")));
    }

    #[test]
    fn limited_repeat_finishes() {
        let mut a = auto("loop", &["a", "b"], 2);
        assert_eq!(a.total(), Some(4));
        let mut now = 0;
        for want in ["a", "b", "a", "b"] {
            now += 60_000;
            let d = decide(&a, &Ctx { turn_ended_at: a.last_sent_at.map(|t| t + 1), ..ready(now) });
            assert_eq!(sent(&mut a, &d, now), want);
        }
        assert!(matches!(decide(&a, &Ctx { turn_ended_at: Some(now + 1), ..ready(now + 60_000) }), Decision::Finish(_)));
    }

    #[test]
    fn waits_for_limits_readiness_and_paused_state() {
        let a = auto("queue", &["x"], 1);
        assert!(matches!(decide(&a, &Ctx { status: "rate-limited", ..ready(1) }), Decision::Wait(Some(m)) if m.contains("limit")));
        assert!(matches!(decide(&a, &Ctx { ready: false, ..ready(1) }), Decision::Wait(_)));
        assert!(matches!(decide(&a, &Ctx { running: false, ..ready(1) }), Decision::Wait(_)));
        let p = Automation { state: "paused".into(), ..a.clone() };
        assert_eq!(decide(&p, &ready(1)), Decision::Wait(None));
    }

    #[test]
    fn without_provider_signals_settled_output_counts_as_done() {
        let mut a = auto("queue", &["x", "y"], 1);
        a.last_sent_at = Some(0);
        a.step = 1;
        let c = Ctx { provider_signals: false, ..ready(4_000) };
        assert!(matches!(decide(&a, &c), Decision::Wait(_)), "too soon after sending");
        let c = Ctx { provider_signals: false, ..ready(10_000) };
        assert!(matches!(decide(&a, &c), Decision::Wait(Some(m)) if m.starts_with("Next prompt")), "8 s settle + 5 s delay");
        let c = Ctx { provider_signals: false, ..ready(13_500) };
        assert!(matches!(decide(&a, &c), Decision::Send { .. }));
    }

    #[test]
    fn storage_roundtrip_and_templates() {
        let c = crate::db::open_in_memory().unwrap();
        let mut a = auto("loop", &["p"], 3);
        a.validate().unwrap();
        save(&c, &a).unwrap();
        a.step = 1;
        save(&c, &a).unwrap();
        assert_eq!(get(&c, "a").unwrap().step, 1);
        assert_eq!(running_for(&c, "s").unwrap().unwrap().id, "a");
        let b = Automation { id: "b".into(), ..a.clone() };
        save(&c, &b).unwrap();
        pause_others(&c, "s", "b").unwrap();
        assert_eq!(get(&c, "a").unwrap().state, "paused");
        assert!(templates(&c).unwrap().len() >= 5, "default templates are seeded");
        let mut late = get(&c, "a").unwrap();
        late.state = "running".into();
        late.step = 7;
        assert!(!save_progress(&c, &late).unwrap(), "paused in the DB: late tick is ignored");
        assert_eq!(get(&c, "a").unwrap().state, "paused");
        save_template(&c, &Template { id: "t".into(), name: "Mine".into(), text: "Do it".into(), sort: 9 }).unwrap();
        assert!(templates(&c).unwrap().iter().any(|t| t.name == "Mine"));
        assert!(auto("loop", &[" "], 1).validate().is_err());
    }
}
