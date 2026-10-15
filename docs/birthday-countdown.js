(() => {
  'use strict';
  const panel = document.getElementById('qtc-birthday');
  if (!panel) return;
  // Oct 28, 2026, midnight in America/New_York (EDT, UTC−04:00).
  const target = Date.parse('2026-10-28T00:00:00-04:00');
  const end = Date.parse('2026-10-29T00:00:00-04:00');
  const units = ['days', 'hours', 'minutes', 'seconds'];
  function update() {
    const now = Date.now();
    let remaining = Math.max(0, Math.ceil((target - now) / 1000));
    const values = [Math.floor(remaining / 86400), Math.floor(remaining / 3600) % 24, Math.floor(remaining / 60) % 60, remaining % 60];
    units.forEach((unit, index) => {
      const field = document.getElementById('birthday-' + unit);
      const value = String(values[index]).padStart(2, '0');
      if (field.textContent !== value) field.textContent = value;
    });
    const celebrating = now >= target && now < end;
    const title = now < target ? 'The countdown is on.' : celebrating ? 'Happy birthday, Qubitcoin!' : 'Thanks for celebrating Qubitcoin.';
    document.getElementById('birthday-title').textContent = title;
    panel.classList.toggle('birthday-celebrating', celebrating);
    document.getElementById('birthday-clock').hidden = now >= target;
    document.getElementById('birthday-message').hidden = now < target;
    document.getElementById('birthday-message').textContent = celebrating ? 'A new year of curiosity, connections, and discovery.' : 'Celebrated October 28, 2026 · See you on the map.';
  }
  update();
  setInterval(update, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
})();
