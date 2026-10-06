# Worked examples

Concrete input → settings → output cases. Each is an automated test in
`test/examples.test.ts`. Times are M ticks (96 per quarter note). Notation:
`onset note velocity → note-off`. Unless stated, every Variable is on Position 1 of a new
document: Time Base 1|4, Rhythm level 1 (×1), Legato level 2 (50 %), Accent level 4,
Velocity Range 64–110, Original Order, Note Density 100 %, no transposition, voice 1 only.

| # | Input | Settings | Output | Basis |
|---|-------|----------|--------|-------|
| E1 | C3 E3 G3 B3 | defaults | 0 C3 v110→48 · 96 E3→144 · 192 G3→240 · 288 B3→336 · 384 C3 … | [DOC] one step per Time Base pulse; legato = 50 % of the time to the next note; accent 4 = top of range |
| E2 | C3 E3 G3 B3 | Time Base 1\|8; Rhythm cycle `1,0` | 0 C3→24 · 48 E3→60 · 72 G3→96 · 120 B3→132 · 144 C3 … | [DOC] level 1 = ×1, level 0 = ×½ of 48 ticks; the Rhythm cycle steps once per note |
| E3 | C3 E3 G3 B3 | Accent cycle `4,0,2,1`; Vel Range 40–100 | 0 C3 v100 · (rest at 96) · 192 G3 v60 · 288 B3 v40 · 384 C3 v100 | [DOC] level 0 is silent and still consumes the step; [INF] levels 1..4 spread low→high |
| E4 | C3 E3 | Legato cycle `4,1` (100 %, 25 %); Transposition +7 | 0 G3→96 · 96 B3→120 · 192 G3 … | [DOC] |
| E5 | voice 1: C3 D3; voice 2: C4 D4, Phase 48 | both voices | 0 C3 · 48 C4 · 96 D3 · 144 D4 | [DOC] 48 ticks = an eighth note (manual's phase example) |
| E6 | C3 D3 E3 F3 | Note Order 0/100/0 (all Cyclic Random) | one fixed reordering, e.g. C3 E3 D3 F3, repeated every four notes | [DOC] cyclic random repeats; the particular order depends on the stored scramble |

More behaviour-level checks (density statistics, ranges, swing maps, quantized snapshots,
slideshows, Input Control keys, recording modes) are in `test/engine.test.ts`,
`test/modules.test.ts` and `test/session.test.ts`.
