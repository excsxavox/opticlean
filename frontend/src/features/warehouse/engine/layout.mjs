// Layout model: outline (polygon with rounded corners), racks (furniture) and sections.
// Pure functions only, so the same data drives the 2D editor, the 2D plan and the 3D scene.
export const CELL=0.75, RACK_DEPTH=0.9, MAX_COLS=10, MAX_LEVELS=5, LEVEL_H=0.8, RACK_BASE=0.13, SLAB=0.15;
const EPS=1e-6;

export const letters=n=>{let s='';n++;while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26)}return s};
export const locId=(rack,level,pos)=>`${rack}-${String(level).padStart(2,'0')}-${String(pos).padStart(2,'0')}`;
export const rackOfLoc=id=>String(id).split('-')[0];
export const rackSize=r=>{const w=r.cols*CELL;return r.rot===90?{w:RACK_DEPTH,d:w}:{w,d:RACK_DEPTH}};
export const rackRect=r=>{const {w,d}=rackSize(r);return {x:r.x,y:r.y,w,d}};
export const rackHeight=r=>r.levels*(r.levelHeight||LEVEL_H)+RACK_BASE;
const clone=o=>JSON.parse(JSON.stringify(o));
const EPS_=1e-6;

// A layout is { seq, floors:[floor] }. A floor (planta or entrepiso) has the shape the editor and the
// renderers already understood: outline, racks, sections, docks; plus kind, elevation and clear height.
export function defaultFloor(){
 const rack=(id,name,category,x,y)=>({id,name,category,x,y,rot:0,cols:4,levels:3,capacity:60,levelHeight:LEVEL_H});
 return {
  id:'P1',name:'Planta baja',kind:'floor',elevation:0,height:4.5,
  outline:[{x:0,y:0,r:.6},{x:10.5,y:0,r:.6},{x:10.5,y:8.5,r:.6},{x:0,y:8.5,r:.6}],
  racks:[rack('A','Limpieza y hogar','Hogar',1,1),rack('B','Cuidado del hogar','Hogar',1,3.4),rack('C','Limpieza industrial','Industrial',1,5.8),rack('D','Papel e institucional','Institucional',6,1),rack('E','Institucional','Institucional',6,3.4),rack('F','Higiene y protección','Hospitalaria',6,5.8)],
  sections:[{id:'S1',name:'Zona 1 · Hogar e industrial',color:'#3b9be8',x:.5,y:.2,w:4.2,h:7.1},{id:'S2',name:'Zona 2 · Institucional e higiene',color:'#2fb8a3',x:5.5,y:.2,w:4.5,h:7.1}],
  docks:[{id:'R1',x:4.05,y:7.4,w:2.25,d:.95,label:'Recepción / despacho'}],
  connectors:[]
 };
}
export const defaultLayout=()=>({version:1,seq:6,floors:[defaultFloor()]});
export const allRacks=root=>root.floors.flatMap(f=>f.racks);
export const floorOfRack=(root,id)=>root.floors.find(f=>f.racks.some(r=>r.id===id))||null;
export const allConnectors=root=>root.floors.flatMap(f=>(f.connectors||[]).map(c=>({...c,floor:f.id})));
export const floorsByElevation=root=>[...root.floors].sort((a,b)=>a.elevation-b.elevation);

// ---------- outline geometry ----------
export function bounds(points){
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 const x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);
 return {x:x0,y:y0,w:x1-x0,d:y1-y0};
}
// For each vertex: where the rounded corner starts (a), the corner itself (c) and where it ends (b).
export function corners(points){
 const n=points.length;
 return points.map((p,i)=>{
  const prev=points[(i+n-1)%n],next=points[(i+1)%n],r=Math.max(0,Number(p.r)||0);
  const v1=[prev.x-p.x,prev.y-p.y],v2=[next.x-p.x,next.y-p.y],l1=Math.hypot(...v1),l2=Math.hypot(...v2);
  if(r<=EPS||l1<EPS||l2<EPS)return {a:{x:p.x,y:p.y},c:p,b:{x:p.x,y:p.y},round:false};
  const cos=Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(l1*l2))),ang=Math.acos(cos);
  if(ang<1e-3||Math.PI-ang<1e-3)return {a:{x:p.x,y:p.y},c:p,b:{x:p.x,y:p.y},round:false};
  const d=Math.min(r/Math.tan(ang/2),l1/2,l2/2);
  return {a:{x:p.x+v1[0]/l1*d,y:p.y+v1[1]/l1*d},c:p,b:{x:p.x+v2[0]/l2*d,y:p.y+v2[1]/l2*d},round:true};
 });
}
// Polygon approximating the rounded outline (used for 3D, clipping and containment checks).
export function sampleOutline(points,steps=7){
 const out=[];
 for(const k of corners(points)){
  if(!k.round){out.push({x:k.c.x,y:k.c.y});continue}
  for(let i=0;i<=steps;i++){const t=i/steps,u=1-t;out.push({x:u*u*k.a.x+2*u*t*k.c.x+t*t*k.b.x,y:u*u*k.a.y+2*u*t*k.c.y+t*t*k.b.y})}
 }
 return out;
}
// SVG path (in layout units, then mapped by `map`) with smooth corners.
export function outlinePath(points,map=p=>[p.x,p.y]){
 const f=v=>Math.round(v*10)/10,pt=p=>map(p).map(f).join(' ');let d='';
 corners(points).forEach((k,i)=>{
  d+=(i?'L':'M')+pt(k.a);
  if(k.round)d+=`Q${pt(k.c)} ${pt(k.b)}`;
 });
 return d+'Z';
}
export const signedArea=pts=>pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+(p.x*q.y-q.x*p.y)},0)/2;
export function pointInPolygon(pt,poly){
 let inside=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j];
  if(distToSegment(pt,a,b)<1e-4)return true;
  if((a.y>pt.y)!==(b.y>pt.y)&&pt.x<(b.x-a.x)*(pt.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }
 return inside;
}
function distToSegment(p,a,b){
 const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
 const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
 return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function segmentsCross(a,b,c,d){
 const o=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 const d1=o(a,b,c),d2=o(a,b,d),d3=o(c,d,a),d4=o(c,d,b);
 return ((d1>EPS&&d2<-EPS)||(d1<-EPS&&d2>EPS))&&((d3>EPS&&d4<-EPS)||(d3<-EPS&&d4>EPS));
}
export function selfIntersects(points){
 const n=points.length;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(j===i+1||(i===0&&j===n-1))continue;
  if(segmentsCross(points[i],points[(i+1)%n],points[j],points[(j+1)%n]))return true;
 }
 return false;
}
// Sutherland–Hodgman: clip a polygon with an axis-aligned rectangle (convex clip region).
export function clipToRect(poly,rect){
 const {x,y,w,h}=rect,edges=[
  [p=>p.x>=x-EPS,(a,b)=>({x,y:a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x)})],
  [p=>p.x<=x+w+EPS,(a,b)=>({x:x+w,y:a.y+(b.y-a.y)*(x+w-a.x)/(b.x-a.x)})],
  [p=>p.y>=y-EPS,(a,b)=>({x:a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y),y})],
  [p=>p.y<=y+h+EPS,(a,b)=>({x:a.x+(b.x-a.x)*(y+h-a.y)/(b.y-a.y),y:y+h})]
 ];
 let out=poly;
 for(const [inside,cut] of edges){
  const input=out;out=[];
  input.forEach((cur,i)=>{
   const prev=input[(i+input.length-1)%input.length];
   if(inside(cur)){if(!inside(prev))out.push(cut(prev,cur));out.push(cur)}
   else if(inside(prev))out.push(cut(prev,cur));
  });
  if(!out.length)break;
 }
 return out;
}

// ---------- presets and editing helpers ----------
const r1=v=>Math.round(v*2)/2;
export function presetOutline(kind,w=12,d=9,radius=0){
 w=Math.max(4,w);d=Math.max(4,d);
 const P={
  rect:[[0,0],[w,0],[w,d],[0,d]],
  L:[[0,0],[w,0],[w,r1(d*.5)],[r1(w*.55),r1(d*.5)],[r1(w*.55),d],[0,d]],
  U:[[0,0],[r1(w*.3),0],[r1(w*.3),r1(d*.5)],[r1(w*.7),r1(d*.5)],[r1(w*.7),0],[w,0],[w,d],[0,d]],
  T:[[0,0],[w,0],[w,r1(d*.4)],[r1(w*.65),r1(d*.4)],[r1(w*.65),d],[r1(w*.35),d],[r1(w*.35),r1(d*.4)],[0,r1(d*.4)]]
 }[kind]||[[0,0],[w,0],[w,d],[0,d]];
 return P.map(([x,y])=>({x,y,r:radius}));
}
export function resizeOutline(points,w,d){
 const b=bounds(points),sx=b.w>0?w/b.w:1,sy=b.d>0?d/b.d:1;
 return points.map(p=>({...p,x:Math.round((b.x+(p.x-b.x)*sx)*4)/4,y:Math.round((b.y+(p.y-b.y)*sy)*4)/4}));
}
export function addRack(root,floor,at={x:1,y:1}){
 const used=new Set(allRacks(root).map(r=>r.id));let n=root.seq||0;
 while(used.has(letters(n)))n++;
 const id=letters(n);root.seq=n+1;
 const rack={id,name:`Mueble ${id}`,category:'Hogar',x:at.x,y:at.y,rot:0,cols:4,levels:1,capacity:60,levelHeight:LEVEL_H};
 floor.racks.push(rack);rack.levels=Math.max(1,Math.min(3,maxLevels(root,floor,rack)));return rack;
}
// Headroom above a rack: the floor's own clear height, reduced by any higher slab (floor/entrepiso) over it.
export function limitingFloor(root,floor,rack){
 let best=null;
 const q=rackRect(rack),i=.03,probe=[{x:q.x+q.w/2,y:q.y+q.d/2},{x:q.x+i,y:q.y+i},{x:q.x+q.w-i,y:q.y+i},{x:q.x+q.w-i,y:q.y+q.d-i},{x:q.x+i,y:q.y+q.d-i}];   // inset: touching a slab edge is not being under it
 for(const g of root.floors){
  if(g===floor||g.elevation<=floor.elevation+EPS_)continue;
  const gap=g.elevation-floor.elevation-SLAB;
  if(gap>=floor.height||(best&&gap>=best.gap))continue;
  const poly=g.outline.length>=3?sampleOutline(g.outline):null;
  if(poly&&probe.some(p=>pointInPolygon(p,poly)))best={floor:g,gap:Math.max(0,gap)};
 }
 return best;
}
export function clearance(root,floor,rack){
 const l=limitingFloor(root,floor,rack);
 return l?Math.min(floor.height,l.gap):floor.height;
}
export function maxLevels(root,floor,rack){
 const lh=Number(rack.levelHeight)||LEVEL_H;
 return Math.max(0,Math.min(MAX_LEVELS,Math.floor((clearance(root,floor,rack)-RACK_BASE+1e-9)/lh)));
}
// Stairs / lift linking a floor to another one (placed on both floors; the lower one draws the climb).
export function addConnector(root,floor,at=null){
 const all=root.floors.flatMap(f=>f.connectors||[]);let n=all.length+1;while(all.some(c=>c.id==='C'+n))n++;
 const other=root.floors.find(f=>f!==floor),w=1.2,d=2.4;
 // First free spot (0.5 m grid) inside the outline, clear of racks, docks and other connectors.
 let spot=at;
 if(!spot){
  const bb=bounds(floor.outline),poly=floor.outline.length>=3?sampleOutline(floor.outline):[];
  const free=(x,y)=>{
   const hit=(q)=>x<q.x+q.w-EPS&&q.x<x+w-EPS&&y<q.y+q.d-EPS&&q.y<y+d-EPS;
   return [{x,y},{x:x+w,y},{x:x+w,y:y+d},{x,y:y+d}].every(p=>pointInPolygon(p,poly))
    &&!floor.racks.some(r=>hit(rackRect(r)))&&!(floor.docks||[]).some(k=>hit({x:k.x,y:k.y,w:k.w,d:k.d}))&&!(floor.connectors||[]).some(k=>hit({x:k.x,y:k.y,w:k.w,d:k.d}));
  };
  outer:for(let y=bb.y+.5;y+d<=bb.y+bb.d;y+=.5)for(let x=bb.x+bb.w-w-.5;x>=bb.x;x-=.5)if(free(x,y)){spot={x,y};break outer}
  spot||={x:bb.x+.5,y:bb.y+.5};
 }
 const c={id:'C'+n,kind:'stairs',label:'Escalera',x:spot.x,y:spot.y,w,d,to:other?other.id:''};
 (floor.connectors||=[]).push(c);return c;
}
export function addFloor(root,kind='floor'){
 const g=floorsByElevation(root),ground=root.floors[0],top=g[g.length-1];
 let n=root.floors.length+1;while(root.floors.some(f=>f.id==='P'+n))n++;
 const bb=bounds(ground.outline);
 let f;
 if(kind==='mezzanine'){
  const w=Math.max(4,r1(Math.min(bb.w*.5,8))),d=Math.max(3,r1(Math.min(bb.d*.45,5))),poly=sampleOutline(ground.outline);
  // Pick the spot (1 m grid) inside the ground floor that covers the fewest ground racks.
  let best=null;
  for(let x=bb.x+.5;x+w<=bb.x+bb.w;x+=1)for(let y=bb.y+.5;y+d<=bb.y+bb.d;y+=1){
   if(![{x,y},{x:x+w,y},{x:x+w,y:y+d},{x,y:y+d}].every(p=>pointInPolygon(p,poly)))continue;
   const hit=ground.racks.filter(r=>{const q=rackRect(r);return x<q.x+q.w&&q.x<x+w&&y<q.y+q.d&&q.y<y+d}).length;
   if(!best||hit<best.hit)best={x,y,hit};
  }
  const o=best||{x:bb.x+1,y:bb.y+1};
  f={id:'P'+n,name:`Entrepiso ${root.floors.filter(x=>x.kind==='mezzanine').length+1}`,kind:'mezzanine',elevation:2.8,height:2.2,outline:[{x:o.x,y:o.y,r:0},{x:o.x+w,y:o.y,r:0},{x:o.x+w,y:o.y+d,r:0},{x:o.x,y:o.y+d,r:0}],racks:[],sections:[],docks:[],connectors:[]};
  ground.height=Math.max(ground.height,f.elevation+f.height);
 }else{
  f={id:'P'+n,name:`Planta ${root.floors.filter(x=>x.kind==='floor').length+1}`,kind:'floor',elevation:r1(top.elevation+top.height+SLAB),height:3.5,outline:clone(ground.outline),racks:[],sections:[],docks:[],connectors:[]};
 }
 root.floors.push(f);return f;
}

export function addSection(layout,at={x:1,y:1}){
 let n=layout.sections.length+1;while(layout.sections.some(s=>s.id==='S'+n))n++;
 const colors=['#3b9be8','#2fb8a3','#f0a43c','#8b7be8','#e8647a','#5fae4c'];
 const s={id:'S'+n,name:`Sección ${n}`,color:colors[(n-1)%colors.length],x:at.x,y:at.y,w:4,h:3};
 layout.sections.push(s);return s;
}
export function addDock(layout,at={x:1,y:1}){
 layout.docks||=[];let n=layout.docks.length+1;while(layout.docks.some(d=>d.id==='R'+n))n++;
 const d={id:'R'+n,x:at.x,y:at.y,w:2.25,d:1,label:`Zona ${n}`};layout.docks.push(d);return d;
}
// Shorten a label so it fits a given pixel length at font size fs.
export function fitText(text,len,fs,spacing=.6){
 const t=String(text||'').toUpperCase(),max=Math.max(0,Math.floor(len/(fs*.62+spacing)));
 return t.length<=max?t:max<=2?'':t.slice(0,max-1)+'…';
}
export function sectionOf(layout,rack){
 const r=rackRect(rack),cx=r.x+r.w/2,cy=r.y+r.d/2;
 return layout.sections.find(s=>cx>=s.x&&cx<=s.x+s.w&&cy>=s.y&&cy<=s.y+s.h)||null;
}
export const racksIn=(layout,sectionId)=>layout.racks.filter(r=>sectionOf(layout,r)?.id===sectionId);
export function locationIds(root){
 return allRacks(root).flatMap(r=>Array.from({length:r.levels},(_,l)=>Array.from({length:r.cols},(_,p)=>locId(r.id,l+1,p+1))).flat());
}

// ---------- validation ----------
function validateFloor(root,f,errors,warnings,ids,tag,meta){
 const E=(m,c)=>{errors.push(tag+m);if(c)meta[tag+m]=c},Wn=(m,c)=>{warnings.push(tag+m);if(c)meta[tag+m]=c};
 const pts=f.outline;
 if(!Array.isArray(pts)||pts.length<3)E('El contorno necesita al menos 3 vértices.');
 else if(pts.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))E('El contorno tiene coordenadas inválidas.');
 else if(selfIntersects(pts))E('El contorno se cruza consigo mismo. Mueve los vértices para que sea una figura cerrada simple.');
 else if(Math.abs(signedArea(pts))<(f.kind==='mezzanine'?2:4))E(`El contorno es demasiado pequeño (mínimo ${f.kind==='mezzanine'?2:4} m²).`);
 const outline=errors.some(e=>e.startsWith(tag)&&/contorno/.test(e))?null:sampleOutline(pts);
 for(const r of f.racks){
  const t=`Rack ${r.id||'?'}`;
  if(!r.id||!/^[A-Z]+$/.test(r.id))E(`${t}: el código debe estar formado por letras mayúsculas.`);
  if(ids.has(r.id))E(`${t}: código duplicado.`);ids.add(r.id);
  if(!String(r.name||'').trim())E(`${t}: escribe un nombre.`);
  if(!Number.isInteger(r.cols)||r.cols<1||r.cols>MAX_COLS)E(`${t}: las posiciones por nivel deben estar entre 1 y ${MAX_COLS}.`);
  if(!Number.isInteger(r.levels)||r.levels<1||r.levels>MAX_LEVELS)E(`${t}: los niveles deben estar entre 1 y ${MAX_LEVELS}.`);
  if(!Number.isFinite(r.capacity)||r.capacity<1)E(`${t}: la capacidad por posición debe ser mayor a cero.`);
  if(!(Number(r.levelHeight||LEVEL_H)>=.3&&Number(r.levelHeight||LEVEL_H)<=3))E(`${t}: el alto por nivel debe estar entre 0,3 y 3 m.`);
  if(!(r.rot===0||r.rot===90))E(`${t}: rotación no válida.`);
  if(errors.some(e=>e.startsWith(tag+t+':')))continue;
  const h=rackHeight(r),clear=clearance(root,f,r);
  if(h>clear+1e-6){const m=maxLevels(root,f,r);E(`${t}: mide ${h.toFixed(2).replace('.',',')} m y solo hay ${clear.toFixed(2).replace('.',',')} m de altura libre. ${m>0?`Máximo ${m} nivel${m===1?'':'es'} con ${String(r.levelHeight||LEVEL_H).replace('.',',')} m por nivel.`:'No cabe ni un nivel; sube la altura de la planta o baja el alto por nivel.'}`)}
  if(outline){
   const q=rackRect(r),c=[{x:q.x,y:q.y},{x:q.x+q.w,y:q.y},{x:q.x+q.w,y:q.y+q.d},{x:q.x,y:q.y+q.d}];
   if(!c.every(p=>pointInPolygon(p,outline)))E(`${t} (${r.name}) queda fuera del contorno.`);
  }
 }
 for(let i=0;i<f.racks.length;i++)for(let j=i+1;j<f.racks.length;j++){
  const a=f.racks[i],b=f.racks[j];if(![a.cols,a.rot,b.cols,b.rot].every(v=>v!==undefined))continue;
  const p=rackRect(a),q=rackRect(b);
  if(p.x<q.x+q.w-EPS&&q.x<p.x+p.w-EPS&&p.y<q.y+q.d-EPS&&q.y<p.y+p.d-EPS)E(`Los racks ${a.id} y ${b.id} se superponen.`);
 }
 for(const s of f.sections){
  if(!String(s.name||'').trim())E(`La sección ${s.id} necesita un nombre.`);
  if(!(s.w>=1&&s.h>=1))E(`La sección ${s.name||s.id} es demasiado pequeña (mínimo 1 × 1 m).`);
 }
 if(new Set(f.sections.map(s=>s.id)).size!==f.sections.length)E('Hay secciones con el mismo código.');
 for(const d of f.docks||[]){
  if(!(d.w>=.5&&d.d>=.5))E(`La zona ${d.label||d.id} es demasiado pequeña (mínimo 0,5 × 0,5 m).`);
  const hit=f.racks.find(r=>{const q=rackRect(r);return d.x<q.x+q.w-EPS&&q.x<d.x+d.w-EPS&&d.y<q.y+q.d-EPS&&q.y<d.y+d.d-EPS});
  if(hit)Wn(`La zona ${d.label||d.id} se superpone con el rack ${hit.id}.`);
 }
 for(const c of f.connectors||[]){
  const nm=`${c.kind==='lift'?'El montacargas':'La escalera'} ${c.label||c.id}`;
  if(!(c.w>=.5&&c.d>=.5))E(`${nm} es demasiado pequeño (mínimo 0,5 × 0,5 m).`);
  const tgt=root.floors.find(g=>g.id===c.to);
  if(!tgt||tgt===f)E(`${nm} debe conectar con otra planta.`);
  else if(!(root.floors.some(g=>g!==f&&g.id===c.to&&(g.connectors||[]).some(k=>k.to===f.id))))Wn(`${nm} no tiene su par en ${tgt.name}. Agrega una conexión allí para completar el recorrido.`,{conn:c.id});
  if(outline&&![{x:c.x,y:c.y},{x:c.x+c.w,y:c.y},{x:c.x+c.w,y:c.y+c.d},{x:c.x,y:c.y+c.d}].every(p=>pointInPolygon(p,outline)))E(`${nm} queda fuera del contorno.`);
  const hitR=f.racks.find(r=>{const q=rackRect(r);return c.x<q.x+q.w-EPS&&q.x<c.x+c.w-EPS&&c.y<q.y+q.d-EPS&&q.y<c.y+c.d-EPS});
  if(hitR)E(`${nm} se superpone con el rack ${hitR.id}.`);
 }
 const loose=f.racks.filter(r=>!sectionOf(f,r));
 if(f.sections.length&&loose.length)Wn(`${loose.map(r=>r.id).join(', ')} no está${loose.length>1?'n':''} dentro de ninguna sección. Solo se verá${loose.length>1?'n':''} en la vista 3D completa.`);
}
export function validateLayout(root,lots=[]){
 const errors=[],warnings=[],meta={};
 if(!root||!Array.isArray(root.floors)||!root.floors.length)return {errors:['La estructura de la bodega no es válida.'],warnings,issues:[{level:'error',msg:'La estructura de la bodega no es válida.'}]};
 const [ground]=root.floors,multi=root.floors.length>1;
 if(ground.kind!=='floor'||Math.abs(ground.elevation)>EPS)errors.push('La primera planta debe estar a nivel del suelo (elevación 0).');
 if(new Set(root.floors.map(f=>f.id)).size!==root.floors.length)errors.push('Hay plantas con el mismo código.');
 const ids=new Set();
 for(const f of root.floors){
  const tag=multi?`[${f.name||f.id}] `:'';
  if(![f.sections,f.racks,f.docks].every(Array.isArray)||!Array.isArray(f.outline)){errors.push(tag+'La planta no es válida.');continue}
  if(!String(f.name||'').trim())errors.push(`La planta ${f.id} necesita un nombre.`);
  if(!(f.height>=2&&f.height<=30))errors.push(`${tag}La altura libre debe estar entre 2 y 30 m.`);
  if(f!==ground){
   if(!(f.elevation>=1))errors.push(`${tag}La elevación debe ser de al menos 1 m sobre el suelo.`);
   if(f.kind==='mezzanine'){
    if(f.elevation+f.height>ground.height+1e-6)errors.push(`${tag}Elevación (${f.elevation} m) + altura (${f.height} m) supera la altura de ${ground.name} (${ground.height} m). Sube la altura de la planta baja o baja el entrepiso.`);
    if(ground.outline.length>=3&&f.outline.length>=3){const g=sampleOutline(ground.outline);if(!f.outline.every(p=>pointInPolygon(p,g)))errors.push(`${tag}El entrepiso debe quedar dentro del contorno de ${ground.name}.`)}
   }
  }
  validateFloor(root,f,errors,warnings,ids,tag,meta);
 }
 if(!ids.size&&!errors.length)errors.push('Agrega al menos un mueble (rack) a la bodega.');
 if(!root.floors.some(f=>f.sections.length))warnings.push('Sin secciones: el plano 2D abrirá directamente la bodega completa en 3D.');
 if(!errors.length){
  const valid=new Set(locationIds(root)),orphans=lots.filter(l=>l.qty>0&&!valid.has(l.loc));
  if(orphans.length){
   const where=[...new Set(orphans.map(l=>l.loc))];
   errors.push(`Hay inventario en ubicaciones que desaparecerían (${where.slice(0,6).join(', ')}${where.length>6?'…':''}). Traslada esos lotes antes de quitar o reducir el mueble o la planta.`);
  }
  else{
   const cap=new Map();for(const f of root.floors)for(const r of f.racks)for(let lv=1;lv<=r.levels;lv++)for(let p=1;p<=r.cols;p++)cap.set(locId(r.id,lv,p),r.capacity||60);
   const used=new Map();for(const l of lots)if(l.qty>0)used.set(l.loc,(used.get(l.loc)||0)+l.qty);
   const over=[...used].filter(([id,q])=>q>cap.get(id));
   if(over.length)errors.push(`La capacidad por posición quedaría por debajo del inventario actual (${over.slice(0,6).map(([id,q])=>`${id}: ${q} u. > ${cap.get(id)}`).join(', ')}${over.length>6?'…':''}). Traslada unidades o sube la capacidad.`);
  }
 }
 const rackOf=m=>(m.match(/(?:Rack|rack|Los racks) ([A-Z]+)\b/)||[])[1];
 const floorOf=m=>root.floors.find(f=>m.startsWith(`[${f.name}] `))?.id;
 const mk=level=>m=>({level,msg:m,rack:rackOf(m),floor:floorOf(m),...(meta[m]||{})});
 return {errors,warnings,issues:[...errors.map(mk('error')),...warnings.map(mk('warn'))]};
}

// Racks that need attention in the editor: outside the outline, overlapping, or taller than the headroom.
export function rackIssues(root,f){
 const bad=new Set();
 let outline=null;try{if(f.outline.length>=3&&!selfIntersects(f.outline))outline=sampleOutline(f.outline)}catch{}
 const rs=f.racks.filter(r=>Number.isInteger(r.cols)&&(r.rot===0||r.rot===90));
 for(const r of rs){
  const q=rackRect(r);
  if(outline&&![{x:q.x,y:q.y},{x:q.x+q.w,y:q.y},{x:q.x+q.w,y:q.y+q.d},{x:q.x,y:q.y+q.d}].every(p=>pointInPolygon(p,outline)))bad.add(r.id);
  if(Number.isInteger(r.levels)&&rackHeight(r)>clearance(root,f,r)+1e-6)bad.add(r.id);
 }
 for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
  const p=rackRect(rs[i]),q=rackRect(rs[j]);
  if(p.x<q.x+q.w-EPS&&q.x<p.x+p.w-EPS&&p.y<q.y+q.d-EPS&&q.y<p.y+p.d-EPS){bad.add(rs[i].id);bad.add(rs[j].id)}
 }
 return bad;
}

// Accept stored layouts only if they validate; migrate the old single-floor shape; otherwise use the default.
export function normalizeLayout(raw){
 try{
  const l=clone(raw);
  if(l&&!l.floors&&l.outline){
   const dock=l.dock?[{id:'R1',...l.dock}]:(l.docks||[]);
   l={version:1,seq:l.seq||l.racks.length,floors:[{id:'P1',name:'Planta baja',kind:'floor',elevation:0,height:4.5,outline:l.outline,racks:l.racks,sections:l.sections||[],docks:dock}]};
  }
  for(const f of l?.floors||[]){f.docks||=[];f.connectors||=[];f.sections||=[];f.racks||=[];f.racks.forEach(r=>{r.levelHeight||=LEVEL_H})}
  if(l&&l.version===1&&!validateLayout(l).errors.length)return l;
 }catch{}
 return defaultLayout();
}
