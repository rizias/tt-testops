export const LAYOUT = `
.toolbar{
  position:sticky; top:0; z-index:100; height:var(--toolbar-h);
  display:flex; align-items:center; gap:8px; margin:0 0 14px;
  background:var(--bg); border-bottom:1px solid var(--rule);
}
.toolbarScope{margin-left:auto; font-weight:600; font-size:12px; line-height:1; color:var(--muted)}
.toolbar .ctl{margin:0 8px 0 0; font-size:13px; padding:5px 12px}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:4px}

img{max-width:100%; height:auto; border-radius:6px; margin:.4em 0; border:1px solid var(--rule)}
img[data-missing-attachment]{display:inline-block; min-width:180px; min-height:24px; background:var(--chip)}
table{border-collapse:collapse; margin:.6em 0; font-size:14px}
td,th{border:1px solid var(--rule); padding:6px 10px; text-align:left}
th{background:var(--chip)}
ul{margin:.4em 0; padding-left:1.3em}

.comments{margin:26px 0 0}
.comments h3{
  font-weight:600; font-size:10.5px; line-height:1.2; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
  margin:0 0 8px; opacity:.8; display:flex; align-items:center; gap:10px; white-space:nowrap;
}
.comments h3::after{content:""; flex:1 1 auto; height:1px; background:var(--rule-soft)}
.comments ul{padding:0; margin:0; list-style:none}
.comments li{border-left:2px solid var(--rule); padding:2px 0 2px 12px; margin:10px 0}
.comments .who{font-size:12px; color:var(--muted); margin-bottom:2px}
.summary{color:var(--muted); font-size:13.5px; margin:0 0 16px}
.toc{
  position:fixed; z-index:200; top:calc(var(--toolbar-h) + 8px); bottom:16px; left:16px;
  width:min(380px, calc(100vw - 32px)); overflow:auto; padding:12px;
  background:var(--surface); border:1px solid var(--rule); border-radius:10px;
  box-shadow:0 12px 36px rgba(0,0,0,.22);
}

body.split{max-width:none; padding:0}
body.split .toolbar{margin:0; padding:0 16px}
body.split .ctl_toc{display:none}
body.split .summary{display:none}
body.split #tree{
  position:fixed; top:var(--toolbar-h); left:0; bottom:0; width:var(--split-w);
  overflow:auto; overscroll-behavior:contain; padding:0 12px 32px;
  background:var(--bg);
}
body.split #gutter{
  display:block; position:fixed; top:var(--toolbar-h); bottom:0;
  left:var(--split-w); width:6px; margin-left:-3px; z-index:70;
  cursor:col-resize; background:transparent; touch-action:none;
}
body.split #gutter::before{
  content:""; position:absolute; top:0; bottom:0; left:2px; width:1px; background:var(--rule);
}
body.split #gutter:hover::before,body.resizing #gutter::before{background:var(--accent); width:2px}
#gutter{display:none}
body.resizing{user-select:none}
body.split #pane{
  display:block; position:fixed; top:var(--toolbar-h); left:var(--split-w); right:0; bottom:0;
  overflow:auto; overscroll-behavior:contain; padding:24px 28px 56px;
}
body.split details.case>summary{position:static}
body.split details.case>.caseInner{display:none}
body.split details.group>summary{top:calc(var(--sticky-top) - var(--toolbar-h))}
body.split #tree>details.group:first-of-type{margin-top:0}
.treeFilter{
  position:sticky; top:0; z-index:80; width:100%; height:30px; margin:0 0 6px;
  padding:0 10px; font:inherit; font-size:13px; color:var(--ink);
  background:var(--surface); border:1px solid var(--rule); border-radius:7px;
}
#tree:not(:hover) .treeFilter:placeholder-shown{opacity:.75}
body.split details.case{content-visibility:visible; contain-intrinsic-size:auto}
body.split details.case.case_current{
  border-color:var(--accent); box-shadow:0 0 0 1px var(--accent);
  background:color-mix(in srgb,var(--accent) 5%,var(--surface));
}
#pane{display:none}
body.split details.case{margin:6px 0 6px 12px; padding:0 10px 0 12px}
body.split details.case>summary{
  display:block; padding:8px 0; font-size:14px; line-height:1.5; font-weight:600;
}
body.split details.case>summary .type{margin-right:5px; vertical-align:-2px}
body.split details.case>summary .id{margin-right:6px}
body.split details.case>summary .caseName{white-space:normal; overflow-wrap:anywhere}
body.split details.case>summary .tag{float:right; margin:0 0 4px 8px}
body.split details.case>summary .ctl_copy{float:right; margin:0 0 4px 6px}
body.split details.group>summary{position:sticky}
body.split .sectionCtl{
  position:absolute; right:6px; top:0; height:100%; align-items:center;
  margin:0; padding-left:10px; opacity:0; pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--bg) 12px);
}
body.split details.group>summary:hover .sectionCtl,
body.split details.group>summary:focus-within .sectionCtl{opacity:1; pointer-events:auto}
.paneHead{
  display:flex; align-items:center; flex-wrap:wrap;
  margin:0 0 18px; padding:0 0 12px; border-bottom:1px solid var(--rule);
  font-weight:650; font-size:15px; line-height:1.5;
}
.paneHead .type{margin-right:7px}
.paneHead .id{margin-right:8px}
.paneHead .caseName{margin-right:8px}
.paneHead .tag{margin-left:0}
.paneZero{max-width:560px}
.paneZero h2{margin:0 0 14px; font-size:15px; font-weight:650; line-height:1.4}
.paneZero dl{
  display:grid; grid-template-columns:max-content minmax(0,1fr); gap:4px 16px;
  margin:0 0 18px; font-size:13px; line-height:1.55;
}
.paneZero dt{font-weight:550; color:var(--muted); white-space:nowrap}
.paneZero dd{margin:0; overflow-wrap:anywhere}
.paneHint{margin:0; color:var(--muted); font-size:13px}
.tocHead{display:flex; align-items:center; justify-content:space-between; padding:0 0 8px}
.tocSearch{
  width:100%; height:34px; margin-bottom:10px; padding:0 10px;
  font-family:inherit; font-weight:inherit; font-size:13px; line-height:inherit;
  color:var(--ink); background:var(--bg); border:1px solid var(--rule); border-radius:7px;
}
.tocTree ul{list-style:none; margin:0; padding-left:14px; border-left:1px solid var(--rule-soft)}
.tocTree>ul{padding-left:0; border-left:0}
.tocRow{
  display:flex; align-items:baseline; gap:8px; padding:4px 6px; font-size:13px; line-height:1.4;
  border-radius:6px; cursor:pointer;
}
.tocRow:hover{background:var(--rule-soft)}
.tocRow a{min-width:0; color:var(--ink); text-decoration:none; overflow-wrap:anywhere}
.tocRow:hover a{color:var(--accent)}
.tocRow_here{background:var(--code-bg); box-shadow:inset 2px 0 0 var(--accent)}
.tocRow_here a{color:var(--accent); font-weight:600}
.tocRow .tally{flex:none}
.toTop{
  position:fixed; z-index:150; right:20px; bottom:20px; width:44px; height:44px;
  color:var(--ink); background:var(--surface); border:1px solid var(--rule); border-radius:50%;
  box-shadow:0 4px 18px rgba(0,0,0,.18); cursor:pointer; font-size:19px;
}
@media (max-width:620px){.toTop{right:12px; bottom:12px} .toolbarScope{display:none}}
.blockBody img{cursor:zoom-in}
.viewer{
  display:none; position:fixed; inset:0; z-index:1000; background:rgba(10,12,16,.88);
  align-items:center; justify-content:center; padding:32px; cursor:zoom-out;
  overscroll-behavior:contain;
}
body.locked{overflow:hidden}
body.locked #tree,body.locked #pane{overflow:hidden}
.viewer_on{display:flex}
.viewer img{max-width:100%; max-height:100%; width:auto; height:auto; border:0; border-radius:6px; background:#fff; cursor:zoom-in}
.viewer_zoom{overflow:auto; cursor:zoom-out}
.viewer_zoom img{max-width:none; max-height:none; margin:auto; cursor:zoom-out}
.viewerClose{
  position:fixed; z-index:1; top:14px; right:18px; font-weight:400; font-size:26px; line-height:1; color:#fff;
  background:none; border:0; cursor:pointer; padding:6px 10px;
}
@media (max-width:620px){
  body{padding:20px 16px 48px}
  .facts{grid-template-columns:1fr; gap:0 0; padding:12px 14px}
  .facts dt{margin-top:10px}
}
`;
