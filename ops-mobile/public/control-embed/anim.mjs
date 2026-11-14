// Zoom-style transition between two renderings of the same map (2D plan <-> 3D <-> front).
// `render()` swaps the DOM; the previous <svg> is kept as a "ghost" that fades and scales away
// while the new one scales and fades in, so the view reads as moving closer (dir "in") or farther ("out").
const DURATION=560,EASE='cubic-bezier(.22,.8,.24,1)';

export function animateSwitch(containerSel,dir,origin,render){
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const old=document.querySelector(containerSel+' svg');
 if(reduce||!old||!old.animate){render();return}
 const ghost=old.cloneNode(true);
 render();
 const box=document.querySelector(containerSel),next=box?.querySelector('svg');
 if(!box||!next||!next.animate)return;
 // ids inside the clone must not capture clip-paths of the new drawing
 ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
 ghost.setAttribute('aria-hidden','true');
 ghost.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2';
 const o=origin||'50% 50%',into=dir==='in';
 ghost.style.transformOrigin=o;next.style.transformOrigin=o;
 box.appendChild(ghost);
 const gone=into?1.55:.6,start=into?.6:1.55;
 ghost.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:`scale(${gone})`}],{duration:DURATION,easing:EASE,fill:'forwards'}).finished.then(()=>ghost.remove(),()=>ghost.remove());
 next.animate([{opacity:0,transform:`scale(${start})`},{opacity:1,transform:'scale(1)'}],{duration:DURATION,easing:EASE}).finished.then(()=>{next.style.transformOrigin=''},()=>{});
}

// Where (as % of the container) an element sits, to zoom in from it. null if it is outside.
export function originOf(containerSel,el){
 const c=document.querySelector(containerSel);if(!c||!el||!c.contains(el))return null;
 const cr=c.getBoundingClientRect(),r=el.getBoundingClientRect();
 if(!cr.width||!cr.height)return null;
 return `${((r.left+r.width/2-cr.left)/cr.width*100).toFixed(1)}% ${((r.top+r.height/2-cr.top)/cr.height*100).toFixed(1)}%`;
}

// Real camera move between the top view (2D plan) and the isometric 3D view.
// `frame(t)` returns the SVG for camera blend t (0 = seen from above, 1 = isometric); every frame is a fresh
// projection, so the plan tilts and turns while the racks rise. `render()` swaps the DOM to the final view.
//   dir "in"  : plan -> 3D  (t: 0 -> 1), the old plan fades out over the first moments
//   dir "out" : 3D -> plan  (t: 1 -> 0), the new plan fades in over the last moments
export function cameraTransition({box:sel,dir,frame,render,duration=900}){
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const old=document.querySelector(sel+' svg');
 if(reduce||!old){render();return}
 const into=dir==='in',ghost=into?old.cloneNode(true):null;
 render();
 const box=document.querySelector(sel),fin=box?.querySelector('svg');
 if(!box||!fin)return;
 const layer=document.createElement('div');
 layer.setAttribute('aria-hidden','true');
 layer.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2';
 const draw=t=>{layer.innerHTML=frame(t);const s=layer.firstElementChild;if(s)s.style.cssText='display:block;width:100%;height:100%'};
 fin.style.visibility='hidden';
 draw(into?0:1);
 box.appendChild(layer);
 if(ghost){
  ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
  ghost.setAttribute('aria-hidden','true');
  ghost.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3';
  box.appendChild(ghost);
  ghost.animate([{opacity:1},{opacity:0}],{duration:duration*.4,easing:'ease-out',fill:'forwards'}).finished.then(()=>ghost.remove(),()=>ghost.remove());
 }
 const ease=u=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2,t0=performance.now();
 const step=now=>{
  const u=Math.min(1,(now-t0)/duration),e=ease(u);
  draw(into?e:1-e);
  if(!into&&u>.7){fin.style.visibility='visible';fin.style.opacity=String((u-.7)/.3)}
  if(u<1){requestAnimationFrame(step);return}
  fin.style.visibility='';fin.style.opacity='';layer.remove();ghost?.remove();
 };
 requestAnimationFrame(step);
}
