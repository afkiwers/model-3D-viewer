/*!
 * step-viewer.js
 * Drop-in 3D viewer for STEP files (IGES and BREP work too). Plain JavaScript, no build step.
 *
 * Rendering:  three.js        https://threejs.org
 * Geometry:   occt-import-js  https://github.com/kovacsv/occt-import-js (OpenCascade in WebAssembly)
 *
 * Usage:
 *   <div class="step-viewer" data-src="/models/part.step" data-height="500"></div>
 *   <script src="/js/step-viewer.js"></script>
 *
 * See README.md for every option.
 *
 * Copyright (C) 2026 afkiwers
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. It is distributed WITHOUT ANY WARRANTY; see the
 * LICENSE file or <https://www.gnu.org/licenses/gpl-3.0.html> for details.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const script = document.currentScript;
  const scriptAttr = (name) => (script && script.getAttribute(name)) || null;

  // Where the two libraries come from. Override with attributes on the <script> tag
  // (data-three-url, data-occt-url, data-wasm-url) or with window.StepViewerConfig
  // to host them yourself.
  const config = Object.assign({
    threeUrl: scriptAttr('data-three-url') || 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js',
    occtUrl: scriptAttr('data-occt-url') || 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js',
    wasmUrl: scriptAttr('data-wasm-url') || null, // defaults to occt-import-js.wasm next to occtUrl
    autoInit: scriptAttr('data-auto-init') !== 'false',
    selector: '.step-viewer[data-src]',
  }, global.StepViewerConfig || {});

  const DEFAULTS = {
    src: null,             // URL of the STEP file (required)
    format: null,          // 'step' | 'iges' | 'brep'; guessed from the file extension
    width: null,           // CSS width, numbers are pixels. Default: 100%
    height: null,          // CSS height, numbers are pixels. Default: 480px
    zoom: 1,               // 1 = model fills the view, 2 = twice as close
    view: 'iso',           // iso | front | back | left | right | top | bottom | "x,y,z" camera direction
    rotation: [0, 0, 0],   // extra model rotation in degrees about X, Y, Z
    up: 'z',               // which model axis points up: 'z' (most CAD) or 'y'
    units: 'mm',           // mm | cm | m | in | ft
    precision: 2,          // decimals shown in measurements
    quality: 'normal',     // tessellation: low | normal | high
    color: '#a9b4c2',      // model colour when the file has none
    fileColors: true,      // use the colours stored in the file
    edges: true,           // draw CAD edges
    edgeColor: '#27303b',
    background: null,      // any CSS background; default is a light grey gradient
    autoRotate: 0,         // degrees per second, stops when the visitor interacts (true = 20)
    lazy: true,            // only load when scrolled into view
    download: true,        // show the download button
    downloadUrl: null,     // file to download; defaults to src
    downloadName: null,    // file name for the download; defaults to the name in the URL
    measure: true,         // show the ruler button
    orbit: 'free',         // 'free': turn the model any way; 'turntable': keep the up axis upright
    gizmo: false,          // show the view cube from the start
    views: true,           // show the standard views menu
    fullscreen: true,      // show the fullscreen button
    info: true,            // show the file name and overall size
    help: true,            // show a short controls hint after loading
    markers: null,         // hotspots: URL of a JSON file, or an array (see README)
    editor: false,         // marker editor: click the model to place markers and copy their JSON
    theme: 'default',      // look of markers and cards: default | digital | military | agricultural
  };
  // Site-wide defaults, e.g. window.StepViewerConfig = { defaults: { download: false } }
  if (config.defaults) Object.assign(DEFAULTS, config.defaults);

  const UNITS = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'inch', ft: 'foot' };

  const QUALITY = {
    low: { linearDeflection: 0.003, angularDeflection: 0.7 },
    normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
    high: { linearDeflection: 0.0003, angularDeflection: 0.25 },
  };

  // Camera directions (from the model towards the camera) for a Z-up model.
  const VIEWS = {
    iso: [1, -1, 1],
    front: [0, -1, 0],
    back: [0, 1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 0, 1],
    bottom: [0, 0, -1],
  };
  const VIEW_LABELS = { iso: 'Isometric', front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };

  const DEG = Math.PI / 180;
  const CORNER_SNAP_PX = 12;
  const EDGE_SNAP_PX = 8;
  const CLICK_PX = 5;

  const ICONS = {
    home: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M6 10v9.5h12V10"/>',
    cube: '<path d="M12 3.5 17.5 6.5v6L12 15.5l-5.5-3v-6z"/><path d="M12 9.5 17.5 6.5M12 9.5 6.5 6.5M12 9.5v6"/><path d="M5 15.5C2.8 16.3 2 17.2 2 18c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5c0-.8-.8-1.7-3-2.5"/>',
    views: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12 4 7.5M12 12v9"/>',
    ruler: '<path d="M3.5 15.5 15.5 3.5l5 5-12 12z"/><path d="M6.5 12.5l2 2M9.5 9.5l1.5 1.5M12.5 6.5l2 2"/>',
    clear: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    addPin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M12 7v6M9 10h6"/>',
    prev: '<path d="M14.5 6 8.5 12l6 6"/>',
    next: '<path d="M9.5 6l6 6-6 6"/>',
  };
  const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';

  const CSS = `
:where(.sv-root){position:relative;display:block;width:100%;height:480px;background:radial-gradient(120% 90% at 50% 0%,#fdfdfe 0%,#e8ebef 60%,#d8dde3 100%)}
.sv-root{overflow:hidden;-webkit-user-select:none;user-select:none;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;outline:none;
  --sv-accent:#ef5a24;--sv-ui-bg:rgba(255,255,255,.9);--sv-ui-fg:#1f2937;--sv-ui-border:rgba(15,23,42,.12)}
.sv-root.sv-expanded{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;z-index:2147483000;margin:0!important;border-radius:0!important}
.sv-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.sv-canvas.sv-dragging{cursor:grabbing}
.sv-measuring .sv-canvas{cursor:crosshair}
.sv-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.sv-overlay line{stroke-linecap:round}
.sv-overlay .sv-halo{stroke:#fff;stroke-width:5;stroke-opacity:.85}
.sv-overlay .sv-line{stroke:var(--sv-accent);stroke-width:2}
.sv-overlay .sv-rubber{stroke-dasharray:6 5}
.sv-layer{position:absolute;inset:0;pointer-events:none}
.sv-dot{position:absolute;width:10px;height:10px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--sv-accent);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)}
.sv-dot.sv-hover{background:transparent;border:2px solid var(--sv-accent);box-shadow:0 0 0 1px #fff,inset 0 0 0 1px #fff}
.sv-dot.sv-snap-corner{border-radius:2px}
.sv-dot.sv-snap-edge{border-radius:2px;transform:rotate(45deg) scale(.9)}
.sv-label{position:absolute;display:flex;align-items:center;gap:4px;padding:2px 4px 2px 8px;border-radius:999px;background:#fff;color:#111827;border:1.5px solid var(--sv-accent);
  font-weight:600;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 1px 4px rgba(0,0,0,.18);pointer-events:auto;transform:translate(-50%,-50%)}
.sv-label.sv-live{padding-right:8px;pointer-events:none}
.sv-label button{all:unset;cursor:pointer;width:16px;height:16px;display:grid;place-items:center;border-radius:50%;color:#6b7280;font-size:14px;line-height:1}
.sv-label button:hover{background:var(--sv-accent);color:#fff}
.sv-toolbar{position:absolute;top:10px;right:10px;display:flex;gap:2px;padding:3px;background:var(--sv-ui-bg);border:1px solid var(--sv-ui-border);border-radius:10px;
  box-shadow:0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.08);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.sv-btn{all:unset;box-sizing:border-box;width:32px;height:32px;display:grid;place-items:center;border-radius:7px;color:var(--sv-ui-fg);cursor:pointer}
.sv-btn[hidden]{display:none}
.sv-btn:hover{background:rgba(15,23,42,.07)}
.sv-btn[aria-pressed="true"],.sv-btn[aria-expanded="true"]{background:var(--sv-accent);color:#fff}
.sv-btn:focus-visible,.sv-menu button:focus-visible{outline:2px solid var(--sv-accent);outline-offset:1px}
.sv-btn svg{width:18px;height:18px}
.sv-menu{position:absolute;right:10px;min-width:128px;padding:4px;background:var(--sv-ui-bg);border:1px solid var(--sv-ui-border);border-radius:10px;
  box-shadow:0 4px 14px rgba(0,0,0,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:grid}
.sv-menu[hidden]{display:none}
.sv-menu button{all:unset;padding:6px 10px;border-radius:6px;cursor:pointer;color:var(--sv-ui-fg)}
.sv-menu button:hover{background:rgba(15,23,42,.07)}
.sv-bottom{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:wrap-reverse;align-items:flex-end;justify-content:space-between;gap:6px;pointer-events:none}
.sv-pill{max-width:100%;padding:4px 10px;border-radius:8px;background:var(--sv-ui-bg);border:1px solid var(--sv-ui-border);color:var(--sv-ui-fg);
  font-variant-numeric:tabular-nums;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.sv-pill[hidden]{display:none}
.sv-info{display:flex;flex-wrap:wrap;gap:0 8px}
.sv-info b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}
.sv-info span{color:#4b5563}
.sv-hint{margin-left:auto}
.sv-status{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;color:#374151;text-align:center;padding:16px}
.sv-status[hidden]{display:none}
.sv-spinner{width:28px;height:28px;border-radius:50%;border:3px solid rgba(15,23,42,.12);border-top-color:var(--sv-accent);animation:sv-spin .8s linear infinite}
.sv-progress{width:160px;height:4px;border-radius:2px;background:rgba(15,23,42,.1);overflow:hidden}
.sv-progress i{display:block;height:100%;width:0;background:var(--sv-accent);transition:width .15s}
.sv-error .sv-spinner,.sv-error .sv-progress{display:none}
.sv-error p{max-width:340px;margin:0;color:#b91c1c}
@keyframes sv-spin{to{transform:rotate(360deg)}}
.sv-gizmo{position:absolute;left:6px;bottom:48px;z-index:1;width:150px;height:150px;-webkit-user-select:none;user-select:none}
.sv-gizmo[hidden]{display:none}
.sv-cube-stage{position:absolute;inset:0;perspective:520px;touch-action:none;cursor:grab}
.sv-cube-stage:active{cursor:grabbing}
.sv-cube{position:absolute;inset:0;transform-style:preserve-3d}
.sv-face,.sv-compass{position:absolute;left:50%;top:50%;box-sizing:border-box}
.sv-face{width:62px;height:62px;margin:-31px 0 0 -31px;-webkit-backface-visibility:hidden;backface-visibility:hidden;
  display:grid;grid-template-columns:22% 1fr 22%;grid-template-rows:22% 1fr 22%;
  background:linear-gradient(160deg,#fbfbfc,#dde1e6);border:1px solid #9aa3ae;box-shadow:inset 0 0 0 1px rgba(255,255,255,.7)}
.sv-face span{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;
  font:700 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.04em;color:#4b5563}
.sv-face i{display:block;cursor:pointer}
.sv-face i:hover{background:rgba(59,130,246,.4)}
.sv-compass{width:128px;height:128px;margin:-64px 0 0 -64px;border-radius:50%;border:14px solid rgba(178,186,196,.9);cursor:ew-resize;
  box-shadow:inset 0 0 0 2.5px #3b82f6,0 0 0 1px rgba(15,23,42,.15)}
.sv-compass{clip-path:path(evenodd,"M0 64a64 64 0 1 0 128 0a64 64 0 1 0-128 0ZM14 64a50 50 0 1 0 100 0a50 50 0 1 0-100 0Z")}
.sv-compass:hover{border-color:rgba(150,160,172,.95)}
.sv-compass b{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;display:grid;place-items:center;
  font:800 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#374151;pointer-events:none}
.sv-cube-btn{all:unset;position:absolute;z-index:1;width:24px;height:24px;display:grid;place-items:center;border-radius:6px;color:#6b7280;cursor:pointer}
.sv-cube-btn:hover{color:var(--sv-ui-fg);background:rgba(15,23,42,.08)}
.sv-cube-btn:focus-visible{outline:2px solid var(--sv-accent)}
.sv-cube-btn svg{width:17px;height:17px}
.sv-markers{position:absolute;inset:0;pointer-events:none}
.sv-marker{all:unset;box-sizing:border-box;position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;display:grid;place-items:center;
  background:rgba(17,24,39,.6);border:2px solid #fff;color:#fff;font:700 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;pointer-events:auto;
  box-shadow:0 2px 10px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);
  transition:transform .25s cubic-bezier(.3,1.6,.5,1),opacity .3s,background-color .2s;animation:sv-pop .55s cubic-bezier(.3,1.6,.5,1) backwards;animation-delay:calc(var(--i,0) * 70ms + .2s)}
.sv-marker:hover,.sv-marker:focus-visible{transform:scale(1.18);background:var(--sv-accent);outline:none}
.sv-marker.sv-occluded{opacity:.32}
.sv-marker.sv-active{background:var(--sv-accent);transform:scale(1.22);opacity:1;z-index:1}
.sv-marker.sv-active::before,.sv-marker.sv-active::after{content:"";position:absolute;inset:-2px;border-radius:50%;border:2px solid var(--sv-accent);animation:sv-ping 2s cubic-bezier(0,.55,.45,1) infinite;pointer-events:none}
.sv-marker.sv-active::after{animation-delay:1s}
.sv-markers-off .sv-marker,.sv-markers-off .sv-card,.sv-markers-off .sv-leader{display:none}
@keyframes sv-pop{from{transform:scale(0);opacity:0}}
@keyframes sv-ping{from{transform:scale(1);opacity:.9}to{transform:scale(2.7);opacity:0}}
@property --sv-angle{syntax:"<angle>";inherits:false;initial-value:0deg}
.sv-card{position:absolute;left:0;top:0;z-index:2;width:min(300px,calc(100% - 20px));box-sizing:border-box;padding:1.5px;border-radius:18px;pointer-events:auto;cursor:auto;color:#f1f5f9;
  -webkit-user-select:text;user-select:text;
  background:conic-gradient(from var(--sv-angle),var(--sv-accent),#ffc78a 25%,#8be9ff 50%,#b69cff 75%,var(--sv-accent));
  box-shadow:0 24px 60px -18px rgba(2,6,23,.65),0 0 46px -14px var(--sv-accent);
  animation:sv-card-in .7s cubic-bezier(.18,1.3,.32,1) both,sv-turn 5s linear infinite}
.sv-card.sv-out{animation:sv-card-out .22s ease-in both}
.sv-card-body{position:relative;overflow:hidden;border-radius:16.5px;padding:16px 18px 18px;max-height:min(60vh,420px);overflow-y:auto;
  background:radial-gradient(120% 80% at 0% 0%,rgba(255,255,255,.09),transparent 55%),linear-gradient(160deg,rgba(32,38,52,.94),rgba(10,13,20,.96));
  -webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4)}
.sv-card-body::before{content:"";position:absolute;inset:0;pointer-events:none;transform:translateX(-130%);
  background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.16) 48%,rgba(255,255,255,.04) 56%,transparent 70%);animation:sv-sheen 1.3s .3s cubic-bezier(.3,.6,.3,1) forwards}
.sv-card-head{display:flex;align-items:center;gap:11px;padding-right:22px}
.sv-card-num{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;color:#fff;
  background:radial-gradient(circle at 30% 30%,#ffb38f,var(--sv-accent) 60%);box-shadow:0 0 0 4px rgba(239,90,36,.22),0 0 18px rgba(239,90,36,.6)}
.sv-card h3{margin:0;font-size:16.5px;line-height:1.25;font-weight:700;letter-spacing:-.01em;color:#fff;outline:none}
.sv-card-text{margin-top:11px;color:#e2e8f0;font-size:13.5px;line-height:1.6;outline:none}
.sv-card-text :where(p,li,ul,ol,span,strong,em,b,i,small){color:inherit;font-size:inherit;line-height:inherit}
.sv-card h3{font-family:inherit}
.sv-card-text:empty{display:none}
.sv-card-text[contenteditable]:empty{display:block}
.sv-card-text p{margin:0 0 .6em;color:inherit}.sv-card-text p:last-child{margin:0}
.sv-card-text a{color:#ffb38f}
.sv-card-text img,.sv-card-img{display:block;max-width:100%;border-radius:10px}
.sv-card-img{width:calc(100% + 36px);max-width:none;margin:-16px -18px 14px;border-radius:0;height:150px;object-fit:cover}
.sv-card-close{all:unset;position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;z-index:1}
.sv-card-close:hover{background:rgba(255,255,255,.1);color:#fff}
.sv-card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:11px;border-top:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:12px}
.sv-card-foot button{all:unset;cursor:pointer;padding:3px 8px;border-radius:6px;color:#e2e8f0}
.sv-card-foot button:hover{background:rgba(255,255,255,.1)}
.sv-card [contenteditable]{border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.15);padding:2px 4px;margin-left:-4px}
.sv-card [contenteditable]:empty::before{content:attr(data-placeholder);color:#64748b}
.sv-reveal{animation:sv-rise .6s cubic-bezier(.2,.9,.25,1) both;animation-delay:calc(.16s + var(--d,0) * 80ms)}
.sv-sheet{border-radius:18px}
@keyframes sv-card-in{0%{opacity:0;transform:scale(.25) rotate(-6deg);filter:blur(12px)}55%{opacity:1;filter:blur(0)}100%{opacity:1;transform:none;filter:none}}
@keyframes sv-card-out{to{opacity:0;transform:scale(.85);filter:blur(6px)}}
@keyframes sv-turn{to{--sv-angle:360deg}}
@keyframes sv-sheen{to{transform:translateX(130%)}}
@keyframes sv-rise{from{opacity:0;transform:translateY(10px);filter:blur(4px)}}
.sv-overlay .sv-leader{stroke:var(--sv-accent);stroke-width:2;fill:none;stroke-dasharray:1;stroke-dashoffset:1;animation:sv-draw .45s .1s ease-out forwards;filter:drop-shadow(0 0 3px rgba(239,90,36,.7))}
.sv-overlay .sv-leader-end{fill:var(--sv-accent);opacity:0;animation:sv-fade .2s .5s forwards}
@keyframes sv-draw{to{stroke-dashoffset:0}}
@keyframes sv-fade{to{opacity:1}}
.sv-nav{pointer-events:auto;display:flex;align-items:center;gap:2px;padding:3px;margin:0 auto;border-radius:999px;background:rgba(17,24,39,.72);color:#fff;
  box-shadow:0 4px 14px rgba(0,0,0,.18);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);max-width:100%}
.sv-nav[hidden]{display:none}
.sv-nav button{all:unset;cursor:pointer;height:28px;min-width:28px;display:grid;place-items:center;border-radius:999px;box-sizing:border-box}
.sv-nav button:hover{background:rgba(255,255,255,.14)}
.sv-nav button:focus-visible{outline:2px solid var(--sv-accent)}
.sv-nav svg{width:16px;height:16px}
.sv-nav .sv-nav-title{padding:0 12px;display:block;line-height:28px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.sv-nav .sv-nav-title span{opacity:.6;margin-right:8px;font-variant-numeric:tabular-nums}
.sv-editor{position:absolute;top:10px;left:10px;z-index:3;width:min(330px,calc(100% - 20px));box-sizing:border-box;padding:10px;border-radius:10px;background:var(--sv-ui-bg);
  border:1px solid var(--sv-ui-border);box-shadow:0 4px 14px rgba(0,0,0,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);-webkit-user-select:text;user-select:text}
.sv-editor[hidden]{display:none}
.sv-editor-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:600}
.sv-editor-head button{all:unset;cursor:pointer;padding:3px 10px;border-radius:6px;background:var(--sv-accent);color:#fff;font-weight:500}
.sv-editor p{margin:0 0 6px;color:#4b5563;font-size:12px}
.sv-editor textarea{box-sizing:border-box;width:100%;height:96px;resize:vertical;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid var(--sv-ui-border);border-radius:6px;padding:6px;background:#fff;color:#111827}
.sv-card-meta{display:none}
/* ---- Theme: digital ---- */
.sv-theme-digital{--sv-accent:#00ff9c}
.sv-theme-digital .sv-btn[aria-pressed="true"],.sv-theme-digital .sv-btn[aria-expanded="true"]{color:#00140c}
.sv-theme-digital .sv-card{border-radius:3px;padding:1px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:linear-gradient(135deg,#00ff9c,#00d1ff 55%,#ff2bd6);
  box-shadow:0 0 0 1px rgba(0,255,156,.2),0 0 28px -4px rgba(0,255,156,.55),0 0 70px -18px #ff2bd6;animation:sv-dg-in .6s both}
.sv-theme-digital .sv-card.sv-out{animation:sv-dg-out .25s steps(3) both}
.sv-theme-digital .sv-card-body{border-radius:2px;padding:18px 18px 16px;color:#b6ffdf;
  background:repeating-linear-gradient(0deg,rgba(0,255,156,.045) 0 1px,transparent 1px 3px),
    linear-gradient(rgba(0,255,156,.06) 1px,transparent 1px) 0 0/22px 22px,linear-gradient(90deg,rgba(0,255,156,.06) 1px,transparent 1px) 0 0/22px 22px,#03070a;
  -webkit-backdrop-filter:none;backdrop-filter:none}
.sv-theme-digital .sv-card-body::before{inset:auto 0;top:0;height:35%;transform:translateY(-100%);
  background:linear-gradient(180deg,transparent,rgba(0,255,156,.13),transparent);animation:sv-dg-scan 2.6s linear infinite}
.sv-theme-digital .sv-card-body::after{content:"";position:absolute;inset:6px;pointer-events:none;
  background:linear-gradient(#00ff9c,#00ff9c) 0 0/14px 2px,linear-gradient(#00ff9c,#00ff9c) 0 0/2px 14px,
    linear-gradient(#00ff9c,#00ff9c) 100% 0/14px 2px,linear-gradient(#00ff9c,#00ff9c) 100% 0/2px 14px,
    linear-gradient(#00ff9c,#00ff9c) 0 100%/14px 2px,linear-gradient(#00ff9c,#00ff9c) 0 100%/2px 14px,
    linear-gradient(#00ff9c,#00ff9c) 100% 100%/14px 2px,linear-gradient(#00ff9c,#00ff9c) 100% 100%/2px 14px;background-repeat:no-repeat}
.sv-theme-digital .sv-card-num{border-radius:2px;width:34px;height:26px;font-size:0;background:#00ff9c;box-shadow:0 0 14px rgba(0,255,156,.7)}
.sv-theme-digital .sv-card-num::after{content:attr(data-ref);font-size:13px;color:#00140c}
.sv-theme-digital .sv-card h3{color:#00ff9c;text-transform:uppercase;letter-spacing:.08em;font-size:15px;text-shadow:0 0 8px rgba(0,255,156,.65),2px 0 rgba(255,43,214,.35),-2px 0 rgba(0,209,255,.35)}
.sv-theme-digital .sv-card h3::after{content:"_";margin-left:3px;animation:sv-blink 1s steps(1) infinite}
.sv-theme-digital .sv-card-meta{display:block;margin-top:8px;font-size:11px;color:rgba(0,255,156,.6);letter-spacing:.04em}
.sv-theme-digital .sv-card-meta::before{content:"// "}
.sv-theme-digital .sv-card-text{color:#b6ffdf;font-size:13px}
.sv-theme-digital .sv-card-text a{color:#00d1ff}
.sv-theme-digital .sv-card-close{color:#00ff9c;border-radius:2px}
.sv-theme-digital .sv-card-close:hover{background:rgba(0,255,156,.15);color:#fff}
.sv-theme-digital .sv-card-foot{border-top:1px dashed rgba(0,255,156,.35);color:rgba(0,255,156,.6);text-transform:uppercase;letter-spacing:.06em;font-size:11px}
.sv-theme-digital .sv-card-foot button{color:#00ff9c;border-radius:2px}
.sv-theme-digital .sv-card-foot button:hover{background:#00ff9c;color:#00140c}
.sv-theme-digital .sv-marker{border-radius:3px;background:rgba(0,12,8,.8);border:1.5px solid #00ff9c;color:#00ff9c;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 0 10px rgba(0,255,156,.55)}
.sv-theme-digital .sv-marker:hover,.sv-theme-digital .sv-marker:focus-visible,.sv-theme-digital .sv-marker.sv-active{background:#00ff9c;color:#00140c}
.sv-theme-digital .sv-marker.sv-active::before,.sv-theme-digital .sv-marker.sv-active::after{border-radius:3px}
.sv-theme-digital .sv-nav{border-radius:3px;background:rgba(3,7,10,.9);color:#00ff9c;border:1px solid rgba(0,255,156,.5);font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 0 16px -4px rgba(0,255,156,.5)}
.sv-theme-digital .sv-nav button{border-radius:2px}
.sv-theme-digital .sv-nav button:hover{background:rgba(0,255,156,.18)}
.sv-theme-digital .sv-overlay .sv-leader{filter:drop-shadow(0 0 4px #00ff9c)}
@keyframes sv-dg-in{0%{opacity:0;clip-path:inset(0 0 100% 0)}8%{opacity:1;clip-path:inset(42% 0 44% 0);transform:translateX(-14px)}
  16%{clip-path:inset(8% 0 72% 0);transform:translateX(12px);filter:hue-rotate(90deg)}24%{clip-path:inset(62% 0 4% 0);transform:translateX(-6px)}
  34%{clip-path:inset(0 0 34% 0);transform:none;filter:none}46%{clip-path:inset(0);transform:translateX(4px) skewX(-8deg);filter:hue-rotate(-60deg) brightness(1.6)}
  54%{transform:none;filter:none}62%{opacity:.6}68%{opacity:1}100%{clip-path:inset(0);opacity:1;transform:none}}
@keyframes sv-dg-out{to{opacity:0;clip-path:inset(48% 0 48% 0)}}
@keyframes sv-dg-scan{to{transform:translateY(300%)}}
@keyframes sv-blink{50%{opacity:0}}
/* ---- Theme: military ---- */
.sv-theme-military{--sv-accent:#e0b341}
.sv-theme-military .sv-btn[aria-pressed="true"],.sv-theme-military .sv-btn[aria-expanded="true"]{color:#1c2414}
.sv-theme-military .sv-card{border-radius:0;padding:1.5px;background:#c8b47e;transform-origin:50% 50%!important;
  clip-path:polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px);
  box-shadow:none;filter:drop-shadow(0 14px 22px rgba(10,14,6,.55));animation:sv-mil-in .55s cubic-bezier(.6,0,.2,1) both}
.sv-theme-military .sv-card.sv-out{animation:sv-mil-out .25s ease-in both}
.sv-theme-military .sv-card-body{border-radius:0;padding:22px 18px 16px;color:#e9e3c9;
  clip-path:polygon(15px 0,100% 0,100% calc(100% - 15px),calc(100% - 15px) 100%,0 100%,0 15px);
  background:repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 2px,transparent 2px 9px),radial-gradient(120% 90% at 100% 0%,#46553a,transparent 60%),#2b3521;
  -webkit-backdrop-filter:none;backdrop-filter:none}
.sv-theme-military .sv-card-body::before{inset:0 0 auto 0;height:6px;transform:none;animation:none;
  background:repeating-linear-gradient(-45deg,#e0b341 0 9px,#1c2414 9px 18px)}
.sv-theme-military .sv-card-num{border-radius:0;width:auto;min-width:32px;height:24px;padding:0 6px;font-size:0;background:#e0b341;box-shadow:none;
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.sv-theme-military .sv-card-num::after{content:attr(data-ref);font:700 13px/1 ui-monospace,Menlo,Consolas,monospace;color:#1c2414}
.sv-theme-military .sv-card h3{font-family:"Stencil Std",Stencil,"Black Ops One",Impact,"Arial Narrow Bold","Arial Narrow",sans-serif;font-weight:700;
  text-transform:uppercase;letter-spacing:.12em;font-size:16px;color:#f2e8c4}
.sv-theme-military .sv-card-meta{display:block;margin-top:9px;padding:4px 8px;font:600 11px/1.3 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;
  color:#e0b341;background:rgba(0,0,0,.25);border-left:2px solid #e0b341}
.sv-theme-military .sv-card-meta::before{content:"GRID REF ▸ "}
.sv-theme-military .sv-card-text{color:#ddd6b8;font-size:13.5px}
.sv-theme-military .sv-card-text a{color:#e0b341}
.sv-theme-military .sv-card-close{top:14px;border-radius:0;color:#c8b47e}
.sv-theme-military .sv-card-close:hover{background:#e0b341;color:#1c2414}
.sv-theme-military .sv-card-foot{border-top:1px solid rgba(200,180,126,.3);color:#a99a6c;text-transform:uppercase;letter-spacing:.1em;font-size:11px}
.sv-theme-military .sv-card-foot button{border-radius:0;color:#f2e8c4;letter-spacing:.08em}
.sv-theme-military .sv-card-foot button:hover{background:#e0b341;color:#1c2414}
.sv-theme-military .sv-reveal{animation-delay:calc(.35s + var(--d,0) * 90ms)}
.sv-theme-military .sv-marker{border-radius:2px;background:rgba(28,36,20,.85);border:1.5px solid #c8b47e;color:#f2e8c4;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 0 0 3px rgba(28,36,20,.35)}
.sv-theme-military .sv-marker:hover,.sv-theme-military .sv-marker:focus-visible,.sv-theme-military .sv-marker.sv-active{background:#e0b341;border-color:#1c2414;color:#1c2414}
.sv-theme-military .sv-marker.sv-active::before,.sv-theme-military .sv-marker.sv-active::after{border-radius:0}
.sv-theme-military .sv-nav{border-radius:0;background:rgba(43,53,33,.92);color:#f2e8c4;border:1px solid #c8b47e;text-transform:uppercase;letter-spacing:.1em;font-size:12px;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
.sv-theme-military .sv-nav button{border-radius:0}
.sv-theme-military .sv-nav button:hover{background:rgba(224,179,65,.25)}
.sv-theme-military .sv-overlay .sv-leader{filter:none;stroke-width:1.5;stroke-dasharray:5 4;stroke-dashoffset:0;opacity:0;animation:sv-fade .2s .3s forwards}
@keyframes sv-mil-in{0%{opacity:0;transform:scale(0,.015)}35%{opacity:1;transform:scale(1,.015)}45%{transform:scale(1,.015)}100%{opacity:1;transform:none}}
@keyframes sv-mil-out{to{opacity:0;transform:scale(1,.015)}}
/* ---- Theme: agricultural ---- */
.sv-theme-agricultural{--sv-accent:#5a8f29}
.sv-theme-agricultural .sv-card{border-radius:24px 24px 24px 8px;padding:2px;transform-origin:50% 100%!important;
  background:linear-gradient(160deg,#9cc456,#5a8f29 45%,#d9a441);
  box-shadow:0 22px 44px -16px rgba(74,58,20,.5),0 0 0 6px rgba(156,196,86,.15);animation:sv-ag-in .8s cubic-bezier(.2,1.4,.35,1) both}
.sv-theme-agricultural .sv-card-body{border-radius:22px 22px 22px 6px;padding:18px 20px 18px;color:#4a3f2a;
  background:radial-gradient(rgba(122,96,40,.07) 1px,transparent 1.2px) 0 0/7px 7px,
    radial-gradient(130% 70% at 50% 120%,rgba(217,164,65,.28),transparent 60%),linear-gradient(180deg,#fffaf0,#f6edd5);
  -webkit-backdrop-filter:none;backdrop-filter:none}
.sv-theme-agricultural .sv-card-body::before{inset:-30% -30% auto auto;width:70%;height:70%;transform:scale(.2);opacity:0;border-radius:50%;
  background:radial-gradient(circle,rgba(255,214,102,.55),transparent 65%);animation:sv-ag-sun 1.4s .2s ease-out forwards}
.sv-theme-agricultural .sv-card-body::after{content:"";position:absolute;right:44px;top:10px;width:46px;height:46px;pointer-events:none;opacity:.2;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none' stroke='%235a8f29' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M32 62V14'/%3E%3Cpath d='M32 22c-7-2-10-8-10-14 7 1 10 7 10 14zM32 22c7-2 10-8 10-14-7 1-10 7-10 14zM32 36c-7-2-10-8-10-14 7 1 10 7 10 14zM32 36c7-2 10-8 10-14-7 1-10 7-10 14zM32 50c-7-2-10-8-10-14 7 1 10 7 10 14zM32 50c7-2 10-8 10-14-7 1-10 7-10 14z'/%3E%3C/svg%3E") no-repeat center/contain}
.sv-theme-agricultural .sv-card-num{border-radius:60% 0 60% 0;width:32px;height:32px;background:linear-gradient(135deg,#8fbf45,#4f7f22);box-shadow:0 3px 8px rgba(79,127,34,.35)}
.sv-theme-agricultural .sv-card h3{font-family:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,serif;font-size:19px;font-weight:700;color:#2f4a17;letter-spacing:0}
.sv-theme-agricultural .sv-card-text{color:#4a3f2a;font-size:14px}
.sv-theme-agricultural .sv-card-text a{color:#3f6f1a}
.sv-theme-agricultural .sv-card-close{color:#7a6a45}
.sv-theme-agricultural .sv-card-close:hover{background:rgba(90,143,41,.12);color:#2f4a17}
.sv-theme-agricultural .sv-card-foot{border-top:1.5px dashed rgba(122,96,40,.3);color:#8a7a52}
.sv-theme-agricultural .sv-card-foot button{color:#3f6f1a;border-radius:999px;font-weight:600}
.sv-theme-agricultural .sv-card-foot button:hover{background:#5a8f29;color:#fff}
.sv-theme-agricultural .sv-marker{border-radius:50% 50% 50% 6px;background:#5a8f29;border:2px solid #fffaf0;color:#fff;box-shadow:0 3px 10px rgba(47,74,23,.4)}
.sv-theme-agricultural .sv-marker:hover,.sv-theme-agricultural .sv-marker:focus-visible,.sv-theme-agricultural .sv-marker.sv-active{background:#d9a441;color:#3b2d0e}
.sv-theme-agricultural .sv-marker.sv-active::before,.sv-theme-agricultural .sv-marker.sv-active::after{border-color:#d9a441}
.sv-theme-agricultural .sv-nav{background:rgba(255,250,240,.95);color:#2f4a17;border:1.5px solid rgba(90,143,41,.4);font-family:Georgia,"Iowan Old Style",Palatino,serif}
.sv-theme-agricultural .sv-nav button:hover{background:rgba(90,143,41,.15)}
.sv-theme-agricultural .sv-nav .sv-nav-title span{color:#8a7a52;opacity:1}
.sv-theme-agricultural .sv-overlay .sv-leader{filter:none;stroke-width:2.5}
.sv-theme-agricultural .sv-overlay .sv-leader-end{fill:#d9a441}
@keyframes sv-ag-in{0%{opacity:0;transform:translateY(34px) scale(.3) rotate(5deg)}55%{opacity:1;transform:translateY(-6px) scale(1.04) rotate(-1deg)}100%{opacity:1;transform:none}}
@keyframes sv-ag-sun{to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.sv-card-body::after,.sv-card h3::after{animation:none!important}}
@media (prefers-reduced-motion:reduce){.sv-card,.sv-card-body::before,.sv-reveal,.sv-marker,.sv-marker::before,.sv-marker::after,.sv-overlay .sv-leader{animation:none!important}.sv-overlay .sv-leader{stroke-dashoffset:0}.sv-overlay .sv-leader-end{opacity:1}}
@media (pointer:coarse){.sv-btn{width:40px;height:40px}.sv-menu button{padding:10px 12px}}
@media (prefers-reduced-motion:reduce){.sv-spinner{animation-duration:2s}}
`;

  // ---------------------------------------------------------------------------
  // Library loading
  // ---------------------------------------------------------------------------

  let THREE = null;
  let threePromise = null;
  let enginePromise = null;

  const absUrl = (url) => new URL(url, document.baseURI).href;

  function loadThree() {
    if (!threePromise) {
      threePromise = import(absUrl(config.threeUrl)).then((mod) => (THREE = mod));
    }
    return threePromise;
  }

  function wasmUrl() {
    return absUrl(config.wasmUrl || new URL('occt-import-js.wasm', absUrl(config.occtUrl)).href);
  }

  // The STEP parser runs in a Web Worker so big files don't freeze the page.
  // If the site's Content Security Policy blocks blob: workers we fall back to the main thread.
  function getEngine() {
    if (!enginePromise) {
      enginePromise = createWorkerEngine().catch((err) => {
        console.warn('[step-viewer] Web Worker unavailable, parsing on the main thread:', err && err.message);
        return createMainThreadEngine();
      });
      // Let a failed engine be retried by the next viewer.
      enginePromise.catch(() => { enginePromise = null; });
    }
    return enginePromise;
  }

  function createWorkerEngine() {
    return new Promise((resolve, reject) => {
      const source = [
        computeFeatureEdges.toString(),
        packOcctResult.toString(),
        singleFileColor.toString(),
        '(' + occtWorkerMain.toString() + ')(' + JSON.stringify(absUrl(config.occtUrl)) + ',' + JSON.stringify(wasmUrl()) + ');',
      ].join('\n');
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker;
      try {
        worker = new Worker(url);
      } catch (err) {
        reject(err);
        return;
      }
      const pending = new Map();
      let seq = 0;
      let ready = false;
      const engine = {
        parse(format, buffer, params, wantEdges) {
          return new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { res, rej });
            worker.postMessage({ id, format, buffer, params, wantEdges }, [buffer]);
          });
        },
      };
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'ready') {
          ready = true;
          resolve(engine);
        } else if (d.type === 'fatal') {
          reject(new Error(d.message));
        } else {
          const p = pending.get(d.id);
          pending.delete(d.id);
          if (p) d.error ? p.rej(new Error(d.error)) : p.res(d.result);
        }
      };
      worker.onerror = (e) => {
        if (e.preventDefault) e.preventDefault();
        const err = new Error(e.message || 'The geometry worker stopped');
        if (!ready) reject(err);
        pending.forEach((p) => p.rej(err));
        pending.clear();
        if (ready) enginePromise = null; // start a fresh worker next time
      };
    });
  }

  function createMainThreadEngine() {
    const init = global.occtimportjs
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = absUrl(config.occtUrl);
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + config.occtUrl));
        document.head.appendChild(s);
      });
    return init
      .then(() => global.occtimportjs({ locateFile: (f) => (/\.wasm$/.test(f) ? wasmUrl() : f) }))
      .then((occt) => ({
        parse(format, buffer, params, wantEdges) {
          return new Promise((resolve) => {
            const raw = occt.ReadFile(format, new Uint8Array(buffer), params);
            const result = packOcctResult(raw, wantEdges).result;
            result.fileColor = singleFileColor(result, buffer);
            resolve(result);
          });
        },
      }));
  }

  // --- The functions below also run inside the worker, so they must stay self-contained. ---

  function occtWorkerMain(occtUrl, wasmUrl) {
    /* global importScripts, occtimportjs */
    importScripts(occtUrl);
    const ready = occtimportjs({ locateFile: (f) => (/\.wasm$/.test(f) ? wasmUrl : f) });
    ready.then(
      () => postMessage({ type: 'ready' }),
      (e) => postMessage({ type: 'fatal', message: 'Could not start the geometry engine: ' + ((e && e.message) || e) })
    );
    onmessage = async (e) => {
      const { id, format, buffer, params, wantEdges } = e.data;
      try {
        const occt = await ready;
        const raw = occt.ReadFile(format, new Uint8Array(buffer), params);
        const packed = packOcctResult(raw, wantEdges);
        packed.result.fileColor = singleFileColor(packed.result, buffer);
        postMessage({ id, result: packed.result }, packed.transfer);
      } catch (err) {
        postMessage({ id, error: (err && err.message) || String(err) });
      }
    };
  }

  // Turns occt-import-js output (plain arrays) into typed arrays that can be transferred cheaply.
  function packOcctResult(raw, wantEdges) {
    if (!raw || !raw.success) return { result: { success: false, meshes: [] }, transfer: [] };
    const meshes = [];
    const transfer = [];
    for (const m of raw.meshes) {
      const pos = new Float32Array(m.attributes.position.array);
      const nrm = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      const idx = new Uint32Array(m.index.array);
      const faces = (m.brep_faces || []).map((f) => ({ first: f.first, last: f.last, color: f.color || null }));
      const out = { name: m.name || '', color: m.color || null, pos, nrm, idx, faces, edges: null, corners: null };
      transfer.push(pos.buffer, idx.buffer);
      if (nrm) transfer.push(nrm.buffer);
      if (wantEdges && faces.length) {
        const fe = computeFeatureEdges(pos, idx, faces);
        out.edges = fe.edges;
        out.corners = fe.corners;
        transfer.push(fe.edges.buffer, fe.corners.buffer);
      }
      meshes.push(out);
    }
    return { result: { success: true, meshes }, transfer };
  }

  // occt-import-js misses colours attached to faces through STYLED_ITEM in some exporters
  // (Fusion 360, Onshape). When it found none and the file uses one single colour, use that.
  function singleFileColor(result, buffer) {
    if (!result.success || result.meshes.some((m) => m.color || m.faces.some((f) => f.color))) return null;
    const text = new TextDecoder('latin1').decode(buffer);
    const re = /COLOUR_RGB\s*\(\s*'[^']*'\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)/g;
    let found = null, match;
    while ((match = re.exec(text))) {
      const key = match.slice(1, 4).map((v) => (+v).toFixed(3)).join(',');
      if (found && found.key !== key) return null;
      found = { key, rgb: match.slice(1, 4).map(Number) };
    }
    return found ? found.rgb : null;
  }

  // CAD-style edges: the outline of every B-rep face. An edge used by exactly one triangle of a face
  // is on that face's boundary. Vertices are welded by position first so seams on cylinders vanish.
  // Corners (where edges meet or turn sharply) are returned separately for measurement snapping.
  function computeFeatureEdges(pos, idx, faces) {
    const n = pos.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const q = 1 / (diag * 1e-6);

    const weld = new Uint32Array(n);
    const rep = [];
    const keys = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.round(pos[3 * i] * q) + ',' + Math.round(pos[3 * i + 1] * q) + ',' + Math.round(pos[3 * i + 2] * q);
      let id = keys.get(k);
      if (id === undefined) {
        id = rep.length;
        keys.set(k, id);
        rep.push(i);
      }
      weld[i] = id;
    }

    const N = rep.length;
    const seen = new Set();
    const segs = [];
    for (const f of faces) {
      const count = new Map();
      for (let t = f.first; t <= f.last; t++) {
        for (let e = 0; e < 3; e++) {
          const a = weld[idx[3 * t + e]], b = weld[idx[3 * t + ((e + 1) % 3)]];
          if (a === b) continue;
          const key = a < b ? a * N + b : b * N + a;
          count.set(key, (count.get(key) || 0) + 1);
        }
      }
      count.forEach((c, key) => {
        if (c === 1 && !seen.has(key)) {
          seen.add(key);
          segs.push(key);
        }
      });
    }

    const edges = new Float32Array(segs.length * 6);
    const degree = new Uint32Array(N);
    const nbA = new Int32Array(N).fill(-1);
    const nbB = new Int32Array(N).fill(-1);
    for (let s = 0; s < segs.length; s++) {
      const a = Math.floor(segs[s] / N), b = segs[s] % N;
      const pa = rep[a] * 3, pb = rep[b] * 3;
      edges.set([pos[pa], pos[pa + 1], pos[pa + 2], pos[pb], pos[pb + 1], pos[pb + 2]], s * 6);
      degree[a]++; degree[b]++;
      if (nbA[a] < 0) nbA[a] = b; else nbB[a] = b;
      if (nbA[b] < 0) nbA[b] = a; else nbB[b] = a;
    }

    // A vertex is a corner unless exactly two edges meet there almost in a straight line
    // (that is just a point along a tessellated curve).
    const cosLimit = Math.cos(40 * Math.PI / 180);
    const corners = [];
    for (let v = 0; v < N; v++) {
      if (!degree[v]) continue;
      let corner = degree[v] !== 2;
      if (!corner) {
        const p = rep[v] * 3, a = rep[nbA[v]] * 3, b = rep[nbB[v]] * 3;
        const ux = pos[p] - pos[a], uy = pos[p + 1] - pos[a + 1], uz = pos[p + 2] - pos[a + 2];
        const wx = pos[b] - pos[p], wy = pos[b + 1] - pos[p + 1], wz = pos[b + 2] - pos[p + 2];
        const cos = (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1);
        corner = cos < cosLimit;
      }
      if (corner) corners.push(pos[rep[v] * 3], pos[rep[v] * 3 + 1], pos[rep[v] * 3 + 2]);
    }
    return { edges, corners: new Float32Array(corners) };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById('step-viewer-styles')) return;
    const style = document.createElement('style');
    style.id = 'step-viewer-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function parseValue(raw, def, key) {
    if (key === 'autoRotate') {
      if (raw === '' || raw === 'true') return 20;
      if (raw === 'false') return 0;
      return parseFloat(raw) || 0;
    }
    if (typeof def === 'boolean') return !/^(false|0|no|off)$/i.test(raw);
    if (typeof def === 'number') {
      const n = parseFloat(raw);
      return isNaN(n) ? def : n;
    }
    if (Array.isArray(def)) return raw.split(/[\s,]+/).filter(Boolean).map(Number);
    return raw;
  }

  function resolveOptions(el, options) {
    const o = Object.assign({}, DEFAULTS);
    for (const key of Object.keys(DEFAULTS)) {
      if (el.dataset[key] !== undefined) o[key] = parseValue(el.dataset[key], DEFAULTS[key], key);
    }
    Object.assign(o, options);
    if (o.autoRotate === true) o.autoRotate = 20;
    if (typeof o.rotation === 'string') o.rotation = parseValue(o.rotation, [], 'rotation');
    o.rotation = [0, 1, 2].map((i) => Number(o.rotation[i]) || 0);
    o.zoom = Number(o.zoom) > 0 ? Number(o.zoom) : 1;
    o.up = String(o.up).toLowerCase() === 'y' ? 'y' : 'z';
    o.orbit = o.orbit === 'turntable' ? 'turntable' : 'free';
    if (!UNITS[o.units]) o.units = 'mm';
    if (!QUALITY[o.quality]) o.quality = 'normal';
    return o;
  }

  const cssSize = (v) => (typeof v === 'number' || /^\d+(\.\d+)?$/.test(v) ? v + 'px' : v);

  function fileName(url) {
    if (typeof Blob !== 'undefined' && url instanceof Blob) return url.name || 'model.step';
    try {
      const path = new URL(url, document.baseURI).pathname;
      return decodeURIComponent(path.split('/').pop()) || 'model.step';
    } catch (e) {
      return 'model.step';
    }
  }

  function guessFormat(url) {
    const ext = (fileName(url).split('.').pop() || '').toLowerCase();
    if (ext === 'igs' || ext === 'iges') return 'iges';
    if (ext === 'brep' || ext === 'brp') return 'brep';
    return 'step';
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  const svgEl = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const trimZeros = (s) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);

  // ---------------------------------------------------------------------------
  // Camera controls: orbit around a pivot, pan, zoom towards the cursor
  // ---------------------------------------------------------------------------

  class Controls {
    constructor(viewer) {
      this.viewer = viewer;
      this.camera = viewer.camera;
      this.dom = viewer.canvas;
      this.target = new THREE.Vector3();
      this.minDistance = 0;
      this.maxDistance = Infinity;
      this.rotateSpeed = 0.006;
      this.autoRotate = 0;
      this.pointers = new Map();
      this.mode = null;
      this.velocity = new THREE.Vector2();
      this.wheel = { factor: 1, x: 0, y: 0 };
      this.anim = null;
      this.lastTime = 0;

      this._down = this._down.bind(this);
      this._move = this._move.bind(this);
      this._up = this._up.bind(this);
      this._wheel = this._wheel.bind(this);
      this._menu = (e) => e.preventDefault();
      this.dom.addEventListener('pointerdown', this._down);
      this.dom.addEventListener('pointermove', this._move);
      this.dom.addEventListener('pointerup', this._up);
      this.dom.addEventListener('pointercancel', this._up);
      this.dom.addEventListener('wheel', this._wheel, { passive: false });
      this.dom.addEventListener('contextmenu', this._menu);
    }

    dispose() {
      this.dom.removeEventListener('pointerdown', this._down);
      this.dom.removeEventListener('pointermove', this._move);
      this.dom.removeEventListener('pointerup', this._up);
      this.dom.removeEventListener('pointercancel', this._up);
      this.dom.removeEventListener('wheel', this._wheel);
      this.dom.removeEventListener('contextmenu', this._menu);
    }

    get distance() {
      return this.camera.position.distanceTo(this.target);
    }

    setPose(target, position, up) {
      this.target.copy(target);
      this.camera.position.copy(position);
      this.camera.up.copy(up || this.viewer.upVec);
      this._changed();
    }

    _changed() {
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      this.viewer.requestRender();
    }

    stop() {
      this.anim = null;
      this.velocity.set(0, 0);
    }

    // Drag rotation. 'free' turns about the screen axes with no limits; 'turntable' keeps the up axis upright.
    rotate(dx, dy, free) {
      if (free || this.orbit !== 'turntable') {
        this.turn(-dx * this.rotateSpeed, -dy * this.rotateSpeed);
        return;
      }
      const up = this.camera.up;
      const offset = this.camera.position.clone().sub(this.target);
      offset.applyAxisAngle(up, -dx * this.rotateSpeed);
      const polar = offset.angleTo(up);
      const next = Math.min(Math.max(polar - dy * this.rotateSpeed, 1e-3), Math.PI - 1e-3);
      const axis = new THREE.Vector3().crossVectors(up, offset);
      if (axis.lengthSq() > 1e-12) offset.applyAxisAngle(axis.normalize(), next - polar);
      this.camera.position.copy(this.target).add(offset);
      this._changed();
    }

    // The camera pose after turning by `yaw` (about the screen's vertical axis), `pitch` (horizontal axis)
    // and `roll` (viewing axis), in radians. Positive yaw moves the camera right, positive pitch moves it down.
    poseAfterTurn(yaw, pitch, roll) {
      const cam = this.camera;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const q = new THREE.Quaternion().setFromAxisAngle(up, yaw || 0)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, pitch || 0))
        .multiply(new THREE.Quaternion().setFromAxisAngle(forward, roll || 0));
      const offset = cam.position.clone().sub(this.target).applyQuaternion(q);
      return { target: this.target.clone(), position: this.target.clone().add(offset), up: up.applyQuaternion(q) };
    }

    // Spin about the model's up axis, like a turntable.
    spin(angle) {
      const up = this.viewer.upVec;
      this.camera.position.sub(this.target).applyAxisAngle(up, angle).add(this.target);
      this.camera.up.applyAxisAngle(up, angle);
      this._changed();
    }

    turn(yaw, pitch, roll) {
      const pose = this.poseAfterTurn(yaw, pitch, roll);
      this.camera.position.copy(pose.position);
      this.camera.up.copy(pose.up);
      this._changed();
    }

    pan(dx, dy) {
      const h = this.dom.clientHeight || 1;
      const perPixel = (2 * this.distance * Math.tan((this.camera.fov * DEG) / 2)) / h;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const move = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));
      this.target.add(move);
      this.camera.position.add(move);
      this._changed();
    }

    // Zoom by `factor` (<1 = closer) keeping the point under the cursor where it is.
    // With `pickSurface` the pivot first moves to the depth of the surface under the cursor.
    zoomAt(factor, clientX, clientY, pickSurface) {
      const cam = this.camera;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      if (pickSurface) {
        const hit = this.viewer._surfaceAt(clientX, clientY);
        if (hit) {
          const depth = hit.point.clone().sub(cam.position).dot(forward);
          if (depth > this.minDistance) this.target.copy(cam.position).addScaledVector(forward, depth);
        }
      }
      const dist = this.distance;
      const next = Math.min(Math.max(dist * factor, this.minDistance), this.maxDistance);
      if (!dist || next === dist) return;
      const f = next / dist;
      const ray = this.viewer._rayAt(clientX, clientY);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, this.target);
      const p = ray.intersectPlane(plane, new THREE.Vector3()) || this.target.clone();
      const offset = cam.position.clone().sub(this.target);
      this.target.sub(p).multiplyScalar(f).add(p);
      cam.position.copy(this.target).addScaledVector(offset, f);
      this._changed();
    }

    // `up` is the camera's up direction at the end; by default the model's up axis.
    animateTo(target, position, ms, up) {
      const fromDir = this.camera.position.clone().sub(this.target);
      const toDir = position.clone().sub(target);
      const fromDist = fromDir.length(), toDist = toDir.length();
      fromDir.normalize();
      toDir.normalize();
      const fromUp = this.camera.up.clone().normalize();
      const toUp = (up || this.viewer.upVec).clone().normalize();
      this.velocity.set(0, 0);
      this.anim = {
        t0: performance.now(), ms: ms || 500,
        fromT: this.target.clone(), toT: target.clone(),
        fromDir, fromDist, toDist,
        rot: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
        fromUp,
        upRot: new THREE.Quaternion().setFromUnitVectors(fromUp, toUp),
      };
      this.viewer.requestRender();
    }

    // Advances inertia, animation, wheel and auto-rotate. Returns true while more frames are needed.
    update(now) {
      const dt = this.lastTime ? Math.min(now - this.lastTime, 100) : 16;
      this.lastTime = now;
      let active = false;

      if (this.wheel.factor !== 1) {
        this.zoomAt(this.wheel.factor, this.wheel.x, this.wheel.y, true);
        this.wheel.factor = 1;
      }
      if (this.anim) {
        const a = this.anim;
        const t = Math.min((now - a.t0) / a.ms, 1);
        const e = easeInOut(t);
        const q = new THREE.Quaternion().slerp(a.rot, e);
        const dir = a.fromDir.clone().applyQuaternion(q);
        const dist = a.fromDist * Math.pow(a.toDist / a.fromDist, e);
        this.target.lerpVectors(a.fromT, a.toT, e);
        this.camera.position.copy(this.target).addScaledVector(dir, dist);
        this.camera.up.copy(a.fromUp).applyQuaternion(new THREE.Quaternion().slerp(a.upRot, e));
        this._changed();
        if (t < 1) active = true;
        else this.anim = null;
      }
      if (!this.pointers.size && this.velocity.lengthSq() > 0.01) {
        const k = dt / 16.7;
        this.rotate(this.velocity.x * k, this.velocity.y * k);
        this.velocity.multiplyScalar(Math.pow(0.9, k));
        active = true;
      }
      if (this.autoRotate && !this.viewer._interacted) {
        this.spin((-this.autoRotate * DEG * dt) / 1000);
        active = true;
      }
      return active;
    }

    _down(e) {
      if (e.pointerType === 'mouse' && e.button > 2) return;
      this.dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stop();
      this.viewer._interact();
      if (this.pointers.size === 1) {
        this.mode = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey ? 'pan' : 'rotate';
      } else if (this.pointers.size === 2) {
        this.mode = 'pinch';
        this.pinch = this._pinchState();
      }
      this.lastMove = null;
      this.dom.classList.add('sv-dragging');
    }

    _move(e) {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.mode === 'rotate') {
        this.rotate(dx, dy);
        this.lastMove = { dx, dy, t: performance.now() };
      } else if (this.mode === 'pan') {
        this.pan(dx, dy);
      } else if (this.mode === 'pinch') {
        const s = this._pinchState();
        if (s.dist > 0 && this.pinch.dist > 0) this.zoomAt(this.pinch.dist / s.dist, s.x, s.y, false);
        this.pan(s.x - this.pinch.x, s.y - this.pinch.y);
        this.pinch = s;
      }
    }

    _up(e) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        this.mode = 'rotate';
      } else if (!this.pointers.size) {
        this.mode = null;
        this.dom.classList.remove('sv-dragging');
        const m = this.lastMove;
        if (m && performance.now() - m.t < 50) {
          this.velocity.set(m.dx, m.dy);
          this.viewer.requestRender();
        }
      }
    }

    _wheel(e) {
      e.preventDefault();
      this.stop();
      this.viewer._interact();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 100;
      // ctrlKey is set for trackpad pinch gestures, which send small deltas.
      this.wheel.factor *= Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015));
      this.wheel.x = e.clientX;
      this.wheel.y = e.clientY;
      this.viewer.requestRender();
    }

    _pinchState() {
      const [a, b] = Array.from(this.pointers.values());
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  }

  // ---------------------------------------------------------------------------
  // Viewer
  // ---------------------------------------------------------------------------

  class Viewer {
    constructor(root, options) {
      this.el = root;
      this.o = resolveOptions(root, options || {});
      if (!this.o.src) throw new Error('step-viewer: no src given');
      this.measurements = [];
      this.markers = [];
      this.activeMarker = null;
      this.addMode = false;
      this.pending = null;
      this.hover = null;
      this.measureMode = false;
      this._interacted = false;
      this._raf = 0;
      this._disposed = false;
      this._cleanup = [];
      this.ready = new Promise((resolve, reject) => {
        this._resolveReady = resolve;
        this._rejectReady = reject;
      });
      this.ready.catch(() => {}); // errors are shown inside the viewer

      injectStyles();
      this._buildDom();

      if (this.o.lazy && 'IntersectionObserver' in global) {
        this._io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this._io.disconnect();
            this._io = null;
            this._start();
          }
        }, { rootMargin: '200px' });
        this._io.observe(root);
      } else {
        this._start();
      }
    }

    // --- public API ----------------------------------------------------------

    /** Show a standard view ('iso', 'front', ...) or a camera direction [x, y, z]. */
    setView(view, animate) {
      if (!this.controls) return;
      const pose = this._fitPose(this._viewDir(view), this.o.zoom);
      if (animate === false) this.controls.setPose(pose.target, pose.position);
      else this.controls.animateTo(pose.target, pose.position);
    }

    /** Back to the view and zoom from the options. */
    /**
     * The current camera as options for a page: { view: [x, y, z], zoom }.
     * Use them as data-view / data-zoom to start other viewers looking the same way.
     */
    getView() {
      if (!this.controls) return null;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      const fit = this._fitPose(dir, 1);
      const zoom = fit.position.distanceTo(fit.target) / this.camera.position.distanceTo(this.controls.target);
      return { view: dir.toArray().map((v) => Math.round(v * 1000) / 1000), zoom: Math.round(zoom * 100) / 100 };
    }

    resetView(animate) {
      if (!this.controls) return;
      const pose = this._fitPose(this._viewDir(this.o.view), this.o.zoom);
      if (animate === false) this.controls.setPose(pose.target, pose.position);
      else this.controls.animateTo(pose.target, pose.position);
    }

    setMeasureMode(on) {
      on = !!on;
      if (on === this.measureMode) return;
      this.measureMode = on;
      if (on) {
        this.closeMarker();
        this._setAddMode(false);
      }
      if (!on) {
        this._cancelPending();
        this.hover = null;
      }
      this.el.classList.toggle('sv-measuring', on);
      if (this.btn.measure) this.btn.measure.setAttribute('aria-pressed', String(on));
      this._hint(on ? 'Click a point on the model to start measuring' : '');
      this.requestRender();
    }

    clearMeasurements() {
      this._cancelPending();
      this.measurements.forEach((m) => this._removeMeasurementDom(m));
      this.measurements = [];
      this._syncClearButton();
      if (this.measureMode) this._hint('Click a point on the model to start measuring');
      this.requestRender();
    }

    /** Measurements in model coordinates and the viewer's units. */
    getMeasurements() {
      return this.measurements.map((m) => this._measurementInfo(m));
    }

    /** Open marker `index` (0-based): fly the camera there and show its card. */
    openMarker(index) {
      const mk = this.markers[index];
      if (!mk) return;
      if (this.measureMode) this.setMeasureMode(false);
      this._interact();
      this.activeMarker = index;
      this.markers.forEach((m, i) => m.el.classList.toggle('sv-active', i === index));
      this.el.classList.remove('sv-markers-off');
      const cam = mk.data.camera;
      let target, position, up;
      if (cam && cam.position && cam.target) {
        target = this.model.localToWorld(new THREE.Vector3().fromArray(cam.target));
        position = this.model.localToWorld(new THREE.Vector3().fromArray(cam.position));
        if (Array.isArray(cam.up)) up = new THREE.Vector3().fromArray(cam.up).applyQuaternion(this.model.quaternion);
      } else {
        target = this.model.localToWorld(mk.pos.clone());
        position = this.camera.position.clone().add(target.clone().sub(this.controls.target));
        up = this.camera.up.clone();
      }
      if (this.el.clientWidth < 520) {
        // The card covers the lower half on narrow screens: move the view so the marker sits near the top.
        const basis = new THREE.Matrix4().lookAt(position, target, up || this.upVec);
        const screenUp = new THREE.Vector3().setFromMatrixColumn(basis, 1);
        const shift = 0.27 * 2 * position.distanceTo(target) * Math.tan((this.camera.fov * DEG) / 2);
        target.addScaledVector(screenUp, -shift);
        position.addScaledVector(screenUp, -shift);
      }
      this.controls.animateTo(target, position, cam ? 900 : 700, up);
      this._showCard(mk, index);
      this._syncNav();
      this._syncEditor();
      this.el.dispatchEvent(new CustomEvent('stepviewer:marker', { detail: { index, marker: mk.data } }));
    }

    closeMarker() {
      if (this.activeMarker == null) return;
      this.activeMarker = null;
      this.markers.forEach((m) => m.el.classList.remove('sv-active'));
      this._hideCard();
      this._syncNav();
      this._syncEditor();
    }

    nextMarker(step) {
      const n = this.markers.length;
      if (!n) return;
      const from = this.activeMarker == null ? (step < 0 ? 0 : -1) : this.activeMarker;
      this.openMarker((from + (step || 1) + n) % n);
    }

    /** Replace all markers. Positions and camera poses are in model coordinates. */
    setMarkers(list) {
      this.closeMarker();
      this.markers.forEach((m) => m.el.remove());
      this.markers = (list || []).filter((m) => m && Array.isArray(m.position)).map((data, i) => {
        const b = el('button', 'sv-marker', String(i + 1));
        b.type = 'button';
        b.style.setProperty('--i', i);
        b.setAttribute('aria-label', 'Marker ' + (i + 1) + (data.title ? ': ' + data.title : ''));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.activeMarker === i) this.closeMarker();
          else this.openMarker(i);
        });
        this.markerLayer.appendChild(b);
        return { data, pos: new THREE.Vector3().fromArray(data.position), el: b, occluded: false };
      });
      this._occlusionAt = 0;
      if (this.btn.markers) this.btn.markers.hidden = !this.markers.length;
      this._syncNav();
      this._markersChanged();
      this.requestRender();
    }

    /** Markers as plain data, ready to save as JSON. */
    getMarkers() {
      const round = (a) => a.map((v) => Math.round(v * 1000) / 1000);
      return this.markers.map((m) => {
        const out = Object.assign({}, m.data, { position: round(m.pos.toArray()) });
        if (out.camera) {
          const c = out.camera;
          out.camera = { position: round(c.position), target: round(c.target) };
          if (Array.isArray(c.up)) out.camera.up = round(c.up);
        }
        return out;
      });
    }

    /** Show or hide the view cube in the bottom-left corner. */
    setGizmo(on) {
      this.gizmo.hidden = !on;
      this.btn.gizmo.setAttribute('aria-pressed', String(!!on));
      this.requestRender();
    }

    /** Download the model file. Does nothing while downloads are disabled. */
    download() {
      if (!this.o.download) return;
      const url = this.o.downloadUrl || this.o.src;
      const a = document.createElement('a');
      a.href = url instanceof Blob ? URL.createObjectURL(url) : url;
      a.download = this.o.downloadName || fileName(url);
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (url instanceof Blob) setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    /**
     * Turn the download button on or off. Optionally change what is downloaded:
     * setDownload(true, { url: '/files/part-full.step', name: 'part.step' })
     */
    setDownload(enabled, options) {
      this.o.download = !!enabled;
      if (options && 'url' in options) this.o.downloadUrl = options.url || null;
      if (options && 'name' in options) this.o.downloadName = options.name || null;
      const b = this.btn.download;
      b.hidden = !this.o.download;
      b.title = 'Download ' + (this.o.downloadName || fileName(this.o.downloadUrl || this.o.src));
      b.setAttribute('aria-label', b.title);
    }

    /**
     * Change the look of markers and their cards: 'default', 'digital', 'military' or 'agricultural'.
     * Any other name adds the class sv-theme-<name>, for your own CSS.
     */
    setTheme(name) {
      this.el.classList.remove('sv-theme-' + this.o.theme);
      this.o.theme = String(name || 'default');
      this.el.classList.add('sv-theme-' + this.o.theme);
      // Reopen the card so its entrance plays in the new style.
      if (this.activeMarker != null) this._showCard(this.markers[this.activeMarker], this.activeMarker);
    }

    toggleFullscreen() {
      const root = this.el;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === root) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (root.classList.contains('sv-expanded')) {
        this._setExpanded(false);
      } else if (root.requestFullscreen) {
        root.requestFullscreen().catch(() => this._setExpanded(true));
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      } else {
        this._setExpanded(true); // iPhone Safari has no element fullscreen
      }
    }

    requestRender() {
      if (!this._raf && this.renderer && !this._disposed) this._raf = requestAnimationFrame(this._frame);
    }

    dispose() {
      this._disposed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._io) this._io.disconnect();
      if (this._ro) this._ro.disconnect();
      if (this._helpTimer) clearTimeout(this._helpTimer);
      this._cleanup.forEach((fn) => fn());
      if (this.controls) this.controls.dispose();
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) [].concat(obj.material).forEach((m) => m.dispose());
        });
      }
      if (this.renderer) this.renderer.dispose();
      this._ui.forEach((node) => node.remove());
      if (this.canvas) this.canvas.remove();
      this.el.classList.remove('sv-root', 'sv-measuring', 'sv-expanded', 'sv-markers-off', 'sv-theme-' + this.o.theme);
      instances.delete(this.el);
    }

    // --- loading -------------------------------------------------------------

    async _start() {
      const o = this.o;
      try {
        this._status('Loading…');
        const threeReady = loadThree();
        const engineReady = getEngine();
        const buffer = await this._fetchModel();
        if (this._disposed) return;
        this._status('Preparing geometry engine…');
        const engine = await engineReady;
        this._status('Processing geometry…');
        const params = Object.assign({ linearUnit: UNITS[o.units], linearDeflectionType: 'bounding_box_ratio' }, QUALITY[o.quality]);
        const result = await engine.parse(o.format || guessFormat(o.src), buffer, params, o.edges || o.measure);
        if (!result.success) throw new Error('This file could not be read as ' + (o.format || guessFormat(o.src)).toUpperCase() + '.');
        await threeReady;
        if (this._disposed) return;
        this._setupScene();
        this._buildModel(result);
        this._status(null);
        this.resetView(false);
        this._afterLoad();
        const markers = await this._loadMarkers();
        if (this._disposed) return;
        this.setMarkers(markers);
        this.el.dispatchEvent(new CustomEvent('stepviewer:load', { detail: { viewer: this, size: this.size } }));
        this._resolveReady(this);
      } catch (err) {
        console.error('[step-viewer]', err);
        this._status(err.message || String(err), null, true);
        this.el.dispatchEvent(new CustomEvent('stepviewer:error', { detail: { error: err } }));
        this._rejectReady(err);
      }
    }

    async _loadMarkers() {
      let list = this.o.markers;
      if (this._disposed) return [];
      if (list == null) {
        const inline = this.el.querySelector('script[type="application/json"]');
        if (!inline) return [];
        list = inline.textContent;
      }
      try {
        if (typeof list === 'string') {
          const text = list.trim();
          if (text.charAt(0) === '[' || text.charAt(0) === '{') list = JSON.parse(text);
          else {
            const res = await fetch(text);
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            list = await res.json();
          }
        }
        if (list && !Array.isArray(list)) list = list.markers;
        return Array.isArray(list) ? list : [];
      } catch (err) {
        console.warn('[step-viewer] Could not load markers:', err.message);
        return [];
      }
    }

    async _fetchModel() {
      // A File from a file picker or drag and drop is read locally; nothing is uploaded.
      if (this.o.src instanceof Blob) {
        this._status('Reading file…');
        return this.o.src.arrayBuffer();
      }
      const name = fileName(this.o.src);
      let res;
      try {
        res = await fetch(this.o.src);
      } catch (e) {
        throw new Error('Could not download ' + name + '.');
      }
      if (!res.ok) throw new Error('Could not download ' + name + ' (' + res.status + ' ' + res.statusText + ').');
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body || !total) {
        this._status('Downloading model…');
        return res.arrayBuffer();
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        this._status('Downloading model…', Math.min(received / total, 1));
      }
      const out = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out.buffer;
    }

    // --- DOM -----------------------------------------------------------------

    _buildDom() {
      const root = this.el;
      const o = this.o;
      root.classList.add('sv-root', 'sv-theme-' + o.theme);
      if (!root.hasAttribute('tabindex')) root.tabIndex = 0;
      if (o.width != null) root.style.width = cssSize(o.width);
      if (o.height != null) root.style.height = cssSize(o.height);
      if (o.background) root.style.background = o.background;

      this.svg = svgEl('svg');
      this.svg.setAttribute('class', 'sv-overlay');
      this.layer = el('div', 'sv-layer');

      this.toolbar = el('div', 'sv-toolbar');
      this.toolbar.setAttribute('role', 'toolbar');
      this.toolbar.hidden = true;
      this.btn = {};
      const addBtn = (key, label, iconName, onClick, extra) => {
        const b = el('button', 'sv-btn', icon(iconName));
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        if (extra) extra(b);
        b.addEventListener('click', onClick);
        this.toolbar.appendChild(b);
        this.btn[key] = b;
      };
      addBtn('home', 'Reset view', 'home', () => this.resetView());
      addBtn('gizmo', 'View cube', 'cube', () => this.setGizmo(this.gizmo.hidden), (b) => b.setAttribute('aria-pressed', 'false'));
      if (o.views) addBtn('views', 'Standard views', 'views', () => this._toggleMenu(), (b) => b.setAttribute('aria-expanded', 'false'));
      if (o.measure) {
        addBtn('measure', 'Measure distance', 'ruler', () => this.setMeasureMode(!this.measureMode), (b) => b.setAttribute('aria-pressed', 'false'));
        addBtn('clear', 'Clear measurements', 'clear', () => this.clearMeasurements(), (b) => { b.hidden = true; });
      }
      if (o.markers != null || o.editor || root.querySelector('script[type="application/json"]')) {
        addBtn('markers', 'Show or hide markers', 'pin', () => this._toggleMarkers(), (b) => { b.hidden = true; b.setAttribute('aria-pressed', 'true'); });
      }
      if (o.editor) addBtn('addMarker', 'Add marker', 'addPin', () => this._setAddMode(!this.addMode), (b) => b.setAttribute('aria-pressed', 'false'));
      // Always created so setDownload() can show it later; hidden while downloads are off.
      addBtn('download', 'Download ' + (o.downloadName || fileName(o.downloadUrl || o.src)), 'download', () => this.download(), (b) => { b.hidden = !o.download; });
      if (o.fullscreen) addBtn('fullscreen', 'Fullscreen', 'expand', () => this.toggleFullscreen());

      this.menu = el('div', 'sv-menu');
      this.menu.hidden = true;
      Object.keys(VIEWS).forEach((name) => {
        const b = el('button', null, VIEW_LABELS[name]);
        b.type = 'button';
        b.addEventListener('click', () => {
          this._toggleMenu(false);
          this.setView(name);
        });
        this.menu.appendChild(b);
      });

      this.markerLayer = el('div', 'sv-markers');

      this.bottom = el('div', 'sv-bottom');
      this.info = el('div', 'sv-pill sv-info');
      this.info.hidden = true;
      this.hintEl = el('div', 'sv-pill sv-hint');
      this.hintEl.hidden = true;
      this.nav = el('div', 'sv-nav');
      this.nav.hidden = true;
      const navBtn = (cls, label, html, onClick) => {
        const b = el('button', cls, html);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.addEventListener('click', onClick);
        this.nav.appendChild(b);
        return b;
      };
      navBtn(null, 'Previous marker', icon('prev'), () => this.nextMarker(-1));
      this.navTitle = navBtn('sv-nav-title', 'Open marker', '', () => (this.activeMarker == null ? this.nextMarker(1) : this.closeMarker()));
      navBtn(null, 'Next marker', icon('next'), () => this.nextMarker(1));
      this.bottom.append(this.info, this.nav, this.hintEl);

      this.editor = el('div', 'sv-editor', '<div class="sv-editor-head">Markers <button type="button">Copy JSON</button></div>'
        + '<p>Click the model to add a marker. Edit the title and text in its card, then copy this into your markers file.</p><textarea readonly spellcheck="false"></textarea>');
      this.editor.hidden = true;
      this.editor.querySelector('button').addEventListener('click', (e) => {
        const ta = this.editor.querySelector('textarea');
        const done = () => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy JSON'; }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
        else { ta.select(); document.execCommand('copy'); done(); }
      });

      this.statusEl = el('div', 'sv-status', '<div class="sv-spinner"></div><p></p><div class="sv-progress"><i></i></div>');
      this.statusEl.hidden = true;

      this._buildGizmo();
      this._ui = [this.svg, this.layer, this.markerLayer, this.toolbar, this.menu, this.gizmo, this.bottom, this.editor, this.statusEl];
      root.append(...this._ui);

      const onKey = (e) => {
        if (e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (this.markers.length && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          this.nextMarker(e.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        if (e.key !== 'Escape') return;
        if (!this.menu.hidden) this._toggleMenu(false);
        else if (this.activeMarker != null) this.closeMarker();
        else if (this.addMode) this._setAddMode(false);
        else if (this.pending) this._cancelPending(true);
        else if (this.measureMode) this.setMeasureMode(false);
      };
      root.addEventListener('keydown', onKey);
      const onDocDown = (e) => {
        if (!this.menu.hidden && !this.menu.contains(e.target) && e.target !== this.btn.views && !this.btn.views.contains(e.target)) this._toggleMenu(false);
      };
      document.addEventListener('pointerdown', onDocDown, true);
      const onFs = () => {
        const on = (document.fullscreenElement || document.webkitFullscreenElement) === root;
        this._setFullscreenIcon(on);
      };
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
      this._cleanup.push(() => {
        root.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onDocDown, true);
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('webkitfullscreenchange', onFs);
      });
    }

    _status(text, progress, isError) {
      const s = this.statusEl;
      if (text == null) {
        s.hidden = true;
        return;
      }
      s.hidden = false;
      s.classList.toggle('sv-error', !!isError);
      s.querySelector('p').textContent = text;
      const bar = s.querySelector('.sv-progress');
      bar.style.visibility = progress == null ? 'hidden' : 'visible';
      if (progress != null) bar.firstChild.style.width = Math.round(progress * 100) + '%';
    }

    _hint(text) {
      this.hintEl.textContent = text || '';
      this.hintEl.hidden = !text;
    }

    _toggleMenu(open) {
      if (!this.btn.views) return;
      open = open === undefined ? this.menu.hidden : open;
      if (open) {
        const tb = this.toolbar;
        this.menu.style.top = tb.offsetTop + tb.offsetHeight + 6 + 'px';
      }
      this.menu.hidden = !open;
      this.btn.views.setAttribute('aria-expanded', String(open));
      if (open && this.menu.firstChild) this.menu.firstChild.focus({ preventScroll: true });
    }

    _setExpanded(on) {
      this.el.classList.toggle('sv-expanded', on);
      this._setFullscreenIcon(on);
    }

    _setFullscreenIcon(on) {
      const b = this.btn.fullscreen;
      if (!b) return;
      b.innerHTML = icon(on ? 'collapse' : 'expand');
      b.title = on ? 'Exit fullscreen' : 'Fullscreen';
      b.setAttribute('aria-label', b.title);
    }

    _syncClearButton() {
      if (this.btn.clear) this.btn.clear.hidden = !this.measurements.length && !this.pending;
    }

    _afterLoad() {
      const o = this.o;
      this.toolbar.hidden = false;
      if (o.gizmo) this.setGizmo(true);
      if (o.info) {
        const s = this.size;
        const f = (v) => trimZeros(v.toFixed(o.precision));
        this.info.innerHTML = '';
        const name = el('b');
        name.textContent = fileName(o.src);
        const dims = el('span');
        dims.textContent = f(s.x) + ' × ' + f(s.y) + ' × ' + f(s.z) + ' ' + o.units;
        dims.title = 'Overall size (X × Y × Z)';
        this.info.append(name, dims);
        this.info.hidden = false;
      }
      if (o.help && !this._interacted) {
        const touch = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
        this._hint(touch ? 'Drag to rotate · Pinch to zoom · Two fingers to pan' : 'Drag to rotate · Right-drag to pan · Scroll to zoom');
        this._helpTimer = setTimeout(() => {
          if (!this.measureMode) this._hint('');
        }, 6000);
      }
    }

    _interact() {
      if (!this._interacted) {
        this._interacted = true;
        if (this._helpTimer) clearTimeout(this._helpTimer);
        if (!this.measureMode) this._hint('');
      }
    }

    // --- scene ---------------------------------------------------------------

    _setupScene() {
      const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      this.canvas = renderer.domElement;
      this.canvas.className = 'sv-canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);

      this.upVec = this.o.up === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
      this.camera.up.copy(this.upVec);
      this.scene.add(this.camera);

      const sky = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.9);
      sky.position.copy(this.upVec);
      this.scene.add(sky);
      // A light fixed to the camera keeps whatever faces the visitor well lit.
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(0.5, 0.9, 1);
      key.target.position.set(0, 0, -1);
      this.camera.add(key, key.target);

      this.raycaster = new THREE.Raycaster();
      this.controls = new Controls(this);
      this.controls.autoRotate = this.o.autoRotate;
      this.controls.orbit = this.o.orbit;
      this._frame = this._frame.bind(this);

      this._resize();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this.el);
      this._bindPointer();
    }

    _buildModel(result) {
      const o = this.o;
      const root = (this.model = new THREE.Group());
      root.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);

      const materials = new Map();
      const material = (hex) => {
        if (!materials.has(hex)) {
          materials.set(hex, new THREE.MeshPhongMaterial({
            color: new THREE.Color(hex),
            specular: 0x222222,
            shininess: 35,
            side: THREE.DoubleSide,
            polygonOffset: true, // keeps edges drawn cleanly on top of faces
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }));
        }
        return materials.get(hex);
      };
      const toHex = (rgb) => '#' + new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(o.edgeColor), transparent: true, opacity: 0.55 });

      this.meshes = [];
      this.edgeLines = [];
      const corners = [];
      const box = new THREE.Box3();

      for (const m of result.meshes) {
        if (!m.idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
        if (m.nrm && m.nrm.length === m.pos.length) g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
        g.setIndex(new THREE.BufferAttribute(m.idx, 1));
        if (!g.getAttribute('normal')) g.computeVertexNormals();

        const fileColor = m.color || result.fileColor;
        const base = o.fileColors && fileColor ? toHex(fileColor) : o.color;
        let mat = material(base);
        if (o.fileColors && m.faces.some((f) => f.color)) {
          // Faces can carry their own colours: one draw group per run of equal colour.
          const mats = [];
          const slot = new Map();
          let covered = 0;
          for (const f of m.faces) {
            const hex = f.color ? toHex(f.color) : base;
            if (!slot.has(hex)) {
              slot.set(hex, mats.length);
              mats.push(material(hex));
            }
            const start = f.first * 3, count = (f.last - f.first + 1) * 3;
            const last = g.groups[g.groups.length - 1];
            if (last && last.materialIndex === slot.get(hex) && last.start + last.count === start) last.count += count;
            else g.addGroup(start, count, slot.get(hex));
            covered += count;
          }
          if (mats.length > 1 && covered === m.idx.length) mat = mats;
          else {
            g.clearGroups();
            mat = mats.length === 1 && covered === m.idx.length ? mats[0] : mat;
          }
        }
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = m.name;
        root.add(mesh);
        this.meshes.push(mesh);
        g.computeBoundingBox();
        box.union(g.boundingBox);

        if (o.edges || o.measure) {
          let eg;
          if (m.edges && m.edges.length) {
            eg = new THREE.BufferGeometry();
            eg.setAttribute('position', new THREE.BufferAttribute(m.edges, 3));
          } else {
            eg = new THREE.EdgesGeometry(g, 30);
          }
          const lines = new THREE.LineSegments(eg, edgeMaterial);
          lines.visible = o.edges;
          root.add(lines);
          this.edgeLines.push(lines);
        }
        if (m.corners && m.corners.length) corners.push(m.corners);
      }
      if (!this.meshes.length) throw new Error('No geometry found in ' + fileName(o.src) + '.');

      this.scene.add(root);
      root.updateMatrixWorld(true);
      this.size = box.getSize(new THREE.Vector3());

      // Model corners in world space, used for snapping.
      const total = corners.reduce((n, c) => n + c.length, 0);
      this.cornersWorld = new Float32Array(total);
      const v = new THREE.Vector3();
      let k = 0;
      for (const c of corners) {
        for (let i = 0; i < c.length; i += 3) {
          v.set(c[i], c[i + 1], c[i + 2]).applyMatrix4(root.matrixWorld);
          this.cornersWorld[k++] = v.x;
          this.cornersWorld[k++] = v.y;
          this.cornersWorld[k++] = v.z;
        }
      }

      // A sample of vertices (world space) used to frame the model tightly.
      const vertexCount = this.meshes.reduce((n, mesh) => n + mesh.geometry.attributes.position.count, 0);
      const stride = Math.max(1, Math.ceil(vertexCount / 60000));
      const samples = [];
      for (const mesh of this.meshes) {
        const pa = mesh.geometry.attributes.position;
        for (let i = 0; i < pa.count; i += stride) {
          v.fromBufferAttribute(pa, i).applyMatrix4(root.matrixWorld);
          samples.push(v.x, v.y, v.z);
        }
      }
      this.samples = new Float32Array(samples);

      this.worldBox = box.clone().applyMatrix4(root.matrixWorld);
      this.center = this.worldBox.getCenter(new THREE.Vector3());
      this.radius = this.worldBox.getSize(new THREE.Vector3()).length() / 2 || 1;
      this.controls.minDistance = this.radius * 0.002;
      this.controls.maxDistance = this.radius * 40;
    }

    _viewDir(view) {
      let d = Array.isArray(view) ? view : VIEWS[view];
      if (!d && typeof view === 'string') {
        const parts = view.split(/[\s,]+/).map(Number);
        if (parts.length === 3 && parts.every(isFinite)) d = parts;
      }
      if (!d) d = VIEWS.iso;
      let v = new THREE.Vector3(d[0], d[1], d[2]);
      // Presets are written Z-up; turn them for Y-up models. Custom vectors are used as given.
      if (this.o.up === 'y' && !Array.isArray(view) && VIEWS[view]) v = new THREE.Vector3(d[0], d[2], -d[1]);
      if (v.lengthSq() === 0) v.set(1, -1, 1);
      v.normalize();
      // Looking straight along the up axis is ambiguous; tilt a hair so "front" ends up at the bottom.
      if (Math.abs(v.dot(this.upVec)) > 0.9999) {
        const front = this.o.up === 'y' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
        v.addScaledVector(front, 2e-3).normalize();
      }
      return v;
    }

    // Camera pose that frames the model when looking from direction `dir`.
    _fitPose(dir, zoom) {
      const cam = this.camera;
      const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), this.upVec);
      const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
      const pts = this.samples;
      const c = new THREE.Vector3();
      // Centre on the middle of the model as seen from this direction.
      let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        c.set(pts[i], pts[i + 1], pts[i + 2]).sub(this.center);
        const r = c.dot(right), u = c.dot(up);
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
      }
      const target = this.center.clone().addScaledVector(right, (r0 + r1) / 2).addScaledVector(up, (u0 + u1) / 2);
      // Smallest distance at which every point is inside the view, with a margin.
      const tanV = Math.tan((cam.fov * DEG) / 2) / 1.1;
      const tanH = tanV * cam.aspect;
      let dist = 0;
      for (let i = 0; i < pts.length; i += 3) {
        c.set(pts[i], pts[i + 1], pts[i + 2]).sub(target);
        dist = Math.max(dist, c.dot(dir) + Math.max(Math.abs(c.dot(right)) / tanH, Math.abs(c.dot(up)) / tanV));
      }
      return { target, position: target.clone().addScaledVector(dir, (dist || this.radius) / zoom) };
    }

    _resize() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.requestRender();
    }

    _frame(now) {
      this._raf = 0;
      const active = this.controls.update(now);
      if (this._hoverAt && this.measureMode) {
        this.hover = this._pick(this._hoverAt.x, this._hoverAt.y);
        this._hoverAt = null;
      }
      if (this.markers.length && (!active || now - (this._occlusionAt || 0) > 150)) {
        this._occlusionAt = now;
        this._checkOcclusion();
      }
      this._render();
      if (active) this.requestRender();
      else this.controls.lastTime = 0;
    }

    _render() {
      const cam = this.camera;
      // Tight clipping planes keep depth precision high at every zoom level.
      const d = cam.position.distanceTo(this.center);
      cam.near = Math.max(d - this.radius, this.radius * 0.0005) * 0.9;
      cam.far = (d + this.radius) * 1.1;
      cam.updateProjectionMatrix();
      this.renderer.render(this.scene, cam);
      this._drawOverlay();
    }

    // --- orientation controls ------------------------------------------------

    // A view cube: faces, edges and corners are clickable views, dragging the cube turns the model
    // freely, and dragging the compass ring spins it about the up axis. Built from CSS 3D transforms.
    _buildGizmo() {
      const g = (this.gizmo = el('div', 'sv-gizmo'));
      g.hidden = true; // shown once the model is in (see _afterLoad)
      const stage = el('div', 'sv-cube-stage');
      stage.setAttribute('role', 'group');
      stage.setAttribute('aria-label', 'View cube. Click a face, edge or corner to look from there; drag to turn the model.');
      const cube = el('div', 'sv-cube');
      stage.appendChild(cube);

      this.compass = el('div', 'sv-compass');
      this.compass.title = 'Drag to spin the model';
      for (const [letter, angle] of [['N', 90], ['E', 0], ['S', 270], ['W', 180]]) {
        const b = el('b');
        b.textContent = letter;
        const r = 57; // middle of the ring band
        b.style.transform = 'translate(' + (Math.cos(angle * DEG) * r).toFixed(1) + 'px,' + (-Math.sin(angle * DEG) * r).toFixed(1) + 'px)';
        this.compass.appendChild(b);
      }
      cube.appendChild(this.compass);

      // Faces as [view name, face normal, text right, text up], written for a Z-up model.
      const faces = [
        ['top', [0, 0, 1], [1, 0, 0], [0, 1, 0]],
        ['bottom', [0, 0, -1], [1, 0, 0], [0, -1, 0]],
        ['front', [0, -1, 0], [1, 0, 0], [0, 0, 1]],
        ['back', [0, 1, 0], [-1, 0, 0], [0, 0, 1]],
        ['right', [1, 0, 0], [0, 1, 0], [0, 0, 1]],
        ['left', [-1, 0, 0], [0, -1, 0], [0, 0, 1]],
      ];
      const fromZUp = (v) => (this.o.up === 'y' ? [v[0], v[2], -v[1]] : v.slice());
      this.cubeFaces = faces.map(([name, n, u, w]) => {
        const face = el('div', 'sv-face');
        // 3 × 3 hit areas: the middle looks at the face, the sides at an edge, the corners at a corner.
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const cell = el('i');
            const du = col - 1, dv = 1 - row;
            cell.dataset.dir = [0, 1, 2].map((k) => n[k] + du * u[k] + dv * w[k]).join(',');
            face.appendChild(cell);
          }
        }
        const label = el('span');
        label.textContent = VIEW_LABELS[name].toUpperCase();
        face.appendChild(label);
        cube.appendChild(face);
        return { el: face, n: fromZUp(n), u: fromZUp(u), w: fromZUp(w) };
      });
      g.appendChild(stage);

      // Dragging the cube turns the model freely; dragging the ring spins it; a click picks a view.
      let drag = null;
      stage.addEventListener('pointerdown', (e) => {
        if (!this.controls) return;
        stage.setPointerCapture(e.pointerId);
        this.controls.stop();
        this._interact();
        drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, cell: e.target.closest('.sv-face i'), spin: e.target === this.compass };
      });
      stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.spin) this.controls.spin(-dx * this.controls.rotateSpeed * 1.5);
        else this.controls.rotate(dx * 1.4, dy * 1.4, true);
        drag.x = e.clientX;
        drag.y = e.clientY;
      });
      const end = (e) => {
        if (!drag) return;
        const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (moved < 4 && drag.cell && e.type === 'pointerup') {
          const d = fromZUp(drag.cell.dataset.dir.split(',').map(Number));
          this.setView(new THREE.Vector3().fromArray(d).applyQuaternion(this.model.quaternion).toArray());
        }
        drag = null;
      };
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);

      const button = (label, html, style, onClick) => {
        const b = el('button', 'sv-cube-btn', html);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        Object.assign(b.style, style);
        b.addEventListener('click', () => {
          if (!this.controls) return;
          this._interact();
          onClick();
        });
        g.appendChild(b);
      };
      const roll = (sign) => {
        // Start from where a running step will end, so quick clicks add up exactly.
        if (this.controls.anim) this.controls.update(this.controls.anim.t0 + this.controls.anim.ms);
        const pose = this.controls.poseAfterTurn(0, 0, sign * 90 * DEG);
        this.controls.animateTo(pose.target, pose.position, 300, pose.up);
      };
      const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
      button('Reset view', icon('home'), { left: '0', top: '0' }, () => this.resetView());
      button('Roll left 90°', svg('<path d="M5 13a7 7 0 1 0 2.2-6.1"/><path d="M5 4v4.5h4.5"/>'), { right: '26px', top: '0' }, () => roll(1));
      button('Roll right 90°', svg('<path d="M19 13a7 7 0 1 1-2.2-6.1"/><path d="M19 4v4.5h-4.5"/>'), { right: '0', top: '0' }, () => roll(-1));
    }

    _drawGizmo() {
      if (this.gizmo.hidden || !this.model) return;
      // Sit just above the bottom bar, however tall it is.
      this.gizmo.style.bottom = this.el.clientHeight - this.bottom.offsetTop + 2 + 'px';
      // World to screen: the camera's inverse rotation, with y flipped because CSS y points down.
      const toCamera = this.camera.quaternion.clone().invert();
      const model = this.model.quaternion;
      const css = (v) => {
        const c = new THREE.Vector3().fromArray(v).applyQuaternion(model).applyQuaternion(toCamera);
        return [c.x, -c.y, c.z];
      };
      const matrix = (u, w, n, offset) => {
        const U = css(u), W = css(w).map((x) => -x), N = css(n);
        return 'matrix3d(' + [...U, 0, ...W, 0, ...N, 0, N[0] * offset, N[1] * offset, N[2] * offset, 1].map((x) => +x.toFixed(5)).join(',') + ')';
      };
      for (const f of this.cubeFaces) {
        f.el.style.transform = matrix(f.u, f.w, f.n, 31);
        // Faces turned towards the viewer are a little brighter.
        const facing = Math.max(0, css(f.n)[2]);
        f.el.style.filter = 'brightness(' + (0.86 + 0.14 * facing).toFixed(3) + ')';
      }
      const up = this.o.up === 'y' ? [0, 1, 0] : [0, 0, 1];
      const east = [1, 0, 0];
      const north = this.o.up === 'y' ? [0, 0, -1] : [0, 1, 0];
      this.compass.style.transform = matrix(east, north, up, -38);
    }

    // --- markers -------------------------------------------------------------

    _toggleMarkers() {
      const off = !this.el.classList.contains('sv-markers-off');
      if (off) this.closeMarker();
      this.el.classList.toggle('sv-markers-off', off);
      this.btn.markers.setAttribute('aria-pressed', String(!off));
      this._syncNav();
    }

    _setAddMode(on) {
      if (!this.btn.addMarker || on === this.addMode) return;
      this.addMode = on;
      if (on) {
        this.setMeasureMode(false);
        this.closeMarker();
        this.el.classList.remove('sv-markers-off');
      }
      this.el.classList.toggle('sv-measuring', on || this.measureMode);
      this.btn.addMarker.setAttribute('aria-pressed', String(on));
      this._syncEditor();
      this._hint(on ? 'Click the model to place a marker · Esc to stop' : '');
    }

    _addMarker(worldPoint) {
      const list = this.getMarkers();
      list.push({
        title: 'Marker ' + (list.length + 1),
        description: '',
        position: this.model.worldToLocal(worldPoint.clone()).toArray(),
        camera: this._currentCamera(),
      });
      this.setMarkers(list);
      this._setAddMode(false);
      this.openMarker(list.length - 1);
    }

    _currentCamera() {
      const up = this.camera.up.clone().applyQuaternion(this.model.quaternion.clone().invert()).normalize();
      return {
        position: this.model.worldToLocal(this.camera.position.clone()).toArray(),
        target: this.model.worldToLocal(this.controls.target.clone()).toArray(),
        up: up.toArray().map((v) => Math.round(v * 1000) / 1000),
      };
    }

    _markersChanged() {
      this._syncEditor();
      this.el.dispatchEvent(new CustomEvent('stepviewer:markerschange', { detail: { markers: this.getMarkers() } }));
    }

    _syncEditor() {
      if (!this.o.editor) return;
      this.editor.hidden = !this.addMode && this.activeMarker == null;
      this.editor.querySelector('textarea').value = JSON.stringify(this.getMarkers(), null, 2);
    }

    _syncNav() {
      const n = this.markers.length;
      this.nav.hidden = !n || this.el.classList.contains('sv-markers-off');
      if (!n) return;
      const i = this.activeMarker;
      this.navTitle.innerHTML = '';
      if (i == null) {
        this.navTitle.textContent = n + (n === 1 ? ' marker' : ' markers');
      } else {
        const num = el('span');
        num.textContent = i + 1 + ' / ' + n;
        this.navTitle.append(num, document.createTextNode(this.markers[i].data.title || ''));
      }
      this.navTitle.setAttribute('aria-label', i == null ? 'Open first marker' : 'Close marker');
    }

    _showCard(mk, index) {
      if (this.card) this.card.remove();
      if (this.leader) this.leader.remove();
      const d = mk.data;
      const card = (this.card = el('div', 'sv-card'));
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', d.title || 'Marker ' + (index + 1));
      const body = el('div', 'sv-card-body');
      const close = el('button', 'sv-card-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => this.closeMarker());
      body.appendChild(close);
      if (d.image) {
        const img = el('img', 'sv-card-img');
        img.src = d.image;
        img.alt = '';
        body.appendChild(img);
      }
      const head = el('div', 'sv-card-head sv-reveal');
      const num = el('span', 'sv-card-num');
      num.textContent = index + 1;
      num.dataset.ref = String(index + 1).padStart(2, '0');
      const title = el('h3');
      title.textContent = d.title || '';
      head.append(num, title);
      // Reference and coordinates; only some themes show this line.
      const meta = el('div', 'sv-card-meta sv-reveal');
      meta.style.setProperty('--d', 0.5);
      const f = (v) => this._fmt(v);
      meta.textContent = 'MKR-' + num.dataset.ref + ' · X ' + f(mk.pos.x) + ' Y ' + f(mk.pos.y) + ' Z ' + f(mk.pos.z) + ' ' + this.o.units;
      const text = el('div', 'sv-card-text sv-reveal');
      text.style.setProperty('--d', 1);
      // Descriptions are written by the site owner, so simple HTML (links, images, lists) is allowed.
      text.innerHTML = d.description || '';
      body.append(head, meta, text);

      if (this.o.editor) {
        title.contentEditable = 'true';
        title.dataset.placeholder = 'Title';
        text.contentEditable = 'true';
        text.dataset.placeholder = 'Description (HTML allowed)';
        title.addEventListener('input', () => {
          d.title = title.textContent;
          mk.el.setAttribute('aria-label', 'Marker ' + (index + 1) + ': ' + d.title);
          this._syncNav();
          this._markersChanged();
        });
        text.addEventListener('input', () => {
          d.description = text.innerHTML;
          this._markersChanged();
        });
        const foot = el('div', 'sv-card-foot sv-reveal');
        foot.style.setProperty('--d', 2);
        const saveView = el('button', null, 'Use current view');
        saveView.type = 'button';
        saveView.addEventListener('click', () => {
          d.camera = this._currentCamera();
          this._markersChanged();
          saveView.textContent = 'View saved';
        });
        const remove = el('button', null, 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', () => this.setMarkers(this.getMarkers().filter((_, i) => i !== index)));
        foot.append(saveView, remove);
        body.appendChild(foot);
      } else if (this.markers.length > 1) {
        const foot = el('div', 'sv-card-foot sv-reveal');
        foot.style.setProperty('--d', 2);
        const prev = el('button', null, '‹ Previous');
        const next = el('button', null, 'Next ›');
        const count = el('span');
        count.textContent = index + 1 + ' of ' + this.markers.length;
        prev.type = next.type = 'button';
        prev.addEventListener('click', () => this.nextMarker(-1));
        next.addEventListener('click', () => this.nextMarker(1));
        foot.append(prev, count, next);
        body.appendChild(foot);
      }
      card.appendChild(body);
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      card.addEventListener('wheel', (e) => e.stopPropagation());
      this.markerLayer.appendChild(card);

      const leader = (this.leader = svgEl('g'));
      leader.setAttribute('class', 'sv-leader-group');
      const path = svgEl('path');
      path.setAttribute('class', 'sv-leader');
      path.setAttribute('pathLength', '1');
      const end = svgEl('circle');
      end.setAttribute('class', 'sv-leader-end');
      end.setAttribute('r', '3.5');
      leader.append(path, end);
      this.svg.appendChild(leader);
      this._cardSide = null;
      this.requestRender();
    }

    _hideCard() {
      const card = this.card, leader = this.leader;
      this.card = this.leader = null;
      if (leader) leader.remove();
      if (!card) return;
      card.classList.add('sv-out');
      card.style.pointerEvents = 'none';
      setTimeout(() => card.remove(), 230);
    }

    // Keeps the open card next to its marker as the camera moves. Narrow viewers get a bottom sheet.
    _placeCard(w, h, toScreen) {
      const card = this.card;
      if (!card || this.activeMarker == null) return;
      const mk = this.markers[this.activeMarker];
      const p = toScreen(mk.pos);
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const path = this.leader.firstChild, end = this.leader.lastChild;
      // Stay above the bottom bar (info, marker navigation, hints).
      const bottomLimit = this.bottom.offsetTop + (this.nav.hidden ? this.bottom.offsetHeight : 0) - 8;
      if (w < 520) {
        card.classList.add('sv-sheet');
        card.style.left = (w - cw) / 2 + 'px';
        card.style.top = Math.max(10, bottomLimit - ch) + 'px';
        card.style.transformOrigin = '50% 100%';
        this.leader.style.display = 'none';
        return;
      }
      card.classList.remove('sv-sheet');
      if (!p) {
        this.leader.style.display = 'none';
        return;
      }
      const gap = 34;
      // Pick a side once per opening so the card doesn't jump while orbiting.
      if (!this._cardSide) this._cardSide = p.x + gap + cw < w - 10 || p.x < w / 2 ? 'right' : 'left';
      let x = this._cardSide === 'right' ? p.x + gap : p.x - gap - cw;
      x = Math.min(Math.max(x, 10), w - cw - 10);
      const y = Math.min(Math.max(p.y - 28, 10), Math.max(10, bottomLimit - ch));
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      card.style.transformOrigin = (p.x - x) + 'px ' + (p.y - y) + 'px';
      const edgeX = this._cardSide === 'right' ? x : x + cw;
      const edgeY = Math.min(Math.max(p.y, y + 18), y + ch - 18);
      const overlaps = p.x > x - 4 && p.x < x + cw + 4 && p.y > y - 4 && p.y < y + ch + 4;
      this.leader.style.display = overlaps ? 'none' : '';
      const midX = (p.x + edgeX) / 2;
      path.setAttribute('d', 'M' + p.x + ' ' + p.y + 'C' + midX + ' ' + p.y + ' ' + midX + ' ' + edgeY + ' ' + edgeX + ' ' + edgeY);
      end.setAttribute('cx', edgeX);
      end.setAttribute('cy', edgeY);
    }

    // Markers behind the model are dimmed.
    _checkOcclusion() {
      const rc = this._occlusionRay || (this._occlusionRay = new THREE.Raycaster());
      const from = this.camera.position;
      const p = new THREE.Vector3(), dir = new THREE.Vector3();
      for (const mk of this.markers) {
        p.copy(mk.pos).applyMatrix4(this.model.matrixWorld);
        dir.copy(p).sub(from);
        const dist = dir.length();
        rc.set(from, dir.normalize());
        rc.far = dist - this.radius * 0.004;
        const occluded = rc.far > 0 && rc.intersectObjects(this.meshes, false).length > 0;
        if (occluded !== mk.occluded) {
          mk.occluded = occluded;
          mk.el.classList.toggle('sv-occluded', occluded);
        }
      }
    }

    // --- picking & measuring -------------------------------------------------

    _rayAt(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      this.camera.updateMatrixWorld();
      this.raycaster.setFromCamera(ndc, this.camera);
      return this.raycaster.ray;
    }

    _surfaceAt(clientX, clientY) {
      this._rayAt(clientX, clientY);
      return this.raycaster.intersectObjects(this.meshes, false)[0] || null;
    }

    // Point under the cursor, snapped to a nearby corner or edge when there is one.
    _pick(clientX, clientY) {
      const cam = this.camera;
      const r = this.canvas.getBoundingClientRect();
      const sx = clientX - r.left, sy = clientY - r.top;
      const surf = this._surfaceAt(clientX, clientY);
      const ray = this.raycaster.ray;
      const depth = surf ? surf.distance : cam.position.distanceTo(this.controls.target);
      const perPixel = (2 * depth * Math.tan((cam.fov * DEG) / 2)) / r.height;
      const limit = surf ? surf.distance + Math.max(perPixel * 16, this.radius * 1e-4) : Infinity;
      const p = new THREE.Vector3(), s = new THREE.Vector3();
      const screenDist = (point) => {
        s.copy(point).project(cam);
        if (s.z < -1 || s.z > 1) return Infinity;
        return Math.hypot(((s.x + 1) / 2) * r.width - sx, ((1 - s.y) / 2) * r.height - sy);
      };

      let best = null, bestD = CORNER_SNAP_PX;
      const cw = this.cornersWorld;
      for (let i = 0; i < cw.length; i += 3) {
        p.set(cw[i], cw[i + 1], cw[i + 2]);
        const dpx = screenDist(p);
        if (dpx < bestD && s.copy(p).sub(ray.origin).dot(ray.direction) <= limit) {
          bestD = dpx;
          best = p.clone();
        }
      }
      if (best) return { point: best, type: 'corner' };

      if (this.edgeLines.length) {
        this.raycaster.params.Line.threshold = perPixel * EDGE_SNAP_PX;
        bestD = EDGE_SNAP_PX;
        for (const h of this.raycaster.intersectObjects(this.edgeLines, false)) {
          if (h.distance > limit) continue;
          const dpx = screenDist(h.point);
          if (dpx < bestD) {
            bestD = dpx;
            best = h.point;
          }
        }
        if (best) return { point: best, type: 'edge' };
      }
      return surf ? { point: surf.point, type: 'surface' } : null;
    }

    _bindPointer() {
      const c = this.canvas;
      let down = null;
      const onDown = (e) => {
        down = this.controls.pointers.size > 1 ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
        if (!this.menu.hidden) this._toggleMenu(false);
      };
      const onUp = (e) => {
        if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_PX) {
          if (this.measureMode) {
            this.controls.stop();
            const hit = this._pick(e.clientX, e.clientY);
            if (hit) this._addPoint(hit);
          } else if (this.addMode) {
            this.controls.stop();
            const hit = this._surfaceAt(e.clientX, e.clientY);
            if (hit) this._addMarker(hit.point);
          } else if (this.activeMarker != null) {
            this.closeMarker();
          }
        }
        down = null;
      };
      const onMove = (e) => {
        if (!this.measureMode || this.controls.pointers.size || e.pointerType === 'touch') return;
        this._hoverAt = { x: e.clientX, y: e.clientY };
        this.requestRender();
      };
      const onLeave = () => {
        this._hoverAt = null;
        if (this.hover) {
          this.hover = null;
          this.requestRender();
        }
      };
      // Double-click makes the clicked point the new centre of rotation.
      const onDbl = (e) => {
        if (this.measureMode || this.addMode) return;
        const hit = this._surfaceAt(e.clientX, e.clientY);
        if (!hit) return;
        const shift = hit.point.clone().sub(this.controls.target);
        this.controls.animateTo(hit.point, this.camera.position.clone().add(shift), 350, this.camera.up.clone());
      };
      c.addEventListener('pointerdown', onDown);
      c.addEventListener('pointerup', onUp);
      c.addEventListener('pointermove', onMove);
      c.addEventListener('pointerleave', onLeave);
      c.addEventListener('dblclick', onDbl);
      this._cleanup.push(() => {
        c.removeEventListener('pointerdown', onDown);
        c.removeEventListener('pointerup', onUp);
        c.removeEventListener('pointermove', onMove);
        c.removeEventListener('pointerleave', onLeave);
        c.removeEventListener('dblclick', onDbl);
      });
    }

    _addPoint(hit) {
      const local = this.model.worldToLocal(hit.point.clone());
      if (!this.pending) {
        this.pending = { a: local, dotA: el('div', 'sv-dot'), live: this._makeLine(true), label: el('div', 'sv-label sv-live') };
        this.layer.append(this.pending.dotA, this.pending.label);
        this._hint('Click a second point · Esc to cancel');
        this._syncClearButton();
      } else {
        const p = this.pending;
        p.live.remove();
        p.label.remove();
        const m = { a: p.a, b: local, dotA: p.dotA, dotB: el('div', 'sv-dot'), line: this._makeLine(false), label: el('div', 'sv-label') };
        this.pending = null;
        const info = this._measurementInfo(m);
        const text = el('span');
        text.textContent = this._fmt(info.distance) + ' ' + this.o.units;
        const del = el('button', null, '×');
        del.type = 'button';
        del.title = 'Remove this measurement';
        del.setAttribute('aria-label', 'Remove measurement');
        del.addEventListener('click', () => this._removeMeasurement(m));
        m.label.title = this._deltaText(info);
        m.label.append(text, del);
        this.layer.append(m.dotB, m.label);
        this.measurements.push(m);
        this._hint(text.textContent + ' · ' + this._deltaText(info));
        this._syncClearButton();
        this.el.dispatchEvent(new CustomEvent('stepviewer:measure', { detail: info }));
      }
      this.requestRender();
    }

    _measurementInfo(m) {
      const d = m.b.clone().sub(m.a);
      return {
        distance: d.length(),
        delta: [d.x, d.y, d.z],
        a: m.a.toArray(),
        b: m.b.toArray(),
        units: this.o.units,
      };
    }

    _fmt(v) {
      return v.toFixed(this.o.precision);
    }

    _deltaText(info) {
      return ['x', 'y', 'z'].map((axis, i) => 'Δ' + axis + ' ' + this._fmt(Math.abs(info.delta[i]))).join('  ');
    }

    _makeLine(rubber) {
      const g = svgEl('g');
      const halo = svgEl('line');
      halo.setAttribute('class', 'sv-halo' + (rubber ? ' sv-rubber' : ''));
      const line = svgEl('line');
      line.setAttribute('class', 'sv-line' + (rubber ? ' sv-rubber' : ''));
      g.append(halo, line);
      this.svg.appendChild(g);
      return g;
    }

    _removeMeasurementDom(m) {
      m.dotA.remove();
      m.dotB.remove();
      m.line.remove();
      m.label.remove();
    }

    _removeMeasurement(m) {
      this._removeMeasurementDom(m);
      this.measurements = this.measurements.filter((x) => x !== m);
      this._syncClearButton();
      this.requestRender();
    }

    _cancelPending(keepMode) {
      const p = this.pending;
      if (!p) return;
      p.dotA.remove();
      p.live.remove();
      p.label.remove();
      this.pending = null;
      this._syncClearButton();
      if (keepMode && this.measureMode) this._hint('Click a point on the model to start measuring');
      this.requestRender();
    }

    _drawOverlay() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      const v = new THREE.Vector3();
      const toScreen = (localPoint) => {
        v.copy(localPoint).applyMatrix4(this.model.matrixWorld).project(this.camera);
        return v.z < -1 || v.z > 1 ? null : { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      };
      const place = (node, p) => {
        node.style.display = p ? '' : 'none';
        if (p) {
          node.style.left = p.x + 'px';
          node.style.top = p.y + 'px';
        }
      };
      const setLine = (g, a, b) => {
        g.style.display = a && b ? '' : 'none';
        if (!a || !b) return;
        for (const line of g.childNodes) {
          line.setAttribute('x1', a.x);
          line.setAttribute('y1', a.y);
          line.setAttribute('x2', b.x);
          line.setAttribute('y2', b.y);
        }
      };
      const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);

      for (const m of this.measurements) {
        const a = toScreen(m.a), b = toScreen(m.b);
        place(m.dotA, a);
        place(m.dotB, b);
        setLine(m.line, a, b);
        place(m.label, mid(a, b));
      }

      const hoverLocal = this.hover ? this.model.worldToLocal(this.hover.point.clone()) : null;
      if (this.pending) {
        const p = this.pending;
        const a = toScreen(p.a);
        const b = hoverLocal ? toScreen(hoverLocal) : null;
        place(p.dotA, a);
        setLine(p.live, a, b);
        place(p.label, mid(a, b));
        if (hoverLocal) p.label.textContent = this._fmt(hoverLocal.distanceTo(p.a)) + ' ' + this.o.units;
      }

      for (const mk of this.markers) place(mk.el, toScreen(mk.pos));
      this._drawGizmo();
      this._placeCard(w, h, toScreen);

      if (!this.hoverDot) {
        this.hoverDot = el('div', 'sv-dot sv-hover');
        this.layer.appendChild(this.hoverDot);
      }
      if (this.hover && this.measureMode) {
        this.hoverDot.className = 'sv-dot sv-hover sv-snap-' + this.hover.type;
        this.hoverDot.title = 'Snaps to ' + this.hover.type;
        place(this.hoverDot, toScreen(hoverLocal));
      } else {
        this.hoverDot.style.display = 'none';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const instances = new Map();

  const StepViewer = {
    version: '1.0.0',
    config,
    defaults: DEFAULTS,

    /** Create a viewer in `element` (a node or selector). Options override data-* attributes. */
    create(element, options) {
      const node = typeof element === 'string' ? document.querySelector(element) : element;
      if (!node) throw new Error('step-viewer: element not found');
      if (instances.has(node)) return instances.get(node);
      const viewer = new Viewer(node, options);
      instances.set(node, viewer);
      return viewer;
    },

    /** Create viewers for every matching element inside `root` (default: the whole page). */
    init(root) {
      return Array.from((root || document).querySelectorAll(config.selector)).map((node) => StepViewer.create(node));
    },

    /** The viewer living in `element`, if any. */
    get(element) {
      return instances.get(element) || null;
    },
  };

  global.StepViewer = StepViewer;

  if (config.autoInit) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => StepViewer.init());
    else StepViewer.init();
  }
})(window);
