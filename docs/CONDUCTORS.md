# Robot Conductors, Weights, Rules and Home (Extended)

Design notes for emmm's generative-conducting extension. Everything here is **Extended**
(Options ▸ Extended…, off by default) and is not part of Classic M. Classic note generation,
M's own Robot Conductor, Snapshots, Slideshows, Trajectories, MIDI routing, clock and
transport behave exactly as before; tests prove it.

## 1. What already existed (audit)

| Mechanism | Where | Reused for |
|---|---|---|
| M's Robot Conductor ("Automatic Conducting"): every `rate` note value the Baton jumps randomly within `hRange × vRange`; enabled arrows turn the Baton into Positions | `MEngine.robotStep`, `Composition.conducting.robot` | Robot 1's default personality **Baton (M)**, unchanged |
| Exact-tick engine actions (`MEngine.schedule`, label, sorted by tick then sequence), frozen by Pause, cleared by Stop | `engine.ts` | all Robot decisions, Rule actions, Return steps |
| Chains of actions with a generation counter (Trajectories, Slideshows) | `session.ts` | the Conductor "hub" chain |
| `MEngine.selectPosition` / `applySnapshot` | `engine.ts` | every Position change; Immediate Return; Recall Snapshot |
| Snapshot quantization (`Composition.quantization`, `quantizeTick`) | `engine.ts` | Rule action timing "Q", Return step grid |
| Seeded sfc32 streams per purpose (`Rng(seed, stream)`) | `rng.ts` | one stream per Robot (6000 + n) |
| MIDI clock follower → tempo; external FA/FB/FC → start / continue / halt | `clockIn.ts`, `Session.clockRealtime` | nothing new needed: actions live in ticks |
| Versioned document + `migrate` + `fill` from defaults | `format.ts` | format v5 |
| Undo = whole-document snapshots minus performance state | `history.ts`, `Session.docState` | definitions are undoable, runtime is not |

The design rule kept from Trajectories: **the engine never reads Extended settings**. Two
generic, inert-by-default engine hooks were added (`robotGate`, `observer`); with both `null`
(always, in Classic) the engine's code path is byte-for-byte the old one.

## 2. Model

```
extended.robots[4]      RobotDef: enabled, personality, variables[], rateNum|rateDen,
                        home (Position or none), params, target (Follower/Contrarian)
extended.weights        per Variable: six weights 0–100 (default 10 each)
extended.rules[≤16]     Rule: on, when (Condition), every N, then (Action), at (timing)
extended.home           captured Positions (all eleven Variables) + Baton; which are included
extended.returnSettings duration n|d, immediate, rest (Robot decisions skipped after Return)
```

Runtime only (never saved, reset by Start / Stop): Robot positions, visit history, dwell,
pendulum direction, suspensions, rule counters, Return progress, rule-made overrides
(enable / personality), the activity log.

### A Robot's Position

A Robot holds **one Position (1–6)** and applies it to all of its Variables — as one Baton cell
does for every arrow in M's grid. So "Robot 2 is at Position 5", "Robot 1 reached Position 6",
"returned Home", Follower and Contrarian all have a plain meaning. The Variables assignable to
a Robot are the ten six-Position Variables (Sound Choice, with 16 Positions, is not).

**Per-Variable weights with one Robot Position.** Candidates are the Positions eligible
(weight > 0) for *every* assigned Variable; a candidate's weight is the geometric mean of the
Variables' normalised weights (one Variable → exactly its weights). If no Position is eligible
for all of them, the Robot chooses from the union (arithmetic mean). Each Variable then takes
the chosen Position if it is eligible for it, otherwise its nearest eligible Position (ties →
the lower one). A Robot with no Variables still moves (useful as a pure Rule driver).

### Robot 1 and M's Robot Conductor (migration)

Robot 1 *is* M's Robot Conductor: its on/off is the Conducting window's robot button
(`conducting.robot.enabled`), and its default personality **Baton (M)** is M's algorithm in
the engine, using M's `hRange`, `vRange` and `rate`, its Variables being those whose arrows are
on. An old document therefore plays identically; Robots 2–4 default to off. Choosing another
personality for Robot 1 (Extended on) parks the Baton robot (its timer keeps time, it does not
move) and Robot 1 becomes a Position robot. With Extended off, Robot 1 is always M's robot.

### Timing

Every decision is an engine action at an exact tick on the Robot's own grid, counted from
Start: one step every *n / d* of a whole note (M's Time Base: 2|1 = two bars, 1|4 = a beat).
The first decision is one step after Start (the piece starts as you set it). A Robot switched
on while playing joins at its next grid point. Rate **sa** (step advance) = moves only when a
Rule advances it. All Robots and interval Rules share one chain (label `cond`): at a tick, the
due Robots decide in priority order, then interval Rules fire. Pause freezes it, Continue
resumes, Stop clears it, Start rebuilds it from tick 0; tempo changes and external MIDI clock
only change how fast ticks pass, never where decisions fall. Nothing uses a wall-clock timer.

### Conflicts

Overlapping assignments are allowed. **Priority = Robot number (1 highest).** When several
Robots decide at the same tick, they are processed 1 → 4 and the first to claim a Variable at
that tick keeps it; a lower-priority Robot still moves (its own Position changes, its events
fire) but leaves claimed Variables alone. M's Baton robot runs after actions at a tick, so as
Robot 1 it also wins. Changes at *different* ticks: the latest wins (as with a hand on a
Variable a Trajectory drives). A Variable being **Returned** is claimed by the Return.

## 3. Personalities

`c` = current Position, `E` = eligible candidates with weights `w`. All draws come from the
Robot's own stream; every algorithm terminates in O(6) with no loops over draws.

| Personality | Algorithm | Parameters | Weights |
|---|---|---|---|
| **Baton (M)** | M's Automatic Conducting (Robot 1 only) | jump ↔ ↕, rate (Conducting window) | — |
| **Drunk** | with *stay %* stays; else picks among `E` within *step* of `c` with weight `w · 2^-(d-1)`; none in reach → nearest | step 1–5, stay 0–90 % | yes |
| **Tourist** | picks among `E` not visited in the last *memory* decisions (weighted); all recent → the least recently visited | memory 1–12 | yes |
| **Homebody** | at Home: leaves with *wander %* to within *range*; away: goes Home with *pull %*, else drifts ±1 | pull, wander, range | yes |
| **Restless** | moves with probability (dwell+1)/*patience* (certain after *patience* stays), to a weighted other Position | patience 1–16 | yes |
| **Orbit** | next eligible Position in order, *step* at a time, wrapping; up or down | step 1–5, direction | eligibility only |
| **Pendulum** | back and forth through eligible Positions, ends not repeated | step 1–3 | eligibility only |
| **Chaotic** | jumps of at least *min jump*, weighted `w · distance`; none far enough → the farthest | min jump 1–5 | yes |
| **Curious** | with *explore %* the least-visited Positions; otherwise familiar ones, weighted `w · (1 + visits)` | explore 0–100 % | yes |
| **Follower** | copy: goes to the target's Position; echo: repeats the target's last move (size and direction); with *fidelity %* | target, mode, fidelity | eligibility only |
| **Contrarian** | mirror: Position 7 − target's; avoid: at least *distance* away from the target, weighted `w · distance` | target, mode, distance | avoid: yes |

Edge cases: no eligible Position → stays; one → goes there and stays. Follower / Contrarian
whose target is off, has never moved, or is itself → holds its Position (shown as "waiting").
Following works in Position numbers, so overlapping Variables are not required. **Cycles**
(1 follows 2 follows 1) are refused in the editor and broken on load (the later Robot loses its
target); even so, a Follower only *reads* its target's last state, so nothing can recurse.

## 4. Home and Return

**Capture Home** stores the active Position of all eleven Variables and the Baton. **Included**
Variables (default: all except Pattern Group and Sound Choice, whose changes restart the
Voices / send program changes) are what Return moves and what "distance from Home" counts.
Capture again to replace; Clear removes it.

**Distance** = the number of Return steps still needed (sum over included Variables).

**Gradual Return** (duration *n|d*, default 2|1 = two bars) begins at the next Snapshot
quantization point (a beat if none). It is a chain of exact-tick actions (label `return`) that
recomputes from the live state each time, so a hand or Rule moving a Variable meanwhile is
simply taken into account. Each step moves Variables one Position along a *musical path*:

* Variables whose Positions have a meaningful size (Density, Velocity, Note Order — how
  ordered —, Transposition, Rhythm, Legato, Accent: the mean over Voices) pass through the
  eligible Positions whose value lies **between** the current and Home values, in order of
  value — Density 10 % → 40 % → 70 % → 100 %, not by Position number.
* Categorical Variables (Pattern Group, Time Distortion, Orchestration, Sound Choice) move to
  Home in one step at their turn.
* Variables are taken round-robin so they progress together; steps are spread over the
  duration on the quantization grid; the last lands at the end. If anything is still away at
  the end, it is put Home then — a Return always finishes.

**Immediate Return** applies Home at once (as a Snapshot of the included Positions) at the next
quantization point. Stopped, any Return is immediate (there is no musical time to spread over).

**Robots during Return**: Variables being Returned are claimed by the Return; a Robot all of
whose Variables are Returning rests. **Afterwards** each such Robot is placed at its Home
(its own Home Position, else Home of its first Variable) and rests for *rest* of its own
decisions (default 1) before moving again — it wanders away *from* Home instead of jumping
back. M's Baton robot is held off the Returned Variables and the Baton is put at the Home
Baton when Return completes.

Events: `returnDone` when a gradual or immediate Return completes; `homeReached` whenever the
distance becomes 0 (by any means); `robotHome` when a Robot moves onto its Home.

## 5. Rules

`WHEN condition [every Nth] THEN action [at Now | Q | Beat | Bar]`, at most 16 rules.

Conditions: Voice cycle completed (Pattern / Rhythm / Legato / Accent, a Voice or any);
Robot moved (one or any); Robot entered Position k; Robot returned Home; Variable entered
Position k (from any cause: hand, Snapshot, Robot, Rule, Trajectory…); every *n|d* from Start;
Home reached; Return completed. *Every Nth* counts matches (reset at Start).

Actions: advance a Robot (one personality decision now); choose a new Position (a weighted
different eligible Position); Robot on / off / toggle; set personality (or next); set a
Variable Position; recall a Snapshot; Return Home (gradual or immediate); suspend a Robot for
*n|d*.

**Performing, not editing.** Rule actions never change the saved document: on / off and
personality are runtime overrides (shown in the Robot overview, cleared by Stop / Start).

**Safety.**
* Rules are evaluated only inside the engine's render, at exact ticks (`MEngine.observer`
  after every Voice event, action and Baton-robot move), so results do not depend on the
  scheduler's render granularity — tests check identical output for different chunkings.
* An explicit FIFO event queue per pass, bounded at 64 events; overflow is dropped and logged.
* Each rule fires at most **once per tick**; events caused by rule actions carry a depth and are
  not matched beyond depth 3. So any chain of rules ends, and A→B→A loops cannot spin.
* Deterministic order: events in the order they arose (Robots 1→4, Variables in M's order,
  Voices 1→4); rules in list order.
* Deferred (Q / Beat / Bar) actions are engine actions: frozen by Pause, discarded by Stop;
  at most 32 waiting.
* Actions never create notes (no hung notes possible); a Snapshot with Sync does what a
  Snapshot always did.
* Missing targets are harmless: an empty Snapshot slot, a Variable with no Home, a Robot that
  is off: the action does nothing and the log says so. Invalid stored references are cleaned on
  load.
* Rules run only while the music plays.

## 6. Interface

One window, **Robots** (Options ▸ Robots, Rules & Home…, ⌥G), in emmm's control vocabulary:

* An always-visible overview: four rows (on/off, personality, the six Positions with the
  current one inverted and Home marked, rate, Variables, state: moved / waiting / suspended /
  resting / RETURN), and a short activity log (which Robot moved, which Variables, which rule
  fired, Return progress), plus the clock source (internal / external).
* Tabs **ROBOT** (the selected Robot's editor), **WEIGHTS** (all ten Variables as rows of six
  bars: drag to set; Equalise, Random, Favour current, Favour Home, Reset per row), **RULES**
  (list with on / summary / fire mark; editor below; New, Duplicate, ↑ ↓, Delete) and
  **HOME** (Capture / Clear, included Variables, distance, Return Home, duration, Immediate,
  rest).

## 7. Persistence

Document format **v5**. v4 → v5: Robots, weights, rules, Home and Return arrive from the
defaults (Robot 1 = M's robot with its existing settings; its Position-robot rate is taken from
M's robot rate; Robots 2–4 off; equal weights; no rules; no Home). Everything is validated on
load: unknown personalities → Drunk (Baton only for Robot 1), Follower cycles broken, weights
clamped 0–100 with at least one non-zero per Variable, rules with unknown kinds dropped,
references clamped to existing Voices / Robots / Positions / Snapshots.
Saved: definitions, weights, rules, Home, Return settings. Not saved: everything runtime.
Robot randomness comes from the document seed (streams 6000 + n), re-seeded at Start and by
Reroll.

## 8. Trade-offs and limits

* One Position per Robot (not per Variable) keeps "Robot at Position 5" meaningful; a Robot
  over Variables with disjoint weights falls back per Variable.
* Trajectories driving the same Position are not suspended by Return (a Position Trajectory
  will fight it — switch it off, or use a Rule).
* Rules do not run while stopped, and do not respond to clicks until the next musical event.
* M's Baton robot keeps its Classic quirk: switched on mid-play, it catches up its missed jumps
  at once (unchanged on purpose; Extended's own Robots join on their grid).
