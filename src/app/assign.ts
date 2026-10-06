/**
 * Copy `src` into `dst` in place, keeping the identity of every object and array that
 * exists in both. Views and the engine hold references into the composition (a window
 * bound to `comp.extended`, the engine reading `comp.patternGroups` live); updating in
 * place keeps all of them valid, so Undo and A/B recall can happen during playback.
 */
export function assignDeep(dst: unknown, src: unknown): unknown {
  if (Array.isArray(src)) {
    if (!Array.isArray(dst)) return structuredClone(src);
    for (let i = 0; i < src.length; i++) dst[i] = i < dst.length ? assignDeep(dst[i], src[i]) : structuredClone(src[i]);
    dst.length = src.length;
    return dst;
  }
  if (src && typeof src === 'object') {
    if (!dst || typeof dst !== 'object' || Array.isArray(dst)) return structuredClone(src);
    const d = dst as Record<string, unknown>;
    const s = src as Record<string, unknown>;
    for (const k of Object.keys(d)) if (!(k in s)) delete d[k];
    for (const k of Object.keys(s)) d[k] = assignDeep(d[k], s[k]);
    return d;
  }
  return src;
}
