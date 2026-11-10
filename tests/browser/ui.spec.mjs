import {test, expect} from '@playwright/test';

async function open(page) {
  await page.route('**/api/updater', route => route.fulfill({status: 503, contentType:'application/json', body:'{"message":"Offline"}'}));
  await page.goto('/');
  await expect(page.locator('#updaterStatus')).toHaveText('LOCAL UPDATER OFFLINE');
}
function contrast(a,b) {
  const lum = value => value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for (const viewport of [{width:1440,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:740}]) {
  test(`responsive panels and selected text at ${viewport.width}px`, async ({page}) => {
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);await open(page);
    for(const name of ['monitor','parameters','firmware','log']) {
      const tab=page.locator(`#tab-${name}`);await tab.click();await tab.hover();
      await expect(page.locator(`#panel-${name}`)).toBeVisible();
      const colors=await tab.evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
      expect(contrast(colors.fg,colors.bg)).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    }
    await page.locator('#log').evaluate(el=>el.textContent='very-long-device-log '.repeat(400));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    const box=await page.locator('#log').boundingBox();expect(box.width).toBeLessThan(viewport.width);expect(box.height).toBeGreaterThan(120);
    await page.getByRole('button',{name:'Wrap long lines'}).click();
    await expect(page.locator('#log')).toHaveCSS('white-space','pre-wrap');
    await page.locator('#tab-firmware').click();
    await page.locator('#region-flight').click();await page.locator('#region-flight').hover();
    const colors=await page.locator('#region-flight').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
    expect(contrast(colors.fg,colors.bg)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('#region-panel-flight')).toContainText('0x3FFFFF');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  });
}
test('nested tabs preserve main page and keyboard navigation', async ({page}) => {
  await open(page);await page.locator('#tab-firmware').click();
  await page.locator('#region-nvs').click();
  await expect(page.locator('#region-panel-nvs')).toBeVisible();
  await expect(page.locator('#panel-firmware')).toBeVisible();
  await expect(page.locator('#tab-firmware')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#connect')).toContainText('Disconnect');
  await page.locator('#region-nvs').press('ArrowDown');
  await expect(page.locator('#region-otadata')).toBeFocused();
  await expect(page.locator('#region-panel-otadata')).toBeVisible();
  await page.locator('#tab-monitor').click();await page.locator('#tab-monitor').press('End');
  await expect(page.locator('#tab-log')).toBeFocused();
  await page.locator('#tab-firmware').click();
  await expect(page.locator('#region-panel-otadata')).toBeVisible();
  await page.locator('#region-flight').click();
  await page.locator('[data-region-write="flight"]').click();
  await expect(page.locator('#region-panel-full')).toBeVisible();
  await expect(page.locator('#installFirmware')).toBeDisabled();
  await page.locator('#region-nvs').click();await expect(page.locator('[data-region-write="nvs"]')).toBeDisabled();
});
test('bounded log retains reading position and renders device text literally', async ({page}) => {
  await open(page);await page.locator('#tab-log').click();
  await page.evaluate(async()=>{
    const {LogView}=await import('./ui.js');
    // Isolated fixture uses the same component contract as the live viewer.
    const root=document.createElement('section');root.innerHTML='<button data-log-follow></button><pre style="height:150px;overflow:auto"></pre><span data-log-count></span>';
    document.body.append(root);window.testLog=new LogView(root);
    for(let n=0;n<600;n++)window.testLog.append(`line ${n}`);
  });
  expect(await page.evaluate(()=>window.testLog.lines.length)).toBe(500);
  expect(await page.evaluate(()=>window.testLog.lines[0])).toBe('line 100');
  await page.evaluate(()=>{window.testLog.setFollow(false);window.testLog.output.scrollTop=50;window.testLog.append('<img src=x onerror=alert(1)>');});
  expect(await page.evaluate(()=>window.testLog.output.scrollTop)).toBe(50);
  expect(await page.evaluate(()=>window.testLog.output.querySelector('img'))).toBeNull();
  await page.evaluate(()=>window.testLog.append('x'.repeat(10000)));
  expect(await page.evaluate(()=>window.testLog.lines.at(-1).length)).toBeLessThan(2100);
  await page.evaluate(()=>window.testLog.setFollow(true));
  expect(await page.evaluate(()=>Math.abs(window.testLog.output.scrollHeight-window.testLog.output.scrollTop-window.testLog.output.clientHeight))).toBeLessThan(2);
  await page.evaluate(()=>window.testLog.clear());expect(await page.evaluate(()=>window.testLog.lines.length)).toBe(0);
});
test('demo still streams, zeroes and exports log', async ({page}) => {
  await open(page);await page.locator('#demo').click();
  await expect(page.locator('#source')).toContainText('DEMO');
  await expect(page.locator('#roll')).not.toContainText('—');await page.locator('#zero').click();
  await page.locator('#tab-log').click();await expect(page.locator('#log')).toContainText('DEMO');
  const download=page.waitForEvent('download');await page.locator('#export').click();
  expect((await download).suggestedFilename()).toMatch(/mini-drone-demo.*\.log$/);
  await page.locator('#clear').click();await expect(page.locator('#log')).toHaveText('No log entries.');
});
test('updater requires prepared backup, download and confirmation; region write never flashes directly', async ({page}) => {
  let state={available:true,token:'test-token',stage:'idle',ports:['/dev/ttyTEST0'],busy:false,backup_ready:false,downloaded:false};
  const writes=[];
  await page.route('**/api/updater**', async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST')writes.push(path);
    if(path.endsWith('/prepare'))state={...state,stage:'backup-ready',backup_ready:true,job_id:'test-job'};
    if(path.endsWith('/install'))state={...state,stage:'verified'};
    if(path.endsWith('/backup')){state.downloaded=true;return route.fulfill({json:{device_mac:'00:11:22:33:44:55'}});}
    await route.fulfill({json:state});
  });
  await page.goto('/');await page.locator('#tab-firmware').click();
  await page.locator('#region-flight').click();await page.locator('[data-region-write="flight"]').click();expect(writes).toEqual([]);
  await page.locator('#firmwareFile').setInputFiles({name:'release.zip',mimeType:'application/zip',buffer:Buffer.from('simulated package')});
  await page.locator('#firmwarePort').selectOption('/dev/ttyTEST0');
  await page.locator('#prepareFirmware').click();await expect(page.locator('#downloadBackup')).toBeEnabled();
  await expect(page.locator('#installFirmware')).toBeDisabled();
  await page.locator('#downloadBackup').click();await expect(page.locator('#confirmFirmware')).toBeEnabled();
  await expect(page.locator('#installFirmware')).toBeDisabled();
  await page.locator('#confirmFirmware').check();await expect(page.locator('#installFirmware')).toBeEnabled();
  await page.locator('#firmwareFile').setInputFiles({name:'different.zip',mimeType:'application/zip',buffer:Buffer.from('changed package')});
  await expect(page.locator('#installFirmware')).toBeDisabled();
  await page.locator('#prepareFirmware').click();await expect(page.locator('#downloadBackup')).toBeEnabled();
  await page.locator('#confirmFirmware').check();await page.locator('#installFirmware').click();
  await expect(page.locator('#firmwareResult')).toContainText('verified');
  expect(writes).toEqual(['/api/updater/prepare','/api/updater/prepare','/api/updater/install']);
});
test('lost updater connection clears write eligibility and allows a manual refresh', async ({page}) => {
  let statusCalls=0;
  await page.route('**/api/updater', route=>{
    statusCalls++;
    if(statusCalls>1)return route.abort('failed');
    return route.fulfill({json:{available:true,token:'test-token',stage:'working',busy:true,ports:[],backup_ready:false,downloaded:false}});
  });
  await page.goto('/');await page.locator('#tab-firmware').click();
  await expect(page.locator('#updaterStatus')).toHaveText('LOCAL UPDATER OFFLINE');
  await expect(page.locator('#firmwareResult')).toContainText('DRN-1023');
  await expect(page.locator('#installFirmware')).toBeDisabled();
  await expect(page.locator('#prepareFirmware')).toBeDisabled();
  await expect(page.locator('#updaterRefresh')).toBeEnabled();
});

async function mockDiagnosticSerial(page) {
  await page.route('**/serial.js', route=>route.fulfill({contentType:'text/javascript',body:`
    import {crc32,encodeOverrides} from './config-wire.js';
    const catalog=await (await fetch('./settings-catalog.json')).json();
    let savedConfig=encodeOverrides(new Map(),catalog);
    export class SerialLink {
      constructor(onLine,onClose){this.onLine=onLine;this.onClose=onClose;this.mode='';this.line='';window.serialWrites=[];window.serialEmit=line=>onLine(line);window.serialLost=()=>{this.port=null;onClose('Mock unplug');};}
      async connect(){this.port={};return {};}
      async disconnect(){await this.send('q');this.port=null;}
      async send(bytes){
        window.serialWrites.push(bytes);
        if(bytes.startsWith('@CFG1 ')){
          const [,id,tag,op,payload]=bytes.split(' ');
          if(op==='SET')savedConfig=Uint8Array.from(payload.match(/../g),s=>parseInt(s,16));
          const hex=Array.from(savedConfig,n=>n.toString(16).padStart(2,'0')).join('');
          const body='@CFG1 '+id+' '+tag+' OK '+hex;
          this.onLine(body+' '+crc32(new TextEncoder().encode(body)).toString(16).padStart(8,'0'));return;
        }
        if(bytes.startsWith('@DATA1 ')){
          const [,id,op]=bytes.split(' ');const data=op==='INFO'?'02340169ea0000007b000000':'-';
          const body='@DATA1 '+id+' OK '+data;
          this.onLine(body+' '+crc32(new TextEncoder().encode(body)).toString(16).padStart(8,'0'));return;
        }
        for(const ch of bytes){
          if(this.mode==='m'){
            if(/[1-4]/.test(ch)){
              this.onLine('MOTOR RUN motor='+ch+' duty=10 timeout_ms=2000');
              clearTimeout(this.cutoff);this.cutoff=setTimeout(()=>this.onLine('MOTOR IDLE timeout'),2000);
            }else{clearTimeout(this.cutoff);this.mode='';this.onLine('MOTOR STOP');if(ch==='q')this.onLine('IMU STOP');}
          }else if(this.mode==='i'){this.mode='';this.onLine('IMU STOP');}
          else if(this.line){if(ch==='\\n'){if(this.line==='sys boot')this.onLine('Running=ota_0 Boot=ota_0');this.line='';}else this.line+=ch;}
          else if(ch==='q')this.onLine('IMU STOP');
          else if(ch==='m'){this.mode='m';this.onLine('MOTOR START duty=10 timeout_ms=2000; 1-4 select');}
          else if(ch==='i'){this.mode='i';this.onLine('IMU START ICM-20948 address=0x69');}
          else if(ch!=='\\n'&&ch!=='\\r')this.line=ch;
        }
      }
    }
  `}));
}

test('motor buttons, exclusive keyboard modes, timeout and disconnect use mocked serial', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await mockDiagnosticSerial(page);await open(page);
  await expect(page.locator('#motorStart')).toBeDisabled();
  await page.locator('#connect').click();
  await expect(page.locator('#stream')).toContainText('Stop streaming');
  await page.keyboard.press('Shift');await expect(page.locator('#stream')).toContainText('Start streaming');
  await page.keyboard.press('i');await page.keyboard.press('x');await expect(page.locator('#stream')).toContainText('Start streaming');
  await page.keyboard.press('m');await expect(page.locator('#motorStatus')).toContainText('ready');
  await expect(page.locator('#stream')).toBeDisabled();
  await expect(page.locator('#loadProfile')).toBeDisabled();
  await page.keyboard.press('1');await expect(page.locator('#motorStatus')).toContainText('Motor 1');
  await page.locator('[data-motor="4"]').click();await expect(page.locator('#motorStatus')).toContainText('Motor 4');
  await expect(page.locator('#motorStatus')).toContainText('Motors stopped',{timeout:4000});
  await page.keyboard.press('2');await expect(page.locator('#motorStatus')).toContainText('Motor 2');
  await page.keyboard.press('i');await expect(page.locator('#motorStatus')).toContainText('test stopped');
  await expect(page.locator('#stream')).toContainText('Start streaming');
  await page.keyboard.press('i');await expect(page.locator('#stream')).toContainText('Stop streaming');
  await page.locator('#motorStart').click();await expect(page.locator('#motorStatus')).toContainText('ready');
  await page.locator('[data-motor="3"]').click();
  await page.evaluate(()=>dispatchEvent(new Event('blur')));
  await expect(page.locator('#motorStatus')).toContainText('test stopped');
  await page.locator('#motorStart').click();await page.locator('[data-motor="1"]').click();
  await page.evaluate(()=>window.serialLost());
  await expect(page.locator('[data-motor="1"]')).toBeDisabled();
  await expect(page.locator('#motorStatus')).toContainText('Disconnected');
  const writes=await page.evaluate(()=>window.serialWrites);
  expect(writes).toContain('q\nm');expect(writes).toContain('\nq');
  expect(errors).toEqual([]);
});

for(const width of [320,390,768,1440])test(`motor controls fit and remain readable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await mockDiagnosticSerial(page);await open(page);
  await page.locator('#connect').click();await page.locator('#tab-parameters').click();await page.locator('#parameter-motor').click();await page.locator('#motorStart').click();
  await expect(page.locator('[data-motor="1"]')).toBeEnabled();
  await page.locator('[data-motor="1"]').hover();await page.locator('[data-motor="1"]').focus();
  const colors=await page.locator('[data-motor="1"]').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
  expect(contrast(colors.fg,colors.bg)).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#motorStop').click();
  await page.locator('#motorPosition1').selectOption('1');await page.locator('#motorDirection1').selectOption('2');
  await page.locator('#motorPosition2').selectOption('2');await page.locator('#motorDirection2').selectOption('1');
  await page.locator('#motorPosition3').selectOption('3');await page.locator('#motorDirection3').selectOption('1');
  await page.locator('#motorPosition4').selectOption('4');await page.locator('#motorDirection4').selectOption('2');
  await page.locator('#parameter-motor').hover();await page.locator('#parameter-motor').focus();
  const tabColors=await page.locator('#parameter-motor').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
  expect(contrast(tabColors.fg,tabColors.bg)).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'/tmp/mini-drone-motor-settings-'+width+'.png',fullPage:true});
});


test('parameter subtabs preserve selection and stop a motor when leaving its controls',async({page})=>{
  await mockDiagnosticSerial(page);await open(page);await page.locator('#connect').click();
  await expect(page.locator('#panel-monitor #motorStart')).toHaveCount(0);
  await page.locator('#tab-parameters').click();await expect(page.locator('#parameter-panel-imu')).toBeVisible();
  const before=await page.evaluate(()=>window.serialWrites.length);
  await page.locator('#parameter-imu').press('ArrowDown');
  await expect(page.locator('#parameter-motor')).toBeFocused();
  await expect(page.locator('#parameter-panel-motor')).toBeVisible();
  expect(await page.evaluate(()=>window.serialWrites.slice(-1)[0])).not.toContain(' SET ');
  await page.locator('#motorStart').click();await page.locator('[data-motor="1"]').click();
  await page.locator('#parameter-imu').click();
  await expect(page.locator('#motorStatus')).toContainText('test stopped');
  await page.locator('#parameter-motor').click();await page.locator('#motorStart').click();
  await page.locator('[data-motor="2"]').click();await page.locator('#tab-monitor').click();
  await expect(page.locator('#motorStatus')).toContainText('test stopped');
  await page.locator('#tab-parameters').click();await expect(page.locator('#parameter-panel-motor')).toBeVisible();
  expect(await page.evaluate(()=>window.serialWrites.slice(-1)[0])).toBe('\nq');
  await page.locator('#parameter-motor').press('Home');await expect(page.locator('#parameter-imu')).toBeFocused();
  await expect(page.locator('#parameter-panel-imu')).toBeVisible();
});

test('motor layout edits change arrows locally; Save persists and Reload restores mocked device settings',async({page})=>{
  await mockDiagnosticSerial(page);await open(page);await page.locator('#connect').click();
  await page.locator('#tab-parameters').click();await page.locator('#parameter-motor').click();
  await expect(page.locator('#motorSettingsStatus')).toContainText('Loaded from device');
  await expect(page.locator('#saveMotorSettings')).toBeDisabled();
  const before=await page.evaluate(()=>window.serialWrites.length);
  await page.locator('#motorPosition1').selectOption('1');await page.locator('#motorDirection1').selectOption('2');
  await expect(page.locator('[data-motor-position="1"] .rotor-id')).toHaveText('M1');
  await expect(page.locator('[data-motor-position="1"] .rotor-direction')).toHaveText('CCW');
  await expect(page.locator('[data-motor-position="1"] .rotation-ccw')).toHaveAttribute('visibility','visible');
  await expect(page.locator('#motorLayoutState')).toHaveText('Unsaved preview');
  expect(await page.evaluate(()=>window.serialWrites.length)).toBe(before);
  await page.locator('#saveMotorSettings').click();await expect(page.locator('#motorSettingsStatus')).toContainText('readback verified');
  await page.locator('#motorPosition1').selectOption('4');
  await page.locator('#loadMotorSettings').click();await expect(page.locator('#motorPosition1')).toHaveValue('1');
  await page.locator('#connect').click();await page.locator('#connect').click();
  await expect(page.locator('#motorPosition1')).toHaveValue('1');
  await expect(page.locator('#motorLayoutState')).toHaveText('Stored layout');
});


test('Recovery disables parameter export and keeps firmware maintenance visible',async({page})=>{
  await page.route('**/serial.js',route=>route.fulfill({contentType:'text/javascript',body:`
    export class SerialLink {
      constructor(onLine){this.onLine=onLine;window.serialWrites=[];}
      async connect(){return {usbVendorId:0x303a};}
      async send(value){window.serialWrites.push(value);if(value.includes('q'))this.onLine('IMU STOP');if(value.includes('sys boot'))this.onLine('Running=factory Boot=factory');}
      async disconnect(){}
    }
  `}));
  await open(page);await page.locator('#connect').click();
  await expect(page.locator('#backupParameters')).toBeDisabled();
  await expect(page.locator('#motorStart')).toBeDisabled();
  await expect(page.locator('#tab-firmware')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#connect')).toContainText('Disconnect');
  expect((await page.evaluate(()=>window.serialWrites)).some(v=>v.includes('@CFG1')||v.includes('@DATA1'))).toBe(false);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`/tmp/mini-drone-recovery-${width}.png`,fullPage:true});
  }
});
