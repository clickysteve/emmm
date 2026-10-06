/**
 * emmm's own alert / confirm / text-entry dialogs (instead of the browser's native ones),
 * drawn as Macintosh-style modal boxes in the screen. Return key = default button,
 * Escape = Cancel.
 */
import { el } from './dom';

let current: { box: HTMLDivElement; cancel: () => void } | null = null;

/** Close any open dialog as if Cancel (or OK, for an alert) had been pressed. */
export function closeDialog(): boolean {
  if (!current) return false;
  current.cancel();
  return true;
}

export function dialogOpen(): boolean {
  return !!current;
}

function open<T>(screen: HTMLElement, html: string, buttons: { label: string; value: T; isDefault?: boolean }[], cancelValue: T, input?: { value: string }): Promise<T | string> {
  closeDialog();
  return new Promise((resolve) => {
    const W = 300;
    const box = el('div', 'mdialog', screen, [(screen.offsetWidth || 720) / 2 - W / 2, 130, W]);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const msg = el('div', '', box);
    msg.style.marginBottom = '10px';
    msg.innerHTML = html;
    let field: HTMLInputElement | null = null;
    if (input) {
      field = el('input', 'mtext', box);
      field.value = input.value;
      field.style.width = '100%';
      field.style.marginBottom = '10px';
      field.setAttribute('aria-label', msg.textContent ?? 'text');
    }
    const row = el('div', '', box);
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    const finish = (v: T | string) => {
      box.remove();
      if (current?.box === box) current = null;
      resolve(v);
    };
    let def: HTMLButtonElement | null = null;
    for (const b of buttons) {
      const btn = el('button', 'mbutton' + (b.isDefault ? ' default' : ''), row, undefined, b.label);
      btn.addEventListener('click', () => finish(field && b.value !== cancelValue ? field.value : b.value));
      if (b.isDefault) def = btn;
    }
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(cancelValue);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        def?.click();
      }
    });
    current = { box, cancel: () => finish(cancelValue) };
    setTimeout(() => {
      if (field) {
        field.focus();
        field.select();
      } else (def ?? box.querySelector('button'))?.focus();
    }, 0);
  });
}

/** An alert with a single OK button. */
export function alertDialog(screen: HTMLElement, html: string): Promise<void> {
  return open(screen, html, [{ label: 'OK', value: true, isDefault: true }], true).then(() => undefined);
}

/** OK / Cancel. Resolves true for OK. */
export function confirmDialog(screen: HTMLElement, html: string, ok = 'OK'): Promise<boolean> {
  return open(screen, html, [
    { label: 'Cancel', value: false },
    { label: ok, value: true, isDefault: true },
  ], false).then((v) => v === true);
}

/** Text entry. Resolves the text, or null for Cancel. */
export function promptDialog(screen: HTMLElement, html: string, value: string, ok = 'OK'): Promise<string | null> {
  return open<null | 'ok'>(screen, html, [
    { label: 'Cancel', value: null },
    { label: ok, value: 'ok', isDefault: true },
  ], null, { value }).then((v) => (v === null ? null : String(v)));
}
