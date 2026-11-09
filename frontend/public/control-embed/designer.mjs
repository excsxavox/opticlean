// Warehouse designer: edit the outline (rounded polygon), place racks and define sections in 2D,
// preview the result in 3D, and save it as the structure the whole app works with.
import {cameraTransition} from './anim.mjs';
import {limitingFloor,RACK_BASE,pointInPolygon,sampleOutline,fitText,addDock,addConnector,addFloor,maxLevels,clearance,rackHeight,allRacks,LEVEL_H,SLAB,CELL,bounds,outlinePath,corners,rackRect,rackSize,presetOutline,resizeOutline,addRack,addSection,sectionOf,rackIssues,validateLayout,locationIds,defaultLayout,MAX_COLS,MAX_LEVELS} from './layout.mjs';
import {iso3D} from './render.mjs';
import {categories,applyLayout} from './model.mjs';

const W=820,H=450,r1=v=>Math.round(v*10)/10,clone=o=>JSON.parse(JSON.stringify(o));
const snap=(v,g)=>Math.round(v/g)*g,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const num=v=>String(Math.round(v*100)/100);
const catColor={Hogar:'#bed8eb',Industrial:'#d6cdee',Institucional:'#c6e8dc',Hospitalaria:'#f3d8d2'};

let ctx,draft=null,dirty=false,sel=null,mode='2d',fi=0,previewFloor='*',previewSection='',drag=null,lockView=null;
const cur=()=>draft.floors[Math.min(fi,draft.floors.length-1)];
const $=q=>document.querySelector(q),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initDesigner(c){ctx=c;bind()}
export function designerReset(){draft=null;dirty=false;sel=null;fi=0;hist=[];hi=0;lastKeys=null;closePop()}
export function designerPage(){
 closePop();if(!draft){draft=clone(ctx.state().layout);resetHist();lastKeys=null}
 const {I,pageHead}=ctx;
 $('#page').innerHTML=pageHead('Estructura de la bodega','Diseña tu bodega','Define el contorno, coloca los muebles y organiza las secciones. Los cambios se aplican al guardar.',
  `<span id="d-hist"></span><button class="btn" data-d="discard">${I('refresh')}Descartar cambios</button><button class="btn primary" data-d="save">${I('check')}Guardar estructura</button>`)+
 `<div class="work-area designer"><section class="panel"><div class="panel-head"><div><div class="panel-title">${I('grid')}Plano de la bodega</div><div class="panel-subtitle" id="d-sub"></div></div><span id="d-dirty"></span></div><div class="map-controls"><div class="segmented"><button data-d="mode" data-mode="2d" class="${mode==='2d'?'active':''}">${I('map')}Editar en 2D</button><button data-d="mode" data-mode="3d" class="${mode==='3d'?'active':''}">${I('cube')}Vista previa 3D</button></div><div class="map-actions" id="d-tools"></div></div><div class="floor-tabs" id="d-floors"></div><div class="d-stage"><div class="d-rail" id="d-rail" role="toolbar" aria-label="Herramientas de diseño"></div><div class="designer-canvas" id="designer-canvas"></div></div><div class="map-footer"><span id="d-hint"></span><span>Cuadrícula de 1 m · ajuste automático</span></div></section><div class="side-stack" id="designer-side"></div></div>`;
 refresh();
}
function renderFloors(){
 const t=$('#d-floors');if(!t)return;const {I}=ctx;
 t.innerHTML=draft.floors.map((f,i)=>`<button class="btn small ${i===fi?'primary':''}" data-d="floor-tab" data-i="${i}" type="button">${esc(f.name)}<span class="tab-sub">${f.kind==='mezzanine'?'entrepiso · ':''}${f.elevation?'+'+num(f.elevation)+' m':'suelo'}</span></button>`).join('')+`<span class="tab-gap"></span><button class="btn small" data-d="add-floor" data-kind="floor" type="button">${I('plus')}Planta</button><button class="btn small" data-d="add-floor" data-kind="mezzanine" type="button">${I('plus')}Entrepiso</button>`;
}
// ---------- history (undo / redo) ----------
let hist=[],hi=0,savedJSON='';
const snapJSON=()=>JSON.stringify(draft);
function resetHist(){hist=[snapJSON()];hi=0;savedJSON=hist[0]}
function commit(){const j=snapJSON();if(j===hist[hi])return;hist=hist.slice(0,hi+1);hist.push(j);if(hist.length>80)hist.shift();hi=hist.length-1}
function restore(i){hi=i;draft=JSON.parse(hist[hi]);fi=Math.min(fi,draft.floors.length-1);sel=null;dirty=hist[hi]!==savedJSON;refresh()}
const undo=()=>{if(hi>0)restore(hi-1)},redo=()=>{if(hi<hist.length-1)restore(hi+1)};
function renderHist(){
 const h=$('#d-hist');if(!h)return;
 const b=(act,label,on,path)=>`<button class="btn icon-only" data-d="${act}" ${on?'':'disabled'} aria-label="${label}" title="${label}"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${path}</svg></button>`;
 h.innerHTML=b('undo','Deshacer (Ctrl+Z)',hi>0,'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')+b('redo','Rehacer (Ctrl+Y)',hi<hist.length-1,'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>');
}
function refresh(){renderFloors();renderTools();renderCanvas();renderSide();renderHist();lastV=validateLayout(draft,ctx.state().lots);checkIssues(lastV);renderStatus();renderPop()}

// ---------- 2D editor canvas ----------
function extents(L){
 const items=[bounds(L.outline),...L.racks.map(r=>{const q=rackRect(r);return {x:q.x,y:q.y,w:q.w,d:q.d}}),...L.sections.map(s=>({x:s.x,y:s.y,w:s.w,d:s.h}))];
 for(const k of L.docks||[])items.push({x:k.x,y:k.y,w:k.w,d:k.d});
 for(const k of L.connectors||[])items.push({x:k.x,y:k.y,w:k.w,d:k.d});
 const x0=Math.min(...items.map(i=>i.x)),y0=Math.min(...items.map(i=>i.y)),x1=Math.max(...items.map(i=>i.x+i.w)),y1=Math.max(...items.map(i=>i.y+i.d));
 return {x:Math.min(0,x0),y:Math.min(0,y0),w:Math.max(12,x1-Math.min(0,x0)),d:Math.max(8,y1-Math.min(0,y0))};
}
function viewFor(L){
 if(lockView)return lockView;
 const e=extents(L),s=Math.min(70,(W-70)/e.w,(H-64)/e.d);
 return {s,ox:(W-e.w*s)/2-e.x*s,oy:(H-e.d*s)/2-e.y*s+6};
}
function editorSVG(){
 const L=cur(),v=viewFor(L),X=x=>v.ox+x*v.s,Y=y=>v.oy+y*v.s,map=p=>[X(p.x),Y(p.y)],bad=rackIssues(draft,L),bb=bounds(L.outline);
 const others=draft.floors.filter(f=>f!==L).map(f=>`<path d="${outlinePath(f.outline,map)}" fill="${f.kind==='mezzanine'?'#8b7be81a':'none'}" stroke="${f.kind==='mezzanine'?'#8b7be8':'#c5d3df'}" stroke-width="1.4" stroke-dasharray="6 5" pointer-events="none"/><text x="${r1(X(bounds(f.outline).x)+6)}" y="${r1(Y(bounds(f.outline).y)+bounds(f.outline).d*v.s-6)}" font-size="9" fill="#9aaabb" pointer-events="none">${esc(f.name)}</text>`).join('');
 const on=(k,id)=>sel&&sel.k===k&&String(sel.id)===String(id);
 const sections=L.sections.map(s=>{
  const a=on('section',s.id);
  return `<g class="d-item" data-d="section" data-id="${esc(s.id)}"><rect x="${r1(X(s.x))}" y="${r1(Y(s.y))}" width="${r1(s.w*v.s)}" height="${r1(s.h*v.s)}" rx="6" fill="${esc(s.color)}" fill-opacity="${a?.18:.1}" stroke="${esc(s.color)}" stroke-width="${a?2.4:1.3}" stroke-dasharray="${a?'':'6 4'}"/><text x="${r1(X(s.x)+8)}" y="${r1(Y(s.y)+15)}" font-size="10.5" font-weight="650" fill="#37627f" pointer-events="none">${esc(s.name)}</text>${a?`<rect class="d-handle" data-d="resize" data-id="${esc(s.id)}" x="${r1(X(s.x+s.w)-6)}" y="${r1(Y(s.y+s.h)-6)}" width="12" height="12" rx="2" fill="#fff" stroke="${esc(s.color)}" stroke-width="2" style="cursor:nwse-resize"/>`:''}</g>`;
 }).join('');
 const dk=(L.docks||[]).map(k=>{const a=on('dock',k.id),x=X(k.x),y=Y(k.y),w=k.w*v.s,h=k.d*v.s,tall=h>w*1.2,cx=x+w/2,cy=y+h/2;return `<g class="d-item" data-d="dock" data-id="${esc(k.id)}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="4" fill="#e8f2fd" stroke="${a?'#1795f5':'#a9cdea'}" stroke-width="${a?2.4:1.2}"/><text x="${r1(cx)}" y="${r1(cy+3)}" text-anchor="middle" font-size="8.5" fill="#6f98b8" letter-spacing=".6" pointer-events="none"${tall?` transform="rotate(-90 ${r1(cx)} ${r1(cy)})"`:''}>${esc(fitText(k.label,(tall?h:w)-8,8.5))}</text>${a?`<rect class="d-handle" data-d="dresize" data-id="${esc(k.id)}" x="${r1(x+w-6)}" y="${r1(y+h-6)}" width="12" height="12" rx="2" fill="#fff" stroke="#1795f5" stroke-width="2" style="cursor:nwse-resize"/>`:''}</g>`}).join('');
 const cn=(L.connectors||[]).map(k=>{const a=on('conn',k.id),x=X(k.x),y=Y(k.y),w=k.w*v.s,h=k.d*v.s,tall=h>w*1.2,cx=x+w/2,cy=y+h/2,tn=draft.floors.find(f=>f.id===k.to)?.name||'sin destino';return `<g class="d-item" data-d="conn" data-id="${esc(k.id)}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="#f1ecfc" stroke="${a?'#1795f5':'#8b7be8'}" stroke-width="${a?2.4:1.3}"/><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="url(#cHatch)" pointer-events="none"/><text x="${r1(cx)}" y="${r1(cy+3)}" text-anchor="middle" font-size="8" font-weight="600" fill="#5b4fb5" paint-order="stroke" stroke="#f1ecfc" stroke-width="2.5" pointer-events="none"${tall?` transform="rotate(-90 ${r1(cx)} ${r1(cy)})"`:''}>${esc(fitText(`${k.kind==='lift'?'Montacargas':'Escalera'} → ${tn}`,(tall?h:w)-6,8))}</text>${a?`<rect class="d-handle" data-d="cresize" data-id="${esc(k.id)}" x="${r1(x+w-6)}" y="${r1(y+h-6)}" width="12" height="12" rx="2" fill="#fff" stroke="#1795f5" stroke-width="2" style="cursor:nwse-resize"/>`:''}</g>`}).join('');
 const racks=L.racks.map(r=>{
  const q=rackRect(r),x=X(q.x),y=Y(q.y),w=q.w*v.s,h=q.d*v.s,a=on('rack',r.id),err=bad.has(r.id);
  const divs=Array.from({length:r.cols-1},(_,i)=>r.rot===90?`M${r1(x)} ${r1(y+(i+1)*CELL*v.s)}h${r1(w)}`:`M${r1(x+(i+1)*CELL*v.s)} ${r1(y)}v${r1(h)}`).join('');
  const front=r.rot===90?`M${r1(x+w)} ${r1(y+1)}V${r1(y+h-1)}`:`M${r1(x+1)} ${r1(y+h)}H${r1(x+w-1)}`;
  return `<g class="d-item" data-d="rack" data-id="${esc(r.id)}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="2.5" fill="${err?'#fde7e7':catColor[r.category]||'#d3e6f3'}" stroke="${err?'#d64545':a?'#1795f5':'#7fa6c2'}" stroke-width="${a||err?2.4:1}"/><path d="${divs}" stroke="#ffffffb0" stroke-width=".9" fill="none"/><path d="${front}" stroke="${err?'#d64545':'#3d7aa6'}" stroke-width="3" fill="none"/>${Math.min(w,h)>=14?`<text x="${r1(x+w/2)}" y="${r1(y+h/2+3.5)}" text-anchor="middle" font-size="${r1(Math.min(11,Math.max(8,Math.min(w,h)*.5)))}" font-weight="700" fill="#3f6989" pointer-events="none">${esc(r.id)}</text>`:''}</g>`;
 }).join('');
 const n=L.outline.length,handles=L.outline.map((p,i)=>{
  const q=L.outline[(i+1)%n],m={x:(p.x+q.x)/2,y:(p.y+q.y)/2},a=on('vertex',i);
  return `<circle class="d-handle" data-d="addv" data-i="${i}" cx="${r1(X(m.x))}" cy="${r1(Y(m.y))}" r="5" fill="#fff" stroke="#9cc0da" stroke-width="1.4" style="cursor:copy"><title>Añadir vértice</title></circle><path d="M${r1(X(m.x)-2.4)} ${r1(Y(m.y))}h4.8M${r1(X(m.x))} ${r1(Y(m.y)-2.4)}v4.8" stroke="#6b9bbd" stroke-width="1.2" pointer-events="none"/>`;
 }).join('')+L.outline.map((p,i)=>{const a=on('vertex',i);return `<circle class="d-handle" data-d="vertex" data-i="${i}" cx="${r1(X(p.x))}" cy="${r1(Y(p.y))}" r="${a?7.5:6}" fill="${a?'#1795f5':'#fff'}" stroke="#1177d1" stroke-width="2" style="cursor:move"><title>Vértice ${i+1}</title></circle>`}).join('');
 const grid=`<pattern id="dGrid" width="${r1(v.s)}" height="${r1(v.s)}" patternUnits="userSpaceOnUse" patternTransform="translate(${r1(v.ox)} ${r1(v.oy)})"><path d="M${r1(v.s)} 0H0V${r1(v.s)}" fill="none" stroke="#e6edf4" stroke-width=".6"/></pattern>`;
 const dims=`<text x="${r1(X(bb.x+bb.w/2))}" y="${r1(Y(bb.y)-12)}" text-anchor="middle" font-size="10" fill="#6f90aa">${num(bb.w)} m</text><text x="${r1(X(bb.x)-14)}" y="${r1(Y(bb.y+bb.d/2))}" text-anchor="middle" font-size="10" fill="#6f90aa" transform="rotate(-90 ${r1(X(bb.x)-14)} ${r1(Y(bb.y+bb.d/2))})">${num(bb.d)} m</text>`;
 const path=outlinePath(L.outline,map);
 return `<svg id="designer-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Editor 2D de la bodega"><defs>${grid}<pattern id="cHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" stroke="#8b7be866" stroke-width="2"/></pattern></defs><rect data-d="bg" width="${W}" height="${H}" fill="url(#dGrid)"/><path d="${path}" fill="#ffffff" stroke="#9fbdd3" stroke-width="3" data-d="floor"/>${others}${dims}${sections}${dk}${cn}${racks}${handles}</svg>`;
}
function previewSVG(blend){
 const cc=id=>catColor[allRacks(draft).find(r=>id.startsWith(r.id+'-'))?.category]||'#bed8eb';
 return iso3D(draft,{floor:previewFloor,section:previewFloor!=='*'?previewSection||null:null,interactive:false,uid:blend<1?'dc':'d',cellColor:cc,qtyAt:()=>1,level:'all',selectedLoc:'',blend,plan:viewFor(cur())});
}
function renderCanvas(){
 const c=$('#designer-canvas');if(!c)return;
 if(mode==='2d')c.innerHTML=editorSVG();
 else{
  c.innerHTML=previewSVG(1);
 }
 const D=draft;
 $('#d-sub').textContent=`${D.floors.length} planta${D.floors.length===1?'':'s'} · ${allRacks(D).length} racks · ${D.floors.reduce((n,f)=>n+f.sections.length,0)} secciones · ${locationIds(D).length} posiciones`;
 $('#d-hint').textContent=mode==='2d'?'Arrastra para mover · clic derecho o doble clic para editar · clic derecho en vacío para agregar aquí · Supr elimina · R gira':'Vista previa en 3D del diseño actual (no interactiva)';
}
function renderTools(){
 const t=$('#d-tools'),rail=$('#d-rail');if(!t)return;
 const ic=p=>`<svg aria-hidden="true" viewBox="0 0 24 24" class="d-ico">${p}</svg>`;
 const tool=(act,label,short,svg,on)=>`<button type="button" class="d-tool ${on?'active':''}" data-d="${act}" title="${label}" aria-label="${label}">${ic(svg)}<span>${short}</span></button>`;
 if(rail){
  rail.innerHTML=mode==='2d'
   ?tool('tool-select','Seleccionar y mover','Mover','<path d="m5 3 14 7-6 2-2 6Z"/>',true)
    +tool('tool-outline','Editar contorno (vértices)','Contorno','<path d="M5 6h14v12H5z"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="18" r="1.8"/>')
    +tool('add-rack','Agregar mueble (rack)','Mueble','<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M9 5v14M15 5v14M3 12h18"/>')
    +tool('add-section','Agregar sección','Sección','<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2.5"/>')
    +tool('add-dock','Agregar zona de recepción','Zona','<rect x="3" y="9" width="18" height="10" rx="1.5"/><path d="M12 3v8m-3-3 3 3 3-3"/>')
    +tool('add-conn','Agregar escalera o montacargas','Conexión','<path d="M3 20h5v-4h4v-4h4V8h5"/>')
   :'';
  rail.style.display=mode==='2d'?'':'none';
 }
 t.innerHTML=mode==='2d'?'':`<select id="d-preview-floor" aria-label="Planta a visualizar"><option value="*">Todas las plantas</option>${draft.floors.map(f=>`<option value="${esc(f.id)}" ${previewFloor===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>${previewFloor!=='*'&&draft.floors.find(f=>f.id===previewFloor)?.sections.length?`<select id="d-preview-section" aria-label="Sección a visualizar"><option value="">Toda la planta</option>${draft.floors.find(f=>f.id===previewFloor).sections.map(s=>`<option value="${esc(s.id)}" ${previewSection===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`:''}`;
}

// ---------- side panel ----------
const field=(label,kind,name,value,{type='number',step='any',min,max,extra=''}={})=>`<div class="field"><label>${label}<input type="${type}" data-f="${kind}" name="${name}" value="${esc(value)}" ${step?`step="${step}"`:''} ${min!==undefined?`min="${min}"`:''} ${max!==undefined?`max="${max}"`:''} ${extra}></label></div>`;
const fc=v=>String(Math.round(v*100)/100).replace('.',',');
function levelMsg(L,r,mx,clear){
 const lim=limitingFloor(draft,L,r),over=r.levels>mx;
 if(over)return `<div class="d-msg warn">No cabe: el mueble mide ${fc(rackHeight(r))} m y hay ${fc(clear)} m libres. Máximo ${mx} nivel${mx===1?'':'es'}.</div>`;
 if(r.levels>=mx&&mx<MAX_LEVELS)return `<div class="d-msg warn">Máximo ${mx} nivel${mx===1?'':'es'}: ${lim?`${esc(lim.floor.name)} a +${fc(lim.floor.elevation)} m deja ${fc(clear)} m libres`:`la altura libre de ${esc(L.name)} es ${fc(clear)} m`} y cada nivel mide ${fc(r.levelHeight||LEVEL_H)} m. Baja el alto por nivel o mueve el rack para ganar uno.</div>`;
 return `<div class="d-msg ok">Quedan ${fc(clear-rackHeight(r))} m libres sobre el mueble${r.levels>=MAX_LEVELS?' (tope de '+MAX_LEVELS+' niveles)':''}.</div>`;
}
// Side cut: floor, headroom, slabs overhead and the rack stacked level by level.
function cutHTML(L,r,mx,clear){
 const lh=r.levelHeight||LEVEL_H,lim=limitingFloor(draft,L,r),topM=Math.max(L.height,clear+.2,lim?lim.gap+SLAB+.1:0),sc=Math.min(42,190/topM),H=Math.round(topM*sc)+44,y=m=>24+m*sc;
 const cells=Array.from({length:r.levels},(_,i)=>`<div class="cut-cell ${i>=mx?'over':''}" style="bottom:${r1(y(RACK_BASE+i*lh))}px;height:${r1(Math.max(7,lh*sc-2))}px">N${i+1}</div>`).join('');
 const ghost=r.levels<=mx&&mx<MAX_LEVELS&&r.levels===mx?`<div class="cut-cell ghost" style="bottom:${r1(y(RACK_BASE+r.levels*lh))}px;height:${r1(Math.max(7,lh*sc-2))}px">Nivel ${r.levels+1} · no cabe</div>`:'';
 const slab=lim?`<div class="cut-slab" style="bottom:${r1(y(lim.gap))}px;height:${r1(Math.max(4,SLAB*sc))}px"></div><div class="cut-lbl slab" style="bottom:${r1(y(lim.gap)-2)}px">${esc(lim.floor.name)}<br>+${fc(lim.floor.elevation)} m</div>`:'';
 return `<div class="cut-wrap"><div class="cut-head"><b>Corte lateral</b><span>Escala 1 m = ${r1(sc)} px</span></div><div class="cut" style="height:${H}px"><div class="cut-ground"></div><div class="cut-lbl" style="left:8px;bottom:4px">Suelo · +${fc(L.elevation)} m</div><div class="cut-ceil" style="bottom:${r1(y(L.height))}px"></div><div class="cut-lbl" style="right:8px;bottom:${r1(y(L.height)+3)}px">Altura libre ${fc(L.height)} m</div>${slab}<div class="cut-base"></div>${cells}${ghost}<div class="cut-dim" style="height:${r1(clear*sc)}px"></div><div class="cut-lbl dim" style="bottom:${r1(y(clear/2)-10)}px">${fc(clear)} m<br>libres</div></div><div class="cut-foot"><span><b>Mueble</b> ${fc(rackHeight(r))} m</span><span><b>Libre</b> ${fc(clear)} m</span><span><b>Máx.</b> ${mx} nivel${mx===1?'':'es'}</span></div></div>`;
}
function selectedPanel(){
 const L=cur(),{I}=ctx;
 if(!sel)return `<div class="empty-location">${I('cursor')}<div>Selecciona un mueble, una sección o un vértice en el plano para editarlo.</div></div>`;
 if(sel.k==='rack'){
  const r=L.racks.find(r=>r.id===sel.id);if(!r)return '';
  const sec=sectionOf(L,r),mx=maxLevels(draft,L,r),clear=clearance(draft,L,r);
  return `<div class="d-title">Rack ${esc(r.id)}<span>${r.cols*r.levels} posiciones · ${sec?esc(sec.name):'sin sección'}</span></div><div class="d-grid">${field('Nombre','rack','name',r.name,{type:'text',step:'',extra:'maxlength="40" class="wide"'})}<div class="field"><label>Línea<select data-f="rack" name="category">${categories.map(c=>`<option ${r.category===c?'selected':''}>${c}</option>`).join('')}</select></label></div>${field('Posiciones por nivel','rack','cols',r.cols,{step:1,min:1,max:MAX_COLS})}<div class="field"><span class="cap">Niveles (máx. ${mx})</span><div class="stepper"><button type="button" data-d="lvl-dec" aria-label="Quitar un nivel" ${r.levels<=1?'disabled':''}>−</button><input type="number" data-f="rack" name="levels" aria-label="Niveles" value="${r.levels}" min="1" max="${Math.max(1,mx)}" step="1"><button type="button" data-d="lvl-inc" aria-label="Agregar un nivel" ${r.levels>=mx?'disabled':''}>+</button></div></div>${field('Alto por nivel (m)','rack','levelHeight',num(r.levelHeight||LEVEL_H),{step:.05,min:.3,max:3})}${field('Capacidad por posición (u.)','rack','capacity',r.capacity,{step:1,min:1})}<div class="field"><label>Orientación<button class="btn small" data-d="rotate" type="button">${I('refresh')}Girar 90° (${r.rot===90?'vertical':'horizontal'})</button></label></div>${field('X (m)','rack','x',num(r.x),{step:.25,min:0})}${field('Y (m)','rack','y',num(r.y),{step:.25,min:0})}</div><div class="d-actions"><button class="btn small" data-d="dup-rack" type="button">${I('plus')}Duplicar</button><button class="btn small danger" data-d="delete" type="button">${I('close')}Eliminar</button></div>${levelMsg(L,r,mx,clear)}<p class="d-note">La línea marcada en el borde indica el frente del mueble. Tope absoluto: ${MAX_LEVELS} niveles.</p>`;
 }
 if(sel.k==='section'){
  const s=L.sections.find(s=>s.id===sel.id);if(!s)return '';
  const inside=L.racks.filter(r=>sectionOf(L,r)?.id===s.id).length;
  return `<div class="d-title">Sección<span>${inside} rack${inside===1?'':'s'} dentro</span></div><div class="d-grid">${field('Nombre','section','name',s.name,{type:'text',step:'',extra:'maxlength="40"'})}${field('Color','section','color',s.color,{type:'color',step:''})}${field('X (m)','section','x',num(s.x),{step:.5,min:0})}${field('Y (m)','section','y',num(s.y),{step:.5,min:0})}${field('Ancho (m)','section','w',num(s.w),{step:.5,min:1})}${field('Alto (m)','section','h',num(s.h),{step:.5,min:1})}</div><div class="d-actions"><button class="btn small danger" data-d="delete" type="button">${I('close')}Eliminar sección</button></div><p class="d-note">Los racks pertenecen a la sección que contiene su centro. Al hacer clic en ella en el plano, se abre en 3D.</p>`;
 }
 if(sel.k==='vertex'){
  const p=L.outline[sel.id];if(!p)return '';
  return `<div class="d-title">Vértice ${Number(sel.id)+1}<span>de ${L.outline.length}</span></div><div class="d-grid">${field('X (m)','vertex','x',num(p.x),{step:.5,min:0})}${field('Y (m)','vertex','y',num(p.y),{step:.5,min:0})}${field('Radio de esquina (m)','vertex','r',num(p.r||0),{step:.1,min:0})}</div><div class="d-actions"><button class="btn small danger" data-d="delete" type="button" ${L.outline.length<=3?'disabled':''}>${I('close')}Eliminar vértice</button></div>`;
 }
 if(sel.k==='conn'){
  const c=(L.connectors||[]).find(k=>k.id===sel.id);if(!c)return '';
  const others=draft.floors.filter(f=>f!==L),tn=draft.floors.find(f=>f.id===c.to)?.name;
  return `<div class="d-title">${c.kind==='lift'?'Montacargas':'Escalera'}<span>${tn?'conecta con '+esc(tn):'sin destino'}</span></div><div class="d-grid">${field('Etiqueta','conn','label',c.label||'',{type:'text',step:'',extra:'maxlength="30"'})}<div class="field"><label>Tipo<select data-f="conn" name="kind"><option value="stairs" ${c.kind!=='lift'?'selected':''}>Escalera</option><option value="lift" ${c.kind==='lift'?'selected':''}>Montacargas</option></select></label></div><div class="field"><label>Conecta con<select data-f="conn" name="to">${others.map(f=>`<option value="${esc(f.id)}" ${c.to===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label></div><div class="field"><label>Orientación<button class="btn small" data-d="rotate-conn" type="button">${I('refresh')}Girar 90°</button></label></div>${field('X (m)','conn','x',num(c.x),{step:.25,min:0})}${field('Y (m)','conn','y',num(c.y),{step:.25,min:0})}${field('Ancho (m)','conn','w',num(c.w),{step:.25,min:.5})}${field('Fondo (m)','conn','d',num(c.d),{step:.25,min:.5})}</div><div class="d-actions">${tn&&!draft.floors.find(f=>f.id===c.to)?.connectors?.some(k=>k.to===L.id)?`<button class="btn small" data-d="pair-conn" type="button">${I('plus')}Crear par en ${esc(tn)}</button>`:''}<button class="btn small danger" data-d="delete" type="button">${I('close')}Eliminar</button></div><p class="d-note">Coloca una conexión en cada planta (con el mismo recorrido) para completar el acceso. La escalera o el montacargas se dibuja en 3D subiendo desde la planta más baja hasta la elevación de la otra.</p>`;
 }
 if(sel.k==='dock'){
  const d=(L.docks||[]).find(k=>k.id===sel.id);if(!d)return '';
  return `<div class="d-title">Zona de recepción / despacho<span>${num(d.w*d.d)} m² · ${d.w>=d.d?'horizontal':'vertical'}</span></div><div class="d-grid">${field('Etiqueta','dock','label',d.label||'',{type:'text',step:'',extra:'maxlength="40"'})}<div class="field"><label>Orientación<button class="btn small" data-d="rotate-dock" type="button">${I('refresh')}Girar 90°</button></label></div>${field('X (m)','dock','x',num(d.x),{step:.25,min:0})}${field('Y (m)','dock','y',num(d.y),{step:.25,min:0})}${field('Ancho (m)','dock','w',num(d.w),{step:.25,min:.5})}${field('Fondo (m)','dock','d',num(d.d),{step:.25,min:.5})}</div><div class="d-actions"><button class="btn small" data-d="dup-dock" type="button">${I('plus')}Duplicar</button><button class="btn small danger" data-d="delete" type="button">${I('close')}Eliminar zona</button></div><p class="d-note">Arrastra el cuadrito de la esquina inferior derecha para cambiar su tamaño.</p>`;
 }
 return '';
}
function floorOutlineHTML(){
 const L=cur(),{I}=ctx,bb=bounds(L.outline),rs=L.outline.map(p=>p.r||0),same=rs.every(v=>v===rs[0]),isGround=fi===0;
 const shape=[['rect','Rectángulo'],['L','En L'],['U','En U'],['T','En T']];
 return `<section class="panel"><div class="panel-head"><span class="panel-title">${I('layers')}${L.kind==='mezzanine'?'Entrepiso':'Planta'} · ${esc(L.name)}</span></div><div class="panel-body d-body"><div class="d-grid">${field('Nombre','floor','name',L.name,{type:'text',step:'',extra:'maxlength="30"'})}${field('Altura libre (m)','floor','height',num(L.height),{step:.1,min:2,max:30})}${field('Elevación (m)','floor','elevation',num(L.elevation),{step:.1,min:0,max:50,extra:isGround?'disabled':''})}<div class="field"><label>Tipo<input type="text" value="${L.kind==='mezzanine'?'Entrepiso':isGround?'Planta baja':'Planta alta'}" disabled></label></div></div><p class="d-note">La <b>elevación</b> es la altura del piso sobre el suelo. La <b>altura libre</b> es el espacio utilizable encima de ese piso; limita cuántos niveles caben en los muebles.${L.kind==='mezzanine'?' Un entrepiso debe quedar dentro de la planta baja y bajo su techo.':''}</p>${isGround?'':`<div class="d-actions"><button class="btn small danger" data-d="del-floor" type="button">${I('close')}Eliminar ${L.kind==='mezzanine'?'entrepiso':'planta'}</button></div>`}</div></section><section class="panel"><div class="panel-head"><span class="panel-title">${I('building')}Contorno</span></div><div class="panel-body d-body"><div class="d-presets">${shape.map(([k,t])=>`<button class="btn small" data-d="preset" data-kind="${k}" type="button">${t}</button>`).join('')}</div><div class="d-grid">${field('Ancho (m)','outline','w',num(bb.w),{step:.5,min:4,max:120})}${field('Fondo (m)','outline','d',num(bb.d),{step:.5,min:4,max:120})}${field('Esquinas redondeadas (m)','outline','r',same?num(rs[0]):'',{step:.1,min:0,max:10,extra:same?'':'placeholder="mixto"'})}</div><p class="d-note">Arrastra los puntos blancos para dar forma al contorno. Usa el <b>+</b> de cada arista para añadir un vértice; con un vértice seleccionado puedes darle su propio radio.</p></div></section>`;
}
function cutPanelHTML(){
 if(!sel||sel.k!=='rack')return '';
 const L=cur(),r=L.racks.find(r=>r.id===sel.id);if(!r)return '';
 const mx=maxLevels(draft,L,r),clear=clearance(draft,L,r);
 return `<section class="panel cut-panel"><div class="panel-head"><span class="panel-title">${ctx.I('layers')}Corte lateral · Rack ${esc(r.id)}</span></div><div class="panel-body d-body">${cutHTML(L,r,mx,clear)}${levelMsg(L,r,mx,clear)}</div></section>`;
}
function renderSide(){
 const side=$('#designer-side');if(!side)return;
 side.innerHTML=cutPanelHTML()+floorOutlineHTML()+`<section class="panel"><div class="panel-body d-body"><button class="btn small" data-d="reset-default" type="button">${ctx.I('refresh')}Cargar bodega de ejemplo</button></div></section>`;
}

// ---------- validation feedback: toasts + counter ----------
let lastV=null,lastKeys=null;
function checkIssues(V){
 const keys=new Set(V.issues.map(i=>i.level+'|'+i.msg));
 if(lastKeys){
  const fresh=V.issues.filter(i=>!lastKeys.has(i.level+'|'+i.msg)),fe=fresh.filter(i=>i.level==='error');
  if(fe.length)ctx.toast(`${fe[0].msg}${V.errors.length>1?` (+${V.errors.length-1} más · ver el contador de arriba)`:''}`);
  else if(fresh.length)ctx.toast(fresh[0].msg);
  else if(!V.errors.length&&[...lastKeys].some(k=>k.startsWith('error|')))ctx.toast('Estructura lista para guardar.');
 }
 lastKeys=keys;
}
function renderStatus(){
 const el=$('#d-dirty');if(!el)return;
 const e=lastV?.errors.length||0,w=lastV?.warnings.length||0;
 el.innerHTML=(dirty?'<span class="badge amber">Cambios sin guardar</span>':'<span class="badge green"><span class="badge-dot"></span>Guardado</span>')
  +(e||w?`<button type="button" class="d-issues ${e?'err':'warn'}" data-d="issues-toggle" aria-label="Ver revisión">${e?`✕ ${e} error${e===1?'':'es'}`:''}${e&&w?' · ':''}${w?`! ${w} aviso${w===1?'':'s'}`:''}</button>`:`<span class="d-issues ok">✓ Sin problemas</span>`);
}
function issuesHTML(){
 const V=lastV||{issues:[],errors:[]};
 const li=V.issues.map(it=>`<li class="${it.level==='error'?'err':'warn'}"><span class="d-mark">${it.level==='error'?'✕':'!'}</span><span class="d-txt">${esc(it.msg)}</span>${it.rack?`<button class="btn small" data-d="goto-rack" data-id="${esc(it.rack)}" type="button">Ir al rack ${esc(it.rack)}</button>`:''}${it.conn?`<button class="btn small" data-d="pair-issue" data-floor="${esc(it.floor||'')}" data-conn="${esc(it.conn)}" type="button">Crear par</button>`:''}</li>`).join('');
 return `<div class="d-pop-head"><b>Revisión</b><button type="button" data-d="pop-close" aria-label="Cerrar">×</button></div><div class="d-pop-body d-body">${li?`<ul class="d-list">${li}</ul>`:`<div class="d-ok">${ctx.I('check')}Estructura lista para guardar.</div>`}</div>`;
}

// ---------- floating editor (right-click / double-click) ----------
let pop=null,lastDown=null;
const popTitle={rack:'Mueble',section:'Sección',dock:'Zona de recepción',conn:'Conexión',vertex:'Vértice del contorno'};
function popHTML(){
 const x=`<button type="button" data-d="pop-close" aria-label="Cerrar">×</button>`;
 if(pop.mode==='issues')return issuesHTML();
 if(pop.mode==='floor')return `<div class="d-pop-head"><b>Planta y contorno</b>${x}</div><div class="d-pop-body">${floorOutlineHTML()}</div>`;
 if(pop.mode==='menu'){
  const sec=pop.sec?`<button type="button" data-d="ctx-edit" data-k="section" data-id="${esc(pop.sec.id)}">Editar «${esc(pop.sec.name)}»</button><hr>`:'';
  return `<div class="d-pop-head"><b>Agregar aquí</b>${x}</div><div class="d-menu">${sec}<button type="button" data-d="ctx-add" data-what="rack">Mueble (rack)</button><button type="button" data-d="ctx-add" data-what="section">Sección</button><button type="button" data-d="ctx-add" data-what="dock">Zona de recepción</button><button type="button" data-d="ctx-add" data-what="conn">Escalera / montacargas</button><hr><button type="button" data-d="ctx-floor">Planta y contorno…</button></div>`;
 }
 const body=sel?selectedPanel():'';
 if(!body){pop=null;return ''}
 return `<div class="d-pop-head"><b>${popTitle[sel.k]||'Elemento'}</b>${x}</div><div class="d-pop-body d-body">${body}</div>`;
}
function renderPop(){
 let el=$('#d-pop');
 if(!pop||!$('#designer-canvas')){el?.remove();if(!$('#designer-canvas'))pop=null;return}
 const html=popHTML();
 if(!pop){el?.remove();return}
 if(!el){el=document.createElement('div');el.id='d-pop';el.className='d-pop';el.setAttribute('role','dialog');el.setAttribute('aria-label','Editar elemento');document.body.appendChild(el)}
 el.innerHTML=html;
 const w=pop.mode==='menu'?220:340,left=Math.max(8,Math.min(pop.x,window.innerWidth-w-12)),top=Math.max(8,Math.min(pop.y,window.innerHeight-140));
 el.style.width=w+'px';el.style.left=left+'px';el.style.top=top+'px';el.style.maxHeight=(window.innerHeight-top-12)+'px';
}
function openPop(mode,x,y,extra={}){pop={mode,x,y,...extra};renderPop()}
function closePop(){pop=null;$('#d-pop')?.remove()}
// ---------- editing ----------
const mark=()=>{dirty=true;if(!drag)commit();renderStatus()};
function normalizeSel(){
 if(!sel)return;
 const L=cur();
 if(sel.k==='rack'&&!L.racks.some(r=>r.id===sel.id))sel=null;
 if(sel.k==='section'&&!L.sections.some(s=>s.id===sel.id))sel=null;
 if(sel?.k==='dock'&&!(L.docks||[]).some(k=>k.id===sel.id))sel=null;
 if(sel?.k==='conn'&&!(L.connectors||[]).some(k=>k.id===sel.id))sel=null;
 if(sel?.k==='vertex'&&!L.outline[sel.id])sel=null;
}
function applyField(kind,name,raw){
 const L=cur();let v=raw;
 const numeric=!['name','category','color','label','kind','to'].includes(name);
 if(kind==='floor'){const f=cur();if(name==='name'){f.name=String(raw).trim()||f.name}else{if(raw===''||!Number.isFinite(Number(raw)))return;const n=Number(raw);if(name==='height')f.height=clamp(Math.round(n*10)/10,2,30);if(name==='elevation'&&fi>0)f.elevation=clamp(Math.round(n*10)/10,0,50)}mark();return}
 if(numeric){v=Number(raw);if(raw===''||!Number.isFinite(v))return}
 if(kind==='outline'){
  const bb=bounds(L.outline);
  if(name==='w')L.outline=resizeOutline(L.outline,clamp(v,4,120),bb.d);
  if(name==='d')L.outline=resizeOutline(L.outline,bb.w,clamp(v,4,120));
  if(name==='r')L.outline.forEach(p=>p.r=clamp(v,0,10));
 }
 if(kind==='vertex'){const p=L.outline[sel.id];if(name==='r')p.r=clamp(v,0,10);else p[name]=clamp(snap(v,.5),0,150)}
 if(kind==='rack'){
  const r=L.racks.find(r=>r.id===sel.id);
  if(['cols','levels','capacity'].includes(name))r[name]=Math.round(v);
  else if(name==='levelHeight')r.levelHeight=clamp(Math.round(v*100)/100,.3,3);
  else if(name==='x'||name==='y')r[name]=clamp(snap(v,.25),0,150);
  else r[name]=numeric?v:String(v);
 }
 if(kind==='section'){const s=L.sections.find(s=>s.id===sel.id);s[name]=numeric?(['w','h'].includes(name)?Math.max(1,snap(v,.5)):clamp(snap(v,.5),0,150)):v}
 if(kind==='conn'){const k=L.connectors.find(k=>k.id===sel.id);k[name]=numeric?(['w','d'].includes(name)?Math.max(.5,snap(v,.25)):clamp(snap(v,.25),0,150)):v}
 if(kind==='dock'){const k=L.docks.find(k=>k.id===sel.id);k[name]=numeric?(['w','d'].includes(name)?Math.max(.5,snap(v,.25)):clamp(snap(v,.25),0,150)):v}
 mark();
}
function worldPoint(e){
 const svg=$('#designer-svg');if(!svg)return null;
 const ctm=svg.getScreenCTM();if(!ctm)return null;
 const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(ctm.inverse()),v=viewFor(cur());
 return {x:(pt.x-v.ox)/v.s,y:(pt.y-v.oy)/v.s};
}
function startDrag(e,kind,id){
 const w=worldPoint(e);if(!w)return;
 const L=cur();let orig;
 if(kind==='rack')orig={...L.racks.find(r=>r.id===id)};
 if(kind==='section'||kind==='resize')orig={...L.sections.find(s=>s.id===id)};
 if(kind==='conn'||kind==='cresize')orig={...L.connectors.find(k=>k.id===id)};
 if(kind==='dock'||kind==='dresize')orig={...L.docks.find(k=>k.id===id)};
 if(kind==='vertex')orig={...L.outline[Number(id)]};
 drag={kind,id,w0:w,orig,moved:false};lockView=viewFor(L);
}
function moveDrag(e){
 if(!drag)return;
 const w=worldPoint(e);if(!w)return;
 const dx=w.x-drag.w0.x,dy=w.y-drag.w0.y,L=cur(),o=drag.orig;
 if(!drag.moved&&Math.hypot(dx,dy)*lockView.s<3)return;
 drag.moved=true;
 if(drag.kind==='rack'){const r=L.racks.find(r=>r.id===drag.id);r.x=clamp(snap(o.x+dx,.25),0,150);r.y=clamp(snap(o.y+dy,.25),0,150)}
 if(drag.kind==='section'){const s=L.sections.find(s=>s.id===drag.id);s.x=clamp(snap(o.x+dx,.5),0,150);s.y=clamp(snap(o.y+dy,.5),0,150)}
 if(drag.kind==='resize'){const s=L.sections.find(s=>s.id===drag.id);s.w=Math.max(1,snap(o.w+dx,.5));s.h=Math.max(1,snap(o.h+dy,.5))}
 if(drag.kind==='conn'){const k=L.connectors.find(k=>k.id===drag.id);k.x=clamp(snap(o.x+dx,.25),0,150);k.y=clamp(snap(o.y+dy,.25),0,150)}
 if(drag.kind==='cresize'){const k=L.connectors.find(k=>k.id===drag.id);k.w=Math.max(.5,snap(o.w+dx,.25));k.d=Math.max(.5,snap(o.d+dy,.25))}
 if(drag.kind==='dock'){const k=L.docks.find(k=>k.id===drag.id);k.x=clamp(snap(o.x+dx,.25),0,150);k.y=clamp(snap(o.y+dy,.25),0,150)}
 if(drag.kind==='dresize'){const k=L.docks.find(k=>k.id===drag.id);k.w=Math.max(.5,snap(o.w+dx,.25));k.d=Math.max(.5,snap(o.d+dy,.25))}
 if(drag.kind==='vertex'){const p=L.outline[Number(drag.id)];p.x=clamp(snap(o.x+dx,.5),0,150);p.y=clamp(snap(o.y+dy,.5),0,150)}
 mark();renderCanvas();
}
function endDrag(){
 if(!drag)return;
 const moved=drag.moved;drag=null;lockView=null;if(moved)commit();refresh();
}
function remove(){
 if(!sel)return;const L=cur();
 if(sel.k==='rack')L.racks=L.racks.filter(r=>r.id!==sel.id);
 else if(sel.k==='section')L.sections=L.sections.filter(s=>s.id!==sel.id);
 else if(sel.k==='dock')L.docks=L.docks.filter(k=>k.id!==sel.id);
 else if(sel.k==='conn')L.connectors=L.connectors.filter(k=>k.id!==sel.id);
 else if(sel.k==='vertex'){if(L.outline.length<=3){ctx.toast('El contorno necesita al menos 3 vértices.');return}L.outline.splice(Number(sel.id),1)}
 else return;
 sel=null;mark();refresh();
}
function save(){
 const L=draft,{errors}=validateLayout(L,ctx.state().lots);
 if(errors.length){ctx.toast(errors[0]);renderSide();return}
 const state=ctx.state();
 state.layout=clone(L);applyLayout(state.layout);ctx.persist();dirty=false;savedJSON=snapJSON();ctx.onSaved?.();refresh();
 ctx.toast(`Estructura guardada: ${L.floors.length} planta${L.floors.length===1?'':'s'}, ${allRacks(L).length} racks, ${L.floors.reduce((n,f)=>n+f.sections.length,0)} secciones y ${locationIds(L).length} posiciones.`);
}

function pairConnector(L,c){
 const T=draft.floors.find(f=>f.id===c.to);if(!T)return;
 const p=addConnector(draft,T);Object.assign(p,{kind:c.kind,label:c.label,w:c.w,d:c.d,to:L.id});
 const corners=[{x:c.x,y:c.y},{x:c.x+c.w,y:c.y},{x:c.x+c.w,y:c.y+c.d},{x:c.x,y:c.y+c.d}];
 const clear=!T.racks.some(r=>{const q=rackRect(r);return c.x<q.x+q.w&&q.x<c.x+c.w&&c.y<q.y+q.d&&q.y<c.y+c.d});
 const same=clear&&corners.every(q=>pointInPolygon(q,sampleOutline(T.outline)));
 if(same){p.x=c.x;p.y=c.y}
 mark();ctx.toast(`Se creó el par en ${T.name}${same?' en la misma posición':''}.`);refresh();
}
function elementSel(t){
 const kind=t.dataset.d,id=t.dataset.id??t.dataset.i;
 if(!['rack','section','dock','conn','vertex','resize','dresize','cresize'].includes(kind))return null;
 return {k:kind==='resize'?'section':kind==='dresize'?'dock':kind==='cresize'?'conn':kind,id:kind==='vertex'?Number(id):id};
}
function bind(){
 document.addEventListener('contextmenu',e=>{
  if(!draft||mode!=='2d'||!e.target.closest?.('#designer-svg'))return;
  e.preventDefault();
  const t=e.target.closest('[data-d]'),el=t&&elementSel(t),w=worldPoint(e);
  if(el&&el.k!=='section'){sel=el;refresh();openPop('sel',e.clientX,e.clientY);return}
  const sec=el&&el.k==='section'?cur().sections.find(s=>s.id===el.id):null;
  if(sec){sel=el;renderCanvas()}
  openPop('menu',e.clientX,e.clientY,{at:w?{x:snap(w.x,.25),y:snap(w.y,.25)}:{x:1,y:1},sec});
 });
 document.addEventListener('dblclick',e=>{
  if(!draft||mode!=='2d'||!e.target.closest?.('#designer-svg'))return;
  const t=e.target.closest('[data-d]'),el=t&&elementSel(t);
  if(el){sel=el;refresh();openPop('sel',e.clientX,e.clientY)}
 });
 document.addEventListener('pointerdown',e=>{
  if(!pop)return;
  if(e.target.closest?.('#d-pop')||e.target.closest?.('[data-d=issues-toggle]'))return;
  closePop();
 },true);
 window.addEventListener('hashchange',closePop);
 document.addEventListener('pointerdown',e=>{
  const svg=e.target.closest?.('#designer-svg');if(!svg||e.button>0)return;
  const t=e.target.closest('[data-d]');const kind=t?.dataset.d;
  const L=cur();
  if(!t||kind==='bg'||kind==='floor'){sel=null;refresh();return}
  e.preventDefault();
  if(kind==='addv'){const i=Number(t.dataset.i),n=L.outline.length,a=L.outline[i],b=L.outline[(i+1)%n];L.outline.splice(i+1,0,{x:snap((a.x+b.x)/2,.5),y:snap((a.y+b.y)/2,.5),r:0});sel={k:'vertex',id:i+1};mark();renderSide();startDrag(e,'vertex',String(i+1));renderCanvas();return}
  const id=t.dataset.id??t.dataset.i;
  const selKind=kind==='resize'?'section':kind==='dresize'?'dock':kind==='cresize'?'conn':kind;
  sel={k:selKind,id:kind==='vertex'?Number(id):id};
  const key=selKind+':'+sel.id,now=Date.now(),second=lastDown&&lastDown.key===key&&now-lastDown.t<380;lastDown={key,t:now};
  startDrag(e,kind,id);renderCanvas();renderSide();
  if(second){lastDown=null;openPop('sel',e.clientX,e.clientY)}
 });
 document.addEventListener('pointermove',moveDrag);
 document.addEventListener('pointerup',endDrag);
 document.addEventListener('pointercancel',endDrag);
 document.addEventListener('click',e=>{
  const t=e.target.closest?.('[data-d]');if(!t||!$('#designer-canvas')&&!$('#designer-side'))return;
  const k=t.dataset.d;if(['bg','floor','rack','section','dock','dresize','conn','cresize','vertex','addv','resize'].includes(k))return;
  if(!draft)return;const L=cur();
  if(k==='pop-close'){closePop();return}
  if(k==='issues-toggle'){if(pop?.mode==='issues')closePop();else{const r=t.getBoundingClientRect();openPop('issues',Math.max(8,r.right-340),r.bottom+6)}return}
  if(k==='ctx-floor'){pop={...pop,mode:'floor'};renderPop();return}
  if(k==='ctx-edit'){sel={k:t.dataset.k,id:t.dataset.id};pop={...pop,mode:'sel'};refresh();return}
  if(k==='ctx-add'){
   const at=pop?.at||{x:1,y:1},w=t.dataset.what;let made=null;
   if(w==='rack'){const r=addRack(draft,L,{x:Math.max(0,snap(at.x-1.5,.25)),y:Math.max(0,snap(at.y-.45,.25))});made={k:'rack',id:r.id}}
   if(w==='section'){const s=addSection(L,{x:Math.max(0,snap(at.x,.5)),y:Math.max(0,snap(at.y,.5))});made={k:'section',id:s.id}}
   if(w==='dock'){const z=addDock(L,{x:Math.max(0,snap(at.x-1.1,.25)),y:Math.max(0,snap(at.y-.5,.25))});made={k:'dock',id:z.id}}
   if(w==='conn'){if(draft.floors.length<2){ctx.toast('Crea primero otra planta o entrepiso para poder conectarla.');closePop();return}const c=addConnector(draft,L,{x:Math.max(0,snap(at.x,.25)),y:Math.max(0,snap(at.y,.25))});made={k:'conn',id:c.id}}
   if(made){sel=made;pop={...pop,mode:'sel'};mark();refresh()}
   return}
  if(k==='mode'){const next=t.dataset.mode;if(next!==mode)cameraTransition({box:'#designer-canvas',dir:next==='3d'?'in':'out',frame:t=>previewSVG(t),render:()=>{mode=next;designerPage()}});return}
  if(k==='save'){save();return}
  if(k==='discard'){draft=clone(ctx.state().layout);resetHist();lastKeys=null;sel=null;dirty=false;designerPage();ctx.toast('Se descartaron los cambios sin guardar.');return}
  if(k==='floor-tab'){fi=Number(t.dataset.i);sel=null;if(mode==='3d'&&previewFloor!=='*'){previewFloor=draft.floors[fi].id;previewSection=''}refresh();return}
  if(k==='add-floor'){const f=addFloor(draft,t.dataset.kind);fi=draft.floors.indexOf(f);sel=null;mark();refresh();return}
  if(k==='del-floor'){if(fi>0){draft.floors.splice(fi,1);fi=Math.max(0,fi-1);sel=null;mark();refresh()}return}
  if(k==='reset-default'){draft=defaultLayout();fi=0;sel=null;closePop();mark();designerPage();ctx.toast('Se cargó la bodega de ejemplo. Guarda para aplicarla.');return}
  if(k==='preset'){const bb=bounds(L.outline),r=L.outline[0]?.r||0;L.outline=presetOutline(t.dataset.kind,bb.w,bb.d,r);mark();refresh();return}
  if(k==='add-rack'){const bb=bounds(L.outline),r=addRack(draft,L,{x:snap(bb.x+bb.w/2-1.5,.25),y:snap(bb.y+bb.d/2,.25)});sel={k:'rack',id:r.id};mark();refresh();return}
  if(k==='dup-rack'){const o=L.racks.find(r=>r.id===sel?.id);if(!o)return;const r=addRack(draft,L,{x:o.x+1,y:o.y+1.2});Object.assign(r,{name:o.name+' (copia)',category:o.category,rot:o.rot,cols:o.cols,levels:o.levels,capacity:o.capacity,levelHeight:o.levelHeight});sel={k:'rack',id:r.id};mark();refresh();return}
  if(k==='add-conn'){if(draft.floors.length<2){ctx.toast('Crea primero otra planta o entrepiso para poder conectarla.');return}const bb=bounds(L.outline),c=addConnector(draft,L);sel={k:'conn',id:c.id};mark();refresh();return}
  if(k==='pair-conn'){const c=(L.connectors||[]).find(k=>k.id===sel?.id);if(c)pairConnector(L,c);return}
  if(k==='pair-issue'){const f=draft.floors.find(f=>f.id===t.dataset.floor)||L,c=(f.connectors||[]).find(k=>k.id===t.dataset.conn);if(c){fi=draft.floors.indexOf(f);sel={k:'conn',id:c.id};pairConnector(f,c);if(pop)pop={...pop,mode:'issues'}}return}
  if(k==='goto-rack'){const i=draft.floors.findIndex(f=>f.racks.some(r=>r.id===t.dataset.id));if(i>=0){fi=i;sel={k:'rack',id:t.dataset.id};if(pop)pop={...pop,mode:'sel'};refresh()}return}
  if(k==='lvl-inc'||k==='lvl-dec'){const r=L.racks.find(r=>r.id===sel?.id);if(r){const mx=maxLevels(draft,L,r);if(k==='lvl-inc'&&r.levels<mx)r.levels++;else if(k==='lvl-dec'&&r.levels>1)r.levels--;mark();refresh()}return}
  if(k==='undo'){undo();return}
  if(k==='redo'){redo();return}
  if(k==='tool-select'){sel=null;refresh();return}
  if(k==='tool-outline'){sel={k:'vertex',id:0};refresh();ctx.toast('Arrastra los puntos blancos para mover el contorno; el + de cada arista agrega un vértice.');return}
  if(k==='rotate-conn'){const c=(L.connectors||[]).find(k=>k.id===sel?.id);if(c){[c.w,c.d]=[c.d,c.w];mark();refresh()}return}
  if(k==='add-dock'){const bb=bounds(L.outline),d=addDock(L,{x:snap(bb.x+1,.25),y:snap(bb.y+bb.d-1.5,.25)});sel={k:'dock',id:d.id};mark();refresh();return}
  if(k==='rotate-dock'){const d=L.docks.find(k=>k.id===sel?.id);if(d){[d.w,d.d]=[d.d,d.w];mark();refresh()}return}
  if(k==='dup-dock'){const o=L.docks.find(k=>k.id===sel?.id);if(!o)return;const d=addDock(L,{x:o.x+.5,y:o.y+.5});Object.assign(d,{w:o.w,d:o.d,label:o.label+' (copia)'});sel={k:'dock',id:d.id};mark();refresh();return}
  if(k==='add-section'){const bb=bounds(L.outline),s=addSection(L,{x:snap(bb.x+1,.5),y:snap(bb.y+1,.5)});sel={k:'section',id:s.id};mark();refresh();return}
  if(k==='rotate'){const r=L.racks.find(r=>r.id===sel?.id);if(r){r.rot=r.rot===90?0:90;mark();refresh()}return}
  if(k==='delete'){remove();return}
 });
 document.addEventListener('change',e=>{
  const t=e.target;if(!draft)return;
  if(t.id==='d-preview-floor'){previewFloor=t.value;previewSection='';renderTools();renderCanvas();return}
  if(t.id==='d-preview-section'){previewSection=t.value;renderCanvas();return}
  if(!t.dataset?.f)return;
  applyField(t.dataset.f,t.name,t.value);normalizeSel();refresh();
 });
 document.addEventListener('keydown',e=>{
  if(!draft||!$('#designer-canvas'))return;
  if(e.key==='Escape'&&pop){closePop();return}
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return}
  if(mode!=='2d')return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove()}
  if((e.key==='r'||e.key==='R')&&sel?.k==='rack'){const r=cur().racks.find(r=>r.id===sel.id);if(r){r.rot=r.rot===90?0:90;mark();refresh()}}
 });
}
