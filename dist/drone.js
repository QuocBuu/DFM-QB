import { rotate } from './telemetry.js';

// Body coordinates: X forward, Y left, Z up. A small orthographic 3D renderer;
// Canvas 2D needs no GPU context, mesh downloads or animation while idle.
export class DroneView {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D unavailable');
    this.q = [0, 0, 0, 1];
    this.zoom = 1;
    this.dirty = true;
    this.setView('perspective');
    this.resize = new ResizeObserver(() => { this.dirty = true; });
    this.resize.observe(container);
    let drag = null;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = [e.clientX, e.clientY];
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      this.azimuth -= (e.clientX - drag[0]) * .008;
      this.elevation = Math.max(-1.5, Math.min(1.57, this.elevation + (e.clientY - drag[1]) * .008));
      drag = [e.clientX, e.clientY];
      this.dirty = true;
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(name, () => { drag = null; });
    }
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom = Math.max(.6, Math.min(1.6, this.zoom * Math.exp(-e.deltaY * .001)));
      this.dirty = true;
    }, { passive: false });
  }
  setView(name) {
    [this.azimuth, this.elevation] = name === 'top' ? [0, Math.PI / 2] : name === 'front' ? [0, 0] : [.65, .65];
    this.zoom = 1;
    this.dirty = true;
  }
  setQuaternion(q) {
    if (q.some((v, i) => Math.abs(v - this.q[i]) > 1e-7)) {
      this.q = [...q];
      this.dirty = true;
    }
  }
  render() {
    if (!this.dirty) return;
    const { width: w, height: h } = this.canvas.getBoundingClientRect();
    if (!w || !h) return;
    this.dirty = false;
    const ratio = Math.min(devicePixelRatio || 1, 2), c = this.ctx;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    const scale = Math.min(w / 4.6, h / 3.6) * this.zoom;
    const project = ([x, y, z]) => [w / 2 + (sa * x - ca * y) * scale,
      h / 2 - (-se * ca * x - se * sa * y + ce * z) * scale,
      ce * ca * x + ce * sa * y + se * z];
    const path = (points, color, width = 1, fill = null) => {
      c.beginPath();
      points.forEach((p, i) => { const [x, y] = project(p); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      if (fill) { c.closePath(); c.fillStyle = fill; c.fill(); }
      c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.stroke();
    };
    // Fixed world grid makes tilt visible, even while changing the camera.
    for (let n = -2; n <= 2; n++) {
      path([[n, -2, -.45], [n, 2, -.45]], '#e8ecf0');
      path([[-2, n, -.45], [2, n, -.45]], '#e8ecf0');
    }
    const parts = [];
    const add = (points, color, width, fill) => {
      const world = points.map(p => rotate(this.q, p));
      parts.push({ world, color, width, fill, depth: world.reduce((s, p) => s + project(p)[2], 0) / world.length });
    };
    for (const x of [-.8, .8]) for (const y of [-.8, .8]) {
      add([[0, 0, 0], [x, y, 0]], '#697683', 7);
      const ring = Array.from({ length: 41 }, (_, i) => [x + .34 * Math.cos(i * Math.PI / 20), y + .34 * Math.sin(i * Math.PI / 20), .06]);
      add(ring, x > 0 ? '#245fbd' : '#7c8792', 2, '#f7f9fc');
      add([[x - .22, y, .07], [x + .22, y, .07]], '#a2adb8', 2);
    }
    const box = [[-.38, -.24], [.38, -.24], [.38, .24], [-.38, .24]];
    for (let i = 0; i < 4; i++) {
      const a = box[i], b = box[(i + 1) % 4];
      add([[...a, -.12], [...b, -.12], [...b, .12], [...a, .12]], '#576777', 1, '#c2ccd6');
    }
    add(box.map(p => [...p, .12]), '#576777', 1, '#e0e6ed');
    add([[.31, 0, .13], [-.12, -.14, .13], [-.12, .14, .13]], '#245fbd', 1, '#245fbd');
    parts.sort((a, b) => a.depth - b.depth);
    for (const p of parts) path(p.world, p.color, p.width, p.fill);
    const nose = project(rotate(this.q, [1.4, 0, 0]));
    c.fillStyle = '#245fbd'; c.font = '11px system-ui'; c.textAlign = 'center';
    c.fillText('NOSE / X', nose[0], nose[1]);
  }
}
