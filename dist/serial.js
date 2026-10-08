import { LineBuffer } from './telemetry.js';
export class SerialLink {
  constructor(onLine,onClose) { this.onLine=onLine; this.onClose=onClose; this.port=null; this.reader=null; this.closing=false; this.writes=Promise.resolve(); }
  async connect() {
    if (!globalThis.isSecureContext || !navigator.serial) throw new Error('Hãy mở bằng Chrome/Edge trên localhost hoặc HTTPS để dùng USB/UART.');
    const port = await navigator.serial.requestPort(); // User gesture; supports USB-JTAG and USB-UART bridges.
    await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:16384});
    this.port=port; this.closing=false;
    this.readTask=this.readLoop(port);
    return port.getInfo();
  }
  async readLoop(port) {
    const decoder=new TextDecoder(), lines=new LineBuffer(); let failure=null;
    try {
      while (!this.closing && port.readable) {
        this.reader=port.readable.getReader();
        try {
          while (!this.closing) {
            const {value,done}=await this.reader.read();
            if (done) break;
            for (const line of lines.push(decoder.decode(value,{stream:true}))) this.onLine(line);
          }
        } finally { this.reader.releaseLock(); this.reader=null; }
        // A closed readable stream must not spin and freeze the interface.
        break;
      }
    } catch (error) { failure=error; }
    if (!this.closing) {
      await this.writes.catch(()=>{});
      try { await port.close(); } catch {}
      this.port=null;
      this.onClose(failure?.message || 'Cổng serial đã đóng.');
    }
  }
  send(command) {
    const operation=this.writes.catch(()=>{}).then(async()=>{
      if (!this.port?.writable) throw new Error('Chưa kết nối cổng serial.');
      const writer=this.port.writable.getWriter();
      try { await writer.write(new TextEncoder().encode(command)); }
      finally { writer.releaseLock(); }
    });
    this.writes=operation; return operation;
  }
  async disconnect() {
    if (!this.port) return;
    this.closing=true;
    try { await this.send('q'); } catch {}
    try { await this.reader?.cancel(); } catch {}
    await this.readTask;
    try { await this.port?.close(); } finally { this.port=null; }
  }
}
