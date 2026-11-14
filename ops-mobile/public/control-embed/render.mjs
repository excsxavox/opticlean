// SVG renderers driven by the layout: 2D plan, isometric 3D scene (whole warehouse or one section) and rack elevation.
import {CELL,RACK_DEPTH,LEVEL_H,SLAB,fitText,bounds,sampleOutline,outlinePath,clipToRect,signedArea,rackRect,rackHeight,sectionOf,locId,floorsByElevation,allRacks} from './layout.mjs?v=20261109a';

const W=820,H=450,r1=v=>Math.round(v*10)/10;
const pts=a=>a.map(p=>p.map(r1).join(',')).join(' ');
const poly=(a,fill,stroke='#b9cfdf',extra='')=>`<polygon points="${pts(a)}" fill="${fill}" stroke="${stroke}" stroke-width=".75" ${extra}/>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------- 2D plan of the whole warehouse ----------
export function fitPlan(layout,{pad=34,top=14}={}){
 const bb=bounds(layout.outline);
 const s=Math.min((W-2*pad)/bb.w,(H-2*pad-top)/bb.d);
 return {s,ox:(W-bb.w*s)/2-bb.x*s,oy:(H-bb.d*s)/2-bb.y*s+top/2,bb};
}
export function plan2D(layout,o={}){
 const v=fitPlan(layout),X=x=>v.ox+x*v.s,Y=y=>v.oy+y*v.s,map=p=>[X(p.x),Y(p.y)];
 const path=outlinePath(layout.outline,map);
 const ratioFill=q=>q<=0?'#f6f9fc':q<.5?'#d3e6f3':q<.8?'#a9cde6':'#7fb3da';
 const sections=layout.sections.map(s=>{
  const st=o.sectionStats?.(s.id)||'';
  return `<g class="map-section" data-action="open-section" data-section="${esc(s.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(s.name)} en 3D"><rect x="${r1(X(s.x))}" y="${r1(Y(s.y))}" width="${r1(s.w*v.s)}" height="${r1(s.h*v.s)}" rx="6" fill="${esc(s.color)}" fill-opacity=".1" stroke="${esc(s.color)}" stroke-opacity=".75" stroke-width="1.4" stroke-dasharray="6 4"/><text x="${r1(X(s.x)+9)}" y="${r1(Y(s.y)+17)}" font-size="11" font-weight="650" fill="#37627f" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(s.name)}</text><text x="${r1(X(s.x)+9)}" y="${r1(Y(s.y)+30)}" font-size="9" fill="#7897b0" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(st)}</text><text x="${r1(X(s.x+s.w)-9)}" y="${r1(Y(s.y+s.h)-9)}" text-anchor="end" font-size="9" font-weight="600" fill="${esc(s.color)}">Abrir en 3D →</text></g>`;
 }).join('');
 const racks=layout.racks.map(r=>{
  const q=rackRect(r),sec=sectionOf(layout,r),x=X(q.x),y=Y(q.y),w=q.w*v.s,h=q.d*v.s,occ=o.rackOccupancy?.(r.id)||{used:0,total:1};
  const sel=o.selectedRack===r.id,hit=o.matches?.(r.id),dim=o.searching&&!hit;
  const note=o.rackNote?.(r.id)||'',fill=hit?'#64c6b5':(o.rackFill?.(r.id)||ratioFill(occ.used/occ.total));
  const divs=Array.from({length:(r.rot===90?r.cols:r.cols)-1},(_,i)=>r.rot===90?`<path d="M${r1(x)} ${r1(y+(i+1)*CELL*v.s)}h${r1(w)}" stroke="#ffffff99" stroke-width=".8"/>`:`<path d="M${r1(x+(i+1)*CELL*v.s)} ${r1(y)}v${r1(h)}" stroke="#ffffff99" stroke-width=".8"/>`).join('');
  const action=sec?`data-action="open-section" data-section="${esc(sec.id)}" data-rack="${esc(r.id)}"`:`data-action="select-rack" data-rack="${esc(r.id)}"`;
  return `<g class="map-section" ${action} tabindex="0" role="button" aria-label="Rack ${esc(r.id)}, ${esc(r.name)}, ${occ.used} de ${occ.total} posiciones ocupadas" opacity="${dim?.35:1}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="2.5" fill="${fill}" stroke="${sel?'#1795f5':'#8fb2cc'}" stroke-width="${sel?2.6:1}"/>${divs}${note&&w>=64?`<text x="${r1(x+7)}" y="${r1(y+h/2+4)}" font-size="11" font-weight="700" fill="#3f6989" pointer-events="none">${esc(r.id)}</text><text x="${r1(x+w-6)}" y="${r1(y+h/2+3.5)}" text-anchor="end" font-size="9.5" font-weight="600" fill="#3f6989" pointer-events="none">${esc(note)}</text>`:Math.min(w,h)>=15?`<text x="${r1(x+w/2)}" y="${r1(y+h/2+3.5)}" text-anchor="middle" font-size="${Math.min(11,Math.max(8,Math.min(w,h)*.5))}" font-weight="700" fill="#3f6989" pointer-events="none">${esc(r.id)}</text>`:''}</g>`;
 }).join('');
 const d=(layout.docks||[]).map(k=>{const x=X(k.x),y=Y(k.y),w=k.w*v.s,h=k.d*v.s,tall=h>w*1.2,fs=9,cx=x+w/2,cy=y+h/2;return `<g><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="4" fill="#e8f2fd" stroke="#a9cdea"/><text x="${r1(cx)}" y="${r1(cy+3)}" text-anchor="middle" font-size="${fs}" fill="#6f98b8" letter-spacing=".6"${tall?` transform="rotate(-90 ${r1(cx)} ${r1(cy)})"`:''}>${esc(fitText(k.label||'RECEPCIÓN',(tall?h:w)-8,fs))}</text></g>`}).join('');
 const cs=(layout.connectors||[]).map(c=>{const x=X(c.x),y=Y(c.y),w=c.w*v.s,h=c.d*v.s,tall=h>w*1.2,cx=x+w/2,cy=y+h/2,tn=o.floorName?.(c.to)||'',txt=fitText(`${c.kind==='lift'?'Montacargas':'Escalera'}${tn?' → '+tn:''}`,(tall?h:w)-6,8);return `<g><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="#f1ecfc" stroke="#8b7be8" stroke-width="1.3"/><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="url(#connHatch)"/><text x="${r1(cx)}" y="${r1(cy+3)}" text-anchor="middle" font-size="8" fill="#5b4fb5" font-weight="600" paint-order="stroke" stroke="#f1ecfc" stroke-width="2.5"${tall?` transform="rotate(-90 ${r1(cx)} ${r1(cy)})"`:''}>${esc(txt)}</text></g>`}).join('');
 return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Plano 2D de la bodega. Selecciona una sección para abrirla en 3D"><defs><pattern id="planGrid" width="${r1(v.s)}" height="${r1(v.s)}" patternUnits="userSpaceOnUse" patternTransform="translate(${r1(v.ox)} ${r1(v.oy)})"><path d="M${r1(v.s)} 0H0V${r1(v.s)}" fill="none" stroke="#e4ecf3" stroke-width=".6"/></pattern><pattern id="connHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" stroke="#8b7be866" stroke-width="2"/></pattern><clipPath id="planClip"><path d="${path}"/></clipPath></defs><path d="${path}" fill="#fbfdff" stroke="none"/><path d="${path}" fill="url(#planGrid)" stroke="none"/><g clip-path="url(#planClip)">${sections}</g><path d="${path}" fill="none" stroke="#c4d6e4" stroke-width="3"/>${d}${cs}${racks}</svg>`;
}

// ---------- isometric 3D ----------
function projector(triples,{a=37,b=19,c=42}={}){
 const raw=(x,y,z=0)=>[(x-y)*a,(x+y)*b-z*c];
 const all=triples.map(t=>raw(...t));
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
 const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
 const k=Math.min((W-56)/(x1-x0||1),(H-64)/(y1-y0||1),2.2);
 const ox=(W-(x1-x0)*k)/2-x0*k,oy=(H-(y1-y0)*k)/2-y0*k+6;
 const P=(x,y,z=0)=>{const q=raw(x,y,z);return [ox+q[0]*k,oy+q[1]*k]};
 P.k=k;return P;
}
// root: the layout. o.floor: a floor id (one planta/entrepiso) or '*' for all of them stacked by elevation.
export function iso3D(root,o={}){
 const ordered=floorsByElevation(root);
 const single=o.floor&&o.floor!=='*'?ordered.find(f=>f.id===o.floor)||ordered[0]:null;
 const ghostMode=!!single&&!o.section&&o.ghost!==false;   // other floors stay visible as faint context
 const floors=single&&!ghostMode?[single]:ordered;
 const isGhost=f=>!!single&&f!==single;
 const section=single&&o.section?single.sections.find(s=>s.id===o.section):null;
 const lvl=o.level??'all',sel=o.selectedLoc||'',selRack=sel.split('-')[0];
 const interAll=o.interactive!==false,uid=o.uid||'m';
 // geometry per floor
 const info=floors.map(f=>{
  const outline=sampleOutline(f.outline);
  let floor=section?clipToRect(outline,section):outline;
  if(floor.length<3)floor=section?[{x:section.x,y:section.y},{x:section.x+section.w,y:section.y},{x:section.x+section.w,y:section.y+section.h},{x:section.x,y:section.y+section.h}]:outline;
  const visible=f.racks.filter(r=>!section||sectionOf(f,r)?.id===section.id);
  return {f,outline,floor,visible,top:Math.max(2.6,...visible.map(r=>rackHeight(r)+.15))};
 });
 const PPbase=projector(info.flatMap(i=>[...i.floor.map(p=>[p.x,p.y,i.f.elevation-(i.f.elevation?SLAB:0)]),...i.floor.map(p=>[p.x,p.y,i.f.elevation+i.top]),...(i.f.connectors||[]).flatMap(c=>{const t=root.floors.find(g=>g.id===c.to),z=t&&t.elevation>i.f.elevation?t.elevation:i.f.elevation;return [[c.x,c.y,z],[c.x+c.w,c.y+c.d,z]]})]));
 // Camera blend: 0 = straight down (same mapping as the 2D plan), 1 = isometric. Heights only appear as the camera tilts.
 const blend=o.blend??1;
 let PP=PPbase;
 if(blend<1){
  const pl=o.plan||fitPlan(single||ordered[0]);
  PP=(x,y,z=0)=>{const b=PPbase(x,y,z),px=pl.ox+x*pl.s,py=pl.oy+y*pl.s;return [px+(b[0]-px)*blend,py+(b[1]-py)*blend]};
  PP.k=PPbase.k;
 }
 const k=PP.k;
 const drawFloor=({f,outline,floor,visible})=>{
  const inter=interAll&&!isGhost(f);
  const P=(x,y,z=0)=>PP(x,y,z+f.elevation);P.k=k;
  const area=signedArea(floor),n=floor.length;
  const onCut=(p,q)=>section&&[[section.x,'x'],[section.x+section.w,'x'],[section.y,'y'],[section.y+section.h,'y']].some(([v,ax])=>Math.abs(p[ax]-v)<1e-4&&Math.abs(q[ax]-v)<1e-4);
  const edges=floor.map((p,i)=>{const q=floor[(i+1)%n],dx=q.x-p.x,dy=q.y-p.y,nx=area>0?dy:-dy,ny=area>0?-dx:dx;return {p,q,out:nx+ny,cut:onCut(p,q)}}).filter(e=>!e.cut);
  const wall=(e,h,fill,stroke)=>poly([P(e.p.x,e.p.y),P(e.q.x,e.q.y),P(e.q.x,e.q.y,h),P(e.p.x,e.p.y,h)],fill,stroke);
  const back=edges.filter(e=>e.out<-1e-6).map(e=>wall(e,.34,'#e6eef5','#cfdeea')).join('');
  const curbs=edges.filter(e=>e.out>=-1e-6).map(e=>wall(e,.12,'#d3e0ea','#bccfdd')).join('');
  const slab=f.elevation?edges.filter(e=>e.out>=-1e-6).map(e=>poly([P(e.p.x,e.p.y),P(e.q.x,e.q.y),P(e.q.x,e.q.y,-SLAB),P(e.p.x,e.p.y,-SLAB)],'#bdcddb','#a5b9c9')).join(''):'';
  const floorPts=floor.map(p=>P(p.x,p.y)),alpha=!single&&floors.length>1&&f.elevation?(floors.length>2?.3:.5):1;
  const fb=bounds(floor),cid=`floorClip-${uid}-${f.id}`;
  const grid=[...Array(Math.floor(fb.w)+1)].map((_,i)=>{const x=Math.ceil(fb.x)+i;return x<=fb.x+fb.w?`<path d="M${P(x,fb.y)}L${P(x,fb.y+fb.d)}" stroke="#e1eaf1" stroke-width=".55"/>`:''}).join('')+[...Array(Math.floor(fb.d)+1)].map((_,i)=>{const y=Math.ceil(fb.y)+i;return y<=fb.y+fb.d?`<path d="M${P(fb.x,y)}L${P(fb.x+fb.w,y)}" stroke="#e1eaf1" stroke-width=".55"/>`:''}).join('');
  const tints=section?'':f.sections.map(s=>{const c=clipToRect(outline,s);return c.length<3?'':`<g ${inter?`class="map-section" data-action="open-section" data-section="${esc(s.id)}" data-floor="${esc(f.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(s.name)}"`:''}>${poly(c.map(p=>P(p.x,p.y)),s.color,s.color,'fill-opacity=".1" stroke-opacity=".55" stroke-dasharray="4 3"')}</g>`}).join('');
  const rackSVG=r=>{
   const cw=r.cols*CELL,d=RACK_DEPTH,h=rackHeight(r),lh=r.levelHeight||LEVEL_H,bh=lh*.825;
   const Wd=(u,v,z=0)=>r.rot===90?P(r.x+v,r.y+u,z):P(r.x+u,r.y+v,z);
   let s='';
   s+=poly([Wd(-.1,-.07),Wd(cw+.22,-.07),Wd(cw+.32,d+.25),Wd(-.06,d+.25)],'#d5e0e85c','none');
   s+=poly([Wd(cw,0,0),Wd(cw,d,0),Wd(cw,d,h),Wd(cw,0,h)],'#d4e1eb','#93afc5');
   s+=poly([Wd(0,0,h),Wd(cw,0,h),Wd(cw,d,h),Wd(0,d,h)],'#d9e8f3','#98b6cb');
   for(let l=1;l<=r.levels;l++){
    const z=(l-1)*lh+.12;
    s+=poly([Wd(0,d,z-.04),Wd(cw,d,z-.04),Wd(cw,d,z+.035),Wd(0,d,z+.035)],'#7a9db8','#7a9db8');
    for(let pos=1;pos<=r.cols;pos++){
     const u=(pos-1)*CELL+.055,id=locId(r.id,l,pos),qty=o.qtyAt?.(id)||0,lit=lvl==='all'||Number(lvl)===l;
     s+=`<g opacity="${lit?1:.23}">`;
     if(qty){s+=poly([Wd(u,.13,z+bh),Wd(u+.63,.13,z+bh),Wd(u+.63,d-.04,z+bh),Wd(u,d-.04,z+bh)],id===sel?'#67c1ff':'#d2e4f0','#b4cede');s+=poly([Wd(u+.63,.13,z),Wd(u+.63,d-.04,z),Wd(u+.63,d-.04,z+bh),Wd(u+.63,.13,z+bh)],id===sel?'#1484dc':'#a6c6dd','#9abed7')}
     s+=poly([Wd(u,d,z),Wd(u+.63,d,z),Wd(u+.63,d,z+bh),Wd(u,d,z+bh)],o.cellColor?.(id)||'#f6f9fc',id===sel?'#067add':'#a6c4da',inter?o.cellAttrs?.(id)||'':'');
     if(qty){const p1=Wd(u+.18,d+.007,z+bh*.53),p2=Wd(u+.47,d+.007,z+bh*.53);s+=`<path d="M${p1}L${p2}" stroke="${id===sel?'#d6efff':'#f4faff'}" stroke-width="${r1(3*k)}" pointer-events="none"/>`}
     s+='</g>';
    }
   }
   [0,cw].forEach(a=>{s+=`<path d="M${Wd(a,d,0)}L${Wd(a,d,h+.035)}" stroke="#7398b3" stroke-width="${r1(3.8*Math.max(.8,k))}"/>`});
   return s;
  };
  const labelSVG=r=>{
   const c=P(...(r.rot===90?[r.x+RACK_DEPTH,r.y+r.cols*CELL/2,rackHeight(r)+.06]:[r.x+r.cols*CELL/2,r.y+RACK_DEPTH,rackHeight(r)+.06])),on=selRack===r.id;
   return `<g ${inter?`data-action="select-rack" data-rack="${esc(r.id)}" role="button" tabindex="0" aria-label="Ver rack ${esc(r.id)}" style="cursor:pointer"`:''}><rect x="${r1(c[0]-20)}" y="${r1(c[1]-18)}" width="40" height="18" rx="4" fill="${on?'#1688ea':'#fff'}" stroke="${on?'#1688ea':'#cbddea'}"/><text x="${r1(c[0])}" y="${r1(c[1]-5)}" text-anchor="middle" font-size="8" font-weight="600" fill="${on?'white':'#6a8ca8'}">RACK ${esc(r.id)}</text></g>`;
  };
  const sorted=[...visible].sort((a,b)=>{const p=rackRect(a),q=rackRect(b);return (p.x+p.w/2+p.y+p.d/2)-(q.x+q.w/2+q.y+q.d/2)||p.x-q.x});
  const inSec=g=>!section||(g.x+g.w>section.x&&g.x<section.x+section.w&&g.y+g.d>section.y&&g.y<section.y+section.h);
  const dks=(f.docks||[]).filter(inSec),dk=dks[0];
  let dock='',route='';
  if(dk){
   dock=dks.map(g=>poly([P(g.x,g.y),P(g.x+g.w,g.y),P(g.x+g.w,g.y+g.d),P(g.x,g.y+g.d)],'#dcedf9','#a4cce8')).join('');
   const dest=visible.find(r=>r.id===selRack);
   if(dest){const q=rackRect(dest),dx=dk.x+dk.w/2,dy=dk.y;const fy=dest.rot===90?q.y+q.d/2:q.y+q.d+.45,fx=dest.rot===90?q.x+q.w+.45:q.x+q.w/2;
    route=`<path d="M${P(dx,dy)}L${P(dx,fy)}L${P(fx,fy)}" fill="none" stroke="#35acdd" stroke-width="${r1(2.3*Math.max(.8,k))}" stroke-dasharray="5 4" opacity=".75"/>`}
  }
  const dockLabel=dks.map(g=>{const c=P(g.x+g.w/2,g.y+g.d/2),fs=8*Math.max(.9,k),len=Math.max(g.w,g.d)*37*k*.9;return `<text x="${r1(c[0])}" y="${r1(c[1]+3)}" text-anchor="middle" fill="#6f98b8" font-size="${r1(fs)}" letter-spacing="1">${esc(fitText(g.label||'RECEPCIÓN',len,fs,1))}</text>`}).join('');
  const conns=(f.connectors||[]).map(c=>{
   const t=root.floors.find(g=>g.id===c.to),rise=t?t.elevation-f.elevation:0,x0=c.x,y0=c.y,x1=c.x+c.w,y1=c.y+c.d;
   const base=poly([P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)],'#e9e3fa','#8b7be8');
   if(rise<=0.01)return base;
   if(c.kind==='lift')return base+poly([P(x1,y0,0),P(x1,y1,0),P(x1,y1,rise),P(x1,y0,rise)],'#8b7be84d','#8b7be8')+poly([P(x0,y1,0),P(x1,y1,0),P(x1,y1,rise),P(x0,y1,rise)],'#8b7be866','#8b7be8')+poly([P(x0,y0,rise),P(x1,y0,rise),P(x1,y1,rise),P(x0,y1,rise)],'#8b7be833','#8b7be8');
   const alongY=c.d>=c.w,n=Math.max(4,Math.round((alongY?c.d:c.w)/.3));
   let g=alongY
    ?poly([P(x0,y0,0),P(x1,y0,0),P(x1,y1,rise),P(x0,y1,rise)],'#d9d0f6','#8b7be8')+poly([P(x1,y0,0),P(x1,y1,0),P(x1,y1,rise)],'#b9acee','#8b7be8')+poly([P(x0,y1,0),P(x1,y1,0),P(x1,y1,rise),P(x0,y1,rise)],'#c5baf2','#8b7be8')
    :poly([P(x0,y0,0),P(x0,y1,0),P(x1,y1,rise),P(x1,y0,rise)],'#d9d0f6','#8b7be8')+poly([P(x1,y0,0),P(x1,y1,0),P(x1,y1,rise),P(x1,y0,rise)],'#c5baf2','#8b7be8')+poly([P(x0,y1,0),P(x1,y1,0),P(x1,y1,rise)],'#b9acee','#8b7be8');
   for(let i=1;i<n;i++){const u=i/n;g+=alongY?`<path d="M${P(x0,y0+u*c.d,u*rise)}L${P(x1,y0+u*c.d,u*rise)}" stroke="#8b7be8" stroke-width=".6" fill="none"/>`:`<path d="M${P(x0+u*c.w,y0,u*rise)}L${P(x0+u*c.w,y1,u*rise)}" stroke="#8b7be8" stroke-width=".6" fill="none"/>`}
   return base+g;
  }).join('');
  return `<defs><clipPath id="${cid}"><polygon points="${pts(floorPts)}"/></clipPath></defs>${back}<polygon points="${pts(floorPts)}" fill="#f0f5f9" fill-opacity="${alpha}" stroke="#d3e1eb" stroke-width="1"/><g opacity="${alpha<1?.75:1}">${slab}</g><g clip-path="url(#${cid})" opacity="${alpha<1?.35:1}">${grid}</g>${tints}${route}${dock}${conns}${sorted.map(rackSVG).join('')}${curbs}${dockLabel}${sorted.map(labelSVG).join('')}`;
 };
 const z=o.zoom??1,count=info.filter(i=>!isGhost(i.f)).reduce((n,i)=>n+i.visible.length,0);
 const legend=ordered.map((f,i)=>`<text x="798" y="${30+i*15}" text-anchor="end" font-size="${single&&f===single?12:10.5}" font-weight="${single&&f!==single?500:650}" fill="#4b7595" opacity="${single&&f!==single?.55:1}">${esc(f.name)}${f.elevation?` · +${String(f.elevation).replace('.',',')} m`:''}${f.kind==='mezzanine'?' (entrepiso)':''}</text>`).join('');
 const secLabel=section?`<text x="798" y="${root.floors.length>1?34+ordered.length*15:30}" text-anchor="end" font-size="11" font-weight="600" fill="#6a8ca8">${esc(section.name)}</text>`:'';
 const label=section?`Sección ${section.name} en 3D`:single?`${single.name} en 3D`:'Bodega completa en 3D, todas las plantas';
 return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)}, ${count} racks"><g transform="translate(${r1(W/2*(1-z))} ${r1(H/2*(1-z))}) scale(${z})">${info.map(i=>{const g=drawFloor(i);return isGhost(i.f)?`<g opacity=".14" pointer-events="none">${g}</g>`:g}).join('')}</g>${(root.floors.length>1||section)&&o.legend!==false?legend:''}${secLabel}</svg>`;
}

// ---------- rack elevation ----------
export function frontView(layout,rackId,o={}){
 const all=allRacks(layout),r=all.find(r=>r.id===rackId)||all[0];
 if(!r)return `<svg viewBox="0 0 ${W} ${H}"></svg>`;
 const L=r.levels,C=r.cols,rowH=Math.min(80,Math.floor(255/L)),top=112,cellH=rowH-17,x1=150,x2=670,inner=x2-x1-20,step=inner/C,gap=Math.min(13,step*.14),cw=step-gap;
 const sel=o.selectedLoc||'',lvl=o.level??'all',fs=Math.max(7,Math.min(11,cw/7.2));
 const rows=Array.from({length:L},(_,i)=>L-i).map(l=>{
  const y=top+(L-l)*rowH;
  return `<text x="${x1-26}" y="${y+cellH/2+4}" text-anchor="end" fill="#87a3b9" font-size="10">NIVEL ${l}</text><rect x="${x1+3}" y="${y+cellH+4}" width="${x2-x1-6}" height="8" rx="2" fill="#87a9c2"/>${Array.from({length:C},(_,i)=>{
   const pos=i+1,id=locId(r.id,l,pos),q=o.qtyAt?.(id)||0,cx=x1+10+i*step+cw/2,on=id===sel;
   return `<g ${o.cellAttrs?.(id)||''} opacity="${lvl==='all'||Number(lvl)===l?1:.25}"><rect x="${r1(x1+10+i*step)}" y="${y}" width="${r1(cw)}" height="${cellH}" rx="5" fill="${o.cellColor?.(id)||'#f6f9fc'}" stroke="${on?'#0574c4':'#bdd2e2'}"/><text x="${r1(cx)}" y="${y+cellH*.42}" text-anchor="middle" fill="${on?'white':'#4d7798'}" font-size="${r1(fs)}" font-weight="600">${id}</text>${cellH>=40?`<text x="${r1(cx)}" y="${y+cellH*.72}" text-anchor="middle" fill="${on?'#d5edff':'#7597b0'}" font-size="${r1(Math.max(6.5,fs-2))}">${q?q+(cw>62?' unidades':' u.'):'Disponible'}</text>`:''}</g>`;
  }).join('')}`;
 }).join('');
 const bottom=top+L*rowH;
 return `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Vista frontal del rack ${esc(r.id)}"><text x="410" y="52" text-anchor="middle" font-size="17" font-weight="600" fill="#3f698a">Rack ${esc(r.id)} · ${esc(r.name)}</text><text x="410" y="73" text-anchor="middle" font-size="10" fill="#92aabc">Selecciona una posición para ver su contenido</text>${rows}<path d="M${x1+3} ${top-4}V${bottom-6}M${x2-3} ${top-4}V${bottom-6}" stroke="#5f8da8" stroke-width="7"/><path d="M${x1-25} ${bottom+6}H${x2+25}" stroke="#dbe6ef" stroke-width="3"/><text x="410" y="${bottom+30}" text-anchor="middle" font-size="10" fill="#a0b4c6">${C} posiciones × ${L} niveles · Capacidad: ${C*L*(r.capacity||60)} unidades</text></svg>`;
}
