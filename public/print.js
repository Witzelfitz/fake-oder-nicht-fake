document.querySelector('#print')?.addEventListener('click', () => window.print());
const join = new URLSearchParams(location.search).get('join');
if (join) {
  try {
    const url = new URL(join);
    const code = url.searchParams.get('code');
    if (['http:', 'https:'].includes(url.protocol) && /^\d{6}$/.test(code)) {
      const qr = document.querySelector('#print-qr'); qr.src = `/api/qr?url=${encodeURIComponent(url.href)}`; qr.hidden = false;
      const label = document.querySelector('#print-code'); label.textContent = code; label.hidden = false;
      const address = document.querySelector('#print-url'); address.textContent = url.href; address.hidden = false;
      document.querySelector('#print-placeholder').hidden = true;
    }
  } catch { /* A generic printable poster remains available. */ }
}
