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
extended.returnSettings duration n|d, immediate, rest (beats the Variables stay Home after it)
```

Runtime only (never saved, never in Undo): Robot positions, visit history, dwell, pendulum
direction, suspensions, rule counters and last-fired times, Return progress and rest,
rule-made overrides (on / off, personality), timed Rule actions waiting, the activity log.
Start rebuilds it (keeping overrides and waiting actions made while stopped); Stop clears it.

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
Variable a Trajectory drives). A Variable being **Returned** (or resting at Home after a
Return) belongs to the Return — see §4, *Ownership*.

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
  value — Density 10 % → 40 % → 70 % → 100 %, not by Position number. A Position with weight 0
  is never an in-between stop; Home itself always is.
* Categorical Variables (Pattern Group, Time Distortion, Orchestration, Sound Choice) move to
  Home in one step at their turn.
* Variables are taken round-robin so they progress together; steps are spread over the
  duration on the quantization grid; the last lands at the end. If anything is still away at
  the end, it is put Home then — a Return always finishes.

**Immediate Return** applies Home at once (as a Snapshot of the included Positions) at the next
quantization point. Stopped, any Return is immediate (there is no musical time to spread over).
Pressing RETURN HOME (or ⇧⌥H) during a Return stops it where it is.

### Ownership: RETURN > TRAJECTORY > ROBOT

`Conductor.owns(v, t)` decides who may write a Variable's Position:

1. From the moment a Return begins until it completes, every included Variable **belongs to
   the Return** — also those already at Home (they wait for the others).
2. After the Return completes, its Variables stay at Home, still owned, for the **rest**
   period (*rest* beats, default 4, 0–32; not while stopped).
3. While a Variable is owned, nothing else writes its Position: Robots (a Robot whose
   Variables are all owned makes no decision at all; one with some free Variables moves only
   those), M's Baton robot (held still if all its arrowed Variables are owned, else kept off
   the owned ones), Position Trajectories, Baton Trajectories (the Baton moves; owned Variables
   do not follow it), and Rule "set Position" actions (logged as not set). Other Variables go
   on normally.
4. A Trajectory's phase keeps running while it is held off; it writes again at its **next
   step** after the rest — never in the middle of a step, never early. Note-level Trajectory
   targets (Density %, Transposition +, Velocity +, Legato ×) modulate notes, not Positions,
   and are not suspended.
5. When the rest ends, each Robot that moves those Variables starts from **Home** (its own
   Home Position, else Home of its first Variable): its next move is one personality step from
   Home, not a jump back to where it was. The Baton is put at the Home Baton when the Return
   completes and stays there through the rest.
6. A hand (a click, a Snapshot you recall, MIDI Learn) is not blocked: you can always move a
   Variable yourself; the Return takes the new place into account.

All of this happens inside the engine's render at exact ticks, so it is deterministic and
independent of render granularity (tests run the same scene in 1-tick and 37-tick chunks).

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
personality are runtime overrides (an asterisk in the Robot overview), cleared by Stop.

### Manual changes (Conductor.poke)

Rules see a hand **at once** — playing, paused or stopped. Clicking a Position, recalling a
Snapshot, A/B, Mutate, conducting, MIDI Learn and editing the definitions all call
`Conductor.poke()` (from `Session.changed`, never from inside the engine's render), which
scans for changes and runs the queue at the transport's current tick:

* **Immediate** actions (*now*) happen at once — while stopped too (a Position changes, a
  Snapshot is recalled, Home is applied). Nothing starts the transport and no action makes a
  note.
* **Timed** actions (*Q*, *beat*, *bar*) wait for that point in the music: playing, at the
  next point; paused, after Continue; **stopped, at Start** (the downbeat, tick 0, which is on
  every grid).
* Overrides made while stopped (a Robot switched on by a Rule) last into the next Start;
  Stop clears them. "Advance" while stopped decides from the Variables' current Positions.
  "Suspend" while stopped is ignored (logged): there is no musical time to suspend for.
* Each gesture is a new *moment*: every rule may fire once per gesture. Voice cycles,
  intervals and Robot moves happen only while playing.

### Safety

* Musical events are evaluated inside the engine's render at exact ticks (`MEngine.observer`
  after every Voice event, action and Baton-robot move), so results do not depend on the
  scheduler's render granularity — tests check identical output for different chunkings.
* An explicit FIFO event queue per pass, bounded at 64 events; overflow is dropped and logged.
* Each rule fires at most **once per moment** (tick, or gesture); events caused by rule actions
  carry a depth and are not matched beyond depth 3. So any chain of rules ends, and A→B→A
  loops cannot spin.
* Deterministic order: events in the order they arose (Robots 1→4, Variables in M's order,
  Voices 1→4); rules in list order.
* Deferred (Q / Beat / Bar) actions are engine actions: frozen by Pause, discarded by Stop;
  at most 32 waiting (including those waiting for Start).
* Actions never create notes (no hung notes possible); a Snapshot with Sync does what a
  Snapshot always did.
* Missing targets are harmless: an empty Snapshot slot, no Home, a Robot that is off: the
  action does nothing and the log says so. Invalid stored references are cleaned on load.
* The editor offers only what the engine can execute, validates every change through
  `cleanRule`, and warns about rules that cannot happen yet (a Robot that is off, no Home, an
  empty Snapshot, Q without quantization) or that feed themselves (they still stop).

## 6. Interface: the Robots window

**Options ▸ Robots, Rules & Home…** (⌥W), **Windows ▸ Robots**, or **Robots…** in the
Extended window. One floating window (476 × 340) in emmm's controls and the Extended palette
area. Every control calls a Session method; the window keeps no musical state.

* **Overview** (always visible): four rows — number (inverted = on; click to switch),
  personality (`*` = changed by a Rule), the six Positions (current inverted, Home underlined,
  dotted with `·` = not allowed by the weights), rate (`n|d`, `sa`, or `1|n` for M's robot),
  Variables, and state in words: `off`, `ready`, `next 3:1`, `▸ Dens Vel` (just moved, in the
  activity colour and bold), `waits R2`, `PAUSED`, `RETURN`, `resting`, `on Rules`. Click a
  row to edit that Robot. The header shows the clock source (internal / external and its state).
* **Activity log**: the last six real runtime events (Robot moves with the Variables they
  changed, "followed / moved away from Robot n", rules firing or waiting, Return started /
  steps / Variable reached Home / complete / rest over, Robots switched or paused), each with
  its bar:beat (■ while stopped), shown when it sounds. Bounded at 40 entries; redrawn only when
  what is shown changes; **Clear** empties it. Nothing musical depends on it.
* **ROBOT**: on / off, personality (Baton (M) offered to Robot 1 only — disabled, with the
  reason, for the others), rate (Time Base boxes; type `2/1`; `sa`), ten Variable toggles,
  only the selected personality's parameters (number boxes with ranges in their tips; mode
  pop-up; Orbit direction), a **watches** pop-up for Follower / Contrarian in which itself and
  any Robot that would watch back are disabled and labelled, **Defaults** (this
  personality's parameters only), Home Position (– or 1–6), where it is, its priority, and the
  description of the algorithm from §3 with whether weights shape it and which Positions are
  allowed now. For Baton (M): M's rate and jump ranges (the same settings as the Conducting
  window).
* **WEIGHTS**: a Variable strip (each with a miniature of its weights), six bars (drag up /
  down, or ↑ ↓ with the bar focused; 0 = hatched "excluded"), the number box under each, each
  Position's chance in %, ▸now and ⌂ marks, a "each pick" strip proportional to the chances,
  and **Equalise / Random / Favour now / Favour ⌂ / Reset** (Favour ⌂ disabled without a
  Home). Excluding the last allowed Position is refused with a message.
* **RULES**: the list (on / off, the rule in words, last fired bar:beat and count, ● just
  fired); **+ New Rule**, **Duplicate**, **↑ ↓**, **Delete**, count / 16 (New disabled at 16);
  the editor `WHEN [condition] [its targets] every [Nth]`, `THEN [action] [its targets]`,
  `AT now | Q | beat | bar` with the timing in words, and the rule as one sentence with its
  warnings.
* **HOME**: Capture Home, Clear, **RETURN HOME** (inverted "RETURNING… (stop)" while it runs),
  status ("3 steps from Home", "Returning: 2 of 5 steps · ends 4:1", "At Home, resting: 3
  beat(s) left"), duration, Immediate, rest (beats), the triggers (button, ⇧⌥H, Rules), a
  progress bar (steps made; a line for time passed), and every Variable with its include box,
  Home, now and state (`▸ returning: → 3 → 1` along its value path, `✓ home`, `✓ home (others
  returning)`, `… resting at Home`, `away: → …`, `– excluded`).

**Keyboard.** A mouse click does not take the keyboard focus, so Space and Return stay the
transport keys and Tab stays M's Pause while you play with the mouse. **⌥W** on the open,
front window moves the focus into it (its tab); **← →** move between its controls (also off a
closed pop-up), **↑ ↓** between toggles, **Enter / Space** act, **Escape** gives the keys back.
Number boxes work as everywhere in emmm (click, type, Enter; ↑ ↓ step). **⇧⌥H** is Return
Home from anywhere.

**Screen size.** emmm draws a fixed 720 × 470 screen scaled to the browser window, so the
Robots window keeps its proportions at any window size; it is a floating window that covers
part of the Variables window by default (drag it, or close it with its box and reopen with ⌥W).

## 7. Persistence

Document format **v5**. v4 → v5: Robots, weights, rules, Home and Return arrive from the
defaults (Robot 1 = M's robot with its existing settings; its Position-robot rate is taken from
M's robot rate; Robots 2–4 off; equal weights; no rules; no Home). Everything is validated on
load: unknown personalities → Drunk (Baton only for Robot 1), Follower cycles broken, weights
clamped 0–100 with at least one non-zero per Variable, rules with unknown kinds dropped,
references clamped to existing Voices / Robots / Positions / Snapshots, rest clamped 0–32.
Saved: definitions, weights, rules, Home, Return settings. Not saved: everything runtime.
Robot randomness comes from the document seed (streams 6000 + n), re-seeded at Start and by
Reroll. Editing any of it is one Undo step; Robot moves, rule firings and Returns never enter
the history.

## 8. Testing

* `test/conductors.test.ts` — scheduling, priority, migration and Classic equality, transport,
  external clock, determinism and chunking, weights and their distribution, every
  personality, Follower / Contrarian and cycles, every condition and action, rule safety,
  quantization, hung notes, Home / Return paths, ownership with simultaneous Robot,
  Trajectory and Return, manual changes in Play / Pause / Stop, persistence and Undo.
* `test/robots-ui.test.ts` — the window in a simulated browser (happy-dom), driven by pointer
  and key events.
* `scripts/browser-test.mjs` (`npm run test:browser`) — headless Chrome / Chromium over the
  DevTools protocol (no dependencies) with a **fake Web MIDI** output and input, real mouse and
  key events on the real interface: the 24 workflow scenarios (open, enable, personality,
  Variables, rate, Start, movement, weights and their effect, a Rule made in the editor and
  fired by a click while stopped, Home, Return with a Trajectory held off, rest, save, reload,
  open, Classic, Pause / Continue / Stop, external clock Start / Stop / Continue, no stuck notes
  or stray transport messages) plus keyboard, focus, dialogs, disabled controls, invalid values,
  Undo / Redo, a 900 × 600 window and console errors. Screenshots are written to a temporary
  folder (or `SHOTS=dir`). This is not a test of real MIDI hardware.

## 9. Trade-offs and limits

* One Position per Robot (not per Variable) keeps "Robot at Position 5" meaningful; a Robot
  over Variables with disjoint weights falls back per Variable.
* Note-level Trajectory modulation (Density %, Transposition +, Velocity +, Legato ×) is not
  suspended by a Return: it changes notes, not Positions (§4).
* A Return owns its Variables against Robots, Trajectories and Rules, not against your hand,
  a Snapshot you recall, a Slideshow or MIDI Learn.
* Voice cycles from Step Advance (Time Base `sa` Voices played by keys) are not seen by Rules.
* A one-step Rhythm / Legato / Accent cycle never "completes" (as M's blinking shows it).
* M's Baton robot keeps its Classic quirk: switched on mid-play with Extended **off**, it
  catches up its missed jumps at once (unchanged on purpose; under Extended it joins its grid).
* Tab is M's Pause key, so it does not move between the window's controls; use ⌥W and ← →.
