'use strict';
/* 產險團隊業績表 — 前端 */
const API = window.API_URL;
const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const TABLES = [{k:'c',name:'佣金',chart:'佣金圖'},{k:'p',name:'保費',chart:'保費圖'},{k:'n',name:'件數',chart:'件數圖'}];
const YEAR_COLORS = {'109年':'#264478','110年':'#9E480E','111年':'#636363','112年':'#FFC000','113年':'#4472C4','114年':'#ED7D31','115年':'#A5A5A5','116年':'#70AD47','117年':'#5B9BD5'};
const YEAR_COLORS_EXTRA = ['#997300','#255E91','#43682B','#C00000','#7030A0','#00B0F0'];
function yearColor(y){
  const s = String(y).includes('年') ? String(y) : String(y) + '年';
  if (YEAR_COLORS[s]) return YEAR_COLORS[s];
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 118) return YEAR_COLORS_EXTRA[(n - 118) % YEAR_COLORS_EXTRA.length];
  return '#4472C4';
}
const LS = {pass:'perf_pass',by:'perf_by'};
let DATA = null, META = {ver:0}, editMode = false, charts = [];
let pending = new Map();
let quiet = false, lastSync = null, polling = false;
const POLL_MS = 5000;
const MIN_YEAR = 116;   // 一定顯示到這一年（明年表格），即使還沒有資料   // key -> change
let saveTimer = null, saving = false;

const $ = s => document.querySelector(s);
const fmt = v => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('zh-TW');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum = a => (a||[]).reduce((s,v)=> s + (typeof v === 'number' && !isNaN(v) ? v : 0), 0);
const hasData = y => ['c','p','n'].some(k => (y[k]||[]).some(v => v !== null && v !== undefined));
const yNum = s => parseInt(s, 10);
function toast(msg, ms=2500){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'), ms); }
function fmtTime(iso){ if(!iso) return ''; const d=new Date(iso); return d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+'（台北時間）'; }

// ---------- API ----------
async function apiGet(params=''){ const r = await fetch(API + (params ? '?' + params : ''), {cache:'no-store'}); return r.json(); }
async function apiPost(body){
  body.pass = localStorage.getItem(LS.pass) || ''; body.by = localStorage.getItem(LS.by) || '';
  const r = await fetch(API, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
  const j = await r.json(); if(!j.ok) throw new Error(j.error || '儲存失敗'); return j;
}
function applyServer(j){
  DATA = j.data; META = {ver:j.ver, updatedAt:j.updatedAt, updatedBy:j.updatedBy};
  // 把還沒送出的修改套回去
  for (const c of pending.values()) { const row = findRow(c.person, c.year); if (row) { row[c.table][c.month] = c.value; row[c.table+'T'] = sum(row[c.table]); } }
  setStatus();
}
function setStatus(extra){
  const s = META.updatedAt ? `最後更新：${fmtTime(META.updatedAt)}${META.updatedBy ? '・' + esc(META.updatedBy) : ''}` : '';
  const sy = lastSync ? `<span class="sync" title="每 5 秒自動檢查一次（分頁在背景時暫停）">🟢 最後同步 ${lastSync.toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'})}</span>` : '';
  $('#status').innerHTML = (extra ? extra + '　' : '') + s + (sy ? '　' + sy : '');
}
async function load(force, live){
  try {
    const j = await apiGet();
    if (!j.ok || !j.data) throw new Error('無資料');
    lastSync = new Date();
    if (!force && j.ver === META.ver) { setStatus(); return false; }
    if (live && saving) return false;            // 自己正在存檔，等存完再說
    applyServer(j); live ? refreshLive() : render(); return true;
  } catch(e){ setStatus('⚠️ 讀取失敗：' + e.message); console.error(e); return false; }
}
// 每 5 秒只問「版本號」（後端放在快取，不吃配額）；版本變了才下載整份資料
async function poll(){
  if (document.hidden || polling || saving || !DATA) return;
  polling = true;
  try {
    const m = await apiGet('meta=1');
    if (m.ok) { lastSync = new Date(); if (m.ver !== META.ver) { const by = m.updatedBy; if (await load(false, true)) toast(`已同步${by ? '「' + by + '」' : '其他人'}的更新`, 1800); } else setStatus(); }
  } catch(e){ setStatus('⚠️ 同步失敗，稍後重試'); }
  finally { polling = false; }
}
// 有新資料時：保留正在輸入的格子不動，其餘更新並短暫標色
function refreshLive(){
  const r = route(), focused = document.activeElement && document.activeElement.matches('table.xl input') ? document.activeElement : null;
  if (r.type === 'person' && focused && DATA.people[r.name]) {
    const p = DATA.people[r.name];
    document.querySelectorAll('table.xl input').forEach(inp => {
      if (inp === focused) return;
      const k = `${p.name}|${inp.dataset.y}|${inp.dataset.t}|${inp.dataset.m}`; if (pending.has(k)) return;
      const row = findRow(p.name, inp.dataset.y); if (!row) return;
      const v = row[inp.dataset.t][+inp.dataset.m], s = v ?? '';
      if (String(inp.value) !== String(s)) { inp.value = s; flash(inp.parentElement); }
    });
    document.querySelectorAll('[data-tot]').forEach(td => { const [y,t] = td.dataset.tot.split('|'); const row = findRow(p.name, y); if (row) { const s = fmt(sum(row[t])); if (td.textContent !== s) { td.textContent = s; flash(td); } } });
    updateCharts(p); return;
  }
  if (focused) return;   // 其他頁面不會有輸入格
  const before = snapshot(), sy = window.scrollY;
  quiet = true; render(true); quiet = false; window.scrollTo(0, sy);
  const after = snapshot();
  for (const [k, el] of after) { const b = before.get(k); if (b !== undefined && b.text !== el.text) flash(el.td); }
}
function snapshot(){
  const m = new Map();
  document.querySelectorAll('#view tr[data-k]').forEach(tr => { const off = +(tr.dataset.off || 0);
    [...tr.children].forEach((td, i) => { const inp = td.querySelector('input'); m.set(tr.dataset.k + '|' + (i - off), {td, text: inp ? inp.value : td.textContent}); }); });
  return m;
}
function flash(td){ if (!td) return; td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash'); setTimeout(() => td.classList.remove('flash'), 3000); }

// ---------- 路由 ----------
function route(){ const q = new URLSearchParams(location.search); if (q.get('p')) return {type:'person', name:q.get('p')}; return {type: q.get('v') || 'total'}; }
function go(params){ const u = new URL(location.href); u.search = new URLSearchParams(params).toString(); history.pushState(null,'',u); render(); window.scrollTo(0,0); }
window.addEventListener('popstate', render);
function personUrl(n){ const u = new URL(location.href); u.search = '?p=' + encodeURIComponent(n); u.hash=''; return u.toString(); }

function findRow(person, year){ const p = DATA.people[person]; return p ? p.years.find(y => y.y === year) : null; }

// ---------- 畫面 ----------
function renderTabs(cur){
  const t = [`<a href="?v=total" data-v="total" class="sum ${cur.type==='total'?'active':''}">總計</a>`,
             `<a href="?v=compare" data-v="compare" class="sum ${cur.type==='compare'?'active':''}">年度比較</a>`];
  DATA.order.forEach(n => t.push(`<a href="?p=${encodeURIComponent(n)}" data-p="${esc(n)}" class="${cur.type==='person'&&cur.name===n?'active':''}">${esc(n)}</a>`));
  if (editMode) t.push(`<a href="#" data-add="1" class="add">＋新增成員</a>`);
  t.push(`<a href="?v=links" data-v="links" class="raw ${cur.type==='links'?'active':''}">個人連結</a>`);
  t.push(`<a href="?v=raw-total" data-v="raw-total" class="raw ${cur.type==='raw-total'?'active':''}">原始「總計」</a>`);
  t.push(`<a href="?v=raw-1314" data-v="raw-1314" class="raw ${cur.type==='raw-1314'?'active':''}">原始「113&amp;114」</a>`);
  const nav = $('#tabs'); nav.innerHTML = t.join('');
  nav.querySelectorAll('a').forEach(a => a.onclick = ev => { ev.preventDefault();
    if (a.dataset.add) return addPerson();
    if (a.dataset.p) go({p:a.dataset.p}); else go({v:a.dataset.v}); });
  const act = nav.querySelector('.active'); if (act && !quiet) { const x = act.offsetLeft - nav.clientWidth/2 + act.clientWidth/2; nav.scrollLeft = x; }
}
function render(live){
  if (!DATA) return;
  charts.forEach(c => c.destroy()); charts = [];
  const r = route(); renderTabs(r); renderEditbar(r);
  const v = $('#view');
  if (r.type === 'person') { if (!DATA.people[r.name]) { v.innerHTML = `<div class="card">找不到成員「${esc(r.name)}」。<a href="?v=total">回總計</a></div>`; return; } renderPerson(v, DATA.people[r.name]); }
  else if (r.type === 'compare') renderCompare(v);
  else if (r.type === 'links') renderLinks(v);
  else if (r.type === 'raw-total') renderRaw(v, '總計');
  else if (r.type === 'raw-1314') renderRaw(v, '113&114');
  else renderTotal(v);
  document.title = (r.type==='person' ? r.name + '｜' : '') + '產險團隊業績表';
}
function renderEditbar(r){
  const b = $('#editbar'); $('#btnEdit').classList.toggle('on', editMode); $('#btnEdit').textContent = editMode ? '✅ 編輯中（點此結束）' : '✏️ 編輯模式';
  if (!editMode) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  let h = `<span>編輯者：<b>${esc(localStorage.getItem(LS.by)||'（未填）')}</b></span><span id="saveState" class="muted">修改後會自動儲存</span>`;
  if (r.type === 'person' && DATA.people[r.name]) h += `<span style="flex:1"></span><button class="btn" id="eAddYear">＋新增年份列</button><button class="btn" id="eDelYear">－刪除最後年份列</button><button class="btn" id="eRename">改名</button><button class="btn danger" id="eDel">刪除此成員</button>`;
  else h += `<span style="flex:1"></span><button class="btn" id="eAddP">＋新增成員</button><button class="btn" id="eUndo" title="還原到上一次儲存前的版本">↶ 還原上一版</button><button class="btn" id="ePass">變更編輯密碼</button>`;
  b.innerHTML = h;
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on('eAddYear', () => addYear(r.name)); on('eDelYear', () => delYear(r.name)); on('eRename', () => renamePerson(r.name)); on('eDel', () => deletePerson(r.name));
  on('eAddP', addPerson); on('ePass', changePass); on('eUndo', undo);
}

function chartOpts(title, indexAxis){
  return {responsive:true, maintainAspectRatio:false, indexAxis: indexAxis||'x', animation: quiet ? false : {duration:300},
    plugins:{title:{display:true,text:title,font:{size:16,weight:'bold'}}, legend:{position:'bottom'},
      tooltip:{callbacks:{label:c=>`${c.dataset.label}：${fmt(c.parsed[indexAxis==='y'?'x':'y'])}`}}},
    scales:{x:{grid:{display:indexAxis==='y'},ticks:{callback:function(v){return indexAxis==='y'?fmt(v):this.getLabelForValue(v);}}},
            y:{beginAtZero:true,ticks:{callback:function(v){return indexAxis==='y'?this.getLabelForValue(v):fmt(v);}}}}};  // 不設上限 → 依數據自動調整高低
}
function personChartYears(p){ const ys = p.years.filter(y => hasData(y) || yNum(y.y) === MIN_YEAR); return ys.length ? ys : p.years.slice(0,1); }

function renderPerson(v, p){
  const ys = personChartYears(p);
  let h = `<div class="card"><div class="ptitle"><h2>${esc(p.name)}</h2><span class="muted">圖表顯示有資料的年份（${ys.map(y=>y.y).join('、')}），高度依數據自動調整</span></div></div>`;
  h += `<div class="charts">` + TABLES.map(t => `<div class="chartbox"><canvas id="ch_${t.k}"></canvas></div>`).join('') + `</div><br>`;
  h += `<div class="tables">` + TABLES.map(t => tableHtml(p, t)).join('') + `</div>`;
  const hidden = p.years.length - visibleYears(p).length;
  if (hidden > 0 || showAllYears) h += `<div class="yrtoggle"><button class="btn" id="yrT">${showAllYears ? '只顯示有資料的年份' : `顯示全部年份（另有 ${hidden} 列空白年份）`}</button></div>`;
  v.innerHTML = h;
  const yt = document.getElementById('yrT'); if (yt) yt.onclick = () => { showAllYears = !showAllYears; render(); };
  TABLES.forEach(t => {
    const ctx = document.getElementById('ch_' + t.k);
    charts.push(new Chart(ctx, {type:'bar', data:{labels:MONTHS, datasets: ys.map((y,i) => ({label:y.y, data:y[t.k].map(x => x ?? null), backgroundColor:yearColor(y.y)}))}, options:chartOpts(t.chart)}));
  });
  if (editMode) bindInputs(p);
}
function tableHtml(p, t){
  let h = `<div class="tblwrap"><table class="xl"><thead><tr><th class="hd" colspan="14" style="font-size:16px;text-align:left"><span class="stk">${t.name}</span></th></tr><tr><th class="hd">年月</th>${MONTHS.map(m=>`<th class="hd">${m}</th>`).join('')}<th class="hd">合計</th></tr></thead><tbody>`;
  visibleYears(p).forEach(y => {
    const lab = (t.k + 'Label') in y ? y[t.k + 'Label'] : y.y;
    h += `<tr data-k="${t.k}|${esc(y.y)}" class="${hasData(y)?'':'empty'}"><td class="yr" title="${(t.k+'Label') in y ? 'Excel 此列年份欄原本是空白' : ''}">${esc(lab ?? '')}</td>`;
    y[t.k].forEach((val, m) => {
      h += editMode ? `<td><input inputmode="numeric" data-y="${esc(y.y)}" data-t="${t.k}" data-m="${m}" value="${val ?? ''}"></td>` : `<td>${val ?? ''}</td>`;
    });
    h += `<td class="tot" data-tot="${esc(y.y)}|${t.k}">${fmt(sum(y[t.k]))}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}
let showAllYears = false;
function visibleYears(p){
  if (showAllYears) return p.years;
  let last = -1; p.years.forEach((y,i) => { if (hasData(y) || yNum(y.y) <= MIN_YEAR) last = i; });
  return p.years.slice(0, Math.max(last + 1, 1));   // 有資料的年份，且至少顯示到 116年   // 有資料的年份 + 下一年空白列
}
function bindInputs(p){
  document.querySelectorAll('table.xl input').forEach(inp => {
    inp.addEventListener('input', () => {
      const raw = inp.value.replace(/[,\s]/g,'');
      if (raw !== '' && isNaN(Number(raw))) { inp.classList.add('dirty'); inp.style.borderColor='#e53935'; return; }
      inp.style.borderColor='';
      const value = raw === '' ? null : Number(raw), year = inp.dataset.y, table = inp.dataset.t, month = +inp.dataset.m;
      const row = findRow(p.name, year); row[table][month] = value; row[table+'T'] = sum(row[table]);
      pending.set(`${p.name}|${year}|${table}|${month}`, {person:p.name, year, table, month, value});
      inp.classList.add('dirty'); inp.classList.remove('saved');
      document.querySelector(`[data-tot="${CSS.escape(year)}|${table}"]`).textContent = fmt(row[table+'T']);
      updateCharts(p); scheduleSave();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const all=[...document.querySelectorAll(`table.xl input[data-t="${inp.dataset.t}"]`)]; const i=all.indexOf(inp); const nx = all[i+12]; if(nx){nx.focus();nx.select();} } });
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('blur', () => {   // 輸入時被延後的同步，離開格子後補上
      const k = `${p.name}|${inp.dataset.y}|${inp.dataset.t}|${inp.dataset.m}`; if (pending.has(k)) return;
      const row = findRow(p.name, inp.dataset.y); if (!row) return; const s = row[inp.dataset.t][+inp.dataset.m] ?? '';
      if (String(inp.value) !== String(s)) { inp.value = s; flash(inp.parentElement); }
    });
  });
}
function updateCharts(p){
  const ys = personChartYears(p);
  TABLES.forEach((t, i) => { const c = charts[i]; if (!c) return;
    c.data.datasets = ys.map((y,j) => ({label:y.y, data:y[t.k].map(x => x ?? null), backgroundColor:yearColor(y.y)})); c.update(); });
}
function scheduleSave(){ clearTimeout(saveTimer); const s=$('#saveState'); if(s) s.textContent='有未儲存的修改…'; saveTimer = setTimeout(flush, 1200); }
async function flush(){
  if (saving) { scheduleSave(); return; }
  if (!pending.size) return;
  saving = true; const batch = [...pending.entries()]; const s=$('#saveState'); if(s) s.textContent='儲存中…';
  try {
    const j = await apiPost({action:'patch', changes: batch.map(e=>e[1])});
    batch.forEach(([k, c]) => { if (pending.get(k) === c) pending.delete(k); });
    applyServer(j);
    document.querySelectorAll('table.xl input.dirty').forEach(i => { const k = `${route().name}|${i.dataset.y}|${i.dataset.t}|${i.dataset.m}`; if (!pending.has(k)) { i.classList.remove('dirty'); i.classList.add('saved'); } });
    const s2=$('#saveState'); if(s2) s2.textContent = '✅ 已儲存（' + new Date().toLocaleTimeString('zh-TW',{hour12:false}) + '）';
  } catch(e){ const s2=$('#saveState'); if(s2) s2.textContent='⚠️ 儲存失敗：' + e.message + '（會自動重試）'; toast('儲存失敗：' + e.message, 4000); setTimeout(flush, 5000); }
  finally { saving = false; }
}
window.addEventListener('beforeunload', e => { if (pending.size) { e.preventDefault(); e.returnValue = ''; } });

// ---------- 總計 ----------
function allYears(){ const s = new Set([MIN_YEAR + '年']); DATA.order.forEach(n => DATA.people[n].years.forEach(y => { if (hasData(y)) s.add(y.y); })); return [...s].sort((a,b)=>yNum(a)-yNum(b)); }
function dataYears(){ const s = new Set(); DATA.order.forEach(n => DATA.people[n].years.forEach(y => { if (hasData(y)) s.add(y.y); })); return [...s].sort((a,b)=>yNum(a)-yNum(b)); }
function latestDataYear(){ const d = dataYears(); return d.length ? d[d.length-1] : MIN_YEAR + '年'; }
function personYear(n, year){ const y = findRow(n, year); return y ? {c:sum(y.c), p:sum(y.p), n:sum(y.n)} : {c:0,p:0,n:0}; }
let totalState = {year:null, sort:'c', dir:-1};
function renderTotal(v){
  const years = allYears(); if (!totalState.year || !years.includes(totalState.year)) totalState.year = latestDataYear();
  const Y = totalState.year;
  let rows = DATA.order.map(nm => ({nm, ...personYear(nm, Y)}));
  const k = totalState.sort; rows.sort((a,b) => k==='name' ? a.nm.localeCompare(b.nm,'zh-Hant')*-totalState.dir : (b[k]-a[k])*-totalState.dir);
  const tot = {c:sum(rows.map(r=>r.c)), p:sum(rows.map(r=>r.p)), n:sum(rows.map(r=>r.n))};
  const arrow = c => totalState.sort===c ? (totalState.dir<0?' ▼':' ▲') : '';
  let h = `<div class="card"><div class="ptitle"><h2>總計・${esc(Y)}</h2><div class="controls">年度：<select id="tYear">${years.map(y=>`<option ${y===Y?'selected':''}>${y}</option>`).join('')}</select></div></div>
  <div class="grid2"><div class="tblwrap"><table class="rank"><thead><tr><th class="l">#</th><th class="l" data-s="name">成員${arrow('name')}</th><th data-s="c">總佣金${arrow('c')}</th><th data-s="p">總保費${arrow('p')}</th><th data-s="n">件數${arrow('n')}</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr data-k="r|${esc(r.nm)}"><td class="l">${i+1}</td><td class="l"><a href="?p=${encodeURIComponent(r.nm)}" data-p="${esc(r.nm)}">${esc(r.nm)}</a></td><td>${fmt(r.c)}</td><td>${fmt(r.p)}</td><td>${fmt(r.n)}</td></tr>`).join('')}
  </tbody><tfoot><tr data-k="rfoot"><td></td><td class="l">團隊合計</td><td>${fmt(tot.c)}</td><td>${fmt(tot.p)}</td><td>${fmt(tot.n)}</td></tr></tfoot></table></div>
  <div class="chartbox" style="height:${Math.max(320, rows.length*24+80)}px"><canvas id="tChart"></canvas></div></div>
  <p class="muted">由每位成員頁面的月資料即時加總；點欄位標題可排序，點姓名進入個人頁。</p></div>`;
  // 團隊各年合計 + 每人各年矩陣
  h += `<div class="card"><h3 style="margin-top:0">各年度彙總（每人 總佣金／總保費／件數）</h3><div class="tblwrap"><table class="rank"><thead><tr><th class="l">成員</th><th class="l"></th>${years.map(y=>`<th style="text-align:right">${y}</th>`).join('')}</tr></thead><tbody>`;
  DATA.order.forEach(n => { [['c','總佣金'],['p','總保費'],['n','件數']].forEach(([kk,lab],i) => { h += `<tr data-k="m|${esc(n)}|${kk}" data-off="${i===0?1:0}" style="${i===0?'border-top:2px solid #ddd':''}">${i===0?`<td class="l" rowspan="3" style="vertical-align:top"><a href="?p=${encodeURIComponent(n)}" data-p="${esc(n)}">${esc(n)}</a></td>`:''}<td class="l muted">${lab}</td>${years.map(y=>`<td>${findRow(n,y)?fmt(personYear(n,y)[kk]):''}</td>`).join('')}</tr>`; }); });
  h += `</tbody><tfoot>${[['c','總佣金'],['p','總保費'],['n','件數']].map(([kk,lab],i)=>`<tr data-k="mf|${kk}" data-off="${i===0?1:0}">${i===0?'<td class="l" rowspan="3" style="vertical-align:top">團隊合計</td>':''}<td class="l">${lab}</td>${years.map(y=>`<td>${fmt(sum(DATA.order.map(n=>personYear(n,y)[kk])))}</td>`).join('')}</tr>`).join('')}</tfoot></table></div></div>`;
  v.innerHTML = h;
  $('#tYear').onchange = e => { totalState.year = e.target.value; render(); };
  v.querySelectorAll('th[data-s]').forEach(th => th.onclick = () => { const s=th.dataset.s; totalState.dir = totalState.sort===s ? -totalState.dir : -1; totalState.sort=s; render(); });
  bindPersonLinks(v);
  const sorted = [...rows].sort((a,b)=>b[k==='name'?'c':k]-a[k==='name'?'c':k]); const mk = k==='name'?'c':k; const lab = {c:'總佣金',p:'總保費',n:'件數'}[mk];
  charts.push(new Chart($('#tChart'), {type:'bar', data:{labels:sorted.map(r=>r.nm), datasets:[{label:`${Y} ${lab}`, data:sorted.map(r=>r[mk]), backgroundColor:yearColor(Y)}]}, options:chartOpts(`${Y} ${lab}排名`, 'y')}));
}
function bindPersonLinks(v){ v.querySelectorAll('a[data-p]').forEach(a => a.onclick = e => { e.preventDefault(); go({p:a.dataset.p}); }); }

// ---------- 年度比較 ----------
let cmpState = {a:null, b:null, k:'c', same:true};
function lastMonthWithData(year){ let last = -1; DATA.order.forEach(n => { const y = findRow(n, year); if (y) ['c','p','n'].forEach(k => y[k].forEach((v,i) => { if (v !== null && v !== undefined && i > last) last = i; })); }); return last; }
function renderCompare(v){
  const years = allYears();
  // 預設：最新有資料的年份 vs 前一年（116年有資料後自動變成 116 vs 115 同期）
  if (!cmpState.b || !years.includes(cmpState.b)) cmpState.b = latestDataYear();
  if (!cmpState.a || !years.includes(cmpState.a)) { const i = years.indexOf(cmpState.b); cmpState.a = years[Math.max(0, i-1)]; }
  const {a, b, k} = cmpState; const lm = lastMonthWithData(b); const lim = cmpState.same && lm >= 0 && lm < 11 ? lm : 11;
  const val = (n, y) => { const r = findRow(n, y); return r ? sum(r[k].slice(0, lim+1)) : 0; };
  const rows = DATA.order.map(n => { const x = val(n,a), z = val(n,b); return {n, x, z, d:z-x, g: x ? (z-x)/x : null}; }).sort((p,q)=>q.z-p.z);
  const lab = {c:'佣金',p:'保費',n:'件數'}[k];
  const range = lim < 11 ? `（同期 1–${lim+1} 月）` : '（全年）';
  let h = `<div class="card"><div class="ptitle"><h2>年度比較</h2></div>
  <div class="controls">比較 <select id="cA">${years.map(y=>`<option ${y===a?'selected':''}>${y}</option>`).join('')}</select> → <select id="cB">${years.map(y=>`<option ${y===b?'selected':''}>${y}</option>`).join('')}</select>
  項目 <select id="cK">${TABLES.map(t=>`<option value="${t.k}" ${t.k===k?'selected':''}>${t.name}</option>`).join('')}</select>
  <label><input type="checkbox" id="cSame" ${cmpState.same?'checked':''}> 只比同期（${b} 有資料的月份）</label></div>
  <div class="chartbox" style="height:380px"><canvas id="cChart"></canvas></div><br>
  <div class="tblwrap"><table class="rank"><thead><tr><th class="l">#</th><th class="l">成員</th><th>${a} ${lab}</th><th>${b} ${lab}</th><th>差額</th><th>成長率</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr data-k="c|${esc(r.n)}"><td class="l">${i+1}</td><td class="l"><a href="?p=${encodeURIComponent(r.n)}" data-p="${esc(r.n)}">${esc(r.n)}</a></td><td>${fmt(r.x)}</td><td>${fmt(r.z)}</td><td class="${r.d>0?'up':r.d<0?'down':''}">${r.d>0?'+':''}${fmt(r.d)}</td><td class="${r.g>0?'up':r.g<0?'down':''}">${r.g===null?'—':(r.g>0?'+':'')+(r.g*100).toFixed(1)+'%'}</td></tr>`).join('')}
  </tbody><tfoot><tr data-k="cfoot"><td></td><td class="l">團隊合計</td><td>${fmt(sum(rows.map(r=>r.x)))}</td><td>${fmt(sum(rows.map(r=>r.z)))}</td><td>${fmt(sum(rows.map(r=>r.d)))}</td><td>${(()=>{const x=sum(rows.map(r=>r.x)),z=sum(rows.map(r=>r.z));return x?((z-x)/x*100).toFixed(1)+'%':'—';})()}</td></tr></tfoot></table></div>
  <p class="muted">${range}</p></div>`;
  v.innerHTML = h;
  $('#cA').onchange = e => { cmpState.a = e.target.value; render(); }; $('#cB').onchange = e => { cmpState.b = e.target.value; render(); };
  $('#cK').onchange = e => { cmpState.k = e.target.value; render(); }; $('#cSame').onchange = e => { cmpState.same = e.target.checked; render(); };
  bindPersonLinks(v);
  charts.push(new Chart($('#cChart'), {type:'bar', data:{labels:rows.map(r=>r.n), datasets:[{label:a, data:rows.map(r=>r.x), backgroundColor:yearColor(a)},{label:b, data:rows.map(r=>r.z), backgroundColor:yearColor(b)}]}, options:chartOpts(`${lab}比較 ${a} vs ${b} ${range}`)}));
}

// ---------- 個人連結 ----------
function renderLinks(v){
  v.innerHTML = `<div class="card"><h2 style="margin-top:0">每位成員的專屬連結</h2><p class="muted">把連結傳給本人，打開就是自己的頁面；要修改時按「編輯模式」輸入團隊編輯密碼。</p>
  <ul class="linklist">${DATA.order.map(n => `<li><a href="${esc(personUrl(n))}" data-p="${esc(n)}">${esc(n)}</a> <button class="btn" data-copy="${esc(personUrl(n))}" style="padding:2px 6px;font-size:12px">複製</button></li>`).join('')}</ul></div>`;
  bindPersonLinks(v);
  v.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(b.dataset.copy));
}
async function copyText(t){ try { await navigator.clipboard.writeText(t); toast('已複製連結'); } catch(e){ prompt('請複製這個連結：', t); } }

// ---------- 原始工作表（照 Excel 原樣） ----------
const RAW_NOTES = {
  '總計': ['這是 Excel「總計」工作表的原樣數字，未做任何修改，僅供對照；正確的即時加總請看「總計」分頁。',
    '此表每一列都固定抓各人頁面的第 18、19、20… 列，但各人第一個年份不同，所以：梁仕翰（從 112 年開始）的數字整排晚一年（標 113 年的 44,951 其實是他的 112 年）；林秀蓮（從 109 年開始）整排晚四年（標 113 年的 82,076 其實是 109 年）。',
    '郭欣怡那三欄抓的是第 21 列起（她頁面上的 116 年），所以全是 0；她 115 年其實有業績。',
    '只收了 13 位成員，沒有陳達夫、魏君諺、李宜瑾、李健弘、施秀涵。'],
  '113&114': ['這是 Excel「113&114」工作表的原樣數字（除林秋慧 113 年佣金外都是手打的固定值），僅供對照；正確比較請看「年度比較」分頁。',
    '標題寫 113、114 年，但多數數字和個人頁對不上，例如梁仕翰「113 年」67,613 其實是他的 113 年、「114 年」73,543 卻不等於他 114 年的 94,855；陳銘旭「114 年」86,925 是他的 113 年。',
    '有一位「陳婉瑜」不在任何個人頁；115、116 年欄位是空的。']
};
function renderRaw(v, name){
  const raw = DATA.raw && DATA.raw[name]; if (!raw) { v.innerHTML = '<div class="card">沒有原始資料</div>'; return; }
  const covered = new Set(), spans = {};
  raw.merges.forEach(m => { const [a,b] = m.split(':'); const p = s => { const r=s.match(/([A-Z]+)(\d+)/); let c=0; for (const ch of r[1]) c=c*26+ch.charCodeAt(0)-64; return [+r[2]-1, c-1]; };
    const [r1,c1]=p(a),[r2,c2]=p(b); spans[r1+','+c1]=[r2-r1+1,c2-c1+1]; for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++) if(r!==r1||c!==c1) covered.add(r+','+c); });
  let h = `<div class="card"><h2 style="margin-top:0">原始「${esc(name)}」工作表（Excel 原樣）</h2><div class="note"><ul>${RAW_NOTES[name].map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div><br><div class="tblwrap"><table class="xl"><tbody>`;
  raw.grid.forEach((row, r) => { h += '<tr>'; row.forEach((val, c) => { const key=r+','+c; if (covered.has(key)) return; const sp = spans[key]; const hd = r < 2 || c === 0;
    h += `<td class="${hd?'yr':''}" ${sp?`rowspan="${sp[0]}" colspan="${sp[1]}"`:''} style="${hd?'background:var(--hd);color:var(--hdtx);text-align:center':''}">${typeof val==='number'?fmt(val):esc(val??'')}</td>`; }); h += '</tr>'; });
  v.innerHTML = h + '</tbody></table></div></div>';
}

// ---------- 編輯 ----------
function dialog(title, bodyHtml, okText='確定'){
  return new Promise(res => { const d = $('#dlg'); $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = bodyHtml; $('#dlgOk').textContent = okText;
    d.onclose = () => res(d.returnValue === 'ok' ? d : null); d.returnValue=''; d.showModal(); const f = d.querySelector('#dlgBody input'); if (f) f.focus(); });
}
async function toggleEdit(){
  if (editMode) { await flush(); editMode = false; render(); return; }
  const d = await dialog('進入編輯模式', `<label>團隊編輯密碼</label><input type="password" id="fPass" inputmode="numeric" autocomplete="current-password" value="${esc(localStorage.getItem(LS.pass)||'')}"><label>你的名字（會記錄在「最後更新」）</label><input type="text" id="fBy" value="${esc(localStorage.getItem(LS.by)||'')}">`, '進入編輯');
  if (!d) return;
  const pass = d.querySelector('#fPass').value.trim(), by = d.querySelector('#fBy').value.trim();
  try { const j = await apiGet('check=' + encodeURIComponent(pass)); if (!j.ok) { toast('密碼錯誤'); return; } } catch(e){ toast('無法連線：' + e.message); return; }
  localStorage.setItem(LS.pass, pass); localStorage.setItem(LS.by, by); editMode = true; render(); toast('已進入編輯模式，修改後會自動儲存');
}
async function structural(body, okMsg){
  await flush();
  try { setStatus('儲存中…'); const j = await apiPost(body); applyServer(j); toast(okMsg); return true; } catch(e){ toast('失敗：' + e.message, 4000); setStatus(); return false; }
}
function blankRow(y){ const e = () => Array(12).fill(null); return {y, c:e(), cT:0, p:e(), pT:0, n:e(), nT:0}; }
async function addPerson(){
  if (!editMode) return toggleEdit();
  const roc = new Date().getFullYear() - 1911;
  const d = await dialog('新增成員', `<label>姓名</label><input type="text" id="fName"><label>起始年份（民國）</label><input type="text" id="fY0" inputmode="numeric" value="${roc}"><label>結束年份（民國）</label><input type="text" id="fY1" inputmode="numeric" value="128">`, '新增');
  if (!d) return; const name = d.querySelector('#fName').value.trim(); const y0 = parseInt(d.querySelector('#fY0').value), y1 = parseInt(d.querySelector('#fY1').value);
  if (!name) return toast('請輸入姓名'); if (DATA.people[name]) return toast('已有同名成員'); if (!(y0 > 0 && y1 >= y0 && y1 - y0 < 60)) return toast('年份不正確');
  const years = []; for (let y = y0; y <= y1; y++) years.push(blankRow(y + '年'));
  if (await structural({action:'setPerson', person:{name, sheet:name, years}}, `已新增 ${name}`)) { go({p:name}); copyText(personUrl(name)); }
}
async function addYear(name){
  const p = structuredClone(DATA.people[name]); const last = p.years.length ? yNum(p.years[p.years.length-1].y) : new Date().getFullYear()-1912;
  const d = await dialog('新增年份列', `<label>年份（民國）</label><input type="text" id="fY" inputmode="numeric" value="${last+1}">`, '新增'); if (!d) return;
  const y = parseInt(d.querySelector('#fY').value); if (!(y > 0)) return toast('年份不正確'); const lab = y + '年';
  if (p.years.some(r => r.y === lab)) return toast('已有這個年份');
  p.years.push(blankRow(lab)); p.years.sort((a,b)=>yNum(a.y)-yNum(b.y));
  if (await structural({action:'setPerson', person:p}, `已新增 ${lab}`)) render();
}
async function delYear(name){
  const p = structuredClone(DATA.people[name]); const last = p.years[p.years.length-1]; if (!last) return;
  const warn = hasData(last) ? `<p style="color:#c62828">⚠️ ${esc(last.y)} 有資料，刪除後會一起刪掉！</p>` : '';
  const d = await dialog('刪除年份列', `<p>確定刪除 ${esc(name)} 的「${esc(last.y)}」這一列？</p>${warn}`, '刪除'); if (!d) return;
  p.years.pop(); if (await structural({action:'setPerson', person:p}, `已刪除 ${last.y}`)) render();
}
async function renamePerson(name){
  const d = await dialog('成員改名', `<label>新姓名</label><input type="text" id="fName" value="${esc(name)}">`, '改名'); if (!d) return;
  const nn = d.querySelector('#fName').value.trim(); if (!nn || nn === name) return; if (DATA.people[nn]) return toast('已有同名成員');
  const p = structuredClone(DATA.people[name]); p.name = nn;
  if (await structural({action:'setPerson', oldName:name, person:p}, `已改名為 ${nn}（舊連結會失效，請重新分享）`)) go({p:nn});
}
async function deletePerson(name){
  const d = await dialog('刪除成員', `<p>確定要刪除「<b>${esc(name)}</b>」整頁資料嗎？</p><p class="muted">為避免誤刪，請輸入姓名確認。（系統會在後台保留最近 10 筆刪除紀錄）</p><input type="text" id="fC" placeholder="${esc(name)}">`, '刪除'); if (!d) return;
  if (d.querySelector('#fC').value.trim() !== name) return toast('姓名不符，未刪除');
  if (await structural({action:'deletePerson', name}, `已刪除 ${name}`)) go({v:'total'});
}
async function undo(){
  const d = await dialog('還原上一版', '<p>會把全部資料還原到「最後一次儲存之前」的狀態（大家的修改都會一起退回一步）。確定嗎？</p>', '還原'); if (!d) return;
  pending.clear(); if (await structural({action:'restore', slot:0}, '已還原上一版')) render();
}
async function changePass(){
  const d = await dialog('變更團隊編輯密碼', '<label>新密碼</label><input type="text" id="fP">', '變更'); if (!d) return;
  const np = d.querySelector('#fP').value.trim(); if (!np) return;
  try { await apiPost({action:'setPass', newPass:np}); localStorage.setItem(LS.pass, np); toast('密碼已變更，請通知大家'); } catch(e){ toast('失敗：' + e.message); }
}

// ---------- 匯出 Excel ----------
function exportXlsx(){
  if (!window.XLSX) return toast('匯出元件載入中，請稍後再按');
  const X = window.XLSX, wb = X.utils.book_new();
  const hd = {fill:{fgColor:{rgb:'FFEB9C'}}, font:{bold:true, sz:14, color:{rgb:'9C5700'}}, alignment:{horizontal:'center'}, border:bd()};
  const cl = {fill:{fgColor:{rgb:'FFFFCC'}}, font:{bold:true, sz:14}, alignment:{horizontal:'center'}, border:bd()};
  function bd(){ const s={style:'thin',color:{rgb:'B2B2B2'}}; return {top:s,bottom:s,left:s,right:s}; }
  const addr = (r,c) => X.utils.encode_cell({r,c});
  DATA.order.forEach(n => {
    const p = DATA.people[n], ws = {}, merges = [];
    TABLES.forEach((t, ti) => { const c0 = ti * 15;
      ws[addr(15,c0)] = {v:t.name, t:'s', s:hd}; for (let i=1;i<14;i++) ws[addr(15,c0+i)] = {v:'',t:'s',s:hd}; merges.push({s:{r:15,c:c0}, e:{r:15,c:c0+13}});
      ws[addr(16,c0)] = {v:'年月',t:'s',s:hd}; MONTHS.forEach((m,i)=> ws[addr(16,c0+1+i)] = {v:m,t:'s',s:cl}); ws[addr(16,c0+13)] = {v:'合計',t:'s',s:cl};
      p.years.forEach((y, ri) => { const r = 17 + ri; const lab = (t.k+'Label') in y ? y[t.k+'Label'] : y.y;
        ws[addr(r,c0)] = lab == null ? {v:'',t:'s',s:hd} : {v:lab,t:'s',s:{...hd, alignment:{}}};
        y[t.k].forEach((v,i) => ws[addr(r,c0+1+i)] = v == null ? {v:'',t:'s',s:cl} : {v, t:'n', s:cl});
        ws[addr(r,c0+13)] = {t:'n', v:sum(y[t.k]), f:`SUM(${addr(r,c0+1)}:${addr(r,c0+12)})`, s:{...cl, numFmt:'#,##0'}}; });
    });
    ws['!ref'] = X.utils.encode_range({s:{r:0,c:0}, e:{r:16+p.years.length, c:43}}); ws['!merges'] = merges;
    ws['!cols'] = Array.from({length:44}, (_,i) => ({wch: i%15===14 ? 3 : (i%15===13 ? 12 : 9)}));
    X.utils.book_append_sheet(wb, ws, n.slice(0,31));
  });
  // 總計（依個人頁即時加總，版面同原表）
  const years = allYears(), aoa = [[''], ['']];
  DATA.order.forEach(n => { aoa[0].push(n,'',''); aoa[1].push('總佣金','總保費','件數'); });
  years.forEach(y => aoa.push([y, ...DATA.order.flatMap(n => { const v = personYear(n,y); return [v.c,v.p,v.n]; })]));
  const ts = X.utils.aoa_to_sheet(aoa); ts['!merges'] = DATA.order.map((_,i)=>({s:{r:0,c:1+i*3}, e:{r:0,c:3+i*3}}));
  Object.keys(ts).forEach(k => { if (k[0] !== '!') { const rc = X.utils.decode_cell(k); ts[k].s = (rc.r < 2 || rc.c === 0) ? hd : {...cl, numFmt:'#,##0'}; } });
  X.utils.book_append_sheet(wb, ts, '總計');
  const d = new Date(), stamp = `${d.getFullYear()-1911}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  X.writeFile(wb, `產險團隊業績表_${stamp}.xlsx`);
}

// ---------- 啟動 ----------
function fixTop(){ document.documentElement.style.setProperty('--toph', $('.top').offsetHeight + 'px'); }
window.addEventListener('resize', fixTop);
$('#btnEdit').onclick = toggleEdit; $('#btnExport').onclick = exportXlsx; $('#btnLink').onclick = () => copyText(location.href);
$('#btnReload').onclick = async () => { await flush(); await load(true); toast('已載入最新資料'); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
$('#view').innerHTML = '<div class="loading">資料載入中…</div>';
fixTop(); load(true).then(fixTop); setInterval(poll, POLL_MS);
