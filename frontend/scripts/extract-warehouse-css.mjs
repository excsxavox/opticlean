import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../opticlean-control/dist/styles.css', import.meta.url), 'utf8');
const start = css.indexOf('/* Bodega visual');
let block = css.slice(start, start + 3500);
const cut = block.indexOf('@media(max-width:1200px)');
if (cut > 0) block = block.slice(0, cut);

const extras = `
.map-section{cursor:pointer;transition:filter .12s;outline:none}
.map-section:hover{filter:brightness(.94)}
.map-section:focus-visible{filter:drop-shadow(0 0 3px #1795f5)}
.map-cell{cursor:pointer}
.location-code{font-size:23px;letter-spacing:-.6px;font-weight:650;margin:11px 0 4px}
.location-sub{font-size:10px;color:#8b9bb0}
.mini-overline{font-size:8px;font-weight:600;letter-spacing:1.1px;text-transform:uppercase;color:#8ba1b7}
.location-product{display:flex;gap:10px;align-items:center;margin:20px 0 14px}
.product-icon{width:38px;height:38px;border-radius:10px;background:#eaf3fd;display:grid;place-items:center;color:#1795f5}
.product-code{font-size:9px;color:#728ba2}
.product-title{font-size:12px;font-weight:600}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 11px;margin:15px 0 19px}
.detail-grid dt{font-size:9px;color:#8d9eb0;margin-bottom:5px}
.detail-grid dd{margin:0;font-size:11px;font-weight:550}
.capacity-wrap{margin:8px 0 4px}
.capacity-wrap .progress{height:8px;border-radius:99px;background:#e8eef5;overflow:hidden}
.capacity-wrap .progress>span{display:block;height:100%;background:linear-gradient(90deg,#49b597,#1795f5)}
.button-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.location-panel .button-row{margin-top:19px}
.location-panel .button-row .btn{flex:1}
.empty-location{padding:19px 0;text-align:center;font-size:10px;color:#8da4b8;line-height:1.8}
.warehouse-bottom{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:17px;margin-top:17px}
.swatch{width:7px;height:7px;border-radius:2px;background:#c9d8e8;display:inline-block;margin-right:4px;vertical-align:middle}
.swatch.blue{background:#209cff}.swatch.green{background:#49b597}.swatch.empty{background:#edf1f5;border:1px solid #c6d4e2}.swatch.amber{background:#e7aa54}
.pick-item{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid #eaf1f7;cursor:pointer}
.pick-item:hover{background:#f4faff}.pick-item.checked{background:#f2faf6}
.pick-number{width:24px;height:24px;border:1px solid #d5e7f5;border-radius:50%;display:grid;place-items:center;color:#4194d3;font-size:9px}
.pick-intro{padding:12px 15px;font-size:11px;color:#566a80;line-height:1.55;border-bottom:1px solid #eaf1f7}
.rack-list{display:flex;flex-direction:column}
.rack-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid #edf2f7;font-size:11px}
.rack-label{font-weight:600}
.suggestion{background:#eef6ff;border:1px solid #c5ddf8;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.5}
.pill{border:1px solid #d5dfea;background:#fff;border-radius:999px;padding:6px 12px;font-size:10.5px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#16304c}
.pill.active{border-color:#1795f5;background:#eaf3fd;color:#0a4f9e;font-weight:600}
.pill .dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.floor-btn{border:1px solid #d5dfea;background:#fff;border-radius:10px;padding:8px 10px;text-align:left;cursor:pointer;font-size:11px}
.floor-btn.active{border-color:#1795f5;background:#eaf3fd}
.floor-slab{height:6px;border-radius:3px;background:#d5e4f2;margin-top:6px}
.rail-title{font-size:10px;font-weight:600}
.rail-note{font-size:9px;color:#7a90a6}
`;

const out = `/* Portado/adaptado desde opticlean-control */\n${block}\n${extras}`;
writeFileSync(new URL('../src/styles/warehouse-visual.css', import.meta.url), out);
console.log('wrote', out.length, 'chars,', out.split('\n').length, 'lines');
