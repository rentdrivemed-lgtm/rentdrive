const MUTE_KEY = 'rentdrive_muted';
let ctx: AudioContext | null = null;
function getCtx(): AudioContext { if (!ctx) ctx = new AudioContext(); return ctx; }
export function isMuted(): boolean { if (typeof localStorage === 'undefined') return false; return localStorage.getItem(MUTE_KEY) === 'true'; }
export function setMuted(value: boolean) { localStorage.setItem(MUTE_KEY, String(value)); window.dispatchEvent(new CustomEvent('rentdrive:mute', { detail: value })); }
export function playMessageSound() { if (isMuted()) return; try { void getCtx(); } catch {} }