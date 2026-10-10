// Device protocol boundary. UI code consumes events, never parses CLI text.
// Only these diagnostic commands are used by the current web. Configuration
// framing is isolated in config-wire.js; no generic write-memory command exists.
import { parseSample } from './telemetry.js';

export const COMMAND = Object.freeze({ imuStart: 'i', imuStop: 'q' });
export const LINK = Object.freeze({ baudRate: 115200, dataBits: 8, stopBits: 1,
  parity: 'none', flowControl: 'none', bufferSize: 16384 });

export function parseDeviceLine(line) {
  const sample = parseSample(line);
  if (sample) return { type: 'imu.sample', sample };
  if (/^IMU START(?: |$)/.test(line)) {
    const match = line.match(/\baddress=(0x[\da-f]+)\b/i);
    return { type: 'imu.started', address: match?.[1] ?? null };
  }
  if (line === 'IMU STOP') return { type: 'imu.stopped' };
  if (/^IMU ERROR(?: |$)/.test(line)) return { type: 'imu.error', message: line };
  if (line.includes('Running=factory') || line.startsWith('Recovery ')) return { type: 'device.recovery' };
  return { type: 'log', message: line };
}
