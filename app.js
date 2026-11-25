
/* =============== constants =============== */
const BASE_KP = ['low','high','vf','term','conn','adsl'];
const BASE_KPIS = [
  {k:'acq', label:'Total acquisition', short:'Acquisition', unit:'lines', w:'acq'},
  {k:'low', label:'Low lines', short:'Low lines', unit:'lines'},
  {k:'high', label:'High lines', short:'High lines', unit:'lines'},
  {k:'vf', label:'VF Cash (VMT)', short:'VF Cash', unit:'lines'},
  {k:'term', label:'Terminal (EGP)', short:'Terminal', unit:'EGP', money:true, w:'term'},
  {k:'conn', label:'Connectivity points', short:'Connectivity', unit:'points', w:'conn'},
  {k:'adsl', label:'ADSL', short:'ADSL', unit:'ADSLs', dec:true, w:'adsl'}
];
let KP=BASE_KP.slice(), KPIS=BASE_KPIS.slice(), KMAP={}, WK=[], FU=[];
function rebuildKpis(){ const bx=(typeof st!=='undefined'&&st&&st.boxes)||[];
  KP=[...BASE_KP,...bx.map(b=>b.id)]; KPIS=[...BASE_KPIS,...bx.map(b=>({k:b.id,label:b.name,short:b.name,unit:b.unit||'units',money:!!b.money,w:b.id}))];
  KMAP=Object.fromEntries(KPIS.map(x=>[x.k,x])); FU=['term','conn','adsl',...bx.map(b=>b.id)]; WK=['acq',...FU];
  if(typeof st!=='undefined'&&st) WK.forEach(x=>{ if(st.set.weights[x]==null) st.set.weights[x]=0; }); }
/* =============== state and server sync =============== */
let st=null, ADMIN=false, VERSION=0, ETAG=null, DIRTY=false, SYNC='idle';
const LOCAL_KEY='rpm-local-v1';
const API=((window.RPM_CONFIG||{}).API_URL||'').trim().replace(/^PASTE_.*$/,'');
const TOKEN_KEY='rpm-admin-token', CACHE_KEY='rpm-state-cache';
const getToken=()=>{ try{ return localStorage.getItem(TOKEN_KEY)||''; }catch(e){ return ''; } };
const setToken=t=>{ try{ if(t) localStorage.setItem(TOKEN_KEY,t); else localStorage.removeItem(TOKEN_KEY); }catch(e){} };
function writeCache(j){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify({version:j.version,state:j.state})); }catch(e){} }
function readCache(){ try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); return c&&c.state?c:null; }catch(e){ return null; } }
/* POST as text/plain so the browser sends a simple request (no CORS preflight; Apps Script cannot answer one). */
async function api(action,payload){
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action,token:getToken()},payload||{}))});
  if(!r.ok) throw new Error('http '+r.status); return r.json(); }
const S = ()=>st.set;
function readLocal(){ try{ return JSON.parse(localStorage.getItem(LOCAL_KEY)||'{}')||{}; }catch(e){ return {}; } }
function writeLocal(){ try{ localStorage.setItem(LOCAL_KEY, JSON.stringify({mine:st.mine,mineStore:st.mineStore})); }catch(e){} }
function applyServer(s){
  const keep = st?{mine:st.mine,mineStore:st.mineStore}:readLocal();
  st=Object.assign({stores:[],boxes:[],areaName:'Cairo Area',agentBase:[],agentDaily:{},storeBase:{},daily:{},targets:{},prepaid:{},notes:{},owners:{}},s);
  st.mine=keep.mine||{}; st.mineStore=keep.mineStore||{}; rebuildKpis(); }
function shared(){ const o=Object.assign({},st); delete o.mine; delete o.mineStore; return o; }
function setSync(v){ SYNC=v; if(typeof renderStatus==='function') renderStatus(); }
let pushT=null, NOTIFY=null;
function save(){ writeLocal(); if(!ADMIN) return; DIRTY=true; setSync('saving'); clearTimeout(pushT); pushT=setTimeout(push,350); }
async function push(){
  if(!ADMIN||!DIRTY) return;
  try{ const j=await api('put',{version:VERSION,state:shared()});
    if(j.code===401){ ADMIN=false; setToken(''); DIRTY=false; setSync('idle'); route(); return; }
    if(j.code===409){ setSync('conflict'); return; }
    if(!j.ok) throw new Error(j.error||'save failed');
    VERSION=j.version; DIRTY=false; setSync('saved');
    if(NOTIFY){ const m=NOTIFY; NOTIFY=null; api('notify',{title:st.areaName||'RPM',message:m}).catch(()=>{}); }
  }catch(e){ setSync('offline'); clearTimeout(pushT); pushT=setTimeout(push,8000); } }
window.addEventListener('online',()=>{ if(DIRTY) push(); });
async function fetchState(){
  const r=await fetch(API+'?action=state&v='+VERSION,{cache:'no-store'}); if(!r.ok) throw new Error('http '+r.status);
  const j=await r.json(); if(j.hv!==undefined && j.hv!==HV) HIST_STALE=true; if(j.unchanged) return false; if(!j.state) throw new Error(j.error||'no state');
  VERSION=j.version; applyServer(j.state); writeCache(j); return true; }
async function checkAdmin(){ if(!getToken()){ ADMIN=false; return; } try{ const j=await api('me'); ADMIN=!!j.admin; if(!ADMIN) setToken(''); }catch(e){ ADMIN=false; } }
async function login(pw){
  try{ const j=await api('login',{password:pw}); if(!j.ok){ UI.loginErr=j.error||'Sign-in failed.'; return false; }
    setToken(j.token); ADMIN=true; UI.loginErr=''; await fetchState(); ensureSnap(); return true;
  }catch(e){ UI.loginErr='Cannot reach the server.'; return false; } }
async function logout(){ setToken(''); ADMIN=false; DIRTY=false; setSync('idle'); route(); }
/* =============== saved snapshots of each company agents file (rank and score trends) =============== */
let HIST=[], HV=-1, HIST_STALE=false, HIST_BUSY=false;
try{ const hc=JSON.parse(localStorage.getItem('rpm-hist')||'null'); if(hc&&Array.isArray(hc.snaps)){ HIST=hc.snaps; HV=hc.hv; } }catch(e){}
async function fetchHistory(){ const r=await fetch(API+'?action=history',{cache:'no-store'}); if(!r.ok) throw new Error('http '+r.status);
  const j=await r.json(); if(!Array.isArray(j.snaps)) throw new Error('bad history'); HIST=j.snaps; HV=j.hv;
  try{ localStorage.setItem('rpm-hist',JSON.stringify({hv:HV,snaps:HIST})); }catch(e){} }
async function refreshHist(){ if(HIST_BUSY||!HIST_STALE) return; HIST_BUSY=true; HIST_STALE=false;
  try{ await fetchHistory(); ensureSnap(); if(!typing()&&!DIRTY) route(); }catch(e){ } HIST_BUSY=false; }
function makeSnap(){ const AG=computeAgents(), a={}; AG.list.forEach(o=>{ a[o.key]=[Math.round(o.overall*1000),Math.round(o.comm*1000),Math.round(o.k.acq.m),o.rank,o.rankStore]; }); return {date:AG.upto,snap:{a}}; }
async function pushSnap(){ if(!ADMIN||!st.agentBase.length) return; try{ const m=makeSnap(); const j=await api('snap',{date:m.date,snap:m.snap}); if(j.ok){ HIST_STALE=true; HV=-1; refreshHist(); } }catch(e){} }
function ensureSnap(){ try{ if(!ADMIN||!st||!st.agentBase||!st.agentBase.length) return; const d=lastAgentDate(); if(d&&!HIST.some(h=>h.d===d)) pushSnap(); }catch(e){} }
function histSeries(key){ return HIST.filter(h=>h.s&&h.s.a&&h.s.a[key]).map(h=>({d:h.d,ov:h.s.a[key][0]/1000,rank:h.s.a[key][3],rs:h.s.a[key][4]})); }
function moveOf(a){ const up=a.T.asOf; let p=null; for(const h of HIST){ if(h.d<up && h.s && h.s.a && h.s.a[a.key]) p=h; } if(!p) return null; const x=p.s.a[a.key]; return {d:p.d, rank:x[3]-a.rank, rs:x[4]-a.rankStore, ov:a.overall-x[0]/1000}; }
const moveCell = m=> !m||m.rank===0 ? '<span class="mv">–</span>' : m.rank>0 ? '<span class="mv up">▲'+m.rank+'</span>' : '<span class="mv dn">▼'+(-m.rank)+'</span>';
function spark(vals){ if(vals.length<2) return ''; const w=120,h=28,mn=Math.min(...vals),mx=Math.max(...vals),r=(mx-mn)||1;
  const pts=vals.map((v,i)=>((i/(vals.length-1))*w).toFixed(1)+','+(h-3-((v-mn)/r)*(h-6)).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

/* =============== agent analysis helpers =============== */
const firstName = full=>String(full).split('-')[0].trim();
const rawAcq = o=> o.k.acq.t&&o.T.elapsed ? o.k.acq.m/o.T.elapsed*o.T.total/o.k.acq.t : 0;
/* What if this agent sells `units` more acquisition lines by month-end? Units follow the agent's own Low/High/VF mix; the app's acquisition cap rule is applied. */
function simLines(o,units){
  const k={}; Object.keys(o.k).forEach(x=>k[x]={...o.k[x]});
  if(k.acq.t && units>0){
    const ids=['low','high','vf'], mixM=ids.map(x=>o.k[x].m), totM=mixM.reduce((p,q)=>p+q,0), tg=ids.map(x=>o.k[x].t), totT=tg.reduce((p,q)=>p+q,0)||1;
    const sh=totM>0?mixM.map(v=>v/totM):tg.map(v=>v/totT);
    ids.forEach((x,i)=>{ if(k[x].t) k[x].proj+=units*sh[i]/k[x].t; });
    k.acq.proj=rawAcq(o)+units/k.acq.t;
  } else k.acq.proj=rawAcq(o);
  applyCap(k); const ov=overallOf(k); return {ov,comm:commission(ov),k}; }
function minUnitsToReach(o,target){ const f=u=>simLines(o,u).ov>=target+1e-9; if(!f(400)) return null; let lo=1,hi=400; while(lo<hi){ const mid=(lo+hi)>>1; if(f(mid)) hi=mid; else lo=mid+1; } return lo; }
function highToLift(o){ if(!o.k.acq.capped||!o.k.high.t) return null; const S_=S(); const total=whole((S_.acqLift-o.k.high.proj)*o.k.high.t-1e-9); return total>0?{total,perDay:o.T.left?whole(total/o.T.left):total}:null; }
function weekInfo(o){ const ws=weeks(o.T), eff=ws.reduce((a,w)=>a+w.ahead,0), i=ws.findIndex(w=>w.ahead>0); if(i<0||!eff) return null;
  const part=w=>w?whole(o.k.acq.rem*w.ahead/eff):0; return {cur:ws[i],curT:part(ws[i]),next:ws[i+1]||null,nextT:part(ws[i+1]),days:ws[i].ahead}; }
function prioritiesOf(o){ const w=S().weights;
  return ['acq','term','conn','adsl'].filter(x=>w[x]>0&&o.k[x].t>0&&o.k[x].proj<1).map(x=>({x,pts:w[x]*(1-o.k[x].proj)*100})).sort((a,b)=>b.pts-a.pts).slice(0,2).map(q=>{ const x=q.x, k=o.k[x];
    const ask = x==='adsl' ? n(whole(k.rem))+' ADSL by month-end' : x==='term' ? egp(Math.ceil(k.daily/1000-1e-9)*1000)+' EGP/day' : n(whole(k.daily))+' '+(UNIT[x]||KMAP[x].unit+'/day');
    return {x,pts:q.pts,ask}; }); }

/* =============== My sales additions =============== */
function rankCard(me,off,AG){
  const above=AG.list.filter(a=>a.s===off.s&&a.key!==off.key&&a.overall>me.overall+1e-9).sort((x,y)=>x.overall-y.overall)[0], mv=moveOf(off);
  let gapTxt;
  if(!above) gapTxt='You lead your store on overall.';
  else if(!me.T.left) gapTxt='The month is over.';
  else { const u=minUnitsToReach(me,above.overall), nm=esc(firstName(above.n));
    gapTxt = u===null ? `Selling more acquisition lines will not be enough to pass <b>${nm}</b>: acquisition counts up to ${pc(S().acqCap)} until High lines reach ${pc(S().acqLift)}.`
      : u>100 ? `<b>${nm}</b> is far ahead: it takes ${n(u)}+ more acquisitions by month-end to pass.`
      : `To pass <b>${nm}</b> you need <b>${n(u)} more acquisition${u===1?'':'s'}</b> by month-end.`; }
  const ser=histSeries(off.key).filter(x=>x.d<off.T.asOf).slice(-7).map(x=>x.ov).concat([off.overall]);
  const move = mv ? (mv.rank===0 ? `Same place in the area as on ${dl(mv.d)}.` : `${mv.rank>0?'Up':'Down'} <b>${Math.abs(mv.rank)}</b> place${Math.abs(mv.rank)===1?'':'s'} in the area since ${dl(mv.d)}.`) : 'Movement shows after the next company file.';
  return sec('My rank','Official company numbers',`<p class="plan-msg"><b>${off.rankStore} of ${off.storeCount}</b> in my store · <b>${off.rank} of ${AG.list.length}</b> in the area</p>
    <p class="note" style="margin:6px 0 0">${gapTxt}</p>
    <p class="note" style="margin:6px 0 0">${move} ${spark(ser)}</p>`); }
function weekCard(me){ const w=weekInfo(me);
  if(!w) return sec('This week','',`<p class="plan-msg">${me.T.left?'No working days left this week.':'The month is over.'}</p>`);
  return sec('Rest of this week',`${dl(w.cur.from)} to ${dl(w.cur.to)} · ${n(w.days)} working day${w.days===1?'':'s'} left`,
    `<p class="plan-msg"><b>${n(w.curT)}</b> acquisition lines${w.next?` · next week <b>${n(w.nextT)}</b>`:''}</p>`); }
function prioCard(me){ const pr=prioritiesOf(me);
  return sec('My two priorities','The KPIs where I am losing the most points',pr.length?tbl(['KPI',['Points lost','num'],'What it takes'],pr.map(p=>`<tr><td class="name">${KMAP[p.x].short}</td><td class="num"><b>${p.pts.toFixed(1)}</b></td><td class="txt">${esc(p.ask)}</td></tr>`)):'<p class="note" style="margin:0">Every KPI is on pace for 100% of target.</p>'); }
function vsCard(me,AG,off){
  const sc=v=>Math.min(v,2)/2*100;
  const rows=['acq','term','conn','adsl'].filter(x=>me.k[x].t>0).map(x=>{ const ps=AG.list.filter(a=>a.s===off.s&&a.k[x].t>0).map(a=>a.k[x].proj), avg=ps.reduce((t,v)=>t+v,0)/(ps.length||1), best=Math.max(0,...ps);
    return `<div class="vs"><span>${KMAP[x].short}</span><div class="vs-t"><div class="vs-f" style="width:${sc(me.k[x].proj)}%"></div><i class="vs-m a" style="left:${sc(avg)}%"></i><i class="vs-m b" style="left:${sc(best)}%"></i></div><b>${pc(me.k[x].proj)}</b></div>`; }).join('');
  return sec('Me against my store','Projected % of target',`${rows}<div class="vs-lg"><span><i class="d f"></i>Me</span><span><i class="d a"></i>Store average</span><span><i class="d b"></i>Best in store</span></div>`); }
function whatIfCard(me){
  if(!me.T.left) return '';
  const opts=[0,1,5,10], sel=opts.includes(UI.wi)?UI.wi:0, res=opts.map(d=>({d,r:simLines(me,d*me.T.left)})), cur=res.find(x=>x.d===sel), prev=res[opts.indexOf(sel)-1], lift=highToLift(me), S_=S();
  const note = sel===0 ? 'Final commission at my current pace.' : (prev && cur.r.comm<=prev.r.comm+1e-9) ? `No extra commission from this step${me.k.acq.capped?`: acquisition counts up to ${pc(S_.acqCap)} until High lines reach ${pc(S_.acqLift)}.`:'.'}` : `Final commission moves by +${Math.round((cur.r.comm-me.comm)*100)} pts.`;
  return sec('What if I sell more every day?',`For the next ${n(me.T.left)} days, on top of my current pace`,`<div class="ctrl" style="gap:6px;margin-bottom:10px">${opts.map(d=>`<button type="button" class="btn ${d===sel?'primary':''}" data-wi="${d}">${d?'+'+d+' a day':'Now'}</button>`).join('')}</div>
    <p class="plan-msg">Overall <b>${pc(me.overall,1)}</b>${sel?` → <b>${pc(cur.r.ov,1)}</b>`:''} · Final commission <b>${pc(me.comm)}</b>${sel?` → <b>${pc(cur.r.comm)}</b>`:''}</p>
    <p class="note" style="margin:6px 0 0">${note}</p>${lift?`<p class="note" style="margin:6px 0 0">To lift the cap, High lines must reach ${pc(S_.acqLift)}: <b>${n(lift.total)} more High lines</b> (${n(lift.perDay)} a day).</p>`:''}`); }

/* =============== Store additions: WhatsApp message and team plan =============== */
/* The numbers in the "Store" block and the last line are the STORE's own overall (company report + entered sales), never an average of agents. */
function storeShare(s,AG){
  const T=AG.T, list=AG.list.filter(a=>a.s===s.name).sort((x,y)=>whole(y.k.acq.daily)-whole(x.k.acq.daily)||x.n.localeCompare(y.n));
  const zero=list.filter(a=>a.k.adsl.t>0&&a.k.adsl.m<=0).map(a=>firstName(a.n));
  const ovTxt=pc(s.overall,1), L=[];
  L.push('*RPM · '+s.name+'*');
  L.push('Day '+n(T.elapsed)+' of '+n(T.total)+' · store report '+dl(lastDate())+' · agents file '+dl(AG.upto));
  L.push('');
  L.push('*Store overall: '+ovTxt+'*');
  L.push('Rank '+s.rank+' of '+ST.length+' · final commission '+pc(s.comm,1)+' ('+tierInfo(s.overall).l+')');
  const a=s.k.acq; if(a&&a.t) L.push('Acquisition: '+n(a.m)+' of '+n(a.t)+' · on pace for '+pc(rawAcq(s))+(a.capped?' (counted up to '+pc(S().acqCap)+')':''));
  const kp=['term','conn','adsl'].filter(x=>s.k[x]&&s.k[x].t>0).map(x=>KMAP[x].short+' '+pc(s.k[x].proj)); if(kp.length) L.push('Projected: '+kp.join(' · '));
  if(T.left){
    const need=['acq','term','conn','adsl'].filter(x=>s.k[x]&&s.k[x].t>0&&s.k[x].rem>0).map(x=>x==='adsl'?n(whole(s.k.adsl.rem))+' ADSL left':KMAP[x].short+' '+per(KMAP[x],s.k[x].daily)+'/day');
    if(need.length) L.push('Store needs: '+need.join(' · '));
    const nt=nextTier(s,T); if(nt&&!nt.top) L.push('Next step: '+nt.text.replace(/Payout /,'Final commission ')); else if(nt&&nt.top) L.push(nt.text);
    const wi=weekInfo(s); if(wi) L.push('This week ('+n(wi.days)+' days left): about '+n(wi.curT)+' acquisitions as a store');
  } else L.push('Month is over. This is the final result.');
  L.push('');
  L.push('*Acquisitions needed per day*');
  list.forEach(g=>L.push('• '+firstName(g.n)+': '+n(whole(g.k.acq.daily))+(g.k.adsl.t>0&&g.k.adsl.rem>0?' (+'+n(whole(g.k.adsl.rem))+' ADSL)':'')));
  const top=[...list].sort((x,y)=>y.comm-x.comm||y.overall-x.overall).filter(g=>g.comm>0).slice(0,3).map(g=>firstName(g.n)+' '+pc(g.comm));
  if(top.length){ L.push(''); L.push('Best commission now: '+top.join(' · ')); }
  const close=T.left?list.map(g=>{ const cl=nextCliff(g.overall); if(!cl) return null; const u=minUnitsToReach(g,cl.v+.001); return u&&u<=T.left*3?{g,u,per:whole(u/T.left)}:null; }).filter(Boolean).sort((x,y)=>x.u-y.u).slice(0,3):[];
  if(close.length) L.push('Closest to the next tier: '+close.map(q=>firstName(q.g.n)+' (+'+n(q.per)+'/day)').join(' · '));
  if(zero.length) L.push('No ADSL yet: '+zero.join(', '));
  L.push(''); L.push('Store overall: '+ovTxt);
  const text=L.join('\n'); UI.waText=text;
  return sec('Share with the team','Detailed message with the store\'s own numbers. Whole numbers, rounded up. Opens WhatsApp and you choose the group',`<pre class="wa-pre">${esc(text)}</pre><div class="ctrl" style="gap:8px;margin-top:10px"><a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Send on WhatsApp</a><button type="button" class="btn" id="wa-copy">Copy text</button></div>`); }
function teamPlan(s,AG){
  const T=AG.T, list=AG.list.filter(a=>a.s===s.name); if(!T.left||!list.length||!s.k.acq.t) return '';
  const gains=list.filter(a=>a.k.acq.t).map(a=>({a,after:simLines(a,T.left).comm})).filter(g=>g.after-g.a.comm>=0.01).sort((x,y)=>(y.after-y.a.comm)-(x.after-x.a.comm)).slice(0,5);
  /* store overall after the plan: the extra lines are added to the STORE's own numbers */
  const units=gains.length*T.left, now=s.overall, sim=simLines(s,units), after=sim.ov;
  return sec('Team plan','What +1 acquisition a day from the agents who gain the most does to this store\'s overall',gains.length?`<p class="plan-msg">If these ${gains.length} agent${gains.length===1?'':'s'} each add <b>+1 acquisition a day</b> (${n(units)} lines), the store overall goes from <b>${pc(now,1)}</b> to <b>${pc(after,1)}</b>. Final commission: <b>${pc(s.comm,1)}</b> → <b>${pc(sim.comm,1)}</b>.</p>`+tbl(['Agent',['Overall now','num'],['With +1 a day','num']],gains.map(g=>`<tr><td class="name">${esc(g.a.n)}${dbtn('agent',g.a.key)}</td><td class="num">${pc(g.a.overall,1)}</td><td class="num"><b>${pc(simLines(g.a,T.left).ov,1)}</b></td></tr>`)):'<p class="note" style="margin:0">+1 acquisition a day does not move any agent by a full point. Use the Commission analysis screen for the bigger moves.</p>'); }

function loadXlsx(){ if(window.XLSX) return Promise.resolve(); return new Promise((ok,bad)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=ok; s.onerror=()=>bad(new Error('Could not load the Excel reader. Check the connection and try again.')); document.head.appendChild(s); }); }
function initUI(){ Object.assign(UI,{store:st.stores[0].name, planK:'acq', paceK:'acq', agStore:'all', agSort:'comm', agQ:'', agSel:null, simS:st.stores[0].name, simVals:{}, entryDate:null, entryAgentStore:st.stores[0].name, upload:null, uploadS:null, flash:'', confirmReset:false, confirmDel:null, meStore:null, meAgent:null, meDate:null, loginErr:''});
  try{ const v=localStorage.getItem('rpm-store'); if(v && st.stores.some(s=>s.name===v)) UI.store=v; }catch(e){} }
const typing=()=>{ const a=document.activeElement; return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
async function poll(){ if(document.hidden||DIRTY||typing()) return; try{ if(await fetchState()) route(); refreshHist(); }catch(e){} }
async function boot(){
  const fail=(t,n)=>{ document.getElementById('app').innerHTML='<div class="sec"><h2>'+t+'</h2><p class="note">'+n+'</p></div>'; };
  if(!API){ fail('Not configured','Open config.js and paste the Apps Script URL in API_URL.'); return; }
  try{ await Promise.all([fetchState(),checkAdmin()]); }
  catch(e){ const c=readCache(); if(!c){ fail('Cannot reach the server','Check the connection and reload the page.'); return; } VERSION=c.version; applyServer(c.state); ADMIN=false; }
  initUI(); route(); refreshHist();
  setInterval(poll,60000); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) poll(); });
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

/* =============== dates =============== */
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const D = s=>new Date(s+'T00:00:00Z');
const ds = d=>d.toISOString().slice(0,10);
const addDays=(s,n)=>{const d=D(s); d.setUTCDate(d.getUTCDate()+n); return ds(d)};
const dl = s=>{const d=D(s); return d.getUTCDate()+' '+MON[d.getUTCMonth()]};
const dl2 = s=>dl(s)+' '+D(s).getUTCFullYear();
const dow = s=>DOW[D(s).getUTCDay()];
function monthDays(){ const s=D(S().monthStart), y=s.getUTCFullYear(), m=s.getUTCMonth(), a=[]; for(let i=1;;i++){ const d=new Date(Date.UTC(y,m,i)); if(d.getUTCMonth()!==m) break; a.push(ds(d)); } return a; }
function dayW(x){ if(S().fridayHalf && D(x).getUTCDay()===5) return .5; if(S().holidays.includes(x)) return .5; return 1; }
function timing(asOf){ const days=monthDays(); let tot=0, el=0; days.forEach(x=>{ const w=dayW(x); tot+=w; if(x<=asOf) el+=w; });
  return {days, total:tot, elapsed:el, left:tot-el, progress:tot?el/tot:0, asOf, dim:days.length}; }
function entryDates(){ return Object.keys(st.daily).filter(d=>d>st.baseDate).sort(); }
function agentDates(){ return Object.keys(st.agentDaily).filter(d=>d>st.agentBaseDate).sort(); }
function lastDate(){ const e=entryDates(); return e.length? e[e.length-1] : st.baseDate; }
function lastAgentDate(){ const e=agentDates(); return e.length? e[e.length-1] : st.agentBaseDate; }
function weeks(T){ // sales weeks start on Saturday
  const out=[]; let cur=null;
  T.days.forEach(x=>{ const isStart = D(x).getUTCDay()===6 || !cur; if(isStart){ cur={from:x,to:x,cal:0,eff:0,ahead:0}; out.push(cur);} cur.to=x; cur.cal++; cur.eff+=dayW(x); if(x>T.asOf) cur.ahead+=dayW(x); });
  return out; }

/* =============== commission rules =============== */
function commission(x){ const s=S(); if(x<s.qual) return 0; if(x<s.bonusFrom) return x;
  for(const t of s.tiers){ if(x<=t.upTo) return x+t.bonus; } if(x<=s.flatUpTo) return s.flatVal; return x; }
function tierInfo(x){ const s=S(); if(x<s.qual) return {t:'bad',l:'No commission'}; if(x<s.bonusFrom) return {t:'warn',l:'No bonus'};
  for(const t of s.tiers){ if(x<=t.upTo) return {t:'good',l:'+'+Math.round(t.bonus*100)+' pts bonus'}; }
  if(x<=s.flatUpTo) return {t:'good',l:'Flat '+Math.round(s.flatVal*100)+'%'}; return {t:'good',l:'Raw overall'}; }
function cliffs(){ const s=S(); const c=[{v:s.qual,strict:true,l:'Qualify at '+Math.round(s.qual*100)+'%'},{v:s.bonusFrom,strict:true,l:'Reach '+Math.round(s.bonusFrom*100)+'% (+'+Math.round(s.tiers[0].bonus*100)+'% bonus)'}];
  s.tiers.forEach((t,i)=>{ const nb = s.tiers[i+1] ? '+'+Math.round(s.tiers[i+1].bonus*100)+'% bonus' : 'flat '+Math.round(s.flatVal*100)+'%'; c.push({v:t.upTo,strict:false,l:'Over '+Math.round(t.upTo*100)+'% ('+nb+')'}); });
  c.push({v:s.flatUpTo,strict:false,l:'Over '+Math.round(s.flatUpTo*100)+'% (raw overall paid)'}); return c; }
function nextCliff(x){ for(const c of cliffs()){ if(c.strict ? x<c.v : x<=c.v) return c; } return null; }

/* =============== calculation =============== */
function mk(t,m,T){ const rem=Math.max(0,t-m); return {t,m,pct:t?m/t:0, proj:(t&&T.elapsed)?m/T.elapsed*T.total/t:0, rem, daily:T.left?rem/T.left:0, run:T.elapsed?m/T.elapsed:0}; }
function applyCap(k){ // acquisition projection rule: capped unless High lines projection reaches the lift value
  const s=S(); k.acq.capped = !(k.high.proj>=s.acqLift); if(k.acq.capped) k.acq.proj=Math.min(k.acq.proj,s.acqCap); }
function overallOf(k){ const w=S().weights; return WK.reduce((a,x)=>a+(w[x]||0)*k[x].proj,0); }
function mtdStore(name, upto){ const o={...(st.storeBase[name]||{})}; KP.forEach(k=>o[k]=o[k]||0); Object.keys(st.daily).forEach(d=>{ if(d>st.baseDate && d<=upto){ const x=st.daily[d][name]; if(x) KP.forEach(k=>o[k]=(o[k]||0)+(+x[k]||0)); } }); return o; }
function computeStores(upto){
  const T=timing(upto);
  const arr = st.stores.map(def=>{
    const m=mtdStore(def.name,upto), t=Object.assign({},st.targets[def.name]); KP.forEach(x=>t[x]=t[x]||0); const k={};
    KP.forEach(x=>k[x]=mk(t[x],m[x],T));
    k.acq=mk(t.low+t.high+t.vf, m.low+m.high+m.vf, T); applyCap(k);
    const o={name:def.name, short:def.short, manager:def.manager, band:def.band, district:def.district, k, T};
    o.today=(upto>st.baseDate && st.daily[upto] && st.daily[upto][def.name]) ? {...st.daily[upto][def.name]} : {};
    KP.forEach(x=>o.today[x]=+o.today[x]||0); o.today.acq=o.today.low+o.today.high+o.today.vf;
    o.overall=overallOf(k); o.comm=commission(o.overall);
    // weighted MTD vs pace
    o.wm={}; WK.forEach(x=>o.wm[x]=k[x].pct*(S().weights[x]||0)); o.mtdOverall=WK.reduce((a,x)=>a+o.wm[x],0);
    o.expected=T.progress; o.ahead=o.mtdOverall-T.progress; o.closedToday=commission(o.mtdOverall);
    o.paceStatus = o.ahead>=0?'Ahead':o.ahead>=-.02?'Near pace':'Behind';
    return o; });
  const order=[...arr].sort((a,b)=>b.comm-a.comm||b.overall-a.overall); order.forEach((s,i)=>s.rank=i+1);
  const A={name:st.areaName||'Cairo Area', k:{}, today:{}, T};
  KPIS.forEach(({k})=>{ const t=arr.reduce((a,s)=>a+s.k[k].t,0), m=arr.reduce((a,s)=>a+s.k[k].m,0); const x=mk(t,m,T);
    x.proj=arr.reduce((a,s)=>a+s.k[k].proj,0)/arr.length; A.k[k]=x; A.today[k]=arr.reduce((a,s)=>a+s.today[k],0); });
  A.overall=arr.reduce((a,s)=>a+s.overall,0)/arr.length; A.comm=arr.reduce((a,s)=>a+s.comm,0)/arr.length;
  A.wm={}; WK.forEach(x=>A.wm[x]=arr.reduce((a,s)=>a+s.wm[x],0)/arr.length); A.mtdOverall=arr.reduce((a,s)=>a+s.mtdOverall,0)/arr.length;
  A.expected=T.progress; A.ahead=A.mtdOverall-T.progress; A.closedToday=arr.reduce((a,s)=>a+s.closedToday,0)/arr.length;
  A.paceStatus = A.ahead>=0?'Ahead':A.ahead>=-.02?'Near pace':'Behind';
  return {stores:arr, A, T};
}

/* next commission jump (works for a store, an agent or the simulator) */
const UNIT = {acq:'lines/day', term:'EGP/day', conn:'points/day', adsl:'ADSLs/day'};
/* Whole-number asks. Always rounded UP so the number is enough: never a fraction like 0.4. EGP rounds up to the next 1,000. ADSL is asked as a total over the days left (a per-day figure would overstate it). */
function whole(x){ return Math.max(0,Math.ceil(x-1e-9)); }
function needOf(x, extra, T){
  if(x==='adsl'){ const total=whole(extra*T.left); return {x, perDay:null, total, txt:n(total)+' more ADSL in the next '+n(T.left)+' days'}; }
  const amt = x==='term' ? Math.ceil(extra/1000-1e-9)*1000 : whole(extra);
  return {x, perDay:amt, total:amt*T.left, txt:'+'+(x==='term'?egp(amt):n(amt))+' '+(UNIT[x]||KMAP[x].unit+'/day')+' for the next '+n(T.left)+' days'}; }
function nextTier(o, T){
  const w=S().weights, c=nextCliff(o.overall);
  if(!c) return {top:true, text:'Top commission tier reached. Protect the overall through month-end.', label:'Top tier reached'};
  const target=c.v+.001, gap=target-o.overall, commNext=commission(target), jump=commNext-o.comm;
  const ratios={}, extras={};
  WK.forEach(x=>{ const k=o.k[x]; if(!w[x]||!k.t){ ratios[x]=999; extras[x]=0; return; }
    const delta=gap/w[x]; const extra=T.left? delta*k.t/T.left : 0; extras[x]=extra;
    const run=k.run; let r = run>0 ? (run+extra)/run : 999;
    if(x==='acq' && k.capped && k.proj+delta>S().acqCap+1e-9) r=999;
    ratios[x]=r; });
  let best=null; WK.forEach(x=>{ if(ratios[x]<998 && (best===null || ratios[x]<ratios[best])) best=x; });
  let need=null, ratioW=null, feas='Combine KPIs';
  if(best && T.left){ need=needOf(best,extras[best],T); const run=o.k[best].run, eff=need.perDay!=null?need.perDay:need.total/T.left; ratioW = run>0 ? (run+eff)/run : 999; feas = ratioW<=1.2?'Easy':ratioW<=1.5?'Stretch':'Hard'; }
  else if(best) feas='Hard';
  let text; if(!T.left) text='Month is over - this is the final overall.';
  else if(!best) text='No single KPI can close the gap alone. Combine two or more KPIs to cross '+c.l+'.';
  else { const k=o.k[best]; const runTxt=best==='term'?egp(k.run):n(k.run);
    text=(best==='adsl' ? 'Sell '+need.txt : 'Raise '+KMAP[best].short+' by '+need.txt+' (now about '+runTxt+'/day)')+' to cross '+c.l+'. Final commission '+pc(o.comm,1)+' -> '+pc(commNext,1)+'.'; }
  return {label:c.l, target, gap, commNext, jump, best, extra:best?extras[best]:0, ratio:best?ratios[best]:null, need, ratioW, feas, text, ratios, extras};
}

/* focus points */
function focusOf(o, T){
  const w=S().weights;
  const list = WK.filter(x=>w[x]).map(x=>({k:x, gain:w[x]*Math.max(0,1-o.k[x].proj)*100, proj:o.k[x].proj}));
  const sorted=[...list].sort((a,b)=>b.gain-a.gain);
  const strongest=[...list].sort((a,b)=>b.proj-a.proj)[0], weakest=[...list].sort((a,b)=>a.proj-b.proj)[0];
  const text = x=>{ const k=o.k[x.k], kd=KMAP[x.k]; const f=v=>kd.money?egp(v):kd.dec?v.toFixed(1):n(v);
    const ask = x.k==='adsl' ? n(whole(k.rem))+' more ADSL by month-end' : (kd.money?egp(Math.ceil(k.daily/1000-1e-9)*1000):n(whole(k.daily)))+' '+(UNIT[x.k]||KMAP[x.k].unit+'/day')+' for the next '+n(T.left)+' days';
    let s=kd.short+': on pace for '+pc(k.proj)+' of target. Needs '+ask+' (current run-rate '+f(k.run)+'/day'+(k.run>0&&x.k!=='adsl'?', '+(k.daily/k.run).toFixed(1)+'x':'')+'). Worth +'+x.gain.toFixed(1)+' pts overall.';
    if(x.k==='acq'){ const lines=['low','high','vf'].map(q=>({q,p:o.k[q].proj})).sort((a,b)=>a.p-b.p)[0]; s+=' Weakest line: '+KMAP[lines.q].short+' ('+pc(lines.p)+' proj.).'; }
    return s; };
  const f1 = sorted[0] && sorted[0].gain>0 ? text(sorted[0]) : 'All weighted KPIs are on or above target. Protect the current pace and stay on the daily numbers.';
  const f2 = sorted[1] && sorted[1].gain>0 ? text(sorted[1]) : 'No second priority - the remaining KPIs are on or above target.';
  return {strongest, weakest, f1, f2, sorted};
}

/* prepaid */
function prepaidOf(name, T){ const p=st.prepaid[name]||[0,0]; const gas=+p[0]||0, sold=+p[1]||0, cap=S().prepCap, allowed=gas*cap, avail=Math.max(0,allowed-sold);
  const status = sold>allowed+1e-9?'Over limit':(allowed>0&&sold>=S().prepNear*allowed)?'Near limit':'Within limit';
  const flex = sold>allowed ? Math.ceil(sold/cap-gas) : 0;
  return {gas, sold, allowed, avail, pct:gas?sold/gas:0, status, flex, flexDay:T.left?flex/T.left:0}; }

/* alerts */
function alertsOf(s, T, dataAsOfHasEntry){
  const pp=prepaidOf(s.name,T);
  const entered = s.today.acq>0, follow = s.today.term>0||s.today.conn>0||s.today.adsl>0;
  const avg = T.elapsed? s.k.acq.m/T.elapsed : 0; const spike = s.today.acq>S().spikeMin && avg>0 && s.today.acq>S().spikeX*avg;
  const below = WK.filter(x=>S().weights[x]&&s.k[x].t&&s.k[x].proj<S().qual).length;
  const data = (entered?0:1)+(follow?0:1)+(spike?1:0), perf=(s.overall<S().qual?1:0)+below, prep=(pp.status!=='Within limit'?1:0);
  const total=data+perf+prep;
  return {entered, follow, spike, below, data, perf, prep, total, level: total===0?'Clear':total===1?'Watch':'Action', pp,
    lowBehind:s.k.low.proj<S().lowGoal, highBehind:s.k.high.proj<S().highGoal}; }

/* agents */
function agentKey(a){ return a.s+'|'+a.n; }
function computeAgents(){
  const upto=lastAgentDate(), T=timing(upto), byS=Object.fromEntries(st.stores.map(s=>[s.name,s]));
  const list = st.agentBase.filter(a=>byS[a.s]).map(a=>{
    const m={...a.m}; KP.forEach(x=>m[x]=m[x]||0); Object.keys(st.agentDaily).forEach(d=>{ if(d>st.agentBaseDate&&d<=upto){ const x=st.agentDaily[d][agentKey(a)]; if(x) KP.forEach(k=>m[k]=(m[k]||0)+(+x[k]||0)); } });
    const k={}; KP.forEach(x=>k[x]=mk(a.t[x]||0,m[x],T)); k.acq=mk((a.t.low||0)+(a.t.high||0)+(a.t.vf||0), m.low+m.high+m.vf, T); applyCap(k);
    const o={s:a.s, n:a.n, area:a.area, key:agentKey(a), k, T, base:a}; o.overall=overallOf(k); o.comm=commission(o.overall); return o; });
  const sorted=[...list].sort((a,b)=>b.comm-a.comm||b.overall-a.overall); sorted.forEach((a,i)=>a.rank=i+1);
  st.stores.forEach(s=>{ list.filter(a=>a.s===s.name).sort((a,b)=>b.overall-a.overall).forEach((a,i,arr)=>{a.rankStore=i+1; a.storeCount=arr.length;}); });
  return {list, T, upto};
}
function agentToday(a, upto){ return (upto>st.agentBaseDate && st.agentDaily[upto] && st.agentDaily[upto][a.key]) || null; }

/* =============== formatting =============== */
const n = x=>Math.round(x).toLocaleString('en-US');
const pc = (x,d=0)=>(x*100).toFixed(d)+'%';
const egp = x=> Math.abs(x)>=1e6 ? (x/1e6).toFixed(2)+'M' : Math.abs(x)>=1e3 ? Math.round(x/1e3)+'K' : n(x);
const val = (kd,x)=> kd.money ? egp(x) : kd.dec ? (x%1? x.toFixed(1):n(x)) : n(x);
const per = (kd,x)=> kd.money ? egp(Math.ceil(x/1000-1e-9)*1000) : n(whole(x));
const tone = p => p>=1 ? 'good' : p>=S().qual ? 'warn' : 'bad';
const label = p => p>=1 ? 'On track' : p>=S().qual ? 'Watch' : 'At risk';
const esc = s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sgn = (x,d=1,suf='')=>(x>=0?'+':'−')+Math.abs(x).toFixed(d)+suf;
const bar = (p,mark)=>`<span class="bar" role="img" aria-label="${pc(p)} of target"><i style="width:${Math.max(0,Math.min(p,1))*100}%"></i>${mark==null?'':`<b style="left:${mark*100}%"></b>`}</span>`;
const chip = (p,txt)=>`<span class="chip ${tone(p)}">${txt??pc(p,1)}</span>`;
const dash = '<span class="muted">–</span>';
const commCell = (c,o)=>{ const t=tierInfo(o); return `<span class="cc"><span class="comm">${pc(c,1)}</span><span class="chip ${t.t}">${t.l}</span></span>`; };
const heat = p=>`<td class="heat ${tone(p)}">${pc(p)}</td>`;
const stripTags=s=>String(s).replace(/<[^>]*>/g,'');
const tbl = (cols, rows, o={})=>{ const labels=cols.map((c,i)=>{ const l=stripTags(Array.isArray(c)?c[0]:c); return o.lab?o.lab(i,l):l; });
  const ni=labels[0]==='#'?1:0, keys=o.k||[ni+1,ni+2,ni+3], keyAll=[ni,...keys]; const flat=o.flat||rows.length<=4||rows.some(r=>String(r).includes('<input'));
  const rr=rows.map(r=>{ let i=0; return String(r).replace(/<td([^>]*)>/g,(m,at)=>{ const cs=/colspan="(\d+)"/.exec(at); const lab=labels[i]||''; const isName=/class="[^"]*name/.test(at); const isK=!isName&&keyAll.includes(i); i+=cs?+cs[1]:1;
      if(isK) at=/class="/.test(at)?at.replace('class="','class="k '):at+' class="k"'; return `<td${at} data-l="${esc(lab)}">`; }); });
  return `<div class="scroll"><table class="rt${flat?' flat':''}"><thead>${o.groups?`<tr>${o.groups}</tr>`:''}<tr>${cols.map(c=>{ const [l,cl]=Array.isArray(c)?c:[c,'']; return `<th class="${cl}">${l}</th>`}).join('')}</tr></thead><tbody>${rr.join('')||`<tr><td colspan="${cols.length}" class="muted">Nothing to show.</td></tr>`}</tbody></table></div>`; };
const sec = (title,sub,body,extra='')=>`<section class="sec ${extra}"><div class="sec-h"><h2>${title}</h2>${sub?`<p>${sub}</p>`:''}</div>${body}</section>`;
const head = (eb,title,right='')=>`<div class="head"><div><div class="eyebrow">${eb}</div><h1>${title}</h1></div>${right}</div>`;
const tile = (eb,v,s,cls='',extra='')=>`<div class="tile ${cls}"><div class="eyebrow">${eb}</div><div class="v">${v}</div><div class="s">${s}</div>${extra}</div>`;
const seg = (items,cur,attr)=>`<div class="seg" role="group">${items.map(([k,l])=>`<button type="button" ${attr}="${k}" aria-pressed="${k===cur}">${l}</button>`).join('')}</div>`;
const sel = (id,opts,cur,aria)=>`<select id="${id}" aria-label="${aria||id}">${opts.map(([k,l])=>`<option value="${esc(k)}" ${k===cur?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
const storeOpts = ()=>st.stores.map(s=>[s.name,s.name]);

/* =============== charts =============== */
function niceTicks(min,max,cnt=5){ if(min===max){ max=min+1; } const span=max-min, step0=span/cnt, mag=Math.pow(10,Math.floor(Math.log10(step0))), r=step0/mag;
  const step=(r<=1?1:r<=2?2:r<=5?5:10)*mag, lo=Math.floor(min/step+1e-9)*step, hi=Math.ceil(max/step-1e-9)*step, t=[]; for(let v=lo; v<=hi+step/2; v+=step) t.push(+v.toFixed(10)); return t; }
function lineChart({labels, series, fmt=v=>pc(v), h=250, min, max, refs=[], every=1, dots=false}){
  const W=680, H=h, pl=48, pr=14, pt=10, pb=26; let vals=series.flatMap(s=>s.vals.filter(v=>v!=null)); refs.forEach(r=>vals.push(r.y));
  if(!vals.length) return '<p class="muted">No data yet.</p>';
  const tk=niceTicks(min??Math.min(...vals), max??Math.max(...vals)); const lo=tk[0], hi=tk[tk.length-1];
  const x=i=>pl+(labels.length<2?(W-pl-pr)/2:i*(W-pl-pr)/(labels.length-1)), y=v=>pt+(hi-v)*(H-pt-pb)/(hi-lo);
  let g=tk.map(v=>`<line class="gl" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`).join('');
  g+=labels.map((l,i)=> i%every===0 ? `<text x="${x(i)}" y="${H-8}" text-anchor="middle">${l}</text>`:'').join('');
  g+=refs.map(r=>`<line x1="${pl}" x2="${W-pr}" y1="${y(r.y)}" y2="${y(r.y)}" stroke="var(--c3)" stroke-dasharray="4 4"/><text x="${pl+4}" y="${y(r.y)-4}" text-anchor="start">${r.l}</text>`).join('');
  series.forEach(s=>{ let d='', pen=false; s.vals.forEach((v,i)=>{ if(v==null){pen=false;return;} d+=(pen?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)+' '; pen=true; });
    g+=`<path class="ln" d="${d}" style="stroke:${s.color};${s.dash?'stroke-dasharray:6 4;':''}"/>`;
    const pts=s.vals.map((v,i)=>v==null?null:i).filter(i=>i!=null); const show = dots||pts.length<4 ? pts : [pts[pts.length-1]];
    g+=show.map(i=>`<circle cx="${x(i)}" cy="${y(s.vals[i])}" r="3.4" fill="${s.color}"><title>${labels[i]}: ${fmt(s.vals[i])}</title></circle>`).join(''); });
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${g}</svg>`; }
const legend = s=>s.map(x=>`<span class="lg"><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('');
function hbars(items,max,fmtV){ const m=max||Math.max(1,...items.map(i=>i.v)); return `<div class="hbars">${items.map(i=>`<div class="hrow"><span>${esc(i.l)}</span><span class="bar" role="img" aria-label="${esc(i.l)} ${fmtV(i.v)}"><i style="width:${Math.max(0,i.v)/m*100}%"></i>${i.mark!=null?`<b style="left:${i.mark/m*100}%"></b>`:''}</span><span class="num">${fmtV(i.v)}</span></div>`).join('')}</div>`; }

/* =============== context for the current render =============== */
let CX, ST, A, T, UI={};
function setStore(v){ UI.store=v; try{localStorage.setItem('rpm-store',v)}catch(e){} }
function refresh(){
  CX=computeStores(lastDate()); ST=CX.stores; A=CX.A; T=CX.T;
  ST.forEach(s=>s.pp=prepaidOf(s.name,T)); if(!ST.some(s=>s.name===UI.store)) UI.store=ST[0].name;
  const e=entryDates(); const prevDate = e.length>1 ? e[e.length-2] : (e.length===1 ? st.baseDate : null);
  CX.prev = prevDate ? computeStores(prevDate) : null;
}
const byName = n=>ST.find(s=>s.name===n);
const sortedByRank = ()=>[...ST].sort((a,b)=>a.rank-b.rank);
const statusChip = o=>chip(o.overall,label(o.overall));
const todayLbl = ()=> T.asOf>st.baseDate ? dl(T.asOf) : 'company report';


/* =============== navigation =============== */
const NAV = [
 ['Overview',[['area','Dashboard']]],
 ['Stores',[['store','Store card'],['scorecard','KPI overview'],['focus','Focus points'],['next','Next commission tier'],['mystore','My sales (store view)']]],
 ['Plan & pace',[['plan','Weekly plan'],['pace','Pace & MTD'],['lowhigh','Low & High lines'],['daily','Daily & trend']]],
 ['Control',[['prepaid','Prepaid control']]],
 ['People',[['agents','Agents'],['payout','Commission analysis'],['me','My sales (employee view)']]],
 ['Admin',[['entry','Enter data'],['setup','Setup & targets']]]
];
function renderNav(t){
  document.getElementById('side').innerHTML = NAV.map(([g,items])=>`<div><h4>${g}</h4>${items.map(([k,l])=>`<a href="#${k}" ${k===t?'aria-current="page"':''}>${l}${(k==='entry'||k==='setup')&&!ADMIN?' 🔒':''}</a>`).join('')}</div>`).join('');
}


const stBadge=s=>s.rank<=3?`<span class="topb t${s.rank}" title="Top 3 store">★ ${s.rank}</span>`:'';
const dbtn=(kind,v,to)=>`<button type="button" class="btn sm" data-${kind}="${esc(v)}"${to?` data-to="${to}"`:''}>Details</button>`;
/* =============== Dashboard =============== */
const fuHead = ()=>FU.map(k=>[KMAP[k].short,'num']);
const fuHeat = s=>FU.map(k=>heat(s.k[k].proj)).join('');
function viewArea(){
  const a=A.k.acq, sorted=sortedByRank(), maxToday=Math.max(1,...ST.map(s=>s.today.acq));
  const near=[...ST].map(s=>({s,nt:nextTier(s,T)})).filter(x=>!x.nt.top).sort((x,y)=>x.nt.gap-y.nt.gap).slice(0,3);
  const help=[...ST].sort((x,y)=>x.overall-y.overall).slice(0,3);
  const acqBar=x=>`<div class="cellbar"><span class="num cb-n">${n(x.m)}</span>${bar(x.pct,T.progress)}<span class="num muted cb-p">${pc(x.pct)}</span></div>`;
  return `
  ${head(`${MON[D(S().monthStart).getUTCMonth()]} ${D(S().monthStart).getUTCFullYear()} · Day ${n(T.elapsed)} of ${n(T.total)}`,esc(st.areaName)+' dashboard',`<div class="note">Dark tick on a bar = where the month says you should be (${pc(T.progress,1)})</div>`)}
  <div class="tiles">
    ${tile('Final commission',pc(A.comm,1),`Area average of store final commissions · overall ${pc(A.overall,1)}`,'hero')}
    ${tile('Overall',pc(A.overall,1),`${tierInfo(A.overall).l} · ${ST.filter(s=>s.overall>=1).length} of ${ST.length} stores at 100%+`)}
    ${tile('Acquisition MTD',n(a.m),`of ${n(a.t)} target · ${pc(a.pct,1)}${T.asOf>st.baseDate?` · <span class="plus">+${n(A.today.acq)} on ${dl(T.asOf)}</span>`:''}`,'',bar(a.pct,T.progress))}
    ${tile('Acquisition projection',pc(a.proj,1),`Month progress ${pc(T.progress,1)}`)}
    ${tile('Daily acquisition required',n(whole(a.daily)),`per day · ${n(T.left)} days left to reach 100%`)}
    ${tile('If the month closed today',pc(A.closedToday,1),`Area final commission on MTD overall ${pc(A.mtdOverall,1)} · ${A.paceStatus.toLowerCase()} vs pace ${sgn(A.ahead*100,1,' pts')}`)}
  </div>
  ${sec('Store leaderboard','Ranked by final commission · ★ = top 3 stores · press Details to open the store card',tbl(['#','Store',['Overall','num'],['Final commission','num'],'Acquisition MTD',['Acq proj.','num'],['Today','num'],'Status'],
    sorted.map(s=>`<tr><td>${s.rank}</td><td class="name">${stBadge(s)}${esc(s.name)}${dbtn('store',s.name)}</td><td class="num">${pc(s.overall,1)}</td><td class="num">${commCell(s.comm,s.overall)}</td>
    <td>${acqBar(s.k.acq)}</td><td class="num">${pc(s.k.acq.proj,1)}</td><td class="num plus">${s.today.acq?'+'+n(s.today.acq):dash}</td><td>${statusChip(s)}</td></tr>`).concat(
    `<tr class="area"><td></td><td class="name">${esc(st.areaName)}</td><td class="num">${pc(A.overall,1)}</td><td class="num">${commCell(A.comm,A.overall)}</td><td>${acqBar(a)}</td><td class="num">${pc(a.proj,1)}</td><td class="num plus">${A.today.acq?'+'+n(A.today.acq):dash}</td><td></td></tr>`),{k:[2,3,5]})) }
  ${sec('Projection heat-map','Projected % of target at month-end pace · green ≥ 100% · amber 70–99% · red < 70% (no commission)',tbl(['Store',['Acquisition','num'],...fuHead(),['Overall','num'],['Final commission','num']],
    [...ST,A].map(s=>`<tr class="${s===A?'area':''}"><td class="name">${esc(s.name)}</td>${heat(s.k.acq.proj)}${fuHeat(s)}${heat(s.overall)}<td class="num comm">${pc(s.comm,1)}</td></tr>`)))}
  <div class="two wide">
  ${sec('Next commission jump','The three stores closest to the next commission step',tbl(['Store',['Overall','num'],'Next jump at',['Gap','num'],['Final commission at next','num'],'Best lever'],
    near.map(({s,nt})=>`<tr><td class="name">${esc(s.short)}${dbtn('store',s.name,'next')}</td><td class="num">${pc(s.overall,1)}</td><td>${esc(nt.label)}</td><td class="num">${pc(nt.gap,1)}</td><td class="num">${pc(nt.commNext,1)}</td><td>${nt.best?KMAP[nt.best].short+' ('+nt.feas+')':nt.feas}</td></tr>`)))}
  ${sec('Who needs help today','Lowest overall, with the first focus point',`<div class="help">${help.map(s=>`<div class="helprow"><div class="ctrl" style="justify-content:space-between"><b>${esc(s.name)}</b><span>${statusChip(s)} <span class="muted">${pc(s.overall,1)}</span></span></div><div class="note">${esc(focusOf(s,T).f1)}</div></div>`).join('')}</div>`)}
  </div>
  ${sec('Daily required to hit 100%',`Remaining to target ÷ ${n(T.left)} days left`,tbl(['Store',['Acq remaining','num'],['Acq / day','num'],['Low / day','num'],['High / day','num'],...FU.map(k=>[KMAP[k].short+' / day','num'])],
    [...ST,A].map(s=>`<tr class="${s===A?'area':''}"><td class="name">${esc(s.name)}</td><td class="num">${n(s.k.acq.rem)}</td><td class="num">${n(whole(s.k.acq.daily))}</td><td class="num">${n(whole(s.k.low.daily))}</td><td class="num">${n(whole(s.k.high.daily))}</td>${FU.map(k=>`<td class="num">${per(KMAP[k],s.k[k].daily)}</td>`).join('')}</tr>`)))}
  ${T.asOf>st.baseDate? sec(`Sales added on ${dl(T.asOf)}`,`Acquisition (low + high + VF Cash) by store · area total ${n(A.today.acq)}`,hbars([...ST].sort((x,y)=>y.today.acq-x.today.acq).map(s=>({l:s.short,v:s.today.acq})),maxToday,v=>`<b>${n(v)}</b>`)):''}`;
}

/* =============== Store card =============== */
function viewStore(){
  const s=byName(UI.store); if(!s) return head('Store card','No stores yet');
  const nt=nextTier(s,T), f=focusOf(s,T), pp=s.pp, AGx=computeAgents(), ag=AGx.list.filter(a=>a.s===s.name).sort((x,y)=>y.overall-x.overall);
  const ws=weeks(T), acqNeeded=s.k.acq.rem, eff=ws.reduce((a,w)=>a+w.ahead,0);
  const wkShare=w=> eff? s.k.acq.rem*w.ahead/eff : 0;
  const cb=x=>`<div class="cellbar">${bar(x.pct,T.progress)}<span class="num cb-p">${pc(x.pct)}</span></div>`;
  return `
  ${head('Store card',stBadge(s)+esc(s.name),`<label class="ctrl"><span class="muted">Store</span>${sel('store-sel',storeOpts(),s.name,'Store')}</label>`)}
  <p class="note" style="margin:-8px 0 0">${esc(s.manager||'')}${s.manager?' · ':''}${esc(s.band||'')}${s.band?' band · ':''}${esc(s.district||'')}</p>
  <div class="tiles">
    ${tile('Final commission',pc(s.comm,1),`${tierInfo(s.overall).l} · overall ${pc(s.overall,1)} · area ${pc(A.comm,1)}`,'hero')}
    ${tile('Overall',pc(s.overall,1),`Area average ${pc(A.overall,1)}`)}
    ${tile('Rank',`${s.rank} of ${ST.length}`,'by final commission')}
    ${tile('Status',statusChip(s),`Best KPI: ${KMAP[f.strongest.k].short} (${pc(f.strongest.proj)}) · weakest: ${KMAP[f.weakest.k].short} (${pc(f.weakest.proj)})`)}
    ${tile('If the month closed today',pc(s.closedToday,1),`MTD overall ${pc(s.mtdOverall,1)} vs expected ${pc(s.expected,1)} · ${s.paceStatus.toLowerCase()}`)}
    ${tile('Sales added latest day',n(s.today.acq),`acquisition on ${T.asOf>st.baseDate?dl(T.asOf):'company report'}`)}
  </div>
  ${sec('KPI overview',`Sales added on ${todayLbl()} shown under Today`,tbl(['KPI',['Target','num'],['MTD','num'],'MTD %',['Projection','num'],['vs Area','num'],['Remaining','num'],['Daily req.','num'],['Today','num']],
    KPIS.map(kd=>{ const x=s.k[kd.k], ar=A.k[kd.k]; if(!x.t) return ''; const d=(x.proj-ar.proj)*100;
      return `<tr><td class="name">${kd.label}${kd.w?` <span class="muted">· ${pc(S().weights[kd.w]||0)}</span>`:''}</td><td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,x.m)}</td><td>${cb(x)}</td><td class="num">${chip(x.proj,pc(x.proj,1))}</td><td class="num ${d>=0?'plus':'minus'}">${sgn(d)}</td><td class="num">${val(kd,x.rem)}</td><td class="num">${per(kd,x.daily)}</td><td class="num plus">${s.today[kd.k]?'+'+val(kd,s.today[kd.k]):dash}</td></tr>`}))) }
  <div class="two">
  ${sec('Next commission jump',esc(nt.label||''),nt.top?`<p>${esc(nt.text)}</p>`:`<div class="tiles tiles3">${tile('Gap',pc(nt.gap,1),'overall points')}${tile('Final commission at next',pc(nt.commNext,1),'jump '+sgn(nt.jump*100,1,' pts'))}${tile('Feasibility',nt.feas,nt.best?KMAP[nt.best].short+' is the best lever':'')}</div><p style="margin:12px 0 0">${esc(nt.text)}</p>`)}
  ${sec('Focus points','The two KPIs where this store can gain the most',`<div class="cards one"><div><b>Focus #1</b><p style="margin:4px 0 0">${esc(f.f1)}</p></div><div><b>Focus #2</b><p style="margin:4px 0 0">${esc(f.f2)}</p></div><div><b>Manager note</b><input type="text" data-note="${esc(s.name)}" value="${esc(st.notes[s.name]||'')}" placeholder="Type a note for this store" aria-label="Manager note" style="margin-top:6px"></div></div>`)}
  </div>
  <div class="two">
  ${sec('Weighted MTD vs pace','MTD % of target × weight, against the share of the month gone',tbl(['KPI',['Weight','num'],['MTD (weighted)','num'],['vs pace','num']],WK.map(x=>{const exp=(S().weights[x]||0)*T.progress, d=s.wm[x]-exp; return `<tr><td class="name">${KMAP[x].short}</td><td class="num">${pc(S().weights[x]||0)}</td><td class="num">${pc(s.wm[x],1)}</td><td class="num ${d>=0?'plus':'minus'}">${sgn(d*100,1,' pts')}</td></tr>`}).concat(`<tr class="area"><td class="name">Overall</td><td class="num">${pc(1)}</td><td class="num">${pc(s.mtdOverall,1)}</td><td class="num ${s.ahead>=0?'plus':'minus'}">${sgn(s.ahead*100,1,' pts')}</td></tr>`)))}
  ${sec('Prepaid control',`Cap ${pc(S().prepCap)} of GAs`,`<div class="tiles tiles3">${tile('Sold prepaid',n(pp.sold),`of ${n(pp.allowed)} allowed`)}${tile('Prepaid % of GAs',pc(pp.pct,1),pp.status)}${tile('Room left',n(pp.avail),'prepaid can still be sold')}</div>`)}
  </div>
  ${sec('Weekly acquisition plan','What this store must still sell, spread by working days',tbl(['Week',['Working days left','num'],['Acquisition to sell','num']],ws.filter(w=>w.ahead>0).map(w=>`<tr><td class="name">${dl(w.from)} – ${dl(w.to)}</td><td class="num">${w.ahead}</td><td class="num"><b>${n(wkShare(w))}</b></td></tr>`).concat(`<tr class="area"><td class="name">Total remaining</td><td class="num">${eff}</td><td class="num">${n(acqNeeded)}</td></tr>`)))}
  ${storeShare(s,AGx)}
  ${teamPlan(s,AGx)}
  ${sec('Agents in this store',`${ag.length} agents · company file of ${dl(computeAgents().upto)} · <a href="#agents" data-store="${esc(s.name)}" data-to="agents" style="color:var(--accent)">Open agents view</a>`,agentTable(ag,false))}`;
}

/* =============== Scorecard =============== */
function viewScorecard(){
  const rows=[...ST,A];
  const grp=kk=>kk.map(k=>`<th class="grp" colspan="5">${KMAP[k].label}</th>`).join('');
  const cols=kk=>kk.flatMap(k=>[[KMAP[k].short+' target','num'],[KMAP[k].short+' MTD','num'],[KMAP[k].short+' MTD %','num'],[KMAP[k].short+' proj.','num'],[KMAP[k].short+' daily','num']]);
  const cells=(s,kk)=>kk.map(k=>{ const x=s.k[k], kd=KMAP[k]; return `<td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,x.m)}</td><td class="num">${pc(x.pct,1)}</td>${heat(x.proj)}<td class="num">${per(kd,x.daily)}</td>`}).join('');
  const block=(title,sub,kk)=>sec(title,sub,tbl([['Store','sticky1'],...cols(kk)],rows.map(s=>`<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td>${cells(s,kk)}</tr>`),{groups:`<th class="sticky1"></th>${grp(kk)}`}));
  const w=S().weights;
  return `${head('Store × KPI','KPI overview','<div class="note">Area projection and overall = simple average of the stores</div>')}
  ${block('Acquisition','Low + High + VF Cash = Total acquisition. Acquisition projection is capped at 100% unless High lines reach 100%.',['low','high','vf','acq'])}
  ${block('Follow-up KPIs',FU.map(k=>KMAP[k].short).join(', '),FU)}
  ${sec('Weighted overall and final commission','Each KPI projection × its weight',tbl([['Store','sticky1'],['Acq proj.','num'],['Acq weighted','num'],...FU.map(k=>[KMAP[k].short+' weighted','num']),['Overall','num'],['Final commission','num'],['Acq vs weight','num'],['Follow-up vs weight','num']],
    rows.map(s=>{ const acqW=(w.acq||0)*s.k.acq.proj, fw=FU.reduce((a,k)=>a+(w[k]||0)*s.k[k].proj,0), fwt=FU.reduce((a,k)=>a+(w[k]||0),0); return `<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td><td class="num">${pc(s.k.acq.proj,1)}</td><td class="num">${pc(acqW,1)}</td>${FU.map(k=>`<td class="num">${pc((w[k]||0)*s.k[k].proj,1)}</td>`).join('')}<td class="num"><b>${pc(s.overall,1)}</b></td><td class="num">${commCell(s.comm,s.overall)}</td><td class="num ${acqW-(w.acq||0)>=0?'plus':'minus'}">${sgn((acqW-(w.acq||0))*100,1,' pts')}</td><td class="num ${fw-fwt>=0?'plus':'minus'}">${sgn((fw-fwt)*100,1,' pts')}</td></tr>`})))}`;
}

/* =============== Daily & trend =============== */
function viewDaily(){
  const days=T.days;
  const cumAct=days.map(d=>{ if(d<st.baseDate||d>T.asOf) return null; return (d===st.baseDate||st.daily[d]) ? computeStores(d).A.k.acq.m : null; });
  let effC=0; const pace=days.map(d=>{ effC+=dayW(d); return A.k.acq.t*effC/T.total; });
  const rowsD=entryDates().map(d=>{ const o={d}; KP.forEach(k=>o[k]=0); st.stores.forEach(s=>{ const x=(st.daily[d]||{})[s.name]||{}; KP.forEach(k=>o[k]+=+x[k]||0); }); return o; });
  const pv=CX.prev, moved=ST.map(s=>{ const p=pv?pv.stores.find(x=>x.name===s.name):null; return {s,p,mv:p?p.rank-s.rank:0}; });
  const acc=ST.filter(s=>s.k.acq.run&&s.today.acq>s.k.acq.run*1.1).length, slow=ST.filter(s=>s.k.acq.run&&s.today.acq&&s.today.acq<s.k.acq.run*.9).length;
  const climb=[...moved].sort((a,b)=>b.mv-a.mv)[0], fall=[...moved].sort((a,b)=>a.mv-b.mv)[0];
  const trend=(a,b)=>{ const v=b?a/b-1:null; return v==null?dash:`<span class="${v>=0?'plus':'minus'}">${sgn(v*100,0,'%')}</span>`; };
  const baseAcq=ST.reduce((a,s)=>a+(st.storeBase[s.name].low||0)+(st.storeBase[s.name].high||0)+(st.storeBase[s.name].vf||0),0);
  return `${head(`As of ${dl2(T.asOf)}`,'Daily & trend','<div class="note">Day-by-day numbers, and who is speeding up or slowing down</div>')}
  ${sec('Cumulative acquisition vs pace','Area · each saved day adds a point',`<div style="margin-bottom:6px">${legend([{name:'Actual (MTD)',color:'var(--accent)'},{name:'Straight-line pace',color:'var(--c3)'}])}</div>${lineChart({labels:days.map(d=>String(D(d).getUTCDate())),series:[{name:'Actual',vals:cumAct,color:'var(--accent)'},{name:'Pace',vals:pace,color:'var(--c3)',dash:true}],fmt:v=>n(v),every:2,min:0,dots:true})}<p class="note" style="margin:8px 0 0">The company report is one point. Days before its date are not shown because the company sends cumulative totals.</p>`)}
  <div class="tiles">${tile('Accelerating stores',acc,`of ${ST.length} · latest day above run-rate by 10%+`)}${tile('Slowing stores',slow,'latest day below run-rate by 10%+')}${tile('Biggest climber',climb&&climb.mv>0?esc(climb.s.short):'n/a',climb&&climb.mv>0?`up ${climb.mv} place(s) since the previous day`:'no rank move yet')}${tile('Biggest faller',fall&&fall.mv<0?esc(fall.s.short):'n/a',fall&&fall.mv<0?`down ${-fall.mv} place(s)`:'no rank move yet')}</div>
  ${sec('Store trend board','Latest day against the store run-rate (MTD ÷ working days), and rank move since the previous report',tbl([['Store','sticky1'],['Acq latest day','num'],['Acq run-rate / day','num'],['Acq change','num'],...FU.map(k=>[KMAP[k].short+' vs run-rate','num']),['Overall now','num'],['Overall before','num'],['Overall change','num'],['Rank now','num'],['Rank before','num'],['Move','num']],
    moved.map(({s,p,mv})=>`<tr><td class="name sticky1">${esc(s.name)}</td><td class="num">${s.today.acq?n(s.today.acq):dash}</td><td class="num">${s.k.acq.run.toFixed(1)}</td><td class="num">${s.today.acq?trend(s.today.acq,s.k.acq.run):dash}</td>${FU.map(k=>`<td class="num">${s.today[k]?trend(s.today[k],s.k[k].run):dash}</td>`).join('')}<td class="num">${pc(s.overall,1)}</td><td class="num">${p?pc(p.overall,1):dash}</td><td class="num">${p?`<span class="${s.overall>=p.overall?'plus':'minus'}">${sgn((s.overall-p.overall)*100,1)}</span>`:dash}</td><td class="num">${s.rank}</td><td class="num">${p?p.rank:dash}</td><td class="num">${p?(mv>0?`<span class="plus">▲ ${mv}</span>`:mv<0?`<span class="minus">▼ ${-mv}</span>`:'–'):dash}</td></tr>`)))}
  ${sec('Daily totals (area)','Sales added each day, from the Enter data screen',tbl(['Date','Day',['Total acq.','num'],...KP.map(k=>[KMAP[k].short+(KMAP[k].money?' (EGP)':''),'num'])],
    [`<tr class="area"><td>${dl(st.baseDate)}</td><td>${dow(st.baseDate)}</td><td colspan="${KP.length+1}" class="muted">Company report (starting point: acquisition ${n(baseAcq)})</td></tr>`].concat(rowsD.map(r=>`<tr><td>${dl(r.d)}</td><td>${dow(r.d)}</td><td class="num"><b>${n(r.low+r.high+r.vf)}</b></td>${KP.map(k=>`<td class="num">${KMAP[k].money?egp(r[k]):n(r[k])}</td>`).join('')}</tr>`))))}`;
}

/* =============== Agents (company file, exactly as uploaded) =============== */
function agentTable(list, showStore){ const bs0=2+(showStore?1:0);
  return tbl(['#',['Agent','sticky1'],...(showStore?['Store']:[]),['Acquisition','num'],'MTD %',['Acq proj.','num'],...fuHead(),['Overall','num'],['Commission','num'],['Acq / day','num'],['Move','num']],
    list.map((a,i)=>{ const pcell=x=>a.k[x].t?chip(a.k[x].proj,pc(a.k[x].proj)):dash; const bs=byName(a.s);
      return `<tr class="${a.rank<=10?'top10':''}"><td>${a.rank}</td><td class="name sticky1">${a.rank<=10?`<span class="topb t${a.rank<=3?a.rank:''}" title="Top 10 in the area">★ ${a.rank}</span>`:''}${esc(a.n)}${dbtn('agent',a.key)}</td>${showStore?`<td>${esc(bs?bs.short:a.s)}</td>`:''}<td class="num">${n(a.k.acq.m)} / ${n(a.k.acq.t)}</td><td>${bar(a.k.acq.pct,a.T.progress)}</td><td class="num">${pcell('acq')}</td>${FU.map(k=>`<td class="num">${pcell(k)}</td>`).join('')}<td class="num">${pc(a.overall,1)}</td><td class="num">${commCell(a.comm,a.overall)}</td><td class="num">${n(whole(a.k.acq.daily))}</td><td class="num">${moveCell(moveOf(a))}</td></tr>`}),{k:[bs0,bs0+3+FU.length,bs0+4+FU.length]});
}
function agentCard(a,AG){
  const nt=nextTier(a,AG.T), bs=byName(a.s);
  return sec(`${esc(a.n)} · ${esc(bs?bs.short:a.s)}`,`Rank ${a.rankStore} of ${a.storeCount} in store · ${a.rank} of ${AG.list.length} in area · <a href="#" data-close="1" style="color:var(--accent)">Close</a>`,
   `<div class="tiles" style="margin-bottom:12px">${tile('Final commission',pc(a.comm,1),tierInfo(a.overall).l,'hero')}${tile('Overall',pc(a.overall,1),chip(a.overall,label(a.overall)))}${tile('Acquisition',`${n(a.k.acq.m)} / ${n(a.k.acq.t)}`,`${pc(a.k.acq.pct,1)} MTD · ${pc(a.k.acq.proj,1)} projected`,'',bar(a.k.acq.pct,AG.T.progress))}${tile('Needed per day',n(whole(a.k.acq.daily)),`acquisition lines for ${n(AG.T.left)} days`)}</div>
   ${tbl(['KPI',['Target','num'],['MTD','num'],'MTD %',['Projection','num'],['Remaining','num'],['Daily req.','num']],KPIS.map(kd=>{ const x=a.k[kd.k]; if(!x.t) return ''; return `<tr><td class="name">${kd.label}</td><td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,x.m)}</td><td>${bar(x.pct,AG.T.progress)}</td><td class="num">${chip(x.proj,pc(x.proj,1))}</td><td class="num">${val(kd,x.rem)}</td><td class="num">${per(kd,x.daily)}</td></tr>`}))}
   <p style="margin:12px 0 0"><b>Next jump:</b> ${esc(nt.label||'Top tier')} · ${esc(nt.text)}</p>`);
}

/* =============== Focus points =============== */
function viewFocus(){
  const best=sortedByRank()[0], worst=sortedByRank()[ST.length-1], a=A.k.acq, on=ST.filter(s=>s.overall>=1).length, wa=ST.filter(s=>s.overall<1&&s.overall>=S().qual).length, ri=ST.length-on-wa;
  const ups=WK.filter(x=>S().weights[x]).map(x=>({x,up:ST.reduce((t,s)=>t+S().weights[x]*Math.max(0,1-s.k[x].proj),0)/ST.length*100,below:ST.filter(s=>s.k[x].proj<1).length})).sort((p,q)=>q.up-p.up);
  const pri=[...ST].sort((x,y)=>x.overall-y.overall); pri.forEach((s,i)=>s.pri=i+1);
  return `${head(`As of ${dl2(T.asOf)} · day ${n(T.elapsed)} of ${n(T.total)}`,'Focus points','<div class="note">Auto-written from today\'s numbers</div>')}
  ${sec('Area headlines','',`<div class="cards" style="grid-template-columns:1fr"><div>Acquisition: ${n(a.m)} of ${n(a.t)} (${pc(a.pct,1)}) on day ${n(T.elapsed)} of ${n(T.total)}. Month-end pace should be ${pc(T.progress,1)}; area is projecting ${pc(a.proj)}. Needs ${n(a.daily)} lines/day for the remaining ${n(T.left)} days.</div><div>Best store: ${esc(best.name)} (${pc(best.overall)} overall). Needs most help: ${esc(worst.name)} (${pc(worst.overall)} overall).</div><div>Stores on track (overall 100%+): ${on} · Watch: ${wa} · At risk (below ${pc(S().qual)} = zero commission): ${ri}</div><div>Area priority KPI: ${KMAP[ups[0].x].short} - the biggest upside on the area overall (+${ups[0].up.toFixed(1)} pts if every store reached 100% on it). ${ups[0].below} of ${ST.length} stores are projecting below 100% on it.</div></div>`)}
  ${sec('Area KPI snapshot','',tbl(['KPI',['Weight','num'],['Area proj.','num'],['Stores below 100%','num'],['Area daily required','num'],['Overall upside (pts)','num']],ups.map(u=>`<tr><td class="name">${KMAP[u.x].short}</td><td class="num">${pc(S().weights[u.x])}</td>${heat(A.k[u.x].proj)}<td class="num">${u.below}</td><td class="num">${per(KMAP[u.x],A.k[u.x].daily)}</td><td class="num">${u.up.toFixed(1)}</td></tr>`)))}
  ${sec('Store focus board','Priority 1 = most help · focus #1 / #2 = the two KPIs where the store gains the most overall',tbl(['Priority','Store',['Overall','num'],['Commission','num'],'Status','Strongest KPI','Weakest KPI','Focus #1 - what to do','Focus #2 - what to do','Manager note'],
    pri.map(s=>{ const f=focusOf(s,T); return `<tr><td>${s.pri}</td><td class="name">${esc(s.name)}</td><td class="num">${pc(s.overall,1)}</td><td class="num"><b>${pc(s.comm,1)}</b></td><td>${statusChip(s)}</td><td>${KMAP[f.strongest.k].short}<br><span class="muted">${pc(f.strongest.proj)} projected</span></td><td>${KMAP[f.weakest.k].short}<br><span class="muted">${pc(f.weakest.proj)} projected</span></td><td class="txt">${esc(f.f1)}</td><td class="txt">${esc(f.f2)}</td><td><input type="text" data-note="${esc(s.name)}" value="${esc(st.notes[s.name]||'')}" aria-label="Manager note ${esc(s.short)}"></td></tr>`}))) }`;
}


/* =============== Next tier =============== */
function viewNext(){
  const rows=ST.map(s=>({s,nt:nextTier(s,T)})).sort((x,y)=>(x.nt.top?9:x.nt.gap)-(y.nt.top?9:y.nt.gap));
  const near=rows.filter(r=>!r.nt.top&&r.nt.gap<=.05).length, avgJump=rows.filter(r=>!r.nt.top).reduce((a,r)=>a+r.nt.jump,0)/Math.max(1,rows.filter(r=>!r.nt.top).length), first=rows[0];
  const c=cliffs();
  return `${head(`As of ${dl2(T.asOf)} · ${n(T.left)} days left`,'Next commission tier','<div class="note">The shortest path to the next commission jump</div>')}
  <div class="tiles">
    ${tile('Closest to a jump',first.s.short,first.nt.top?'Top tier':`needs ${pc(first.nt.gap,1)} more overall`)}
    ${tile('Stores within 5 pts of a jump',near,`of ${ST.length} stores`)}
    ${tile('Average commission jump',sgn(avgJump*100,1,' pts'),'if each store crosses its next cliff')}
    ${tile('Days left to make it',n(T.left),`as of ${dl2(T.asOf)}`)}
  </div>
  ${sec('Store board','Priority 1 = closest to a commission jump',tbl(['Priority','Store',['Overall','num'],['Commission now','num'],'Next jump at',['Gap (overall)','num'],['Commission at next','num'],['Commission jump','num'],'Best lever',['Extra / day','num'],'Feasibility','What to do'],
    rows.map((r,i)=>{ const {s,nt}=r; return nt.top?`<tr><td>${i+1}</td><td class="name">${esc(s.name)}</td><td class="num">${pc(s.overall,1)}</td><td class="num">${pc(s.comm,1)}</td><td colspan="7" class="txt">${esc(nt.text)}</td></tr>`:
     `<tr><td>${i+1}</td><td class="name">${esc(s.name)}</td><td class="num">${pc(s.overall,1)}</td><td class="num"><b>${pc(s.comm,1)}</b></td><td>${esc(nt.label)}</td><td class="num">${pc(nt.gap,1)}</td><td class="num">${pc(nt.commNext,1)}</td><td class="num plus">${sgn(nt.jump*100,1,' pts')}</td><td>${nt.best?KMAP[nt.best].short:'–'}</td><td class="num">${nt.need?(nt.need.perDay!=null?(nt.best==='term'?egp(nt.need.perDay)+' EGP':n(nt.need.perDay)):n(nt.need.total)+' total'):''}</td><td>${nt.feas==='Easy'?'<span class="chip good">Easy</span>':nt.feas==='Stretch'?'<span class="chip warn">Stretch</span>':'<span class="chip bad">'+nt.feas+'</span>'}</td><td class="txt">${esc(nt.text)}</td></tr>`}))) }
  ${sec('Commission rules','Same rules as your RE sheet',tbl(['Overall','Final commission'],[`<tr><td>Below ${pc(S().qual)}</td><td>No commission (0%)</td></tr>`,`<tr><td>${pc(S().qual)} to under ${pc(S().bonusFrom)}</td><td>Paid as-is</td></tr>`].concat(S().tiers.map((t,i)=>`<tr><td>${pc(i?S().tiers[i-1].upTo:S().bonusFrom)} to ${pc(t.upTo)}</td><td>Overall + ${Math.round(t.bonus*100)} pts bonus</td></tr>`),[`<tr><td>${pc(S().tiers[S().tiers.length-1].upTo)} to ${pc(S().flatUpTo)}</td><td>Flat ${pc(S().flatVal)}</td></tr>`,`<tr><td>Above ${pc(S().flatUpTo)}</td><td>Raw overall paid</td></tr>`])))}`;
}


/* =============== Weekly plan =============== */
function planStatus(m,t){ const e=t*T.progress; const r=e?m/e:1; return r>=1?'On Track':r>=.9?'Watch':'Behind'; }
const planChip = s=>`<span class="chip ${s==='On Track'?'good':s==='Watch'?'warn':'bad'}">${s}</span>`;
function viewPlan(){
  const kd=KMAP[UI.planK], a=A.k[UI.planK], ws=weeks(T), eff=ws.reduce((x,w)=>x+w.ahead,0), cur=ws.find(w=>w.ahead>0), nxt=ws.filter(w=>w.ahead>0)[1];
  const share=w=>eff?w.ahead/eff:0;
  const behind=ST.filter(s=>s.k[UI.planK].t && planStatus(s.k[UI.planK].m,s.k[UI.planK].t)==='Behind').length, watch=ST.filter(s=>s.k[UI.planK].t && planStatus(s.k[UI.planK].m,s.k[UI.planK].t)==='Watch').length;
  const later=(rem)=>ws.filter(w=>w.ahead>0).slice(2).reduce((x,w)=>x+rem*share(w),0);
  let cum=a.m; const planPts=[], paceLbl=[], paceVals=[]; let effTo=0;
  ws.forEach(w=>{ effTo+=w.eff; cum+= w.ahead? a.rem*share(w):0; planPts.push(w.ahead||w.to>=T.asOf?cum:null); paceVals.push(a.t*effTo/T.total); paceLbl.push(dl(w.to)); });
  return `${head(`${MON[D(S().monthStart).getUTCMonth()]} ${D(S().monthStart).getUTCFullYear()} · ${n(T.left)} working days left`,'Weekly plan','<div class="note">What every store must sell this week and next</div>')}
  ${seg(KPIS.map(x=>[x.k,x.short]),UI.planK,'data-planK')}
  <div class="tiles">
    ${tile('Remaining (area)',val(kd,a.rem),`of ${val(kd,a.t)} target`,'hero')}
    ${tile('Effective days left',n(T.left),`of ${n(T.total)} (${monthDays().filter(d=>dayW(d)<1).length} half-days)`)}
    ${tile('Needed per full day',per(kd,a.daily),kd.unit)}
    ${tile('This week',cur?val(kd,a.rem*share(cur)):'–',cur?`${dl(cur.from)} – ${dl(cur.to)}`:'month is over')}
    ${tile('Next week',nxt?val(kd,a.rem*share(nxt)):'–',nxt?`${dl(nxt.from)} – ${dl(nxt.to)}`:'no more weeks')}
    ${tile('Area MTD %',pc(a.pct,1),`expected ${pc(T.progress,1)} · ${behind} behind · ${watch} on watch`)}
  </div>
  <div class="two">
  ${sec('Remaining by store',kd.label,hbars([...ST].filter(s=>s.k[UI.planK].t).sort((x,y)=>y.k[UI.planK].rem-x.k[UI.planK].rem).map(s=>({l:s.short,v:s.k[UI.planK].rem})),null,v=>`<b>${val(kd,v)}</b>`))}
  ${sec('MTD % vs expected pace',`Tick = expected ${pc(T.progress,1)}`,`<div class="hbars">${[...ST].filter(s=>s.k[UI.planK].t).map(s=>`<div class="hrow"><span>${esc(s.short)}</span>${bar(s.k[UI.planK].pct,T.progress)}<span class="num"><b>${pc(s.k[UI.planK].pct,1)}</b></span></div>`).join('')}</div>`)}
  </div>
  ${sec('Plan vs straight-line pace (area)','Cumulative at the end of each week',`<div style="margin-bottom:6px">${legend([{name:'Plan: reach by week end',color:'var(--accent)'},{name:'Straight-line pace',color:'var(--c3)'}])}</div>${lineChart({labels:paceLbl,series:[{name:'Plan',vals:planPts,color:'var(--accent)'},{name:'Pace',vals:paceVals,color:'var(--c3)',dash:true}],fmt:v=>kd.money?egp(v):n(v),dots:true,min:0})}`)}
  ${sec('Store plan','Spread by working days',tbl([['Store','sticky1'],['Target','num'],['MTD','num'],['MTD %','num'],['Expected by now','num'],['vs achieved','num'],['Remaining','num'],['This week','num'],['Next week','num'],['Later weeks','num'],['Run-rate / day','num'],['Needed / day','num'],['Effort (x)','num'],'Status'],
    [...ST,A].map(s=>{ const x=s.k[UI.planK]; if(!x.t) return ''; const exp=x.t*T.progress, gap=x.m-exp, st2=planStatus(x.m,x.t);
      return `<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td><td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,x.m)}</td><td class="num">${pc(x.pct,1)}</td><td class="num">${val(kd,exp)}</td><td class="num ${gap>=0?'plus':'minus'}">${gap>=0?'+':'−'}${val(kd,Math.abs(gap))}</td><td class="num">${val(kd,x.rem)}</td><td class="num">${cur?val(kd,x.rem*share(cur)):dash}</td><td class="num">${nxt?val(kd,x.rem*share(nxt)):dash}</td><td class="num">${val(kd,later(x.rem))}</td><td class="num">${per(kd,x.run)}</td><td class="num"><b>${per(kd,x.daily)}</b></td><td class="num">${x.run?(x.daily/x.run).toFixed(2):'–'}</td><td>${planChip(st2)}</td></tr>`}))) }
  ${sec('Week calendar','Sat–Fri sales weeks · Fridays and holidays can count as half days (Setup)',tbl(['Week','From','To',['Calendar days','num'],['Effective days','num'],['Days still ahead','num'],'Status',['Share of remaining','num'],['Area needed','num'],['Straight-line pace at week end','num'],['Plan: reach by week end','num'],['Plan vs pace','num']],
    (()=>{ let effT=0, c2=a.m; return ws.map((w,i)=>{ effT+=w.eff; const pace=a.t*effT/T.total; c2+= w.ahead? a.rem*share(w):0; const stt=w.ahead===0?'Done':(w===cur?'This week':'Upcoming'); return `<tr><td class="name">Week ${i+1}</td><td>${dl(w.from)}</td><td>${dl(w.to)}</td><td class="num">${w.cal}</td><td class="num">${w.eff}</td><td class="num">${w.ahead}</td><td>${stt}</td><td class="num">${w.ahead?pc(share(w)):dash}</td><td class="num">${w.ahead?val(kd,a.rem*share(w)):dash}</td><td class="num">${val(kd,pace)}</td><td class="num">${w.ahead||w.to>=T.asOf?val(kd,c2):dash}</td><td class="num">${w.ahead?val(kd,c2-pace):dash}</td></tr>`}) })()))}
  ${sec('Full plan','Every store × every week: what must be sold in that week',tbl([['Store','sticky1'],...ws.map((w,i)=>[`W${i+1} ${dl(w.from)}–${dl(w.to)}`,'num']),['Total','num']],
    [...ST,A].map(s=>{ const x=s.k[UI.planK]; if(!x.t) return ''; return `<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td>${ws.map(w=>`<td class="num">${w.ahead?val(kd,x.rem*share(w)):dash}</td>`).join('')}<td class="num"><b>${val(kd,x.rem)}</b></td></tr>`}))+`<p class="note" style="margin:8px 0 0">Check: plan total ${val(kd,a.rem)} = remaining ${val(kd,a.rem)}</p>`)}`;
}


/* =============== Pace & MTD =============== */
function viewPace(){
  const kd=KMAP[UI.paceK], rows=[...ST,A];
  return `${head(`As of ${dl2(T.asOf)} · expected ${pc(T.progress,1)}`,'Pace & MTD','<div class="note">Where each store should be, against where it is</div>')}
  <div class="tiles">
    ${tile('Area MTD overall',pc(A.mtdOverall,1),`expected ${pc(A.expected,1)}`,'hero')}
    ${tile('Ahead / behind pace',sgn(A.ahead*100,1,' pts'),A.paceStatus)}
    ${tile('Stores ahead of pace',`${ST.filter(s=>s.ahead>=0).length} of ${ST.length}`,'MTD overall vs month progress')}
    ${tile('If the month closed today',pc(A.closedToday,1),'area final commission on MTD overall')}
  </div>
  ${sec('MTD vs month progress',"MTD % of target × weight. Below 70% pays zero if the month closed today.",tbl([['Store','sticky1'],...WK.map(x=>[KMAP[x].short+' ('+pc(S().weights[x]||0)+')','num']),['MTD overall','num'],['Expected','num'],['Ahead / behind','num'],'Status',['If closed today','num']],
    rows.map(s=>`<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td>${WK.map(x=>`<td class="num">${pc(s.wm[x],1)}</td>`).join('')}<td class="num"><b>${pc(s.mtdOverall,1)}</b></td><td class="num">${pc(s.expected,1)}</td><td class="num ${s.ahead>=0?'plus':'minus'}">${sgn(s.ahead*100,1,' pts')}</td><td><span class="chip ${s.paceStatus==='Ahead'?'good':s.paceStatus==='Near pace'?'warn':'bad'}">${s.paceStatus}</span></td><td class="num">${pc(s.closedToday,1)}</td></tr>`)))}
  ${seg(KPIS.map(x=>[x.k,x.short]),UI.paceK,'data-paceK')}
  ${sec(`Pace gap · ${kd.label}`,`Should be = target ÷ working days × days elapsed · gap below 0 means behind`,tbl([['Store','sticky1'],['Should be','num'],['Actual','num'],['Gap','num'],['Gap % of should-be','num'],'Pace'],
    rows.map(s=>{ const x=s.k[UI.paceK]; if(!x.t) return ''; const should=x.t*T.progress, gap=x.m-should; return `<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td><td class="num">${val(kd,should)}</td><td class="num">${val(kd,x.m)}</td><td class="num ${gap>=0?'plus':'minus'}">${gap>=0?'+':'−'}${val(kd,Math.abs(gap))}</td><td class="num ${gap>=0?'plus':'minus'}">${sgn(should?gap/should*100:0,1,'%')}</td><td>${bar(x.pct,T.progress)}</td></tr>`})))}`;
}


/* =============== Low & High lines =============== */
function viewLowHigh(){
  const g={low:S().lowGoal,high:S().highGoal}; const need=(x,k)=>Math.max(0,x.t*g[k]-x.m);
  const stat=(x,k)=> x.m>=x.t*g[k]?'<span class="chip good">Reached</span>':x.proj>=g[k]?'<span class="chip good">On pace</span>':'<span class="chip bad">Behind</span>';
  const blk=k=>{ const rows=[...ST,A]; return sec(`${k==='low'?'Low':'High'} lines`,`Goal ${pc(g[k])} of target`,tbl([['Store','sticky1'],['Target','num'],['MTD','num'],['MTD %','num'],['Projection','num'],['Remaining for goal','num'],['Daily required','num'],'Status'],
    rows.map(s=>{ const x=s.k[k]; const r=s===A?ST.reduce((a,q)=>a+need(q.k[k],k),0):need(x,k); return `<tr class="${s===A?'area':''}"><td class="name sticky1">${esc(s.name)}</td><td class="num">${n(x.t)}</td><td class="num">${n(x.m)}</td><td class="num">${pc(x.pct,1)}</td>${heat(x.proj)}<td class="num">${n(r)}</td><td class="num">${n(whole(T.left?r/T.left:0))}</td><td>${s===A?`${ST.filter(q=>q.k[k].m>=q.k[k].t*g[k]).length} / ${ST.length} reached`:stat(x,k)}</td></tr>`}))); };
  const totL=ST.reduce((a,s)=>a+need(s.k.low,'low'),0), totH=ST.reduce((a,s)=>a+need(s.k.high,'high'),0);
  return `${head(`As of ${dl2(T.asOf)} · ${n(T.left)} days left`,'Low & High lines','<div class="note">What each store still needs to reach its Low and High goals</div>')}
  <div class="tiles">${tile('Low lines at goal',`${ST.filter(s=>s.k.low.m>=s.k.low.t*g.low).length} of ${ST.length}`,`Area ${pc(A.k.low.pct,1)} of target`)}${tile('High lines at goal',`${ST.filter(s=>s.k.high.m>=s.k.high.t*g.high).length} of ${ST.length}`,`Area ${pc(A.k.high.pct,1)} of target`)}${tile('Lines still needed',n(totL+totH),`Low ${n(totL)} + High ${n(totH)}`,'hero')}${tile('Daily required (all stores)',n(whole(totL/(T.left||1))+whole(totH/(T.left||1))),`${n(whole(totL/(T.left||1)))} Low + ${n(whole(totH/(T.left||1)))} High per day`)}</div>
  ${blk('low')}${blk('high')}
  ${sec('Combined daily requirement','Lines per day to hit both goals',tbl(['Store',['Low / day','num'],['High / day','num'],['Total / day','num'],['Low gap (% of target)','num'],['High gap (% of target)','num'],'Bigger gap','What to do'],
    ST.map(s=>{ const l=need(s.k.low,'low')/(T.left||1), h=need(s.k.high,'high')/(T.left||1), lg=s.k.low.t?need(s.k.low,'low')/s.k.low.t:0, hg=s.k.high.t?need(s.k.high,'high')/s.k.high.t:0; return `<tr><td class="name">${esc(s.name)}</td><td class="num">${n(whole(l))}</td><td class="num">${n(whole(h))}</td><td class="num"><b>${n(whole(l)+whole(h))}</b></td><td class="num">${pc(lg)}</td><td class="num">${pc(hg)}</td><td>${hg>lg?'High lines':'Low lines'}</td><td class="txt">Needs ${n(l+h)} lines/day (${n(l)} Low + ${n(h)} High) for ${n(T.left)} days. Bigger gap: ${hg>lg?'High':'Low'} lines.</td></tr>`})))}`;
}


/* =============== Prepaid =============== */
function viewPrepaid(){
  const rows=ST.map(s=>({s,p:s.pp})), tot=rows.reduce((a,r)=>({gas:a.gas+r.p.gas,sold:a.sold+r.p.sold,allowed:a.allowed+r.p.allowed,avail:a.avail+r.p.avail,flex:a.flex+r.p.flex}),{gas:0,sold:0,allowed:0,avail:0,flex:0});
  const stc=s=>`<span class="chip ${s==='Within limit'?'good':s==='Near limit'?'warn':'bad'}">${s}</span>`;
  const rank=[...rows].sort((a,b)=>b.p.avail-a.p.avail);
  return `${head(`As of ${dl2(T.asOf)}`,'Prepaid control',`<div class="note">Prepaid sold must stay under ${pc(S().prepCap)} of total GAs</div>`)}
  <div class="tiles">${tile('Prepaid sold',n(tot.sold),`of ${n(tot.allowed)} allowed (${pc(S().prepCap)} of GAs)`,'hero')}${tile('Prepaid % of GAs',pc(tot.gas?tot.sold/tot.gas:0,1),tot.sold>tot.allowed?'Over the cap':'Within the cap')}${tile('Prepaid available',n(tot.avail),`${rows.filter(r=>r.p.status==='Over limit').length} of ${ST.length} stores over the limit`)}${tile('Extra flex GAs needed',n(tot.flex),`${n(whole(tot.flex/(T.left||1)))} per day`)}</div>
  ${sec('Store prepaid',''+(ADMIN?'Type Total GAs and Sold prepaid for each store':'View only. The admin updates these numbers.')+'',tbl(['Store',['Total GAs','num'],['Sold prepaid','num'],['Prepaid % of GAs','num'],['Allowed (cap)','num'],['Available','num'],'Status',['Flex GAs needed','num'],['Flex / day','num']],
    rows.map(({s,p})=>`<tr><td class="name">${esc(s.name)}</td><td class="num"><input type="number" min="0" data-pp="${esc(s.name)}|0" value="${p.gas}" aria-label="Total GAs ${esc(s.short)}"></td><td class="num"><input type="number" min="0" data-pp="${esc(s.name)}|1" value="${p.sold}" aria-label="Sold prepaid ${esc(s.short)}"></td><td class="num">${pc(p.pct,1)}</td><td class="num">${n(p.allowed)}</td><td class="num"><b>${n(p.avail)}</b></td><td>${stc(p.status)}</td><td class="num">${n(p.flex)}</td><td class="num">${n(whole(p.flexDay))}</td></tr>`).concat(`<tr class="area"><td>Cairo Area</td><td class="num">${n(tot.gas)}</td><td class="num">${n(tot.sold)}</td><td class="num">${pc(tot.gas?tot.sold/tot.gas:0,1)}</td><td class="num">${n(tot.allowed)}</td><td class="num">${n(tot.avail)}</td><td></td><td class="num">${n(tot.flex)}</td><td class="num">${n(whole(tot.flex/(T.left||1)))}</td></tr>`)))}
  ${sec('Where there is room','Stores ranked by prepaid still available',hbars(rank.map(r=>({l:r.s.short,v:r.p.avail})),null,v=>`<b>${n(v)}</b>`))}`;
}


/* =============== Commission analysis (manager) and My plan (employee) =============== */
function payBands(){ const s=S(); const L=[{l:'No commission',r:'below '+pc(s.qual),t:'bad'},{l:'No bonus',r:pc(s.qual)+' to '+pc(s.bonusFrom),t:'warn'}]; let lo=s.bonusFrom;
  s.tiers.forEach(t=>{ L.push({l:'+'+Math.round(t.bonus*100)+' pts bonus',r:pc(lo)+' to '+pc(t.upTo),t:'good'}); lo=t.upTo; });
  L.push({l:'Flat '+Math.round(s.flatVal*100)+'%',r:pc(lo)+' to '+pc(s.flatUpTo),t:'good'}); L.push({l:'Raw overall',r:'above '+pc(s.flatUpTo),t:'good'}); return L; }
function bandOf(x){ const s=S(); if(x<s.qual) return 0; if(x<s.bonusFrom) return 1; for(let i=0;i<s.tiers.length;i++){ if(x<=s.tiers[i].upTo) return 2+i; } return x<=s.flatUpTo ? 2+s.tiers.length : 3+s.tiers.length; }
const effChip = f=> f==='Easy'?'<span class="chip good">Easy</span>':f==='Stretch'?'<span class="chip warn">Stretch</span>':'<span class="chip bad">'+esc(f)+'</span>';
const needTxt = nt=> nt.need ? esc(nt.need.txt) : esc(nt.text);
function viewPayout(){
  const AG=computeAgents(), T=AG.T, s=S(), q=UI.pyStore||'all';
  const L=AG.list.filter(a=>q==='all'||a.s===q), rows=L.map(a=>({a,nt:nextTier(a,T)})), bands=payBands(), cnt=bands.map(()=>0);
  L.forEach(a=>{ cnt[bandOf(a.overall)]++; });
  const mx=Math.max(1,...cnt), avgC=L.length?L.reduce((t,a)=>t+a.comm,0)/L.length:0;
  const reachable=r=>!r.nt.top && r.nt.jump>0 && r.nt.best && r.nt.feas!=='Hard';
  const zero=rows.filter(r=>r.a.overall<s.qual).sort((x,y)=>x.nt.gap-y.nt.gap);
  const wins=rows.filter(r=>r.a.overall>=s.qual && reachable(r)).sort((x,y)=>x.nt.ratioW-y.nt.ratioW||y.nt.jump-x.nt.jump);
  const reach=rows.filter(reachable).length;
  const ups=WK.filter(x=>s.weights[x]).map(x=>{ const Lx=L.filter(a=>a.k[x].t); return {x, avg:Lx.length?Lx.reduce((t,a)=>t+a.k[x].proj,0)/Lx.length:0, below:Lx.filter(a=>a.k[x].proj<1).length, up:L.length?Lx.reduce((t,a)=>t+s.weights[x]*Math.max(0,1-a.k[x].proj),0)/L.length*100:0}; }).sort((p,r)=>r.up-p.up);
  const sn=a=>{ const b=byName(a.s); return esc(b?b.short:a.s); };
  const lim=UI.pyLimit||15;
  /* Zero ADSL: agents with an ADSL target who have not sold one yet this month */
  const wA=s.weights.adsl||0, hasA=L.filter(a=>a.k.adsl.t>0), zA=hasA.filter(a=>a.k.adsl.m<=0).sort((x,y)=>x.overall-y.overall||x.n.localeCompare(y.n));
  const stepA=a=>{ const nt=nextTier(a,T); if(nt.top||!wA) return {nt,top:nt.top}; const unit=wA/a.k.adsl.t, cnt=whole((nt.target-a.overall)/unit-1e-9); return {nt,cnt,unit,to:commission(a.overall+cnt*unit)}; };
  const aStores=[...new Set(hasA.map(a=>a.s))].map(nm=>({nm,tot:hasA.filter(a=>a.s===nm).length,z:zA.filter(a=>a.s===nm).length})).sort((x,y)=>y.z-x.z||y.z/y.tot-x.z/x.tot);
  const aMax=Math.max(1,...aStores.map(x=>x.z));
  return `${head(`Individual agents · projected at the current pace as of ${dl2(AG.upto)} (day ${n(T.elapsed)} of ${n(T.total)})`,'Commission analysis','<div class="note">Daily numbers are whole and rounded up, so they are always enough</div>')}
  <div class="tiles">${tile('Average final commission',pc(avgC,1),`${n(L.length)} agents in view`,'hero')}${tile('No commission',cnt[0],`projected below ${pc(s.qual)}`)}${tile('Can jump a tier',reach,'with a whole-number boost')}${tile('Zero ADSL',zA.length,`of ${n(hasA.length)} agents with an ADSL target`)}${tile('Days left',n(T.left),'to change the result')}</div>
  <div class="ctrl">${sel2('py-store',[['all',`All stores (${AG.list.length})`],...storeOpts()],q,'Store')}</div>
  ${sec('Where the agents land','Projected month-end overall and the commission band it pays',tbl(['Band','Overall range',['Agents','num'],'Share'],bands.map((b,i)=>`<tr><td class="name"><span class="chip ${b.t}">${esc(b.l)}</span></td><td>${esc(b.r)}</td><td class="num"><b>${cnt[i]}</b></td><td>${bar(cnt[i]/mx)}</td></tr>`)))}
  ${sec('Where the points are','Weighted gap to 100% of target, averaged over the agents in view',tbl(['KPI',['Weight','num'],['Avg projection','num'],['Agents below target','num'],['Upside (pts)','num']],ups.map(u=>`<tr><td class="name">${KMAP[u.x].short}</td><td class="num">${pc(s.weights[u.x])}</td>${heat(u.avg)}<td class="num">${u.below}</td><td class="num"><b>${u.up.toFixed(1)}</b></td></tr>`)))}
  ${sec('No-commission watch',`Projected below ${pc(s.qual)}, closest to qualifying first`,zero.length?tbl(['Agent','Store',['Overall','num'],['Gap','num'],'What it takes','Effort',['Final commission','num']],zero.map(r=>`<tr><td class="name">${esc(r.a.n)}${dbtn('agent',r.a.key)}</td><td>${sn(r.a)}</td><td class="num">${pc(r.a.overall,1)}</td><td class="num">${sgn(r.nt.gap*100,1,' pts')}</td><td class="txt">${needTxt(r.nt)}</td><td>${effChip(r.nt.feas)}</td><td class="num"><b>${pc(r.a.comm)} → ${pc(r.nt.commNext)}</b></td></tr>`)):'<p class="note" style="margin:0">Nobody in view is projected below the qualifying overall.</p>')}
  ${sec('Zero ADSL by store','Agents with an ADSL target who have not sold one this month',aStores.length?tbl(['Store',['Zero ADSL','num'],['Agents with a target','num'],'Share'],aStores.map(x=>`<tr><td class="name">${esc((byName(x.nm)||{short:x.nm}).short)}</td><td class="num"><b>${x.z}</b></td><td class="num">${x.tot}</td><td>${bar(x.z/aMax)}</td></tr>`)):'<p class="note" style="margin:0">No agent in view has an ADSL target.</p>')}
  ${sec('Zero ADSL agents',`ADSL is worth ${pc(wA)} of the overall, so every agent here is losing up to ${(wA*100).toFixed(0)} pts. Lowest overall first`,zA.length?tbl(['Agent','Store',['Overall','num'],['ADSL target','num'],['Each ADSL adds','num'],'ADSL to the next commission step',['Final commission','num']],zA.map(a=>{ const st_=stepA(a), pts=wA?wA/a.k.adsl.t*100:0;
    const stepTxt = st_.top ? 'Already in the top commission tier' : (wA && st_.cnt<=Math.max(a.k.adsl.t*2,3)) ? `<b>${n(st_.cnt)} ADSL</b> to cross ${esc(st_.nt.label)}` : 'Needs more than ADSL alone';
    const payTxt = st_.top || !wA || st_.cnt>Math.max(a.k.adsl.t*2,3) ? pc(a.comm) : `${pc(a.comm)} → ${pc(st_.to)}`;
    return `<tr><td class="name">${esc(a.n)}${dbtn('agent',a.key)}</td><td>${sn(a)}</td><td class="num">${pc(a.overall,1)}</td><td class="num">${n(a.k.adsl.t)}</td><td class="num">+${pts.toFixed(1)} pts</td><td class="txt">${stepTxt}</td><td class="num"><b>${payTxt}</b></td></tr>`; })):'<p class="note" style="margin:0">Every agent with an ADSL target has sold at least one.</p>')}
  ${sec('Quick wins','Agents who already qualify and can reach the next commission step with the smallest whole-number boost',wins.length?tbl(['Agent','Store',['Overall','num'],'Next step',['Final commission','num'],'What it takes','Effort'],wins.slice(0,lim).map(r=>`<tr><td class="name">${esc(r.a.n)}${dbtn('agent',r.a.key)}</td><td>${sn(r.a)}</td><td class="num">${pc(r.a.overall,1)}</td><td>${esc(r.nt.label)}</td><td class="num"><b>${pc(r.a.comm)} → ${pc(r.nt.commNext)}</b></td><td class="txt">${needTxt(r.nt)}</td><td>${effChip(r.nt.feas)}</td></tr>`))+(wins.length>lim?`<div class="ctrl" style="margin-top:12px;justify-content:center"><button type="button" class="btn" id="py-more">Show 15 more</button></div>`:''):'<p class="note" style="margin:0">No easy or stretch wins right now. Every next step needs a bigger boost.</p>')}`;
}
function planCard(o,T){
  const s=S(), nt=nextTier(o,T), x=o.overall, MAXV=Math.max(s.flatUpTo||2,1.5), pos=v=>Math.max(0,Math.min(v/MAXV,1))*100;
  const seg=`linear-gradient(90deg,var(--bad-bg) 0 ${pos(s.qual)}%,var(--warn-bg) ${pos(s.qual)}% ${pos(s.bonusFrom)}%,var(--good-bg) ${pos(s.bonusFrom)}% 100%)`;
  let lastP=-99; const ticks=cliffs().filter(c=>c.v<=MAXV).map(c=>{ const p=pos(c.v), show=p-lastP>=9; if(show) lastP=p; return `<i class="tk" style="left:${p}%"></i>${show?`<b class="tl" style="left:${Math.min(p,96)}%">${pc(c.v)}</b>`:''}`; }).join('');
  const yp=pos(x), t=tierInfo(x);
  let msg;
  if(nt.top) msg='<b>You are in the top commission tier.</b> Keep your daily numbers steady until month-end to hold it.';
  else if(!T.left) msg='The month is over. This is your final overall.';
  else if(nt.best){ const k=KMAP[nt.best];
    const ask = nt.best==='adsl' ? `Sell <b>${n(nt.need.total)} more ADSL</b> in the next ${n(T.left)} days` : `<b>${esc(k.short)}: ${esc(nt.need.txt)}</b>`;
    const tot = nt.need.perDay!=null ? ` That is ${nt.best==='term'?egp(nt.need.total)+' EGP':n(nt.need.total)} more in total.` : '';
    msg=`${ask} to cross <b>${esc(nt.label)}</b>. Your final commission moves from <b>${pc(o.comm)}</b> to <b>${pc(nt.commNext)}</b>.${tot}`; }
  else msg=esc(nt.text);
  return sec('My plan','Whole numbers, rounded up so they are always enough',`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span class="muted">Projected overall at my current pace</span><span class="chip ${t.t}">${x<s.qual?'No commission at this pace':esc(t.l)}</span></div>
    <div class="lad" style="background:${seg}">${ticks}<u class="you ${yp<12?'l':yp>88?'r':''}" style="left:${yp}%"><span>Me ${pc(x,1)}</span></u></div>
    <p class="plan-msg">${msg}</p>`);
}

/* agents list */
const sel2=sel;
function viewAgents(){
  const AG=computeAgents(); let list=AG.list.filter(a=>(UI.agStore==='all'||a.s===UI.agStore)&&a.n.toLowerCase().includes(UI.agQ.toLowerCase()));
  list.sort((x,y)=>UI.agSort==='n'?x.n.localeCompare(y.n):UI.agSort==='acq'?y.k.acq.proj-x.k.acq.proj:UI.agSort==='ov'?y.overall-x.overall:(y.comm-x.comm||y.overall-x.overall));
  const on=list.filter(a=>a.overall>=1).length, wa=list.filter(a=>a.overall<1&&a.overall>=S().qual).length, ri=list.length-on-wa, avgC=list.length?list.reduce((a,x)=>a+x.comm,0)/list.length:0, avgO=list.length?list.reduce((a,x)=>a+x.overall,0)/list.length:0;
  const sel=AG.list.find(a=>a.key===UI.agSel);
  const card=sel?agentCard(sel,AG):'';
  return `${head(`Individual agents · figures as of ${dl2(AG.upto)} (day ${n(AG.T.elapsed)} of ${n(AG.T.total)})`,'Agents','<div class="note">Press Details on an agent to open the agent card</div>')}
  <div class="tiles">${tile('Average final commission',pc(avgC,1),`${list.length} agents in view`,'hero')}${tile('Average overall',pc(avgO,1),'simple average')}${tile('On track',on,'overall 100%+')}${tile('Watch',wa,`${pc(S().qual)} to 99%`)}${tile('At risk',ri,`below ${pc(S().qual)} · no commission`)}</div>
  ${card}
  <div class="ctrl">${sel2('ag-store',[['all',`All stores (${AG.list.length})`],...storeOpts()],UI.agStore,'Store')}${sel2('ag-sort',[['comm','Sort: final commission'],['ov','Sort: overall'],['acq','Sort: acquisition projection'],['n','Sort: name']],UI.agSort,'Sort by')}<input type="search" id="ag-q" placeholder="Search agent" value="${esc(UI.agQ)}" aria-label="Search agent"></div>
  ${sec('Agent list',`Showing ${Math.min(list.length,UI.agLimit||15)} of ${list.length} · ★ = top 10 in the area by final commission`,agentTable(list.slice(0,UI.agLimit||15),true)+(list.length>(UI.agLimit||15)?`<div class="ctrl" style="margin-top:12px;justify-content:center"><button type="button" class="btn" id="ag-more">Show 15 more</button></div>`:''))}`;
}


/* =============== Commission simulator =============== */
function simBody(s,key){
  UI.simKey=key; const sv=UI.simVals[key]||{}, w=S().weights;
  const rows=WK.map(x=>{ const cur=s.k[x].proj, v=sv[x]; const used=(v===''||v==null||isNaN(+v))?cur:(+v)/100; return {x,cur,used,custom:used!==cur}; });
  const ov=rows.reduce((a,r)=>a+w[r.x]*r.used,0), cm=commission(ov), d=cm-s.comm;
  const steps=[]; for(let v=.8; v<=1.3001; v+=.05) steps.push(v);
  const base=s.overall-w.acq*s.k.acq.proj;
  const xs=[]; for(let v=.6; v<=2.1001; v+=.0125) xs.push(+v.toFixed(4));
  const idx=v=>Math.min(xs.length-1,Math.max(0,Math.round((v-.6)/.0125)));
  const pCur=xs.map(()=>null), pWi=xs.map(()=>null); pCur[idx(s.overall)]=s.comm; pWi[idx(ov)]=cm;
  return `<div class="ctrl"><button type="button" class="btn" id="sim-reset">Clear what-ifs</button></div>
  <div class="tiles">${tile('What-if overall',pc(ov,1),`current ${pc(s.overall,1)}`)}${tile('What-if final commission',pc(cm,1),tierInfo(ov).l,'hero')}${tile('Current final commission',pc(s.comm,1),tierInfo(s.overall).l)}${tile('Change',sgn(d*100,1,' pts'),d>=0?'gain':'loss')}</div>
  ${sec('KPI inputs','Leave blank to keep the current projection',tbl(['KPI',['Weight','num'],['Current proj.','num'],['What-if proj. %','num'],['Used','num'],['Weighted','num']],rows.map(r=>`<tr><td class="name">${KMAP[r.x].short}</td><td class="num">${pc(w[r.x])}</td><td class="num">${pc(r.cur,1)}</td><td class="num"><input type="number" step="1" min="0" data-sim="${r.x}" value="${sv[r.x]??''}" placeholder="${Math.round(r.cur*100)}" aria-label="What-if ${KMAP[r.x].short} %"></td><td class="num">${pc(r.used,1)}${r.custom?' *':''}</td><td class="num">${pc(w[r.x]*r.used,1)}</td></tr>`).concat(`<tr class="area"><td>Overall</td><td class="num">${pc(1)}</td><td></td><td></td><td></td><td class="num">${pc(ov,1)}</td></tr>`)))}
  <div class="two">
  ${sec('Sensitivity · Acquisition projection','Other KPIs as they are today',tbl([['Acq proj.','num'],['Overall','num'],['Final commission','num'],['Change vs today','num']],steps.map(v=>{ const o=base+w.acq*v, c=commission(o); return `<tr><td class="num">${pc(v)}</td><td class="num">${pc(o,1)}</td><td class="num"><b>${pc(c,1)}</b></td><td class="num ${c-s.comm>=0?'plus':'minus'}">${sgn((c-s.comm)*100,1,' pts')}</td></tr>`})))}
  ${sec('Commission curve','Final commission by overall',`<div style="margin-bottom:6px">${legend([{name:'Final commission',color:'var(--c3)'},{name:'Today',color:'var(--accent)'},{name:'What-if',color:'var(--c2)'}])}</div>${lineChart({labels:xs.map(v=>pc(v)),series:[{name:'Final commission',vals:xs.map(v=>commission(v)),color:'var(--c3)'},{name:'Today',vals:pCur,color:'var(--accent)'},{name:'What-if',vals:pWi,color:'var(--c2)'}],every:16,fmt:v=>pc(v)})}<p class="note" style="margin:8px 0 0">Steps appear at ${pc(S().qual)} (commission starts) and at each bonus cliff.</p>`)}
  </div>`;
}


function viewSim(){ const s=byName(UI.simS)||ST[0]; UI.simS=s.name; return `${head('What-if','Commission simulator','<div class="note">Type a what-if projection % for any KPI and see the final commission move</div>')}
  <div class="ctrl"><label class="ctrl"><span class="muted">Store</span>${sel('sim-s',storeOpts(),s.name,'Store')}</label></div>${simBody(s,s.name)}`; }

/* =============== Enter data =============== */
function nextEntryDate(){ const d=addDays(lastDate(),1); const days=monthDays(); return d>days[days.length-1]?days[days.length-1]:d; }
const NORMH = s=>String(s==null?'':s).toLowerCase().replace(/%/g,'pct').replace(/[^a-z0-9]/g,'');
function coldef(kind){
  const o=[{id:'store',label:'Store name',req:true,al:['storename','store','branch','branchname','stores']}];
  if(kind==='agents') o.push({id:'agent',label:'Agent name',req:true,al:['agents','agent','agentname','employee','employeename']});
  const names={low:['lowacq','lowlines','low'],high:['highacq','highlines','high'],vf:['vfcash','vmt','vfcashvmt'],term:['terminal','smarttech'],conn:['athome','connectivity','connectivitypoints'],adsl:['adsl']};
  KP.forEach(k=>{ const nm=names[k]||[NORMH(KMAP[k].short)]; o.push({id:k+'.m',label:KMAP[k].short+' MTD',req:true,al:nm.map(x=>x+'mtd')}); o.push({id:k+'.t',label:KMAP[k].short+' target',req:false,al:nm.map(x=>x+'target')}); });
  return o; }
function colLetter(i){ let s=''; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; }
function matchStore(name){ const f=NORMH(name); if(!f) return null; const hit=st.stores.find(s=>{ const g=NORMH(s.name); return f.startsWith(g)||g.startsWith(f); }); return hit?hit.name:null; }
function dateFromName(fn){ const m=/(\d{1,2})[\s_\-\.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(fn||''); if(!m) return null;
  const mi=MON.findIndex(x=>x.toLowerCase()===m[2].toLowerCase()), y=D(S().monthStart).getUTCFullYear(); const d=y+'-'+String(mi+1).padStart(2,'0')+'-'+String(+m[1]).padStart(2,'0');
  const days=monthDays(); return d>=days[0]&&d<=days[days.length-1]?d:null; }
function parseUpload(rows,kind){
  const CD=coldef(kind);
  let hi=-1,best=0; rows.slice(0,15).forEach((r,i)=>{ const c=(r||[]).filter(v=>CD.some(d=>d.al.includes(NORMH(v)))).length; if(c>best){best=c;hi=i;} });
  if(hi<0) return {error:'No recognised column headers found in the first rows.'};
  const hdr=rows[hi], map={}; CD.forEach(d=>{ map[d.id]=hdr.findIndex(h=>d.al.includes(NORMH(h))); });
  if(kind==='stores' && hdr.some(h=>['agents','agent','agentname','employee'].includes(NORMH(h)))) return {error:'This file has an Agents column, so it looks like the agents report. Use the agents upload box instead.'};
  const stores={}, un=new Set(); let out=[], total=0;
  rows.slice(hi+1).forEach(r=>{ if(!r) return; const sv=r[map.store];
    if(kind==='agents'){ if(r[map.agent]==null||String(r[map.agent]).trim()===''||/^total/i.test(String(r[map.agent]))) return; }
    else { if(sv==null||String(sv).trim()===''||/^(total|grand|area|cairo)/i.test(String(sv).trim())&&!matchStore(sv)) return; }
    total++; const sn=matchStore(sv); if(!sn){ un.add(String(sv)); return; }
    const t={},m={}; KP.forEach(k=>{ t[k]=map[k+'.t']>=0?(+r[map[k+'.t']]||0):0; m[k]=map[k+'.m']>=0?(+r[map[k+'.m']]||0):0; });
    if(kind==='agents') out.push({s:sn,n:String(r[map.agent]).trim(),area:'',t,m});
    else { const o=stores[sn]||(stores[sn]={s:sn,n:0,t:Object.fromEntries(KP.map(k=>[k,0])),m:Object.fromEntries(KP.map(k=>[k,0]))}); o.n++; KP.forEach(k=>{ o.t[k]+=t[k]; o.m[k]+=m[k]; }); } });
  if(kind==='stores') out=Object.values(stores);
  const hasT=KP.some(k=>map[k+'.t']>=0);
  return {hi,hdr,map,rows:out,unmatched:[...un],total,hasT,CD,missing:kind==='stores'?st.stores.filter(s=>!stores[s.name]).map(s=>s.name):[]};
}
function entryGridStores(date){
  const ex=st.daily[date]||{};
  return tbl(['Store',...KP.map(k=>[KMAP[k].short+(KMAP[k].money?' (EGP)':''),'num'])], st.stores.map((s,i)=>`<tr><td class="name">${esc(s.name)}</td>${KP.map(k=>`<td class="num"><input type="number" inputmode="numeric" min="0" step="1" id="in-${i}-${k}" value="${ex[s.name]&&ex[s.name][k]!=null?ex[s.name][k]:''}" placeholder="0" aria-label="${esc(s.short)} ${KMAP[k].short}"></td>`).join('')}</tr>`));
}
function mapTable(r){ return tbl(['Field in the app','Header in your file','Column','Status'],r.CD.map(d=>{ const i=r.map[d.id]; return `<tr><td>${d.label}${d.req?'':' <span class="muted">(optional)</span>'}</td><td>${i>=0?esc(r.hdr[i]):'<span class="muted">not found</span>'}</td><td>${i>=0?colLetter(i):''}</td><td>${i>=0?'<span class="ok">Matched</span>':d.req?'<span class="miss">Missing</span>':'<span class="muted">Skipped</span>'}</td></tr>`; })); }
function uploadBlock(kind,up,first,lastD){
  const id=kind==='stores'?'s':'a', dfl=kind==='stores'?st.baseDate:st.agentBaseDate;
  let prev='';
  if(up&&up.error) prev=`<p class="miss" style="margin-top:10px">${esc(up.error)}</p>`;
  else if(up&&up.res){ const r=up.res, miss=r.CD.filter(d=>d.req&&r.map[d.id]<0), found=r.CD.filter(d=>r.map[d.id]>=0).length;
    prev=`<h3 style="margin:14px 0 6px">${esc(up.name)} · header on row ${r.hi+1} · ${kind==='stores'?r.rows.length+' stores':r.rows.length+' of '+r.total+' agents'} matched</h3>
    <details><summary class="note" style="cursor:pointer;margin-bottom:6px">Column mapping (${found} of ${r.CD.length} found)</summary>${mapTable(r)}</details>
    ${r.unmatched.length?`<p class="miss" style="margin:8px 0 0">Skipped rows with unknown store: ${r.unmatched.map(esc).join(', ')}</p>`:''}
    ${r.missing&&r.missing.length?`<p class="miss" style="margin:8px 0 0">Not in the file (their numbers stay as they are): ${r.missing.map(esc).join(', ')}</p>`:''}
    ${kind==='stores'?tbl(['Store',['Acq MTD','num'],['Terminal MTD','num'],['Acq target','num']],r.rows.map(x=>`<tr><td class="name">${esc(x.s)}</td><td class="num">${n(x.m.low+x.m.high+x.m.vf)}</td><td class="num">${egp(x.m.term)}</td><td class="num">${r.hasT?n(x.t.low+x.t.high+x.t.vf):dash}</td></tr>`)):
      tbl(['Store',['Agents','num'],['Acq MTD','num'],['Terminal MTD','num']],st.stores.map(s=>{ const a=r.rows.filter(x=>x.s===s.name); return `<tr><td class="name">${esc(s.name)}</td><td class="num">${a.length}</td><td class="num">${n(a.reduce((x,y)=>x+y.m.low+y.m.high+y.m.vf,0))}</td><td class="num">${egp(a.reduce((x,y)=>x+y.m.term,0))}</td></tr>`}))}
    <div class="ctrl" style="margin-top:12px"><button type="button" class="btn primary" id="e-${id}apply" ${miss.length||!r.rows.length?'disabled':''}>Use as the ${kind==='stores'?'stores':'agents'} report of ${dl2(up.date||dfl)}</button>${miss.length?`<span class="miss">${miss.length} required column(s) not found</span>`:''}</div>`; }
  else prev=`<p class="note" style="margin:10px 0 0">Nothing uploaded yet.</p>`;
  return `<div class="formrow"><label class="field">Excel file (.xlsx)<input type="file" id="e-${id}file" accept=".xlsx,.xls,.csv"></label><label class="field">Report date<input type="date" id="e-${id}date" value="${up&&up.date||dfl}" min="${first}" max="${lastD}"></label></div>${prev}`;
}
function viewEntry(){
  const days=monthDays(), first=days[0], lastD=days[days.length-1];
  if(!UI.entryDate) UI.entryDate=nextEntryDate();
  const date=UI.entryDate;
  return `${head('Admin','Enter data','<div class="note">The only place numbers go in for the manager views.</div>')}
  
  ${sec('How a day works','Same flow as your Acq and 40% sheets, without typing the company totals',`<div class="steps"><div><b>Upload the company reports</b><p class="note" style="margin:4px 0 0">The cumulative stores report and the agents report, as the company sends them. Columns are matched by header name, so a different order is fine.</p></div><div><b>Add the day's sales</b><p class="note" style="margin:4px 0 0">Type each store's sales for the day in the grid. Saving adds it on top of the company report.</p></div><div><b>Everybody sees it</b><p class="note" style="margin:4px 0 0">Dashboard, store cards, plan and pace recalculate at once. Agent screens show the company file as it came.</p></div></div>
    <p class="note" style="margin:10px 0 0">Now: stores start from the company report of <b>${dl2(st.baseDate)}</b>${entryDates().length?`, plus ${entryDates().length} saved day(s) up to <b>${dl2(lastDate())}</b>`:''}. Agents: company file of <b>${dl2(st.agentBaseDate)}</b>.</p>`)}
  ${UI.flash?`<div class="info" role="status"><b>${esc(UI.flash)}</b></div>`:''}
  ${sec('1 · Company stores report','Upload the cumulative report with store names and their numbers. It replaces the starting point and removes saved days up to its date.',uploadBlock('stores',UI.uploadS,first,lastD))}
  ${sec("2 · Add the day's sales",'Type the numbers for every store, then save',`<div class="formrow" style="margin-bottom:12px"><label class="field">Date<input type="date" id="e-date" value="${date}" min="${first}" max="${lastD}"></label></div>
    <p class="note" style="margin:0 0 10px">Sales made on ${dl2(date)} (${dow(date)}). Leave a cell empty for 0. Saving the same date again replaces that day. The date must be after the company report (${dl(st.baseDate)}).</p>
    ${entryGridStores(date)}
    <div class="ctrl" style="margin-top:12px"><label style="display:inline-flex;align-items:center;gap:6px;margin-right:10px"><input type="checkbox" id="e-notify" ${UI.notifyOff?'':'checked'}> Notify team</label><button type="button" class="btn primary" id="e-save">Save day</button>${st.daily[date]&&date>st.baseDate?'<button type="button" class="btn danger" id="e-del">Delete this day</button>':''}</div>`)}
  ${sec('3 · Company agents report','Upload the RPM agents Excel. Agent screens show it exactly as uploaded. Employees add their own sales separately on their own page.',uploadBlock('agents',UI.upload,first,lastD))}
  ${sec('4 · Prepaid, targets, names','','<p style="margin:0">Total GAs and sold prepaid are typed on the <a href="#prepaid" style="color:var(--accent)">Prepaid control</a> screen. Targets, weights, store names, the area name and extra boxes (like EPU) are in <a href="#setup" style="color:var(--accent)">Setup & targets</a>.</p>')}
  ${sec('Start over','Brings back the sample numbers from your two files',`<button type="button" class="btn danger" id="e-reset">${UI.confirmReset?'Click again to confirm reset':'Reset to sample data'}</button>`)}`;
}

/* =============== Setup =============== */
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,12)||'box'; }
function renameStore(old,nw){
  nw=String(nw).trim(); if(!nw||nw===old) return 'same'; if(st.stores.some(s=>s.name===nw)) return 'dup';
  const mv=o=>{ if(o&&o[old]!==undefined){ o[nw]=o[old]; delete o[old]; } };
  mv(st.targets); mv(st.mineStore); mv(st.storeBase); mv(st.prepaid); mv(st.notes); Object.values(st.daily).forEach(mv);
  st.agentBase.forEach(a=>{ if(a.s===old) a.s=nw; });
  [st.agentDaily,st.mine].forEach(g=>{ Object.keys(g).forEach(k=>{ if(k.startsWith(old+'|')){ g[nw+k.slice(old.length)]=g[k]; delete g[k]; } }); });
  Object.keys(st.agentDaily).forEach(d=>{ const o=st.agentDaily[d]; Object.keys(o).forEach(k=>{ if(k.startsWith(old+'|')){ o[nw+k.slice(old.length)]=o[k]; delete o[k]; } }); });
  st.stores.find(s=>s.name===old).name=nw;
  ['store','agStore','entryAgentStore','simS','meStore'].forEach(k=>{ if(UI[k]===old) UI[k]=nw; });
  try{ if(localStorage.getItem('rpm-store')===old) localStorage.setItem('rpm-store',nw); }catch(e){}
  return 'ok'; }
function addStore(name,short){
  name=String(name).trim(); if(!name) return 'empty'; if(st.stores.some(s=>s.name===name)) return 'dup';
  st.stores.push({name,short:String(short).trim()||name.split(' ')[0],manager:'',band:'',district:''});
  st.targets[name]=Object.fromEntries(KP.map(k=>[k,0])); st.storeBase[name]=Object.fromEntries(KP.map(k=>[k,0])); st.prepaid[name]=[0,0]; return 'ok'; }
function delStore(name){
  st.stores=st.stores.filter(s=>s.name!==name); delete st.targets[name]; delete st.storeBase[name]; delete st.prepaid[name]; delete st.notes[name]; delete st.mineStore[name];
  Object.values(st.daily).forEach(o=>delete o[name]); st.agentBase=st.agentBase.filter(a=>a.s!==name);
  if(UI.store===name) UI.store=st.stores[0]?st.stores[0].name:''; if(UI.agStore===name) UI.agStore='all'; if(UI.simS===name) UI.simS=UI.store; UI.entryAgentStore=UI.store; }
function addBox(name,unit,money,wt){
  name=String(name).trim(); if(!name) return 'empty'; let id='x'+slug(name); if(KMAP[id]||BASE_KP.includes(id)) id+=st.boxes.length+1;
  st.boxes.push({id,name,unit:unit||'units',money:!!money}); rebuildKpis();
  st.stores.forEach(s=>{ st.targets[s.name][id]=0; st.storeBase[s.name][id]=0; }); st.set.weights[id]=Math.max(0,+wt||0)/100; return 'ok'; }
function delBox(id){ st.boxes=st.boxes.filter(b=>b.id!==id); delete st.set.weights[id]; st.stores.forEach(s=>{ delete st.targets[s.name][id]; delete st.storeBase[s.name][id]; }); Object.values(st.daily).forEach(o=>Object.values(o).forEach(x=>delete x[id])); rebuildKpis(); }
function viewSetup(){
  const s=S(), wsum=WK.reduce((a,x)=>a+(s.weights[x]||0),0);
  return `${head('Admin','Setup & targets','<div class="note">Names, boxes, month settings, weights and every store target</div>')}
  
  ${UI.flash?`<div class="info" role="status"><b>${esc(UI.flash)}</b></div>`:''}
  ${sec('Area name','Shown in the header, the dashboard and every screen',`<div class="formrow"><label class="field">Area name<input type="text" id="s-area" value="${esc(st.areaName)}" style="min-width:240px"></label></div>`)}
  ${sec('Stores','Rename a store and everything follows (targets, history, agents, prepaid). Add a new store, or remove one.',`
    ${tbl(['Store name','Short name','Manager',''],st.stores.map((d,i)=>`<tr><td class="name"><input type="text" data-sn="${i}|name" value="${esc(d.name)}" aria-label="Store name"></td><td><input type="text" data-sn="${i}|short" value="${esc(d.short)}" aria-label="Short name"></td><td><input type="text" data-sn="${i}|manager" value="${esc(d.manager||'')}" aria-label="Manager"></td><td class="num"><button type="button" class="btn danger" data-delstore="${esc(d.name)}">${UI.confirmDel===d.name?'Click again to remove':'Remove'}</button></td></tr>`))}
    <div class="formrow" style="margin-top:14px"><label class="field">New store name<input type="text" id="ns-name" placeholder="e.g. Maadi"></label><label class="field">Short name<input type="text" id="ns-short" placeholder="e.g. Maadi"></label><button type="button" class="btn primary" id="ns-add">Add store</button></div>
    <p class="note" style="margin:8px 0 0">A new store starts with zero targets and zero numbers. Fill its targets below, then upload the company report.</p>`)}
  ${sec('Extra boxes (KPIs)','Add a box like EPU. It becomes a column everywhere: targets, daily entry, uploads, KPI overview, heat-map, pace, plan and commission weight.',`
    ${st.boxes.length?tbl(['Box name','Unit','Counts as money (EGP)',['Weight %','num'],''],st.boxes.map((b,i)=>`<tr><td class="name"><input type="text" data-bn="${i}|name" value="${esc(b.name)}" aria-label="Box name"></td><td><input type="text" data-bn="${i}|unit" value="${esc(b.unit)}" aria-label="Unit"></td><td>${b.money?'Yes':'No'}</td><td class="num"><input type="number" min="0" max="100" data-w="${b.id}" value="${Math.round((s.weights[b.id]||0)*100)}"></td><td class="num"><button type="button" class="btn danger" data-delbox="${b.id}">Remove</button></td></tr>`)):'<p class="note" style="margin:0 0 10px">No extra boxes yet. Base boxes: Acquisition (Low, High, VF Cash), Terminal, Connectivity, ADSL.</p>'}
    <div class="formrow" style="margin-top:14px"><label class="field">Box name<input type="text" id="nb-name" placeholder="e.g. EPU"></label><label class="field">Unit<input type="text" id="nb-unit" placeholder="e.g. lines" style="width:120px"></label><label class="field">Weight %<input type="number" min="0" max="100" id="nb-w" value="0" style="width:90px"></label><label class="field" style="grid-template-columns:auto 1fr;align-items:center;gap:8px"><input type="checkbox" id="nb-money">Money (EGP)</label><button type="button" class="btn primary" id="nb-add">Add box</button></div>
    <p class="note" style="margin:8px 0 0">After adding: type each store's target in the table below, enter its daily sales in Enter data, and name the column "EPU MTD" / "EPU Target" in the company file so the upload picks it up. Weights across all boxes should add up to 100%.</p>`)}
  ${sec('Month','',`<div class="formrow"><label class="field">Month start date<input type="date" id="s-start" value="${s.monthStart}"></label><label class="field" style="grid-template-columns:auto 1fr;align-items:center;gap:8px"><input type="checkbox" id="s-fri" ${s.fridayHalf?'checked':''}>Count Fridays as half days</label><label class="field" style="min-width:260px">Extra half-day dates (YYYY-MM-DD, comma separated)<input type="text" id="s-hol" value="${esc(s.holidays.join(', '))}" placeholder="2026-11-26"></label></div><p class="note" style="margin:10px 0 0">${monthDays().length} calendar days · ${n(T.total)} effective days · ${n(T.left)} left</p>`)}
  ${sec('Weights and rules','Acquisition weight applies to Low + High + VF Cash together',`<div class="formrow">${WK.map(x=>`<label class="field">${esc(KMAP[x].short)} weight %<input type="number" min="0" max="100" step="1" data-w="${x}" value="${Math.round((s.weights[x]||0)*100)}"></label>`).join('')}<label class="field">Total<input type="text" readonly value="${Math.round(wsum*100)}%" style="width:80px"></label></div>
    ${Math.abs(wsum-1)>.001?'<p class="miss" style="margin:8px 0 0">Weights should add up to 100%.</p>':''}
    <div class="formrow" style="margin-top:12px"><label class="field">Qualify at % (below pays 0)<input type="number" min="0" max="100" data-r="qual" value="${Math.round(s.qual*100)}"></label><label class="field">Low goal %<input type="number" min="0" data-r="lowGoal" value="${Math.round(s.lowGoal*100)}"></label><label class="field">High goal %<input type="number" min="0" data-r="highGoal" value="${Math.round(s.highGoal*100)}"></label><label class="field">Prepaid cap % of GAs<input type="number" min="0" max="100" data-r="prepCap" value="${Math.round(s.prepCap*100)}"></label></div>
    <p class="note" style="margin:10px 0 0">Commission tiers: ${S().tiers.map(t=>`up to ${pc(t.upTo)} +${Math.round(t.bonus*100)} pts`).join(' · ')} · up to ${pc(S().flatUpTo)} flat ${pc(S().flatVal)} · above that the raw overall. See <a href="#next" style="color:var(--accent)">Next commission tier</a>.</p>`)}
  ${sec('Store targets','Monthly target per store and KPI',tbl(['Store',...KP.map(k=>[KMAP[k].short+(KMAP[k].money?' (EGP)':''),'num']),['Total acquisition','num']],st.stores.map(d=>{ const t=st.targets[d.name]; return `<tr><td class="name">${esc(d.name)}</td>${KP.map(k=>`<td class="num"><input type="number" min="0" data-t="${esc(d.name)}|${k}" value="${t[k]||0}" aria-label="${esc(d.short)} ${esc(KMAP[k].short)} target"></td>`).join('')}<td class="num"><b>${n((t.low||0)+(t.high||0)+(t.vf||0))}</b></td></tr>`}))) }`;
}

/* =============== Employee view =============== */
function computeMine(key){
  const base=st.agentBase.find(x=>agentKey(x)===key); if(!base) return null;
  const my=st.mine[key]||{}, dates=Object.keys(my).filter(d=>d>st.agentBaseDate).sort();
  const upto=dates.length?dates[dates.length-1]:st.agentBaseDate, T=timing(upto);
  const m={}, add={}; KP.forEach(x=>{ m[x]=(base.m[x]||0); add[x]=0; });
  dates.forEach(d=>KP.forEach(x=>{ const v=+my[d][x]||0; add[x]+=v; m[x]+=v; }));
  const k={}; KP.forEach(x=>k[x]=mk(base.t[x]||0,m[x],T)); k.acq=mk((base.t.low||0)+(base.t.high||0)+(base.t.vf||0),m.low+m.high+m.vf,T); applyCap(k);
  const o={key,n:base.n,s:base.s,k,T,dates,add,upto}; o.overall=overallOf(k); o.comm=commission(o.overall); o.addAcq=add.low+add.high+add.vf; return o;
}
function viewMe(){
  const AG=computeAgents(); const stOpts=st.stores.filter(s=>AG.list.some(a=>a.s===s.name));
  if(!UI.meStore||!stOpts.some(s=>s.name===UI.meStore)) UI.meStore=stOpts[0]?stOpts[0].name:'';
  const list=AG.list.filter(a=>a.s===UI.meStore).sort((a,b)=>a.n.localeCompare(b.n));
  if(!UI.meAgent||!list.some(a=>a.key===UI.meAgent)) UI.meAgent=list[0]?list[0].key:'';
  const off=AG.list.find(a=>a.key===UI.meAgent), me=off?computeMine(off.key):null;
  const picker=`<div class="sec"><div class="eyebrow">Choose who you are</div><div class="formrow" style="margin-top:8px"><label class="field">Store${sel('me-store',stOpts.map(s=>[s.name,s.name]),UI.meStore,'Store')}</label><label class="field">I am${sel('me-agent',list.map(a=>[a.key,a.n]),UI.meAgent,'Employee')}</label></div><p class="note" style="margin:8px 0 0">Sales you add here are saved only on this phone or browser and nobody else sees them. They never change the company numbers or the manager screens.</p></div>`;
  if(!me) return `<div class="head"><div><div class="eyebrow">Employee</div><h1>My sales</h1></div><a class="btn" href="#area">Manager view</a></div>${picker}`;
  const nt=nextTier(me,me.T), bs=byName(me.s);
  const date=UI.meDate&&UI.meDate>st.agentBaseDate?UI.meDate:(()=>{ const d=addDays(me.upto,1); const days=monthDays(); return d>days[days.length-1]?days[days.length-1]:d; })();
  const days=monthDays(), lastD=days[days.length-1];
  const ex=(st.mine[me.key]||{})[date]||{};
  return `<div class="head"><div><div class="eyebrow">${esc(bs?bs.short:me.s)} · my numbers</div><h1>${esc(me.n)}</h1></div><a class="btn" href="#area">Manager view</a></div>
  ${picker}
  ${UI.flash?`<div class="info" role="status"><b>${esc(UI.flash)}</b></div>`:''}
  <div class="tiles">
    ${tile('My final commission',pc(me.comm,1),`${tierInfo(me.overall).l} · overall ${pc(me.overall,1)}`,'hero')}
    ${tile('Acquisition',`${n(me.k.acq.m)} / ${n(me.k.acq.t)}`,`${pc(me.k.acq.pct,1)} MTD · ${pc(me.k.acq.proj,1)} projected`,'',bar(me.k.acq.pct,me.T.progress))}
    ${tile('I need per day',n(whole(me.k.acq.daily)),`acquisition lines for ${n(me.T.left)} days`)}
    ${tile('Company file says',pc(off.comm,1),`overall ${pc(off.overall,1)} · as of ${dl(AG.upto)}`)}
  </div>
  ${planCard(me,me.T)}
  ${rankCard(me,off,AG)}
  ${weekCard(me)}
  ${prioCard(me)}
  ${vsCard(me,AG,off)}
  ${whatIfCard(me)}
  ${sec('Add my sales for a day','Only you see these. The manager and area screens keep showing the company file.',`<div class="formrow" style="margin-bottom:12px"><label class="field">Date<input type="date" id="me-date" value="${date}" min="${addDays(st.agentBaseDate,1)}" max="${lastD}"></label></div>
    <div class="addgrid">${KP.map(k=>`<label class="field">${esc(KMAP[k].short)}${KMAP[k].money?' (EGP)':''}<input type="number" inputmode="numeric" min="0" id="me-${k}" value="${ex[k]!=null?ex[k]:''}" placeholder="0"></label>`).join('')}</div>
    <div class="ctrl" style="margin-top:12px"><button type="button" class="btn primary" id="me-save">Save my day</button>${(st.mine[me.key]||{})[date]?'<button type="button" class="btn danger" id="me-del">Delete this day</button>':''}</div>`)}
  ${sec('My numbers','Company file plus what I added',tbl(['KPI',['Target','num'],['Company MTD','num'],['I added','num'],['My total','num'],'My %',['Projection','num'],['Daily req.','num']],
    KPIS.map(kd=>{ const x=me.k[kd.k]; if(!x.t) return ''; const base=off.k[kd.k], add=kd.k==='acq'?me.addAcq:me.add[kd.k];
      return `<tr><td class="name">${kd.label}</td><td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,base.m)}</td><td class="num ${add?'plus':''}">${add?'+'+val(kd,add):dash}</td><td class="num"><b>${val(kd,x.m)}</b></td><td>${bar(x.pct,me.T.progress)}</td><td class="num">${chip(x.proj,pc(x.proj,1))}</td><td class="num">${per(kd,x.daily)}</td></tr>`}))) }
  ${sec('My simulator','Type a what-if projection % for any KPI and see my final commission move. Only for me.',simBody(me,'emp:'+me.key))}
  ${me.dates.length?sec('My saved days','',tbl(['Date',['Acquisition','num'],...KP.filter(k=>!['low','high','vf'].includes(k)).map(k=>[KMAP[k].short,'num']),''],me.dates.map(d=>{ const x=st.mine[me.key][d]; return `<tr><td class="name">${dl(d)} · ${dow(d)}</td><td class="num"><b>${n((+x.low||0)+(+x.high||0)+(+x.vf||0))}</b></td>${KP.filter(k=>!['low','high','vf'].includes(k)).map(k=>`<td class="num">${KMAP[k].money?egp(+x[k]||0):n(+x[k]||0)}</td>`).join('')}<td class="num"><button type="button" class="btn" data-medate="${d}">Edit</button></td></tr>`}))):''}`;
}

/* =============== Store manager view =============== */
function computeMineStore(name){
  const off=ST.find(s=>s.name===name); if(!off) return null;
  const my=(st.mineStore||{})[name]||{}, dates=Object.keys(my).filter(d=>d>st.baseDate&&!st.daily[d]).sort();
  const last=lastDate(), upto=dates.length&&dates[dates.length-1]>last?dates[dates.length-1]:last, T=timing(upto);
  const m=mtdStore(name,last), add={}; KP.forEach(k=>add[k]=0);
  dates.forEach(d=>KP.forEach(k=>{ const v=+my[d][k]||0; add[k]+=v; m[k]=(m[k]||0)+v; }));
  const t=st.targets[name], k={}; KP.forEach(x=>k[x]=mk(t[x]||0,m[x]||0,T)); k.acq=mk((t.low||0)+(t.high||0)+(t.vf||0),(m.low||0)+(m.high||0)+(m.vf||0),T); applyCap(k);
  const o={name,k,T,dates,add,upto,off}; o.overall=overallOf(k); o.comm=commission(o.overall); o.addAcq=add.low+add.high+add.vf; return o; }
function viewMyStore(){
  if(!UI.msStore||!byName(UI.msStore)) UI.msStore=st.stores[0].name;
  const picker=`<div class="sec"><div class="eyebrow">Choose your store</div><div class="formrow" style="margin-top:8px"><label class="field">I am the manager of${sel('ms-store',storeOpts(),UI.msStore,'Store')}</label></div><p class="note" style="margin:8px 0 0">Sales added here are saved only on this phone or browser and nobody else sees them. The dashboard, store cards and area numbers keep showing the company report plus the sales the admin enters.</p></div>`;
  const me=computeMineStore(UI.msStore), off=me.off, nt=nextTier(me,me.T);
  const days=monthDays(), lastD=days[days.length-1];
  const date=UI.msDate&&UI.msDate>st.baseDate?UI.msDate:(()=>{ const d=addDays(me.upto,1); return d>lastD?lastD:d; })();
  const ex=((st.mineStore[me.name]||{})[date])||{};
  return `<div class="head"><div><div class="eyebrow">Store manager · my numbers</div><h1>${esc(me.name)}</h1></div><a class="btn" href="#area">Manager view</a></div>
  ${picker}
  ${UI.flash?`<div class="info" role="status"><b>${esc(UI.flash)}</b></div>`:''}
  <div class="tiles">
    ${tile('My final commission',pc(me.comm,1),`${tierInfo(me.overall).l} · overall ${pc(me.overall,1)}`,'hero')}
    ${tile('Acquisition',`${n(me.k.acq.m)} / ${n(me.k.acq.t)}`,`${pc(me.k.acq.pct,1)} MTD · ${pc(me.k.acq.proj,1)} projected`,'',bar(me.k.acq.pct,me.T.progress))}
    ${tile('I need per day',n(whole(me.k.acq.daily)),`acquisition lines for ${n(me.T.left)} days`)}
    ${tile('Official says',pc(off.comm,1),`overall ${pc(off.overall,1)} · as of ${dl(lastDate())}`)}
  </div>
  ${sec('Add my store sales for a day','Only I see these.',`<div class="formrow" style="margin-bottom:12px"><label class="field">Date<input type="date" id="ms-date" value="${date}" min="${addDays(st.baseDate,1)}" max="${lastD}"></label></div>
    <div class="addgrid">${KP.map(k=>`<label class="field">${esc(KMAP[k].short)}${KMAP[k].money?' (EGP)':''}<input type="number" inputmode="numeric" min="0" id="ms-${k}" value="${ex[k]!=null?ex[k]:''}" placeholder="0"></label>`).join('')}</div>
    <div class="ctrl" style="margin-top:12px"><button type="button" class="btn primary" id="ms-save">Save my day</button>${(st.mineStore[me.name]||{})[date]?'<button type="button" class="btn danger" id="ms-del">Delete this day</button>':''}</div>
    <p class="note" style="margin:8px 0 0">If the admin later saves the same date in Enter data, the official numbers take over for that day.</p>`)}
  ${sec('My numbers','Official numbers plus what I added',tbl(['KPI',['Target','num'],['Official MTD','num'],['I added','num'],['My total','num'],'My %',['Projection','num'],['Daily req.','num']],
    KPIS.map(kd=>{ const x=me.k[kd.k]; if(!x.t) return ''; const base=off.k[kd.k], add=kd.k==='acq'?me.addAcq:me.add[kd.k];
      return `<tr><td class="name">${kd.label}</td><td class="num">${val(kd,x.t)}</td><td class="num">${val(kd,base.m)}</td><td class="num ${add?'plus':''}">${add?'+'+val(kd,add):dash}</td><td class="num"><b>${val(kd,x.m)}</b></td><td>${bar(x.pct,me.T.progress)}</td><td class="num">${chip(x.proj,pc(x.proj,1))}</td><td class="num">${per(kd,x.daily)}</td></tr>`}))) }
  ${sec('Next commission jump',esc(nt.label||'Top tier'),`<p style="margin:0">${esc(nt.text)}</p>`)}
  ${sec('My simulator','Type a what-if projection % for any KPI and see my store final commission move. Only for me.',simBody(me,'ms:'+me.name))}
  ${me.dates.length?sec('My saved days','',tbl(['Date',['Acquisition','num'],...KP.filter(k=>!['low','high','vf'].includes(k)).map(k=>[KMAP[k].short,'num']),''],me.dates.map(d=>{ const x=st.mineStore[me.name][d]; const fk=KP.filter(k=>!['low','high','vf'].includes(k)); return `<tr><td class="name">${dl(d)} · ${dow(d)}</td><td class="num"><b>${n((+x.low||0)+(+x.high||0)+(+x.vf||0))}</b></td>${fk.map(k=>`<td class="num">${KMAP[k].money?egp(+x[k]||0):n(+x[k]||0)}</td>`).join('')}<td class="num"><button type="button" class="btn" data-msdate="${d}">Edit</button></td></tr>`}))):''}`;
}

/* =============== router and bindings =============== */
const PAGES={area:viewArea,store:viewStore,scorecard:viewScorecard,focus:viewFocus,next:viewNext,plan:viewPlan,pace:viewPace,lowhigh:viewLowHigh,daily:viewDaily,prepaid:viewPrepaid,agents:viewAgents,payout:viewPayout,me:viewMe,mystore:viewMyStore,entry:viewEntry,setup:viewSetup};
let CUR='area';
function route(){
  CUR = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'area';
  refresh();
  document.body.classList.toggle('solo',CUR==='me'||CUR==='mystore');
  let html=((CUR==='entry'||CUR==='setup')&&!ADMIN)?loginView():PAGES[CUR]();
  if(st.areaName!=='Cairo Area') html=html.split('Cairo Area').join(esc(st.areaName));
  document.getElementById('app').innerHTML = html;
  renderNav(CUR);
  document.getElementById('brand').textContent = st.areaName+' RPM';
  document.title = st.areaName+' RPM';
  document.getElementById('asof').textContent = dl2(T.asOf);
  document.getElementById('foot').textContent = 'Store figures: company report of '+dl2(st.baseDate)+(T.asOf>st.baseDate?' plus sales added up to '+dl2(T.asOf):'')+'. Agent figures: company file of '+dl2(st.agentBaseDate)+'.';
  applySecs();
  if(!ADMIN) document.querySelectorAll('[data-pp],[data-note]').forEach(e=>{ e.disabled=true; });
  renderStatus();
  bind();
}
const MQ=window.matchMedia('(max-width:720px)');
function applySecs(){ if(!MQ.matches) return; UI.openSecs=UI.openSecs||{}; document.querySelectorAll('#app .sec').forEach((s,i)=>{ const key=CUR+':'+i; s.dataset.sk=key; if(i>=2 && !UI.openSecs[key]) s.classList.add('closed'); }); }
function readSheet(kind,f){
  const key=kind==='stores'?'uploadS':'upload'; const rd=new FileReader();
  rd.onload=async ev=>{ try{ await loadXlsx();
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}); const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null}); const res=parseUpload(rows,kind);
      const dfl=dateFromName(f.name)||(UI[key]&&UI[key].date)||(kind==='stores'?st.baseDate:st.agentBaseDate);
      UI[key] = res.error ? {name:f.name,error:res.error} : {name:f.name,res,date:dfl};
    }catch(err){ UI[key]={name:f.name,error:String(err.message||err)}; } route(); };
  rd.readAsArrayBuffer(f); }
function bind(){
  const $=id=>document.getElementById(id), qa=(s,f)=>document.querySelectorAll(s).forEach(f), on=(id,ev,f)=>{ const e=$(id); if(e) e[ev]=f; };
  qa('[data-store]',el=>{ const go=e=>{ e.preventDefault(); setStore(el.dataset.store); const to=el.dataset.to||'store'; if(location.hash==='#'+to) route(); else location.hash=to; window.scrollTo(0,0); };
    el.addEventListener('click',go); if(el.tagName==='TR') el.addEventListener('keydown',e=>{ if(e.key==='Enter') go(e); }); });
  qa('[data-agent]',el=>{ const go=()=>{ UI.agSel=el.dataset.agent; if(CUR!=='agents'){ location.hash='agents'; } else { route(); } window.scrollTo(0,0); };
    el.addEventListener('click',go); el.addEventListener('keydown',e=>{ if(e.key==='Enter') go(); }); });
  qa('[data-close]',el=>el.addEventListener('click',e=>{ e.preventDefault(); UI.agSel=null; route(); }));
  qa('[data-planK]',el=>el.addEventListener('click',()=>{ UI.planK=el.dataset.plank; route(); }));
  qa('[data-paceK]',el=>el.addEventListener('click',()=>{ UI.paceK=el.dataset.pacek; route(); }));
  qa('[data-note]',el=>el.addEventListener('change',()=>{ st.notes[el.dataset.note]=el.value; save(); }));
  qa('[data-pp]',el=>el.addEventListener('change',()=>{ const [nm,i]=el.dataset.pp.split('|'); st.prepaid[nm]=st.prepaid[nm]||[0,0]; st.prepaid[nm][+i]=Math.max(0,+el.value||0); save(); route(); }));
  qa('[data-sim]',el=>el.addEventListener('change',()=>{ const nm=UI.simKey||UI.simS; UI.simVals[nm]=UI.simVals[nm]||{}; UI.simVals[nm][el.dataset.sim]=el.value; route(); }));
  on('sim-reset','onclick',()=>{ UI.simVals[UI.simKey||UI.simS]={}; route(); });
  const selMap={'store-sel':v=>setStore(v),'ag-store':v=>{UI.agStore=v;UI.agLimit=15;},'ag-sort':v=>{UI.agSort=v;UI.agLimit=15;},'py-store':v=>{UI.pyStore=v;UI.pyLimit=15;},'sim-s':v=>UI.simS=v,'ms-store':v=>{UI.msStore=v;UI.msDate=null;},'me-store':v=>{UI.meStore=v;UI.meAgent=null;UI.meDate=null;},'me-agent':v=>{UI.meAgent=v;UI.meDate=null;}};
  Object.keys(selMap).forEach(id=>on(id,'onchange',e=>{ selMap[id](e.target.value); route(); }));
  on('ag-more','onclick',()=>{ UI.agLimit=(UI.agLimit||15)+15; route(); });
  on('py-more','onclick',()=>{ UI.pyLimit=(UI.pyLimit||15)+15; route(); });
  qa('[data-wi]',el=>{ el.onclick=()=>{ UI.wi=+el.dataset.wi; route(); }; });
  on('wa-copy','onclick',()=>{ const t=UI.waText||''; const done=()=>{ UI.flash='Message copied. Paste it in the WhatsApp group.'; route(); window.scrollTo(0,0); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done,()=>prompt('Copy this message:',t)); else prompt('Copy this message:',t); });
  on('ag-q','oninput',e=>{ UI.agQ=e.target.value; UI.agLimit=15; const p=e.target.selectionStart; route(); const q=$('ag-q'); if(q){ q.focus(); q.setSelectionRange(p,p); } });

  /* enter data: company reports */
  on('e-sfile','onchange',e=>{ const f=e.target.files[0]; if(f) readSheet('stores',f); });
  on('e-afile','onchange',e=>{ const f=e.target.files[0]; if(f) readSheet('agents',f); });
  on('e-sdate','onchange',e=>{ if(UI.uploadS) UI.uploadS.date=e.target.value; route(); });
  on('e-adate','onchange',e=>{ if(UI.upload) UI.upload.date=e.target.value; route(); });
  on('e-sapply','onclick',()=>{ const up=UI.uploadS; if(!up||!up.res) return; const date=up.date||st.baseDate;
    up.res.rows.forEach(x=>{ st.storeBase[x.s]=Object.fromEntries(KP.map(k=>[k,x.m[k]||0])); if(up.res.hasT) KP.forEach(k=>{ if(x.t[k]) st.targets[x.s][k]=x.t[k]; }); });
    st.baseDate=date; Object.keys(st.daily).forEach(d=>{ if(d<=date) delete st.daily[d]; });
    save(); UI.flash='Company stores report of '+dl2(date)+' applied: '+up.res.rows.length+' stores. Now add the day\'s sales below.'; UI.uploadS=null; UI.entryDate=nextEntryDate(); route(); window.scrollTo(0,0); });
  on('e-aapply','onclick',()=>{ const up=UI.upload; if(!up||!up.res) return; const date=up.date||st.agentBaseDate;
    st.agentBase=up.res.rows; st.agentBaseDate=date; Object.keys(st.agentDaily).forEach(d=>{ if(d<=date) delete st.agentDaily[d]; });
    Object.values(st.mine).forEach(m=>Object.keys(m).forEach(d=>{ if(d<=date) delete m[d]; }));
    save(); pushSnap(); UI.flash='Agents report of '+dl2(date)+' applied: '+up.res.rows.length+' agents.'; UI.upload=null; route(); window.scrollTo(0,0); });
  /* enter data: day */
  on('e-date','onchange',e=>{ UI.entryDate=e.target.value; UI.flash=''; route(); });
  on('e-save','onclick',()=>{
    const date=UI.entryDate, days=monthDays();
    if(!date||date<days[0]||date>days[days.length-1]){ UI.flash='Pick a date inside the month.'; return route(); }
    if(date<=st.baseDate){ UI.flash='A day of sales must come after the company report ('+dl(st.baseDate)+'). Upload a newer report instead.'; return route(); }
    const rec={}; let any=false;
    st.stores.forEach((s,i)=>{ rec[s.name]={}; KP.forEach(k=>{ const v=$(`in-${i}-${k}`).value; const x=v===''?0:Math.max(0,+v); rec[s.name][k]=x; if(x) any=true; }); });
    if(!any){ UI.flash='Type at least one number first.'; return route(); }
    const nb=$('e-notify'); UI.notifyOff=!!nb&&!nb.checked; if(nb&&nb.checked) NOTIFY='Sales updated up to '+dl2(date); st.daily[date]=rec; UI.flash='Saved '+dl2(date)+'. Every screen now shows numbers up to this day.'+(nb&&nb.checked?' The team will be notified.':''); UI.entryDate=nextEntryDate(); save(); route(); window.scrollTo(0,0); });
  on('e-del','onclick',()=>{ delete st.daily[UI.entryDate]; save(); UI.flash='Deleted '+dl2(UI.entryDate)+'.'; route(); });
  on('e-reset','onclick',async()=>{ if(!UI.confirmReset){ UI.confirmReset=true; route(); return; } UI.confirmReset=false;
    try{ const rj=await api('reset'); if(!rj.ok) throw new Error(rj.error||'reset'); VERSION=0; DIRTY=false; await fetchState(); UI.entryDate=null; UI.upload=null; UI.uploadS=null; UI.store=st.stores[0].name; UI.flash='Sample data restored.'; }catch(e){ UI.flash='Reset failed. Check the connection.'; } route(); });
  const lf=$('a-form'); if(lf) lf.onsubmit=async e=>{ e.preventDefault(); const b=$('a-login'); b.disabled=true; b.textContent='Signing in...'; await login($('a-pw').value); route(); };
  /* setup */
  on('s-area','onchange',e=>{ st.areaName=e.target.value.trim()||'Cairo Area'; save(); route(); });
  qa('[data-sn]',el=>el.addEventListener('change',()=>{ const [i,f]=el.dataset.sn.split('|'); const d=st.stores[+i];
    if(f==='name'){ const r=renameStore(d.name,el.value); UI.flash=r==='dup'?'Another store already has that name.':r==='ok'?'Store renamed.':''; }
    else d[f]=el.value.trim(); save(); route(); }));
  qa('[data-delstore]',el=>el.addEventListener('click',()=>{ if(UI.confirmDel!==el.dataset.delstore){ UI.confirmDel=el.dataset.delstore; return route(); } if(st.stores.length<2){ UI.flash='Keep at least one store.'; UI.confirmDel=null; return route(); } delStore(el.dataset.delstore); UI.confirmDel=null; UI.flash='Store removed.'; save(); route(); }));
  on('ns-add','onclick',()=>{ const r=addStore($('ns-name').value,$('ns-short').value); UI.flash=r==='ok'?'Store added. Fill its targets below.':r==='dup'?'That store already exists.':'Type a store name first.'; if(r==='ok') save(); route(); });
  on('nb-add','onclick',()=>{ const r=addBox($('nb-name').value,$('nb-unit').value,$('nb-money').checked,$('nb-w').value); UI.flash=r==='ok'?'Box added. Type its targets below and it appears on every screen.':'Type a box name first.'; if(r==='ok') save(); route(); });
  qa('[data-delbox]',el=>el.addEventListener('click',()=>{ delBox(el.dataset.delbox); UI.flash='Box removed.'; save(); route(); }));
  qa('[data-bn]',el=>el.addEventListener('change',()=>{ const [i,f]=el.dataset.bn.split('|'); const b=st.boxes[+i]; b[f]=el.value.trim()||b[f]; rebuildKpis(); save(); route(); }));
  on('s-start','onchange',e=>{ if(e.target.value){ S().monthStart=e.target.value; save(); route(); } });
  on('s-fri','onchange',e=>{ S().fridayHalf=e.target.checked; save(); route(); });
  on('s-hol','onchange',e=>{ S().holidays=e.target.value.split(/[ ,;]+/).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)); save(); route(); });
  qa('[data-w]',el=>el.addEventListener('change',()=>{ S().weights[el.dataset.w]=Math.max(0,+el.value||0)/100; save(); route(); }));
  qa('[data-r]',el=>el.addEventListener('change',()=>{ S()[el.dataset.r]=Math.max(0,+el.value||0)/100; save(); route(); }));
  qa('[data-t]',el=>el.addEventListener('change',()=>{ const [nm,k]=el.dataset.t.split('|'); st.targets[nm][k]=Math.max(0,+el.value||0); save(); route(); }));
  /* store manager view */
  on('ms-date','onchange',e=>{ UI.msDate=e.target.value; UI.flash=''; route(); });
  qa('[data-msdate]',el=>el.addEventListener('click',()=>{ UI.msDate=el.dataset.msdate; UI.flash=''; route(); window.scrollTo(0,0); }));
  on('ms-save','onclick',()=>{ const nm=UI.msStore, date=$('ms-date').value, days=monthDays();
    if(!date||date<=st.baseDate||date>days[days.length-1]){ UI.flash='Pick a date after the company report ('+dl(st.baseDate)+') inside the month.'; return route(); }
    const rec={}; let any=false; KP.forEach(k=>{ const v=$('ms-'+k).value; const x=v===''?0:Math.max(0,+v); rec[k]=x; if(x) any=true; });
    if(!any){ UI.flash='Type at least one number first.'; return route(); }
    st.mineStore[nm]=st.mineStore[nm]||{}; st.mineStore[nm][date]=rec; UI.msDate=null; UI.flash='Saved your store sales for '+dl2(date)+'.'; save(); route(); });
  on('ms-del','onclick',()=>{ const nm=UI.msStore, date=$('ms-date').value; if(st.mineStore[nm]) delete st.mineStore[nm][date]; UI.msDate=null; UI.flash='Deleted.'; save(); route(); });
  /* employee view */
  on('me-date','onchange',e=>{ UI.meDate=e.target.value; UI.flash=''; route(); });
  qa('[data-medate]',el=>el.addEventListener('click',()=>{ UI.meDate=el.dataset.medate; UI.flash=''; route(); window.scrollTo(0,0); }));
  on('me-save','onclick',()=>{ const key=UI.meAgent, date=$('me-date').value, days=monthDays();
    if(!date||date<=st.agentBaseDate||date>days[days.length-1]){ UI.flash='Pick a date after the company file ('+dl(st.agentBaseDate)+') inside the month.'; return route(); }
    const rec={}; let any=false; KP.forEach(k=>{ const v=$('me-'+k).value; const x=v===''?0:Math.max(0,+v); rec[k]=x; if(x) any=true; });
    if(!any){ UI.flash='Type at least one number first.'; return route(); }
    st.mine[key]=st.mine[key]||{}; st.mine[key][date]=rec; UI.meDate=null; UI.flash='Saved your sales for '+dl2(date)+'.'; save(); route(); });
  on('me-del','onclick',()=>{ const key=UI.meAgent, date=$('me-date').value; if(st.mine[key]) delete st.mine[key][date]; UI.meDate=null; UI.flash='Deleted.'; save(); route(); });
}
document.getElementById('app').addEventListener('click',e=>{ if(!MQ.matches) return;
  const h=e.target.closest('.sec-h'); if(h){ const s=h.parentElement; const c=s.classList.toggle('closed'); UI.openSecs=UI.openSecs||{}; UI.openSecs[s.dataset.sk]=!c; return; }
  const nmc=e.target.closest('table.rt:not(.flat) td.name'); if(!nmc||e.target.closest('input,button,a,select,textarea')) return;
  nmc.parentElement.classList.toggle('open'); },true);
const mb=document.getElementById('menu-btn'), sd=document.getElementById('side');
mb.addEventListener('click',()=>{ const o=!sd.classList.contains('open'); sd.classList.toggle('open',o); mb.setAttribute('aria-expanded',String(o)); });
sd.addEventListener('click',e=>{ if(e.target.closest('a')){ sd.classList.remove('open'); mb.setAttribute('aria-expanded','false'); } });
window.addEventListener('hashchange',()=>{ UI.flash=''; route(); window.scrollTo(0,0); });
document.getElementById('lock').onclick=logout;
document.getElementById('sync').onclick=()=>{ if(SYNC==='conflict') location.reload(); else if(SYNC==='offline') push(); };
function renderStatus(){ const s=document.getElementById('sync'), l=document.getElementById('lock'); if(!s) return; s.hidden=l.hidden=!ADMIN;
  const m={idle:['ok','Admin'],saved:['ok','Saved'],saving:['warn','Saving...'],offline:['bad','Offline, will retry'],conflict:['bad','Changed elsewhere, tap to reload']}[SYNC]||['ok','Admin']; s.className='sync '+m[0]; s.title=m[1]; s.innerHTML='<i></i><span class="t">'+m[1]+'</span>'; }
function loginView(){ return `${head('Admin only','Admin sign-in','<div class="note">Enter data and Setup & targets are only for the app admin.</div>')}<div class="sec" style="max-width:440px"><form id="a-form"><label class="field">Admin password<input type="password" id="a-pw" autocomplete="current-password" autofocus style="width:100%"></label><div class="ctrl" style="margin-top:14px"><button class="btn primary" type="submit" id="a-login">Sign in</button></div>${UI.loginErr?`<p class="miss" style="margin:10px 0 0">${esc(UI.loginErr)}</p>`:''}</form></div>`; }
boot();
