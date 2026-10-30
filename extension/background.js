/* Shared mask safety margin; legacy room estimation is kept for its standalone callers. */
(() => {
  'use strict';
  function dilatePerson(person, w, h, hidden, horizontal) {
    if (person.length !== w * h) throw new Error('Invalid segmentation dimensions.');
    // Separable dilation keeps a two-pixel safety margin without 25 writes per person pixel.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let value = 0;
      for (let dx = Math.max(0, x - 2); dx <= Math.min(w - 1, x + 2); dx++) if (person[y * w + dx] >= 96) { value = 1; break; }
      horizontal[y * w + x] = value;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let value = 0;
      for (let dy = Math.max(0, y - 2); dy <= Math.min(h - 1, y + 2); dy++) if (horizontal[dy * w + x]) { value = 1; break; }
      hidden[y * w + x] = value;
    }
    return hidden;
  }
  class RoomEstimator {
    constructor(width, height) {
      this.width = width; this.height = height;
      const n = width * height;
      this.pixels = new Uint8ClampedArray(n * 4);
      this.history = new Uint8ClampedArray(n * 4);
      this.smooth = new Uint8ClampedArray(n * 4);
      this.seen = new Uint8Array(n); this.clearAge = new Uint8Array(n);
      this.hidden = new Uint8Array(n); this.horizontal = new Uint8Array(n);
      this.known = new Uint8Array(n); this.queue = new Int32Array(n);
    }
    update(rgba, person) {
      const { width: w, height: h, pixels: data, hidden, horizontal, known, queue, history, seen, clearAge, smooth } = this;
      const n = w * h;
      if (rgba.length !== n * 4 || person.length !== n) throw new Error('Invalid segmentation dimensions.');
      dilatePerson(person, w, h, hidden, horizontal);
      let head = 0, tail = 0;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        known[i] = 0;
        if (!hidden[i]) {
          data[p] = rgba[p]; data[p + 1] = rgba[p + 1]; data[p + 2] = rgba[p + 2];
          // Two successive clear masks reduce contamination at a moving boundary.
          clearAge[i] = Math.min(2, clearAge[i] + 1);
          if (clearAge[i] === 2) {
            history[p] = rgba[p]; history[p + 1] = rgba[p + 1]; history[p + 2] = rgba[p + 2]; seen[i] = 1;
          }
          known[i] = 1; queue[tail++] = i;
        } else {
          clearAge[i] = 0;
          if (seen[i]) {
            data[p] = history[p]; data[p + 1] = history[p + 1]; data[p + 2] = history[p + 2];
            known[i] = 1; queue[tail++] = i;
          }
        }
        data[p + 3] = 255;
      }
      if (!tail) throw new Error('The camera cannot see any room around you. Move a little farther from the camera.');
      // Fill unseen pixels from current visible room and previously observed room.
      // This estimates occluded content; it cannot recover motion behind a person.
      const spread = (from, to) => {
        if (known[to]) return;
        known[to] = 1; queue[tail++] = to;
        const a = from * 4, b = to * 4;
        data[b] = data[a]; data[b + 1] = data[a + 1]; data[b + 2] = data[a + 2];
      };
      while (head < tail) {
        const i = queue[head++], x = i % w;
        if (x) spread(i, i - 1);
        if (x + 1 < w) spread(i, i + 1);
        if (i >= w) spread(i, i - w);
        if (i + w < n) spread(i, i + w);
      }
      // A small, bounded relaxation removes fill seams. Observed pixels stay exact.
      for (let pass = 0; pass < 4; pass++) {
        smooth.set(data);
        for (let i = 0; i < n; i++) {
          if (!hidden[i] || seen[i]) continue;
          const x = i % w, p = i * 4;
          const left = (x ? i - 1 : i) * 4, right = (x + 1 < w ? i + 1 : i) * 4;
          const up = (i >= w ? i - w : i) * 4, down = (i + w < n ? i + w : i) * 4;
          for (let c = 0; c < 3; c++) data[p + c] = (smooth[left + c] + smooth[right + c] + smooth[up + c] + smooth[down + c]) / 4;
        }
      }
      return { pixels: data, hidden };
    }
  }
  function estimateRoom(rgba, person, width, height) {
    return new RoomEstimator(width, height).update(rgba, person);
  }
  Object.assign(globalThis.MeetEffects, { estimateRoom, RoomEstimator, dilatePerson });
})();
