/**
 * The monitor's output chain: Slop Factory Core output engines (The Good Bits' Output Stage,
 * Drive and Crunch, and Tone) on emmm's internal monitor sound.
 *
 * emmm is a MIDI instrument: its music goes to MIDI devices, and no audio engine can touch
 * that. The monitor (audio/monitor.ts) is the only audio emmm makes, so it is the only thing
 * the chain processes. Core has no MIDI engines yet, so MIDI output passes through no chain.
 */
import { coreEngines } from '@slopfactory/core/engines';
import chainWorkletUrl from '@slopfactory/core/chain-worklet.js?url';

/** Every built-in audio engine (the monitor is audio). */
export const MONITOR_ENGINES = coreEngines();

export const CHAIN_WORKLET_URL: string = chainWorkletUrl;
