// Firmware protocol and orientation math. Quaternion convention: [x,y,z,w], body -> world Z-up.
export const SAMPLE_HZ = 10;
const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const TRIPLE = `${NUMBER},${NUMBER},${NUMBER}`;
const pattern = new RegExp(`^IMU n=(\\d+) a\\[g\\]=${TRIPLE} g\\[dps\\]=${TRIPLE} T\\[C\\]=${NUMBER} m\\[uT\\]=(?:${TRIPLE}|NA)$`);
export function parseSample(line) {
  const m = pattern.exec(line.trim());
  if (!m) return null;
  const v = m.slice(1).map(x => x === undefined ? null : Number(x));
  if (v.some(x => x !== null && !Number.isFinite(x)) || !Number.isSafeInteger(v[0])) return null;
  return { n: v[0], accel: v.slice(1,4), gyro: v.slice(4,7), temp: v[7], mag: v[8] === null ? null : v.slice(8,11) };
}
export class LineBuffer {
  constructor() { this.pending = ''; this.discard = false; }
  push(text) {
    const result = [];
    for (const ch of text) {
      if (ch === '\n') {
        if (!this.discard && this.pending) result.push(this.pending.replace(/\r$/, ''));
        this.pending = ''; this.discard = false;
      } else if (!this.discard) {
        this.pending += ch;
        if (this.pending.length > 2048) { this.pending = ''; this.discard = true; }
      }
    }
    return result;
  }
}
export const multiply = (a,b) => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
];
export const inverse = q => [-q[0],-q[1],-q[2],q[3]];
export const normalize = q => { const n = Math.hypot(...q); return n > 1e-9 ? q.map(v => v/n) : [0,0,0,1]; };
export const rotate = (q,v) => multiply(multiply(q,[...v,0]),inverse(q)).slice(0,3);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function euler(q) {
  const [x,y,z,w] = q, d = 180 / Math.PI;
  return { roll: Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*d,
    pitch: Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))*d,
    yaw: Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*d };
}
export function fromEuler(roll,pitch,yaw) {
  const [r,p,y] = [roll,pitch,yaw].map(v => v*Math.PI/360);
  return [Math.sin(r)*Math.cos(p)*Math.cos(y)-Math.cos(r)*Math.sin(p)*Math.sin(y),
    Math.cos(r)*Math.sin(p)*Math.cos(y)+Math.sin(r)*Math.cos(p)*Math.sin(y),
    Math.cos(r)*Math.cos(p)*Math.sin(y)-Math.sin(r)*Math.sin(p)*Math.cos(y),
    Math.cos(r)*Math.cos(p)*Math.cos(y)+Math.sin(r)*Math.sin(p)*Math.sin(y)];
}
function gravityOrientation(a) {
  const n = Math.hypot(...a);
  if (n < 0.1) return [0,0,0,1];
  const v = a.map(x => x/n);
  if (v[2] < -0.9999) return [1,0,0,0];
  return normalize([v[1],-v[0],0,1+v[2]]);
}
export class Attitude {
  constructor() { this.bias = [0,0,0]; this.mount = [0,0,0,1]; this.reset(); }
  reset() { this.q = [0,0,0,1]; this.reference = [0,0,0,1]; this.lastN = null; this.lastAt = null; }
  setMount(yaw,flipped) { this.mount = fromEuler(flipped ? 180 : 0,0,yaw); this.reset(); }
  zero() { this.reference = inverse(this.q); }
  get display() { return normalize(multiply(this.reference,this.q)); }
  update(sample,now) {
    const a = rotate(this.mount,sample.accel), n = Math.hypot(...a);
    const restarted = this.lastN !== null && (sample.n < this.lastN || now-this.lastAt > 1500);
    if (sample.n === this.lastN && !restarted) return false;
    if (this.lastN === null || restarted) {
      this.q = gravityOrientation(a); this.reference = [0,0,0,1];
    } else {
      // Count-based timing is stable even when USB delivers several samples in one chunk.
      const dt = (sample.n-this.lastN)/SAMPLE_HZ;
      if (dt > 0.5) { this.q = gravityOrientation(a); this.reference = [0,0,0,1]; }
      else {
        const w = rotate(this.mount,sample.gyro.map((v,i) => (v-this.bias[i])*Math.PI/180));
        if (n > 0.8 && n < 1.2) {
          const expected = rotate(inverse(this.q),[0,0,1]);
          const error = cross(a.map(v => v/n),expected);
          for (let i=0;i<3;i++) w[i] += 2.5*error[i];
        }
        const angle = Math.hypot(...w)*dt;
        const s = angle > 1e-9 ? Math.sin(angle/2)/Math.hypot(...w) : dt/2;
        this.q = normalize(multiply(this.q,[w[0]*s,w[1]*s,w[2]*s,Math.cos(angle/2)]));
      }
    }
    this.lastN = sample.n; this.lastAt = now;
    return true;
  }
}
export function gyroBias(samples) {
  if (samples.length < 30) throw new Error('At least 30 samples are required.');
  const mean = [0,1,2].map(i => samples.reduce((s,v) => s+v.gyro[i],0)/samples.length);
  const gyroDeviation = [0,1,2].map(i => Math.sqrt(samples.reduce((s,v) => s+(v.gyro[i]-mean[i])**2,0)/samples.length));
  const accelMean = [0,1,2].map(i => samples.reduce((s,v) => s+v.accel[i],0)/samples.length);
  const movement = samples.some(s => Math.abs(Math.hypot(...s.accel)-1)>0.15 || Math.hypot(...s.accel.map((v,i)=>v-accelMean[i]))>0.08);
  if (movement || gyroDeviation.some(v=>v>0.35) || Math.hypot(...mean)>8) throw new Error('The board is moving. Keep it still and try again.');
  return mean;
}
