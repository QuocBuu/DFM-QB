const COLORS=['#ed977d','#b2d985','#86b4ed'];
export function chart(canvas,history,field,{range=1,labels=false,now=performance.now()}={}) {
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,2);
  const w=rect.width,h=rect.height;
  if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
  const c=canvas.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,w,h);
  const left=labels?35:0,right=w-2,top=7,bottom=h-8;
  c.strokeStyle='#293940';c.lineWidth=1;c.font='8px Consolas,monospace';c.fillStyle='#64808d';
  for(let i=0;i<3;i++){const y=top+(bottom-top)*i/2;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();if(labels)c.fillText(`${Math.round(range*(1-i))}°`,0,y+3);}
  for(let i=0;i<7;i++){const x=left+(right-left)*i/6;c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();}
  c.save();c.beginPath();c.rect(left,top,right-left,bottom-top);c.clip();
  for(let axis=0;axis<3;axis++){
    c.strokeStyle=COLORS[axis];c.lineWidth=1.35;c.beginPath();let prev=null;
    for(const point of history){if(now-point.at>30000)continue;const value=point[field]?.[axis];if(value===undefined||!Number.isFinite(value))continue;
      const x=right-(now-point.at)/30000*(right-left),y=top+(1-value/range)*(bottom-top)/2;
      if(!prev||point.at-prev.at>1200||(field==='angles'&&Math.abs(value-prev.value)>180))c.moveTo(x,y);else c.lineTo(x,y);prev={at:point.at,value};
    }c.stroke();
  }c.restore();
}
