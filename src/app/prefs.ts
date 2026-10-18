/**
 * Application preferences and editor assistance — state that belongs to this browser and
 * this user, not to a musical document:
 *
 *   app preferences:  tooltips on/off, Performance Feedback on/off, MIDI Learn mappings
 *                     (they describe the user's hardware), full-screen on start
 *   editor assistance: Follow Playing Pattern (the Pattern Editor shows the playing Group);
 *                     the scale is part of each Pattern, see Pattern.scale
 *   monitor output:   the internal monitor's output chain (Slop Factory Core engines), like
 *                     the MIDI mappings a property of this setup, not of a document
 *
 * (Colour palettes keep their own store, see ui/palette.ts.) Everything is versioned and
 * validated on load, and every storage access is guarded: private windows simply start
 * from the defaults.
 */
import { repairChain, type ChainConfig } from '@slopfactory/core/engines';
import { cleanLearnMappings, type LearnMapping } from '../extended/extended';
import { MONITOR_ENGINES } from '../audio/output';

export interface AppPrefs {
  version: 1;
  tips: boolean;
  feedback: boolean;
  learn: LearnMapping[];
}

export interface EditorPrefs {
  version: 1;
  /** the Pattern Editor switches to the playing Pattern Group as it changes (default off) */
  followPlaying: boolean;
}

export interface PrefStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY_APP = 'emmm.prefs';
const KEY_EDITOR = 'emmm.editor';
const KEY_OUTPUT = 'emmm.monitorOutput';

function defaultStore(): PrefStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(store: PrefStore | null, key: string): Record<string, unknown> {
  try {
    const raw = store?.getItem(key);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function write(store: PrefStore | null, key: string, v: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: keep working for this session */
  }
}

export class Prefs {
  app: AppPrefs;
  editor: EditorPrefs;
  /** the monitor's output chain (validated; stages of engines emmm lacks are kept) */
  monitorOutput: ChainConfig;
  constructor(private store: PrefStore | null = defaultStore()) {
    const a = read(store, KEY_APP);
    this.app = {
      version: 1,
      tips: a.tips !== false,
      feedback: a.feedback === true,
      learn: cleanLearnMappings(a.learn),
    };
    this.editor = { version: 1, followPlaying: read(store, KEY_EDITOR).followPlaying === true };
    this.monitorOutput = repairChain(read(store, KEY_OUTPUT), MONITOR_ENGINES);
  }

  saveMonitorOutput(): void {
    write(this.store, KEY_OUTPUT, this.monitorOutput);
  }

  saveApp(): void {
    write(this.store, KEY_APP, this.app);
  }

  saveEditor(): void {
    write(this.store, KEY_EDITOR, this.editor);
  }
}
