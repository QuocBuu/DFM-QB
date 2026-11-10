import {COMMAND} from './protocol.js';

// ACK-driven bench controls. No periodic retries or automatic motor restarts.
export class MotorTest {
  constructor(send, changed = () => {}) {
    this.send = send;
    this.changed = changed;
    this.mode = false;
    this.motor = 0;
    this.pending = null;
    this.status = 'Remove propellers before testing. Fixed 10% · 2 seconds per press.';
  }
  get busy() { return this.mode || !!this.pending; }
  async request(bytes, expected) {
    if (this.pending) throw new Error('Wait for the motor command response.');
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.status = 'No motor response. Stop and check the Flight firmware.';
        this.changed();
        reject(new Error(this.status));
      }, 1500);
      this.pending = {expected, resolve, reject, timer};
    });
    this.changed();
    Promise.resolve().then(() => this.send(bytes)).catch(error => this.settle(error));
    return reply;
  }
  settle(error) {
    if (!this.pending) return;
    const {resolve, reject, timer} = this.pending;
    clearTimeout(timer);
    this.pending = null;
    if (error) reject(error); else resolve();
    this.changed();
  }
  enter() { return this.request(COMMAND.imuStop + '\n' + COMMAND.motorStart, 'motor.started'); }
  select(motor) {
    if (!this.mode || !Number.isInteger(motor) || motor < 1 || motor > 4) {
      return Promise.reject(new Error('Enter motor test, then choose motor 1–4.'));
    }
    return this.request(String(motor), 'motor.running');
  }
  async stop() {
    this.settle(new Error('Motor command cancelled.'));
    // Leading LF also clears an unsupported m left in an older firmware CLI buffer.
    return this.request('\n' + COMMAND.imuStop, 'imu.stopped');
  }
  onEvent(event) {
    if (event.type === 'motor.started') {
      this.mode = true; this.motor = 0;
      this.status = 'Motor test ready · Press 1–4. Any other key exits.';
    } else if (event.type === 'motor.running') {
      this.mode = true; this.motor = event.motor;
      this.status = `Motor ${event.motor} · 10% · automatic stop after 2 seconds.`;
    } else if (event.type === 'motor.idle') {
      this.motor = 0;
      this.status = 'Motors stopped · Press 1–4 to test again, any other key to exit.';
    } else if (event.type === 'motor.stopped') {
      this.mode = false; this.motor = 0; this.status = 'Motor test stopped.';
    } else if (event.type === 'motor.error') {
      this.mode = false; this.motor = 0; this.status = event.message;
      this.settle(new Error(event.message));
    }
    if (event.type === this.pending?.expected) this.settle();
    this.changed();
  }
  disconnect() {
    this.mode = false; this.motor = 0;
    this.status = 'Disconnected · Firmware limits each motor pulse to 2 seconds.';
    this.settle(new Error('Serial disconnected.'));
    this.changed();
  }
}
