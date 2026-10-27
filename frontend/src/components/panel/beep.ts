// Bip court joué à l'arrivée d'une nouvelle commande (le navigateur l'autorise après un premier clic sur la page).
export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach((start) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.2);
    });
  } catch {
    // son indisponible : le compteur suffit
  }
}

