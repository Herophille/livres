// Lecture du code-barres à partir d'une photo.
// On passe par <input type="file" capture> plutôt que par le flux vidéo de la caméra :
// cela fonctionne en HTTP simple, alors que l'accès caméra en direct exige HTTPS.
(function () {
  const input = document.getElementById('scan-input');
  const status = document.getElementById('scan-status');
  const isbnField = document.getElementById('isbn');
  const form = document.getElementById('isbn-form');
  if (!input || !window.ZXing) return;

  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);

  const setStatus = (text, isError) => {
    status.textContent = text;
    status.classList.toggle('is-error', Boolean(isError));
  };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });
  }

  // Dessine l'image réduite (et éventuellement tournée) puis tente un décodage
  function tryDecode(img, maxSide, rotate) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = rotate ? h : w;
    canvas.height = rotate ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (rotate) {
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0, w, h);
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

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    setStatus('Lecture du code-barres…');
    try {
      const img = await loadImage(file);
      const attempts = [[1600, false], [1600, true], [1000, false], [2400, false], [1000, true]];
      let code = null;
      for (const [size, rotate] of attempts) {
        code = tryDecode(img, size, rotate);
        if (code) break;
      }
      if (!code) {
        setStatus("Aucun code-barres lisible. Reprenez la photo de plus près, bien à plat, ou tapez l'ISBN.", true);
        return;
      }
      if (!/^97[89]/.test(code)) {
        setStatus(`Code ${code} lu, mais ce n'est pas un ISBN. Cherchez le code-barres commençant par 978 ou 979.`, true);
        return;
      }
      isbnField.value = code;
      setStatus(`ISBN ${code} lu. Recherche en cours…`);
      form.requestSubmit();
    } catch (err) {
      setStatus("Impossible d'ouvrir cette photo. Réessayez ou tapez l'ISBN.", true);
    } finally {
      input.value = '';
    }
  });
})();
