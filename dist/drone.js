import * as THREE from './vendor/three.module.js';
export class DroneView {
  constructor(container) {
    this.container=container; this.target=new THREE.Quaternion(); this.display=new THREE.Quaternion();
    this.scene=new THREE.Scene();
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000,0);container.prepend(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(36,1,.1,100);
    this.azimuth=.72;this.elevation=.57;this.distance=9.9;
    this.scene.add(new THREE.HemisphereLight(0xb7dfe8,0x344b4c,2.5));
    const key=new THREE.DirectionalLight(0xf2f8f7,4);key.position.set(2,7,3);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.bias=-.001;this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x90d3ab,2);rim.position.set(-5,1,-3);this.scene.add(rim);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.28}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-1.18;ground.receiveShadow=true;this.scene.add(ground);
    const grid=new THREE.GridHelper(32,64,0x40565c,0x2b3b43);grid.position.y=-1.19;grid.material.transparent=true;grid.material.opacity=.48;this.scene.add(grid);
    const rings=new THREE.Mesh(new THREE.RingGeometry(2.45,2.46,100),new THREE.MeshBasicMaterial({color:0x617d77,side:THREE.DoubleSide,transparent:true,opacity:.35}));
    rings.rotation.x=-Math.PI/2;rings.position.y=-1.17;this.scene.add(rings);
    // Transform firmware's right-handed X-forward/Y-left/Z-up into Three.js Y-up coordinates.
    this.basis=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(0,-1,0,0,0,0,1,0,-1,0,0,0,0,0,0,1));
    this.drone=new THREE.Group();this.scene.add(this.drone);this.buildDrone();
    this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(container);this.fit();
    this.drag=null;
    const canvas=this.renderer.domElement;
    canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.azimuth-=(e.clientX-this.drag[0])*.007;this.elevation=Math.max(-.3,Math.min(1.52,this.elevation+(e.clientY-this.drag[1])*.005));this.drag=[e.clientX,e.clientY];this.positionCamera();});
    canvas.addEventListener('pointerup',()=>this.drag=null);canvas.addEventListener('pointercancel',()=>this.drag=null);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(5.5,Math.min(17,this.distance+e.deltaY*.009));this.positionCamera();},{passive:false});
    this.positionCamera();
  }
  buildDrone() {
    const material=(color,metalness=.4,roughness=.5)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
    const carbon=material(0x303b42,.65,.6),edge=material(0x62757b,.7,.35),dark=material(0x1b252b,.55,.4),silver=material(0xaebfbd,.8,.24),mint=material(0x95cdb0,.25,.45),orange=material(0xeb976c,.3,.4);
    const add=(geometry,mat,pos,rotation)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(...pos);if(rotation)mesh.rotation.set(...rotation);mesh.castShadow=true;mesh.receiveShadow=true;this.drone.add(mesh);return mesh;};
    const box=(dims,pos,mat=carbon,angle=0)=>add(new THREE.BoxGeometry(...dims),mat,pos,[0,0,angle]);
    const cylinder=(radius,height,pos,mat)=>add(new THREE.CylinderGeometry(radius,radius,height,32),mat,pos,[Math.PI/2,0,0]);
    // Two carbon-fibre arms, center plates, spacers and flight controller.
    box([3.55,.18,.13],[0,0,-.02],carbon,Math.PI/4);box([3.55,.18,.13],[0,0,-.02],carbon,-Math.PI/4);
    box([1.2,.74,.09],[0,0,.08],carbon);box([1.36,.82,.07],[0,0,.39],carbon);
    for(const x of [-.48,.48]) for(const y of [-.29,.29]){cylinder(.035,.3,[x,y,.24],silver);cylinder(.056,.02,[x,y,.44],silver);}
    box([.67,.6,.1],[0,0,.22],material(0x365b48));box([.24,.24,.06],[0,0,.31],dark);
    box([.68,.45,.17],[-.12,0,.51],material(0x53616a));box([.11,.52,.19],[-.12,0,.52],dark);
    box([.16,.32,.05],[.48,0,.46],mint);
    // Front camera housing faces +X; orange orientation marker remains visible at a glance.
    box([.23,.34,.25],[.65,0,.2],dark);
    const lens=add(new THREE.CylinderGeometry(.1,.1,.1,24),material(0x1e3840,.8,.12),[.81,0,.2],[0,0,Math.PI/2]);
    lens.castShadow=false;
    const arrow=new THREE.Shape();arrow.moveTo(.36,0);arrow.lineTo(.12,.12);arrow.lineTo(.12,.05);arrow.lineTo(-.09,.05);arrow.lineTo(-.09,-.05);arrow.lineTo(.12,-.05);arrow.lineTo(.12,-.12);arrow.closePath();
    add(new THREE.ShapeGeometry(arrow),new THREE.MeshBasicMaterial({color:0xb4e5c9,side:THREE.DoubleSide}),[.16,0,.434]);
    for(const x of [-1.25,1.25]) for(const y of [-1.25,1.25]) {
      cylinder(.18,.26,[x,y,.1],dark);cylinder(.19,.14,[x,y,.19],x>0?mint:edge);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;box([.019,.045,.1],[x+Math.cos(a)*.18,y+Math.sin(a)*.18,.2],dark,a);}
      const propMaterial=x>0?mint:material(0x677d86,.3,.4);
      const prop=new THREE.Group();prop.position.set(x,y,.34);prop.rotation.z=(x*y>0?.45:-.45);
      for(const sign of [-1,1]) {const blade=new THREE.Mesh(new THREE.SphereGeometry(1,24,12),propMaterial);blade.scale.set(.55,.105,.018);blade.position.x=sign*.34;blade.rotation.z=.1;blade.castShadow=true;prop.add(blade);}
      this.drone.add(prop);cylinder(.07,.09,[x,y,.36],silver);
      cylinder(.06,.31,[x,y,-.22],dark);
      const led=add(new THREE.SphereGeometry(.025,10,8),new THREE.MeshBasicMaterial({color:x>0?0xaaf4bd:0xff9d76}),[x,y,.29]);led.castShadow=false;
    }
    // Rear antenna, deliberately no propeller animation: this dashboard never drives motors.
    box([.035,.035,.48],[-.65,0,.62],dark);add(new THREE.SphereGeometry(.08,16,12),orange,[-.65,0,.88]);
    const axes=new THREE.AxesHelper(.7);axes.position.set(0,0,.66);axes.material.transparent=true;axes.material.opacity=.65;this.drone.add(axes);
  }
  fit(){const w=this.container.clientWidth,h=this.container.clientHeight;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  positionCamera(){const d=this.distance;this.camera.position.set(d*Math.cos(this.elevation)*Math.sin(this.azimuth),d*Math.sin(this.elevation),d*Math.cos(this.elevation)*Math.cos(this.azimuth));this.camera.lookAt(0,-.1,0);}
  setView(view){this.distance=9.9;if(view==='top'){this.azimuth=0;this.elevation=Math.PI/2-.001;}else if(view==='front'){this.azimuth=Math.PI;this.elevation=.1;}else{this.azimuth=.72;this.elevation=.57;}this.positionCamera();}
  setQuaternion(q){this.target.fromArray(q);}
  render(dt){this.display.slerp(this.target,1-Math.exp(-18*dt));this.drone.quaternion.copy(this.basis).multiply(this.display);this.renderer.render(this.scene,this.camera);}
}
