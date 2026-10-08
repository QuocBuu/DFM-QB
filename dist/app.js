import { Attitude,parseSample,gyroBias,fromEuler,rotate,inverse,euler } from './telemetry.js';
import { SerialLink } from './serial.js';
import { chart } from './charts.js';
const $=id=>document.getElementById(id);
const attitude=new Attitude();
let view=null;
try {const {DroneView}=await import('./drone.js');view=new DroneView($('viewport'));}
catch(error){$('viewportHint').innerHTML='<span>KHÔNG KHỞI TẠO ĐƯỢC 3D</span><small>Bật tăng tốc đồ họa trong trình duyệt. Số liệu IMU vẫn sử dụng được.</small>';console.error(error);}
let connected=false,connecting=false,streaming=false,demo=false,closing=false,lastSampleAt=0,lastSample=null,history=[],logLines=[],total=0,calibration=null,pendingStart=0,gotStop=false;
let demoTimer=null,demoN=0,demoStart=0;
const link=new SerialLink(onLine,message=>{
  connected=false;streaming=false;connecting=false;calibration=null;pendingStart=0;
  messageNotice(`Đã mất kết nối. ${message} Cắm lại board rồi nhấn Kết nối.`, 'error');log(`SYS · ${message}`);updateControls();
});
function messageNotice(message,kind=''){const n=$('notice');n.textContent=message;n.className=`notice ${kind}`;}
function log(line){logLines.push(`${new Date().toLocaleTimeString('vi-VN')}  ${line}`);if(logLines.length>500)logLines.shift();$('log').textContent=logLines.join('\n');$('log').scrollTop=$('log').scrollHeight;}
function clearData(){attitude.reset();history=[];total=0;lastSampleAt=0;lastSample=null;calibration=null;pendingStart=0;gotStop=false;$('calibrationStatus').textContent='Đặt board đứng yên trong 3 giây.';}
function clearSession(){clearData();attitude.bias=[0,0,0];}
function updateControls(){
  $('connect').disabled=connecting||closing;
  $('connect').innerHTML=connecting?'Đang kết nối…':closing?'Đang ngắt…':connected?'↔ Ngắt kết nối':'↔ Kết nối USB / UART';
  $('demo').disabled=connected||connecting||closing;
  $('demo').innerHTML=demo?'■ Dừng mô phỏng':'▷ Xem mô phỏng';
  $('stream').disabled=!connected||connecting||closing;
  $('stream').innerHTML=streaming?'Ⅱ Dừng đọc':'▶ Bắt đầu đọc';
  const fresh=lastSampleAt>0&&performance.now()-lastSampleAt<1500;
  $('zero').disabled=!fresh||(!streaming&&!demo);
  $('calibrate').disabled=!connected||!streaming||!!calibration||!fresh;
  $('mount').disabled=!!calibration;$('flipped').disabled=!!calibration;
  const badge=$('connectionBadge');badge.className=`status ${demo?'demo':connected?'live':''}`;
  badge.innerHTML=`<i></i>${demo?'DỮ LIỆU MÔ PHỎNG':connected?'ĐÃ KẾT NỐI':'CHƯA KẾT NỐI'}`;
  $('source').textContent=demo?'DEMO / KHÔNG PHẢI BOARD':connected?(streaming?(fresh?'LIVE / USB SERIAL':'CHỜ DỮ LIỆU'):'PAUSED'):'OFFLINE';
  $('source').className=`source ${demo?'demo':connected&&streaming&&fresh?'live':''}`;
  $('dataDot').className=fresh&&(demo||streaming)?'live':'';
  document.body.classList.toggle('demo-mode',demo);
  if(view){$('viewportHint').classList.toggle('hidden',fresh&&(streaming||demo));if(!fresh||(!streaming&&!demo))$('viewportHint').innerHTML=`<span>${streaming?'CHƯA CÓ DỮ LIỆU MỚI':connected?'ĐÃ TẠM DỪNG':'ĐANG CHỜ BOARD'}</span><small>${lastSample?'Mô hình giữ tư thế mẫu cuối':'Kết nối để xem chuyển động trực tiếp'}</small>`;}
}
function onLine(line){
  const sample=parseSample(line);
  if(sample){if(!connected||gotStop)return;streaming=true;pendingStart=0;accept(sample,false);log(line);return;}
  log(line);
  if(line.startsWith('IMU START')){streaming=true;gotStop=false;pendingStart=performance.now();const id=line.match(/address=(0x[\da-f]+)/i);if(id)$('imuIdentity').innerHTML=`I²C <b>${id[1]}</b>`;}
  if(line.startsWith('IMU STOP')){streaming=false;gotStop=true;pendingStart=0;calibration=null;}
  if(line.startsWith('IMU ERROR')){streaming=false;pendingStart=0;calibration=null;messageNotice(line+' · Kiểm tra board rồi nhấn Bắt đầu đọc để thử lại.','error');}
  if(line.includes('Running=factory')||line.startsWith('Recovery ')){streaming=false;pendingStart=0;messageNotice('Board đang ở Recovery. Chuyển sang Flight bằng lệnh BOOT_MAIN trong serial terminal rồi kết nối lại.','error');}
  updateControls();
}
function accept(sample,simulated){
  const now=performance.now();
  if(!attitude.update(sample,now))return;
  lastSampleAt=now;lastSample=sample;total++;
  if(!simulated && $('notice').classList.contains('error')) messageNotice('Đã nhận lại dữ liệu IMU từ board.');
  const angles=euler(attitude.display);
  history.push({at:now,accel:sample.accel,gyro:sample.gyro,angles:[angles.roll,angles.pitch,angles.yaw]});
  while(history.length>400||history[0]?.at<now-31000)history.shift();
  if(calibration&&!simulated){
    calibration.push(sample);$('calibrationStatus').textContent=`Giữ yên board… ${calibration.length}/30 mẫu`;
    if(calibration.length>=30){try{attitude.bias=gyroBias(calibration);attitude.reset();history=[];$('calibrationStatus').textContent='Đã bù lệch gyro trong phiên này.';log(`SYS · Gyro bias [dps]: ${attitude.bias.map(v=>v.toFixed(3)).join(', ')}`);}catch(error){$('calibrationStatus').textContent=error.message;}calibration=null;}
  }
  showSample(sample,angles);updateControls();
}
function showSample(sample,angles){
  for(const key of ['roll','pitch','yaw']){const value=angles[key];$(key).innerHTML=`${value.toFixed(1)}<small>°</small>`;const extent=Math.min(50,Math.abs(value)/180*50);$(key+'Meter').style.width=extent+'%';$(key+'Meter').style.left=(value<0?50-extent:50)+'%';}
  for(const name of ['accel','gyro','mag']){const values=sample[name];$(name).querySelectorAll('b').forEach((n,i)=>n.textContent=values?values[i].toFixed(name==='accel'?3:2):'—');}
  $('temperature').textContent=`${sample.temp.toFixed(1)} °C`;
  $('sampleCount').textContent=`${total.toLocaleString('vi-VN')} mẫu`;
}
async function begin(){
  calibration=null;gotStop=false;attitude.reset();history=[];
  await link.send('i');streaming=true;pendingStart=performance.now();
  messageNotice('Đang đọc board · Xoay nhẹ drone để xem tư thế. Có thể đặt mốc tư thế và bù lệch gyro khi board đứng yên.');updateControls();
}
async function stop(){await link.send('q');streaming=false;pendingStart=0;calibration=null;messageNotice('Đã dừng đọc. Mô hình giữ mẫu cuối; nhấn Bắt đầu đọc để tiếp tục.');updateControls();}
function endDemo(){clearInterval(demoTimer);demoTimer=null;demo=false;streaming=false;clearSession();clearValues();view?.setQuaternion([0,0,0,1]);messageNotice('Cắm ESP32-C3 và chọn Kết nối USB / UART. Đóng Serial Monitor nếu đang mở.');updateControls();}
function clearValues(){for(const key of ['roll','pitch','yaw']){$(key).innerHTML='—<small>°</small>';$(key+'Meter').style.width='0';}for(const key of ['accel','gyro','mag'])$(key).querySelectorAll('b').forEach(x=>x.textContent='—');$('temperature').textContent='— °C';$('sampleCount').textContent='0 mẫu';$('imuIdentity').innerHTML='ID <b>—</b>';}
$('connect').addEventListener('click',async()=>{
  if(connected){closing=true;updateControls();try{await link.disconnect();}catch(error){log(`SYS · ${error.message}`);}finally{connected=false;streaming=false;closing=false;calibration=null;messageNotice('Đã ngắt kết nối. Cổng serial đã được trả lại cho ứng dụng khác.');updateControls();}return;}
  if(demo)endDemo();connecting=true;updateControls();
  try{const info=await link.connect();connected=true;clearSession();clearValues();log(`SYS · Serial open 115200 8N1 / USB vendor ${info.usbVendorId?.toString(16)??'UART'}`);await link.send('q');await new Promise(r=>setTimeout(r,180));await begin();}
  catch(error){if(link.port)await link.disconnect().catch(()=>{});connected=false;messageNotice(error.name==='NotFoundError'?'Chưa chọn cổng. Nhấn Kết nối để chọn ESP32-C3 hoặc USB-UART.':`Không kết nối được: ${error.message} · Đóng các terminal đang giữ cổng và thử lại.`,'error');}
  finally{connecting=false;updateControls();}
});
$('stream').addEventListener('click',()=>{if(!connected)return;const op=streaming?stop():begin();op.catch(error=>messageNotice(error.message,'error'));});
$('demo').addEventListener('click',()=>{
  if(demo){endDemo();return;}clearSession();clearValues();demo=true;demoN=0;demoStart=performance.now();
  messageNotice('ĐANG MÔ PHỎNG · Dữ liệu tạo trên web để xem thử giao diện, không phải số đo từ ESP32-C3.','demo');
  log('DEMO · Bắt đầu dữ liệu mô phỏng.');
  demoTimer=setInterval(()=>{
    const t=(performance.now()-demoStart)/1000;
    const angles=[Math.sin(t*.55)*23,Math.sin(t*.38)*17,Math.sin(t*.2)*65];
    const [r,p]=angles.map(v=>v*Math.PI/180);
    const derivatives=[Math.cos(t*.55)*23*.55,Math.cos(t*.38)*17*.38,Math.cos(t*.2)*65*.2];
    const [rd,pd,yd]=derivatives;
    const gyro=[rd-yd*Math.sin(p),pd*Math.cos(r)+yd*Math.sin(r)*Math.cos(p),-pd*Math.sin(r)+yd*Math.cos(r)*Math.cos(p)];
    const q=fromEuler(...angles),sample={n:++demoN,accel:rotate(inverse(q),[0,0,1]),gyro,temp:32.4,mag:rotate(inverse(q),[22,4,-38])};
    accept(sample,true);if(demoN%10===0)log(`DEMO · Roll ${angles[0].toFixed(1)}° / Pitch ${angles[1].toFixed(1)}° / Yaw ${angles[2].toFixed(1)}°`);
  },100);updateControls();
});
$('zero').addEventListener('click',()=>{attitude.zero();history=[];if(lastSample)showSample(lastSample,euler(attitude.display));log('SYS · Đã đặt tư thế hiện tại làm mốc 0°.');});
$('calibrate').addEventListener('click',()=>{calibration=[];$('calibrationStatus').textContent='Giữ board đứng yên… 0/30 mẫu';updateControls();});
function mountChanged(){attitude.setMount(Number($('mount').value),$('flipped').checked);history=[];log('SYS · Đã đổi hướng lắp IMU; mốc tư thế được reset.');}
$('mount').addEventListener('change',mountChanged);$('flipped').addEventListener('change',mountChanged);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view?.setView(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b===button));});
$('clear').addEventListener('click',()=>{logLines=[];$('log').textContent='Log đã được xóa.';});
$('export').addEventListener('click',()=>{const blob=new Blob([logLines.join('\n')+'\n'],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`mini-drone-${demo?'demo':'serial'}-${new Date().toISOString().replaceAll(':','-')}.log`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('keydown',e=>{if(e.repeat||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;if(connected&&(e.key==='i'||e.key==='q')){e.preventDefault();(e.key==='i'?begin():stop()).catch(error=>messageNotice(error.message,'error'));}});
window.addEventListener('beforeunload',()=>{if(connected)link.send('q').catch(()=>{});});
if(!navigator.serial||!isSecureContext){messageNotice('Trình duyệt này chưa dùng được Web Serial. Mở trang trong Chrome/Edge trên localhost hoặc HTTPS; vẫn có thể thử mô phỏng.','error');$('connect').title='Cần Chrome/Edge và localhost hoặc HTTPS';}
let previousFrame=performance.now(),lastChart=0;
function frame(now){
  view?.setQuaternion(attitude.display);view?.render(Math.min(.1,(now-previousFrame)/1000));previousFrame=now;
  if(now-lastChart>100){
    const recent=history.filter(x=>now-x.at<2000),rate=recent.length>1?(recent.length-1)/((recent.at(-1).at-recent[0].at)/1000):0;
    const fresh=lastSampleAt>0&&now-lastSampleAt<1500;
    $('rate').innerHTML=`${fresh&&(streaming||demo)?Math.min(99,rate).toFixed(1):'—'}<small>Hz</small>`;
    $('sampleState').textContent=demo?'Mô phỏng':!connected?'Chưa kết nối':!streaming?'Đã dừng':fresh?'Đang nhận':'Chờ dữ liệu';
    chart($('accelChart'),history,'accel',{range:Math.max(1.2,...history.flatMap(x=>x.accel.map(Math.abs))),now});
    chart($('gyroChart'),history,'gyro',{range:Math.max(5,...history.flatMap(x=>x.gyro.map(Math.abs))),now});
    chart($('attitudeChart'),history,'angles',{range:180,labels:true,now});
    if(connected&&streaming&&!fresh&&((lastSampleAt&&now-lastSampleAt>1800)||(pendingStart&&now-pendingStart>2500))){calibration=null;messageNotice('Chưa nhận được mẫu IMU mới. Kiểm tra firmware Flight, cáp và nguồn board; nhấn Dừng rồi Bắt đầu để thử lại.','error');}
    lastChart=now;updateControls();
  }
  requestAnimationFrame(frame);
}
updateControls();requestAnimationFrame(frame);
