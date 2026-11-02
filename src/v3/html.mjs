// Server-rendered pages for the web app. Every interpolated value goes through esc(); forms that change
// state carry the session's CSRF token. Pages work without JavaScript; one small script (hashed into the
// CSP by web.mjs) marks a pressed button busy during long actions, names chosen files, and reloads pages
// that show live progress unless a menu is open or a field has focus (meta refresh is the no-script fallback).

import crypto from 'node:crypto';
import { esc } from '../report.mjs';
import { TOKENS } from '../theme.mjs';
import { icon } from './icons.mjs';
import { draftCard, reviewedRow } from './drafts-view.mjs';
import { STEPS } from './insights.mjs';
import { PLANS as PLAN_VIEW } from './billing.mjs';
import { AGENT_KINDS } from '../v1/kinds.mjs';

export const BUSY_SCRIPT = "document.addEventListener('submit',function(e){var b=e.submitter;if(!b||!b.dataset.busy)return;setTimeout(function(){b.disabled=true;b.setAttribute('aria-busy','true');b.textContent=b.dataset.busy;},0);});document.addEventListener('change',function(e){var i=e.target;if(i.type!=='file')return;var o=document.querySelector('[data-files-for=\"'+i.id+'\"]');if(o)o.textContent=i.files.length?Array.prototype.map.call(i.files,function(f){return f.name;}).join(', '):'No file chosen';});var r=+document.body.dataset.refresh;if(r)setInterval(function(){var a=document.activeElement;if(document.querySelector('details[open]')||(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))return;location.reload();},r*1000);";
export const BUSY_SCRIPT_HASH = `sha256-${crypto.createHash('sha256').update(BUSY_SCRIPT).digest('base64')}`;

const STYLE = `@font-face{font-family:"Geist";src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
${TOKENS}
.i{flex:none;display:block}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.strong{font-weight:600;color:var(--text)}.nowrap{white-space:nowrap}
.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--rail) 239px,var(--line) 239px 240px,transparent 240px)}
.rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:20px;padding:16px 12px;overflow-y:auto}
.brand{display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:16px;font-weight:600;letter-spacing:-0.035em;color:var(--text)}
.brand:hover{text-decoration:none}
.nav{display:flex;flex-direction:column;gap:1px}
.nav-title{padding:0 10px 6px;font-size:12px;font-weight:500;color:var(--text-3)}
.nav a{display:flex;align-items:center;gap:10px;min-height:32px;padding:6px 10px;line-height:1.35;border-radius:var(--r-sm);color:var(--text-2);font-weight:450}
.nav a:hover{background:var(--hover);color:var(--text);text-decoration:none}
.nav a[aria-current=page]{background:var(--hover);color:var(--text);font-weight:500}
.nav .count{margin-left:auto;min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:var(--line);color:var(--text-2);font-size:11px;font-weight:600;display:grid;place-items:center}
.nav .org-kind{margin-left:auto;font-size:11px;color:var(--text-3)}
.rail-foot{margin-top:auto;border-top:1px solid var(--line);padding:12px 8px 0;display:flex;align-items:center;gap:8px}
.rail-foot .who{min-width:0;flex:1;font-size:13px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-btn{width:30px;height:30px;display:grid;place-items:center;border-radius:var(--r-sm);border:0;background:transparent;color:var(--text-2);cursor:pointer}
.icon-btn:hover{background:var(--hover);color:var(--text)}
.topbar{height:52px;display:flex;align-items:center;gap:8px;padding:0 32px;border-bottom:1px solid var(--line);background:var(--canvas);font-size:13px}
.topbar a{color:var(--text-2)}.topbar a:hover{color:var(--text);text-decoration:none}.topbar .sep{color:var(--line-strong)}.topbar .here{color:var(--text);font-weight:500}
.content{max-width:1120px;margin:0 auto;padding:32px 32px 80px}
.page-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.page-head .title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.page-head .sub{margin-top:6px;color:var(--text-2)}
.page-head .actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.panel+.panel,.stack>*+*{margin-top:16px}
.panel-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-height:48px;padding:10px 16px;border-bottom:1px solid var(--line)}
.panel-head .aside{margin-left:auto;font-size:13px}
.panel-body{padding:16px}
.panel table th:first-child,.panel table td:first-child{padding-left:16px}.panel table th:last-child,.panel table td:last-child{padding-right:16px}
.grid-2{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
.btn{height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-sm);border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font:500 13px var(--font);letter-spacing:-0.005em;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s;box-shadow:0 1px 1px rgb(0 0 0/.03)}
.btn:hover{background:var(--hover);text-decoration:none}
.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--on-ink)}.btn.primary:hover{background:var(--ink-hover);border-color:var(--ink-hover)}
.btn:disabled{opacity:.6;cursor:progress}
.btn.block{width:100%;justify-content:center;height:36px}
.field{display:block;margin-bottom:16px}.field>span{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
.hint{margin-top:6px;font-size:12.5px;color:var(--text-3)}
.form-section{margin:24px 0 12px;padding-top:16px;border-top:1px solid var(--line)}.form-section .hint{display:block;margin-top:2px;font-weight:400}
input[type=text],input[type=email],input[type=tel],input[type=password],input[type=url],input[type=number],select,textarea{width:100%;height:34px;padding:0 10px;border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font:14px var(--font);transition:border-color .15s,box-shadow .15s}
select{padding-right:28px}
input:hover,select:hover,textarea:hover{border-color:var(--text-3)}
input:focus-visible,select:focus-visible,textarea:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
input::placeholder,textarea::placeholder{color:var(--text-3)}
textarea{height:auto;min-height:180px;padding:10px;font:12.5px/1.55 var(--mono);resize:vertical}
input[type=file]{font:13px var(--font);color:var(--text-2)}
.picker{position:relative;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer}.picker input{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0}.picker:focus-within .btn{box-shadow:var(--focus)}.picker .names{font-size:13px;color:var(--text-3);min-width:0;overflow-wrap:anywhere}
input[type=file]::file-selector-button{height:30px;margin-right:10px;padding:0 12px;border-radius:var(--r-sm);border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font:500 13px var(--font);cursor:pointer}
.choice{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}.choice label{flex:1;display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line-strong);border-radius:var(--r-sm);cursor:pointer}
.choice label:has(input:checked){border-color:var(--accent);background:var(--accent-weak)}
.choice input{margin-top:3px;accent-color:var(--accent)}
.check{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--text-2)}.check input{accent-color:var(--accent);margin:0}
.notice{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;margin-bottom:16px;border-radius:var(--r-sm);background:var(--bad-weak);color:var(--bad);font-weight:500}
.notice.good{background:var(--good-weak);color:var(--good)}
.notice .i{margin-top:2px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:0 0 24px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs a{display:flex;align-items:center;gap:6px;padding:10px 10px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--text-2);font-weight:500;white-space:nowrap}
.tabs a:hover{color:var(--text);text-decoration:none}
.tabs a[aria-current=page]{color:var(--text);border-bottom-color:var(--text)}
.tabs .n{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--sunken);font-size:11.5px;color:var(--text-3);display:inline-grid;place-items:center}.tabs .n.hot{background:var(--bad-weak);color:var(--bad);font-weight:600}
.track{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));padding:18px 16px 16px}
.step{position:relative;padding:26px 12px 0 0}
.step::before{content:"";position:absolute;top:8px;left:18px;right:6px;height:2px;border-radius:2px;background:var(--line)}
.step:last-child::before{display:none}
.step.done::before{background:var(--good)}
.dot{position:absolute;top:0;left:0;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--surface);border:2px solid var(--line-strong);color:var(--surface)}
.step.done .dot{background:var(--good);border-color:var(--good)}
.step.review .dot{border-color:var(--accent);background:var(--accent-weak)}
.step.review .dot::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.step.attention .dot{border-color:var(--bad);background:var(--bad-weak)}
.step.attention .dot::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--bad)}
.step .label{font-size:13px;font-weight:500}
.step .detail{font-size:12px;color:var(--text-3)}
.step.review .detail{color:var(--accent-text)}.step.attention .detail{color:var(--bad)}
.mini{display:flex;gap:3px;align-items:center}
.mini i{width:14px;height:5px;border-radius:3px;background:var(--line)}
.mini i.done{background:var(--good)}.mini i.review{background:var(--accent)}.mini i.attention{background:var(--bad)}
.stage{display:flex;flex-direction:column;gap:5px}.stage .lbl{font-size:12.5px;color:var(--text-2)}
.rows .row{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);color:inherit}
.rows .row:last-child{border-bottom:0}
.rows a.row:hover{background:var(--hover);text-decoration:none}
.rows .row .what{min-width:0;flex:1}
.rows .row .what p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rows .row .go{color:var(--text-3)}
.emptystate{padding:28px 16px;text-align:center;color:var(--text-2)}
.emptystate .strong{display:block;margin-bottom:4px}
.result{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.result .rate{font-size:28px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.chart{display:block;width:100%;height:auto;margin-top:16px}
.chart .bar{fill:var(--line-strong)}.chart .bar.good{fill:var(--good)}.chart .bar.bad{fill:var(--bad)}.chart .bar.last{opacity:1}
.chart .goal{stroke:var(--text-3);stroke-dasharray:3 3}
.chart text{fill:var(--text-3);font:11px var(--font)}
.failing li{padding:10px 16px;border-bottom:1px solid var(--line)}.failing code{display:block;margin-bottom:2px;color:var(--text)}.failing li:last-child{border-bottom:0}
.failing{list-style:none;margin:0;padding:0}
.next{display:flex;flex-direction:column;gap:12px}
.feed{list-style:none;margin:0;padding:4px 0}.feed li{display:flex;gap:10px;padding:8px 16px;font-size:13px}
.feed .t{margin-left:auto;color:var(--text-3);white-space:nowrap}
.who-chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--sunken);font-size:12px;color:var(--text-2);white-space:nowrap}
.who-chip.agent{background:var(--accent-weak);color:var(--accent-text)}
.chip{display:inline-flex;align-items:center;min-height:20px;max-width:100%;padding:2px 7px;border-radius:5px;background:var(--sunken);font-size:12px;line-height:16px;color:var(--text-2);margin:2px 0;overflow-wrap:anywhere}
.chip.good{background:var(--good-weak);color:var(--good)}.chip.bad{background:var(--bad-weak);color:var(--bad)}.chip.tag{background:transparent;border:1px solid var(--line);color:var(--text-3)}
.draft{overflow:hidden}
.draft-head{display:flex;align-items:flex-start;gap:12px;padding:16px;border-bottom:1px solid var(--line)}
.draft-head .badge{margin-left:auto}
.reasoning{display:flex;gap:10px;padding:12px 16px;background:var(--sunken);border-bottom:1px solid var(--line);color:var(--text-2)}
details.reasoning{display:block}details.reasoning summary{display:flex;gap:10px;list-style:none;cursor:pointer}details.reasoning summary::-webkit-details-marker{display:none}
.reasoning .more{margin-left:auto;font-size:12.5px;font-weight:500;color:var(--accent-text);white-space:nowrap}details.reasoning[open] .more{visibility:hidden}
.reasoning .rest{margin:6px 0 0 26px}
.reasoning .i{color:var(--accent);margin-top:3px}
.reasoning .label{font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px}
.prose{max-width:76ch;line-height:1.6}.prose.lead{font-size:15px;color:var(--text)}
.draft-body{padding:16px}
.draft-body .sub{margin-top:18px}.draft-body h4{margin:0 0 8px;font-size:13px;font-weight:600}
.draft-body table{border:1px solid var(--line);border-radius:var(--r-sm);border-collapse:separate;border-spacing:0;overflow:hidden}
.draft-body .kv th{width:180px;color:var(--text-2);font-size:13px;font-weight:500;background:var(--sunken)}
.draft-body .count{margin-bottom:10px}
.cases td:nth-child(2),.cases td:nth-child(3){min-width:200px}.cases .checks div+div{margin-top:4px}.cases .tags{margin-top:4px}
.scroll{overflow-x:auto}
ul.plain{margin:0;padding-left:18px}ul.plain li+li{margin-top:4px}
ol.fixes{margin:0;padding:0;list-style:none;counter-reset:f}
ol.fixes li{position:relative;padding:12px 0 12px 34px;border-bottom:1px solid var(--line);counter-increment:f}
ol.fixes li:last-child{border-bottom:0}
ol.fixes li::before{content:counter(f);position:absolute;left:0;top:12px;width:22px;height:22px;border-radius:50%;background:var(--sunken);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--text-2)}
ol.fixes .prose{margin-top:4px;color:var(--text-2)}ol.fixes .meta{margin-top:6px;font-size:13px}
pre.raw{margin:0;padding:12px;background:var(--sunken);border-radius:var(--r-sm);font:12.5px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word}
details.edit{border-top:1px solid var(--line);padding:0 16px}
details.edit summary{cursor:pointer;padding:12px 0;font-size:13px;font-weight:500;color:var(--text-2)}
details.edit[open]{padding-bottom:16px}
.draft-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--line);background:var(--sunken)}
.draft-foot input{flex:1}
details.history{border-bottom:1px solid var(--line)}details.history:last-child{border-bottom:0}
details.history summary{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;list-style:none;flex-wrap:wrap}
details.history summary::-webkit-details-marker{display:none}
details.history summary:hover{background:var(--hover)}
details.history .note{font-style:italic}
.auth{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.auth-card{width:100%;max-width:380px}
.auth-card .brand{justify-content:center;margin-bottom:28px;font-size:22px;gap:10px}
.auth-card h1{text-align:center;font-size:20px}
.auth-card .lede{text-align:center;color:var(--text-2);margin:6px 0 24px}
.or{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--text-3);font-size:12px}
.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
.errorpage{max-width:520px;margin:12vh auto 0;text-align:center}.errorpage>.i{margin:0 auto}
.errorpage h1{margin:12px 0 8px}
.scan-head{display:flex;align-items:flex-start;gap:16px;padding:20px;flex-wrap:wrap}
.scan-head .big{font-size:22px;font-weight:600;letter-spacing:-0.02em}
.scan-head .meta{margin-top:6px;color:var(--text-2)}
.scan-head form{margin-left:auto}
.rule-head{display:flex;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid var(--line)}
.rule-head .what{flex:1;min-width:0}
.rule-head h3{font-size:15px}
.rule-head .tags{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.clause{margin-top:8px;padding:8px 12px;background:var(--sunken);border-radius:var(--r-sm);color:var(--text-2);font-size:13px}
.clause cite{font-style:normal;font-weight:600;color:var(--text);margin-right:6px}
.harm{margin-top:8px;font-size:13px;color:var(--text-2)}.harm b{color:var(--text);font-weight:600}
.probe{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}
.probe:last-child{border-bottom:0}
.probe .cap{font-size:12px;color:var(--text-3);margin-bottom:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.bubble{padding:9px 12px;border-radius:10px;background:var(--sunken);line-height:1.5;overflow-wrap:anywhere;white-space:pre-line}
.bubble.ai{background:var(--surface);border:1px solid var(--line)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid var(--line)}
.stats>div{padding:16px;border-right:1px solid var(--line)}.stats>div:last-child{border-right:0}
.stats .v{font-size:26px;font-weight:600;letter-spacing:-.02em;line-height:1.1}.stats .v.bad{color:var(--bad)}
.stats .k{font-size:12.5px;color:var(--text-3);margin-top:4px}
.rulebars{list-style:none;margin:0;padding:8px 16px 14px}
.rulebars li{display:grid;grid-template-columns:minmax(0,1fr) 120px 28px;gap:12px;align-items:center;padding:6px 0}
.rulebars .bar{height:6px;border-radius:3px;background:var(--sunken);overflow:hidden}.rulebars .bar i{display:block;height:100%;background:var(--bad);border-radius:3px}
.rulebars .bar i.medium{background:var(--warn)}.rulebars .bar i.low{background:var(--text-3)}
.convo{padding:14px 16px;border-bottom:1px solid var(--line)}.convo:last-child{border-bottom:0}
.convo .probe{padding:0;border:0}.convo .meta-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--text-3);margin-bottom:8px}
.convo .why{margin-top:10px;display:grid;gap:6px}.convo .why p{line-height:1.5}
.convo.flagged .bubble.ai{border-color:color-mix(in srgb,var(--bad) 45%,var(--line));background:var(--bad-weak)}
.btn.sm{height:28px;padding:0 10px;font-size:13px}
pre.snippet{margin:0;padding:12px;border-radius:var(--r-sm);background:var(--sunken);font:12px/1.55 var(--mono);white-space:pre-wrap;word-break:break-all}
@media (max-width:640px){.stats{grid-template-columns:1fr}.stats>div{border-right:0;border-bottom:1px solid var(--line)}.rulebars li{grid-template-columns:minmax(0,1fr) 60px 24px}}
.probe.broken .bubble.ai{border-color:color-mix(in srgb,var(--bad) 45%,var(--line));background:var(--bad-weak)}
.verdict-line{grid-column:1/-1;display:flex;gap:10px;align-items:flex-start;font-size:13px}
.verdict-line .fix{color:var(--text-2)}
.tactic{font-size:12px;color:var(--text-3);font-style:italic}.tactic::before{content:"· ";font-style:normal}
@media (max-width:760px){.probe{grid-template-columns:minmax(0,1fr)}}
@media (max-width:1000px){.grid-2{grid-template-columns:minmax(0,1fr)}}
@media (max-width:860px){
  .app{grid-template-columns:minmax(0,1fr);background:none}
  .rail{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;background:var(--rail);border-bottom:1px solid var(--line)}
  .nav{flex-direction:row;flex-wrap:wrap}.nav-title,.orgs-nav{display:none}
  .rail-foot{margin:0 0 0 auto;border:0;padding:0}.rail-foot .who{display:none}
  .topbar{padding:0 16px}.content{padding:20px 16px 56px}
  .track{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:18px}
  .hide-sm{display:none}
}
.meter{height:6px;border-radius:99px;background:var(--sunken);overflow:hidden;margin:14px 0 8px}
.meter i{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width .4s ease}
.scan-live{padding:28px 24px}.scan-live .big{font-size:17px;font-weight:600}
.onboard{padding:28px 24px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:28px;align-items:center}
.onboard h2{font-size:20px;letter-spacing:-.02em;line-height:1.25}.onboard .lede{color:var(--text-2);margin:8px 0 18px;max-width:52ch}
.onboard ol{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:s}
.onboard li{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--sunken);counter-increment:s}
.onboard li::before{content:counter(s);flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:600;background:var(--surface);border:1px solid var(--line-strong);color:var(--text-2)}
.onboard li p{margin:0}.onboard .acts{display:flex;gap:10px;flex-wrap:wrap}
@media (max-width:760px){.onboard{grid-template-columns:1fr}}
.btn.ghost{border-color:transparent;background:none;justify-content:flex-start;width:100%}.btn.ghost:hover{background:var(--hover)}
details.menu{position:relative}.content>.page-head{position:relative;z-index:5}details.menu>summary{list-style:none}details.menu>summary::-webkit-details-marker{display:none}
details.menu[open]>summary{background:var(--hover)}
.menu-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:280px;padding:6px;display:grid;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 32px rgb(16 16 24/.14),0 2px 6px rgb(16 16 24/.06)}
.menu-pop form{margin:0}.agent-pick{padding:8px 8px 6px;border-top:1px solid var(--line);margin-top:2px!important}.agent-pick:first-child{border-top:0}
.agent-pick label{display:block;font-size:12px;margin-bottom:6px}.row-inline{display:flex;gap:6px 10px;flex-wrap:wrap;align-items:flex-end}.row-inline select{flex:1;min-width:0}
.conn{display:none}
form:has(input[name=type][value=http]:checked) .conn-http,form:has(input[name=type][value=openai]:checked) .conn-openai,form:has(input[name=type][value=command]:checked) .conn-command,form:has(input[name=type][value=intercom]:checked) .conn-intercom,form:has(input[name=type][value=zendesk]:checked) .conn-zendesk{display:block;animation:rise .24s cubic-bezier(.2,.75,.25,1) both}
@media (prefers-reduced-motion:no-preference){
  .content>*{animation:rise .34s cubic-bezier(.2,.75,.25,1) both}
  .content>*:nth-child(2){animation-delay:.03s}.content>*:nth-child(3){animation-delay:.06s}.content>*:nth-child(4){animation-delay:.09s}.content>*:nth-child(n+5){animation-delay:.12s}
  .live .content>*{animation:none}
  .notice{animation:rise .3s cubic-bezier(.2,.75,.25,1) both}
  .btn{transition:background .15s,border-color .15s,transform .08s}.btn:active{transform:scale(.97)}
  .rows a.row,tbody tr,.tabs a,.rail a{transition:background .12s,color .12s}
  .menu-pop{animation:pop .14s ease-out both;transform-origin:top right}
  .step.current .dot,.step.review .dot{animation:pulse 2s ease-in-out infinite}
}
.stages{list-style:none;margin:0 0 20px;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.stages li+li{border-left:1px solid var(--line)}
.stages a{display:flex;gap:12px;align-items:flex-start;height:100%;padding:14px 16px;color:inherit}
.stages a:hover{background:var(--hover);text-decoration:none}
.stages .st{flex:none;width:22px;height:22px;margin-top:1px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--line-strong);color:var(--text-3);font-size:11px;font-weight:600}
.stages .done .st{background:var(--good);border-color:var(--good);color:#fff}.stages .bad .st{background:var(--bad);border-color:var(--bad);color:#fff}
.stages .lbl{font-weight:500;letter-spacing:-0.01em}.stages .det{font-size:12.5px;color:var(--text-3)}.stages .bad .det{color:var(--bad)}
.verdict{font-size:30px;font-weight:600;letter-spacing:-0.035em;line-height:1.15}.verdict .of{color:var(--text-3);font-weight:500}
.verdict.bad b{color:var(--bad);font-weight:600}.verdict.good b{color:var(--good);font-weight:600}
.rulelist{list-style:none;margin:0;padding:0}
.rulelist li{display:flex;gap:10px;align-items:center;padding:9px 16px;border-bottom:1px solid var(--line);font-size:13.5px}.rulelist li:last-child{border-bottom:0}
.rulelist .i{color:var(--good)}.rulelist .c{margin-left:auto;font-size:12.5px;color:var(--text-3);white-space:nowrap}
.rule-title{display:flex;gap:10px;align-items:flex-start}.rule-title .i{color:var(--bad);margin-top:3px}
.clause{border-left:2px solid var(--line-strong);border-radius:0;background:none;padding:2px 0 2px 12px}
details.kept summary{list-style:none;cursor:pointer;padding:10px 16px;font-size:13px;color:var(--text-2);border-top:1px solid var(--line)}details.kept summary::-webkit-details-marker{display:none}
details.kept summary:hover{background:var(--hover)}details.kept[open] summary{border-bottom:1px solid var(--line)}
.agent-name{display:flex;gap:10px;align-items:center}.agent-name .av{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--sunken);border:1px solid var(--line);color:var(--text-2)}
@media (max-width:760px){.page-head .actions{margin-left:0}.rule-head{flex-direction:column}.rule-head .tags{flex-direction:row;align-items:center}.stages{grid-template-columns:1fr}.stages li+li{border-left:0;border-top:1px solid var(--line)}.verdict{font-size:24px}}
.clause,.harm,.verdict-line,.convo .why p,.rule-title h3{overflow-wrap:anywhere}
.verdict.warn b{color:var(--warn);font-weight:600}
.draft-body .kv td{overflow-wrap:anywhere}
@media (max-width:760px){.draft-body .kv th{width:110px;white-space:normal}.rulelist li{flex-wrap:wrap}.rulelist .c{white-space:normal;margin-left:26px;width:100%}}
.fixit .panel-body{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.fixit .panel-body>div{flex:1;min-width:260px}.fixit form.panel-body{display:flex;flex-direction:column;align-items:stretch}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
@keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 35%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 0%,transparent)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const pct = x => `${Math.round(x * 1000) / 10}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function ago(iso, now = new Date()) {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso).replace(/,.*$/, '');
}

export const orgPath = org => `/orgs/${encodeURIComponent(org.id)}`;
export const depPath = (org, name) => `${orgPath(org)}/deployments/${encodeURIComponent(name)}`;

const VERDICT = { accepted: ['good', 'Accepted'], not_accepted: ['bad', 'Not accepted'], pending_review: ['warn', 'Needs review'] };
export const verdictBadge = v => { const [cls, text] = VERDICT[v] ?? ['', v]; return `<span class="badge ${cls}">${esc(text)}</span>`; };

// The Delomu mark: a "D" cut by one diagonal slash (assets/brand/delomu-mark.svg), drawn in the text colour.
export const mark = (size, id) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><mask id="${id}"><rect width="64" height="64" fill="#fff"/><path d="M14 66 L34 -2" fill="none" stroke="#000" stroke-width="5.5"/></mask></defs><path d="M8 6 H30 A26 26 0 0 1 30 58 H8 Z" fill="currentColor" mask="url(#${id})"/></svg>`;

// nav: { orgs, org?, active, pending, canAudit, billingOrgs (Set of org ids where Billing shows) }
function rail({ user, csrf, nav = {} }) {
  const org = nav.org;
  const link = (href, label, ic, key, extra = '') => `<a href="${esc(href)}"${nav.active === key ? ' aria-current="page"' : ''}>${icon(ic)}${esc(label)}${extra}</a>`;
  const orgLinks = (nav.orgs ?? []).length ? `<div class="nav orgs-nav"><p class="nav-title">Organizations</p>${nav.orgs.map(o => `<a href="${esc(orgPath(o))}"${org?.id === o.id ? ' aria-current="page"' : ''}>${icon('building')}<span>${esc(o.name)}</span>${o.partner_org_id ? '<span class="org-kind">managed</span>' : ''}</a>`).join('')}</div>` : '';
  return `<nav class="rail" aria-label="Main">
<a class="brand" href="/" aria-label="Delomu home">${mark(20, 'm-rail')}<span>Delomu</span></a>
<div class="nav">
${link('/', 'Home', 'home', 'home', nav.pending ? `<span class="count" aria-label="${nav.pending} waiting">${nav.pending}</span>` : '')}
${org ? (org.kind === 'partner' ? link(orgPath(org), 'Clients', 'building', 'clients') : link(orgPath(org), 'AI agents', 'layers', 'deployments')) : ''}
${org && nav.canAudit ? link(`${orgPath(org)}/audit`, 'Audit log', 'shield', 'audit') : ''}
${org && nav.billingOrgs?.has(org.id) ? link(`${orgPath(org)}/billing`, 'Billing', 'card', 'billing') : ''}
</div>
${orgLinks}
<div class="rail-foot"><span class="who" title="${esc(user.email)}">${esc(user.email)}</span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="icon-btn" title="Sign out" aria-label="Sign out">${icon('logout')}</button></form></div>
</nav>`;
}

function doc(title, body, bodyClass = '', refresh = 0) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">${refresh ? `<noscript><meta http-equiv="refresh" content="${refresh}"></noscript>` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${esc(title)} · Delomu</title><style>${STYLE}</style></head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}${refresh ? ` data-refresh="${refresh}"` : ''}>${body}<script data-ui="busy">${BUSY_SCRIPT}</script></body></html>
`;
}

// crumbs: [[label, href?], ...]
export function layout({ title, user, csrf, nav, crumbs = [], body, refresh = 0 }) {
  if (!user) return doc(title, `<main class="auth">${body}</main>`);
  const trail = crumbs.map(([label, href], i) => (i === crumbs.length - 1 || !href
    ? `<span class="here">${esc(label)}</span>`
    : `<a href="${esc(href)}">${esc(label)}</a><span class="sep">/</span>`)).join('');
  return doc(title, `<div class="app">${rail({ user, csrf, nav })}
<div><header class="topbar">${trail}</header><main class="content">${body}</main></div></div>`, refresh ? 'live' : '', refresh);
}

// link: optional [href, label] shown after the text, e.g. the Billing page for a plan limit.
const notice = (text, kind = '', link) => (text ? `<div class="notice ${kind}" role="${kind ? 'status' : 'alert'}">${icon(kind === 'good' ? 'check' : 'alert')}<span>${esc(text)}${link ? ` <a href="${esc(link[0])}">${esc(link[1])}</a>` : ''}</span></div>` : '');
const upgradeLink = href => (href ? [href, 'View plans and upgrade'] : undefined);

// Self-serve sign-up (DELOMU_SIGNUP=open): one form, then the sign-in key shown once. An AI vendor gets a
// partner org, with one separate workspace per client (like a platform's connected accounts).
export const SIGNUP_KINDS = [
  { id: 'company', label: 'We use an AI agent with our customers', hint: 'Check that your own AI keeps your policies.' },
  { id: 'vendor', label: 'We sell an AI agent to companies', hint: 'One workspace per client: test each rollout against that client’s policies.' },
];

export function signupPage({ csrf, error, values = {} }) {
  return layout({
    title: 'Create your account',
    body: `<div class="auth-card">
<a class="brand" href="/login" aria-label="Delomu">${mark(26, 'm-auth')}<span>Delomu</span></a>
<h1>Test your AI agent</h1><p class="lede">Find the policy rules your AI agent breaks, before your customers do. Free plan, no card.</p>
${notice(error)}
<form method="post" action="/signup" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Work email</span><input type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(values.email ?? '')}" placeholder="you@company.com"></label>
<label class="field"><span>Company</span><input type="text" name="company" required maxlength="60" autocomplete="organization" value="${esc(values.company ?? '')}" placeholder="Acme"></label>
<div class="field"><span>What do you do?</span><div class="choice">
${SIGNUP_KINDS.map(k => `<label><input type="radio" name="kind" value="${k.id}"${(values.kind ?? 'company') === k.id ? ' checked' : ''}><span><span class="strong">${esc(k.label)}</span><span class="hint" style="display:block;margin:2px 0 0">${esc(k.hint)}</span></span></label>`).join('\n')}
</div></div>
<button class="btn primary block" data-busy="Creating…">Create free account</button></form>
<p class="subtle" style="margin-top:16px;text-align:center">Already have an account? <a href="/login">Sign in</a></p>
</div>`,
  });
}

export function signupKeyPage({ secret, email }) {
  return layout({
    title: 'Save your sign-in key',
    body: `<div class="auth-card">
<a class="brand" href="/" aria-label="Delomu">${mark(26, 'm-auth')}<span>Delomu</span></a>
<h1>Save your sign-in key</h1><p class="lede">You are signed in as ${esc(email)}. Next time, sign in with this key. It is shown only once, so save it in your password manager now.</p>
<label class="field"><span>Sign-in key</span><input type="text" readonly value="${esc(secret)}" class="mono" aria-describedby="keyhint"><p class="hint" id="keyhint">It also works as an API key for the Delomu API.</p></label>
<a class="btn primary block" href="/">I saved it, continue</a>
</div>`,
  });
}

export function loginPage({ csrf, error, signup = false }) {
  return layout({
    title: 'Sign in',
    body: `<div class="auth-card">
<a class="brand" href="/login" aria-label="Delomu">${mark(26, 'm-auth')}<span>Delomu</span></a>
<h1>Sign in</h1><p class="lede">Continue with your company account.</p>
${notice(error)}
<form method="get" action="/sso/start" novalidate>
<label class="field"><span>Organization</span><input type="text" id="org" name="org" required maxlength="60" autocomplete="organization" placeholder="your-company"></label>
<button class="btn primary block">Continue with single sign-on</button></form>
<div class="or">or use an API key</div>
<form method="post" action="/login" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>API key</span><input type="password" id="api_key" name="api_key" required autocomplete="off" placeholder="dk_…"></label>
<button class="btn block">Sign in with API key</button></form>
${signup ? '<p class="subtle" style="margin-top:16px;text-align:center">New to Delomu? <a href="/signup">Create a free account</a></p>' : ''}
</div>`,
  });
}

export function errorPage({ status, message, user, csrf, nav }) {
  const title = status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong';
  return layout({ title, user, csrf, nav, crumbs: [[title]], body: `<div class="errorpage">${icon('alert', { size: 24 })}
<h1>${esc(title)}</h1><p class="muted">${esc(message)}</p><p style="margin-top:20px"><a class="btn" href="/">Go to Home</a></p></div>` });
}

// The latest pre-launch check of an agent, as a badge: rules broken, all kept, or not checked yet.
function checkBadge(scan) {
  if (!scan) return '<span class="subtle">Not checked</span>';
  const s = scan.summary;
  if (s.broken) return `<span class="badge bad num">${s.broken} of ${s.rules} rules broken</span>`;
  if (s.unjudged) return `<span class="badge warn num">${s.unjudged} answer${s.unjudged === 1 ? '' : 's'} to review</span>`;
  return `<span class="badge good num">All ${s.rules} rules kept</span>`;
}

function liveCell(live) {
  const w = live?.week;
  if (!w?.checked) return '<span class="subtle">Not connected</span>';
  return `<span class="num">${w.checked.toLocaleString('en-US')} checked</span>${w.flagged ? ` · <span class="bad num" style="color:var(--bad)">${w.flagged} broke a rule</span>` : ' · <span class="subtle">all kept</span>'}`;
}

// rows: [{ org, name, ov (overview), customer }]
function agentsTable(rows, { showOrg, now }) {
  if (!rows.length) return '';
  return `<div class="scroll"><table><thead><tr><th>AI agent</th>${showOrg ? '<th class="hide-sm">Organization</th>' : ''}<th>Pre-launch check</th><th class="hide-sm">Live, last 7 days</th><th class="hide-sm">Last checked</th></tr></thead><tbody>
${rows.map(({ org, name, ov, customer }) => {
    const scan = ov.scans[0];
    return `<tr>
<td><a class="agent-name" href="${esc(depPath(org, name))}/scan"><span class="av">${icon('spark')}</span><span><span class="strong">${esc(name)}</span>${customer ? `<span class="subtle" style="display:block;font-size:12.5px">${esc(customer)}</span>` : ''}</span></a></td>
${showOrg ? `<td class="hide-sm muted">${esc(org.name)}</td>` : ''}
<td>${checkBadge(scan)}</td>
<td class="hide-sm">${liveCell(ov.live)}</td>
<td class="hide-sm subtle nowrap">${scan ? esc(ago(scan.createdAt, now)) : '—'}</td></tr>`;
  }).join('\n')}
</tbody></table></div>`;
}

// First-run guide: the three steps to a first check, with a one-click sample support bot.
function onboarding(org, csrf) {
  return `<section class="panel onboard"><div>
<h2>Find the rules your AI agent breaks, before your customers do</h2>
<p class="lede">Delomu reads your policies, writes the messages most likely to make your AI break each rule, and checks every answer against the exact clause.</p>
<div class="acts"><form method="post" action="${esc(orgPath(org))}/sample"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="btn primary" data-busy="Setting up…">${icon('spark')}Try it on a sample support bot</button></form>
<a class="btn" href="${esc(orgPath(org))}/new-deployment">${icon('plus')}Connect your AI agent</a></div></div>
<ol aria-label="How it works"><li><p><span class="strong">Connect your AI agent</span><br><span class="subtle">Support, sales, billing or HR: Intercom Fin, Zendesk AI or your own bot.</span></p></li>
<li><p><span class="strong">Add your policies</span><br><span class="subtle">Refunds, pricing and discounts, privacy, help articles.</span></p></li>
<li><p><span class="strong">Run the check</span><br><span class="subtle">About a minute. Every finding cites its clause.</span></p></li></ol></section>`;
}

export function homePage({ user, csrf, nav, now, deployments, review, canWrite }) {
  const orgs = nav.orgs ?? [];
  if (!deployments.length && canWrite && orgs.length === 1) {
    return layout({ title: 'Home', user, csrf, nav: { ...nav, active: 'home' }, crumbs: [['Home']], body: `
<div class="page-head"><div><h1>Welcome to Delomu</h1><p class="sub">Run your first check in about two minutes.</p></div></div>${onboarding(orgs[0], csrf)}` });
  }
  const broken = deployments.filter(d => d.ov.scans[0]?.summary.broken).length;
  const summary = deployments.length
    ? `${deployments.length} AI agent${deployments.length > 1 ? 's' : ''}${broken ? ` · ${broken} breaking policy rules` : ''}`
    : 'No AI agents yet.';
  const queue = review.length ? `<section class="panel"><div class="panel-head"><h2>Waiting for your decision</h2><span class="badge accent plain num">${review.length}</span></div><div class="rows">${review.map(({ org, name, draft }) => `<a class="row" href="${esc(depPath(org, name))}/drafts">
${icon('inbox')}<div class="what"><p class="strong">${esc(draftLabel(draft))} for ${esc(name)}</p><p class="subtle">${esc(org.name)} · drafted ${esc(ago(draft.createdAt, now))}${draft.rationale ? ` · ${esc(draft.rationale)}` : ''}</p></div>
<span class="btn">Review</span></a>`).join('')}</div></section>` : '';
  return layout({ title: 'Home', user, csrf, nav: { ...nav, active: 'home' }, crumbs: [['Home']], body: `
<div class="page-head"><div><h1>AI agents</h1><p class="sub num">${esc(summary)}</p></div>
${orgs.length === 1 && canWrite ? `<div class="actions"><a class="btn primary" href="${esc(orgPath(orgs[0]))}/new-deployment">${icon('plus')}Add AI agent</a></div>` : ''}</div>
<section class="panel">${deployments.length ? agentsTable(deployments, { showOrg: orgs.length > 1, now }) : `<div class="emptystate"><span class="strong">No AI agents yet</span>Connect the AI agent you want to check.</div>`}</section>
${queue}` });
}

const draftLabel = d => ({ mapping: 'Data mapping', integration: 'Integration', cases: 'Test cases', fixes: 'Fixes', 'launch-report': 'Launch report' })[d.kind] ?? 'Draft';

export function orgPage({ user, csrf, nav, now, org, deployments, canWrite, notice: msg }) {
  return layout({ title: org.name, user, csrf, nav: { ...nav, org, active: 'deployments' }, crumbs: [['AI agents']], body: `
<div class="page-head"><div><h1>AI agents</h1><p class="sub">${esc(org.name)} · ${deployments.length} agent${deployments.length === 1 ? '' : 's'}</p></div>
<div class="actions">${deployments.length ? `<a class="btn" href="${esc(orgPath(org))}/metrics">${icon('pulse')}Deployment metrics</a>` : ''}${canWrite ? `<a class="btn primary" href="${esc(orgPath(org))}/new-deployment">${icon('plus')}Add AI agent</a>` : ''}</div></div>
${notice(msg, 'good')}
${deployments.length ? `<section class="panel">${agentsTable(deployments, { now })}</section>` : canWrite ? onboarding(org, csrf) : `<section class="panel"><div class="emptystate"><span class="strong">No AI agents yet</span>An admin connects the AI agent to check.</div></section>`}` });
}

// An AI vendor's home (a partner org): one row per client workspace, with that client's agents rolled up and
// the clients that need someone today first. clients: [{ org, deployments: [{ name, ov, hours }] }]
const CLIENT_STATUS = [
  { id: 'review', cls: 'accent', text: n => `${n} draft${n === 1 ? '' : 's'} to review` },
  { id: 'broken', cls: 'bad', text: n => `${n} rule${n === 1 ? '' : 's'} broken` },
  { id: 'live', cls: 'bad', text: n => `${n} live chat${n === 1 ? '' : 's'} broke a rule` },
  { id: 'setup', cls: 'warn', text: () => 'No AI agent yet' },
  { id: 'unchecked', cls: 'warn', text: () => 'Not checked yet' },
  { id: 'ok', cls: 'good', text: () => 'On track' },
];

export function clientStatus(ds) {
  const sum = f => ds.reduce((n, d) => n + f(d), 0);
  const waiting = sum(d => d.ov.pending.length);
  const broken = sum(d => d.ov.scans[0]?.summary.broken ?? 0);
  const live = sum(d => d.ov.live?.week?.flagged ?? 0);
  const [id, n] = waiting ? ['review', waiting] : broken ? ['broken', broken] : live ? ['live', live]
    : !ds.length ? ['setup', 0] : ds.some(d => !d.ov.scans.length) ? ['unchecked', 0] : ['ok', 0];
  const i = CLIENT_STATUS.findIndex(x => x.id === id);
  return { id, rank: i, cls: CLIENT_STATUS[i].cls, text: CLIENT_STATUS[i].text(n) };
}

// Where a client's rollout is: live once conversations are checked, else the stage of its furthest agent.
function clientStage(ds) {
  if (!ds.length) return 'Setup';
  if (ds.some(d => d.ov.live?.week?.checked)) return 'Live';
  if (ds.some(d => d.signoff?.decision === 'accepted')) return 'Client accepted';
  if (ds.some(d => d.ov.scans.length)) return 'Pre-launch check';
  if (ds.some(d => d.ov.inputs.length)) return 'Policies added';
  return 'Connected';
}

export function clientsPage({ user, csrf, nav, now, org, clients, own, canManage, error, values = {}, notice: msg }) {
  const hours = ds => ds.reduce((n, d) => n + (d.hours ?? 0), 0);
  const last = ds => ds.flatMap(d => d.ov.scans.slice(0, 1).map(sc => sc.createdAt)).sort().pop();
  const rated = clients.map(c => ({ ...c, status: clientStatus(c.deployments) })).sort((a, b) => a.status.rank - b.status.rank || a.org.name.localeCompare(b.org.name));
  const need = rated.filter(c => c.status.rank < 3).length;
  const agents = clients.reduce((n, c) => n + c.deployments.length, 0);
  const live = clients.filter(c => clientStage(c.deployments) === 'Live').length;
  const fmtH = h => (h ? `${Math.round(h * 10) / 10} h` : '<span class="subtle">—</span>');
  const rows = rated.map(({ org: c, deployments: ds, status }) => `<tr>
<td><a class="agent-name" href="${esc(orgPath(c))}"><span class="av">${icon('building')}</span><span><span class="strong">${esc(c.name)}</span><span class="subtle" style="display:block;font-size:12.5px">${ds.length} AI agent${ds.length === 1 ? '' : 's'}</span></span></a></td>
<td><span class="badge ${status.cls}${status.cls === 'accent' ? ' plain' : ''} num">${esc(status.text)}</span></td>
<td class="hide-sm">${esc(clientStage(ds))}</td>
<td class="hide-sm num">${fmtH(hours(ds))}</td>
<td class="hide-sm subtle nowrap">${last(ds) ? esc(ago(last(ds), now)) : '—'}</td></tr>`).join('\n');
  const add = canManage ? `<form method="post" action="${esc(orgPath(org))}/clients" class="panel" style="max-width:720px" novalidate><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<h2 style="margin:0 0 4px">Add a client</h2><p class="subtle" style="margin:0 0 12px">Each client gets its own workspace: its policies, checks and conversations stay apart from every other client.</p>
<label class="field"><span>Client name</span><input type="text" name="name" required maxlength="60" value="${esc(values.name ?? '')}" placeholder="Acme Bank"></label>
<button class="btn primary" data-busy="Adding…">${icon('plus')}Add client</button></div></form>` : '';
  const stats = clients.length ? `<div class="stats"><div><p class="v num">${clients.length}</p><p class="k">Clients · ${agents} AI agent${agents === 1 ? '' : 's'}</p></div>
<div><p class="v num${need ? ' bad' : ''}">${need}</p><p class="k">Need attention</p></div>
<div><p class="v num">${live}</p><p class="k">Live</p></div></div>` : '';
  return layout({ title: 'Clients', user, csrf, nav: { ...nav, org, active: 'clients' }, crumbs: [['Clients']], body: `
<div class="page-head"><div><h1>Clients</h1><p class="sub">${esc(org.name)} · ${clients.length} client${clients.length === 1 ? '' : 's'}</p></div>
<div class="actions"><a class="btn" href="${esc(orgPath(org))}/metrics">${icon('pulse')}Deployment metrics</a></div></div>
${notice(msg, 'good')}${notice(error)}
<section class="panel">${stats}${clients.length ? `<div class="scroll"><table><thead><tr><th>Client</th><th>Status</th><th class="hide-sm">Stage</th><th class="hide-sm">Engineer hours</th><th class="hide-sm">Last checked</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : '<div class="emptystate"><span class="strong">No clients yet</span>Add a client to set up its workspace, then connect the AI you deploy for it.</div>'}</section>
${add}
${own.length ? `<section class="panel"><div class="panel-head"><h2>Your own AI agents</h2></div>${agentsTable(own, { now })}</section>` : ''}` });
}

const CONNECTIONS = [
  { type: 'intercom', label: 'Intercom', hint: 'Fin or a bot in your Intercom workspace.' },
  { type: 'zendesk', label: 'Zendesk', hint: 'An AI agent in Zendesk messaging.' },
  { type: 'http', label: 'HTTP endpoint', hint: 'Your own bot answers a POST request.' },
  { type: 'openai', label: 'OpenAI-compatible API', hint: 'A chat completions endpoint: OpenAI, Azure OpenAI, OpenRouter, vLLM and the like.' },
  { type: 'command', label: 'Command', hint: 'A program on this server; off unless the operator allows it.' },
];

export function newDeploymentPage({ user, csrf, nav, org, error, values = {} }) {
  const v = k => esc(values[k] ?? '');
  const type = CONNECTIONS.some(c => c.type === values.type) ? values.type : 'http';
  const section = (title, hint = '') => `<h3 class="form-section">${esc(title)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</h3>`;
  return layout({ title: 'Add an AI agent', user, csrf, nav: { ...nav, org, active: 'deployments' }, crumbs: [['AI agents', orgPath(org)], ['Add']], body: `
<div class="page-head"><div><h1>Add an AI agent</h1><p class="sub">Connect the AI agent you want to check. You add your policies next.</p></div></div>
${notice(error)}
<form method="post" action="${esc(orgPath(org))}/new-deployment" class="panel" style="max-width:720px" novalidate><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Name</span><input type="text" name="name" required maxlength="63" pattern="[a-z0-9]([a-z0-9\\-]*[a-z0-9])?" value="${v('name')}" placeholder="support-bot"><p class="hint">Lowercase letters, numbers and dashes.</p></label>
<label class="field"><span>Client or brand <span class="subtle" style="font-weight:400">(optional)</span></span><input type="text" name="customer" maxlength="120" value="${v('customer')}" placeholder="Acme Bank"><p class="hint">If you deploy this AI for a client, their name goes on the customer report.</p></label>
<label class="field"><span>What this AI does</span><select name="agentKind">${Object.entries(AGENT_KINDS).map(([id, k]) => `<option value="${id}"${(values.agentKind ?? 'support') === id ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select><p class="hint">The check looks hardest where this kind of AI usually breaks policy, for example discounts for a sales AI.</p></label>
<div class="field"><span>Where your AI agent runs</span><div class="choice">
${CONNECTIONS.map(c => `<label><input type="radio" name="type" value="${c.type}"${type === c.type ? ' checked' : ''}><span><span class="strong">${esc(c.label)}</span><span class="hint" style="display:block;margin:2px 0 0">${esc(c.hint)}</span></span></label>`).join('\n')}
</div></div>
<div class="conn conn-http">
<label class="field"><span>Endpoint URL</span><input type="url" name="url" value="${v('url')}" placeholder="https://bot.example.com/chat"></label>
<label class="field"><span>Authorization header</span><input type="text" name="auth" value="${v('auth')}" placeholder="Bearer \${CUSTOMER_API_KEY}"><p class="hint">Reference a server environment variable; never paste a key here.</p></label>
<label class="field"><span>Field holding the answer</span><input type="text" name="output" value="${v('output')}" placeholder="reply"><p class="hint">Dot path in the JSON response, for example <code>choices.0.message.content</code>.</p></label>
</div><div class="conn conn-openai">${section('OpenAI-compatible API', 'Each test message is sent as the user turn of a chat completion; the answer is the first choice.')}
<label class="field"><span>Chat completions URL</span><input type="url" name="openai_url" value="${v('openai_url')}" placeholder="https://api.openai.com/v1/chat/completions"></label>
<label class="field"><span>Model</span><input type="text" name="openai_model" maxlength="120" value="${v('openai_model')}" placeholder="the model your agent uses"></label>
<label class="field"><span>Authorization header</span><input type="text" name="openai_auth" value="${v('openai_auth')}" placeholder="Bearer \${CUSTOMER_OPENAI_API_KEY}"><p class="hint">Reference a server environment variable; never paste a key here.</p></label>
<label class="field"><span>System prompt <span class="subtle" style="font-weight:400">(optional)</span></span><textarea name="openai_system" maxlength="20000" rows="4" style="min-height:96px">${v('openai_system')}</textarea><p class="hint">The agent’s own instructions, so the test sees what customers see.</p></label>
</div><div class="conn conn-command">
<label class="field"><span>Command</span><input type="text" name="command" value="${v('command')}" placeholder="node bot.mjs"></label>
</div><div class="conn conn-intercom">${section('Intercom', 'Each test starts a new conversation from a test contact and waits for Fin or a teammate to reply.')}
<label class="field"><span>Access token</span><input type="text" name="intercom_token" value="${v('intercom_token')}" placeholder="\${CUSTOMER_INTERCOM_TOKEN}"><p class="hint">A server environment variable holding the Intercom access token; never paste the token here.</p></label>
<label class="field"><span>Test contact external ID</span><input type="text" name="intercom_contact" maxlength="120" value="${v('intercom_contact')}" placeholder="delomu-test"><p class="hint">Optional. Created on the first test if it does not exist.</p></label>
</div><div class="conn conn-zendesk">${section('Zendesk', 'Uses Sunshine Conversations: each test creates a test user and conversation, then waits for the AI agent to reply.')}
<label class="field"><span>Zendesk subdomain</span><input type="text" name="zendesk_subdomain" maxlength="63" value="${v('zendesk_subdomain')}" placeholder="acme"><p class="hint">The part before <code>.zendesk.com</code>.</p></label>
<label class="field"><span>App ID</span><input type="text" name="zendesk_app_id" maxlength="64" value="${v('zendesk_app_id')}" placeholder="5f8a3c…"></label>
<label class="field"><span>API key ID</span><input type="text" name="zendesk_key_id" value="${v('zendesk_key_id')}" placeholder="\${CUSTOMER_ZENDESK_KEY_ID}"></label>
<label class="field"><span>API key secret</span><input type="text" name="zendesk_secret" value="${v('zendesk_secret')}" placeholder="\${CUSTOMER_ZENDESK_SECRET}"><p class="hint">Both reference server environment variables; never paste the key here.</p></label>
</div><details class="edit" style="margin:8px -16px 0;padding:0 16px"><summary>Advanced</summary>
<label class="field"><span>Required pass rate for test runs (%)</span><input type="number" name="pass" min="1" max="100" value="${v('pass') || '90'}" style="max-width:120px"></label></details>
</div><div class="draft-foot"><a class="btn" href="${esc(orgPath(org))}">Cancel</a><span style="flex:1"></span><button class="btn primary" data-busy="Adding…">Add AI agent</button></div></form>` });
}

// The three stages a support team moves through, each linking to its tab: policies in, a pre-launch check, live monitoring.
function stages({ base, ov, checking }) {
  const scan = ov.scans[0];
  const s = scan?.summary;
  const w = ov.live?.week;
  const n = x => x.toLocaleString('en-US');
  const docs = ov.inputs.filter(f => !f.name.toLowerCase().endsWith('.csv')).length;
  const exports = ov.inputs.length - docs;
  const items = [
    { href: `${base}/inputs`, label: 'Policies', state: docs ? 'done' : 'todo',
      det: docs ? [`${docs} document${docs === 1 ? '' : 's'}`, exports && `${exports} ticket export${exports === 1 ? '' : 's'}`, ov.policiesChanged && 'changed since the last check'].filter(Boolean).join(' · ') : 'Add the rules your AI must follow' },
    { href: `${base}/scan`, label: 'Pre-launch check',
      state: checking ? 'todo' : !scan ? 'todo' : s.broken || s.unjudged || ov.policiesChanged ? 'bad' : 'done',
      det: checking ? 'Checking now…' : !scan ? 'Not run yet' : ov.policiesChanged ? 'Policies changed: run it again' : s.broken ? `${s.broken} of ${s.rules} rules broken` : s.unjudged ? `${s.unjudged} answer${s.unjudged === 1 ? '' : 's'} to review` : `All ${s.rules} rules kept` },
    { href: `${base}/live`, label: 'Live monitoring',
      state: !w?.checked ? 'todo' : w.flagged ? 'bad' : 'done',
      det: !w?.checked ? 'Not connected' : w.flagged ? `${n(w.flagged)} of ${n(w.checked)} chats broke a rule` : `${n(w.checked)} chats checked, all kept` },
  ];
  return `<ol class="stages" aria-label="Progress">${items.map((s, i) => `<li class="${s.state}"><a href="${esc(s.href)}">
<span class="st" aria-hidden="true">${s.state === 'done' ? icon('check', { size: 12 }) : s.state === 'bad' ? '!' : i + 1}</span>
<span><span class="lbl" style="display:block">${esc(s.label)}</span><span class="det">${esc(s.det)}</span></span></a></li>`).join('')}</ol>`;
}

// The shared header of every agent page: name and status, one primary action, the stages and four tabs.
function deploymentHeader({ org, name, config, ov, tab, can, csrf, checking }) {
  const base = depPath(org, name);
  const scan = ov.scans[0];
  const tabs = [['scan', 'Check results', `${base}/scan`, scan ? scan.summary.broken : 0, true], ['live', 'Live', `${base}/live`, ov.live?.week.flagged ?? 0, true], ['inputs', 'Policies', `${base}/inputs`, ov.inputs.length], ['settings', 'Settings', `${base}/settings`]];
  const primary = !ov.inputs.length
    ? (can.write ? `<a class="btn primary" href="${esc(base)}/inputs">${icon('upload')}Add policies</a>` : '')
    : checking ? `<button class="btn primary" disabled aria-busy="true">${icon('shield')}Checking…</button>`
      : can.write ? `<form method="post" action="${esc(base)}/scan"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="btn primary" data-busy="Starting…">${icon('shield')}${scan ? 'Run check again' : 'Run check'}</button></form>` : '';
  const item = (href, label, ic, n) => `<a class="btn ghost" href="${esc(href)}">${icon(ic)}${esc(label)}${n ? ` <span class="subtle num" style="margin-left:auto">${n}</span>` : ''}</a>`;
  const more = `<details class="menu"><summary class="btn" aria-label="More actions">More</summary><div class="menu-pop" role="menu">
${item(`${base}/rollout`, 'Rollout', 'layers')}${item(`${base}/overview`, 'Activity', 'pulse')}${item(`${base}/runs`, 'Test runs', 'play', ov.runs.length)}${item(`${base}/drafts`, 'Agent drafts', 'inbox', ov.pending.length)}
${can.run ? `<form method="post" action="${esc(base)}/run"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="judge" value="1">
<button class="btn ghost" data-busy="Running tests…">${icon('play')}Run the saved test set</button></form>` : ''}
${can.write ? `<form method="post" action="${esc(base)}/agent" class="agent-pick"><input type="hidden" name="csrf" value="${esc(csrf)}">
<label for="task" class="subtle">Ask the agent to draft</label><div class="row-inline"><select id="task" name="task">${STEPS.slice(0, 5).map(s => `<option value="${esc(s.key)}"${ov.next.task === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
<button class="btn" data-busy="Drafting…">${icon('spark')}Draft</button></div></form>` : ''}</div></details>`;
  const via = config.target?.preset === 'openai' ? 'OpenAI-compatible API' : { http: 'HTTP endpoint', command: 'Command', intercom: 'Intercom', zendesk: 'Zendesk' }[config.target?.type] ?? 'Not connected';
  return `<div class="page-head"><div><div class="title"><h1>${esc(name)}</h1>${checking ? '<span class="badge accent">Checking…</span>' : checkBadge(scan).replace('<span class="subtle">Not checked</span>', '<span class="badge plain">Not checked</span>')}</div>
<p class="sub">${esc([config.customer, via].filter(Boolean).join(' · '))}</p></div>
<div class="actions">${more}${primary}</div></div>
${stages({ base, ov, checking })}
<nav class="tabs" aria-label="AI agent">${tabs.map(([key, label, href, n, hot]) => `<a href="${esc(href)}"${tab === key ? ' aria-current="page"' : ''}>${esc(label)}${n ? ` <span class="n${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`).join('')}</nav>`;
}

function deploymentShell(args, body) {
  const { user, csrf, nav, org, name, title, flash, error, upgrade, refresh } = args;
  return layout({ title: title ? `${title} · ${name}` : name, user, csrf, nav: { ...nav, org, active: 'deployments' }, refresh,
    crumbs: [['AI agents', orgPath(org)], [name, title ? `${depPath(org, name)}/scan` : undefined], ...(title ? [[title]] : [])],
    body: `${deploymentHeader(args)}${notice(error, '', upgradeLink(upgrade))}${notice(flash, 'good')}${body}` });
}

function historyChart(runs, goal) {
  const shown = runs.slice(-12);
  if (shown.length < 2) return '';
  const W = 560; const H = 120; const pad = 24; const bw = Math.min(28, (W - pad) / shown.length - 8);
  const y = r => H - 18 - r * (H - 34);
  const bars = shown.map((r, i) => {
    const x = pad + i * ((W - pad) / shown.length) + 4;
    const rate = r.summary.passRate;
    return `<rect class="bar ${rate >= goal ? 'good' : 'bad'}" x="${x.toFixed(1)}" y="${y(rate).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - 18 - y(rate)).toFixed(1)}" rx="3"><title>Run ${r.number}: ${pct(rate)}</title></rect>
<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${r.number}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pass rate of the last ${shown.length} runs against the ${pct(goal)} goal">
<line class="goal" x1="${pad}" x2="${W}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/><text x="0" y="${(y(goal) + 4).toFixed(1)}">${Math.round(goal * 100)}%</text>${bars}</svg>`;
}

// Audit actions in plain words for the activity feed.
const ACTIVITY = {
  'deployment.register': 'created the deployment', 'input.upload': 'added policies', 'scan.create': 'ran a check',
  'draft.create': 'drafted a proposal', 'draft.approve': 'approved a draft', 'draft.reject': 'rejected a draft', 'draft.edit': 'edited a draft',
  'draft.apply': 'applied a draft', 'draft.approved': 'approved a draft', 'draft.rejected': 'rejected a draft', 'draft.edited': 'edited a draft', 'run.create': 'ran the tests', 'run.complete': 'finished a test run', 'agent.failed': 'could not finish a draft',
  'library.harvest': 'added cases to the library', 'monitor.run': 're-ran the tests', 'alert.send': 'sent an alert', 'live.flag': 'flagged a live conversation',
};

export function deploymentOverviewPage(args) {
  const { org, name, ov, now, config, can } = args;
  const goal = config.acceptance?.minPassRate ?? 0.9;
  const latest = ov.latest;
  const base = depPath(org, name);
  const failing = latest ? latest.cases.filter(c => c.status !== 'pass') : [];
  const reportHref = latest ? `${base}/runs/${encodeURIComponent(latest.runId)}/report.html` : '';
  const result = latest ? `<section class="panel"><div class="panel-head"><h2>Latest result</h2><span class="aside subtle">Run ${latest.number} · ${esc(fmtDate(latest.generatedAt))}</span></div><div class="panel-body">
<div class="result"><span class="rate">${esc(pct(latest.summary.passRate))}</span><span class="muted num">${latest.summary.pass} of ${latest.summary.total} cases pass · needs ${esc(pct(goal))}</span></div>
${historyChart(ov.runs, goal)}
<p style="margin-top:14px"><a href="${esc(reportHref)}">Open the acceptance report ${icon('arrow', { size: 14 }).replace('class="i"', 'class="i" style="display:inline;vertical-align:-2px"')}</a></p></div>
${failing.length ? `<div class="panel-head" style="border-top:1px solid var(--line)"><h2>Failing cases</h2><span class="aside subtle num">${failing.length}</span></div>
<ul class="failing">${failing.slice(0, 8).map(c => {
    const why = c.error ? `No answer: ${c.error}` : (c.checks.find(k => k.status !== 'pass')?.reason ?? '');
    return `<li><code>${esc(c.id)}</code><span class="muted">${esc(why)}</span></li>`;
  }).join('')}</ul>${failing.length > 8 ? `<p class="panel-body subtle">${failing.length - 8} more in the report.</p>` : ''}` : ''}</section>`
    : `<section class="panel"><div class="emptystate"><span class="strong">No test runs yet</span>${can.run ? 'Run the saved test set from the More menu to see how your AI does.' : 'An engineer runs the tests.'}</div></section>`;

  const nextBtn = {
    review: `<a class="btn primary" href="${esc(base)}/drafts">${icon('inbox')}Review drafts</a>`,
    inputs: `<a class="btn primary" href="${esc(base)}/inputs">${icon('upload')}Add policies</a>`,
    scan: `<a class="btn primary" href="${esc(base)}/scan">${icon('shield')}Open check results</a>`,
  }[ov.next.action] ?? '';
  const feed = ov.activity.length ? `<ul class="feed">${ov.activity.map(e => {
    const agent = e.actor === 'agent';
    const who = agent ? 'Agent' : e.actor === 'system' ? 'System' : e.actor.replace(/^human:/, '').split('@')[0];
    return `<li><span class="who-chip${agent ? ' agent' : ''}">${esc(who)}</span><span class="muted">${esc(ACTIVITY[e.action] ?? e.action.replace(/[._]/g, ' '))}</span><span class="t">${esc(ago(e.ts, now))}</span></li>`;
  }).join('')}</ul>` : '<p class="panel-body subtle">Nothing yet.</p>';

  return deploymentShell({ ...args, tab: 'overview', title: 'Activity' }, `<div class="grid-2"><div>${result}</div>
<div class="stack"><section class="panel"><div class="panel-head"><h2>Next step</h2></div><div class="panel-body next"><p>${esc(ov.next.text)}</p>${nextBtn}</div></section>
<section class="panel"><div class="panel-head"><h2>Activity</h2></div>${feed}</section></div></div>`);
}

// The plan's deployment metrics for an org (an AI vendor's include every client). m: deploymentMetrics() from metrics.mjs.
const GATE = { met: ['good', 'Met'], not_met: ['bad', 'Not met'], not_enough_data: ['', 'Not enough data'] };

export function metricsPage({ user, csrf, nav, org, m }) {
  const h = x => `${Math.round(x * 10) / 10} h`;
  const [cls, label] = GATE[m.gate.status] ?? ['', m.gate.status];
  const rows = m.deployments.map(d => `<tr><td class="num subtle">${d.number}</td>
<td><a href="${esc(depPath(d.org, d.name))}/rollout"><span class="strong">${esc(d.name)}</span></a>${d.org.id === org.id ? '' : `<span class="subtle" style="display:block;font-size:12.5px">${esc(d.org.name)}</span>`}</td>
<td class="subtle nowrap">${esc(fmtDate(d.startedAt))}</td>
<td class="num">${d.hours ? h(d.hours) : '<span class="subtle">None logged</span>'}</td>
<td class="hide-sm num">${d.stepsDone ? `${d.stepsDrafted} of ${d.stepsDone}` : '<span class="subtle">—</span>'}</td>
<td class="hide-sm num">${d.daysToLive === null ? '<span class="subtle">Not live</span>' : `${d.daysToLive} day${d.daysToLive === 1 ? '' : 's'}`}</td></tr>`).join('\n');
  const body = `<div class="page-head"><div><h1>Deployment metrics</h1><p class="sub">${esc(org.name)} · ${m.deployments.length} deployment${m.deployments.length === 1 ? '' : 's'}, oldest first</p></div></div>
<section class="panel"><div class="stats">
<div><p class="v num">${h(m.totalHours)}</p><p class="k">Engineer hours logged</p></div>
<div><p class="v num">${m.automation === null ? '—' : `${Math.round(m.automation * 100)}%`}</p><p class="k">Finished steps drafted by the agent</p></div>
<div><p class="v num">${m.medianDaysToLive === null ? '—' : m.medianDaysToLive}</p><p class="k">Median days to first live chat</p></div></div>
<div class="panel-body"><p style="margin:0"><span class="badge ${cls}">${esc(label)}</span> <span class="strong">Gate: deployment 5 takes under half the hours of deployment 1.</span> <span class="subtle">${esc(m.gate.message)}</span></p>
<p class="subtle" style="margin:8px 0 0">Service revenue share needs onboarding fees, which Delomu does not record, so it is not shown. Hours come from what engineers log on each agent’s Rollout page.</p></div></section>
<section class="panel">${m.deployments.length ? `<div class="scroll"><table><thead><tr><th>#</th><th>AI agent</th><th>Started</th><th>Engineer hours</th><th class="hide-sm">Steps drafted by the agent</th><th class="hide-sm">Days to live</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : '<div class="emptystate"><span class="strong">No deployments yet</span>Metrics appear once an AI agent is added.</div>'}</section>`;
  return layout({ title: 'Deployment metrics', user, csrf, nav: { ...nav, org, active: org.kind === 'partner' ? 'clients' : 'deployments' }, crumbs: [[org.kind === 'partner' ? 'Clients' : 'AI agents', orgPath(org)], ['Metrics']], body });
}

// The whole rollout on one page: Run the rollout (the agent drafts steps 1-3 and the check runs), the six steps
// with where each stands, and the one next action. rollout: the in-memory job from web.mjs, if one ran.
const HOUR_STEPS = [['1-mapping', 'Data mapping'], ['2-integration', 'Integration'], ['3-test-set', 'Test set'], ['4-test-and-fix', 'Test and fix'], ['5-launch-report', 'Launch report'], ['6-monitoring', 'Monitoring']];
const ROLLOUT_STATE = { done: ['good', 'Done'], running: ['accent', 'Running'], waiting: ['', 'Waiting'], skipped: ['warn', 'Skipped'], failed: ['bad', 'Failed'] };
const STEP_STATE = { done: ['good', 'Done'], review: ['accent', 'Draft to review'], attention: ['bad', 'Needs work'], todo: ['', 'Not started'] };

// Client sign-off on the Rollout page: the latest decision, a link to send (shown once, right after it is made)
// and a way to revoke the links still open.
function signoffPanel({ base, csrf, can, signoff, scan }) {
  const { latest, active = 0, link } = signoff;
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
  const state = latest
    ? `<span class="badge ${latest.decision === 'accepted' ? 'good' : 'bad'}">${latest.decision === 'accepted' ? 'Accepted' : 'Sent back'}</span> by ${esc(latest.name)} on ${esc(latest.at.slice(0, 10))}${latest.note ? ` <span class="subtle">“${esc(latest.note)}”</span>` : ''}`
    : '<span class="subtle">Not signed off yet.</span>';
  const made = link ? `<label class="field" style="margin-top:12px"><span>Send this link to the client</span><input type="text" readonly class="mono" value="${esc(link)}"><p class="hint">Shown only once. It opens the check from ${esc(scan?.createdAt.slice(0, 10) ?? '')} without an account and expires in 30 days.</p></label>` : '';
  const actions = can.write ? `<div class="row-inline" style="margin-top:12px">${scan ? `<form method="post" action="${esc(base)}/signoff/link">${hidden}<button class="btn${latest ? '' : ' primary'}" data-busy="Creating…">${icon('arrow')}Create a sign-off link</button></form>` : '<span class="subtle">Run the policy check first: the client signs off on a check.</span>'}
${active ? `<form method="post" action="${esc(base)}/signoff/revoke">${hidden}<button class="btn ghost" data-busy="Revoking…">Revoke ${active} open link${active === 1 ? '' : 's'}</button></form>` : ''}</div>` : '';
  return `<section class="panel"><div class="panel-head"><h2>Client sign-off</h2></div><div class="panel-body"><p style="margin:0">${state}</p>${made}${actions}</div></section>`;
}

export function rolloutPage(args) {
  const { org, name, ov, csrf, can, rollout, signoff = {} } = args;
  const base = depPath(org, name);
  const badge = ([cls, text]) => `<span class="badge ${cls}${cls === 'accent' ? ' plain' : ''}">${esc(text)}</span>`;
  const running = rollout?.status === 'running';
  const start = can.write ? `<form method="post" action="${esc(base)}/rollout"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="btn primary"${running ? ' disabled aria-busy="true"' : ''} data-busy="Starting…">${icon('spark')}${running ? 'Rollout running…' : rollout ? 'Run the rollout again' : 'Run the rollout'}</button></form>` : '';
  const job = rollout ? `<div class="rows">${rollout.steps.map(s => `<div class="row">${icon(s.state === 'done' ? 'check' : s.state === 'failed' ? 'alert' : 'clock')}<div class="what"><p class="strong">${esc(s.label)}</p>${s.detail ? `<p class="subtle">${esc(s.detail)}</p>` : ''}</div>${badge(ROLLOUT_STATE[s.state] ?? ['', s.state])}</div>`).join('')}</div>` : '';
  const steps = `<div class="rows">${ov.steps.map((s, i) => `<div class="row"><span class="num subtle" style="width:18px">${i + 1}</span><div class="what"><p class="strong">${esc(s.label)}</p><p class="subtle">${esc(s.detail)}</p></div>${badge(STEP_STATE[s.state] ?? ['', s.state])}</div>`).join('')}</div>`;
  const next = ov.pending.length ? `<a class="btn" href="${esc(base)}/drafts">${icon('inbox')}Review ${ov.pending.length} draft${ov.pending.length === 1 ? '' : 's'}</a>` : '';
  const body = `${signoffPanel({ base, csrf, can, signoff, scan: ov.scans[0] })}<section class="panel"><div class="panel-head"><h2>Run the whole rollout</h2><span style="flex:1"></span>${start}</div>
<p class="panel-body subtle" style="margin:0">The agent drafts the data mapping, the integration and the test set from this client’s material, then the policy check runs. Every draft waits for a person to approve, edit or reject it; nothing changes until then. Fixes and the launch report come after the first test run.</p>
${job}</section>
<section class="panel"><div class="panel-head"><h2>The six steps</h2><span style="flex:1"></span>${next}</div>${steps}
<p class="panel-body" style="margin:0"><span class="strong">Next:</span> ${esc(ov.next.text)}</p></section>
${can.write ? `<form method="post" action="${esc(base)}/hours" class="panel" novalidate><div class="panel-head"><h2>Log engineer hours</h2><span class="aside subtle">They feed Deployment metrics: is each rollout cheaper than the last?</span></div><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}"><div class="row-inline">
<label class="field"><span>Step</span><select name="step">${HOUR_STEPS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
<label class="field"><span>Hours</span><input type="number" name="hours" min="0.25" max="200" step="0.25" required style="max-width:110px"></label>
<label class="field" style="flex:1"><span>Note <span class="subtle" style="font-weight:400">(optional)</span></span><input type="text" name="note" maxlength="200"></label></div>
<button class="btn" data-busy="Saving…">${icon('clock')}Log hours</button></div></form>` : ''}`;
  return deploymentShell({ ...args, tab: 'rollout', title: 'Rollout' }, body);
}

export function runsPage(args) {
  const { org, name, ov, now } = args;
  const base = depPath(org, name);
  const runs = [...ov.runs].reverse();
  const body = runs.length ? `<section class="panel"><div class="scroll"><table><thead><tr><th>Run</th><th>Result</th><th>Passed</th><th class="hide-sm">Failed</th><th class="hide-sm">Graded by</th><th></th></tr></thead><tbody>
${runs.map(r => `<tr><td><span class="strong">Run ${r.number}</span><div class="subtle">${esc(fmtDate(r.generatedAt))} · ${esc(ago(r.generatedAt, now))}</div></td>
<td>${verdictBadge(r.summary.verdict)}</td><td class="num">${r.summary.pass}/${r.summary.total} <span class="subtle">(${esc(pct(r.summary.passRate))})</span></td>
<td class="num hide-sm">${r.summary.fail + r.summary.error}</td><td class="hide-sm muted">${esc(r.judge === 'off' ? 'Rules only' : r.judge)}</td>
<td style="text-align:right"><a href="${esc(base)}/runs/${esc(encodeURIComponent(r.runId))}/report.html">Report</a></td></tr>`).join('\n')}
</tbody></table></div></section>` : `<section class="panel"><div class="emptystate"><span class="strong">No runs yet</span>Run the saved test set from the More menu.</div></section>`;
  return deploymentShell({ ...args, tab: 'runs', title: 'Runs' }, body);
}

export function draftsPage(args) {
  const { org, name, ov, csrf, can, now } = args;
  const when = iso => ago(iso, now);
  const base = depPath(org, name);
  const pending = ov.drafts.filter(d => d.status === 'pending');
  const done = ov.drafts.filter(d => d.status !== 'pending').sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)));
  const body = `<p class="muted" style="margin-bottom:16px">The agent proposes; a person approves, edits or rejects. Nothing changes until a draft is approved, and every decision goes into the audit log.</p>
${pending.length ? `<div class="stack">${pending.map(d => draftCard(d, { action: `${base}/drafts/${encodeURIComponent(d.id)}/review`, csrf, canReview: can.review, when })).join('')}</div>`
    : `<section class="panel"><div class="emptystate"><span class="strong">Nothing waiting for review</span>${can.write ? 'Ask the agent to draft one from the More menu.' : 'New drafts from the agent appear here.'}</div></section>`}
${done.length ? `<h2 style="margin:32px 0 12px">Decided</h2><section class="panel">${done.map(d => reviewedRow(d, { when })).join('')}</section>` : ''}`;
  return deploymentShell({ ...args, tab: 'drafts', title: 'Review' }, body);
}

const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function inputsPage(args) {
  const { org, name, ov, csrf, can, now } = args;
  const base = depPath(org, name);
  const files = ov.inputs.length ? `<table><thead><tr><th>File</th><th>Size</th><th class="hide-sm">Added</th></tr></thead><tbody>
${ov.inputs.map(f => `<tr><td><span style="display:inline-flex;gap:8px;align-items:center">${icon('file')}${esc(f.name)}</span></td><td class="num muted nowrap">${esc(size(f.size))}</td><td class="hide-sm subtle">${esc(ago(f.modified, now))}</td></tr>`).join('')}
</tbody></table>` : `<div class="emptystate"><span class="strong">No policies yet</span>Add the documents your AI must follow: refund, cancellation and privacy policies, help-center articles. A ticket export named tickets.csv lets you send sample traffic.</div>`;
  const upload = can.write ? `<form method="post" action="${esc(base)}/inputs" enctype="multipart/form-data" class="panel" style="margin-top:16px" novalidate><div class="panel-head"><h2>Add files</h2></div><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="picker"><span class="sr">Files</span><input type="file" id="files" name="files" multiple required accept=".md,.txt,.csv,.json,.yaml,.yml,.html"><span class="btn" aria-hidden="true">${icon('file')}Choose files</span><span class="names" data-files-for="files" aria-live="polite">No file chosen</span></label>
<p class="hint" style="margin:-8px 0 14px">Markdown, text, CSV, JSON, YAML or HTML, up to 1 MB each. A file with the same name is replaced.</p>
<button class="btn primary" data-busy="Uploading…">${icon('upload')}Upload</button></div></form>` : '';
  return deploymentShell({ ...args, tab: 'inputs', title: 'Policies' }, `<section class="panel">${files}</section>${upload}`);
}

export function settingsPage(args) {
  const { config } = args;
  const t = config.target ?? {};
  const rows = [
    ['Customer', config.customer], ['Connection', CONNECTIONS.find(c => c.type === (t.preset ?? t.type))?.label ?? t.type], ['Model', t.preset === 'openai' ? t.body?.model : undefined],
    ['URL', t.url ?? t.baseUrl], ['Command', t.command], ['Zendesk subdomain', t.subdomain], ['App ID', t.appId],
    ['Test contact', t.contactExternalId], ['Credentials', [t.token, t.keyId, t.secret].filter(s => /^\$\{[A-Za-z0-9_]+\}$/.test(s ?? '')).join(', ')], ['Answer at', t.output], ['Timeout', t.timeoutMs ? `${t.timeoutMs / 1000} s` : undefined],
    ['Required pass rate', pct(config.acceptance?.minPassRate ?? 0.9)],
  ].filter(([, v]) => v);
  const headers = Object.entries(t.headers ?? {});
  const decisions = config.decisions ?? [];
  const v = args.verified ?? {};
  const hidden = state => `<input type="hidden" name="csrf" value="${esc(args.csrf)}"><input type="hidden" name="state" value="${state}">`;
  const publicPanel = `<section class="panel"><div class="panel-head"><h2>Public page</h2><span class="badge ${v.on ? 'good' : 'plain'}">${v.on ? 'On' : 'Off'}</span></div><div class="panel-body">
<p class="subtle" style="margin:0">A page anyone with the link can open: the date and result of the latest check, live monitoring in the last 7 days, and whether the audit log is intact. No score and no certification.</p>
${v.link ? `<label class="field" style="margin-top:12px"><span>Public link</span><input type="text" readonly class="mono" value="${esc(v.link)}"><p class="hint">Shown only once. Turning the page off and on again makes a new link.</p></label>` : ''}
${v.canManage ? `<form method="post" action="${esc(depPath(args.org, args.name))}/verified" style="margin-top:12px">${hidden(v.on ? 'off' : 'on')}<button class="btn" data-busy="Saving…">${v.on ? 'Turn off' : 'Turn on and get a link'}</button></form>` : '<p class="subtle" style="margin:8px 0 0">An owner or admin can turn it on.</p>'}</div></section>`;
  return deploymentShell({ ...args, tab: 'settings', title: 'Settings' }, `${publicPanel}<section class="panel"><div class="panel-head"><h2>Connection and acceptance</h2></div>
<div class="draft-body"><table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
${headers.map(([k, v]) => `<tr><th scope="row">Header <code>${esc(k)}</code></th><td><code>${esc(v)}</code></td></tr>`).join('')}</tbody></table></div></section>
<section class="panel"><div class="panel-head"><h2>Decisions</h2><span class="aside subtle">Shown in every acceptance report</span></div>
${decisions.length ? `<table><thead><tr><th>Date</th><th>Decision</th><th>Why</th></tr></thead><tbody>${decisions.map(d => `<tr><td class="num nowrap">${esc(d.date)}</td><td>${esc(d.decision)}</td><td class="muted">${esc(d.reason)}</td></tr>`).join('')}</tbody></table>` : '<p class="panel-body subtle">No decisions recorded.</p>'}</section>`);
}

export function auditPage({ user, csrf, nav, now, org, events, audits }) {
  const actor = a => (a === 'agent' ? '<span class="who-chip agent">Agent</span>' : a === 'system' ? '<span class="who-chip">System</span>' : esc(a.replace(/^human:/, '')));
  return layout({ title: `Audit · ${org.name}`, user, csrf, nav: { ...nav, org, active: 'audit' }, crumbs: [[org.name, orgPath(org)], ['Audit log']], body: `
<div class="page-head"><div><h1>Audit log</h1><p class="sub">Every sign-in, run and decision. Export as CSV from <code>GET /v1/orgs/${esc(org.id)}/audit_events.csv</code>.</p></div></div>
<section class="panel"><div class="panel-head"><h2>AI agent records</h2><span class="aside subtle">Each record is hash-chained; an edit breaks the chain</span></div>
${audits.length ? `<table><thead><tr><th>Deployment</th><th>Entries</th><th>Integrity</th></tr></thead><tbody>
${audits.map(a => `<tr><td class="strong">${esc(a.name)}</td><td class="num">${a.entries.length}</td><td>${a.verify.ok ? '<span class="badge good">Intact</span>' : `<span class="badge bad">Broken at entry ${esc(a.verify.brokenAt)}</span> <span class="muted">${esc(a.verify.reason)}</span>`}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="panel-body subtle">No AI agents.</p>'}</section>
<section class="panel"><div class="panel-head"><h2>Organization events</h2><span class="aside subtle num">Latest ${events.length}</span></div>
<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th class="hide-sm">IP</th></tr></thead><tbody>
${events.map(e => `<tr><td class="nowrap"><span title="${esc(fmtDate(e.ts))}">${esc(ago(e.ts, now))}</span></td><td>${actor(e.actor)}</td><td>${esc(e.action.replace(/[._]/g, ' '))}</td><td class="muted">${esc(e.target)}</td><td class="hide-sm subtle mono">${esc(e.ip)}</td></tr>`).join('\n')}
</tbody></table></div></section>` });
}

const SEVERITY = { high: ['bad', 'High risk'], medium: ['warn', 'Medium risk'], low: ['plain', 'Low risk'] };

export function riskScanPage(args) {
  const { org, name, ov, csrf, can, now } = args;
  const base = depPath(org, name);
  const scan = ov.scans[0];
  const shell = (body, refresh) => deploymentShell({ ...args, tab: 'scan', title: 'Check results', refresh }, body);
  if (args.job) {
    const p = args.job.progress ?? {};
    const secs = Math.max(0, Math.round(((now?.getTime?.() ?? Date.now()) - args.job.startedAt) / 1000));
    // Step 1 (reading the policies, usually 20-40 s) has no count to report, so it fills the first 40% with
    // elapsed time, easing toward 40% without passing it; step 2 fills the rest as answers are judged. The page
    // reloads every 2 s, so the bar only ever moves forward.
    const probing = p.phase === 'probes' && p.total;
    const pctDone = probing ? Math.round(40 + 60 * p.done / p.total) : Math.round(40 * (1 - Math.exp(-secs / 25)));
    const slow = !probing && secs > 45 ? ' · Taking longer than usual; still working' : '';
    const what = probing
      ? `Step 2 of 2 · Sending ${p.total} test messages for ${p.rules} rules to your AI and judging each answer · ${p.done} of ${p.total} done`
      : `Step 1 of 2 · Reading your policies and writing the customer messages most likely to break each rule${slow}`;
    return shell(`<section class="panel scan-live" aria-live="polite">
<p class="big">Checking… <span class="subtle num" style="font-weight:400">${secs} s</span></p><div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><i style="width:${Math.max(2, pctDone)}%"></i></div>
<p class="muted num">${esc(what)}</p><p class="subtle" style="margin-top:6px">You can leave this page; the check keeps running and the results appear here.</p></section>`, 2);
  }
  if (!scan) {
    return shell(`<section class="panel"><div class="emptystate" style="padding:48px 16px">
<span class="strong" style="font-size:16px;letter-spacing:-0.01em">Find the rules your AI breaks, before customers do</span>
<p style="max-width:58ch;margin:8px auto 20px">Delomu reads your policies, writes the customer messages most likely to make your AI break each rule, sends them to it and checks every answer against the exact clause.</p>
${ov.inputs.length ? (can.write ? `<form method="post" action="${esc(base)}/scan"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn primary" data-busy="Starting…">${icon('shield')}Run check</button></form>` : '') : `<a class="btn primary" href="${esc(base)}/inputs">${icon('upload')}Add your policies first</a>`}</div></section>`);
  }
  const s = scan.summary;
  const order = { high: 0, medium: 1, low: 2 };
  // A rule is broken if any answer broke it; it needs a person when no answer broke it but some answer could
  // not be judged (no reply from the AI, or no verdict); only then is it kept.
  const isBroken = r => r.probes.some(p => p.status === 'broken');
  const isUnsure = r => !isBroken(r) && r.probes.some(p => p.status === 'unjudged' || p.status === 'error');
  const broken = scan.rules.filter(isBroken).sort((a, b) => order[a.severity] - order[b.severity]);
  const unsure = scan.rules.filter(isUnsure);
  const kept = scan.rules.filter(r => !isBroken(r) && !isUnsure(r));
  const exchange = p => `<div class="probe ${esc(p.status)}">
<div><p class="cap">Customer wrote <span class="tactic">${esc(p.tactic)}</span></p><div class="bubble">${esc(p.message)}</div></div>
<div><p class="cap">Your AI replied</p><div class="bubble ai">${esc(p.answer || '—')}</div></div>
<p class="verdict-line">${p.status === 'kept' ? '<span class="badge good">Kept</span>' : p.status === 'broken' ? '<span class="badge bad">Broken</span>' : '<span class="badge warn">Check</span>'}
<span><span>${esc(p.what_happened)}</span>${p.fix ? `<br><span class="fix"><span class="strong">Fix</span> ${esc(p.fix)}</span>` : ''}</span></p></div>`;
  const ruleCard = rule => {
    const bad = rule.probes.filter(p => p.status !== 'kept');
    const ok = rule.probes.filter(p => p.status === 'kept');
    const [cls, label] = SEVERITY[rule.severity] ?? SEVERITY.medium;
    return `<section class="panel"><div class="rule-head">
<div class="what"><div class="rule-title">${icon('alert')}<h3>${esc(rule.rule)}</h3></div>
<p class="clause"><cite>${esc(rule.clause)}</cite>“${esc(rule.quote)}”</p>
<p class="harm"><b>Risk with a real customer:</b> ${esc(rule.harm)}</p></div>
<div class="tags"><span class="badge ${cls}">${esc(label)}</span><span class="subtle num" style="font-size:12.5px">${bad.some(p => p.status === 'broken') ? `Broken in ${bad.filter(p => p.status === 'broken').length} of ${rule.probes.length}` : `${bad.length} of ${rule.probes.length} need review`}</span></div></div>
${bad.map(exchange).join('')}
${ok.length ? `<details class="kept"><summary>${ok.length} other message${ok.length === 1 ? '' : 's'} handled correctly</summary>${ok.map(exchange).join('')}</details>` : ''}</section>`;
  };
  const draft = scan.draftId && ov.drafts.find(d => d.id === scan.draftId);
  // Before and after: a re-check runs the earlier check's exact messages again after a fix.
  const before = scan.recheckOf ? ov.scans.find(x => x.id === scan.recheckOf) : null;
  const compare = before ? `<p class="meta num" style="color:var(--text)"><span class="strong">${args.fix?.status === 'reverted' ? 'After undoing the fix' : 'After the fix'}:</span> ${before.summary.broken} → ${s.broken} rules broken, ${before.summary.failed} → ${s.failed} messages failed, on the same ${s.probes} messages.</p>` : '';
  const worse = before && (s.broken > before.summary.broken || s.failed > before.summary.failed);
  const applied = args.fix?.scanId === scan.recheckOf && args.fix?.status === 'applied';
  const worseNotice = !worse ? '' : `<div class="notice" style="margin-top:16px">${icon('alert')}<span>The fix made it worse on the same messages. ${applied && can.write ? 'Undo it to put back the instructions from before, then check again.' : 'Undo the change in your help desk, then check again.'}
${applied && can.write ? `<form method="post" action="${esc(base)}/fix/revert" style="margin-top:8px"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn sm" data-busy="Undoing…">Undo the fix and re-check</button></form>` : ''}</span></div>`;
  const gaps = list => (list?.length ? `<div><p class="strong" style="font-size:13px">Needs a change outside the instructions</p><ul class="plain" style="margin-top:6px">${list.map(g => `<li><span class="subtle">${esc(g.clause)}</span> ${esc(g.need)}</li>`).join('')}</ul></div>` : '');
  const fix = args.fix?.scanId === scan.id ? args.fix : null;
  const target = args.fixTarget ?? { canApply: false };
  const fixPanel = !broken.length || !can.write ? '' : !fix || fix.status !== 'proposed'
    ? `<section class="panel fixit"><div class="panel-body"><div><h2>Fix it</h2>
<p class="muted" style="margin-top:4px">The agent drafts one change to your AI's instructions covering the ${broken.length} broken rule${broken.length === 1 ? '' : 's'}. Nothing changes until you approve it; then the same ${s.probes} messages run again.</p></div>
<form method="post" action="${esc(base)}/fix/draft"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn primary" data-busy="Drafting… about 20 s">${icon('spark')}Draft a fix</button></form></div></section>`
    : `<section class="panel fixit"><form method="post" action="${esc(base)}/fix/approve" class="panel-body stack" style="gap:12px" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<div><h2>Proposed fix</h2><p class="muted" style="margin-top:4px">${esc(fix.summary)}</p></div>
${gaps(fix.gaps)}
<label class="field" style="margin:0"><span>Extra instructions for your AI <span class="subtle" style="font-weight:400">(edit before approving)</span></span><textarea name="instructions" maxlength="4000" style="min-height:180px;font:13.5px/1.55 var(--font)">${esc(fix.instructions)}</textarea>
<p class="hint">${target.canApply ? 'Delomu sends these with every message to this AI, so approving applies them right away.' : 'Delomu cannot change this AI directly. Paste these into its instructions (Intercom Fin: Fin, then Guidance; Zendesk: the AI agent\'s instructions), then re-check.'}</p></label>
<div class="row-inline" style="gap:8px;flex-wrap:wrap">${target.canApply ? `<button class="btn primary" name="mode" value="apply" data-busy="Applying…">${icon('check')}Approve, apply and re-check</button>` : `<button class="btn primary" name="mode" value="manual" data-busy="Starting…">${icon('check')}I applied it, re-check</button>`}</div></form></section>`;
  const verdict = s.broken
    ? `<p class="verdict bad num"><b>${s.broken}</b> <span class="of">of ${s.rules}</span> policy rules broken</p>`
    : unsure.length
      ? `<p class="verdict warn num"><b>${unsure.length}</b> <span class="of">of ${s.rules}</span> rules could not be checked</p>`
      : `<p class="verdict good num"><b>All ${s.rules}</b> policy rules kept</p>`;
  return shell(`<section class="panel scan-head">
<div>${verdict}
<p class="meta num">${s.failed} of ${s.probes} test messages broke a rule${s.highRiskBroken ? ` · ${s.highRiskBroken} high-risk` : ''}${s.unjudged ? ` · ${s.unjudged} could not be judged` : ''} · ${esc(ago(scan.createdAt, now))} · ${scan.seconds} s</p>
${compare}<p class="subtle" style="margin-top:4px;font-size:12.5px">Read from ${scan.documents.map(d => esc(d)).join(', ')} · judged by ${esc(scan.model)}</p></div><a class="btn" style="margin-left:auto" href="${esc(base)}/scan/report.html" target="_blank" rel="noopener">${icon('file')}Customer report</a><a class="btn" href="${esc(base)}/evidence.html" target="_blank" rel="noopener">${icon('file')}Evidence pack</a></section>
${draft && draft.status === 'pending' ? `<div class="notice good" style="margin-top:16px">${icon('inbox')}<span>These ${draft.content.rows.length} test messages are drafted into your saved test set, so every rule stays tested after you fix the AI. <a href="${esc(base)}/drafts">Review the draft</a></span></div>` : ''}
${worseNotice}
${fixPanel ? `<div style="margin-top:16px">${fixPanel}</div>` : ''}
${broken.length ? `<h2 style="margin:28px 0 12px">Broken rules</h2><div class="stack">${broken.map(ruleCard).join('')}</div>` : ''}
${unsure.length ? `<h2 style="margin:28px 0 4px">Needs a person to check</h2><p class="muted" style="margin-bottom:12px">Your AI gave no answer, or the judge gave no verdict. These rules are not counted as kept.</p><div class="stack">${unsure.map(ruleCard).join('')}</div>` : ''}
${kept.length ? `<h2 style="margin:28px 0 12px">Kept</h2><section class="panel"><ul class="rulelist">${kept.map(r => `<li>${icon('check')}<span>${esc(r.rule)}</span><span class="c">${esc(r.clause)} · ${r.probes.length} message${r.probes.length === 1 ? '' : 's'}</span></li>`).join('')}</ul></section>` : ''}`);
}

// Live monitoring: what the AI did with real customers in the last 7 days, against the policy rules.
export function livePage(args) {
  const { org, name, ov, csrf, can, now, settings, apiBase, job, draft } = args;
  const base = depPath(org, name);
  const live = ov.live;
  const scan = ov.scans[0];
  const hasTickets = ov.inputs.some(f => f.name.toLowerCase() === 'tickets.csv');
  const shell = body => deploymentShell({ ...args, tab: 'live', title: 'Live', refresh: job ? 2 : undefined }, body);
  if (!scan) {
    return shell(`<section class="panel"><div class="emptystate" style="padding:40px 16px"><span class="strong" style="font-size:15px">Watch every real conversation after launch</span>
<p style="max-width:60ch;margin:6px auto 18px">Live monitoring checks each answer your AI gives real customers against the rules the check found, and alerts you when a high-risk rule breaks.</p>
<a class="btn primary" href="${esc(base)}/scan">${icon('shield')}Run the check first</a></div></section>`);
  }
  if (job) {
    const pctDone = Math.round(100 * job.done / job.total);
    return shell(`<section class="panel scan-live" aria-live="polite"><p class="big">Sending sample traffic…</p>
<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><i style="width:${Math.max(4, pctDone)}%"></i></div>
<p class="muted num">Asking your AI each ticket from your export and judging the answer · ${job.done} of ${job.total} done</p>
<p class="subtle" style="margin-top:6px">You can leave this page; the results appear here.</p></section>`);
  }
  const w = live.week;
  const rate = w.checked ? Math.round(100 * w.flagged / w.checked) : 0;
  const n = x => x.toLocaleString('en-US');
  const replay = can.live && hasTickets ? `<form method="post" action="${esc(base)}/live/replay" style="margin:0 0 0 12px"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="btn sm${w.checked ? '' : ' primary'}" data-busy="Starting…">${icon('play')}Send sample traffic</button></form>` : '';
  const bars = live.rules.length ? `<ul class="rulebars">${live.rules.map(r => `<li><span><span class="strong">${esc(r.text)}</span> <span class="subtle">${esc(r.clause)}</span></span>
<span class="bar"><i class="${esc(r.severity)}" style="width:${Math.max(6, Math.round(100 * r.count / Math.max(1, w.flagged)))}%"></i></span><span class="num subtle" style="text-align:right">${r.count}</span></li>`).join('')}</ul>`
    : `<p class="panel-body subtle">${w.checked ? 'Every checked answer kept every rule.' : 'No conversations yet. Connect the help desk, or send sample traffic.'}</p>`;
  const stats = `<section class="panel"><div class="panel-head"><h2>Last 7 days</h2><span class="aside subtle num">${n(live.checkedThisMonth)} checked this month</span>${replay}</div>
<div class="stats"><div><p class="v num">${n(w.checked)}</p><p class="k">Conversations checked</p></div>
<div><p class="v num${w.flagged ? ' bad' : ''}">${n(w.flagged)}</p><p class="k">Broke a rule${w.checked ? ` · ${w.flagged && rate === 0 ? '<1' : rate}%` : ''}</p></div>
<div><p class="v num${live.rules.length ? ' bad' : ''}">${live.rules.length} <span class="subtle" style="font-size:15px;font-weight:400">of ${scan.rules.length}</span></p><p class="k">Policy rules broken</p></div></div>
${bars}</section>`;
  const badge = c => (c.status === 'flagged' ? '<span class="badge bad">Broke a rule</span>' : c.status === 'ok' ? '<span class="badge good">Kept</span>' : '<span class="badge warn">Check</span>');
  const why = c => (c.violations.length ? `<div class="why">${c.violations.map(v => `<p><span class="badge ${esc((SEVERITY[v.severity] ?? SEVERITY.medium)[0])}">${esc(v.clause)}</span> ${esc(v.what_happened)}<br><span class="fix"><span class="strong">Fix</span> ${esc(v.fix)}</span></p>`).join('')}</div>`
    : c.status === 'unjudged' ? '<p class="subtle" style="margin-top:8px">The judge gave no verdict; a person should read this one.</p>' : '');
  const convo = c => `<div class="convo ${esc(c.status)}"><p class="meta-line">${badge(c)}<span title="${esc(fmtDate(c.at))}">${esc(ago(c.at, now))}</span><span>· ${esc(c.source)}</span>${c.externalId ? `<span class="mono">· ${esc(c.externalId)}</span>` : ''}</p>
<div class="probe"><div><p class="cap">Customer</p><div class="bubble">${esc(c.message)}</div></div><div><p class="cap">Your AI</p><div class="bubble ai">${esc(c.answer)}</div></div></div>${why(c)}</div>`;
  const recent = [...live.recent].sort((a, b) => (b.status === 'flagged') - (a.status === 'flagged')).slice(0, 20);
  const feed = recent.length ? `<section class="panel"><div class="panel-head"><h2>Conversations</h2><span class="aside subtle">Rule breaks first · newest 20</span></div>${recent.map(convo).join('')}</section>` : '';
  const curl = `curl -X POST ${apiBase}/conversations \\\n  -H "Authorization: Bearer $DELOMU_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Can I get a refund after 45 days?", "answer": "…", "id": "ticket-123"}'`;
  const guardCurl = `curl -X POST ${apiBase}/guard \\\n  -H "Authorization: Bearer $DELOMU_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Can I get a refund after 45 days?", "reply": "…"}'`;
  const connect = `<section class="panel"><div class="panel-head"><h2>Connect the help desk</h2></div><div class="panel-body">
<p class="muted" style="margin-bottom:10px">Send each finished exchange from Intercom, Zendesk or your own code. Emails, phone numbers, card numbers and keys are removed before anything is stored or judged.</p>
<pre class="snippet">${esc(curl)}</pre><p class="subtle" style="margin-top:8px">Use an API key with the <code>conversations:write</code> scope. Each check counts toward the plan’s live conversations.</p>
<p class="muted" style="margin:14px 0 10px">Or check each reply <span class="strong">before</span> the customer sees it, and send <code>safeReply</code> when the decision is <code>rewrite</code>:</p>
<pre class="snippet">${esc(guardCurl)}</pre><p class="subtle" style="margin-top:8px">Needs the <code>guard:check</code> scope. Returns <code>allow</code>, <code>block</code> or <code>rewrite</code>; if the check cannot run it returns <code>allow</code> with <code>unjudged: true</code>.</p></div></section>`;
  const area = (field, label, h) => `<label class="field"><span>${label}</span><textarea name="${field}" required maxlength="4000" style="min-height:${h}px;font:14px/1.5 var(--font)">${esc(draft?.[field] ?? '')}</textarea></label>`;
  const check = can.live ? `<section class="panel"><div class="panel-head"><h2>Check one conversation</h2></div><form method="post" action="${esc(base)}/live/check" class="panel-body stack" style="gap:10px" novalidate>
<input type="hidden" name="csrf" value="${esc(csrf)}">${area('message', 'Customer message', 64)}${area('answer', 'The AI’s answer', 88)}
<div><button class="btn" data-busy="Checking…">${icon('pulse')}Check against the rules</button></div></form></section>` : '';
  const alerts = can.write ? `<section class="panel"><div class="panel-head"><h2>Alerts</h2>${settings.webhook ? '<span class="badge good">On</span>' : '<span class="badge plain">Off</span>'}</div>
<form method="post" action="${esc(base)}/live/settings" class="panel-body stack" style="gap:10px" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Slack or Teams webhook</span><input type="url" name="webhook" value="${esc(settings.webhook)}" placeholder="https://hooks.slack.com/services/…"><p class="hint">Posts when a high-risk rule breaks, at most once an hour per rule.</p></label>
<div><button class="btn">Save</button></div></form></section>` : '';
  return shell(`<div class="grid-2"><div class="stack">${stats}${feed}</div>
<div class="stack">${connect}${check}${alerts}</div></div>`);
}

const usd = n => `$${Number(n).toLocaleString('en-US')}`;
const limitText = n => (n === null ? 'Unlimited' : Number(n).toLocaleString('en-US'));

// The org's plan, this month's usage against its limits, upgrade and manage actions, and the plans side
// by side. billing: summary() from billing.mjs.
export function billingPage({ user, csrf, nav, org, billing: b, salesContact, flash, error }) {
  const { plan, account } = b;
  const base = `${orgPath(org)}/billing`;
  const form = (action, label, primary) => `<form method="post" action="${esc(base)}/${action}" style="margin:0"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="btn${primary ? ' primary' : ''}" data-busy="Opening Stripe…">${icon(primary ? 'arrow' : 'card')}${esc(label)}</button></form>`;
  const actions = b.configured ? [
    plan.id === 'free' ? form('checkout', 'Upgrade to Team', true) : '',
    account?.stripe_customer_id ? form('portal', 'Manage billing', false) : '',
  ].join('') : '';
  const statusBadge = plan.id === 'free' ? '<span class="badge plain">Free</span>'
    : account?.status === 'past_due' ? `<span class="badge bad">${esc(plan.name)} · payment failed</span>`
      : `<span class="badge good">${esc(plan.name)}</span>`;
  const sub = [org.name, b.configured ? (b.live ? '' : 'Stripe test mode') : 'Billing not configured'].filter(Boolean).join(' · ');

  const warnings = [];
  if (account?.status === 'past_due') warnings.push(notice('The last payment failed. Team stays on while Stripe retries; update the card in Manage billing.'));
  if (plan.id === 'team' && account?.cancel_at_period_end && account.current_period_end) {
    warnings.push(notice(`Team ends on ${fmtDate(account.current_period_end).replace(/,.*$/, '')}; after that this organization moves to Free.`));
  }

  const notConfigured = b.configured ? '' : `<section class="panel"><div class="emptystate"><span class="strong">Billing is not configured on this server</span>
Every organization is on the Free plan. The operator turns on paid plans by setting <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, <code>STRIPE_PRICE_TEAM</code> and <code>STRIPE_PRICE_EXTRA</code>, or grants Vendor or Enterprise with <code>delomu admin plan</code>.</div></section>`;

  // Colour carries state: green within the plan, amber billed as extra (Team), red at a hard limit (Free).
  const usageRow = (label, used, limit, overage, detail) => {
    let badge = '<span class="badge plain">Unlimited</span>';
    if (limit !== null) {
      if (used < limit) badge = '<span class="badge good">Within plan</span>';
      else if (overage && used > limit) badge = '<span class="badge warn">Extra, billed</span>';
      else if (overage) badge = '<span class="badge good">All included used</span>';
      else badge = '<span class="badge bad">Limit reached</span>';
    }
    return `<tr><th scope="row">${esc(label)}</th><td class="num"><span class="strong">${Number(used).toLocaleString('en-US')}</span> <span class="subtle">of ${esc(limitText(limit))}</span></td><td>${badge}</td><td class="hide-sm muted">${esc(detail)}</td></tr>`;
  };
  const extraNote = b.extra ? ` · ${b.extra} extra × ${usd(plan.extraActiveDeploymentUsd)} = ${usd(b.extraUsd)} on the next invoice` : '';
  const usage = `<section class="panel"><div class="panel-head"><h2>This month</h2><span class="aside subtle num">${esc(b.month)} (UTC)</span></div>
<div class="scroll"><table><thead><tr><th>Usage</th><th>Used</th><th>Status</th><th class="hide-sm">Detail</th></tr></thead><tbody>
${usageRow('Active AI agents', b.active.length, plan.includedActiveDeployments, plan.extraActiveDeploymentUsd !== null,
    b.active.length ? `${b.active.join(', ')}${extraNote}` : 'An AI agent is active once it has a test run this month.')}
${usageRow('Checks', b.scans, plan.scansPerMonth, false, 'Completed pre-launch checks this month, across all AI agents.')}
${usageRow('Live conversations', b.conversations ?? 0, plan.conversationsPerMonth ?? null, false, 'Real conversations checked by live monitoring this month.')}
</tbody></table></div></section>`;

  const cols = ['free', 'team', 'vendor', 'enterprise'].map(id => PLAN_VIEW[id]);
  const price = p => (p.monthlyUsd === null ? 'Contact sales' : p.monthlyUsd === 0 ? '$0' : `${usd(p.monthlyUsd)} / month`);
  const rows = [
    ['Price', price],
    ['Active AI agents a month', p => (p.includedActiveDeployments === null ? 'Unlimited' : `${p.includedActiveDeployments} included`)],
    ['Each extra active AI agent', p => (p.extraActiveDeploymentUsd !== null ? `${usd(p.extraActiveDeploymentUsd)} / month` : p.includedActiveDeployments === null ? 'Included' : 'Not available')],
    ['Checks a month', p => limitText(p.scansPerMonth)],
    ['Live conversations a month', p => (p.conversationsPerMonth === null ? 'Unlimited' : p.conversationsPerMonth.toLocaleString('en-US'))],
    ['How to get it', p => p.how],
  ];
  const sales = /^[^@\s]+@[^@\s]+$/.test(salesContact) ? `mailto:${salesContact}` : /^https?:\/\//i.test(salesContact) ? salesContact : '';
  const cta = p => {
    if (p.id === plan.id) return '<span class="badge accent">Current plan</span>';
    if (p.id === 'team' && plan.id === 'free' && b.configured) return form('checkout', 'Upgrade', true);
    if (p.id === 'enterprise' || p.id === 'vendor') return sales ? `<a class="btn" href="${esc(sales)}">Contact sales</a>` : '<span class="subtle">Ask your Delomu contact</span>';
    return '';
  };
  const pricing = `<section class="panel"><div class="panel-head"><h2>Plans</h2><span class="aside subtle">Prices in USD, billed monthly</span></div>
<div class="scroll"><table><thead><tr><th><span class="sr">Feature</span></th>${cols.map(p => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
${rows.map(([label, cell]) => `<tr><th scope="row" class="muted">${esc(label)}</th>${cols.map(p => `<td class="num">${esc(cell(p))}</td>`).join('')}</tr>`).join('\n')}
<tr><td></td>${cols.map(p => `<td>${cta(p)}</td>`).join('')}</tr>
</tbody></table></div></section>`;

  return layout({ title: `Billing · ${org.name}`, user, csrf, nav: { ...nav, org, active: 'billing' }, crumbs: [[org.name, orgPath(org)], ['Billing']], body: `
<div class="page-head"><div><div class="title"><h1>Billing</h1>${statusBadge}</div><p class="sub">${esc(sub)}</p></div>
${actions ? `<div class="actions">${actions}</div>` : ''}</div>
${notice(error)}${notice(flash, 'good')}${warnings.join('')}
<div class="stack">${notConfigured}${usage}${pricing}</div>` });
}
