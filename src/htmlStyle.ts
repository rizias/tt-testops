import { LAYOUT } from './htmlLayoutStyle.js';

export const STYLE = `
:root{
  --bg:#FBFBFC; --surface:#FFFFFF; --ink:#14171C; --muted:#616875;
  --rule:#E3E6EC; --rule-soft:#EFF1F5;
  --accent:#1B4DD1; --code-ink:#0B5F73; --code-bg:#EAF1F3; --code-line:#C7DDE3;
  --warn-bg:#FFF6DA; --warn-ink:#6B4E00; --warn-line:#EBD79B;
  --done-bg:#D3F1A7; --done-ink:#4C6B1F;
  --chip:#F1F3F7; --chip-ink:#4A5160;
  --block-rule:#D5DAE3; --label:#596170;
  --toolbar-h:44px; --section-h:30px; --toc-w:340px; --split-w:50%;
  --mono:ui-monospace,SFMono-Regular,"Cascadia Mono","JetBrains Mono",Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0F1115; --surface:#14171C; --ink:#E8EAEE; --muted:#98A0AE;
  --rule:#262B33; --rule-soft:#1D222A;
  --accent:#8FB2FF; --code-ink:#7FD3E6; --code-bg:#182027; --code-line:#26343D;
  --warn-bg:#3A2F10; --warn-ink:#F3DA9B; --warn-line:#5A4818;
  --done-bg:#28311B; --done-ink:#B3DF72;
  --chip:#1C212A; --chip-ink:#A9B2C2;
  --block-rule:#39414D; --label:#A7B0BF;
}}

*{box-sizing:border-box}
body{
  font:14px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:var(--ink); background:var(--bg);
  margin:0 auto; padding:32px 24px 64px; max-width:1200px;
  -webkit-text-size-adjust:100%;
}
button{font-family:inherit}

h1{font-size:18px; line-height:1.35; font-weight:650; margin:0 0 16px}
h1 .id{margin:0 8px 0 0}
h1 .type{margin-right:7px}
.id{
  font:650 12.5px/1 var(--mono); letter-spacing:.01em;
  color:var(--accent); text-decoration:none;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  padding-bottom:1px; flex:none;
}
.id:hover{border-bottom-color:var(--accent)}

.facts{
  display:grid; grid-template-columns:max-content minmax(0,1fr);
  gap:0 14px; margin:0 0 18px; padding:0; font-size:13px; line-height:1.55;
}
.facts dt{font-weight:550; font-size:inherit; line-height:inherit; color:var(--muted); white-space:nowrap}
.facts dd{margin:0; font-size:inherit; line-height:inherit; min-width:0; overflow-wrap:anywhere}
.crumb{color:var(--ink)}
.rel{display:inline-flex; align-items:center; gap:5px; margin:0 10px 2px 0}
.rel.rel_case{display:block; margin:0 0 2px}
.rel.rel_case .pill{display:inline-block; white-space:nowrap; margin-right:6px; vertical-align:baseline}
.pill{
  font-weight:500; font-size:10.5px; line-height:1.6; text-transform:uppercase; letter-spacing:.05em;
  background:var(--chip); color:var(--chip-ink); border-radius:4px; padding:0 5px;
}
.pill_done{background:var(--done-bg); color:var(--done-ink)}
.facts .pill,.facts .tag,.facts .sep{font-size:inherit}
.facts .sep{color:var(--muted); margin:0 6px}

.type{display:inline-block; vertical-align:-2px; line-height:0}
.ico{width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.35;
  stroke-linecap:round; stroke-linejoin:round}
.ico .dot{fill:currentColor; stroke:none}
.type_auto{color:var(--code-ink)}
.type_manual{color:var(--muted)}

.tag{
  display:inline-block; font-weight:500; font-size:12px; line-height:1.7; padding:0 9px; margin:0 6px 4px 0;
  background:var(--chip); color:var(--chip-ink); border-radius:999px;
}
.tag.warn{background:var(--warn-bg); color:var(--warn-ink)}
.tag_retired{background:var(--warn-bg); color:var(--warn-ink); font-weight:600}

.mark{
  background:var(--warn-bg); color:var(--warn-ink); border:1px solid var(--warn-line);
  border-radius:8px; padding:8px 12px; margin:0 0 16px; font-size:13.5px;
}

.block{margin:24px 0 0}
.block h3{
  font-weight:600; font-size:10.5px; line-height:1.2; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
  margin:0 0 8px; opacity:.8; display:flex; align-items:center; gap:10px; white-space:nowrap;
}
.block h3::after{content:""; flex:1 1 auto; height:1px; background:color-mix(in srgb,var(--muted) 18%,transparent)}
.blockBody{font-size:13.5px; line-height:1.6; white-space:pre-wrap}
.comments li.comment,details.case>summary .caseName{white-space:pre-wrap}
.blockBody>p:first-child{margin-top:0}
p{margin:.6em 0}

.block.scenario ol.steps,.block.scenario ol.expList{list-style:none; margin:0; padding:0}
.steps>li,.expList>li{padding:3px 0 3px 34px; margin:0; display:flow-root}
.steps>li::before,.expList>li::before{
  content:attr(data-n); float:left; width:26px; margin:0 8px 0 -34px; text-align:right;
  font:500 13px/21.6px var(--mono); color:var(--muted); font-variant-numeric:tabular-nums;
}
.steps>li>:first-child,.expList>li>:first-child{margin-top:0}
.stepExtra>p{margin:.2em 0}
p.para{margin:0}
.tc-gray{color:#6b7280}.tc-brown{color:#8b5a2b}.tc-orange{color:#c2410c}.tc-yellow{color:#b7791f}
.tc-green{color:#15803d}.tc-blue{color:#1d4ed8}.tc-purple{color:#7e22ce}.tc-pink{color:#be185d}.tc-red{color:#b91c1c}
.steps>li>ol.steps{margin:4px 0 2px; padding-left:10px; border-left:1px solid var(--rule)}
.exp{margin:4px 0 2px; padding-left:10px; border-left:1px solid var(--rule)}
.expLabel{
  font-weight:600; font-size:11px; line-height:1.6; color:var(--muted);
  letter-spacing:.02em; margin:0 0 1px;
}
.expItem{padding:1px 0}
.block.scenario .exp .expList{margin:0}
.steps>li>ol.steps>li{padding-left:32px}
.steps>li>ol.steps>li::before{margin-left:-32px; margin-right:6px}

code{
  font:13px/1.5 var(--mono); color:var(--code-ink);
  background:var(--code-bg); border:1px solid var(--code-line); border-radius:5px;
  padding:1px 6px; overflow-wrap:anywhere;
}
pre{background:var(--code-bg); border:1px solid var(--code-line); padding:12px 14px; border-radius:8px; overflow:auto; margin:.6em 0}
pre code{background:none; border:0; padding:0}
a{color:var(--accent)}
strong{font-weight:650}
u{text-underline-offset:2px}

details.case{
  content-visibility:auto; contain-intrinsic-size:auto 43px;
  border:1px solid var(--rule); border-radius:10px; background:var(--surface);
  margin:12px 0; padding:0 16px; box-shadow:0 1px 0 rgba(20,23,28,.03);
}
details.case[open]{border-color:var(--muted)}
details.case>summary{
  cursor:pointer; padding:10px 0; font-size:15px; line-height:1.4; font-weight:620; list-style:none;
}
details.case[open]>summary{
  position:sticky; top:var(--sticky-top); z-index:var(--sticky-z);
  background:var(--surface); margin:0 -16px; padding:10px 16px;
}
details.case>summary .type{margin-right:7px}
details.case>summary .id{margin-right:8px}
details.case>summary .tag{height:22px; margin:0 0 0 8px; line-height:22px; vertical-align:middle}
details.case>summary .ctl_copy{height:22px; margin-left:10px; padding:0 7px; vertical-align:middle}
details.case>summary .caseName{font-weight:inherit}
details.case>summary::-webkit-details-marker{display:none}
details.case[open]>summary{border-bottom:1px solid var(--rule-soft); margin-bottom:4px}
details.case[open]{padding-bottom:18px}
details.group{border:0; padding:0; background:none; margin:4px 0; content-visibility:auto; contain-intrinsic-size:auto 30px}
details.group>summary{
  cursor:pointer; font-weight:650; font-size:14px; line-height:1; padding:0 8px; border-radius:7px;
  height:var(--section-h); display:flex; align-items:center; gap:8px; list-style:none;
  background:var(--bg); box-shadow:0 1px 0 var(--rule);
  scroll-margin-top:var(--anchor-offset,0);
}
details.group>summary::-webkit-details-marker{display:none}
details.group>summary{position:sticky; top:var(--sticky-top); z-index:var(--sticky-z)}
.groupName{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.twisty{
  width:6px; height:6px; flex:none; border-right:1.5px solid currentColor;
  border-bottom:1.5px solid currentColor; transform:rotate(-45deg); color:var(--muted);
}
details.group[open]>summary .twisty{transform:rotate(45deg)}
.sectionCtl{margin-left:auto; flex:none; display:flex; gap:4px}
.sectionCtl .ctl{white-space:nowrap}
details.group>summary:hover{background:var(--rule-soft)}
details.group>*:not(summary){margin-left:12px; padding-left:12px; border-left:1px solid var(--rule)}
.tally{
  display:inline-flex; align-items:center; gap:3px; flex:none;
  font-weight:600; font-size:11.5px; line-height:1.6; color:var(--muted);
}
.tally .ico{width:13px; height:13px}
.tally.type_auto{color:var(--code-ink)}
.tally.type_manual{color:var(--muted)}
details.group>summary .tally{margin-left:4px}

.ctl{
  font-weight:500; font-size:11.5px; line-height:1.7; cursor:pointer; color:var(--muted);
  border:1px solid var(--rule); background:none; border-radius:7px; padding:1px 9px; margin-left:6px;
}
.ctl:hover{color:var(--ink); border-color:var(--muted)}
.ctl_copy{display:inline-flex; align-items:center; justify-content:center; padding:1px 6px; line-height:1}
.ctl_copy .ico{width:14px; height:14px}
.ctl_done{color:var(--code-ink); border-color:var(--code-line)}
${LAYOUT}`;
