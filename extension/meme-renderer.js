/* Packaged reaction images over a live camera. No runtime image requests. */
(() => {
  'use strict';
  const images = new Map();
  const ready = Object.entries(MeetEffects.memeAssets || {}).map(async ([effect, asset]) => {
    if (!asset.image) return;
    const image = new Image(); image.src = asset.image;
    try { await image.decode(); images.set(effect, image); }
    catch { /* The engine keeps its caption fallback if a packaged image fails. */ }
  });
  MeetEffects.memesReady = Promise.all(ready);
  MeetEffects.drawMeme = (context, effect, width, height, time) => {
    const image = images.get(effect);
    if (!image) return false;
    const ratio = Math.min(width * 0.44 / image.naturalWidth, height * 0.64 / image.naturalHeight);
    const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
    const enter = 1 - (1 - Math.min(1, Math.max(0, time) / 0.18)) ** 3;
    const x = width - w - width * 0.035 + (1 - enter) * width * 0.025;
    const y = height - h - height * (effect === 'cinema' ? 0.15 : 0.05);
    context.save();
    context.globalAlpha = enter;
    context.fillStyle = '#202622'; context.fillRect(x - 2, y - 2, w + 4, h + 4);
    context.drawImage(image, x, y, w, h);
    context.restore();
    return true;
  };
})();
