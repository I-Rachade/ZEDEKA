// Page d'enrôlement : QR code (serveur + jeton) lu depuis les attributs data-* posés par le Worker.
(() => {
  const el = document.getElementById("qr");
  if (!el || !window.QRCode) return;
  new QRCode(el, { text: JSON.stringify({ server: el.dataset.server, token: el.dataset.token }), width: 200, height: 200 });
})();
