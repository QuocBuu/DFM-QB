import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSample,LineBuffer,Attitude,euler,fromEuler,rotate,inverse,gyroBias} from '../dist/telemetry.js';
const line='IMU n=25 a[g]=-0.2255,0.5664,0.7670 g[dps]=-1.435,-0.137,-0.046 T[C]=40.79 m[uT]=-33.90,142.05,52.50';
const sample=(n,accel=[0,0,1],gyro=[0,0,0])=>({n,accel,gyro,temp:25,mag:null});
const near=(a,b,tolerance=.1)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should be near ${b}`);
test('parse actual firmware values, NA and signed numbers; reject damaged or non-finite input',()=>{
 const v=parseSample(line+'\r');assert.equal(v.n,25);assert.deepEqual(v.accel,[-.2255,.5664,.767]);assert.deepEqual(v.mag,[-33.9,142.05,52.5]);
 assert.equal(parseSample(line.replace(/m\[uT\]=.*/,'m[uT]=NA')).mag,null);
 for(const s of [line+' trailing',line.replace('0.7670','NaN'),'IMU STOP','IMU ERROR read=ESP_FAIL',line.replace('n=25','n=9007199254740999')])assert.equal(parseSample(s),null);
});
test('serial chunks can split anywhere; oversized line is discarded until next newline',()=>{
 const b=new LineBuffer();assert.deepEqual(b.push(line.slice(0,20)),[]);assert.deepEqual(b.push(line.slice(20)+'\r\nIMU ST'),[line]);assert.deepEqual(b.push('OP\n'),['IMU STOP']);
 assert.deepEqual(b.push('x'.repeat(5000)+'\n'+line+'\n'),[line]);
});
test('known roll/pitch gravity attitudes and inverted board are recovered',()=>{
 for(const [roll,pitch] of [[0,0],[30,0],[-45,0],[0,40],[25,-30],[180,0]]){
  const a=new Attitude();a.update(sample(1,rotate(inverse(fromEuler(roll,pitch,0)),[0,0,1])),0);
  const angles=euler(a.q);near(Math.abs(angles.roll),Math.abs(roll));near(angles.pitch,pitch);
 }
});
test('integrate yaw by sample count even when samples arrive together',()=>{
 const a=new Attitude();a.update(sample(1),0);for(let n=2;n<=11;n++)a.update(sample(n,[0,0,1],[0,0,90]),100);
 near(euler(a.q).yaw,90);assert.equal(a.update(sample(11),100),false);
 a.zero();near(euler(a.display).yaw,0);
});
test('restarted stream or data gap resets integration; magnitude remains normalized',()=>{
 const a=new Attitude();a.update(sample(1),0);a.update(sample(2,[0,0,1],[0,0,90]),100);near(euler(a.q).yaw,9);
 a.update(sample(1),200);near(euler(a.q).yaw,0);
 a.update(sample(2,[0,0,1],[0,0,90]),2000);near(euler(a.q).yaw,0);
 for(let n=3;n<1000;n++)a.update(sample(n,[0,0,1],[20,30,40]),2000+n*100);near(Math.hypot(...a.q),1,.00001);
});
test('mount transform and stationary gyro compensation',()=>{
 const a=new Attitude();a.setMount(90,false);a.update(sample(1,[0,-.5,Math.sqrt(.75)]),0);near(euler(a.q).pitch,-30);
 const samples=Array.from({length:30},(_,i)=>sample(i,[0,0,1],[1.5,-.1,.05]));
 const bias=gyroBias(samples);near(bias[0],1.5,.00001);
 assert.throws(()=>gyroBias(samples.slice(0,4)));
 samples[15].accel=[0,1,0];assert.throws(()=>gyroBias(samples),/board is moving/);
});
