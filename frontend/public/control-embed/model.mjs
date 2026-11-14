export const KEY='opticlean-control-v1';
export const categories=['Hogar','Industrial','Institucional','Hospitalaria'];
import {defaultLayout,locId,normalizeLayout} from './layout.mjs?v=20261109a';
// `racks` and `locations` are live arrays derived from the layout. applyLayout refills them in place,
// so every module that imported them keeps seeing the current warehouse structure.
export const racks=[];
export const locations=[];
export function applyLayout(layout){
 racks.length=0;locations.length=0;
 for(const f of layout.floors)for(const r of f.racks){
  racks.push({...r,floor:f.id,elevation:f.elevation});
  for(let level=1;level<=r.levels;level++)for(let pos=1;pos<=r.cols;pos++)locations.push({id:locId(r.id,level,pos),rack:r.id,level,pos,floor:f.id,capacity:r.capacity||60,category:r.category});
 }
}
export {defaultLayout,normalizeLayout};
applyLayout(defaultLayout());
export const money=n=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(n);
export const num=n=>new Intl.NumberFormat('es-EC').format(n);
export const defaultVehicles=()=>[{id:'GBA-2041',driver:'Luis Paredes',maxKg:650,maxL:8000},{id:'PCH-7788',driver:'Marco Vera',maxKg:1500,maxL:14000}];
export const isBlocked=(s,loc)=>!!s.blocked?.some(b=>b.loc===loc);
export function seed(){
 const layout=defaultLayout();applyLayout(layout);
 const products=[
  ['P001','Limpiador multiusos 1 L','Hogar','Química Andina',2.5,30,1.05,1.2],
  ['P005','Desengrasante industrial 5 L','Industrial','Química Andina',12.5,24,5.2,6],
  ['P008','Desinfectante 1 L','Hospitalaria','Higiene Pro',3.1,25,1.05,1.2],
  ['P012','Papel higiénico institucional','Institucional','Papelera del Ecuador',18.9,20,3,18],
  ['P015','Limpiavidrios 5 L','Hogar','Química Andina',6.75,20,5.1,6],
  ['P018','Cloro 5 L','Industrial','Química Andina',4.75,25,5.4,6],
  ['P025','Toallas de papel · paquete','Institucional','Papelera del Ecuador',9.8,18,1.8,10],
  ['P032','Limpiador de pisos 5 L','Hogar','Limpieza Total',8.5,20,5.1,6],
  ['P045','Jabón líquido 1 L','Hospitalaria','Higiene Pro',4.2,25,1.1,1.2],
  ['P052','Guantes de nitrilo · caja','Hospitalaria','Higiene Pro',7.5,12,.5,2],
  ['P061','Detergente industrial 5 kg','Industrial','Limpieza Total',14.9,20,5,7],
  ['P078','Fundas de basura · paquete','Institucional','EcoSuministros',3.8,20,1,3]
 ].map(([id,name,category,supplier,price,min,weight,volume])=>({id,sku:id,name,category,supplier,price,min,weight,volume}));
 const lots=[];
 for(const [i,loc] of locations.entries()){
  if(i%4===3 || i%11===0)continue;
  const options=products.filter(p=>p.category===loc.category && p.id!=='P015');
  const p=options[(i+Math.floor(i/4))%options.length];
  lots.push({id:`lot-${i}`,productId:p.id,loc:loc.id,qty:12+(i*7%33),batch:`LT-26${String(i+1).padStart(3,'0')}`,expiry:`2027-${String(2+i%9).padStart(2,'0')}-28`});
 }
 lots.push({id:'lot-limpiavidrios',productId:'P015',loc:'A-01-01',qty:8,batch:'LT-26018',expiry:'2027-02-18'});
 const clients=[{id:'CL001',name:'Hotel Alameda',contact:'María Torres',address:'Av. Amazonas, Quito',email:'compras@alameda.example',type:'Hotelería'},{id:'CL002',name:'Clínica del Norte',contact:'Andrés Molina',address:'Av. 6 de Diciembre, Quito',email:'compras@clinicanorte.example',type:'Salud'},{id:'CL003',name:'Corporación Horizonte',contact:'Carolina Ruiz',address:'Av. República, Quito',email:'compras@horizonte.example',type:'Corporativo'},{id:'CL004',name:'Restaurante La Terraza',contact:'Diego Salazar',address:'La Floresta, Quito',email:'compras@laterraza.example',type:'Restauración'}];
 const orders=[{id:'PED-1048',clientId:'CL001',status:'Por preparar',date:'2026-10-27',lines:[{productId:'P001',qty:12},{productId:'P025',qty:8}],priority:'Alta'},{id:'PED-1047',clientId:'CL002',status:'Por preparar',date:'2026-10-27',lines:[{productId:'P008',qty:20},{productId:'P052',qty:10}],priority:'Normal'},{id:'PED-1046',clientId:'CL003',status:'Preparado',date:'2026-10-27',lines:[{productId:'P012',qty:6},{productId:'P045',qty:12}],priority:'Normal'},{id:'PED-1045',clientId:'CL004',status:'En ruta',date:'2026-10-27',lines:[{productId:'P005',qty:4},{productId:'P018',qty:6}],priority:'Normal',vehicle:'GBA-2041'},{id:'PED-1044',clientId:'CL001',status:'Entregado',date:'2026-10-26',lines:[{productId:'P001',qty:10},{productId:'P025',qty:6}],priority:'Normal'}];
 const events=[{id:'ev-3',type:'Recepción',productId:'P001',qty:24,from:'Química Andina',to:'A-02-01',at:'2026-10-27T13:42:00Z',ref:'REC-0083',by:'Elena R.'},{id:'ev-2',type:'Traslado',productId:'P008',qty:12,from:'F-03-02',to:'F-01-01',at:'2026-10-27T13:18:00Z',ref:'MOV-0032',by:'Elena R.'},{id:'ev-1',type:'Despacho',productId:'P005',qty:4,from:'C-01-01',to:'PED-1045',at:'2026-10-27T12:50:00Z',ref:'PED-1045',by:'Elena R.'}];
 return {version:1,layout,products,lots,clients,orders,events,purchases:[],receipts:[{id:'REC-0083',supplier:'Química Andina',date:'2026-10-27',productId:'P001',qty:24,loc:'A-02-01',batch:'LT-26025'}],blocked:[],staging:[],vehicles:defaultVehicles(),settings:{company:'OPTICLEAN AI',warehouse:'Bodega principal · Quito',operator:'Elena R.'}};
}
export const todayEC=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
export const stock=(s,id)=>s.lots.filter(l=>l.productId===id).reduce((n,l)=>n+l.qty,0);
// Units whose expiry date has passed: they stay physically in the rack until written off, but cannot be sold or picked.
export const expiredQty=(s,id)=>{const t=todayEC();return s.lots.filter(l=>l.productId===id&&l.expiry<t).reduce((n,l)=>n+l.qty,0)};
export const reserved=(s,id)=>s.orders.filter(o=>o.status==='Por preparar').reduce((n,o)=>n+o.lines.filter(l=>l.productId===id).reduce((a,l)=>a+l.qty,0),0);
export const available=(s,id)=>stock(s,id)-expiredQty(s,id)-reserved(s,id);
export const qtyAt=(s,loc)=>s.lots.filter(l=>l.loc===loc).reduce((n,l)=>n+l.qty,0);
export const product=(s,id)=>s.products.find(p=>p.id===id);
export const client=(s,id)=>s.clients.find(c=>c.id===id);
export const orderValue=(s,o)=>o.lines.reduce((n,l)=>n+l.qty*product(s,l.productId).price,0);
export const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
export function event(s,type,productId,qty,from,to,ref,batch=''){s.events.unshift({id:uid('ev'),type,productId,qty,from,to,ref,batch,at:new Date().toISOString(),by:s.settings.operator})}
export function suggest(s,productId,qty=1,exclude=''){
 const p=product(s,productId);
 return locations.filter(l=>l.id!==exclude && !isBlocked(s,l.id) && qtyAt(s,l.id)+qty<=l.capacity && s.lots.filter(t=>t.loc===l.id).every(t=>t.productId===productId)).sort((a,b)=>{
  const score=l=>(l.category===p.category?100:0)+(s.lots.some(t=>t.loc===l.id&&t.productId===productId)?40:0)+(4-l.level)*3+(l.rack<'D'?2:0)-((racks.find(r=>r.id===l.rack)?.elevation||0)>0?2:0);
  return score(b)-score(a);
 });
}
export const isOpenPurchase=o=>['Solicitada','Recibida parcial',undefined].includes(o.status);
export const pendingPurchase=(s,productId)=>s.purchases.filter(o=>o.productId===productId&&isOpenPurchase(o)).reduce((n,o)=>n+Math.max(0,Number(o.qty)-(o.received||0)),0);
export function cancelPurchase(s,id){const o=s.purchases.find(o=>o.id===id);if(!o||!isOpenPurchase(o))throw Error('Esta solicitud ya está cerrada.');o.status='Cancelada'}
export function receive(s,{productId,qty,loc,batch,expiry,supplier,purchaseId}){
 qty=Number(qty); const target=locations.find(l=>l.id===loc);
 if(!product(s,productId)||!Number.isInteger(qty)||qty<=0||!target)throw Error('Selecciona un producto, una ubicación y una cantidad entera mayor a cero.');
 if(isBlocked(s,loc))throw Error('Esta ubicación está bloqueada.');
 if(qtyAt(s,loc)+qty>target.capacity)throw Error(`La cantidad supera la capacidad de esta ubicación (${target.capacity} unidades).`);
 if(s.lots.some(l=>l.loc===loc&&l.productId!==productId))throw Error('Esta ubicación contiene otro producto. Selecciona una ubicación compatible.');
 if(!batch?.trim()||!expiry)throw Error('Completa el lote y la fecha de vencimiento.');
 if(expiry<new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'}))throw Error('La fecha de vencimiento no puede estar en el pasado.');
 let po=null;
 if(purchaseId){po=s.purchases.find(o=>o.id===purchaseId);if(!po||po.productId!==productId||!isOpenPurchase(po))throw Error('La orden de compra no corresponde a este producto o ya está cerrada.')}
 const id=`REC-${String(84+s.receipts.length-1).padStart(4,'0')}`;
 if(po){po.received=(po.received||0)+qty;po.status=po.received>=Number(po.qty)?'Recibida':'Recibida parcial'}
 s.lots.push({id:uid('lot'),productId,qty,loc,batch:batch.trim(),expiry});
 s.receipts.unshift({id,productId,qty,loc,batch,supplier,date:new Date().toISOString().slice(0,10)});
 event(s,'Recepción',productId,qty,supplier,loc,id,batch.trim()); return id;
}
export function move(s,{lotId,qty,to}){
 const lot=s.lots.find(l=>l.id===lotId); const target=locations.find(l=>l.id===to); qty=Number(qty);
 if(!lot||!target||!Number.isInteger(qty)||qty<=0||qty>lot.qty)throw Error('Revisa la cantidad disponible y el destino.');
 if(lot.loc===to)throw Error('El destino debe ser diferente al origen.');
 if(isBlocked(s,to))throw Error('La ubicación de destino está bloqueada.');
 if(qtyAt(s,to)+qty>target.capacity)throw Error('La ubicación de destino no tiene capacidad suficiente.');
 if(s.lots.some(l=>l.loc===to&&l.productId!==lot.productId))throw Error('El destino contiene otro producto.');
 const from=lot.loc; lot.qty-=qty;
 s.lots.push({...lot,id:uid('lot'),qty,loc:to});s.lots=s.lots.filter(l=>l.qty>0);
 event(s,'Traslado',lot.productId,qty,from,to,uid('MOV'),lot.batch);
}
export function createOrder(s,{clientId,lines,priority='Normal'}){
 if(!client(s,clientId)||!lines.length)throw Error('Selecciona un cliente y al menos un producto.');
 const grouped=new Map();for(const l of lines)grouped.set(l.productId,(grouped.get(l.productId)||0)+Number(l.qty));
 lines=[...grouped].map(([productId,qty])=>({productId,qty}));
 for(const l of lines)if(!product(s,l.productId)||!Number.isInteger(l.qty)||l.qty<=0||l.qty>available(s,l.productId))throw Error(`Stock insuficiente o cantidad inválida para ${product(s,l.productId)?.name||'el producto'}.`);
 const n=Math.max(1048,...s.orders.map(o=>Number(o.id.split('-')[1])))+1;
 const o={id:`PED-${n}`,clientId,lines,priority,status:'Por preparar',date:new Date().toISOString().slice(0,10)};
 s.orders.unshift(o);return o;
}
const elevOf=id=>{const l=locations.find(x=>x.id===id);return racks.find(r=>r.id===l?.rack)?.elevation||0};
// FEFO selection that never throws: returns the lots to take and the units that could not be covered.
function fefo(s,productId,qty,skip=new Set()){
 const today=todayEC(),plan=[];let left=qty;
 const lots=s.lots.filter(l=>l.productId===productId&&l.qty>0&&l.expiry>=today&&!skip.has(l.id)).sort((a,b)=>a.expiry.localeCompare(b.expiry));
 for(const l of lots){if(!left)break;const q=Math.min(l.qty,left);plan.push({...l,qty:q,floor:locations.find(x=>x.id===l.loc)?.floor});left-=q}
 return {plan,left};
}
const walk=plan=>plan.sort((a,b)=>(elevOf(a.loc)-elevOf(b.loc))||a.loc.localeCompare(b.loc));
export function pickPlan(s,order){
 const plan=[];
 for(const line of order.lines){const {plan:p,left}=fefo(s,line.productId,line.qty);if(left)throw Error(`Faltan ${left} unidades de ${product(s,line.productId).name}.`);plan.push(...p)}
 // Walk the ground floor first, then climb.
 return walk(plan);
}
function takePicks(s,o,picks){
 s.staging??=[];
 for(const p of picks){
  s.lots.find(l=>l.id===p.id).qty-=p.qty;
  event(s,'Preparación',p.productId,p.qty,p.loc,'Zona de despacho',o.id,p.batch);
  s.staging.push({id:uid('stg'),zone:'Despacho',productId:p.productId,qty:p.qty,batch:p.batch,expiry:p.expiry,orderId:o.id,from:p.loc,at:new Date().toISOString()});
 }
 s.lots=s.lots.filter(l=>l.qty>0);
}
// shorts: {lotId: unitsActuallyFound}. Missing units are written off as a picking shortfall and replaced FEFO from other lots when possible.
export function prepare(s,orderId,{shorts={}}={}){
 const o=s.orders.find(o=>o.id===orderId);if(!o||o.status!=='Por preparar')throw Error('Este pedido ya no está pendiente de preparación.');
 const plan=pickPlan(s,o);
 for(const [id,f] of Object.entries(shorts)){const p=plan.find(x=>x.id===id);if(p&&(!Number.isInteger(Number(f))||Number(f)<0||Number(f)>p.qty))throw Error('La cantidad hallada debe ser un entero entre 0 y la cantidad pedida.')}
 const final=[],lost=new Set();
 for(const p of plan){
  const f=shorts[p.id];
  if(f===undefined||Number(f)>=p.qty){final.push(p);continue}
  const found=Number(f),miss=p.qty-found,lot=s.lots.find(l=>l.id===p.id);
  lot.qty-=miss;lost.add(lot.id);
  event(s,'Ajuste',p.productId,miss,`${p.loc} · faltante en picking`,'Faltante',uid('AJU'),p.batch);
  if(found>0)final.push({...p,qty:found});
 }
 takePicks(s,o,final);
 const picks=[...final],backorder=[];
 for(const line of o.lines){
  const got=picks.filter(p=>p.productId===line.productId).reduce((n,p)=>n+p.qty,0);
  if(got>=line.qty)continue;
  const {plan:rep,left}=fefo(s,line.productId,line.qty-got,lost);
  takePicks(s,o,rep);picks.push(...rep);
  if(left)backorder.push({productId:line.productId,qty:left});
 }
 if(backorder.length){
  o.backorder=backorder;o.partial=true;
  o.lines=o.lines.map(l=>({...l,qty:picks.filter(p=>p.productId===l.productId).reduce((n,p)=>n+p.qty,0)})).filter(l=>l.qty>0);
 }
 if(!picks.length){o.status='Cancelado';o.cancelReason='Sin stock tras faltantes de picking';return o}
 o.picks=walk(picks).map(p=>({productId:p.productId,qty:p.qty,batch:p.batch,loc:p.loc,expiry:p.expiry}));o.status='Preparado';return o;
}
export const orderWeight=(s,o)=>o.lines.reduce((n,l)=>n+l.qty*product(s,l.productId).weight,0);
export const orderVolume=(s,o)=>o.lines.reduce((v,l)=>v+l.qty*product(s,l.productId).volume,0);
export const vehicleLoad=(s,vid)=>{const os=s.orders.filter(o=>o.vehicle===vid&&['En ruta','Incidencia'].includes(o.status));return {kg:os.reduce((n,o)=>n+orderWeight(s,o),0),l:os.reduce((n,o)=>n+orderVolume(s,o),0),orders:os.length}};
export function dispatch(s,ids,vehicleId){
 const orders=s.orders.filter(o=>ids.includes(o.id)),v=s.vehicles?.find(v=>v.id===vehicleId);
 if(!v)throw Error('Selecciona un vehículo.');
 if(!orders.length||orders.some(o=>o.status!=='Preparado'))throw Error('Selecciona pedidos preparados.');
 const cur=vehicleLoad(s,vehicleId);
 if(cur.kg+orders.reduce((n,o)=>n+orderWeight(s,o),0)>v.maxKg)throw Error(`La carga supera la capacidad de ${v.maxKg} kg del vehículo ${v.id}.`);
 if(cur.l+orders.reduce((n,o)=>n+orderVolume(s,o),0)>v.maxL)throw Error(`La carga supera la capacidad de ${v.maxL/1000} m³ del vehículo ${v.id}.`);
 for(const o of orders){o.status='En ruta';o.vehicle=vehicleId;for(const line of (o.picks||o.lines))event(s,'Despacho',line.productId,line.qty,'Zona de despacho',client(s,o.clientId).name,o.id,line.batch||'')}
 s.staging=(s.staging||[]).filter(x=>!(x.zone==='Despacho'&&ids.includes(x.orderId)));
}
export function addVehicle(s,{id,driver,maxKg,maxL}){
 id=String(id||'').trim().toUpperCase();maxKg=Number(maxKg);maxL=Number(maxL);
 if(!id||!(maxKg>0)||!(maxL>0))throw Error('Completa placa, capacidad en kg y volumen en litros.');
 if(s.vehicles.some(v=>v.id===id))throw Error('Ya existe un vehículo con esa placa.');
 s.vehicles.push({id,driver:String(driver||'').trim(),maxKg,maxL});
}
// Inventory control: cycle-count adjustment and write-off (expired, damaged...). Both leave a trace event.
export function adjust(s,{lotId,qty,reason}){
 const lot=s.lots.find(l=>l.id===lotId);qty=Number(qty);
 if(!lot||!Number.isInteger(qty)||qty<0)throw Error('Indica la cantidad contada (entero, cero o mayor).');
 if(!reason?.trim())throw Error('Escribe el motivo del ajuste.');
 if(qty===lot.qty)throw Error('La cantidad contada es igual a la registrada.');
 const target=locations.find(l=>l.id===lot.loc);
 if(qty>lot.qty&&target&&qtyAt(s,lot.loc)-lot.qty+qty>target.capacity)throw Error(`El conteo supera la capacidad de la ubicación (${target.capacity} unidades).`);
 const old=lot.qty;lot.qty=qty;s.lots=s.lots.filter(l=>l.qty>0);
 event(s,'Ajuste',lot.productId,Math.abs(qty-old),`${lot.loc} · ${old} u.`,`${qty} u. · ${reason.trim()}`,uid('AJU'),lot.batch);
}
export function writeOff(s,{lotId,qty,reason}){
 const lot=s.lots.find(l=>l.id===lotId);qty=Number(qty);
 if(!lot||!Number.isInteger(qty)||qty<=0||qty>lot.qty)throw Error('Revisa la cantidad a dar de baja.');
 if(!reason?.trim())throw Error('Escribe el motivo de la baja.');
 lot.qty-=qty;s.lots=s.lots.filter(l=>l.qty>0);
 event(s,'Baja',lot.productId,qty,lot.loc,reason.trim(),uid('BAJ'),lot.batch);
}
// Put prepared goods back on the shelves (original position if it still fits, otherwise the best compatible one). All or nothing.
function restock(s,o,type,from){
 const picks=o.picks;
 if(!picks?.length)throw Error('Este pedido no tiene lotes registrados para devolver a bodega.');
 const added=[],view={...s,lots:s.lots};
 for(const p of picks){
  view.lots=[...s.lots,...added];
  const fits=l=>l&&qtyAt(view,l.id)+p.qty<=l.capacity&&view.lots.filter(t=>t.loc===l.id).every(t=>t.productId===p.productId);
  const orig=locations.find(l=>l.id===p.loc),target=fits(orig)?orig:suggest(view,p.productId,p.qty)[0];
  if(!target)throw Error(`No hay ubicación libre para devolver ${p.qty} u. de ${product(s,p.productId)?.name||p.productId}.`);
  added.push({id:uid('lot'),productId:p.productId,loc:target.id,qty:p.qty,batch:p.batch,expiry:p.expiry});
 }
 s.lots.push(...added);
 added.forEach(l=>event(s,type,l.productId,l.qty,from,l.loc,o.id,l.batch));
}
export function cancelOrder(s,orderId,reason=''){
 const o=s.orders.find(o=>o.id===orderId);
 if(!o||!['Por preparar','Preparado'].includes(o.status))throw Error('Solo se pueden cancelar pedidos por preparar o preparados.');
 if(o.status==='Preparado'){restock(s,o,'Devolución','Zona de despacho');s.staging=(s.staging||[]).filter(x=>!(x.zone==='Despacho'&&x.orderId===o.id))}
 o.status='Cancelado';o.cancelReason=reason.trim();delete o.picks;
}
// A failed delivery comes back to the «Devoluciones» zone, where it is inspected before being put away or written off.
export function returnOrder(s,orderId){
 const o=s.orders.find(o=>o.id===orderId);
 if(!o||o.status!=='Incidencia')throw Error('Solo se pueden devolver pedidos con novedad de entrega.');
 if(!o.picks?.length)throw Error('Este pedido no tiene lotes registrados para devolver a bodega.');
 s.staging??=[];
 for(const p of o.picks){
  s.staging.push({id:uid('stg'),zone:'Devoluciones',productId:p.productId,qty:p.qty,batch:p.batch,expiry:p.expiry,orderId:o.id,from:'Vehículo '+(o.vehicle||''),at:new Date().toISOString()});
  event(s,'Devolución',p.productId,p.qty,'Vehículo '+(o.vehicle||''),'Zona de devoluciones',o.id,p.batch);
 }
 o.status='Devuelto';delete o.picks;delete o.vehicle;
}
export const stagingZones=['Despacho','Devoluciones','Cuarentena'];
export function putAway(s,{id,loc,qty}){
 const it=s.staging?.find(x=>x.id===id),target=locations.find(l=>l.id===loc);qty=Number(qty||it?.qty);
 if(!it||!target||!Number.isInteger(qty)||qty<=0||qty>it.qty)throw Error('Revisa la cantidad y la ubicación de destino.');
 if(it.zone==='Despacho')throw Error('El stock en zona de despacho sale con el pedido; cancela el pedido para devolverlo.');
 if(isBlocked(s,loc))throw Error('La ubicación está bloqueada.');
 if(qtyAt(s,loc)+qty>target.capacity)throw Error(`La cantidad supera la capacidad de la ubicación (${target.capacity} unidades).`);
 if(s.lots.some(l=>l.loc===loc&&l.productId!==it.productId))throw Error('La ubicación contiene otro producto.');
 s.lots.push({id:uid('lot'),productId:it.productId,loc,qty,batch:it.batch,expiry:it.expiry});
 it.qty-=qty;s.staging=s.staging.filter(x=>x.qty>0);
 event(s,'Reingreso',it.productId,qty,'Zona de '+it.zone.toLowerCase(),loc,uid('REI'),it.batch);
}
export function discardStaging(s,{id,reason}){
 const it=s.staging?.find(x=>x.id===id);
 if(!it||it.zone==='Despacho')throw Error('Este elemento no se puede dar de baja desde aquí.');
 if(!reason?.trim())throw Error('Escribe el motivo de la baja.');
 s.staging=s.staging.filter(x=>x.id!==id);
 event(s,'Baja',it.productId,it.qty,'Zona de '+it.zone.toLowerCase(),reason.trim(),uid('BAJ'),it.batch);
}
export function toQuarantine(s,{lotId,qty,reason}){
 const lot=s.lots.find(l=>l.id===lotId);qty=Number(qty);
 if(!lot||!Number.isInteger(qty)||qty<=0||qty>lot.qty)throw Error('Revisa la cantidad a enviar a cuarentena.');
 if(!reason?.trim())throw Error('Escribe el motivo de la cuarentena.');
 s.staging??=[];lot.qty-=qty;s.lots=s.lots.filter(l=>l.qty>0);
 s.staging.push({id:uid('stg'),zone:'Cuarentena',productId:lot.productId,qty,batch:lot.batch,expiry:lot.expiry,from:lot.loc,note:reason.trim(),at:new Date().toISOString()});
 event(s,'Cuarentena',lot.productId,qty,lot.loc,reason.trim(),uid('CUA'),lot.batch);
}
export function blockLocation(s,{loc,reason}){
 if(!locations.some(l=>l.id===loc))throw Error('Ubicación no válida.');
 if(!reason?.trim())throw Error('Escribe el motivo del bloqueo.');
 if(isBlocked(s,loc))throw Error('La ubicación ya está bloqueada.');
 s.blocked??=[];s.blocked.push({loc,reason:reason.trim(),at:new Date().toISOString()});
 event(s,'Bloqueo','',0,loc,reason.trim(),uid('BLQ'));
}
export function unblockLocation(s,loc){
 if(!isBlocked(s,loc))throw Error('La ubicación no está bloqueada.');
 s.blocked=s.blocked.filter(b=>b.loc!==loc);event(s,'Desbloqueo','',0,loc,'Disponible',uid('BLQ'));
}
// Internal moves. Pick level = level 1 of each rack; upper levels are reserve.
// Replenishment: a product whose pick-level units fell under half of its minimum gets its earliest-expiry reserve lot brought down.
// Consolidation: the emptiest location of a product moves into another location of that product that has room.
export function replenishmentPlan(s){
 const out=[],taken=new Map(),planned=new Map(),today=todayEC();
 const lvl=id=>locations.find(l=>l.id===id)?.level;
 const free=l=>l.capacity-qtyAt(s,l.id)-(taken.get(l.id)||0);
 for(const p of s.products){
  const pickQty=s.lots.filter(l=>l.productId===p.id&&lvl(l.loc)===1&&l.expiry>=today).reduce((n,l)=>n+l.qty,0);
  if(pickQty>=Math.ceil(p.min/2))continue;
  const lot=s.lots.filter(l=>l.productId===p.id&&lvl(l.loc)>1&&l.expiry>=today).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  if(!lot)continue;
  const has=l=>s.lots.some(t=>t.loc===l.id&&t.productId===p.id)?1:0;
  const dest=locations.filter(l=>l.level===1&&!isBlocked(s,l.id)&&free(l)>0&&(!planned.has(l.id)||planned.get(l.id)===p.id)&&s.lots.filter(t=>t.loc===l.id).every(t=>t.productId===p.id)).sort((a,b)=>(has(b)-has(a))||(free(b)-free(a)))[0];
  if(!dest)continue;
  const qty=Math.min(lot.qty,free(dest));
  out.push({kind:'Reposición',lotId:lot.id,productId:p.id,from:lot.loc,to:dest.id,qty});
  taken.set(dest.id,(taken.get(dest.id)||0)+qty);planned.set(dest.id,p.id);
 }
 return out;
}
export function consolidationPlan(s){
 const out=[],today=todayEC();
 for(const p of s.products){
  const by=new Map();for(const l of s.lots.filter(l=>l.productId===p.id))by.set(l.loc,(by.get(l.loc)||0)+l.qty);
  if(by.size<2)continue;
  const ranked=[...by].sort((a,b)=>a[1]-b[1]),[srcLoc,srcQty]=ranked[0];
  if(s.lots.some(l=>l.loc===srcLoc&&l.productId!==p.id))continue;
  const dest=ranked.slice(1).reverse().find(([id,q])=>{const l=locations.find(x=>x.id===id);return l&&!isBlocked(s,id)&&l.capacity-q>=srcQty&&s.lots.filter(t=>t.loc===id).every(t=>t.productId===p.id)});
  if(!dest)continue;
  for(const lot of s.lots.filter(l=>l.loc===srcLoc&&l.productId===p.id))out.push({kind:'Consolidación',lotId:lot.id,productId:p.id,from:srcLoc,to:dest[0],qty:lot.qty});
 }
 return out;
}
