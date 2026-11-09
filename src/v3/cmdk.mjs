// The command menu (Ctrl+K / Cmd+K), Grapim's version of Linear's: one list of places to go and things to do,
// scoped to the page you are on. On an AI agent's pages it leads with that agent's actions (run the check, create
// the sign-off link, open the evidence pack). Built on the server, so every entry is a real link or a real form
// with its CSRF token; the script only opens it, filters it and moves the selection. Without JavaScript the menu
// stays closed and every place is still reachable from the sidebar and tabs.

import { esc } from '../report.mjs';

// items: [{ group, label, href, post?: true, hint? }]
export function cmdkMarkup(items, csrf) {
  if (!items?.length) return '';
  const groups = [...new Set(items.map(i => i.group))];
  const row = (i, n) => i.post
    ? `<form method="post" action="${esc(i.href)}" class="cmdk-i" role="option" data-cmdk-item data-q="${esc(`${i.label} ${i.group}`.toLowerCase())}" id="cmdk-${n}"><input type="hidden" name="csrf" value="${esc(csrf ?? '')}"><button type="submit" tabindex="-1" data-busy="Starting…"><span>${esc(i.label)}</span>${i.hint ? `<span class="cmdk-h">${esc(i.hint)}</span>` : ''}</button></form>`
    : `<a class="cmdk-i" role="option" href="${esc(i.href)}" tabindex="-1" data-cmdk-item data-q="${esc(`${i.label} ${i.group}`.toLowerCase())}" id="cmdk-${n}"><span>${esc(i.label)}</span>${i.hint ? `<span class="cmdk-h">${esc(i.hint)}</span>` : ''}</a>`;
  let n = 0;
  return `<div class="cmdk" id="cmdk" role="dialog" aria-modal="true" aria-label="Command menu" hidden><div class="cmdk-box">
<input class="cmdk-q" type="text" placeholder="Go to, or run…" aria-label="Search commands" aria-controls="cmdk-list" autocomplete="off" spellcheck="false">
<div class="cmdk-list" id="cmdk-list" role="listbox">${groups.map(g => `<div class="cmdk-g" data-cmdk-group><p class="cmdk-gt">${esc(g)}</p>${items.filter(i => i.group === g).map(i => row(i, n++)).join('')}</div>`).join('')}
<p class="cmdk-none" hidden>No match.</p></div>
<p class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></p></div></div>`;
}

export const CMDK_STYLE = `.cmdk{position:fixed;inset:0;z-index:60;display:grid;place-items:start center;padding-top:14vh;background:color-mix(in srgb,var(--text) 18%,transparent)}
.cmdk[hidden],.cmdk [hidden]{display:none!important}.cmdk-box{width:min(620px,calc(100vw - 32px));border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:0 24px 60px -20px rgb(0 0 0/.35);overflow:hidden}
.cmdk-q{width:100%;border:0;border-bottom:1px solid var(--line);padding:16px 18px;font:inherit;font-size:15.5px;background:transparent;color:var(--text);outline:none}
.cmdk-list{max-height:min(420px,60vh);overflow:auto;padding:6px}.cmdk-gt{margin:8px 10px 4px;font-size:11.5px;font-weight:600;color:var(--text-3)}
.cmdk-i{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:9px 10px;border-radius:8px;color:var(--text);font-size:14px;text-decoration:none}
.cmdk-i button{all:unset;display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;cursor:pointer}
.cmdk-i.on{background:var(--hover)}.cmdk-i:hover{text-decoration:none}.cmdk-h{font-size:12px;color:var(--text-3)}
.cmdk-none{margin:16px;color:var(--text-3);font-size:13.5px}.cmdk-foot{display:flex;gap:16px;margin:0;padding:9px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--text-3)}
.cmdk kbd{font:inherit;font-size:11px;padding:1px 5px;margin-right:4px;border:1px solid var(--line);border-radius:4px;background:var(--sunken)}
.cmdk-open{display:inline-flex;align-items:center;gap:8px;margin-left:auto;padding:4px 8px 4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text-3);font:inherit;font-size:12.5px;cursor:pointer}
.cmdk-open:hover{color:var(--text);border-color:var(--line-strong)}.cmdk-open kbd{font:inherit;font-size:11px;padding:0 5px;border:1px solid var(--line);border-radius:4px}
@media (prefers-reduced-motion:no-preference){.cmdk:not([hidden]) .cmdk-box{animation:pop .12s ease-out both}}
@media (max-width:560px){.cmdk-open .lbl{display:none}}`;

export const CMDK_SCRIPT = "(function(){var m=document.getElementById('cmdk');if(!m)return;var q=m.querySelector('.cmdk-q'),items=[].slice.call(m.querySelectorAll('[data-cmdk-item]')),none=m.querySelector('.cmdk-none'),cur=-1,last=null;var mac=/Mac|iPhone|iPad/.test(navigator.platform);document.querySelectorAll('[data-cmdk-key]').forEach(function(k){k.textContent=mac?'⌘K':'Ctrl K';});function vis(){return items.filter(function(i){return !i.hidden;});}function sel(n){var v=vis();items.forEach(function(i){i.classList.remove('on');});if(!v.length){cur=-1;return;}cur=(n+v.length)%v.length;v[cur].classList.add('on');v[cur].scrollIntoView({block:'nearest'});q.setAttribute('aria-activedescendant',v[cur].id);}function filter(){var t=q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);items.forEach(function(i){var s=i.getAttribute('data-q');i.hidden=!t.every(function(w){return s.indexOf(w)>=0;});});m.querySelectorAll('[data-cmdk-group]').forEach(function(g){g.hidden=!g.querySelector('[data-cmdk-item]:not([hidden])');});none.hidden=vis().length>0;sel(0);}function open(){last=document.activeElement;m.hidden=false;q.value='';filter();q.focus();}function close(){m.hidden=true;if(last&&last.focus)last.focus();}function go(){var v=vis()[cur];if(!v)return;if(v.tagName==='FORM'){v.querySelector('button').click();}else location.href=v.getAttribute('href');}document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key==='k'||e.key==='K')){e.preventDefault();if(m.hidden)open();else close();return;}if(m.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='ArrowDown'){e.preventDefault();sel(cur+1);}else if(e.key==='ArrowUp'){e.preventDefault();sel(cur-1);}else if(e.key==='Enter'&&e.target===q){e.preventDefault();go();}});q.addEventListener('input',filter);m.addEventListener('mousedown',function(e){if(e.target===m)close();});items.forEach(function(i){i.addEventListener('mousemove',function(){var v=vis();var n=v.indexOf(i);if(n>=0&&n!==cur)sel(n);});});document.querySelectorAll('[data-cmdk-open]').forEach(function(b){b.hidden=false;b.addEventListener('click',open);});})();";
