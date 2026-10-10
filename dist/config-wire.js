// CFG1 wire codec only. This module does not open a port or write configuration.
// See docs/PROTOCOL.md. Callers must match a registry, request ID and readback.
const MAX_FRAME = 192;
const hex32 = n => n.toString(16).padStart(8, '0');
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) ?? [], n => parseInt(n, 16));
const uint32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function encodeConfigRequest(id, tag, operation, payload = new Uint8Array()) {
  if (!uint32(id) || !/^[0-9a-f]{8}$/.test(tag)) throw new Error('Invalid request ID or registry tag');
  if (!(payload instanceof Uint8Array) || !['GET', 'SET'].includes(operation)) throw new Error('Invalid request');
  if (operation === 'GET' ? payload.length !== 0 : payload.length < 9) throw new Error('Invalid payload');
  const prefix = `@CFG1 ${hex32(id)} ${tag} ${operation} ${payload.length ? hex(payload) : '-'}`;
  const result = `${prefix} ${hex32(crc32(new TextEncoder().encode(prefix)))}\n`;
  if (result.length > MAX_FRAME) throw new Error('Configuration frame too large');
  return result;
}
export function parseConfigReply(line) {
  if (line.length > MAX_FRAME) return null;
  const match = /^(@CFG1 ([0-9a-f]{8}) ([0-9a-f]{8}) (OK|ERR) ([0-9a-f]+)) ([0-9a-f]{8})(?:\r?\n)?$/.exec(line);
  if (!match || match[0] !== line || match[5].length % 2 || crc32(new TextEncoder().encode(match[1])) !== parseInt(match[6], 16)) return null;
  const payload = unhex(match[5]);
  if (match[4] === 'ERR' && payload.length !== 4) return null;
  if (match[4] === 'OK' && payload.length < 9) return null;
  return { id: parseInt(match[2], 16), tag: match[3], status: match[4], payload,
    error: match[4] === 'ERR' ? parseInt(match[5], 16) : null };
}
function checkedRegistry(registry) {
  if (registry?.format !== 'mini-drone.settings/1' || !/^[0-9a-f]{8}$/.test(registry.registry_tag)
      || !Array.isArray(registry.settings) || !registry.settings.length || registry.settings.length > 8) {
    throw new Error('Unsupported settings catalog');
  }
  const keys = new Map();
  for (const key of registry.settings) {
    if (!Number.isInteger(key.id) || key.id < 1 || key.id > 255 || keys.has(key.id)
        || !['bool', 'u32'].includes(key.type) || !['range', 'phase1_disarmed'].includes(key.rule)
        || !uint32(key.minimum) || !uint32(key.maximum) || key.minimum > key.maximum
        || (key.type === 'bool' && key.maximum > 1)
        || (key.rule === 'phase1_disarmed' && (key.type !== 'bool' || key.maximum !== 0))) {
      throw new Error('Invalid or unsupported setting descriptor');
    }
    checkValue(key, key.default);
    keys.set(key.id, key);
  }
  return keys;
}
function checkValue(key, value) {
  if (key.type === 'bool' ? typeof value !== 'boolean' : !uint32(value)) throw new Error(`Invalid type for setting ${key.id}`);
  const numeric = Number(value);
  if (numeric < key.minimum || numeric > key.maximum) throw new Error(`Out of range: setting ${key.id}`);
  return numeric;
}
export function encodeOverrides(overrides, registry) {
  const keys = checkedRegistry(registry);
  if (!(overrides instanceof Map)) throw new Error('Overrides must be a Map of setting ID to typed value');
  const entries = [...overrides].sort((a, b) => a[0] - b[0]);
  // Validate every entry before creating any output. Absence means use default.
  for (const [id, value] of entries) {
    if (!keys.has(id)) throw new Error(`Unknown or protected setting ${id}`);
    checkValue(keys.get(id), value);
  }
  const bytes = new Uint8Array(9 + entries.length * 5), view = new DataView(bytes.buffer);
  bytes.set([0x44, 0x43, 0x46, 0x31, entries.length]);
  entries.forEach(([id, value], i) => { bytes[5 + i * 5] = id; view.setUint32(6 + i * 5, Number(value), true); });
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(0, -4)), true);
  return bytes;
}
export function decodeOverrides(bytes, registry) {
  const keys = checkedRegistry(registry);
  if (!(bytes instanceof Uint8Array) || bytes.length < 9 || bytes.length > 9 + 5 * keys.size
      || bytes.length !== 9 + bytes[4] * 5 || hex(bytes.subarray(0, 4)) !== '44434631') throw new Error('Invalid snapshot');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(bytes.length - 4, true) !== crc32(bytes.subarray(0, -4))) throw new Error('Snapshot CRC mismatch');
  let previous = 0;
  const result = new Map();
  for (let offset = 5; offset < bytes.length - 4; offset += 5) {
    const id = bytes[offset], key = keys.get(id), numeric = view.getUint32(offset + 1, true);
    if (!key || id <= previous || (key.type === 'bool' && numeric > 1)) throw new Error('Unknown, duplicate or invalid setting');
    const value = key.type === 'bool' ? numeric === 1 : numeric;
    checkValue(key, value); result.set(id, value); previous = id;
  }
  return result;
}
