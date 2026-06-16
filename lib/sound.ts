const MUTE_KEY = 'rentdrive_muted';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function isMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(MUTE_KEY) === 'true';
}

export function setMuted(value: boolean) {
  localStorage.setItem(MUTE_KEY, String(value));
  window.dispatchEvent(new CustomEvent('rentdrive:mute', { detail: value }));
}

export function playMessageSound() {
  if (isMuted()) return;
  try {
    const ac = getCtx();

    const tiempos = [0, 0.12];
    const frecuencias = [880, 1100];

    tiempos.forEach((t, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();

      osc.connect(gain);
      gain.connect(ac.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frecuencias[i], ac.currentTime + t);

      gain.gain.setValueAtTime(0, ac.currentTime + t);
      gain.gain.linearRampToValueAtTime(0.3, ac.currentTime + t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.18);

      osc.start(ac.currentTime + t);
      osc.stop(ac.currentTime + t + 0.2);
    });
  } catch {
    // AudioContext bloqueado sin interacción previa del usuario
  }
}
