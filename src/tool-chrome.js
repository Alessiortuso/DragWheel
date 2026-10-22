// Barra del titolo delle finestre di lavoro: mostra il titolo della pagina nella zona trascinabile in alto
document.addEventListener('DOMContentLoaded', () => {
  const t = document.createElement('div');
  t.className = 'titlebar-title';
  t.textContent = document.title;
  document.body.appendChild(t);
  const title = document.querySelector('title');
  if (title) new MutationObserver(() => { t.textContent = document.title; }).observe(title, { childList: true });
});
