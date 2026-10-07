// Lecture du code-barres à partir d'une photo.
// On passe par <input type="file" capture> plutôt que par le flux vidéo de la caméra :
// cela fonctionne en HTTP simple, alors que l'accès caméra en direct exige HTTPS.
(function () {
  const inputs = [document.getElementById('scan-input'), document.getElementById('scan-gallery')].filter(Boolean);
  const status = document.getElementById('scan-status');
  const preview = document.getElementById('scan-preview');
  const isbnField = document.getElementById('isbn');
  const form = document.getElementById('isbn-form');
  const flow = document.getElementById('add-flow');
  if (!form || !status) return;

  const initialStatus = status.textContent;
  const setStatus = (text, state) => {
    status.textContent = text;
    status.classList.toggle('is-error', state === 'error');
    status.classList.toggle('is-busy', state === 'busy');
  };

  // Recherche ISBN : la réponse peut prendre quelques secondes, on le montre clairement
  form.addEventListener('submit', () => {
    flow.classList.add('is-busy');
    const button = form.querySelector('button[type=submit]');
    button.classList.add('is-busy');
    // Désactivé après coup, pour ne pas gêner l'envoi du formulaire
    setTimeout(() => {
      button.disabled = true;
      inputs.forEach((i) => { i.disabled = true; });
    }, 0);
  });

  // Retour arrière depuis la fiche : la page revient du cache dans l'état « occupé »
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    flow.classList.remove('is-busy');
    const button = form.querySelector('button[type=submit]');
    button.classList.remove('is-busy');
    button.disabled = false;
    inputs.forEach((i) => { i.disabled = false; });
    setStatus(initialStatus);
    if (preview) preview.hidden = true;
  });

  if (!inputs.length || !window.ZXing) return;

  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);

  // Laisse le navigateur afficher le message avant un calcul qui bloque la page
  const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });
  }

  // Zone analysée, en fractions de la photo : entière, ou le centre agrandi
  // (utile quand le code-barres est petit sur la photo)
  const FULL = [0, 0, 1, 1];
  const CENTER = [0.2, 0.2, 0.6, 0.6];

  // Dessine la zone réduite (et éventuellement tournée) puis tente un décodage
  function tryDecode(img, maxSide, rotate, crop) {
    const [cx, cy, cw, ch] = crop;
    const sx = img.naturalWidth * cx;
    const sy = img.naturalHeight * cy;
    const sw = img.naturalWidth * cw;
    const sh = img.naturalHeight * ch;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = rotate ? h : w;
    canvas.height = rotate ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (rotate) {
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const source = new Z.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
    try {
      return reader.decode(bitmap).getText();
    } catch (e) {
      return null;
    } finally {
      reader.reset();
    }
  }

  const ATTEMPTS = [
    [1600, false, FULL], [1600, true, FULL],
    [1200, false, CENTER], [1200, true, CENTER],
    [2400, false, FULL], [1000, false, FULL],
  ];

  async function handleFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    setStatus('Lecture du code-barres…', 'busy');
    let loaded = null;
    try {
      loaded = await loadImage(file);
      if (preview) {
        if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
        preview.src = loaded.url;
        preview.dataset.url = loaded.url;
        preview.hidden = false;
      }
      await nextFrame();
      let code = null;
      for (const [size, rotate, crop] of ATTEMPTS) {
        code = tryDecode(loaded.img, size, rotate, crop);
        if (code) break;
        await nextFrame();
      }
      if (!code) {
        setStatus("Aucun code-barres lisible. Reprenez la photo de plus près, bien éclairée et à plat, ou tapez l'ISBN.", 'error');
        return;
      }
      if (!/^97[89]/.test(code)) {
        setStatus(`Code ${code} lu, mais ce n'est pas un ISBN. Cherchez le code-barres commençant par 978 ou 979.`, 'error');
        return;
      }
      isbnField.value = code;
      setStatus(`ISBN ${code} lu. Recherche des informations du livre…`, 'busy');
      form.requestSubmit();
    } catch (err) {
      setStatus("Impossible d'ouvrir cette photo. Réessayez ou tapez l'ISBN.", 'error');
    } finally {
      input.value = '';
    }
  }

  inputs.forEach((input) => input.addEventListener('change', () => handleFile(input)));
})();
