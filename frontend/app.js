const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=$('#app');

/* ---------- Veri & Gerçek Obsidian Kasası ---------- */
let vaultTree=[];
let kasalarData=[];
let spacesData=[];
let rootDocsData=[];
let allSources=[];
let backlinksMap={};
let currentSpace='all';
let currentKasa='all';
let kasaSearchQ='';
let kasaViewMode=localStorage.getItem('agydesk_kview')||'grid';
let draggedKasaKey=null;
let tree=[];

const SPACE_ACCENTS=['#e0a458','#79c0ff','#7bc47f','#f0883e','#bc8cff','#ff7b72','#3fb950','#f1e05a'];
const ICON_POOL=[
  ['📘','Ders Kasası'],['🎓','Akademik Dönem'],['🚀','İleri Dönem / Proje'],['🗂','Belgeler & Arşiv'],
  ['⚡','Elektrik & Enerji'],['∿','Kontrol & Sinyal'],['📡','Haberleşme & RF'],['🛰','Tasarım & İHA'],
  ['🌩','Yüksek Gerilim'],['🎛️','Lab & Otomasyon'],['⚛️','Fizik & Yarıiletken'],['🥑','Seçmeli & Genel'],
  ['💻','Yazılım & Kod'],['🧪','Araştırma & Makale'],['📄','Resmi Evrak / CV']
];
function getSpaceObj(id){
  return spacesData.find(s=>s.id===id)||null;
}
function isRootDocGlobal(d){
  if(!d) return false;
  if(d.global===true||d.space==='all'||d.space==='global'||d.space==='*') return true;
  return Array.isArray(d.spaces)&&d.spaces.some(s=>s==='all'||s==='global'||s==='*');
}
function rootDocSpacesList(d){
  if(!d) return [];
  if(isRootDocGlobal(d)) return ['all'];
  if(Array.isArray(d.spaces)&&d.spaces.length) return d.spaces.filter(Boolean);
  return d.space?[d.space]:[];
}
function rootDocMatchesSpace(d,spaceId){
  if(!d) return false;
  if(!spaceId||spaceId==='all') return isRootDocGlobal(d);
  if(isRootDocGlobal(d)) return true;
  return rootDocSpacesList(d).includes(spaceId);
}
function rootDocOnlyInSpace(d,spaceId){
  if(!d||!spaceId||spaceId==='all'||isRootDocGlobal(d)) return false;
  return rootDocSpacesList(d).includes(spaceId);
}
function rootDocScopeBadge(d){
  if(isRootDocGlobal(d)) return {text:'🌐 Tüm Alanlar',title:'Global · Tüm çalışma alanlarında görünür',global:true};
  const list=rootDocSpacesList(d);
  const objs=list.map(id=>getSpaceObj(id)).filter(Boolean);
  if(!objs.length) return {text:'🌐 Tüm Alanlar',title:'Global · Tüm çalışma alanlarında görünür',global:true};
  const first=objs[0];
  const extra=objs.length>1?` +${objs.length-1}`:'';
  const full=objs.map(s=>`${s.icon||'🗂'} ${s.title}`).join(', ');
  return {text:`${first.icon||'🗂'} ${first.title}${extra}`,title:`Kapsam: ${full}`,global:false};
}
async function setRootDocScope(rel,targetSpace,opts={}){
  const prevDoc=rootDocsData.find(d=>d.rel===rel)||pages['note:'+rel]||null;
  const prevSpaces=prevDoc?rootDocSpacesList(prevDoc):['all'];
  const payload=Array.isArray(targetSpace)?{rel,spaces:targetSpace}:{rel,space:targetSpace};
  try{
    const res=await api('/api/root_doc/space',payload);
    const nid='note:'+rel;
    if(noteCache[nid]){
      noteCache[nid].space=res.space;
      noteCache[nid].spaces=res.spaces;
      noteCache[nid].global=res.global;
      noteCache[nid].scope_source=res.scope_source;
    }
    await loadVault();
    const label=res.global?'🌐 Tüm Alanlar (Global)':(getSpaceObj(res.space)?`${getSpaceObj(res.space).icon||'🗂'} ${getSpaceObj(res.space).title}`:res.space);
    if(!opts.skipUndo){
      const prevPayload=prevSpaces.length>1?prevSpaces:(prevSpaces[0]||'all');
      pushAppUndo({
        label:`"${rel}" kapsam değişikliği`,
        undo:async()=>{ await setRootDocScope(rel,prevPayload,{skipUndo:true}); },
        redo:async()=>{ await setRootDocScope(rel,targetSpace,{skipUndo:true}); }
      });
    }
    toast(`📌 "${prevDoc&&prevDoc.title?prevDoc.title:rel}" → ${label}${opts.skipUndo?'':' (Ctrl+Z: Geri al)'}`);
  }catch(e){ alert('Belge kapsamı güncellenemedi: '+e.message); }
}
function openRootDocScopeMenu(ev,rel){
  if(ev){ ev.preventDefault(); ev.stopPropagation(); }
  const doc=rootDocsData.find(d=>d.rel===rel)||pages['note:'+rel];
  if(!doc) return;
  const curGlobal=isRootDocGlobal(doc);
  const curList=rootDocSpacesList(doc);
  const items=[
    {
      icon:'🌐',
      text:`Tüm Alanlar (Global)${curGlobal?' ✓':''}`,
      fn:()=>{ closeNotionTreeMenu(); if(!curGlobal) setRootDocScope(rel,'all'); }
    },
    {sep:true},
    ...spacesData.map(sp=>{
      const on=!curGlobal&&curList.length===1&&curList[0]===sp.id;
      return {
        icon:sp.icon||'🗂',
        text:`Sadece ${sp.title}${on?' ✓':''}`,
        fn:()=>{ closeNotionTreeMenu(); if(!on) setRootDocScope(rel,sp.id); }
      };
    })
  ];
  showTreeMenuItems(ev,`📌 Kapsam: ${doc.title||doc.t||rel}`,items);
}
function renderAccentSwatches(inputId,activeHex){
  const cur=(activeHex||'#e0a458').toLowerCase();
  return `<input type="hidden" id="${inputId}" value="${escHtml(activeHex||'#e0a458')}">
    <div class="swatches">${SPACE_ACCENTS.map(c=>`<button type="button" class="swatch ${c.toLowerCase()===cur?'on':''}" style="background:${c}" title="${c}" onclick="const inp=$('#${inputId}');if(inp)inp.value='${c}';this.parentElement.querySelectorAll('.swatch').forEach(x=>x.classList.toggle('on',x===this));"></button>`).join('')}</div>`;
}
function renderIconOptions(selectedIcon){
  const cur=selectedIcon||'📘';
  const has=ICON_POOL.some(([ic])=>ic===cur);
  const list=has?ICON_POOL:[[cur,'Mevcut İkon'],...ICON_POOL];
  return list.map(([ic,lbl])=>`<option value="${ic}" ${ic===cur?'selected':''}>${ic} ${lbl}</option>`).join('');
}
function renderKasaGroupOptions(selectedKey,emptyLabel=''){
  let html=emptyLabel?`<option value="" ${!selectedKey?'selected':''}>${escHtml(emptyLabel)}</option>`:'';
  const visibleSpaces=(spacesData&&spacesData.length)?spacesData:[{id:'_all',icon:'❖',title:'Kasalar'}];
  visibleSpaces.forEach(sp=>{
    const items=kasalarData.filter(k=>sp.id==='_all'||k.space===sp.id);
    if(!items.length) return;
    html+=`<optgroup label="${escHtml(sp.icon+' '+sp.title)}">${items.map(k=>`<option value="${escHtml(k.key)}" ${selectedKey===k.key?'selected':''}>${escHtml(k.icon+' '+k.title)} (${k.counts?k.counts.total:0})</option>`).join('')}</optgroup>`;
  });
  const orphan=kasalarData.filter(k=>!visibleSpaces.some(sp=>sp.id==='_all'||sp.id===k.space));
  if(orphan.length){
    html+=orphan.map(k=>`<option value="${escHtml(k.key)}" ${selectedKey===k.key?'selected':''}>${escHtml(k.icon+' '+k.title)}</option>`).join('');
  }
  return html;
}

/* ---------- Tarayıcı Tarzı Geri/İleri Geçmişi (Fare Yan Tuşları + Alt+Oklar) ---------- */
let navHistory=[];
let navHistoryIdx=-1;
let _navSuppress=false;
let _navQueuePending=false;
let _lastMouseNavAt=0;

function captureNavSnap(){
  return {
    mode:typeof curMode!=='undefined'?curMode:'kasalar',
    space:currentSpace||'all',
    kasa:currentKasa||'all',
    active:typeof active!=='undefined'?active:'kasalar',
    q:typeof kasaSearchQ!=='undefined'?(kasaSearchQ||''):''
  };
}
function sameNavSnap(a,b){
  return Boolean(a&&b&&a.mode===b.mode&&a.space===b.space&&a.kasa===b.kasa&&a.active===b.active&&(a.q||'')===(b.q||''));
}
function syncNavButtons(){
  const bBtn=$('#navBackBtn'), fBtn=$('#navFwdBtn');
  const canB=navHistoryIdx>0;
  const canF=navHistoryIdx>=0&&navHistoryIdx<navHistory.length-1;
  if(bBtn){ bBtn.classList.toggle('dis',!canB); bBtn.disabled=!canB; }
  if(fBtn){ fBtn.classList.toggle('dis',!canF); fBtn.disabled=!canF; }
}
function recordNavState(){
  if(_navSuppress||_restoringSession) return;
  const snap=captureNavSnap();
  if(navHistoryIdx>=0&&sameNavSnap(navHistory[navHistoryIdx],snap)){
    syncNavButtons();
    return;
  }
  navHistory=navHistory.slice(0,navHistoryIdx+1);
  navHistory.push(snap);
  if(navHistory.length>80) navHistory.shift();
  navHistoryIdx=navHistory.length-1;
  syncNavButtons();
}
function scheduleRecordNavState(){
  if(_navSuppress||_navQueuePending||_restoringSession) return;
  _navQueuePending=true;
  queueMicrotask(()=>{
    _navQueuePending=false;
    recordNavState();
  });
}
function initNavHistory(){
  navHistory=[captureNavSnap()];
  navHistoryIdx=0;
  syncNavButtons();
}
function applyNavSnap(snap){
  if(!snap) return;
  if(typeof closeNotionTreeMenu==='function') closeNotionTreeMenu();
  if(typeof closeNotionSlash==='function') closeNotionSlash();
  if(typeof closeKasaModal==='function') closeKasaModal();
  _navSuppress=true;
  try{
    currentSpace=(snap.space==='all'||getSpaceObj(snap.space))?snap.space:'all';
    currentKasa=(snap.kasa==='all'||kasalarData.some(k=>k.key===snap.kasa))?snap.kasa:'all';
    if(currentSpace!=='all'&&currentKasa!=='all'){
      const kObj=kasalarData.find(k=>k.key===currentKasa);
      if(!kObj||kObj.space!==currentSpace) currentKasa='all';
    }
    kasaSearchQ=snap.q||'';
    let targetPage=snap.active||'kasalar';
    if(String(targetPage).startsWith('note:')&&!pages[targetPage]) targetPage='kasalar';
    if(isAI(targetPage)&&!ai[targetPage]) targetPage='kasalar';
    const targetMode=targetPage==='kasalar'?'kasalar':(snap.mode||'write');

    renderKasaFilterSelect();
    rebuildTreeAndSources();
    if(typeof curMode!=='undefined'&&curMode!==targetMode) layoutMode(targetMode);
    if(active!==targetPage){
      openPage(targetPage);
    }else{
      renderTree(); renderTabs(); renderMain(); updateSideAiCtx(); updateRightProps(); saveSessionTabs();
    }
  }finally{
    Promise.resolve().then(()=>{
      _navSuppress=false;
      syncNavButtons();
    });
  }
}
function navBack(){
  const now=Date.now();
  if(now-_lastMouseNavAt<45) return false;
  if(navHistoryIdx<=0) return false;
  _lastMouseNavAt=now;
  navHistoryIdx--;
  applyNavSnap(navHistory[navHistoryIdx]);
  return true;
}
function navForward(){
  const now=Date.now();
  if(now-_lastMouseNavAt<45) return false;
  if(navHistoryIdx<0||navHistoryIdx>=navHistory.length-1) return false;
  _lastMouseNavAt=now;
  navHistoryIdx++;
  applyNavSnap(navHistory[navHistoryIdx]);
  return true;
}

/* Fare Yan Tuşları (XBUTTON1=3 Geri, XBUTTON2=4 İleri) ve Orta Tık Link Koruması */
document.addEventListener('mousedown',e=>{
  if(e.button===3||e.button===4){ e.preventDefault(); e.stopPropagation(); return; }
  if(e.button===1 && e.target?.closest?.('a.path-link, a.ext-link, a[data-mdlink], code.path-code, a[href="#"]')){
    e.preventDefault(); e.stopPropagation();
  }
},true);
document.addEventListener('auxclick',e=>{
  if(e.button===3||e.button===4){ e.preventDefault(); e.stopPropagation(); return; }
  if(e.button===1){
    const el=e.target?.closest?.('a.path-link, a.ext-link, a[data-mdlink], code.path-code, a[href="#"]');
    if(el){
      e.preventDefault(); e.stopPropagation();
      const tgt=el.dataset?.target||el.dataset?.mdlink||el.getAttribute('href');
      if(tgt && tgt!=='#') openTargetLink(e,tgt);
    }
  }
},true);
document.addEventListener('mouseup',e=>{
  if(e.button===3){ e.preventDefault(); e.stopPropagation(); navBack(); }
  else if(e.button===4){ e.preventDefault(); e.stopPropagation(); navForward(); }
},true);

/* ---------- Uygulama Geneli Geri Al / Yinele (Ctrl+Z / Ctrl+Y) ---------- */
const APP_UNDO_STACK=[];
const APP_REDO_STACK=[];
const CLOSED_TABS_KEY='agydesk_closed_tabs_v1';
const CLOSED_TABS=(()=>{
  try{
    const raw=sessionStorage.getItem(CLOSED_TABS_KEY)||localStorage.getItem(CLOSED_TABS_KEY);
    const arr=raw?JSON.parse(raw):[];
    return Array.isArray(arr)?arr.filter(x=>x&&x.id&&!String(x.id).startsWith('blank:')&&x.id!=='kasalar'):[];
  }catch(e){ return []; }
})();
function saveClosedTabs(){
  try{
    const clean=CLOSED_TABS.filter(x=>x&&x.id&&!String(x.id).startsWith('blank:')&&x.id!=='kasalar').slice(-30);
    const raw=JSON.stringify(clean);
    sessionStorage.setItem(CLOSED_TABS_KEY,raw);
    localStorage.setItem(CLOSED_TABS_KEY,raw);
    if(typeof persistUiState==='function') persistUiState({[CLOSED_TABS_KEY]:raw},false);
  }catch(e){}
}
let _appUndoRunning=false;
let lastAppActionAt=0;

function pushAppUndo(entry){
  if(_appUndoRunning||!entry||typeof entry.undo!=='function') return;
  APP_UNDO_STACK.push(entry);
  if(APP_UNDO_STACK.length>40) APP_UNDO_STACK.shift();
  APP_REDO_STACK.length=0;
  lastAppActionAt=Date.now();
}
async function performAppUndo(){
  if(_appUndoRunning) return false;
  const entry=APP_UNDO_STACK.pop();
  if(!entry) return false;
  _appUndoRunning=true;
  try{
    await entry.undo();
    if(typeof entry.redo==='function'){
      APP_REDO_STACK.push(entry);
      if(APP_REDO_STACK.length>40) APP_REDO_STACK.shift();
    }
    toast(`↶ Geri alındı: ${entry.label}`);
    return true;
  }catch(e){
    alert('İşlem geri alınamadı: '+e.message);
    return false;
  }finally{
    _appUndoRunning=false;
  }
}
async function performAppRedo(){
  if(_appUndoRunning) return false;
  const entry=APP_REDO_STACK.pop();
  if(!entry||typeof entry.redo!=='function') return false;
  _appUndoRunning=true;
  try{
    await entry.redo();
    APP_UNDO_STACK.push(entry);
    if(APP_UNDO_STACK.length>40) APP_UNDO_STACK.shift();
    toast(`↷ İleri alındı: ${entry.label}`);
    return true;
  }catch(e){
    alert('İşlem tekrar uygulanamadı: '+e.message);
    return false;
  }finally{
    _appUndoRunning=false;
  }
}
function reopenLastClosedTab(){
  const vaultLoaded=Object.keys(pages).some(k=>k.startsWith('note:'));
  while(CLOSED_TABS.length){
    const item=CLOSED_TABS.pop();
    saveClosedTabs();
    if(!item||!item.id) continue;
    if(String(item.id).startsWith('blank:')||item.id==='kasalar') continue;
    if(openTabs.includes(item.id)) continue;
    if(String(item.id).startsWith('note:')&&vaultLoaded&&!pages[item.id]) continue;
    if(isAI(item.id)&&!ai[item.id]){
      if(item.aiSnap&&typeof item.aiSnap==='object') ai[item.id]=item.aiSnap;
      else continue;
    }
    const pos=Math.min(Math.max(0,Number.isFinite(item.idx)?item.idx:openTabs.length),openTabs.length);
    openTabs.splice(pos,0,item.id);
    openPage(item.id,true);
    return true;
  }
  return false;
}
const pages={
 kasalar:{t:'Çalışma Alanları',i:'❖'},
 trafo:{t:'Trafo Lab Analizörü',i:'⚡'},
 cal:{t:'AgyCal',i:'▦'},
 sim:{t:'Filtre Simülatörü',i:'∿'}
};
const WIKI_MAP={
 'kasalar':'kasalar',
 'trafo lab analizörü':'trafo',
 'trafo lab':'trafo',
 'düşük geçiren filtre':'sim',
 'filtre tasarımı':'sim',
 'takvim':'cal',
 'sınav takvimi':'cal',
 'agycal':'cal'
};
const noteCache={};
const unlockedNotes=new Set();
function pruneUnlockedNotes(){
  for(const nid of [...unlockedNotes]) if(!openTabs.includes(nid)) unlockedNotes.delete(nid);
}
let editMode=false;

function resolveWiki(rawTarget){
  const parts=rawTarget.split('|');
  const key=parts[0].trim().toLowerCase().replace(/\.md$/,'');
  const label=(parts[1]||parts[0]).trim();
  const id=WIKI_MAP[key]||WIKI_MAP[key.replace(/_/g,' ')];
  return {id,label};
}
function linkifyAndOpen(raw,autoOpen=true){
  let s=String(raw).replace(/</g,'&lt;').replace(/\n/g,'<br>');
  s=s.replace(/\[\[([^\]]+)\]\]/g,(m,inner)=>{
    const {id,label}=resolveWiki(inner);
    if(id){
      if(autoOpen&&!openTabs.includes(id))openTabs.push(id);
      return `<span class="link" onclick="openPage('${id}')">📄 ${label}</span>`;
    }
    return `<span class="link">[[${label}]]</span>`;
  });
  return s;
}
/* ---------- Sohbette ve notlarda gerçek devre çizimleri & Notion pencere başlığı ---------- */
const SV={ln:'var(--cu)',tx:'var(--txt)',dim:'var(--mut)',bg:'var(--bg2)',acc:'var(--blue)',grn:'var(--ok)'};
function svLine(a,b,c,d,col,w){return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${col||SV.ln}" stroke-width="${w||1.8}" stroke-linecap="round"/>`;}
function svTxt(x,y,t,col,anc,sz){return `<text x="${x}" y="${y}" fill="${col||SV.tx}" font-size="${sz||12}" text-anchor="${anc||'middle'}">${t}</text>`;}
function svDot(x,y,col){return `<circle cx="${x}" cy="${y}" r="3.6" fill="${col||SV.ln}"/>`;}
function svTerm(x,y,lbl,dy){return `<circle cx="${x}" cy="${y}" r="4.5" fill="${SV.bg}" stroke="${SV.ln}" stroke-width="1.8"/>`+(lbl?svTxt(x,y+(dy||-12),lbl,SV.ln,'middle',12.5):'');}
function svResH(x,y,w,l,sub){
  const n=6,dx=w/n,a=6.5; let d=`M ${x} ${y}`;
  for(let i=0;i<n;i++){ d+=` L ${x+(i+0.25)*dx} ${y-a} L ${x+(i+0.75)*dx} ${y+a}`; }
  d+=` L ${x+w} ${y}`;
  return `<path d="${d}" fill="none" stroke="${SV.ln}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`+
    (l?svTxt(x+w/2,y-13,l,SV.tx,'middle',12):'')+(sub?svTxt(x+w/2,y+21,sub,SV.dim,'middle',10.5):'');
}
function svResV(x,y,h,l,lx){
  const n=6,dy=h/n,a=6.5; let d=`M ${x} ${y}`;
  for(let i=0;i<n;i++){ d+=` L ${x-a} ${y+(i+0.25)*dy} L ${x+a} ${y+(i+0.75)*dy}`; }
  d+=` L ${x} ${y+h}`;
  return `<path d="${d}" fill="none" stroke="${SV.ln}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`+
    (l?svTxt(x+(lx||-16),y+h/2+4,l,SV.tx,lx>0?'start':'end',12):'');
}
function svIndH(x,y,w,l,sub){
  const n=4,dx=w/n,r=dx/2; let d=`M ${x} ${y}`;
  for(let i=0;i<n;i++){ d+=` A ${r} ${r*1.15} 0 0 1 ${x+(i+1)*dx} ${y}`; }
  return `<path d="${d}" fill="none" stroke="${SV.acc}" stroke-width="1.9" stroke-linecap="round"/>`+
    (l?svTxt(x+w/2,y-14,l,SV.tx,'middle',12):'')+(sub?svTxt(x+w/2,y+21,sub,SV.dim,'middle',10.5):'');
}
function svIndV(x,y,h,l,lx){
  const n=4,dy=h/n,r=dy/2; let d=`M ${x} ${y}`;
  for(let i=0;i<n;i++){ d+=` A ${r*1.15} ${r} 0 0 1 ${x} ${y+(i+1)*dy}`; }
  return `<path d="${d}" fill="none" stroke="${SV.acc}" stroke-width="1.9" stroke-linecap="round"/>`+
    (l?svTxt(x+(lx||14),y+h/2+4,l,SV.tx,(lx||14)>0?'start':'end',12):'');
}
function svCurArrow(x1,y1,x2,y2,lbl,col,lx,ly){
  const c=col||SV.grn, mx=(x1+x2)/2, my=(y1+y2)/2, dx=x2-x1, dy=y2-y1, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L, px=-uy, py=ux;
  const ah=`<polygon points="${mx+ux*5},${my+uy*5} ${mx-ux*4+px*3.8},${my-uy*4+py*3.8} ${mx-ux*4-px*3.8},${my-uy*4-py*3.8}" fill="${c}"/>`;
  const tx=lx!==undefined?mx+lx:mx+px*14, ty=ly!==undefined?my+ly:my+py*14+3;
  return ah+(lbl?svTxt(tx,ty,lbl,c,'middle',11.5):'');
}
function svCoilBranch(x1,y1,x2,y2,n){
  n=n||4; const dx=(x2-x1)/n, dy=(y2-y1)/n, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L, r=L/2;
  let d=`M ${x1} ${y1}`;
  for(let i=0;i<n;i++){
    const sx=x1+i*dx, sy=y1+i*dy, ex=x1+(i+1)*dx, ey=y1+(i+1)*dy, cx=(sx+ex)/2+nx*r*1.25, cy=(sy+ey)/2+ny*r*1.25;
    d+=` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }
  return `<path d="${d}" fill="none" stroke="${SV.ln}" stroke-width="1.8" stroke-linecap="round"/>`;
}
function svStar(cx,cy,L,tag){
  const r=48,P=[[0,-r],[r*0.866,r/2],[-r*0.866,r/2]];
  return P.map((p,i)=>{
    const tx=cx+p[0], ty=cy+p[1], ex=cx+p[0]*1.25, ey=cy+p[1]*1.25;
    return svCoilBranch(cx+p[0]*0.15,cy+p[1]*0.15,tx,ty,4)+svLine(cx,cy,cx+p[0]*0.15,cy+p[1]*0.15)+svLine(tx,ty,ex,ey)+
      svTerm(ex,ey,'',0)+svTxt(cx+p[0]*1.46,cy+p[1]*1.46+4,L[i],SV.tx,'middle',12);
  }).join('')+svDot(cx,cy)+svTxt(cx,cy+15,'N',SV.dim,'middle',10.5)+svTxt(cx,cy+r+38,tag,SV.dim,'middle',11.5);
}
function svDelta(cx,cy,L,tag){
  const r=50,P=[[0,-r],[r*0.866,r/2],[-r*0.866,r/2]];
  const edges=[[0,1],[1,2],[2,0]];
  return edges.map(([a,b])=>{
    const x1=cx+P[a][0],y1=cy+P[a][1],x2=cx+P[b][0],y2=cy+P[b][1];
    const sx=x1+(x2-x1)*0.15,sy=y1+(y2-y1)*0.15,ex=x1+(x2-x1)*0.85,ey=y1+(y2-y1)*0.85;
    return svLine(x1,y1,sx,sy)+svCoilBranch(sx,sy,ex,ey,4)+svLine(ex,ey,x2,y2);
  }).join('')+P.map((p,i)=>{
    const vx=cx+p[0],vy=cy+p[1],ex=cx+p[0]*1.22,ey=cy+p[1]*1.22;
    return svDot(vx,vy)+svLine(vx,vy,ex,ey)+svTerm(ex,ey,'',0)+svTxt(cx+p[0]*1.42,cy+p[1]*1.42+4,L[i],SV.tx,'middle',12);
  }).join('')+svTxt(cx,cy+r+38,tag,SV.dim,'middle',11.5);
}
function semaSvg(name){
  name=String(name).toLowerCase().trim();
  if(name==='trafo-esdeger'){
    const Y1=85, Y2=215;
    return `<svg viewBox="0 0 760 265" font-family="JetBrains Mono,monospace">`+
      `<rect x="235" y="100" width="118" height="102" rx="6" fill="none" stroke="var(--line)" stroke-dasharray="4 3"/>`+
      svLine(46,Y1,95,Y1)+svCurArrow(46,Y1,95,Y1,'I₁',SV.grn,0,-12)+
      svResH(95,Y1,62,'Rₚ (R₁)')+svLine(157,Y1,175,Y1)+
      svIndH(175,Y1,62,'jXₚ (jX₁)')+svLine(237,Y1,380,Y1)+
      svCurArrow(237,Y1,260,Y1,'I₀',SV.acc,0,-12)+
      svDot(262,Y1)+svLine(262,Y1,262,118)+svCurArrow(262,92,262,118,'I_fe',SV.ln,-16,2)+
      svResV(262,118,64,'R_fe',-12)+svLine(262,182,262,Y2)+svDot(262,Y2)+
      svDot(324,Y1)+svLine(324,Y1,324,118)+svCurArrow(324,92,324,118,'I_m',SV.acc,16,2)+
      svIndV(324,118,64,'jX_m',12)+svLine(324,182,324,Y2)+svDot(324,Y2)+
      svCurArrow(330,Y1,380,Y1,'I₂′',SV.grn,0,-12)+
      svResH(380,Y1,62,'Rₛ′ (a²R₂)')+svLine(442,Y1,462,Y1)+
      svIndH(462,Y1,62,'jXₛ′ (a²X₂)')+svLine(524,Y1,615,Y1)+
      svLine(640,Y1,690,Y1)+svLine(690,Y1,690,118)+
      `<rect x="674" y="118" width="32" height="64" rx="4" fill="${SV.bg}" stroke="${SV.ln}" stroke-width="1.8"/>`+
      svTxt(690,154,'Z_L′',SV.tx,'middle',12)+svLine(690,182,690,Y2)+svLine(640,Y2,690,Y2)+
      svLine(46,Y2,615,Y2)+
      svTerm(42,Y1,'+',-10)+svTerm(42,Y2,'−',18)+svTxt(24,154,'V₁',SV.ln,'middle',13)+
      svTerm(620,Y1,'+',-10)+svTerm(620,Y2,'−',18)+svTxt(620,154,'V₂′ = aV₂',SV.ln,'middle',11.5)+
      svTxt(372,154,'E₁ = E₂′',SV.dim,'start',11)+
      svTxt(165,42,'Primer Sargı Empedansı',SV.dim,'middle',11)+
      svTxt(293,238,'Uyarım / Demir Çekirdek Kolu (I₀ = I_fe + I_m)',SV.dim,'middle',11)+
      svTxt(455,42,'Sekonder Sargı (Primere İndirgenmiş)',SV.dim,'middle',11)+
      `</svg><div class="cap">Tek Fazlı Transformatör — Primere İndirgenmiş Tam Eşdeğer Devre</div>`;
  }
  if(name==='trafo-bosta'){
    const Y1=75, Y2=200;
    return `<svg viewBox="0 0 640 245" font-family="JetBrains Mono,monospace">`+
      `<rect x="240" y="90" width="130" height="98" rx="6" fill="none" stroke="var(--line)" stroke-dasharray="4 3"/>`+
      svLine(50,Y1,105,Y1)+svCurArrow(50,Y1,105,Y1,'I₀',SV.grn,0,-12)+
      svResH(105,Y1,56,'Rₚ')+svLine(161,Y1,180,Y1)+svIndH(180,Y1,56,'jXₚ')+svLine(236,Y1,490,Y1)+
      svDot(272,Y1)+svLine(272,Y1,272,108)+svCurArrow(272,82,272,108,'I_fe',SV.ln,-16,2)+
      svResV(272,108,62,'R_fe',-12)+svLine(272,170,272,Y2)+svDot(272,Y2)+
      svDot(340,Y1)+svLine(340,Y1,340,108)+svCurArrow(340,82,340,108,'I_m',SV.acc,16,2)+
      svIndV(340,108,62,'jX_m',12)+svLine(340,170,340,Y2)+svDot(340,Y2)+
      svTxt(435,Y1-12,'I₂′ = 0 (Açık Devre)',SV.dim,'middle',11.5)+
      svLine(50,Y2,490,Y2)+
      svTerm(46,Y1,'+',-10)+svTerm(46,Y2,'−',18)+svTxt(26,142,'V₁ = Vₙ',SV.ln,'middle',12.5)+
      svTerm(495,Y1,'+',-10)+svTerm(495,Y2,'−',18)+svTxt(555,142,'Açık Uç (V₂₀)',SV.dim,'middle',11.5)+
      svTxt(306,225,'P₀ ≈ P_fe = V₁² / R_fe   ·   cos φ₀ = P₀ / (V₁·I₀)   ·   I_fe = I₀ cos φ₀   ·   I_m = I₀ sin φ₀',SV.tx,'middle',11)+
      `</svg><div class="cap">Boşta Çalışma (Açık Devre) Deneyi Eşdeğer Devresi — Demir Kayıpları (R_fe, X_m)</div>`;
  }
  if(name==='trafo-kisadevre'){
    const Y1=80, Y2=195;
    return `<svg viewBox="0 0 640 235" font-family="JetBrains Mono,monospace">`+
      svLine(55,Y1,140,Y1)+svCurArrow(55,Y1,130,Y1,'I_kd = I₁ₙ',SV.grn,0,-12)+
      svResH(140,Y1,90,'R_eş = Rₚ + a²Rₛ','Bakır Kaybı (P_cu)')+svLine(230,Y1,285,Y1)+
      svIndH(285,Y1,90,'jX_eş = j(Xₚ + a²Xₛ)','Kaçak Reaktans')+svLine(375,Y1,490,Y1)+
      svLine(490,Y1,490,Y2,'var(--err)',2.5)+svCurArrow(490,Y1,490,Y2,'I₂′ (Kısa Devre)','var(--err)',62,4)+
      svLine(55,Y2,490,Y2)+
      svTerm(50,Y1,'+',-10)+svTerm(50,Y2,'−',18)+svTxt(28,140,'V_kd',SV.ln,'middle',12.5)+
      svTxt(275,222,'Z_kd = V_kd / I_kd   ·   R_eş = P_kd / I_kd²   ·   X_eş = √(Z_kd² − R_eş²)   (I₀ ≈ 0 ihmal)',SV.tx,'middle',11)+
      `</svg><div class="cap">Kısa Devre Deneyi Eşdeğer Devresi — Bakır Kayıpları (R_eş, X_eş)</div>`;
  }
  if(name==='dc-sont'){
    const Y1=65, Y2=215;
    return `<svg viewBox="0 0 620 250" font-family="JetBrains Mono,monospace">`+
      svLine(55,Y1,210,Y1)+svCurArrow(55,Y1,195,Y1,'I = I_A + I_F')+
      svDot(210,Y1)+svLine(210,Y1,370,Y1)+svCurArrow(215,Y1,290,Y1,'I_F (Şönt)',SV.acc)+
      svLine(210,Y1,210,92)+svResV(210,92,48,'R_A',-12)+svLine(210,140,210,154)+
      `<rect x="203" y="150" width="14" height="6" fill="${SV.ln}"/><circle cx="210" cy="176" r="20" fill="${SV.bg}" stroke="${SV.ln}" stroke-width="2"/><rect x="203" y="196" width="14" height="6" fill="${SV.ln}"/>`+
      svTxt(210,180,'M',SV.ln,'middle',14)+svTxt(175,180,'E_A',SV.tx,'end',12)+
      svLine(210,202,210,Y2)+svDot(210,Y2)+
      svLine(370,Y1,370,98)+svIndV(370,98,64,'R_F / L_F',14)+svLine(370,162,370,174)+
      svResV(370,174,30,'R_ayar',14)+svLine(370,204,370,Y2)+
      svLine(55,Y2,370,Y2)+
      svTerm(50,Y1,'+',-10)+svTerm(50,Y2,'−',18)+svTxt(28,142,'U (DC)',SV.ln,'middle',12.5)+
      svTxt(495,115,'U = E_A + I_A·R_A',SV.tx,'middle',12)+
      svTxt(495,140,'I_F = U / R_F',SV.acc,'middle',12)+
      svTxt(495,165,'E_A = k·Φ·n',SV.grn,'middle',12)+
      `</svg><div class="cap">DC Şönt Motor Eşdeğer Devresi — Endüvi (R_A, E_A) ve Paralel Uyarma Sargısı (R_F)</div>`;
  }
  const m=name.match(/^trafo-baglanti(?:-(yy|yd|dy|dd))?$/);
  if(m){
    const types=m[1]?[m[1]]:['yy','yd','dy','dd'];
    const grp={yy:'Yy0 (0° faz farkı)',yd:'Yd11 (−30° faz farkı)',dy:'Dy11 (−30° faz farkı)',dd:'Dd0 (0° faz farkı)'};
    const one=(t,ox)=>{
      const P=t[0]==='y'?svStar:svDelta, S=t[1]==='y'?svStar:svDelta;
      return `<g transform="translate(${ox},0)">`+
        `<rect x="8" y="8" width="314" height="198" rx="8" fill="var(--bg2)" stroke="var(--line)"/>`+
        P(86,105,['A','B','C'],'Primer ('+(t[0]==='y'?'Yıldız Y':'Üçgen Δ')+')')+
        svLine(161,55,161,150,'var(--mut)',1.8)+svLine(169,55,169,150,'var(--mut)',1.8)+
        S(244,105,['a','b','c'],'Sekonder ('+(t[1]==='y'?'Yıldız y':'Üçgen d')+')')+
        svTxt(165,28,grp[t],SV.ln,'middle',12.5)+`</g>`;
    };
    const cols=types.length;
    return `<svg viewBox="0 0 ${cols*330} 214" font-family="JetBrains Mono,monospace">`+types.map((t,i)=>one(t,i*330)).join('')+`</svg><div class="cap">3 Fazlı Transformatör Sargı Bağlantı Grupları — Y: V_hat = √3·V_faz, I_hat = I_faz  |  Δ: V_hat = V_faz, I_hat = √3·I_faz</div>`;
  }
  return `<div class="cap">Bilinmeyen şema: ${name}</div>`;
}
const LANG_NAMES={c:'C',cpp:'C++',h:'C/C++ Header',py:'Python',python:'Python',js:'JavaScript',ts:'TypeScript',html:'HTML',css:'CSS',bash:'Bash',sh:'Shell',powershell:'PowerShell',ps1:'PowerShell',json:'JSON',sql:'SQL',matlab:'MATLAB',vhdl:'VHDL',verilog:'Verilog',asm:'Assembly',rust:'Rust',go:'Go',java:'Java',md:'Markdown',yaml:'YAML',xml:'XML',txt:'Metin'};
function hlCode(esc,lang){
  const l=String(lang||'').toLowerCase();
  if(!l||l==='txt'||l==='plaintext')return esc;
  const slots=[];
  const keep=h=>`@@HL_${slots.push(h)-1}@@`;
  let s=esc.replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g,m=>keep(`<span class="cm">${m}</span>`));
  s=s.replace(/(&quot;.*?&quot;|'[^'\n]*')/g,m=>keep(`<span class="str">${m}</span>`));
  s=s.replace(/\b(if|else|for|while|do|switch|case|break|continue|return|struct|typedef|enum|union|sizeof|static|volatile|const|extern|inline|def|class|import|from|as|async|await|try|except|finally|function|let|var|new|true|false|null|None|True|False)\b/g,m=>keep(`<span class="kw">${m}</span>`));
  s=s.replace(/\b(void|int|char|float|double|long|short|unsigned|signed|bool|uint8_t|uint16_t|uint32_t|int32_t|size_t|GPIO_TypeDef|RCC|GPIOA|GPIOB|GPIOC|SYSCFG|TIM1|TIM2|ADC1|USART1|EXTI|NVIC)\b/g,m=>keep(`<span class="ty">${m}</span>`));
  s=s.replace(/\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g,m=>keep(`<span class="num">${m}</span>`));
  return s.replace(/@@HL_(\d+)@@/g,(_,i)=>slots[+i]);
}
function copyBlock(btn){
  const box=btn.closest('.cbox'); if(!box)return;
  const pre=box.querySelector('pre');
  const txt=pre?pre.innerText:(box.dataset.raw||'');
  navigator.clipboard.writeText(txt).then(()=>{
    const old=btn.innerHTML; btn.innerHTML='✓'; btn.classList.add('on');
    setTimeout(()=>{btn.innerHTML=old;btn.classList.remove('on');},1400);
  });
}
function wrapBlock(btn){
  const box=btn.closest('.cbox'); if(!box)return;
  box.classList.toggle('wrap'); btn.classList.toggle('on',box.classList.contains('wrap'));
}
function wrapWindow(innerHtml,label,isCode){
  return `<div class="cbox"><span class="cdrag">⋮⋮</span><div class="ctool"><span class="clang">${label}</span>`+
    (isCode?`<span class="csep"></span><button onclick="copyBlock(this)" title="Kodu kopyala">⧉</button><button onclick="wrapBlock(this)" title="Satır kaydırma (Wrap)">↵</button>`:'')+
    `</div>${innerHtml}</div>`;
}
function resolveLocalNoteId(target){
  if(!target) return null;
  let clean=String(target).trim();
  if(/^file:\/\/\//i.test(clean)) clean=clean.slice(8);
  else if(/^file:\/\//i.test(clean)) clean=clean.slice(7);
  try{ clean=decodeURIComponent(clean); }catch(e){}
  clean=clean.replace(/\\/g,'/').replace(/^\/+(?=[A-Za-z]:\/)/,'').split('#')[0].split('?')[0];
  if(!/\.md$/i.test(clean)) return null;
  if(clean.startsWith('note:') && pages[clean]) return clean;
  if(pages['note:'+clean]) return 'note:'+clean;
  const notesIdx=clean.toLowerCase().lastIndexOf('/notes/');
  if(notesIdx!==-1){
    const rel=clean.slice(notesIdx+7);
    if(pages['note:'+rel]) return 'note:'+rel;
  }
  const low=clean.toLowerCase();
  const base=clean.split('/').pop().toLowerCase();
  const keys=Object.keys(pages).filter(k=>k.startsWith('note:'));
  const bySuffix=keys.find(k=>{
    const rel=k.slice(5).toLowerCase();
    return rel===low || low.endsWith('/'+rel) || rel.endsWith('/'+low);
  });
  if(bySuffix) return bySuffix;
  const byBase=keys.find(k=>k.slice(5).split('/').pop().toLowerCase()===base);
  if(byBase) return byBase;
  const wiki=resolveWiki(base);
  return wiki?.id||null;
}
function isLocalAbsPathOrUri(target){
  const s=String(target||'').trim();
  return /^(file:\/\/\/?|[A-Za-z]:[\\/]|~[\\/]|\\\\)/i.test(s);
}
function cleanLocalPathTarget(target){
  let s=String(target||'').trim();
  if(/^file:\/\/\//i.test(s)) s=s.slice(8);
  else if(/^file:\/\//i.test(s)) s=s.slice(7);
  try{ s=decodeURIComponent(s); }catch(e){}
  s=s.split('#')[0].split('?')[0].replace(/^\/+(?=[A-Za-z]:[\\/])/,'');
  return s;
}
function rawUrlForRel(rel,extraQuery=''){
  const s=String(rel||'').trim();
  if(isLocalAbsPathOrUri(s)){
    return '/api/local_raw?path='+encodeURIComponent(cleanLocalPathTarget(s))+(extraQuery?'&'+extraQuery:'');
  }
  return '/api/raw/'+encodeURI(s)+(extraQuery?'?'+extraQuery:'');
}
function findVaultNoteIdForTarget(raw,cleanRel){
  const mdId=resolveLocalNoteId(raw);
  if(mdId) return mdId;
  if(cleanRel){
    if(pages['note:'+cleanRel]) return 'note:'+cleanRel;
    const low=('note:'+cleanRel).toLowerCase();
    const hit=Object.keys(pages).find(k=>k.startsWith('note:')&&k.toLowerCase()===low);
    if(hit) return hit;
  }
  return null;
}
async function openExternalTarget(ev,target,forceReveal=false){
  if(ev){
    if(ev.type==='auxclick'&&ev.button!==1) return true;
    ev.preventDefault();
    ev.stopPropagation();
  }
  if(!target) return false;
  const reveal=forceReveal||!!(ev&&(ev.ctrlKey||ev.metaKey));
  try{
    const res=await fetch('/api/open',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target,reveal})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||!d.ok){
      toast('⚠ '+(d.error||d.detail||'Açılamadı: '+target));
      return false;
    }
    if(d.kind==='parent') toast('📂 Dosya henüz yok, üst klasör açıldı');
  }catch(e){
    toast('⚠ Bağlantı açılamadı');
  }
  return false;
}
async function openTargetLink(ev,target,forceReveal=false){
  if(ev){ev.preventDefault();ev.stopPropagation();}
  if(!target)return false;
  const reveal=forceReveal||!!(ev&&(ev.ctrlKey||ev.metaKey));
  if(reveal || (ev&&ev.button===1)){
    return openExternalTarget(null,target,reveal);
  }
  if(!/^https?:\/\//i.test(String(target).trim()) || String(target).includes('/api/raw/')){
    if(typeof openRightViewer==='function'){
      await openRightViewer(target);
      return false;
    }
    const noteId=resolveLocalNoteId(target);
    if(noteId && typeof openPage==='function'){
      openPage(noteId,true);
      return false;
    }
  }
  return openExternalTarget(null,target,false);
}
function revealTargetFolder(ev,target){
  return openTargetLink(ev,target,true);
}
function normalizeVaultAssetRel(target,base){
  let s=String(target||'').trim();
  if(!s) return '';
  if(/^https?:\/\//i.test(s)&&!s.includes('/api/raw/')) return s;
  if(s.startsWith('note:')) s=s.slice(5);
  s=s.replace(/^.*\/api\/raw\//,'');
  if(/^file:\/\/\//i.test(s)) s=s.slice(8);
  else if(/^file:\/\//i.test(s)) s=s.slice(7);
  try{ s=decodeURIComponent(s); }catch(e){}
  s=s.replace(/\\/g,'/').replace(/^\/+(?=[A-Za-z]:\/)/,'').split('#')[0].split('?')[0];
  const low=s.toLowerCase();
  for(const marker of ['/agydesk_dokuman/','/agydesk_notlar/','/agydesk_belgeler/','/notes/']){
    const idx=low.lastIndexOf(marker);
    if(idx!==-1){ s=s.slice(idx+marker.length); break; }
  }
  while(s.startsWith('../')||s.startsWith('./')){
    s=s.startsWith('../')?s.slice(3):s.slice(2);
  }
  s=s.replace(/^(?:AgyDesk_Dokuman|AgyDesk_Notlar)\//i,'').replace(/^\/+/,'');
  if(base&&s&&!s.startsWith(base+'/')&&!/^[A-Za-z]:\//.test(s)){
    const firstSeg=s.split('/')[0];
    const isKasa=(typeof kasalarData!=='undefined'&&Array.isArray(kasalarData)&&kasalarData.some(k=>k.key===firstSeg))||firstSeg===base.split('/')[0];
    if(!isKasa) s=base+'/'+s;
  }
  return s;
}
function mdToHtml(md,base){
  const mathBlocks=[], codeBlocks=[];
  let s=splitLeadingFrontmatter(md).body;
  const resolveRel=t=>normalizeVaultAssetRel(t,base);
  const imgPh=(t,alt)=>{
    t=String(t).trim(); const e=p=>'/api/raw/'+encodeURI(p);
    const cleanT=normalizeVaultAssetRel(t,'');
    const rel=resolveRel(t);
    const isHttp=/^https?:\/\//i.test(rel);
    const safeRel=escAttr(rel), safeT=escAttr(t), safeAlt=escAttr(alt||''), safeLbl=escAttr(alt||'Görsel');
    const tag=isHttp
      ?`<img class="nimg" src="${safeRel}" alt="${safeAlt}" data-rel="${safeRel}" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede tam ekran aç" onclick="openRightViewer(this.dataset.rel,this.alt||'Görsel')" ondblclick="openDocInTab(this.dataset.rel,this.alt||'Görsel')">`
      :`<img class="nimg" src="${e(rel)}" data-alt="${e(cleanT)}" data-fallback-rel="${escAttr(cleanT)}" data-raw="${safeT}" data-rel="${safeRel}" alt="${safeAlt}" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede tam ekran aç" loading="lazy" onclick="openRightViewer(this.dataset.rel||this.src,this.alt)" ondblclick="openDocInTab(this.dataset.rel||this.src,this.alt)" onerror="if(this.dataset.alt&&!this.dataset.t){this.dataset.t=1;this.src=this.dataset.alt;this.dataset.rel=this.dataset.fallbackRel||this.dataset.rel}"><button class="emb-x" data-raw="${safeT}" onclick="event.stopPropagation();removeEmbed(this.dataset.raw)" title="Bu eki nottan kaldır">✕ kaldır</button>`;
    return `@@CODE_${codeBlocks.push(tag)-1}@@`;
  };
  const docPh=(t,alt)=>{
    t=String(t).trim(); const rel=resolveRel(t);
    const ext=rel.includes('.')?rel.slice(rel.lastIndexOf('.')).toLowerCase():'';
    const ic=ext==='.pdf'?'📄':(ext.startsWith('.ppt')?'📊':(ext.startsWith('.xls')||ext==='.csv'?'📗':'📘'));
    const lbl=alt||rel.split('/').pop()||t.split('/').pop();
    const safeRel=escAttr(rel), safeLbl=escAttr(lbl), safeT=escAttr(t);
    const tag=`<span class="doc-chip" data-rel="${safeRel}" data-lbl="${safeLbl}" onclick="openRightViewer(this.dataset.rel,this.dataset.lbl)" onauxclick="return openExternalTarget(event,this.dataset.rel)" ondblclick="openDocInTab(this.dataset.rel,this.dataset.lbl)" title="Sol tık: Sağda önizle · Orta tık (scroll): Uygulamada aç · Çift tıkla: Sekmede tam ekran aç (${safeRel})">${ic} ${escHtml(lbl)} <small style="opacity:.65">👁 önizle</small><small style="opacity:.85;margin-left:3px;padding:1px 5px;border-radius:4px;background:var(--cu-d);border:1px solid color-mix(in srgb,var(--cu) 35%,transparent)" onclick="event.stopPropagation();openDocInTab(this.parentElement.dataset.rel,this.parentElement.dataset.lbl)" title="AgyDesk içinde yeni sekmede tam ekran aç">⤢ sekmede aç</small><button class="emb-x" data-raw="${safeT}" onclick="event.stopPropagation();removeEmbed(this.dataset.raw)" title="Bu eki nottan kaldır">✕ kaldır</button></span>`;
    return `@@CODE_${codeBlocks.push(tag)-1}@@`;
  };
  s=s.replace(/```sema[ \t]+([\w-]+)[^\n]*\n([\s\S]*?)```/g,(_,n)=>{
    const i=codeBlocks.push(wrapWindow(`<div class="sema">${semaSvg(n)}</div>`,'Devre Şeması · '+n,false))-1;
    return `@@CODE_${i}@@`;
  });
  s=s.replace(/```mermaid\n([\s\S]*?)```/g,(_,c)=>{
    const i=codeBlocks.push(wrapWindow(`<div class="mermaid" style="background:var(--bg);padding:14px;border-radius:10px;border:1px solid var(--line)">${c.trim()}</div>`,'Akış / Blok Diyagramı · Mermaid',false))-1;
    return `@@CODE_${i}@@`;
  });
  s=s.replace(/```(\w*)\n([\s\S]*?)```/g,(_,l,c)=>{
    const raw=l.trim().toLowerCase();
    const guess=!raw&&(/(RCC|GPIO|TIM\d|ADC\d|uint\d+_t|#include|->|\|=)/.test(c)?'c':(/\b(def |import |print\()/.test(c)?'py':''));
    const key=raw||guess;
    const lbl=LANG_NAMES[key]||(key?key.toUpperCase():'Kod / Metin');
    const esc=c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const i=codeBlocks.push(wrapWindow(`<pre><code>${hlCode(esc,key||'c')}</code></pre>`,lbl,true))-1;
    return `@@CODE_${i}@@`;
  });
  s=s.replace(/\$\$([\s\S]*?)\$\$/g,(_,m)=>{
    const i=mathBlocks.push({d:true,m:m.trim()})-1;
    return `@@MATH_${i}@@`;
  });
  s=s.replace(/\$([^\$\n]+?)\$/g,(_,m)=>{
    const i=mathBlocks.push({d:false,m:m.trim()})-1;
    return `@@MATH_${i}@@`;
  });
  s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s=s.replace(/!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif))(?:\|([^\]]*))?\]\]/gi,(_,t,a)=>imgPh(t,a||''));
  s=s.replace(/!?\[\[([^\]|]+\.(?:pdf|docx?|pptx?|xlsx?|csv|txt))(?:\|([^\]]*))?\]\]/gi,(_,t,a)=>docPh(t,a||''));
  s=s.replace(/!\[([^\]]*)\]\(([^)\n]+\.(?:pdf|docx?|pptx?|xlsx?|csv|txt))\)/gi,(_,a,t)=>docPh(t,a));
  s=s.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g,(_,a,t)=>imgPh(t,a));
  s=s.replace(/\[\[([^\]]+)\]\]/g,(_,inner)=>{
    const {id,label}=resolveWiki(inner);
    return id?`<span class="link" onclick="openPage('${id}')">📄 ${label}</span>`:`<span class="link">[[${label}]]</span>`;
  });
  const unescHtml=str=>str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  const escAttr=str=>str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const isExtUrl=str=>/^(https?:\/\/|mailto:)/i.test(str);
  const isLocalPath=str=>/^(file:\/\/\/?|[A-Za-z]:[\\/]|~[\\/])/i.test(str);
  const trimTrail=str=>{
    let r=str;
    while(/[.,;:!?]$/.test(r)) r=r.slice(0,-1);
    while(r.endsWith(')')&&(r.match(/\(/g)||[]).length<(r.match(/\)/g)||[]).length) r=r.slice(0,-1);
    return r;
  };
  const makeUrlTag=(url,lbl)=>{
    const tag=`<a class="ext-link" href="${escAttr(url)}" data-target="${escAttr(url)}" onclick="return openTargetLink(event,this.dataset.target)" onauxclick="return openExternalTarget(event,this.dataset.target)" title="Tarayıcıda aç: ${escAttr(url)}">${lbl}</a>`;
    return `@@CODE_${codeBlocks.push(tag)-1}@@`;
  };
  const makePathTag=(p,lbl)=>{
    const tag=`<a class="path-link" href="#" data-target="${escAttr(p)}" onclick="return openTargetLink(event,this.dataset.target)" onauxclick="return openExternalTarget(event,this.dataset.target)" oncontextmenu="return revealTargetFolder(event,this.dataset.target)" title="Sol tık: Sağ panelde önizle · Orta tık (scroll): Uygulamada/tarayıcıda aç · Sağ tık: Klasörde göster">${lbl}</a>`;
    return `@@CODE_${codeBlocks.push(tag)-1}@@`;
  };
  s=s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(full,lbl,rawTgt)=>{
    const tgt=unescHtml(rawTgt.trim());
    if(isExtUrl(tgt)) return makeUrlTag(tgt,lbl);
    if(isLocalPath(tgt)) return makePathTag(tgt,lbl);
    return full;
  });
  s=s.replace(/`([^`\n]+)`/g,(_,rawInner)=>{
    const clean=unescHtml(rawInner.trim());
    if(isExtUrl(clean)||isLocalPath(clean)){
      const tag=`<code class="path-code" data-target="${escAttr(clean)}" onclick="return openTargetLink(event,this.dataset.target)" onauxclick="return openExternalTarget(event,this.dataset.target)" oncontextmenu="return revealTargetFolder(event,this.dataset.target)" title="Sol tık: Sağ panelde önizle · Orta tık (scroll): Uygulamada/tarayıcıda aç · Sağ tık: Klasörde göster">${rawInner}</code>`;
      return `@@CODE_${codeBlocks.push(tag)-1}@@`;
    }
    return `@@CODE_${codeBlocks.push(`<code>${rawInner}</code>`)-1}@@`;
  });
  s=s.replace(/(https?:\/\/[^\s<>"'`]+|file:\/\/\/?[^\s<>"'`]+)/gi,m=>{
    const clean=trimTrail(m), trail=m.slice(clean.length), raw=unescHtml(clean);
    return (isExtUrl(raw)?makeUrlTag(raw,clean):makePathTag(raw,clean))+trail;
  });
  s=s.replace(/(^|[\s(>])((?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`|?*]+)/g,(_,pre,p)=>{
    const clean=trimTrail(p), trail=p.slice(clean.length), raw=unescHtml(clean);
    return pre+makePathTag(raw,clean)+trail;
  });
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/\*([^*\n]+)\*/g,'<i>$1</i>');
  const lines=s.split('\n');
  let out='', inList=false, inTable=false, inQuote=false;
  const closeAll=()=>{
    if(inList){out+='</ul>';inList=false;}
    if(inTable){out+='</tbody></table>';inTable=false;}
    if(inQuote){out+='</blockquote>';inQuote=false;}
  };
  for(let idx=0;idx<lines.length;idx++){
    const ln=lines[idx];
    if(/^@@CODE_\d+@@$/.test(ln.trim())||/^@@MATH_\d+@@$/.test(ln.trim())){closeAll();out+=ln+'\n';continue;}
    if(/^---+$/.test(ln.trim())){closeAll();out+='<hr>';continue;}
    if(/^#\s+(.+)/.test(ln)){closeAll();out+=`<h1>${RegExp.$1}</h1>`;continue;}
    if(/^##\s+(.+)/.test(ln)){closeAll();out+=`<h2>${RegExp.$1}</h2>`;continue;}
    if(/^###\s+(.+)/.test(ln)){closeAll();out+=`<h3>${RegExp.$1}</h3>`;continue;}
    if(/^&gt;\s?(.*)/.test(ln)){
      if(!inQuote){closeAll();out+='<blockquote>';inQuote=true;}
      const qt=RegExp.$1.replace(/^\[!(\w+)\]\s*(.*)/,'<b style="color:var(--cu)">[$1] $2</b>');
      out+=qt+'<br>';continue;
    }
    if(/^\|(.+)\|$/.test(ln.trim())){
      const cells=ln.trim().slice(1,-1).split('|').map(c=>c.trim());
      if(cells.every(c=>/^:?-{2,}:?$/.test(c)))continue;
      if(!inTable){
        closeAll();
        out+='<table><thead><tr>'+cells.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>';
        inTable=true;
      }else{
        out+='<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+'</tr>';
      }
      continue;
    }
    if(/^\s*[-*]\s+(.+)/.test(ln)||/^\s*\d+\.\s+(.+)/.test(ln)){
      if(!inList){closeAll();out+='<ul>';inList=true;}
      out+=`<li>${RegExp.$1}</li>`;continue;
    }
    if(!ln.trim()){closeAll();continue;}
    closeAll();
    out+=`<p>${ln}</p>`;
  }
  closeAll();
  out=out.replace(/@@MATH_(\d+)@@/g,(_,i)=>{
    const b=mathBlocks[+i];
    if(window.katex){
      try{return katex.renderToString(b.m,{displayMode:b.d,throwOnError:false});}catch(e){}
    }
    return b.d?`<div class="math">${b.m}</div>`:`<code style="color:var(--cu)">${b.m}</code>`;
  });
  out=out.replace(/@@CODE_(\d+)@@/g,(_,i)=>codeBlocks[+i]);
  return out;
}
let openTabs=['kasalar'], active='kasalar';
let checkedSources=new Set();
const WIN_ID=(()=>{
  try{
    let id=sessionStorage.getItem('agydesk_win_id');
    if(!id){
      id='w_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
      sessionStorage.setItem('agydesk_win_id',id);
    }
    return id;
  }catch(e){
    return 'w_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  }
})();
const TAB_STORE_KEY='agydesk_tabs_v1';
const LAST_CLOSED_WIN_KEY='agydesk_last_closed_tabs_v1';
const CLOSED_WINS_KEY='agydesk_closed_wins_v1';
const NOTE_SCROLL_KEY='agydesk_note_scrolls_v1';
const IMG_ROT_KEY='agydesk_img_rot_v1';
const AI_META_KEY='agydesk_ai_meta_v1';
const AI_DRAWER_KEY='agydesk_ai_drawer_v1';
const UI_SYNC_KEYS=[
  'agydesk_theme',
  TAB_STORE_KEY,
  LAST_CLOSED_WIN_KEY,
  CLOSED_WINS_KEY,
  CLOSED_TABS_KEY,
  NOTE_SCROLL_KEY,
  IMG_ROT_KEY,
  AI_META_KEY,
  AI_DRAWER_KEY,
  'agydesk_font',
  'agydesk_tz',
  'agydesk_fullw',
  'agydesk_kview',
  'agydesk_effort',
  'agydesk_clock_fmt',
  'agydesk_pdf_filter',
  'agydesk_rail'
];
let _restoringSession=false;
let _uiStateHydrated=false;
let _closedWinsDirty=false;
let _bootNeedServerClosedWin=false;
let _uiStatePendingPatch={};
let _uiStateFlushTimer=null;
const _initialLocalSeed={};
try{
  UI_SYNC_KEYS.forEach(k=>{
    const v=localStorage.getItem(k);
    if(v!==null) _initialLocalSeed[k]=v;
  });
}catch(e){}
let noteScrollMap={};
try{
  const rawSc=JSON.parse(localStorage.getItem(NOTE_SCROLL_KEY)||'{}');
  if(rawSc&&typeof rawSc==='object') noteScrollMap=rawSc;
}catch(e){}
let _mountedNoteScrollId=null;
let _pendingScrollRestore=null;
let _noteScrollSaveTimer=null;
let _mainScrollRaf=0;
let _mmClickLock=null;

function persistUiState(patch,immediate=false){
  if(!patch||typeof patch!=='object') return;
  try{
    Object.entries(patch).forEach(([k,v])=>{
      if(v===null||v===undefined) localStorage.removeItem(k);
      else localStorage.setItem(k,String(v));
    });
  }catch(e){}
  if(!_uiStateHydrated) return;
  Object.assign(_uiStatePendingPatch,patch);
  if(immediate){
    flushUiStateRemote(false);
    return;
  }
  if(_uiStateFlushTimer) clearTimeout(_uiStateFlushTimer);
  _uiStateFlushTimer=setTimeout(()=>flushUiStateRemote(false),280);
}
function flushUiStateRemote(useBeacon=false){
  if(_uiStateFlushTimer){ clearTimeout(_uiStateFlushTimer); _uiStateFlushTimer=null; }
  if(!_uiStateHydrated) return;
  const payload=_uiStatePendingPatch;
  if(!payload||!Object.keys(payload).length) return;
  _uiStatePendingPatch={};
  const body=JSON.stringify(payload);
  if(useBeacon&&navigator.sendBeacon){
    try{
      navigator.sendBeacon('/api/ui_state',new Blob([body],{type:'application/json'}));
      return;
    }catch(e){}
  }
  fetch('/api/ui_state',{method:'POST',headers:{'Content-Type':'application/json'},body}).catch(()=>{});
}
function persistNoteScrolls(immediate=false){
  const keys=Object.keys(noteScrollMap);
  if(keys.length>120){
    const keep={};
    keys.slice(-100).forEach(k=>{ keep[k]=noteScrollMap[k]; });
    noteScrollMap=keep;
  }
  const raw=JSON.stringify(noteScrollMap);
  if(immediate){ persistUiState({[NOTE_SCROLL_KEY]:raw},true); return; }
  if(_noteScrollSaveTimer) clearTimeout(_noteScrollSaveTimer);
  _noteScrollSaveTimer=setTimeout(()=>{
    _noteScrollSaveTimer=null;
    persistUiState({[NOTE_SCROLL_KEY]:JSON.stringify(noteScrollMap)});
  },300);
}
const chatScrollMap=Object.create(null);
function saveChatScroll(id){
  if(id==='studychat'){
    const c=$('#scChat');
    if(!c) return;
    chatScrollMap['studychat:'+getStudySessId()]={
      top:Math.max(0,Math.round(c.scrollTop||0)),
      atBottom:(c.scrollHeight-c.clientHeight-c.scrollTop)<60
    };
  }else if(id&&isAI(id)){
    const c=$('#aichat');
    if(!c) return;
    chatScrollMap[id]={
      top:Math.max(0,Math.round(c.scrollTop||0)),
      atBottom:(c.scrollHeight-c.clientHeight-c.scrollTop)<60
    };
  }
}
function saveMainScroll(forceId=null){
  const chatTarget=forceId||(active==='studychat'?'studychat':(isAI(active)?active:null));
  if(chatTarget) saveChatScroll(chatTarget);
  const targetId=forceId||_mountedNoteScrollId;
  if(!targetId||!String(targetId).startsWith('note:')) return;
  const m=$('#main');
  if(!m||!m.querySelector('#doc')) return;
  const top=Math.max(0,Math.round(m.scrollTop||0));
  if(noteScrollMap[targetId]!==top){
    noteScrollMap[targetId]=top;
    persistNoteScrolls(false);
  }
}
function restoreMainScroll(id){
  const m=$('#main');
  if(!m) return;
  const target=Math.max(0,Number(noteScrollMap[id]||0));
  _pendingScrollRestore=target>0?{id,top:target,userScrolled:false}:null;
  m.scrollTop=target;
  syncNotionMinimapActive();
  syncNotionFloatLock();
  if(target>0){
    const reapply=()=>{
      if(!_pendingScrollRestore||_pendingScrollRestore.id!==id||_pendingScrollRestore.userScrolled) return;
      const curM=$('#main');
      if(!curM||active!==id||!curM.querySelector('#doc')) return;
      curM.scrollTop=target;
      syncNotionMinimapActive();
      syncNotionFloatLock();
    };
    requestAnimationFrame(reapply);
    setTimeout(reapply,120);
    setTimeout(()=>{
      reapply();
      if(_pendingScrollRestore&&_pendingScrollRestore.id===id) _pendingScrollRestore=null;
    },380);
  }
}
function initMainScrollTracking(){
  const m=$('#main');
  if(!m||m.dataset.scrollWired==='1') return;
  m.dataset.scrollWired='1';
  const cancelRestore=()=>{ if(_pendingScrollRestore) _pendingScrollRestore.userScrolled=true; _mmClickLock=null; };
  m.addEventListener('wheel',cancelRestore,{passive:true});
  m.addEventListener('touchstart',cancelRestore,{passive:true});
  m.addEventListener('mousedown',cancelRestore,{passive:true});
  m.addEventListener('scroll',()=>{
    if(_mainScrollRaf) return;
    _mainScrollRaf=requestAnimationFrame(()=>{
      _mainScrollRaf=0;
      if(_mountedNoteScrollId&&active===_mountedNoteScrollId&&m.querySelector('#doc')){
        const top=Math.max(0,Math.round(m.scrollTop||0));
        if(!_pendingScrollRestore||_pendingScrollRestore.userScrolled){
          noteScrollMap[_mountedNoteScrollId]=top;
          persistNoteScrolls(false);
        }
        syncNotionFloatLock();
        syncNotionMinimapActive();
      }
    });
  },{passive:true});
}

function saveSessionTabs(isClosing=false){
  if(_restoringSession) return;
  try{
    const curRt=document.querySelector('.rt.on');
    const payload={
      openTabs:[...openTabs],
      active,
      curMode:typeof curMode!=='undefined'?curMode:'kasalar',
      currentSpace,
      currentKasa,
      treeOpen:{...TREE_OPEN},
      noLeft:app?app.classList.contains('no-left'):false,
      writeNoLeft:typeof writeNoLeft==='boolean'?writeNoLeft:false,
      noRight:app?app.classList.contains('no-right'):false,
      writeNoRight:typeof writeNoRight==='boolean'?writeNoRight:true,
      studyNoLeft:typeof studyNoLeft==='boolean'?studyNoLeft:false,
      studyNoRight:typeof studyNoRight==='boolean'?studyNoRight:false,
      leftPct:typeof leftPct==='number'&&Number.isFinite(leftPct)?Math.round(leftPct*10000)/10000:LEFT_PCT_DEF,
      rightPct:typeof rightPct==='number'&&Number.isFinite(rightPct)?Math.round(rightPct*10000)/10000:RIGHT_PCT_DEF,
      leftW:typeof leftW==='number'?leftW:248,
      rightW:typeof rightW==='number'?rightW:340,
      rightTab:curRt?curRt.dataset.rt:'ai',
      theme:curTheme
    };
    const raw=JSON.stringify(payload);
    try{ sessionStorage.setItem(TAB_STORE_KEY,raw); }catch(e){}
    if(isClosing){
      try{ localStorage.setItem(LAST_CLOSED_WIN_KEY,raw); }catch(e){}
      persistUiState({[LAST_CLOSED_WIN_KEY]:raw},false);
      try{
        let lst=[]; try{ lst=JSON.parse(localStorage.getItem(CLOSED_WINS_KEY)||'[]'); }catch(e){}
        if(!Array.isArray(lst)) lst=[];
        lst=lst.filter(x=>x&&x.id!==WIN_ID&&x.id!==TAB_DOCK_WIN_ID);
        if(payload.openTabs.length) lst.unshift({id:WIN_ID,ts:Date.now(),p:payload});
        const out=JSON.stringify(lst.slice(0,3));
        localStorage.setItem(CLOSED_WINS_KEY,out);
        _closedWinsDirty=true;
        persistUiState({[CLOSED_WINS_KEY]:out},false);
      }catch(e){}
    }
    if(!window.__IS_DETACHED_WIN){
      localStorage.setItem(TAB_STORE_KEY,raw);
      persistUiState({[TAB_STORE_KEY]:raw},false);
    }
  }catch(e){}
}
function restoreSessionTabs(){
  try{
    const urlParams=new URLSearchParams(window.location.search||'');
    const detachTab=urlParams.get('detach_tab');
    const detachToken=urlParams.get('detach_token');
    if(sessionStorage.getItem('agy_detached_win')==='1'){
      window.__IS_DETACHED_WIN=true;
    }
    if(detachTab){
      window.__IS_DETACHED_WIN=true;
      try{ sessionStorage.setItem('agy_detached_win','1'); }catch(e){}
      let handoff=null;
      if(detachToken){
        try{
          const hRaw=localStorage.getItem('agy_detach_'+detachToken);
          if(hRaw){ handoff=JSON.parse(hRaw); localStorage.removeItem('agy_detach_'+detachToken); }
        }catch(e){}
      }
      _restoringSession=true;
      if(handoff){
        if(typeof handoff.currentSpace==='string'&&handoff.currentSpace) currentSpace=handoff.currentSpace;
        if(typeof handoff.currentKasa==='string'&&handoff.currentKasa) currentKasa=handoff.currentKasa;
        if(handoff.aiData&&detachTab.startsWith('ai')){
          const num=parseInt(detachTab.slice(2),10);
          if(Number.isFinite(num)&&num>aiN) aiN=num;
          ai[detachTab]=handoff.aiData;
        }
      }
      if(detachTab.startsWith('blank:')){
        const num=parseInt(detachTab.slice(6),10);
        if(Number.isFinite(num)&&num>blankN) blankN=num;
      }else if(detachTab.startsWith('ai')&&detachTab!=='side_ai'&&!ai[detachTab]){
        const num=parseInt(detachTab.slice(2),10);
        if(Number.isFinite(num)&&num>aiN) aiN=num;
        ai[detachTab]={title:'Yeni Sohbet',msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
      }
      openTabs=[detachTab];
      active=detachTab;
      const rs=handoff&&handoff.restore;
      if(rs&&Array.isArray(rs.openTabs)){
        const cl=[];
        rs.openTabs.forEach(t=>{
          if(typeof t!=='string'||!t||cl.includes(t)) return;
          if(t.startsWith('blank:')){ const n=parseInt(t.slice(6),10); if(Number.isFinite(n)&&n>blankN) blankN=n; }
          else if(t.startsWith('ai')&&t!=='side_ai'){ const n=parseInt(t.slice(2),10); if(Number.isFinite(n)&&n>aiN) aiN=n; if(!ai[t]) ai[t]={title:'Yeni Sohbet',msgs:[],sources:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]}; }
          cl.push(t);
        });
        if(typeof rs.theme==='string'&&rs.theme){ try{ sessionStorage.setItem('agydesk_win_theme',rs.theme); }catch(e){} applyTheme(rs.theme,false); }
        if(cl.length){ openTabs=cl; active=(typeof rs.active==='string'&&cl.includes(rs.active))?rs.active:cl[0]; if(typeof rs.currentSpace==='string'&&rs.currentSpace) currentSpace=rs.currentSpace; if(typeof rs.currentKasa==='string'&&rs.currentKasa) currentKasa=rs.currentKasa; }
      }
      const targetMode=active==='kasalar'?'kasalar':(isAI(active)?'ai':(active==='cal'?'plan':(active==='studychat'?'study':'write')));
      layoutMode(targetMode);
      syncPdfSlotsWithTabs();
      renderTabs();
      renderTree();
      renderSessions();
      renderMain();
      updateSideAiCtx();
      updateRightProps();
      syncPdfFocusMode();
      _restoringSession=false;
      saveSessionTabs();
      try{ history.replaceState(null,'',window.location.pathname); }catch(e){}
      return true;
    }
    let winRaw=null;
    try{ winRaw=sessionStorage.getItem(TAB_STORE_KEY); }catch(e){}
    const isFreshWindow=!winRaw;
    let saved=null;
    if(!isFreshWindow){
      // Ctrl+R reload: remove any entry pushed by our own beforeunload so we don't duplicate an open window
      try{
        let lst=JSON.parse(localStorage.getItem(CLOSED_WINS_KEY)||'[]');
        if(Array.isArray(lst)&&lst.some(x=>x&&x.id===WIN_ID)){
          const out=JSON.stringify(lst.filter(x=>x&&x.id!==WIN_ID).slice(0,3));
          localStorage.setItem(CLOSED_WINS_KEY,out);
          _closedWinsDirty=true;
          persistUiState({[CLOSED_WINS_KEY]:out},true);
        }
      }catch(e){}
      saved=JSON.parse(winRaw);
    }else{
      // Fresh window launch (double-click AgyDesk.exe): pop 1 closed window (LIFO, max 3); if empty -> blank Çalışma Alanları
      const rawList=localStorage.getItem(CLOSED_WINS_KEY);
      if(rawList===null){
        _bootNeedServerClosedWin=true;
        return false;
      }
      let lst=[]; try{ lst=JSON.parse(rawList||'[]'); }catch(e){}
      if(!Array.isArray(lst)) lst=[];
      while(lst.length){
        const entry=lst.shift();
        if(entry&&entry.p&&Array.isArray(entry.p.openTabs)&&entry.p.openTabs.length){
          saved=entry.p;
          break;
        }
      }
      if(saved){
        const out=JSON.stringify(lst.slice(0,3));
        localStorage.setItem(CLOSED_WINS_KEY,out);
        _closedWinsDirty=true;
        persistUiState({[CLOSED_WINS_KEY]:out},true);
      }
    }
    if(!saved||!Array.isArray(saved.openTabs)||!saved.openTabs.length) return false;
    _restoringSession=true;
    if(saved.treeOpen&&typeof saved.treeOpen==='object'){
      Object.assign(TREE_OPEN,saved.treeOpen);
    }
    if(typeof saved.currentSpace==='string'&&saved.currentSpace) currentSpace=saved.currentSpace;
    if(typeof saved.currentKasa==='string'&&saved.currentKasa) currentKasa=saved.currentKasa;
    const cleaned=[];
    saved.openTabs.forEach(t=>{
      if(typeof t!=='string'||!t) return;
      if(t.startsWith('note:')) t='note:'+normalizeVaultAssetRel(t.slice(5),'');
      if(cleaned.includes(t)) return;
      if(t.startsWith('blank:')){
        const num=parseInt(t.slice(6),10);
        if(Number.isFinite(num)&&num>blankN) blankN=num;
      }else if(t.startsWith('ai')&&t!=='side_ai'){
        if(isFreshWindow) return; // Yeni pencere diger pencerenin AI oturumunu devralmasin
        const num=parseInt(t.slice(2),10);
        if(Number.isFinite(num)&&num>aiN) aiN=num;
        if(!ai[t]) ai[t]={title:'Yeni Sohbet',msgs:[],sources:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
      }
      cleaned.push(t);
    });
    if(isFreshWindow&&saved.curMode==='ai'){
      const freshId=ensureWindowAiSession();
      if(!cleaned.includes(freshId)) cleaned.push(freshId);
      saved.active=freshId;
    }
    if(!cleaned.length){ _restoringSession=false; return false; }
    if(typeof saved.theme==='string'&&saved.theme){ try{ sessionStorage.setItem('agydesk_win_theme',saved.theme); }catch(e){} applyTheme(saved.theme,false); }
    openTabs=cleaned;
    if(typeof saved.active==='string'&&saved.active.startsWith('note:')) saved.active='note:'+normalizeVaultAssetRel(saved.active.slice(5),'');
    active=(typeof saved.active==='string'&&openTabs.includes(saved.active))?saved.active:openTabs[0];
    const targetMode=saved.curMode||(active==='kasalar'?'kasalar':(isAI(active)?'ai':(active==='cal'?'plan':(active==='studychat'?'study':'write'))));
    writeNoLeft=typeof saved.writeNoLeft==='boolean'?saved.writeNoLeft:(targetMode==='write'&&typeof saved.noLeft==='boolean'?saved.noLeft:false);
    writeNoRight=typeof saved.writeNoRight==='boolean'?saved.writeNoRight:(targetMode==='write'&&typeof saved.noRight==='boolean'?saved.noRight:true);
    studyNoLeft=typeof saved.studyNoLeft==='boolean'?saved.studyNoLeft:(targetMode==='study'&&typeof saved.noLeft==='boolean'?saved.noLeft:false);
    studyNoRight=typeof saved.studyNoRight==='boolean'?saved.studyNoRight:(targetMode==='study'&&typeof saved.noRight==='boolean'?saved.noRight:false);
    layoutMode(targetMode);
    if(typeof saved.noLeft==='boolean') app.classList.toggle('no-left',saved.noLeft);
    if(typeof saved.noRight==='boolean') app.classList.toggle('no-right',saved.noRight);
    const avail=paneAvailW();
    if(typeof saved.leftPct==='number'&&Number.isFinite(saved.leftPct)&&saved.leftPct>0) leftPct=clampLeftPct(saved.leftPct);
    else if(typeof saved.leftW==='number'&&Number.isFinite(saved.leftW)) leftPct=clampLeftPct(saved.leftW/avail);
    if(typeof saved.rightPct==='number'&&Number.isFinite(saved.rightPct)&&saved.rightPct>0) rightPct=clampRightPct(saved.rightPct);
    else if(typeof saved.rightW==='number'&&Number.isFinite(saved.rightW)) rightPct=clampRightPct(saved.rightW/avail);
    applyPaneWidths();
    if(typeof saved.rightTab==='string'&&saved.rightTab&&!viewerPrev){
      const rtEl=document.querySelector(`.rt[data-rt="${saved.rightTab}"]`);
      if(rtEl&&rtEl.style.display!=='none'){
        $$('.rt').forEach(x=>x.classList.toggle('on',x===rtEl));
        $$('.rbody').forEach(b=>b.classList.toggle('on',b.id==='rb-'+saved.rightTab));
      }
    }
    syncPaneBtns();
    renderTabs();
    renderMain();
    syncPdfFocusMode();
    _restoringSession=false;
    if(isFreshWindow) saveSessionTabs(false);
    return true;
  }catch(e){
    _restoringSession=false;
    return false;
  }
}

function scopedSources(){
  if(currentKasa!=='all') return allSources.filter(s=>s.kasa===currentKasa);
  if(currentSpace!=='all') return allSources.filter(s=>s.space===currentSpace);
  return allSources;
}
function getCheckedSources(){
  if(currentKasa!=='all'||currentSpace!=='all'){
    const allowed=new Set(scopedSources().map(s=>s.rel));
    return [...checkedSources].filter(r=>allowed.has(r));
  }
  return [...checkedSources];
}
function updateSideAiCtx(){
  const el=$('#sideAiCtx'); if(!el)return;
  const n=getCheckedSources().length;
  const hasNote=String(active).startsWith('note:');
  const spObj=getSpaceObj(currentSpace);
  const kObj=kasalarData.find(k=>k.key===currentKasa);
  const kName=kObj?kObj.title:(spObj?spObj.title:'Tüm Alanlar');
  el.textContent=`📚 ${kName} · ${n} kaynak${hasNote?' + aktif not':''}`;
  const s1=$('#scSrc'); if(s1) s1.textContent=`📚 ${kName}`;
  const scSel=$('#scSrcSel');
  if(scSel){
    scSel.innerHTML=renderKasaGroupOptions(currentKasa==='all'?'':currentKasa,`Tüm Kasalar (${kasalarData.length})`).replace('value=""','value="all"');
    scSel.value=(currentKasa!=='all'&&kasalarData.some(k=>k.key===currentKasa))?currentKasa:'all';
  }
  const s2=$('#scN'); if(s2) s2.textContent=n+' kaynak';
  const stK=$('#stKasa');
  if(stK){
    const visKasas=currentSpace==='all'?kasalarData:kasalarData.filter(k=>k.space===currentSpace);
    stK.textContent=`Alan: ${kName} (${visKasas.reduce((a,k)=>a+(k.counts?k.counts.total:0),0)} dosya)`;
  }
}
function renderSpaceSidebar(){
  const host=$('#spaceSwitchWrap');
  if(!host) return;
  const ic=$('#spaceDropIc'), lbl=$('#spaceDropLbl'), cnt=$('#spaceDropCnt');
  const sp=getSpaceObj(currentSpace);
  if(sp){
    host.style.setProperty('--sp-acc',sp.accent||'var(--cu)');
    if(ic){ ic.textContent=sp.icon||'🗂'; ic.style.color=''; }
    if(lbl) lbl.textContent=sp.title||'Çalışma Alanı';
    if(cnt) cnt.textContent=String(sp.count_kasas||0);
  }else{
    host.style.removeProperty('--sp-acc');
    if(ic){ ic.textContent='❖'; ic.style.color='var(--cu)'; }
    if(lbl) lbl.textContent='Tüm Alanlar';
    if(cnt) cnt.textContent=String(kasalarData.length);
  }
  if(_agyDropKind==='space') renderAgyDropMenu('space');
}
let _agyDropKind=null;
function closeAgyDrop(){
  const pop=$('#agyDropMenu');
  if(pop){ pop.classList.remove('show'); pop.innerHTML=''; }
  ['spaceSwitchWrap','kasaSwitchWrap'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('open'); });
  ['spaceDropBtn','kasaDropBtn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.setAttribute('aria-expanded','false'); });
  _agyDropKind=null;
}
function renderAgyDropMenu(kind){
  const pop=$('#agyDropMenu');
  if(!pop) return;
  if(kind==='space'){
    const allOn=currentSpace==='all';
    const items=[
      `<div class="agydrop-hd">Çalışma Alanları</div>`,
      `<button type="button" class="agydrop-item ${allOn?'on':''}" onclick="closeAgyDrop();selectSpaceFilter('all')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'all')">
        <span class="agydrop-item-ic" style="color:var(--cu)">❖</span>
        <span class="agydrop-item-nm">Tüm Alanlar</span>
        <span class="agydrop-item-cnt">${kasalarData.length}</span>
        ${allOn?'<span class="agydrop-chk">✓</span>':''}
      </button>`,
      ...spacesData.map(sp=>{
        const on=currentSpace===sp.id;
        return `<button type="button" class="agydrop-item ${on?'on':''}" style="--sp-acc:${escHtml(sp.accent||'var(--cu)')}" onclick="closeAgyDrop();selectSpaceFilter('${escHtml(sp.id)}')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'${escHtml(sp.id)}')">
          <span class="agydrop-item-ic">${escHtml(sp.icon||'🗂')}</span>
          <span class="agydrop-item-nm">${escHtml(sp.title)}</span>
          <span class="agydrop-item-cnt">${sp.count_kasas||0}</span>
          ${on?'<span class="agydrop-chk">✓</span>':''}
        </button>`;
      }),
      `<div class="agydrop-sep"></div>`,
      `<button type="button" class="agydrop-act" onclick="closeAgyDrop();openSpaceModal()"><span>＋</span><span>Yeni Çalışma Alanı</span></button>`
    ];
    pop.innerHTML=items.join('');
    return;
  }
  const spObj=getSpaceObj(currentSpace);
  const visKasas=currentSpace==='all'?kasalarData:kasalarData.filter(k=>k.space===currentSpace);
  const allOn=currentKasa==='all';
  const allIcon=spObj?(spObj.icon||'🗂'):'❖';
  const allText=spObj?`${spObj.title} (Tümü)`:'Tüm Kasalar';
  const html=[
    `<div class="agydrop-hd">Kasalar</div>`,
    `<button type="button" class="agydrop-item ${allOn?'on':''}" onclick="closeAgyDrop();selectKasaFilter('all')">
      <span class="agydrop-item-ic" ${spObj?'':'style="color:var(--cu)"'}>${escHtml(allIcon)}</span>
      <span class="agydrop-item-nm">${escHtml(allText)}</span>
      <span class="agydrop-item-cnt">${visKasas.length}</span>
      ${allOn?'<span class="agydrop-chk">✓</span>':''}
    </button>`
  ];
  const renderKasaItem=(k,sub)=>{
    const on=currentKasa===k.key;
    const cnt=k.counts?k.counts.total:0;
    return `<button type="button" class="agydrop-item ${sub?'sub':''} ${on?'on':''}" onclick="closeAgyDrop();selectKasaFilter('${escHtml(k.key)}')">
      <span class="agydrop-item-ic">${escHtml(k.icon||'📁')}</span>
      <span class="agydrop-item-nm">${escHtml(k.title)}</span>
      <span class="agydrop-item-cnt">${cnt}</span>
      ${on?'<span class="agydrop-chk">✓</span>':''}
    </button>`;
  };
  if(currentSpace!=='all'){
    visKasas.forEach(k=>html.push(renderKasaItem(k,false)));
  }else{
    const visibleSpaces=(spacesData&&spacesData.length)?spacesData:[{id:'_all',icon:'❖',title:'Kasalar'}];
    visibleSpaces.forEach(sp=>{
      const items=kasalarData.filter(k=>sp.id==='_all'||k.space===sp.id);
      if(!items.length) return;
      if(sp.id!=='_all') html.push(`<div class="agydrop-grp"><span>${escHtml(sp.icon||'🗂')}</span><span>${escHtml(sp.title)}</span></div>`);
      items.forEach(k=>html.push(renderKasaItem(k,sp.id!=='_all')));
    });
    const orphan=kasalarData.filter(k=>!visibleSpaces.some(sp=>sp.id==='_all'||sp.id===k.space));
    if(orphan.length){
      html.push(`<div class="agydrop-grp"><span>📁</span><span>Diğer Kasalar</span></div>`);
      orphan.forEach(k=>html.push(renderKasaItem(k,true)));
    }
  }
  pop.innerHTML=html.join('');
}
function toggleAgyDrop(kind,ev){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  if(_agyDropKind===kind){ closeAgyDrop(); return; }
  closeAgyDrop();
  const pop=$('#agyDropMenu');
  const wrap=document.getElementById(kind==='space'?'spaceSwitchWrap':'kasaSwitchWrap');
  const btn=document.getElementById(kind==='space'?'spaceDropBtn':'kasaDropBtn');
  if(!pop||!wrap||!btn) return;
  _agyDropKind=kind;
  renderAgyDropMenu(kind);
  wrap.classList.add('open');
  btn.setAttribute('aria-expanded','true');
  const r=wrap.getBoundingClientRect();
  const w=Math.max(Math.round(r.width),232);
  pop.style.width=Math.min(w,292)+'px';
  pop.classList.add('show');
  const popW=pop.offsetWidth||w;
  const popH=pop.offsetHeight||240;
  let left=r.left;
  if(left+popW>window.innerWidth-10) left=Math.max(10,window.innerWidth-popW-10);
  let top=r.bottom+6;
  if(top+popH>window.innerHeight-10) top=Math.max(10,r.top-popH-6);
  pop.style.left=Math.round(left)+'px';
  pop.style.top=Math.round(top)+'px';
}
document.addEventListener('click',e=>{
  if(!_agyDropKind) return;
  if(e.target.closest('#agyDropMenu,#spaceSwitchWrap,#kasaSwitchWrap')) return;
  closeAgyDrop();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_agyDropKind) closeAgyDrop(); });
window.addEventListener('resize',()=>{ if(_agyDropKind) closeAgyDrop(); });
setTimeout(()=>{ const lb=$('#leftBody'); if(lb) lb.addEventListener('scroll',()=>{ if(_agyDropKind==='kasa') closeAgyDrop(); },{passive:true}); },0);
function rebuildTreeAndSources(){
  renderSpaceSidebar();
  const lt=$('#leftTitle');
  if(lt&&typeof curMode!=='undefined'&&curMode!=='ai'&&curMode!=='study'&&curMode!=='plan'){
    const sp=getSpaceObj(currentSpace);
    lt.textContent=sp?`${sp.icon} ${sp.title}`:'Alanlar & Kasalar';
  }
  let topGroups=[];
  if(currentKasa!=='all'){
    topGroups=vaultTree.filter(g=>g.kasa===currentKasa).map(g=>({...g,open:true}));
  }else if(currentSpace!=='all'){
    topGroups=vaultTree.filter(g=>g.space===currentSpace).map(g=>({...g}));
  }else if(spacesData.length){
    topGroups=spacesData.map(sp=>{
      const spKasas=vaultTree.filter(g=>g.space===sp.id);
      const spScopedRoots=rootDocsData.filter(d=>rootDocOnlyInSpace(d,sp.id));
      const spKids=[...spKasas];
      if(spScopedRoots.length){
        spKids.push({
          n:`Ortak Belgeler (${spScopedRoots.length})`,
          i:'📌',
          rel:`_root_docs:${sp.id}`,
          open:false,
          k:spScopedRoots.map(d=>({n:d.title,i:d.icon,id:d.id,rel:d.rel}))
        });
      }
      const sk='space:'+sp.id;
      const isOpen=(sk in TREE_OPEN)?TREE_OPEN[sk]:(sp.id==='donem_7'||(spKasas.length>0&&spKasas.length<=3));
      return {
        n:`${sp.title} (${spKasas.length})`,
        i:sp.icon||'🗂',
        spaceId:sp.id,
        accent:sp.accent||'#e0a458',
        open:isOpen,
        k:spKids
      };
    });
    const orphan=vaultTree.filter(g=>!spacesData.some(sp=>sp.id===g.space));
    if(orphan.length) topGroups.push(...orphan);
  }else{
    topGroups=vaultTree.map(g=>({...g}));
  }
  const visRoots=(currentKasa==='all')
    ?(currentSpace==='all'
        ?rootDocsData.filter(d=>isRootDocGlobal(d))
        :rootDocsData.filter(d=>rootDocMatchesSpace(d,currentSpace)))
    :[];
  if(visRoots.length){
    topGroups.push({
      n:`Ortak Belgeler (${visRoots.length})`,
      i:'📌',
      rel:'_root_docs',
      open:false,
      k:visRoots.map(d=>({n:d.title,i:d.icon,id:d.id,rel:d.rel}))
    });
  }
  tree=[
    ...topGroups,
    {n:'Mühendislik Araçları',i:'⚡',open:currentKasa==='all'&&currentSpace==='all',k:[
      {n:'Kasalar & Çalışma Alanları',id:'kasalar',i:'❖'},
      {n:'Trafo Lab Analizörü',id:'trafo',i:'⚡'},
      {n:'RC Filtre Bode Simülatörü',id:'sim',i:'∿'},
      {n:'AgyCal · Akıllı Takvim',id:'cal',i:'▦'}
    ]}
  ];
  const sh=$('#sources');
  if(sh){
    const prevScroll=sh.scrollTop;
    const srcs=scopedSources();
    const chkCount=srcs.filter(s=>checkedSources.has(s.rel)).length;
    const allChk=srcs.length>0&&chkCount===srcs.length;
    const someChk=chkCount>0&&chkCount<srcs.length;
    sh.innerHTML=`<div class="ph"><span>Kasadan Kaynaklar</span><span>${chkCount}/${srcs.length} seçili</span></div>`+
      `<div class="src-bar"><button class="hb" style="border-color:color-mix(in srgb,var(--cu) 45%,transparent);color:var(--cu)" onclick="triggerAssetUpload()">📎 Dosya Ekle</button><button class="hb" onclick="openNewNoteModal()">＋ Yeni Not</button><label class="src-all${srcs.length?'':' disabled'}" title="Tüm kaynakları seç / seçimleri kaldır"><span>Tümü</span><input type="checkbox" id="srcAllChk"></label></div>`;
    const masterChk=sh.querySelector('#srcAllChk');
    if(masterChk){
      masterChk.checked=allChk;
      masterChk.indeterminate=someChk;
      masterChk.disabled=!srcs.length;
      masterChk.onchange=()=>toggleAllSources(masterChk.checked);
    }
    srcs.forEach(s=>{
      const side=isSideDoc(s.rel||s.id);
      const isChk=checkedSources.has(s.rel);
      const lbl=currentKasa==='all'?s.title:(s.short_title||s.title);
      const row=document.createElement('div');
      row.className='src';
      row.style.cssText='cursor:pointer;gap:6px';
      row.title=`${s.title}${side?' (Tıkla: Sağda önizle · Orta tuş veya ⤢: Sekmede aç)':' (Tıkla: Aç · Orta tuş: Yeni sekmede aç)'}`;
      const span=document.createElement('span');
      span.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
      span.textContent=`${s.icon} ${lbl}`;
      row.appendChild(span);
      if(side){
        const tb=document.createElement('button');
        tb.type='button';
        tb.className='ph-btn';
        tb.dataset.tabbtn='1';
        tb.style.cssText='width:18px;height:18px;font-size:10.5px;margin-left:auto;margin-right:4px';
        tb.title='AgyDesk içinde yeni sekmede tam ekran aç';
        tb.textContent='⤢';
        tb.onclick=e=>{
          e.preventDefault();
          e.stopPropagation();
          openPage(s.id,true,{newTab:true});
        };
        row.appendChild(tb);
      }
      const del=document.createElement('button');
      del.type='button';
      del.className='ph-btn ti-del';
      del.style.cssText=`width:18px;height:18px;font-size:11px;margin-right:4px${side?'':';margin-left:auto'}`;
      del.title='Kasadan sil';
      del.textContent='🗑';
      del.onclick=e=>{
        e.preventDefault();
        e.stopPropagation();
        deleteActiveNote(s.id);
      };
      row.appendChild(del);
      const chk=document.createElement('input');
      chk.type='checkbox';
      chk.dataset.src=s.rel;
      chk.checked=isChk;
      chk.onclick=e=>e.stopPropagation();
      chk.onchange=()=>onSourceCheck(s.rel,chk.checked);
      row.appendChild(chk);
      row.onclick=e=>{
        if(e.target.closest('input,button')) return;
        if(side){
          openRightViewer(s.rel,s.title);
        }else{
          e.preventDefault();
          openPage(s.id);
        }
      };
      row.onmousedown=e=>{ if(e.button===1) e.preventDefault(); };
      row.onauxclick=e=>{
        if(e.button===1&&!e.target.closest('.ti-del,input')){
          e.preventDefault();
          e.stopPropagation();
          openPage(s.id,true,{newTab:true});
        }
      };
      sh.appendChild(row);
    });
    sh.scrollTop=prevScroll;
  }
  updateSideAiCtx();
}
function onSourceCheck(rel,chk){
  if(chk) checkedSources.add(rel); else checkedSources.delete(rel);
  rebuildTreeAndSources();
}
function toggleAllSources(chk){
  const srcs=scopedSources();
  srcs.forEach(s=>{ if(chk) checkedSources.add(s.rel); else checkedSources.delete(s.rel); });
  rebuildTreeAndSources();
}
function renderKasaFilterSelect(){
  const sel=$('#kasaSelect');
  const spObj=getSpaceObj(currentSpace);
  const visKasas=currentSpace==='all'?kasalarData:kasalarData.filter(k=>k.space===currentSpace);
  const allLabel=spObj?`${spObj.icon} ${spObj.title} (${visKasas.length})`:`Tüm Kasalar (${kasalarData.length})`;
  const validVal=(currentKasa!=='all'&&visKasas.some(k=>k.key===currentKasa))?currentKasa:'all';
  if(sel){
    if(currentSpace!=='all'){
      sel.innerHTML=`<option value="all">${escHtml(allLabel)}</option>`+
        visKasas.map(k=>`<option value="${escHtml(k.key)}" ${validVal===k.key?'selected':''}>${escHtml(k.icon+' '+k.title)} (${k.counts?k.counts.total:0})</option>`).join('');
    }else{
      sel.innerHTML=renderKasaGroupOptions(validVal==='all'?'':validVal, allLabel).replace('value=""','value="all"');
    }
    sel.value=validVal;
  }
  const ic=$('#kasaDropIc'), lbl=$('#kasaDropLbl'), cnt=$('#kasaDropCnt');
  if(validVal!=='all'){
    const kObj=visKasas.find(k=>k.key===validVal);
    if(kObj){
      if(ic){ ic.textContent=kObj.icon||'📁'; ic.style.color=''; }
      if(lbl) lbl.textContent=kObj.title;
      if(cnt) cnt.textContent=String(kObj.counts?kObj.counts.total:0);
    }
  }else if(spObj){
    if(ic){ ic.textContent=spObj.icon||'🗂'; ic.style.color=''; }
    if(lbl) lbl.textContent=`${spObj.title} (Tümü)`;
    if(cnt) cnt.textContent=String(visKasas.length);
  }else{
    if(ic){ ic.textContent='❖'; ic.style.color='var(--cu)'; }
    if(lbl) lbl.textContent='Tüm Kasalar';
    if(cnt) cnt.textContent=String(kasalarData.length);
  }
  if(_agyDropKind==='kasa') renderAgyDropMenu('kasa');
}
function selectSpaceFilter(spaceId,openHome=false){
  currentSpace=spaceId||'all';
  if(currentSpace!=='all'&&!getSpaceObj(currentSpace)) currentSpace='all';
  if(currentKasa!=='all'){
    const kObj=kasalarData.find(k=>k.key===currentKasa);
    if(!kObj||(currentSpace!=='all'&&kObj.space!==currentSpace)) currentKasa='all';
  }
  renderKasaFilterSelect();
  rebuildTreeAndSources();
  renderTree();
  updateRightProps();
  updateSideAiCtx();
  renderStudio();
  if(active==='studychat'&&$('#main')) renderStudyChat($('#main'));
  saveSessionTabs();
  if(openHome){
    layoutMode('kasalar');
    openPage('kasalar');
  }else if(active==='kasalar'){
    renderMain();
  }
  scheduleRecordNavState();
}
function enterSpace(spaceId){
  kasaSearchQ='';
  currentKasa='all';
  selectSpaceFilter(spaceId,true);
}
function setKasaViewMode(mode){
  kasaViewMode=mode==='list'?'list':'grid';
  persistUiState({agydesk_kview:kasaViewMode});
  if(active==='kasalar') renderMain();
}
function selectKasaFilter(val){
  currentKasa=val||'all';
  if(currentKasa!=='all'){
    const kObj=kasalarData.find(k=>k.key===currentKasa);
    if(kObj&&kObj.space&&currentSpace!=='all'&&kObj.space!==currentSpace) currentSpace=kObj.space;
  }
  renderKasaFilterSelect();
  rebuildTreeAndSources();
  renderTree();
  updateRightProps();
  updateSideAiCtx();
  renderStudio();
  if(active==='studychat'&&$('#main')) renderStudyChat($('#main'));
  saveSessionTabs();
  scheduleRecordNavState();
}
function openKasalarHome(resetSpace=true){
  if(resetSpace){
    currentSpace='all';
    currentKasa='all';
    kasaSearchQ='';
    renderKasaFilterSelect();
    rebuildTreeAndSources();
    renderTree();
  }
  layoutMode('kasalar');
  openPage('kasalar');
  if(active==='kasalar') renderMain();
  saveSessionTabs();
}
function enterKasa(kasaKey,targetMode='write'){
  currentKasa=kasaKey;
  const kObj=kasalarData.find(x=>x.key===kasaKey);
  if(kObj&&kObj.space) currentSpace=kObj.space;
  renderKasaFilterSelect();
  allSources.forEach(s=>{
    if(s.kasa===kasaKey && (s.rel.includes('00_')||s.rel.includes('TEK_PARCA')||s.ext==='.md')) checkedSources.add(s.rel);
  });
  rebuildTreeAndSources();
  layoutMode(targetMode);
  if(kObj&&kObj.index_id){
    openPage(kObj.index_id);
  }else{
    renderTree(); renderTabs(); renderMain(); saveSessionTabs();
  }
}
function handleSpaceDragStart(ev,kasaKey){
  draggedKasaKey=kasaKey;
  if(ev.dataTransfer){ ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain',kasaKey); }
  const card=ev.currentTarget;
  if(card&&card.classList) setTimeout(()=>card.classList.add('dragging'),0);
}
function handleSpaceDragEnd(ev){
  draggedKasaKey=null;
  if(ev.currentTarget&&ev.currentTarget.classList) ev.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));
}
function handleSpaceDragOver(ev,el){
  if(!draggedKasaKey&&!(ev.dataTransfer&&ev.dataTransfer.types&&[...ev.dataTransfer.types].includes('text/plain'))) return;
  ev.preventDefault();
  if(ev.dataTransfer) ev.dataTransfer.dropEffect='move';
  if(el&&el.classList) el.classList.add('drag-over');
}
function handleSpaceDragLeave(el){
  if(el&&el.classList) el.classList.remove('drag-over');
}
async function handleSpaceDrop(ev,targetSpaceId){
  ev.preventDefault();
  document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));
  const kasaKey=draggedKasaKey||(ev.dataTransfer?ev.dataTransfer.getData('text/plain'):'');
  draggedKasaKey=null;
  if(!kasaKey||!targetSpaceId||targetSpaceId==='all') return;
  await moveKasaToSpace(kasaKey,targetSpaceId);
}
async function moveKasaToSpace(kasaKey,targetSpaceId){
  const kObj=kasalarData.find(k=>k.key===kasaKey);
  const spObj=getSpaceObj(targetSpaceId);
  if(!kObj||!spObj) return;
  const prevSpace=kObj.space;
  if(prevSpace===targetSpaceId){ toast(`"${kObj.title}" zaten "${spObj.title}" alanında`); return; }
  try{
    await api('/api/kasa/update',{key:kasaKey,space:targetSpaceId});
    await loadVault();
    pushAppUndo({
      label:`"${kObj.title}" → ${spObj.title} taşıma`,
      undo:async()=>{ await api('/api/kasa/update',{key:kasaKey,space:prevSpace}); await loadVault(); },
      redo:async()=>{ await api('/api/kasa/update',{key:kasaKey,space:targetSpaceId}); await loadVault(); }
    });
    toast(`📦 "${kObj.title}" → ${spObj.icon} ${spObj.title} alanına taşındı (Ctrl+Z: Geri al)`);
  }catch(e){ alert('Kasa taşınamadı: '+e.message); }
}

async function loadVault(){
  try{
    const v=await api('/api/vault');
    if(v&&v.pages){
      Object.keys(pages).forEach(k=>{ if(k.startsWith('note:')&&!(pages[k]&&pages[k].isLocalAbs&&openTabs.includes(k))) delete pages[k]; });
      Object.assign(pages,v.pages);
      const valid=openTabs.filter(t=>!String(t).startsWith('note:')||Boolean(pages[t]));
      if(valid.length!==openTabs.length){
        openTabs=valid.length?valid:['kasalar'];
        if(!openTabs.includes(active)) active=openTabs[0];
        syncPdfSlotsWithTabs();
      }
    }
    Object.assign(WIKI_MAP,v.wikimap||{});
    vaultTree=v.tree||[];
    kasalarData=v.kasalar||[];
    spacesData=v.spaces||[];
    rootDocsData=v.root_docs||[];
    window.kasalarData=kasalarData;
    window.spacesData=spacesData;
    if(currentSpace!=='all'&&!spacesData.some(s=>s.id===currentSpace)) currentSpace='all';
    if(currentKasa!=='all'&&!kasalarData.some(k=>k.key===currentKasa)) currentKasa='all';
    if(currentSpace!=='all'&&currentKasa!=='all'){
      const ko=kasalarData.find(k=>k.key===currentKasa);
      if(!ko||ko.space!==currentSpace) currentKasa='all';
    }
    allSources=v.sources||[];
    backlinksMap=v.backlinks||{};
    if(!checkedSources.size){
      allSources.forEach(s=>{ if(s.checked) checkedSources.add(s.rel); });
    }
    renderKasaFilterSelect();
    rebuildTreeAndSources();
    const sameNoteMounted=String(active).startsWith('note:')&&Boolean($('#doc'))&&notionState.noteId===active;
    const sameStudyMounted=active==='studychat'&&Boolean($('#scChat'));
    const sameAiMounted=isAI(active)&&Boolean($('#aichat'));
    renderTree(); renderTabs();
    if(!sameNoteMounted&&!sameStudyMounted&&!sameAiMounted) renderMain();
    else if(sameStudyMounted) renderStudyChatBody();
    updateRightProps(); updateSideAiCtx(); saveSessionTabs();
  }catch(e){ console.error('loadVault error:',e); }
}

let lastHealthData={agy:true,ollama:false,git_checkpoints:false,auth_needed:false,auth_running:false};
function renderHealthBar(h){
  const el=$('#stHealth');
  if(!el||!h) return;
  const parts=[];
  if(h.auth_running){
    parts.push('<span style="color:var(--cu);font-weight:600">🔑 Chrome girişi bekleniyor…</span>');
  }else if(h.auth_needed){
    parts.push('<a href="#" onclick="event.preventDefault();triggerAgyLogin()" style="color:var(--cu);font-weight:600;text-decoration:underline">🔑 agy oturumu kapalı (Giriş Yap)</a>');
  }else if(h.agy){
    parts.push('agy CLI: aktif');
  }
  if(h.ollama) parts.push('Ollama: aktif');
  if(h.git_checkpoints) parts.push('Git Checkpoint: açık');
  el.innerHTML=parts.length?parts.join(' · '):'Sağlayıcı hazır';
}
async function loadHealth(){
  try{
    const h=await api('/api/health');
    lastHealthData=h;
    renderHealthBar(h);
    if(h.running){
      Object.entries(h.running).forEach(([sid,st])=>{
        if(ai[sid]){ ai[sid].running=true; ai[sid].step=st; aiRefresh(sid); }
      });
    }
  }catch(e){}
}

/* ---------- İkonlar & Ağaç ---------- */
const CHEV_SVG='<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
function svgIcon(raw){
  if(raw==='❖') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>';
  if(raw==='📁') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.9l1.4 1.6h5.3A1.2 1.2 0 0 1 14 5.8v6A1.2 1.2 0 0 1 12.8 13H3.2A1.2 1.2 0 0 1 2 11.8Z"/></svg>';
  if(raw==='📘') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.8A1.3 1.3 0 0 1 4.3 1.5h8.2v11.3H4.3A1.3 1.3 0 0 0 3 14.1V2.8Z"/><path d="M4.3 12.8h8.2v1.7H4.3a1.3 1.3 0 0 1-1.3-1.3"/><path d="M6 4.8h4.5"/></svg>';
  if(raw==='🖼') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.6"/><circle cx="5.7" cy="6" r="1.1"/><path d="m3.4 11.8 3.2-3.2 2.2 2.1 1.6-1.5 2.4 2.6"/></svg>';
  if(raw==='⚡'||raw==='🌩') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.8 2 3.5 9h4.1l-.4 5 5.3-7H8.4Z"/></svg>';
  if(raw==='🌐'||raw==='🛰') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.8"/><path d="M2.4 8h11.2M8 2.2c1.6 1.6 2.4 3.6 2.4 5.8S9.6 12.2 8 13.8c-1.6-1.6-2.4-3.6-2.4-5.8S6.4 3.8 8 2.2Z"/></svg>';
  if(raw==='∿') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.8 8c1.5-4.5 3.1-4.5 4.6 0s3.1 4.5 4.6 0 2.2-2.2 3.2 0"/></svg>';
  if(raw==='▦') return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.8" width="12" height="11.4" rx="2"/><path d="M2 5.8h12M5.2 1.6v2.2M10.8 1.6v2.2"/><text x="8" y="12.1" text-anchor="middle" fill="currentColor" stroke="none" font-size="6.2" font-weight="800" font-family="var(--mono)">${new Date().getDate()}</text></svg>`;
  if(raw==='◆') return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 2.2 13.8 8 8 13.8 2.2 8Z"/></svg>';
  if(raw&&raw!=='📝'&&raw!=='📄'&&raw!=='🗒') return `<span style="font-size:13px;line-height:1">${escHtml(raw)}</span>`;
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.2h5.5L12.5 5v8.8a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z"/><path d="M9.2 2.2V5.2h3.2M5.5 8h5M5.5 10.6h3.5"/></svg>';
}
function firstVaultTab(){
  const walk=arr=>{
    for(const item of (arr||[])){
      if(item.id) return item.id;
      if(item.k){ const sub=walk(item.k); if(sub) return sub; }
    }
    return null;
  };
  return walk(tree)||'kasalar';
}
const TREE_OPEN={};
let activeNotionMenuBtn=null;
function closeNotionTreeMenu(){
  const menu=$('#notionTreeMenu');
  if(menu){ menu.classList.remove('show'); menu.innerHTML=''; }
  if(activeNotionMenuBtn){ activeNotionMenuBtn.classList.remove('open'); activeNotionMenuBtn=null; }
}
document.addEventListener('click',e=>{
  const menu=$('#notionTreeMenu');
  if(menu&&menu.classList.contains('show')&&!menu.contains(e.target)&&!e.target.closest('.ti-more,.kcard-more,.scard-act-btn')) closeNotionTreeMenu();
});
function flattenFolderTargets(nodes=vaultTree,depth=0,out=[]){
  (nodes||[]).forEach(n=>{
    if(!n||!n.k) return;
    const rel=n.rel||n.kasa||'';
    const base=rel.split('/').pop()||'';
    if(rel&&base!=='_gorseller'){
      const cleanName=String(n.n||'').replace(/^📎\s*|^🖼\s*|^📁\s*/,'').replace(/\s*\(\d+\)$/,'');
      out.push({rel,label:cleanName||rel,depth,isKasa:!rel.includes('/'),kasa:n.kasa||rel.split('/')[0]});
    }
    if(n.k&&n.k.length) flattenFolderTargets(n.k,depth+1,out);
  });
  return out;
}
function showTreeMenuItems(ev,label,items){
  ev.stopPropagation();
  const menu=$('#notionTreeMenu');
  if(!menu) return;
  const trigger=ev.currentTarget;
  if(menu.classList.contains('show')&&activeNotionMenuBtn===trigger){ closeNotionTreeMenu(); return; }
  closeNotionTreeMenu();
  activeNotionMenuBtn=trigger;
  if(trigger&&trigger.classList) trigger.classList.add('open');

  menu.innerHTML=`<div class="notion-tmenu-hdr"></div>`;
  menu.firstChild.textContent=label;
  menu.firstChild.title=label;
  items.forEach(it=>{
    if(it.sep){ const sep=document.createElement('div'); sep.className='notion-tmenu-sep'; menu.appendChild(sep); return; }
    const b=document.createElement('button');
    b.type='button';
    b.className='notion-tmenu-item';
    if(it.danger) b.style.color='var(--err,#f85149)';
    b.innerHTML=`<span class="mi">${it.icon}</span><span>${escHtml(it.text)}</span>`;
    b.onclick=e=>{ e.stopPropagation(); it.fn(); };
    menu.appendChild(b);
  });

  menu.classList.add('show');
  const rect=trigger&&trigger.getBoundingClientRect?trigger.getBoundingClientRect():{left:ev.clientX,right:ev.clientX,top:ev.clientY,bottom:ev.clientY};
  const mw=menu.offsetWidth||240, mh=menu.offsetHeight||230;
  let left=Math.min(window.innerWidth-mw-10,Math.max(8,rect.right+6));
  if(rect.right+6+mw>window.innerWidth-8) left=Math.max(8,rect.left-mw-4);
  let top=Math.min(window.innerHeight-mh-10,Math.max(8,rect.top));
  menu.style.left=left+'px';
  menu.style.top=top+'px';
}
function openNotionTreeMenu(ev,target={}){
  const resolvedRel=(target.rel||(target.kasa&&target.kasa!=='all'?target.kasa:'')||(kasalarData[0]?kasalarData[0].key:''));
  const resolvedKasa=target.kasa&&target.kasa!=='all'?target.kasa:(resolvedRel?resolvedRel.split('/')[0]:(kasalarData[0]?kasalarData[0].key:''));
  const kObj=kasalarData.find(k=>k.key===resolvedKasa);
  const label=target.label||(kObj?kObj.title:'Çalışma Alanı');
  const items=[];
  if(resolvedRel){
    items.push({icon:'📝',text:'Yeni Sayfa / Not Oluştur',fn:()=>{ closeNotionTreeMenu(); openNewNoteModal(resolvedRel); }});
    items.push({icon:'📁',text:'Yeni Alt Klasör Oluştur',fn:()=>{ closeNotionTreeMenu(); openNewFolderModal(resolvedRel,label); }});
    items.push({icon:'📎',text:'Belge / Fotoğraf Yükle',fn:()=>{ closeNotionTreeMenu(); triggerAssetUpload(resolvedRel); }});
    if(target.isKasa&&resolvedKasa){
      items.push({icon:'📖',text:'Kasa Ana İndeksini Aç',fn:()=>{ closeNotionTreeMenu(); enterKasa(resolvedKasa,'write'); }});
      items.push({icon:'✎',text:'Kasa Ayarları / Alan Değiştir',fn:()=>{ closeNotionTreeMenu(); openEditKasaModal(resolvedKasa); }});
    }
    items.push({sep:true});
  }
  items.push({icon:'❖',text:'Yeni Çalışma Kasası Oluştur',fn:()=>{ closeNotionTreeMenu(); openNewKasaModal(); }});
  items.push({icon:'🗂',text:'Yeni Çalışma Alanı Oluştur',fn:()=>{ closeNotionTreeMenu(); openSpaceModal(); }});
  showTreeMenuItems(ev,label,items);
}
function openSpaceCardMenu(ev,spaceId){
  const sp=getSpaceObj(spaceId);
  if(!sp) return;
  const items=[
    {icon:'📂',text:'Bu Alanı Aç',fn:()=>{ closeNotionTreeMenu(); enterSpace(spaceId); }},
    {icon:'❖',text:'Bu Alana Yeni Kasa Ekle',fn:()=>{ closeNotionTreeMenu(); openNewKasaModal(spaceId); }},
    {icon:'✎',text:'Alanı Düzenle (Ad / İkon / Renk)',fn:()=>{ closeNotionTreeMenu(); openSpaceModal(spaceId); }},
    {sep:true}
  ];
  if(spacesData.length>1){
    items.push({icon:'🗑',text:'Alanı Sil (Kasalar Korunur)',danger:true,fn:()=>{ closeNotionTreeMenu(); deleteSpaceConfirm(spaceId); }});
  }
  showTreeMenuItems(ev,`${sp.icon} ${sp.title}`,items);
}
function openKasaCardMenu(ev,kasaKey){
  const kObj=kasalarData.find(k=>k.key===kasaKey);
  if(!kObj) return;
  const items=[
    {icon:'📖',text:'Kasayı Aç (Yaz & Düzenle)',fn:()=>{ closeNotionTreeMenu(); enterKasa(kasaKey,'write'); }},
    {icon:'◈',text:'NotebookLM Çalışma Modu',fn:()=>{ closeNotionTreeMenu(); enterKasa(kasaKey,'study'); }},
    {icon:'✎',text:'Kasayı Düzenle (Ad / İkon / Renk)',fn:()=>{ closeNotionTreeMenu(); openEditKasaModal(kasaKey); }},
    {sep:true}
  ];
  spacesData.filter(sp=>sp.id!==kObj.space).forEach(sp=>{
    items.push({icon:sp.icon||'🗂',text:`Taşı → ${sp.title}`,fn:()=>{ closeNotionTreeMenu(); moveKasaToSpace(kasaKey,sp.id); }});
  });
  if(spacesData.length>1) items.push({sep:true});
  items.push({icon:'📎',text:'Bu Kasaya Dosya / Fotoğraf Yükle',fn:()=>{ closeNotionTreeMenu(); triggerAssetUpload(kasaKey); }});
  items.push({icon:'📝',text:'Bu Kasaya Yeni Not Ekle',fn:()=>{ closeNotionTreeMenu(); openNewNoteModal(kasaKey); }});
  showTreeMenuItems(ev,`${kObj.icon} ${kObj.title}`,items);
}
let draggedTreeItem=null;
let isTreeDragging=false;
let _treeExpandTimer=null;
let _treeExpandKey='';
function clearTreeDragVisuals(keepTimer=false){
  document.querySelectorAll('#tree .ti.drag-over-into,#tree .ti.drag-over-top,#tree .ti.drag-over-bot,#tree .ti.drag-over').forEach(el=>{
    el.classList.remove('drag-over-into','drag-over-top','drag-over-bot','drag-over');
  });
  const root=$('#tree');
  if(root) root.classList.remove('drag-over-root');
  if(!keepTimer){
    if(_treeExpandTimer){ clearTimeout(_treeExpandTimer); _treeExpandTimer=null; }
    _treeExpandKey='';
  }
}
function scheduleTreeAutoExpand(el,node,tk){
  if(!node||!node.k||!el||el.classList.contains('open')){
    if(_treeExpandTimer){ clearTimeout(_treeExpandTimer); _treeExpandTimer=null; _treeExpandKey=''; }
    return;
  }
  if(_treeExpandKey===tk) return;
  if(_treeExpandTimer){ clearTimeout(_treeExpandTimer); _treeExpandTimer=null; }
  _treeExpandKey=tk;
  _treeExpandTimer=setTimeout(()=>{
    _treeExpandTimer=null;
    _treeExpandKey='';
    if(!el.isConnected||el.classList.contains('open')) return;
    el.classList.add('open');
    const kidsEl=el.nextElementSibling;
    if(kidsEl&&kidsEl.classList.contains('kids')) kidsEl.classList.add('show');
    node.open=true;
    TREE_OPEN[tk]=true;
    saveSessionTabs();
  },550);
}
function remapRelValue(rel,oldRel,newRel){
  if(!rel) return rel;
  if(rel===oldRel) return newRel;
  if(rel.startsWith(oldRel+'/')) return newRel+rel.slice(oldRel.length);
  return rel;
}
function remapMovedState(oldRel,newRel){
  const remapId=id=>{
    const s=String(id||'');
    return s.startsWith('note:')?('note:'+remapRelValue(s.slice(5),oldRel,newRel)):id;
  };
  openTabs=openTabs.map(remapId);
  active=remapId(active);
  Object.keys(noteCache).forEach(k=>{
    const nk=remapId(k);
    if(nk!==k){
      noteCache[nk]={...noteCache[k],rel:nk.slice(5)};
      delete noteCache[k];
    }
  });
  const nextUnlocked=new Set();
  unlockedNotes.forEach(id=>nextUnlocked.add(remapId(id)));
  unlockedNotes.clear();
  nextUnlocked.forEach(id=>unlockedNotes.add(id));
  if(typeof notionState!=='undefined'&&notionState&&notionState.noteId){
    notionState.noteId=remapId(notionState.noteId);
  }
  const nextChecked=new Set();
  checkedSources.forEach(r=>nextChecked.add(remapRelValue(r,oldRel,newRel)));
  checkedSources.clear();
  nextChecked.forEach(r=>checkedSources.add(r));
  Object.keys(TREE_OPEN).forEach(k=>{
    const nk=remapRelValue(k,oldRel,newRel);
    if(nk!==k){
      TREE_OPEN[nk]=TREE_OPEN[k];
      delete TREE_OPEN[k];
    }
  });
  const parts=newRel.split('/');
  for(let i=1;i<parts.length;i++){
    TREE_OPEN[parts.slice(0,i).join('/')]=true;
  }
  if(typeof rvCurrentRel==='string'&&rvCurrentRel){
    rvCurrentRel=remapRelValue(rvCurrentRel,oldRel,newRel);
  }
  if(typeof pdfState!=='undefined'){
    Object.keys(pdfState).forEach(k=>{
      const nk=remapId(k);
      if(nk!==k){ pdfState[nk]=pdfState[k]; delete pdfState[k]; }
    });
  }
  if(typeof pdfInfoCache!=='undefined'){
    Object.keys(pdfInfoCache).forEach(k=>{
      const nk=remapId(k);
      if(nk!==k) delete pdfInfoCache[k];
    });
  }
  if(typeof pdfSlotMap!=='undefined'){
    for(const [k,slot] of [...pdfSlotMap.entries()]){
      const nk=remapId(k);
      if(nk!==k){ slot.remove(); pdfSlotMap.delete(k); }
    }
  }
}
function resolveTreeDropMode(ev,el,src,targetNode,flags){
  if(!src||!src.rel||!targetNode) return null;
  if(targetNode.rel&&targetNode.rel===src.rel) return null;
  if(src.kind==='folder'&&targetNode.rel&&targetNode.rel.startsWith(src.rel+'/')) return null;
  const {isSpace,isRootKasa,isSubfolder,isVaultFile,isRootDocsBucket}=flags;
  if(src.kind==='kasa'){
    if(isSpace) return null;
    if(isRootKasa){
      const rect=el.getBoundingClientRect();
      const pos=(ev.clientY-rect.top)<rect.height/2?'before':'after';
      return {position:pos,targetRel:targetNode.rel};
    }
    return null;
  }
  if(isRootKasa){
    return {position:'into',targetRel:targetNode.rel};
  }
  if(isRootDocsBucket){
    return src.kind==='file'?{position:'into',targetRel:targetNode.rel||'_root_docs'}:null;
  }
  if(isSubfolder){
    const rect=el.getBoundingClientRect();
    const ratio=(ev.clientY-rect.top)/Math.max(1,rect.height);
    if(ratio<0.25) return {position:'before',targetRel:targetNode.rel};
    if(ratio>0.75) return {position:'after',targetRel:targetNode.rel};
    return {position:'into',targetRel:targetNode.rel};
  }
  if(isVaultFile){
    if(src.kind==='folder'&&!String(targetNode.rel).includes('/')) return null;
    const rect=el.getBoundingClientRect();
    const pos=(ev.clientY-rect.top)<rect.height/2?'before':'after';
    return {position:pos,targetRel:targetNode.rel};
  }
  return null;
}
async function moveTreeItem(srcRel,targetRel,position='into',opts={}){
  try{
    const res=await api('/api/vault/move',{src:srcRel,target:targetRel,position});
    if(res.already_here){
      toast('Öğe zaten bu klasörde');
      return;
    }
    if(res.moved&&res.old_rel&&res.new_rel&&res.old_rel!==res.new_rel){
      remapMovedState(res.old_rel,res.new_rel);
      if(!opts.skipUndo){
        const oldParent=res.old_rel.includes('/')?res.old_rel.slice(0,res.old_rel.lastIndexOf('/')):'_root_docs';
        pushAppUndo({
          label:`"${res.new_rel.split('/').pop()}" taşıma`,
          undo:async()=>{ await moveTreeItem(res.new_rel,oldParent,'into',{skipUndo:true}); },
          redo:async()=>{ await moveTreeItem(res.old_rel,targetRel,position,{skipUndo:true}); }
        });
      }
    }
    await loadVault();
    if(res.moved){
      const name=res.new_rel.split('/').pop();
      toast(`📦 "${name}" taşındı${opts.skipUndo?'':' (Ctrl+Z: Geri al)'}`);
    }else if(res.scope_updated){
      toast('📌 Ortak belge çalışma alanı kapsamı güncellendi');
    }else if(res.reordered){
      toast('↕ Sıralama güncellendi');
    }
  }catch(e){
    toast('⚠️ '+(e.message||'Taşıma başarısız'));
  }
}
function renderTree(){
  const root=$('#tree'); root.innerHTML='';
  root.ondragover=e=>{
    if(e.target&&e.target.closest&&e.target.closest('.ti')) return;
    if(hasFiles(e)&&(currentKasa!=='all'||currentSpace!=='all')){
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect='copy';
      clearTreeDragVisuals(true);
      root.classList.add('drag-over-root');
    }else if(draggedTreeItem&&draggedTreeItem.kind!=='kasa'&&currentKasa!=='all'){
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect='move';
      clearTreeDragVisuals(true);
      root.classList.add('drag-over-root');
    }
  };
  root.ondragleave=e=>{
    if(!root.contains(e.relatedTarget)) clearTreeDragVisuals();
  };
  root.ondrop=async e=>{
    if(e.target&&e.target.closest&&e.target.closest('.ti')) return;
    clearTreeDragVisuals();
    if(hasFiles(e)&&(currentKasa!=='all'||currentSpace!=='all')){
      e.preventDefault();
      e.stopPropagation();
      const files=[...(e.dataTransfer.files||[])];
      if(!files.length) return;
      if(currentKasa!=='all'){ pendingUploadTarget=currentKasa; pendingSpaceUpload=null; }
      else{ pendingSpaceUpload=currentSpace; pendingUploadTarget=null; }
      await handleGlobalUpload(files);
      return;
    }
    if(draggedTreeItem&&draggedTreeItem.kind!=='kasa'&&currentKasa!=='all'){
      e.preventDefault();
      e.stopPropagation();
      const srcRel=draggedTreeItem.rel;
      draggedTreeItem=null;
      await moveTreeItem(srcRel,currentKasa,'into');
    }
  };
  const build=(arr,host)=>arr.forEach(x=>{
    const d=document.createElement('div');
    const side=x.id&&isSideDoc(x.id);
    const tk=x.spaceId?('space:'+x.spaceId):(x.rel||((x.id||'')+'|'+x.n));
    if(x.k&&(tk in TREE_OPEN)) x.open=TREE_OPEN[tk];
    const isSpace=Boolean(x.spaceId);
    const isRootDocsBucket=x.rel==='_root_docs'||String(x.rel||'').startsWith('_root_docs:');
    const isRootKasa=Boolean(!isSpace&&x.k&&x.rel&&!String(x.rel).includes('/')&&!isRootDocsBucket);
    const isSubfolder=Boolean(!isSpace&&x.k&&x.rel&&String(x.rel).includes('/'));
    const isVaultFile=Boolean(!isSpace&&!x.k&&x.rel&&String(x.id||'').startsWith('note:'));
    const flags={isSpace,isRootKasa,isSubfolder,isVaultFile,isRootDocsBucket};
    const isDraggableItem=isRootKasa||isSubfolder||isVaultFile;
    d.className='ti'+(x.k?' folder':'')+(isSpace?' space-node':'')+(isRootKasa?' root-kasa':'')+(x.open?' open':'')+(x.id===active?' on':'');
    if(x.id) d.dataset.treeId=x.id;
    if(isSpace&&x.accent) d.style.setProperty('--sp-acc',x.accent);
    if(isDraggableItem){
      d.draggable=true;
      d.ondragstart=e=>{
        e.stopPropagation();
        isTreeDragging=true;
        const kind=isRootKasa?'kasa':(isSubfolder?'folder':'file');
        draggedTreeItem={kind,rel:x.rel,kasa:x.kasa||'',id:x.id||'',label:x.n};
        if(isRootKasa&&x.kasa) draggedKasaKey=x.kasa;
        if(e.dataTransfer){
          e.dataTransfer.effectAllowed='copyMove';
          e.dataTransfer.setData('application/x-agydesk-tree',JSON.stringify(draggedTreeItem));
          e.dataTransfer.setData('text/plain',isRootKasa&&x.kasa?x.kasa:x.rel);
        }
        setTimeout(()=>d.classList.add('dragging'),0);
      };
      d.ondragend=()=>{
        setTimeout(()=>{ isTreeDragging=false; },60);
        draggedTreeItem=null;
        draggedKasaKey=null;
        d.classList.remove('dragging');
        clearTreeDragVisuals();
      };
    }
    const osUploadDir=isRootKasa||isSubfolder?x.rel:(isVaultFile&&x.rel.includes('/')?x.rel.slice(0,x.rel.lastIndexOf('/')):'');
    d.ondragover=e=>{
      if(hasFiles(e)&&(isSpace||osUploadDir)){
        e.preventDefault();
        e.stopPropagation();
        if(e.dataTransfer) e.dataTransfer.dropEffect='copy';
        clearTreeDragVisuals(true);
        d.classList.add('drag-over-into');
        if(x.k) scheduleTreeAutoExpand(d,x,tk);
        return;
      }
      if(isSpace){
        handleSpaceDragOver(e,d);
        return;
      }
      if(draggedTreeItem){
        const dropInfo=resolveTreeDropMode(e,d,draggedTreeItem,x,flags);
        if(!dropInfo) return;
        e.preventDefault();
        e.stopPropagation();
        if(e.dataTransfer) e.dataTransfer.dropEffect='move';
        clearTreeDragVisuals(dropInfo.position==='into');
        d.classList.add(dropInfo.position==='before'?'drag-over-top':(dropInfo.position==='after'?'drag-over-bot':'drag-over-into'));
        if(dropInfo.position==='into'&&x.k) scheduleTreeAutoExpand(d,x,tk);
      }
    };
    d.ondragleave=e=>{
      if(!d.contains(e.relatedTarget)){
        d.classList.remove('drag-over-into','drag-over-top','drag-over-bot','drag-over');
      }
    };
    d.ondrop=async e=>{
      if(hasFiles(e)&&(isSpace||osUploadDir)){
        e.preventDefault();
        e.stopPropagation();
        clearTreeDragVisuals();
        const files=[...(e.dataTransfer.files||[])];
        if(!files.length) return;
        if(isSpace){
          pendingSpaceUpload=x.spaceId;
          pendingUploadTarget=null;
        }else{
          pendingUploadTarget=osUploadDir;
          pendingSpaceUpload=null;
        }
        await handleGlobalUpload(files);
        return;
      }
      if(isSpace){
        clearTreeDragVisuals();
        await handleSpaceDrop(e,x.spaceId);
        return;
      }
      if(draggedTreeItem){
        const dropInfo=resolveTreeDropMode(e,d,draggedTreeItem,x,flags);
        clearTreeDragVisuals();
        if(!dropInfo) return;
        e.preventDefault();
        e.stopPropagation();
        const srcRel=draggedTreeItem.rel;
        draggedTreeItem=null;
        draggedKasaKey=null;
        await moveTreeItem(srcRel,dropInfo.targetRel,dropInfo.position);
      }
    };
    d.title=side?`${x.n} (Tıkla: Sağda önizle · Çift tıkla: Sekmede aç · Sürükle: Taşı/Sırala)`:(isRootKasa?`${x.n} · Sürükleyerek sırala veya başka alana taşı`:(isDraggableItem?`${x.n} · Sürükleyerek taşı veya sırala`:x.n));
    d.innerHTML=`<span class="car">${x.k?CHEV_SVG:''}</span><span class="tic">${svgIcon(x.i)}</span><span class="tn">${escHtml(x.n)}</span><span class="ti-act"></span>`;
    const act=d.querySelector('.ti-act');
    if(isSpace){
      const more=document.createElement('button');
      more.type='button';
      more.className='ph-btn ti-more';
      more.textContent='⋯';
      more.title='Çalışma Alanı Seçenekleri';
      more.onclick=e=>openSpaceCardMenu(e,x.spaceId);
      act.appendChild(more);
    }else if(x.k&&(x.rel||x.kasa)&&!isRootDocsBucket){
      const more=document.createElement('button');
      more.type='button';
      more.className='ph-btn ti-more';
      more.textContent='⋯';
      more.title='Seçenekler: Yeni sayfa, yeni klasör, belge yükle';
      const targetRel=x.rel||x.kasa;
      const cleanLbl=String(x.n||'').replace(/^📎\s*|^🖼\s*|^📁\s*/,'').replace(/\s*\(\d+\)$/,'');
      more.onclick=e=>openNotionTreeMenu(e,{rel:targetRel,kasa:x.kasa,label:cleanLbl,isKasa:isRootKasa});
      act.appendChild(more);
    }else{
      if(side){
        const maxBtn=document.createElement('button');
        maxBtn.type='button';
        maxBtn.className='ph-btn ti-hover-btn';
        maxBtn.textContent='⤢';
        maxBtn.title='AgyDesk içinde yeni sekmede tam ekran aç';
        maxBtn.onclick=e=>{ e.stopPropagation(); openPage(x.id,true); };
        act.appendChild(maxBtn);
      }
      if(!x.k&&String(x.id||'').startsWith('note:')){
        if(x.rel&&!String(x.rel).includes('/')){
          const scBtn=document.createElement('button');
          scBtn.type='button';
          scBtn.className='ph-btn ti-hover-btn';
          scBtn.textContent='⋯';
          scBtn.title='Çalışma alanı kapsamını değiştir (Dönem / Global)';
          scBtn.onclick=e=>openRootDocScopeMenu(e,x.rel);
          act.appendChild(scBtn);
        }
        const delBtn=document.createElement('button');
        delBtn.type='button';
        delBtn.className='ph-btn ti-hover-btn ti-del';
        delBtn.textContent='🗑';
        delBtn.title='Kasadan sil';
        delBtn.onclick=e=>{ e.stopPropagation(); deleteActiveNote(x.id); };
        act.appendChild(delBtn);
      }
    }
    host.appendChild(d);
    let kids;
    if(x.k){kids=document.createElement('div');kids.className='kids'+(x.open?' show':'');host.appendChild(kids);build(x.k,kids);}
    d.onclick=e=>{
      if(isTreeDragging) return;
      if(x.k){d.classList.toggle('open');kids.classList.toggle('show');x.open=d.classList.contains('open');TREE_OPEN[tk]=x.open;saveSessionTabs();}
      if(x.id&&(e.ctrlKey||e.metaKey)){ openPage(x.id,true,{newTab:true}); return; }
      if(x.id&&!side)openPage(x.id,false,{replace:true});
      if(x.id&&side){
        if(isBlank(active)){ openPage(x.id,true,{replace:true}); return; }
        const p=pages[x.id];
        openRightViewer(p?p.rel:x.id.slice(5),p?p.t:x.n);
      }
    };
    if(x.id){
      d.onmousedown=e=>{ if(e.button===1) e.preventDefault(); };
      d.onauxclick=e=>{ if(e.button===1){ e.preventDefault(); e.stopPropagation(); openPage(x.id,true,{newTab:true}); } };
    }
    if(x.id&&side){
      d.ondblclick=e=>{ e.stopPropagation(); openPage(x.id,true,{replace:true}); };
    }
  });
  build(tree,root);
}
const SIDE_EXT=['.pdf','.docx','.doc','.pptx','.ppsx','.ppt','.xlsx','.xlsm','.xls','.csv','.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif'];
function isSideDoc(relOrId){
  const s=String(relOrId||'').toLowerCase();
  if(SIDE_EXT.some(e=>s.endsWith(e)))return true;
  const p=pages[relOrId];
  return !!(p&&p.ext&&SIDE_EXT.includes(p.ext));
}
const RAIL_W=52;
const LEFT_MIN=200, RIGHT_MIN=280, CENTER_MIN=420;
const LEFT_PCT_DEF=0.17, RIGHT_PCT_DEF=0.24, VIEWER_PCT_MIN=0.34;
const LEFT_PCT_MIN=0.04, LEFT_PCT_MAX=0.38, RIGHT_PCT_MIN=0.06, RIGHT_PCT_MAX=0.50;
let leftPct=LEFT_PCT_DEF, rightPct=RIGHT_PCT_DEF;
let leftW=248, rightW=340, viewerPrev=null;
function paneAvailW(){
  const w=(app&&app.clientWidth)||window.innerWidth||document.documentElement.clientWidth||1440;
  return Math.max(1,w-RAIL_W);
}
function clampLeftPct(p){
  return Math.max(LEFT_PCT_MIN,Math.min(LEFT_PCT_MAX,p));
}
function clampRightPct(p){
  return Math.max(RIGHT_PCT_MIN,Math.min(RIGHT_PCT_MAX,p));
}
function clampLeft(w){
  const avail=paneAvailW();
  const rOpen=!app.classList.contains('no-right');
  const maxByCenter=avail-(rOpen?rightW:0)-CENTER_MIN;
  const hi=Math.max(LEFT_MIN,Math.min(Math.floor(avail*LEFT_PCT_MAX),maxByCenter));
  return Math.max(LEFT_MIN,Math.min(hi,Math.round(w)));
}
function clampRight(w){
  const avail=paneAvailW();
  const lOpen=!app.classList.contains('no-left');
  const maxByCenter=avail-(lOpen?leftW:0)-CENTER_MIN;
  const hi=Math.max(RIGHT_MIN,Math.min(Math.floor(avail*RIGHT_PCT_MAX),maxByCenter));
  return Math.max(RIGHT_MIN,Math.min(hi,Math.round(w)));
}
function applyPaneWidths(){
  if(!app) return;
  const avail=paneAvailW();
  const lOpen=!app.classList.contains('no-left');
  const rOpen=!app.classList.contains('no-right');
  const maxSum=Math.max(0,avail-CENTER_MIN);
  let l=Math.max(LEFT_MIN,Math.min(Math.max(LEFT_MIN,Math.floor(avail*LEFT_PCT_MAX)),Math.round(avail*leftPct)));
  let r=Math.max(RIGHT_MIN,Math.min(Math.max(RIGHT_MIN,Math.floor(avail*RIGHT_PCT_MAX)),Math.round(avail*rightPct)));
  if(lOpen&&rOpen&&l+r>maxSum){
    const over=l+r-maxSum;
    const flexL=Math.max(0,l-LEFT_MIN);
    const flexR=Math.max(0,r-RIGHT_MIN);
    const flexSum=flexL+flexR;
    if(flexSum>0){
      const cutL=Math.min(flexL,Math.round(over*(flexL/flexSum)));
      const cutR=Math.min(flexR,over-cutL);
      l-=cutL;
      r-=cutR;
      const rem=l+r-maxSum;
      if(rem>0) l=Math.max(LEFT_MIN,l-rem);
    }else{
      l=LEFT_MIN;
      r=RIGHT_MIN;
    }
  }else if(lOpen&&!rOpen){
    l=Math.max(LEFT_MIN,Math.min(l,Math.max(LEFT_MIN,maxSum)));
  }else if(!lOpen&&rOpen){
    r=Math.max(RIGHT_MIN,Math.min(r,Math.max(RIGHT_MIN,maxSum)));
  }
  leftW=l;
  rightW=r;
  app.style.setProperty('--left',leftW+'px');
  app.style.setProperty('--right',rightW+'px');
}
let rvCurrentRel='', rvCurrentTitle='', rvMode='sepia';
let rvNight=false;
const RV_MODES={
  normal:{ic:'☀',lbl:'Orijinal',filt:'none'},
  night:{ic:'🌙',lbl:'Gece',filt:'invert(0.90) hue-rotate(180deg) contrast(0.96)'},
  sepia:{ic:'📜',lbl:'Sepya',filt:'sepia(0.38) brightness(0.95) contrast(0.95)'}
};
function syncRightViewerModeBtn(){
  const nb=$('#rvNightBtn');
  if(!nb) return;
  const m=RV_MODES[rvMode]||RV_MODES.sepia;
  const active=rvMode!=='normal';
  nb.textContent=m.ic;
  nb.title=`Okuma Modu: ${m.lbl} (tıkla: Orijinal / Gece / Sepya)`;
  nb.classList.toggle('on',active);
  nb.style.borderColor=active?'var(--cu)':'';
  nb.style.color=active?'var(--cu)':'';
}
function toggleRightViewerNight(){
  const order=['normal','night','sepia'];
  rvMode=order[(order.indexOf(rvMode)+1)%order.length];
  rvNight=rvMode==='night';
  syncRightViewerModeBtn();
  const fr=$('#rvBody iframe');
  if(fr) fr.style.filter=(RV_MODES[rvMode]||RV_MODES.sepia).filt;
}
function openDocInTab(relOrUrl,title){
  let raw=String(relOrUrl||'').trim();
  if(raw.startsWith('note:')) raw=raw.slice(5);
  if(!raw) return;
  const isAbs=isLocalAbsPathOrUri(raw);
  const cleanRel=normalizeVaultAssetRel(raw,typeof notionState!=='undefined'?notionState.baseDir:'');
  const vaultId=findVaultNoteIdForTarget(raw,cleanRel);
  const useAbs=isAbs&&!vaultId;
  const keyRel=vaultId?vaultId.slice(5):(useAbs?cleanLocalPathTarget(raw):cleanRel);
  if(!keyRel) return;
  const id='note:'+keyRel;
  if(!pages[id]){
    const ext=(keyRel.includes('.')?keyRel.slice(keyRel.lastIndexOf('.')):'').toLowerCase();
    const ic=ext==='.pdf'?'📄':(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)?'🖼':(/\.(pptx?|ppsx)$/i.test(ext)?'📊':(/\.(xlsx?|xlsm|csv)$/i.test(ext)?'📗':(/\.(docx?)$/i.test(ext)?'📘':'📄'))));
    const normSlash=keyRel.replace(/\\/g,'/');
    const fKey=(!useAbs&&normSlash.includes('/'))?normSlash.split('/')[0]:'';
    const kObj=fKey?kasalarData.find(k=>k.key===fKey):null;
    pages[id]={t:title||decodeURIComponent(normSlash.split('/').pop()||keyRel),i:ic,rel:keyRel,folder:useAbs?'Yerel Dosya':(kObj?kObj.title:(fKey||'Obsidian Kasası')),kasa:fKey,ext:ext||'.pdf',isLocalAbs:useAbs};
  }
  if(viewerPrev){
    if(window._rvPptxRel&&window._rvPptxRel===keyRel) window._rvPptxRel=null;
    closeRightViewer();
  }
  openPage(id,true);
}
let rvCurrentRawTarget='';
async function openDocxAsRamPdf(rel,stageEl,btnEl,nightMode){
  if(!stageEl) return;
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='⏳ Word RAM PDF hazırlanıyor…'; }
  stageEl.innerHTML=`<div style="padding:36px;color:var(--mut);text-align:center"><span class="spin"></span> Word belgesi PDF'e dönüştürülüyor (RAM)…</div>`;
  try{
    const resp=await fetch('/api/docx_pdf?rel='+encodeURIComponent(rel));
    if(!resp.ok){
      const msg=await resp.text();
      throw new Error(msg||('HTTP '+resp.status));
    }
    const blob=await resp.blob();
    const blobUrl=URL.createObjectURL(blob);
    const filt=nightMode?'filter:invert(0.90) hue-rotate(180deg) contrast(0.96);':'';
    stageEl.style.padding='0';
    stageEl.innerHTML=`<iframe src="${blobUrl}#view=FitH" style="flex:1;width:100%;height:100%;min-height:70vh;border:0;background:#fff;${filt}"></iframe>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='📘 Metin Görünümüne Dön'; }
  }catch(e){
    stageEl.innerHTML=`<div style="padding:20px;color:var(--err)"><b>PDF Dönüştürme Hatası</b><p>${escHtml(e.message)}</p></div>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='📄 Tam Görünüm (RAM PDF)'; }
  }
}
async function openRightViewer(relOrUrl,title){
  let raw=String(relOrUrl||'').trim();
  if(raw.startsWith('note:'))raw=raw.slice(5);
  rvCurrentRawTarget=raw;
  const isHttp=/^https?:\/\//i.test(raw)&&!raw.includes('/api/raw/');
  const isLocalAbs=!isHttp&&isLocalAbsPathOrUri(raw);
  const cleanAbs=isLocalAbs?cleanLocalPathTarget(raw):'';
  const cleanRel=isHttp?raw:normalizeVaultAssetRel(raw,typeof notionState!=='undefined'?notionState.baseDir:'');
  const vaultNoteId=!isHttp?findVaultNoteIdForTarget(raw,cleanRel):null;
  const apiTarget=(isLocalAbs&&!vaultNoteId)?cleanAbs:(vaultNoteId?vaultNoteId.slice(5):cleanRel);
  const url=isHttp?raw:rawUrlForRel(apiTarget);
  const low=apiTarget.split('#')[0].split('?')[0].toLowerCase();
  const name=title||decodeURIComponent(apiTarget.replace(/\\/g,'/').split('/').pop()||'Dosya');
  rvCurrentRel=vaultNoteId?vaultNoteId.slice(5):''; rvCurrentTitle=name;
  $('#rvTitle').textContent=name;
  const extBtn=$('#rvExtOpen');
  if(extBtn){
    extBtn.style.display='';
    extBtn.onclick=e=>{ e.preventDefault(); openExternalTarget(null,rvCurrentRawTarget||apiTarget); };
  }
  const op=$('#rvOpen');
  if(op){
    const canOpenTab=!isHttp;
    op.style.display=canOpenTab?'':'none';
    op.onclick=e=>{ e.preventDefault(); openDocInTab(apiTarget,name); };
  }
  const delBtn=$('#rvDel');
  if(delBtn) delBtn.style.display=rvCurrentRel?'':'none';
  const nb=$('#rvNightBtn');
  if(nb){
    nb.style.display=(low.endsWith('.pdf')||/\.(pptx?|ppsx)$/i.test(low))?'':'none';
    syncRightViewerModeBtn();
  }
  const b=$('#rvBody');
  if(!viewerPrev){
    const curRt=$('.rt.on');
    viewerPrev={wasClosed:app.classList.contains('no-right'),rt:curRt?curRt.dataset.rt:'ai',pct:rightPct,w:rightW};
  }
  rightPct=clampRightPct(Math.max(rightPct,VIEWER_PCT_MIN,500/paneAvailW()));
  applyPaneWidths();
  $('#rtabsBar').style.display='none';
  $$('.rbody').forEach(el=>el.classList.toggle('on',el.id==='rb-viewer'));
  app.classList.remove('no-right');
  syncPaneBtns();
  if(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(low)){
    const safeRel=escAttr(apiTarget), safeName=escAttr(name);
    b.innerHTML=`<div style="padding:14px;display:flex;flex-direction:column;align-items:center;gap:10px"><img src="${url}" data-rel="${safeRel}" data-title="${safeName}" style="max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:zoom-in" onclick="if(!isLocalAbsPathOrUri(this.dataset.rel))openDocInTab(this.dataset.rel,this.dataset.title)" title="Önizleme"><div class="mono" style="font-size:11px;color:var(--mut)">${escHtml(apiTarget)}</div></div>`;
  }else if(low.endsWith('.pdf')){
    const f=(RV_MODES[rvMode]||RV_MODES.normal).filt;
    const filt=f!=='none'?`filter:${f};`:'';
    b.innerHTML=`<iframe src="${url}#view=FitH" style="flex:1;width:100%;height:100%;border:0;background:#fff;transition:filter .2s;${filt}"></iframe>`;
  }else if(/\.(pptx?|ppsx)$/i.test(low)){
    if(window._rvPptxRel && window._rvPptxRel!==apiTarget) evictPptxPdf(window._rvPptxRel);
    window._rvPptxRel=apiTarget;
    b.innerHTML=`<div class="pptx-rv-bar"><span class="mono" style="color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</span><button class="hb" id="rvPptxPdfBtn">⚡ Hızlı Slaytlar</button></div><div id="rvPptxStage" class="rview-pptx" style="flex:1;overflow:auto"><div style="padding:20px;color:var(--mut)"><span class="spin"></span> Sunum tam görünüm (RAM PDF) hazırlanıyor: ${escHtml(name)}…</div></div>`;
    const rvStage=b.querySelector('#rvPptxStage');
    const rvBtn=b.querySelector('#rvPptxPdfBtn');
    let rvPptxMode='pdf', rvPptxData=null;
    const loadFastSlides=async ()=>{
      if(!rvPptxData) rvPptxData=await api('/api/pptx?rel='+encodeURIComponent(apiTarget));
      if(rvStage){ rvStage.style.padding=''; rvStage.style.overflow='auto'; rvStage.innerHTML=renderPptxSlidesHtml(rvPptxData); }
      if(rvBtn) rvBtn.textContent='📄 Tam Görünüm (RAM PDF)';
    };
    if(rvBtn) rvBtn.onclick=async ()=>{
      if(rvPptxMode==='pdf'){
        rvPptxMode='fast';
        try{ await loadFastSlides(); }catch(e){ if(rvStage) rvStage.innerHTML=`<div style="padding:20px;color:var(--err)">Sunum okunamadı: ${escHtml(e.message)}</div>`; }
      }else{
        rvPptxMode='pdf';
        const ok=await openPptxAsRamPdf(apiTarget,rvStage,rvBtn,rvMode);
        if(ok&&rvBtn) rvBtn.textContent='⚡ Hızlı Slaytlar';
      }
    };
    const okPdf=await openPptxAsRamPdf(apiTarget,rvStage,rvBtn,rvMode);
    if(okPdf){
      if(rvBtn) rvBtn.textContent='⚡ Hızlı Slaytlar';
    }else{
      rvPptxMode='fast';
      try{ await loadFastSlides(); }catch(e){ if(rvStage) rvStage.innerHTML=`<div style="padding:20px;color:var(--err)">Sunum okunamadı: ${escHtml(e.message)}</div>`; }
    }
  }else if(/\.(xlsx?|xlsm|csv)$/i.test(low)){
    if(window._rvPptxRel && window._rvPptxRel!==apiTarget) evictPptxPdf(window._rvPptxRel);
    window._rvPptxRel=apiTarget;
    b.innerHTML=`<div class="pptx-rv-bar"><span class="mono" style="color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</span><button class="hb" id="rvXlsxPdfBtn" title="Excel ile yatay sığdırılmış RAM PDF görünümü">📄 Tam Görünüm (RAM PDF)</button></div><div id="rvXlsxStage" class="xlsx-stage" style="flex:1;min-height:0"><div style="padding:20px;color:var(--mut)"><span class="spin"></span> Tablo hazırlanıyor: ${escHtml(name)}…</div></div>`;
    const rvStage=b.querySelector('#rvXlsxStage');
    const rvBtn=b.querySelector('#rvXlsxPdfBtn');
    let rvXlsxMode='grid', rvXlsxData=null;
    if(rvBtn) rvBtn.onclick=async ()=>{
      if(rvXlsxMode==='pdf'&&rvXlsxData){
        rvXlsxMode='grid';
        mountXlsxViewer(rvStage,rvXlsxData);
        rvBtn.textContent='📄 Tam Görünüm (RAM PDF)';
        evictXlsxPdf(apiTarget);
      }else{
        rvXlsxMode='pdf';
        await openXlsxAsRamPdf(apiTarget,rvStage,rvBtn,rvNight);
      }
    };
    try{
      const d=await api('/api/xlsx?rel='+encodeURIComponent(apiTarget));
      rvXlsxData=d;
      if(d&&d.is_legacy_xls){
        rvXlsxMode='pdf';
        openXlsxAsRamPdf(apiTarget,rvStage,rvBtn,rvNight);
      }else if(rvStage){
        mountXlsxViewer(rvStage,d);
      }
    }catch(e){
      if(rvStage) rvStage.innerHTML=`<div style="padding:20px;color:var(--err)">Tablo okunamadı: ${escHtml(e.message)}</div>`;
    }
  }else if(/\.(docx?)$/i.test(low)){
    b.innerHTML=`<div class="pptx-rv-bar"><span class="mono" style="color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</span><button class="hb" id="rvDocxPdfBtn">📄 Tam Görünüm (RAM PDF)</button></div><div id="rvDocxStage" style="flex:1;overflow:auto;display:flex;flex-direction:column"><div style="padding:20px;color:var(--mut)"><span class="spin"></span> Word belgesi okunuyor: ${escHtml(name)}…</div></div>`;
    const rvStage=b.querySelector('#rvDocxStage');
    const rvBtn=b.querySelector('#rvDocxPdfBtn');
    let rvDocxMode='html', rvDocxHtml='';
    if(rvBtn) rvBtn.onclick=async ()=>{
      if(rvDocxMode==='pdf'&&rvDocxHtml){
        rvDocxMode='html';
        rvStage.style.padding='';
        rvStage.innerHTML=`<div class="rview-docx">${rvDocxHtml}</div>`;
        rvBtn.textContent='📄 Tam Görünüm (RAM PDF)';
      }else{
        rvDocxMode='pdf';
        await openDocxAsRamPdf(apiTarget,rvStage,rvBtn,rvNight);
      }
    };
    try{
      const d=await api('/api/docx?rel='+encodeURIComponent(apiTarget));
      rvDocxHtml=d.html||'';
      if(d&&d.is_legacy_doc){
        rvDocxMode='pdf';
        openDocxAsRamPdf(apiTarget,rvStage,rvBtn,rvNight);
      }else if(rvStage){
        rvStage.innerHTML=`<div class="rview-docx">${rvDocxHtml}</div>`;
      }
    }catch(e){
      if(rvStage) rvStage.innerHTML=`<div style="padding:20px;color:var(--err)">Belge okunamadı: ${escHtml(e.message)}</div>`;
    }
  }else if(/\.(md|txt|json|csv|log|py|js|ts|rs|css|yml|yaml|toml|xml)$/i.test(low)){
    b.innerHTML=`<div style="padding:20px;color:var(--mut)"><span class="spin"></span> Dosya okunuyor: ${escHtml(name)}…</div>`;
    try{
      const d=await api('/api/local_text?path='+encodeURIComponent(apiTarget));
      if(low.endsWith('.md')) b.innerHTML=`<div class="rview-docx">${mdToHtml(d.content||'')}</div>`;
      else b.innerHTML=`<pre style="margin:0;padding:16px;overflow:auto;font-family:var(--mono);font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--txt)">${escHtml(d.content||'')}</pre>`;
    }catch(e){
      b.innerHTML=`<div style="padding:20px;color:var(--err)">Dosya okunamadı: ${escHtml(e.message)}</div>`;
    }
  }else{
    b.innerHTML=`<iframe src="${url}" style="flex:1;width:100%;height:100%;border:0;background:#fff"></iframe>`;
  }
}
function closeRightViewer(){
  if(window._rvPptxRel){ evictPptxPdf(window._rvPptxRel); window._rvPptxRel=null; }
  $('#rtabsBar').style.display='';
  const prev=viewerPrev;
  viewerPrev=null;
  if(prev){
    if(typeof prev.pct==='number'&&Number.isFinite(prev.pct)&&prev.pct>0) rightPct=clampRightPct(prev.pct);
    else if(typeof prev.w==='number'&&Number.isFinite(prev.w)) rightPct=clampRightPct(prev.w/paneAvailW());
    else rightPct=RIGHT_PCT_DEF;
    applyPaneWidths();
    const prt=(curMode==='study'&&prev.rt==='ai')?'studio':prev.rt;
    const t=$(`.rt[data-rt=${prt}]`)||$('.rt[data-rt=ai]');
    if(t){
      $$('.rt').forEach(x=>x.classList.toggle('on',x===t));
      $$('.rbody').forEach(b=>b.classList.toggle('on',b.id==='rb-'+t.dataset.rt));
    }
    if(prev.wasClosed) app.classList.add('no-right');
  }else{
    app.classList.add('no-right');
  }
  syncPaneBtns();
}
const isBlank=id=>String(id).startsWith('blank:');
let blankN=0;
function newBlankTab(){
  blankN++;
  const id='blank:'+blankN;
  openTabs.push(id);
  openPage(id);
}
function syncTreeActiveHighlight(){
  const root=$('#tree');
  if(!root||!root.children.length){ renderTree(); return; }
  root.querySelectorAll('.ti.on').forEach(el=>el.classList.remove('on'));
  if(active){
    root.querySelectorAll('.ti[data-tree-id]').forEach(el=>{
      if(el.dataset.treeId===active) el.classList.add('on');
    });
  }
}
/* opts.replace: aktif sekmenin içeriğini değiştir (Obsidian tıklama) · opts.newTab: her zaman yeni sekme (orta tık) */
function openPage(id,forceTab=false,opts={}){
  if(isAI(id)&&!ai[id])return;
  if(active!==id) saveMainScroll();
  const p=pages[id];
  if(!forceTab&&!isBlank(active)&&!openTabs.includes(id)&&((p&&p.ext&&SIDE_EXT.includes(p.ext))||(String(id).startsWith('note:')&&isSideDoc(id)))){
    openRightViewer(p?p.rel:id.slice(5),p?p.t:'');
    return;
  }
  if(!openTabs.includes(id)){
    const ai_=openTabs.indexOf(active);
    const canReplace=(opts.replace||isBlank(active))&&(!opts.newTab||isBlank(active))&&ai_!==-1&&!isAI(active)&&active!=='kasalar'&&!isAI(id);
    if(canReplace) openTabs[ai_]=id;
    else if(opts.newTab&&ai_!==-1) openTabs.splice(ai_+1,0,id);
    else openTabs.push(id);
    pruneUnlockedNotes();
  }else if(isBlank(active)&&!isBlank(id)&&active!==id){
    const bi=openTabs.indexOf(active);
    if(bi!==-1) openTabs.splice(bi,1);
  }
  active=id;
  let kasaChanged=false;
  if(p&&p.kasa&&currentKasa!=='all'&&currentKasa!==p.kasa){
    currentKasa=p.kasa;
    renderKasaFilterSelect();
    rebuildTreeAndSources();
    kasaChanged=true;
  }
  if(id==='kasalar'&&curMode!=='kasalar') layoutMode('kasalar');
  else if(isAI(id)&&curMode!=='ai') layoutMode('ai');
  else if(id==='cal'){
    if(curMode!=='plan') layoutMode('plan');
    else{
      app.classList.add('no-left','no-right');
      $$('.rbtn[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode==='plan'));
      syncPaneBtns();
    }
  }
  else if(id==='studychat'){const ss=getStudySess();if(ss)ss.unread=false;if(curMode!=='study') layoutMode('study');}
  else if(id!=='kasalar'&&id!=='studychat'&&id!=='cal'&&!isAI(id)&&curMode!=='write') layoutMode('write');
  syncPdfSlotsWithTabs();
  renderTabs();
  if(kasaChanged) renderTree(); else syncTreeActiveHighlight();
  renderSessions(); renderMain(); updateSideAiCtx(); updateRightProps(); syncPdfFocusMode(); saveSessionTabs();
  scheduleRecordNavState();
}
let _tabWidthLocked=false, _lockedTabW=0, _tabUnlockTimer=null;
function ensureTabBarHoverListeners(){
  const t=$('#tabs');
  if(!t||t.dataset.chromeTabHooked) return;
  t.dataset.chromeTabHooked='1';
  t.addEventListener('mouseleave',()=>{
    if(_tabWidthLocked) unlockTabWidths(true);
  });
  window.addEventListener('resize',()=>{
    if(_tabWidthLocked) unlockTabWidths(false);
  });
}
function maybeLockTabWidthsBeforeClose(){
  const t=$('#tabs');
  if(!t||openTabs.length<=1) return;
  if(!t.matches(':hover')) return;
  const firstTab=t.querySelector('.tab');
  if(!firstTab) return;
  const w=_tabWidthLocked&&_lockedTabW>0?_lockedTabW:firstTab.getBoundingClientRect().width;
  if(!w||w<=0) return;
  if(_tabUnlockTimer){ clearTimeout(_tabUnlockTimer); _tabUnlockTimer=null; }
  _tabWidthLocked=true;
  _lockedTabW=w;
  t.classList.add('width-locked');
  t.style.setProperty('--tab-lock-w',w.toFixed(2)+'px');
}
function unlockTabWidths(animate){
  const t=$('#tabs');
  if(!_tabWidthLocked){
    if(t){ t.classList.remove('width-locked'); t.style.removeProperty('--tab-lock-w'); }
    return;
  }
  const oldW=_lockedTabW;
  _tabWidthLocked=false;
  _lockedTabW=0;
  if(!t) return;
  if(_tabUnlockTimer){ clearTimeout(_tabUnlockTimer); _tabUnlockTimer=null; }
  const tabs=[...t.querySelectorAll('.tab')];
  t.classList.remove('width-locked');
  t.style.removeProperty('--tab-lock-w');
  if(!animate||!tabs.length||oldW<=0) return;
  const targetW=tabs[0].getBoundingClientRect().width;
  if(Math.abs(targetW-oldW)<1) return;
  tabs.forEach(el=>{
    el.style.transition='none';
    el.style.flex=`0 0 ${oldW.toFixed(2)}px`;
    el.style.maxWidth=`${oldW.toFixed(2)}px`;
  });
  void t.offsetWidth;
  tabs.forEach(el=>{
    el.style.transition='flex-basis .18s cubic-bezier(.2,0,0,1), max-width .18s cubic-bezier(.2,0,0,1)';
    el.style.flex=`0 0 ${targetW.toFixed(2)}px`;
    el.style.maxWidth=`${targetW.toFixed(2)}px`;
  });
  _tabUnlockTimer=setTimeout(()=>{
    tabs.forEach(el=>{
      el.style.transition='';
      el.style.flex='';
      el.style.maxWidth='';
    });
    _tabUnlockTimer=null;
  },195);
}
const TAB_DOCK_WIN_ID='w_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
const tabDockBC=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('agydesk_tab_dock'):null;
const otherWinRects=new Map();
function getTabBarScreenRect(){
  const t=$('#tabs');
  if(!t) return null;
  const r=t.getBoundingClientRect();
  const sx=typeof window.screenX==='number'?window.screenX:0;
  const sy=typeof window.screenY==='number'?window.screenY:0;
  return { left:sx+r.left, top:sy+r.top, right:sx+r.right, bottom:sy+r.bottom };
}
function acceptDockedTab(payload){
  if(!payload||!payload.tabId) return;
  const id=payload.tabId;
  if(payload.aiData&&isAI(id)){
    const num=parseInt(id.slice(2),10);
    if(Number.isFinite(num)&&num>aiN) aiN=num;
    ai[id]=payload.aiData;
  }
  const t=$('#tabs');
  let insertIdx=openTabs.length;
  if(t&&Number.isFinite(payload.dropScreenX)){
    const sx=typeof window.screenX==='number'?window.screenX:0;
    const localX=payload.dropScreenX-sx;
    const els=[...t.querySelectorAll('.tab')];
    for(let i=0;i<els.length;i++){
      const r=els[i].getBoundingClientRect();
      if(localX<r.left+r.width/2){ insertIdx=i; break; }
    }
  }
  const existingIdx=openTabs.indexOf(id);
  if(existingIdx!==-1){
    openTabs.splice(existingIdx,1);
    if(existingIdx<insertIdx) insertIdx=Math.max(0,insertIdx-1);
  }
  openTabs.splice(Math.min(insertIdx,openTabs.length),0,id);
  openPage(id,true);
  try{ window.focus(); }catch(e){}
}
function dockTabToWindow(id,targetWinId,dropScreenX){
  if(!id||!tabDockBC) return false;
  if(active===id) saveMainScroll();
  if(typeof flushNotionSave==='function'&&active===id) flushNotionSave();
  const idx=openTabs.indexOf(id);
  const payload={tabId:id,dropScreenX,fromWin:TAB_DOCK_WIN_ID};
  if(isAI(id)&&ai[id]) payload.aiData=ai[id];
  tabDockBC.postMessage({type:'dock-drop',target:targetWinId,payload});
  openTabs=openTabs.filter(t=>t!==id);
  removePdfSlot(id);
  if(id.startsWith('note:')&&/\.(pptx?|ppsx)$/i.test(id)) evictPptxPdf(id.slice(5));
  if(!openTabs.length){
    try{ sessionStorage.removeItem(TAB_STORE_KEY); sessionStorage.removeItem('agy_detached_win'); }catch(e){}
    winAct('close',true);
    return true;
  }
  if(active===id) active=openTabs[Math.min(Math.max(0,idx),openTabs.length-1)];
  if(active==='kasalar') layoutMode('kasalar');
  else if(isAI(active)) layoutMode('ai');
  else if(active==='cal') layoutMode('plan');
  else if(active==='studychat') layoutMode('study');
  else layoutMode('write');
  renderTabs();
  syncTreeActiveHighlight();
  renderSessions();
  renderMain();
  updateSideAiCtx();
  updateRightProps();
  syncPdfFocusMode();
  saveSessionTabs();
  scheduleRecordNavState();
  return true;
}
if(tabDockBC){
  tabDockBC.onmessage=e=>{
    const msg=e.data;
    if(!msg||typeof msg!=='object') return;
    if(msg.type==='ping-rects'&&msg.from!==TAB_DOCK_WIN_ID){
      const tb=getTabBarScreenRect();
      if(tb) tabDockBC.postMessage({type:'rect',winId:TAB_DOCK_WIN_ID,isDetached:!!window.__IS_DETACHED_WIN,tabBar:tb,ts:Date.now()});
    }else if(msg.type==='rect'&&msg.winId!==TAB_DOCK_WIN_ID){
      otherWinRects.set(msg.winId,{isDetached:msg.isDetached,tabBar:msg.tabBar,ts:msg.ts});
    }else if(msg.type==='dock-hover'){
      const t=$('#tabs');
      if(!t) return;
      if(msg.target===TAB_DOCK_WIN_ID&&msg.active) t.classList.add('tab-dock-target');
      else t.classList.remove('tab-dock-target');
    }else if(msg.type==='dock-drop'&&msg.target===TAB_DOCK_WIN_ID){
      const t=$('#tabs');
      if(t) t.classList.remove('tab-dock-target');
      acceptDockedTab(msg.payload);
    }else if(msg.type==='win-closed'&&msg.winId){
      otherWinRects.delete(msg.winId);
    }
  };
  window.addEventListener('beforeunload',()=>{
    try{ tabDockBC.postMessage({type:'win-closed',winId:TAB_DOCK_WIN_ID}); }catch(e){}
  });
}

function detachTabToWindow(id,screenX,screenY){
  if(!id||openTabs.length<=1) return;
  if(active===id) saveMainScroll();
  if(typeof flushNotionSave==='function'&&active===id) flushNotionSave();
  const idx=openTabs.indexOf(id);
  const token=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  try{
    const handoff={tabId:id,currentSpace,currentKasa};
    if(isAI(id)&&ai[id]) handoff.aiData=ai[id];
    localStorage.setItem('agy_detach_'+token,JSON.stringify(handoff));
  }catch(e){}
  openTabs=openTabs.filter(t=>t!==id);
  if(!openTabs.length) openTabs=['kasalar'];
  if(active===id) active=openTabs[Math.min(Math.max(0,idx),openTabs.length-1)];
  if(active==='kasalar') layoutMode('kasalar');
  else if(isAI(active)) layoutMode('ai');
  else if(active==='cal') layoutMode('plan');
  else if(active==='studychat') layoutMode('study');
  else layoutMode('write');
  removePdfSlot(id);
  if(id.startsWith('note:')&&/\.(pptx?|ppsx)$/i.test(id)) evictPptxPdf(id.slice(5));
  renderTabs();
  syncTreeActiveHighlight();
  renderSessions();
  renderMain();
  updateSideAiCtx();
  updateRightProps();
  syncPdfFocusMode();
  saveSessionTabs();
  scheduleRecordNavState();
  const winW=Math.min(window.outerWidth||1180,1240);
  const winH=Math.min(window.outerHeight||780,820);
  const winX=Math.max(0,Math.round((Number.isFinite(screenX)?screenX:240)-180));
  const winY=Math.max(0,Math.round((Number.isFinite(screenY)?screenY:140)-24));
  if(window.ipc&&typeof window.ipc.postMessage==='function'){
    window.ipc.postMessage('detach:'+JSON.stringify({tab:id,token,x:winX,y:winY,w:winW,h:winH}));
  }else{
    const u=`${window.location.pathname}?detach_tab=${encodeURIComponent(id)}&detach_token=${encodeURIComponent(token)}`;
    window.open(u,'_blank',`width=${winW},height=${winH},left=${winX},top=${winY}`);
  }
}
function closeTab(id,opts={}){
  if(!opts.skipWidthLock) maybeLockTabWidthsBeforeClose();
  if(active===id) saveMainScroll();
  const idx=openTabs.indexOf(id);
  const pgTitle=(typeof pg==='function'?pg(id).t:id);
  const closingAi=isAI(id);
  const aiSnap=closingAi&&ai[id]?{...ai[id],running:false}:null;
  openTabs=openTabs.filter(t=>t!==id);
  unlockedNotes.delete(id);
  pruneUnlockedNotes();
  noteDomCache.delete(id);
  if(closingAi&&ai[id]&&!hasChatActivity(ai[id])&&!ai[id].running&&!ai[id].pending){
    // Boş taslak oturumu bellekten temizle; kayıtlı sohbetlere ASLA dokunma!
    delete ai[id];
  }
  if(!openTabs.length)openTabs=['kasalar'];
  if(active===id)active=openTabs[Math.min(Math.max(0,idx),openTabs.length-1)];
  if(active==='kasalar') layoutMode('kasalar');
  else if(isAI(active)) layoutMode('ai');
  else if(active==='cal') layoutMode('plan');
  else if(active==='studychat') layoutMode('study');
  else if(curMode==='ai') layoutMode('write');
  removePdfSlot(id);
  if(id.startsWith('note:')&&/\.(pptx?|ppsx)$/i.test(id)) evictPptxPdf(id.slice(5));
  if(!opts.silentUndo&&idx!==-1&&id!=='kasalar'&&!isBlank(id)&&(!closingAi||hasChatActivity(aiSnap))){
    CLOSED_TABS.push({id,idx,aiSnap:closingAi?aiSnap:null});
    if(CLOSED_TABS.length>30) CLOSED_TABS.shift();
    saveClosedTabs();
    pushAppUndo({
      label:`"${pgTitle}" sekmesi`,
      undo:async()=>{
        const ci=CLOSED_TABS.findLastIndex(x=>x&&x.id===id);
        if(ci!==-1){ CLOSED_TABS.splice(ci,1); saveClosedTabs(); }
        if(closingAi&&!ai[id]&&aiSnap) ai[id]=aiSnap;
        if(!openTabs.includes(id)) openTabs.splice(Math.min(idx,openTabs.length),0,id);
        openPage(id,true);
      },
      redo:async()=>{ closeTab(id,{silentUndo:true}); }
    });
  }
  renderTabs();syncTreeActiveHighlight();renderSessions();if(typeof renderAiDrawer==='function')renderAiDrawer();renderMain();updateSideAiCtx();updateRightProps();syncPdfFocusMode();saveSessionTabs();
  scheduleRecordNavState();
}
const isAI=id=>id.startsWith('ai');
pages.studychat={t:'Sohbet',i:'❖'};
const pg=id=>isAI(id)?{t:(typeof getAiSessionTitle==='function'?getAiSessionTitle(id):(ai[id]?ai[id].title:'Yeni Sohbet')),i:'◆'}:(isBlank(id)?{t:'Yeni sekme',i:'📄'}:(pages[id]||{t:id,i:'📝'}));
let draggedTabId=null, isTabDragging=false;
function moveActiveTab(dir){
  const idx=openTabs.indexOf(active);
  if(idx===-1) return;
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=openTabs.length) return;
  const [moved]=openTabs.splice(idx,1);
  openTabs.splice(newIdx,0,moved);
  renderTabs();
  saveSessionTabs();
}
function syncWindowTitle(){
  if(typeof GCAL!=='undefined'&&GCAL.pomo&&GCAL.pomo.running&&GCAL.pomo.sec>0) return;
  if(document.title.startsWith('🔔')) return;
  const info=typeof active!=='undefined'?pg(active):null;
  const tabName=(info&&info.t?String(info.t).trim():'');
  const nextTitle=tabName?`AgyDesk - ${tabName}`:'AgyDesk';
  if(document.title!==nextTitle){
    document.title=nextTitle;
    try{ if(window.ipc&&typeof window.ipc.postMessage==='function') window.ipc.postMessage('title:'+nextTitle); }catch(e){}
  }
}

function renderTabs(){
  syncWindowTitle();
  ensureTabBarHoverListeners();
  const t=$('#tabs'); t.innerHTML='';
  if(_tabWidthLocked&&_lockedTabW>0){
    t.classList.add('width-locked');
    t.style.setProperty('--tab-lock-w',_lockedTabW.toFixed(2)+'px');
  }else{
    t.classList.remove('width-locked');
    t.style.removeProperty('--tab-lock-w');
  }
  t.ondragover=null;
  t.ondrop=null;
  openTabs.forEach((id,idx)=>{
    const d=document.createElement('div'); d.className='tab'+(id===active?' on':'');
    d.draggable=false;
    d.dataset.tabId=id;
    const s=isAI(id)?ai[id]:(id==='studychat'?getStudySess():null);
    const info=pg(id);
    const shortcutHint=idx<8?` (Ctrl+${idx+1})`:(idx===openTabs.length-1?' (Ctrl+9)':'');
    d.title=info.t+shortcutHint+' · Sürükleyerek sırasını değiştir, aşağı çekerek yeni pencereye ayır';
    let calBadge='';
    if(id==='cal'&&typeof GCAL!=='undefined'){
      if(GCAL.pomo&&GCAL.pomo.running){
        calBadge=`<span class="acal-tab-pill pomo" id="acalTabPomo">⏱ ${gcalPad(Math.floor(GCAL.pomo.sec/60))}:${gcalPad(GCAL.pomo.sec%60)}</span>`;
      }else if(typeof calEvents!=='undefined'&&calEvents.length){
        const todayIso=gcalTodayISO();
        const nx=calEvents.filter(e=>!e.done&&e.kind==='exam'&&gcalDiffDays(e.date,todayIso)>=0).sort((a,b)=>a.date.localeCompare(b.date))[0];
        if(nx){ const df=gcalDiffDays(nx.date,todayIso); calBadge=`<span class="acal-tab-pill exam" title="Yaklaşan Sınav: ${nx.title}">${df===0?'BUGÜN':'🔥 '+df+'g'}</span>`; }
      }
    }
    const stateBadge=s?(s.running?'<span class="spin"></span>':(s.pending?'<span class="udot" style="background:var(--cu)"></span>':(s.unread?'<span class="udot"></span>':''))):'';
    const badge=s?(isAI(id)?`<span class="md ${s.mode}" title="${MODES[s.mode].n}"></span>`:'')+stateBadge:calBadge;
    d.innerHTML=`<span class="tic">${svgIcon(info.i)}</span><span class="tt">${info.t}</span>${badge}<span class="x" data-x="${id}" title="Sekmeyi kapat (Ctrl+W)">✕</span>`;
    d.onpointerdown=e=>{
      if(e.button!==0||e.target.closest('.x')) return;
      const pointerId=e.pointerId;
      const startX=e.clientX, startY=e.clientY;
      let dragBaseX=e.clientX;
      let dragging=false, tearOut=false, dockTargetWinId=null, previewEl=null;
      const showPreview=(cx,cy,dockWinId)=>{
        if(!previewEl){
          previewEl=document.createElement('div');
          previewEl.id='tabTearPreview';
          previewEl.className='tab-tear-preview';
          previewEl.innerHTML=`<div class="ttp-bar"><span class="tic">${svgIcon(info.i)}</span><span class="tt">${escHtml(info.t)}</span></div><div class="ttp-hint"><span class="ttp-msg">Yeni pencereye ayır</span><span class="ttp-ico">↗</span></div>`;
          document.body.appendChild(previewEl);
        }
        previewEl.classList.toggle('dock-ready',Boolean(dockWinId));
        const msgEl=previewEl.querySelector('.ttp-msg');
        const icoEl=previewEl.querySelector('.ttp-ico');
        if(msgEl) msgEl.textContent=dockWinId?'Bu pencereye birleştir':(openTabs.length>1?'Yeni pencereye ayır':'Tek başına pencere');
        if(icoEl) icoEl.textContent=dockWinId?'↙':(openTabs.length>1?'↗':'▢');
        previewEl.style.left=cx+'px';
        previewEl.style.top=cy+'px';
      };
      const hidePreview=()=>{
        if(previewEl){ previewEl.remove(); previewEl=null; }
      };
      const setDockHover=(nextWinId)=>{
        if(dockTargetWinId&&dockTargetWinId!==nextWinId&&tabDockBC){
          tabDockBC.postMessage({type:'dock-hover',target:dockTargetWinId,active:false});
        }
        dockTargetWinId=nextWinId||null;
        if(dockTargetWinId&&tabDockBC){
          tabDockBC.postMessage({type:'dock-hover',target:dockTargetWinId,active:true});
        }
      };
      const findDockTarget=(sx,sy)=>{
        const selfL=typeof window.screenX==='number'?window.screenX:0;
        const selfT=typeof window.screenY==='number'?window.screenY:0;
        const selfR=selfL+(window.outerWidth||window.innerWidth||0);
        const selfB=selfT+(window.outerHeight||window.innerHeight||0);
        if(sx>=selfL&&sx<=selfR&&sy>=selfT&&sy<=selfB) return null;
        for(const [wId,wInfo] of otherWinRects.entries()){
          const r=wInfo.tabBar;
          if(!r) continue;
          if(sx>=r.left-12&&sx<=r.right+48&&sy>=r.top-18&&sy<=r.bottom+26){
            return wId;
          }
        }
        return null;
      };
      const onMove=ev=>{
        if(ev.pointerId!==pointerId) return;
        const dx=ev.clientX-startX, dy=ev.clientY-startY;
        if(!dragging){
          if(Math.abs(dx)<5&&Math.abs(dy)<5) return;
          dragging=true;
          isTabDragging=true;
          draggedTabId=id;
          document.body.classList.add('tab-drag-no-select');
          d.classList.add('tab-dragging-el');
          try{ d.setPointerCapture(pointerId); }catch(err){}
          if(tabDockBC){
            otherWinRects.clear();
            tabDockBC.postMessage({type:'ping-rects',from:TAB_DOCK_WIN_ID});
          }
        }
        const tabsRect=t.getBoundingClientRect();
        const outsideOwnTabBar=ev.clientY>tabsRect.bottom+38||ev.clientY<tabsRect.top-38;
        const hitDockWin=outsideOwnTabBar?findDockTarget(ev.screenX,ev.screenY):null;
        const nextTear=outsideOwnTabBar;
        if(nextTear){
          tearOut=true;
          d.classList.add('tab-tearing');
          d.style.transform='';
          setDockHover(hitDockWin);
          showPreview(ev.clientX,ev.clientY,hitDockWin);
          return;
        }
        setDockHover(null);
        if(tearOut){
          tearOut=false;
          d.classList.remove('tab-tearing');
          hidePreview();
        }
        const curDx=ev.clientX-dragBaseX;
        d.style.transform=`translateX(${curDx}px)`;
        const dRect=d.getBoundingClientRect();
        const dCenter=dRect.left+dRect.width/2;
        const tabEls=[...t.querySelectorAll('.tab')];
        const curDomIdx=tabEls.indexOf(d);
        if(curDomIdx===-1) return;
        let swapTarget=null, swapDir=0;
        if(curDomIdx<tabEls.length-1){
          const rightEl=tabEls[curDomIdx+1];
          const rRect=rightEl.getBoundingClientRect();
          if(dCenter>rRect.left+rRect.width/2){ swapTarget=rightEl; swapDir=1; }
        }
        if(!swapTarget&&curDomIdx>0){
          const leftEl=tabEls[curDomIdx-1];
          const lRect=leftEl.getBoundingClientRect();
          if(dCenter<lRect.left+lRect.width/2){ swapTarget=leftEl; swapDir=-1; }
        }
        if(swapTarget){
          const siblings=tabEls.filter(el=>el!==d);
          const oldLefts=new Map(siblings.map(el=>[el,el.getBoundingClientRect().left]));
          const oldSelfOffset=d.offsetLeft;
          const srcIdx=openTabs.indexOf(id);
          const tgtId=swapTarget.dataset.tabId;
          const tgtIdx=openTabs.indexOf(tgtId);
          if(srcIdx!==-1&&tgtIdx!==-1){
            const [moved]=openTabs.splice(srcIdx,1);
            openTabs.splice(tgtIdx,0,moved);
          }
          if(swapDir>0){
            t.insertBefore(d,swapTarget.nextSibling);
          }else{
            t.insertBefore(d,swapTarget);
          }
          const offsetDelta=d.offsetLeft-oldSelfOffset;
          dragBaseX+=offsetDelta;
          d.style.transform=`translateX(${ev.clientX-dragBaseX}px)`;
          siblings.forEach(el=>{
            const oldL=oldLefts.get(el);
            const newL=el.getBoundingClientRect().left;
            const delta=oldL-newL;
            if(Math.abs(delta)>0.5){
              el.style.transition='none';
              el.style.transform=`translateX(${delta}px)`;
              void el.offsetWidth;
              el.style.transition='transform 160ms cubic-bezier(.2,0,0,1)';
              el.style.transform='translateX(0)';
            }
          });
        }
      };
      const onUp=ev=>{
        if(ev.pointerId!==undefined&&ev.pointerId!==pointerId) return;
        window.removeEventListener('pointermove',onMove);
        window.removeEventListener('pointerup',onUp);
        window.removeEventListener('pointercancel',onUp);
        window.removeEventListener('blur',onUp);
        try{ if(d.hasPointerCapture(pointerId)) d.releasePointerCapture(pointerId); }catch(err){}
        hidePreview();
        const finalDockWin=tearOut?(dockTargetWinId||findDockTarget(ev.screenX,ev.screenY)):null;
        setDockHover(null);
        document.body.classList.remove('tab-drag-no-select');
        d.classList.remove('tab-tearing');
        if(!dragging){
          draggedTabId=null;
          return;
        }
        const wasTear=tearOut;
        draggedTabId=null;
        setTimeout(()=>{ isTabDragging=false; },60);
        if(finalDockWin){
          d.classList.remove('tab-dragging-el');
          dockTabToWindow(id,finalDockWin,ev.screenX);
          return;
        }
        if(wasTear&&openTabs.length>1){
          d.classList.remove('tab-dragging-el');
          detachTabToWindow(id,ev.screenX,ev.screenY);
          return;
        }
        d.style.transition='transform 140ms cubic-bezier(.2,0,0,1)';
        d.style.transform='translateX(0)';
        setTimeout(()=>{
          d.classList.remove('tab-dragging-el');
          renderTabs();
          saveSessionTabs();
        },145);
      };
      window.addEventListener('pointermove',onMove);
      window.addEventListener('pointerup',onUp);
      window.addEventListener('pointercancel',onUp);
      window.addEventListener('blur',onUp);
    };
    d.onclick=e=>{
      if(isTabDragging) return;
      if(e.target.dataset.x){closeTab(id);return;}
      openPage(id);
    };
    d.onauxclick=e=>{ if(e.button===1){e.preventDefault();closeTab(id);} };
    t.appendChild(d);
  });
  const a=document.createElement('div');a.className='tab-add';a.title=curMode==='ai'?'Yeni AI oturumu':'Yeni boş sekme (Ctrl+T)';a.textContent='＋';
  a.onclick=()=>{
    if(curMode==='ai'){newSession();return;}
    newBlankTab();
  };
  t.appendChild(a);
  const n=Object.values(ai).filter(s=>s.running).length;
  $('#bgStat').innerHTML=n?`<span class="spin"></span> ${n} AI görevi çalışıyor`:'<i class="dot"></i>Yönlendirici hazır';
  saveSessionTabs();
}

/* ---------- AI oturumları ---------- */
const DEFAULT_AI_WELCOME='Merhaba, bu sekme tam ekran AI çalışma alanı. Aktif kasa kaynakların ve notların otomatik bağlıdır. Uzun bir görev verip başka sekmeye geçebilirsin.';
const SIDE_IDS=['side_ai','src_ai'];
function isStudySessId(id){ return id==='src_ai'||String(id||'').startsWith('src_ai__'); }
function isSideId(id){ return id==='side_ai'||isStudySessId(id); }
function getStudyKasaKey(sid){ return String(sid||'').startsWith('src_ai__')?String(sid).slice(8):'all'; }
function getStudySessId(kasaKey=currentKasa){ const k=(kasaKey&&kasaKey!=='all')?String(kasaKey):''; return k?'src_ai__'+k:'src_ai'; }
function ensureStudySession(sid){
  if(!ai[sid]) ai[sid]={title:'Kaynaklarla Çalış AI',msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
  return ai[sid];
}
function getStudySess(){ return ensureStudySession(getStudySessId()); }
const ai={
  src_ai:{title:'Kaynaklarla Çalış AI',msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]},
  ai1:{title:'Yeni Sohbet',msgs:[],sources:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]},
  side_ai:{title:'Sağ Panel AI',msgs:[{w:'a',h:'Merhaba! Açık olan notun ve sol panelde işaretli <b>Kasa kaynaklarının</b> gerçek içeriğine bağlıyım. Soru sorabilir, özet/sınav föyü isteyebilir veya sağdan bir <b>Skill</b> çalıştırabilirsin.'}],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]}
};
let aiN=1;
function makeUniqueAiId(){
  return 'ai_'+WIN_ID.slice(-4)+'_'+Date.now().toString(36).slice(-4)+'_'+Math.random().toString(36).slice(2,5);
}
let aiMeta=(()=>{
  try{
    const raw=localStorage.getItem(AI_META_KEY);
    const parsed=raw?JSON.parse(raw):null;
    if(parsed&&typeof parsed==='object') return {lastActive:parsed.lastActive||null,items:(parsed.items&&typeof parsed.items==='object')?parsed.items:{}};
  }catch(e){}
  return {lastActive:null,items:{}};
})();
let aiDrawerOpen=(()=>{
  try{
    const v=localStorage.getItem(AI_DRAWER_KEY);
    if(v==='0') return false;
    if(v==='1') return true;
  }catch(e){}
  return window.innerWidth>=860;
})();
let aiSearchQuery='';
let _aiDelConfirmId=null;
let _aiDelConfirmTimer=null;
let _aiRenamingId=null;

function saveAiMeta(){
  try{ persistUiState({[AI_META_KEY]:JSON.stringify(aiMeta)},false); }catch(e){}
}
function hasUserMsgs(s){
  return Boolean(s&&Array.isArray(s.msgs)&&s.msgs.some(m=>m&&m.w==='me'));
}
function isCompactMsg(m){
  return Boolean(m&&(m.compact||String(m.h||'').startsWith('🗜 Bağlam sıkıştırıldı')));
}
function hasCompactSummary(s){
  return Boolean(s&&Array.isArray(s.msgs)&&s.msgs.some(isCompactMsg));
}
function hasChatActivity(s){
  return hasUserMsgs(s)||hasCompactSummary(s);
}
function isSavedAiSession(id){
  if(!id||isSideId(id)||!isAI(id)) return false;
  const s=ai[id];
  return Boolean(s&&(hasChatActivity(s)||s.running||s.pending));
}
function stripHtmlCompact(html){
  return String(html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function deriveAiTitle(s){
  if(!s||!Array.isArray(s.msgs)) return 'Yeni Sohbet';
  const firstMe=s.msgs.find(m=>m&&m.w==='me');
  if(!firstMe) return 'Yeni Sohbet';
  const txt=stripHtmlCompact(firstMe.raw||firstMe.h).replace(/^Skill:\s*/i,'');
  if(!txt) return 'Görsel analizi';
  return txt.length>46?txt.slice(0,45).trimEnd()+'…':txt;
}
function getAiSessionTitle(id){
  const m=aiMeta.items[id];
  if(m&&m.customTitle&&m.title) return m.title;
  const s=ai[id];
  if(s&&hasUserMsgs(s)) return deriveAiTitle(s);
  const raw=(m&&m.title)||(s&&s.title)||'';
  if(!raw||raw.startsWith('AI Oturumu')) return 'Yeni Sohbet';
  return raw;
}
function getAiSessionPreview(id){
  const s=ai[id];
  if(!s||!Array.isArray(s.msgs)||!s.msgs.length) return 'Henüz mesaj yok';
  for(let i=s.msgs.length-1;i>=0;i--){
    const msg=s.msgs[i];
    if(!msg||msg.ap) continue;
    const raw=msg.raw||stripHtmlCompact(msg.h);
    if(!raw) continue;
    if(i===0&&msg.w==='a'&&raw.includes('AgyDesk')) continue;
    return raw.length>68?raw.slice(0,67).trimEnd()+'…':raw;
  }
  return 'Yeni sohbet başlat…';
}
function getAiMsgCount(id){
  const s=ai[id];
  if(!s||!Array.isArray(s.msgs)) return 0;
  return s.msgs.filter((m,i)=>m&&!m.ap&&!(i===0&&m.w==='a'&&String(m.h||'').includes('AgyDesk'))).length;
}
function touchAiMeta(id,patch={}){
  if(!id||isSideId(id)||!isAI(id)) return;
  const prev=aiMeta.items[id]||{};
  const next={...prev,...patch};
  if(!next.updatedAt) next.updatedAt=Math.floor(Date.now()/1000);
  if(!next.customTitle&&ai[id]&&hasUserMsgs(ai[id])) next.title=deriveAiTitle(ai[id]);
  aiMeta.items[id]=next;
  if(ai[id]&&next.title) ai[id].title=next.title;
  if(patch.setLastActive!==false&&hasChatActivity(ai[id])) aiMeta.lastActive=id;
  saveAiMeta();
}
function getSortedAiSessions(includeActiveDraft=true){
  const ids=Object.keys(ai).filter(id=>{
    if(isSideId(id)||!isAI(id)) return false;
    if(isSavedAiSession(id)) return true;
    return includeActiveDraft&&id===active;
  });
  return ids.sort((a,b)=>{
    const ma=aiMeta.items[a]||{}, mb=aiMeta.items[b]||{};
    if(Boolean(ma.pinned)!==Boolean(mb.pinned)) return ma.pinned?-1:1;
    const sa=ai[a]||{}, sb=ai[b]||{};
    if(Boolean(sa.running)!==Boolean(sb.running)) return sa.running?-1:1;
    return (mb.updatedAt||0)-(ma.updatedAt||0);
  });
}
function pruneEmptyDraftSessions(keepId=null){
  Object.keys(ai).forEach(k=>{
    if(isSideId(k)||!isAI(k)||k===keepId||k===active||openTabs.includes(k)) return;
    if(!hasChatActivity(ai[k])&&!ai[k].running&&!ai[k].pending) delete ai[k];
  });
}
function createFreshAiDraft(){
  aiN++;
  let id=makeUniqueAiId();
  while(ai[id]) id=makeUniqueAiId();
  ai[id]={title:'Yeni Sohbet',msgs:[],sources:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
  return id;
}
function ensureWindowAiSession(){
  const existingOpen=openTabs.find(t=>isAI(t)&&ai[t]);
  if(existingOpen) return existingOpen;
  if(aiMeta.lastActive&&ai[aiMeta.lastActive]&&isSavedAiSession(aiMeta.lastActive)) return aiMeta.lastActive;
  const saved=getSortedAiSessions(false);
  if(saved.length) return saved[0];
  return createFreshAiDraft();
}
function switchAiSession(id,opts={}){
  if(!id||!ai[id]) return;
  if(opts.newTab){
    openPage(id,true,{newTab:true});
    if(isSavedAiSession(id)){ aiMeta.lastActive=id; saveAiMeta(); }
    return;
  }
  if(openTabs.includes(id)){
    openPage(id);
    if(isSavedAiSession(id)){ aiMeta.lastActive=id; saveAiMeta(); }
    return;
  }
  const slotIdx=isAI(active)?openTabs.indexOf(active):openTabs.findIndex(isAI);
  if(slotIdx!==-1){
    const prevId=openTabs[slotIdx];
    if(active===prevId) saveMainScroll();
    openTabs[slotIdx]=id;
    if(prevId!==id&&ai[prevId]&&!hasChatActivity(ai[prevId])&&!ai[prevId].running&&!ai[prevId].pending){
      delete ai[prevId];
    }
    active=id;
    if(isSavedAiSession(id)){ aiMeta.lastActive=id; saveAiMeta(); }
    if(curMode!=='ai') layoutMode('ai');
    renderTabs();
    renderSessions();
    renderAiDrawer();
    renderMain();
    updateSideAiCtx();
    updateRightProps();
    syncPdfFocusMode();
    saveSessionTabs();
    scheduleRecordNavState();
    return;
  }
  openPage(id);
  if(isSavedAiSession(id)){ aiMeta.lastActive=id; saveAiMeta(); }
}
function newSession(opts={}){
  if(!opts.newTab&&isAI(active)&&ai[active]&&!hasChatActivity(ai[active])&&!ai[active].running&&!ai[active].pending){
    const inp=$('#aiInput');
    if(inp) inp.focus();
    toast('Zaten yeni bir sohbettesin');
    return;
  }
  const id=createFreshAiDraft();
  switchAiSession(id,opts);
  requestAnimationFrame(()=>{ const inp=$('#aiInput'); if(inp) inp.focus(); });
}
function toggleAiDrawer(){
  togglePane('left');
  const btn=$('#aiDrawerTog');
  if(btn) btn.classList.toggle('on',!app.classList.contains('no-left'));
}
function onAiSearchInput(val){
  aiSearchQuery=String(val||'');
  const clr=$('#aiSearchClr');
  if(clr) clr.style.display=aiSearchQuery?'grid':'none';
  renderSessions();
}
function clearAiSearch(){
  aiSearchQuery='';
  const inp=$('#aiSearchIn'), clr=$('#aiSearchClr');
  if(inp){ inp.value=''; inp.focus(); }
  if(clr) clr.style.display='none';
  renderSessions();
}
function togglePinAiSession(id,ev){
  if(ev) ev.stopPropagation();
  if(!ai[id]) return;
  const cur=Boolean(aiMeta.items[id]&&aiMeta.items[id].pinned);
  touchAiMeta(id,{pinned:!cur,setLastActive:false});
  renderAiDrawer();
  renderSessions();
  toast(cur?'Sabitleme kaldırıldı':'Sohbet sabitlendi');
}
function startRenameAiSession(id,ev){
  if(ev) ev.stopPropagation();
  if(!ai[id]) return;
  _aiRenamingId=id;
  renderAiDrawer();
  requestAnimationFrame(()=>{
    const inp=$(`.ai-rename-in[data-rid="${id}"]`);
    if(inp){ inp.focus(); inp.select(); }
  });
}
function commitRenameAiSession(id,val){
  _aiRenamingId=null;
  const clean=String(val||'').trim().slice(0,80);
  if(clean&&ai[id]){
    touchAiMeta(id,{title:clean,customTitle:true,setLastActive:false});
    ai[id].title=clean;
  }
  renderAiDrawer();
  renderSessions();
  renderTabs();
  if(active===id) aiHead(id);
}
function deleteAiSession(id,ev){
  if(ev) ev.stopPropagation();
  if(isSideId(id)||!ai[id]) return;
  if(_aiDelConfirmId!==id){
    _aiDelConfirmId=id;
    if(_aiDelConfirmTimer) clearTimeout(_aiDelConfirmTimer);
    _aiDelConfirmTimer=setTimeout(()=>{ _aiDelConfirmId=null; renderAiDrawer(); renderSessions(); },3500);
    renderAiDrawer();
    renderSessions();
    return;
  }
  _aiDelConfirmId=null;
  if(_aiDelConfirmTimer){ clearTimeout(_aiDelConfirmTimer); _aiDelConfirmTimer=null; }
  const s=ai[id];
  const title=getAiSessionTitle(id);
  if(s&&s.running) api('/api/stop',{session:id}).catch(()=>{});
  api('/api/clear',{session:id}).catch(()=>{});
  delete ai[id];
  delete aiMeta.items[id];
  if(aiMeta.lastActive===id) aiMeta.lastActive=null;
  saveAiMeta();
  const tabIdx=openTabs.indexOf(id);
  const wasActive=(active===id);
  if(tabIdx!==-1){
    const nextSaved=getSortedAiSessions(false)[0];
    if(wasActive&&curMode==='ai'){
      const repl=nextSaved||createFreshAiDraft();
      openTabs[tabIdx]=repl;
      active=repl;
    }else{
      openTabs=openTabs.filter(t=>t!==id);
      if(!openTabs.length) openTabs=['kasalar'];
      if(wasActive) active=openTabs[Math.min(Math.max(0,tabIdx),openTabs.length-1)];
    }
  }
  toast(`🗑 "${title}" kalıcı olarak silindi`);
  renderAiDrawer(); renderSessions(); renderTabs(); renderMain(); saveSessionTabs();
}
function closeSession(id,ev){
  // Geriye dönük uyumluluk: sekme kapatma sohbeti silmez, kalıcı silme deleteAiSession ile yapılır
  deleteAiSession(id,ev);
}
function aiMatchesSearch(id,q){
  if(!q) return true;
  const lq=q.toLowerCase();
  if(getAiSessionTitle(id).toLowerCase().includes(lq)) return true;
  const s=ai[id];
  if(!s||!Array.isArray(s.msgs)) return false;
  return s.msgs.some(m=>m&&stripHtmlCompact(m.raw||m.h).toLowerCase().includes(lq));
}
function renderSessions(){
  const list=$('#sessions');
  const q=aiSearchQuery.trim();
  const allSaved=getSortedAiSessions(false);
  const headCnt=$('#aiHeadCount');
  if(headCnt){
    headCnt.textContent=allSaved.length?String(allSaved.length):'';
    headCnt.style.display=allSaved.length?'':'none';
  }
  if(!list) return;
  const filtered=allSaved.filter(id=>aiMatchesSearch(id,q));
  const pinned=filtered.filter(id=>aiMeta.items[id]&&aiMeta.items[id].pinned);
  const recent=filtered.filter(id=>!(aiMeta.items[id]&&aiMeta.items[id].pinned));
  const renderItem=id=>{
    const s=ai[id];
    const meta=aiMeta.items[id]||{};
    const isOn=(id===active);
    const isDel=(_aiDelConfirmId===id);
    const isRen=(_aiRenamingId===id);
    const title=getAiSessionTitle(id);
    const cnt=getAiMsgCount(id);
    const rel=meta.updatedAt?fmtRelTime(meta.updatedAt):'';
    const stateHtml=s.running?'<span class="spin"></span> yanıtlıyor':(s.unread?'<span class="ai-dot"></span> yeni yanıt':`${cnt} mesaj${rel?' · '+rel:''}`);
    return `<div class="ai-hist-item${isOn?' on':''}${meta.pinned?' pinned':''}" data-sid="${escAttr(id)}">
      <div class="ai-hist-top">
        ${isRen
          ? `<input class="ai-rename-in" data-rid="${escAttr(id)}" value="${escAttr(title)}" onkeydown="if(event.key==='Enter'){event.preventDefault();commitRenameAiSession('${escAttr(id)}',this.value)}else if(event.key==='Escape'){_aiRenamingId=null;renderSessions()}" onblur="commitRenameAiSession('${escAttr(id)}',this.value)" onclick="event.stopPropagation()">`
          : `<span class="ai-hist-title" title="${escAttr(title)} · Tıkla: Geç · Ctrl+Tık: Yeni sekme">${meta.pinned?'<span class="ai-pin-ic">★</span>':''}${escHtml(title)}</span>`
        }
        <div class="ai-hist-acts${isDel?' show':''}">
          <button class="ai-act-btn${meta.pinned?' on':''}" title="${meta.pinned?'Sabitlemeyi kaldır':'Sabitle'}" onclick="togglePinAiSession('${escAttr(id)}',event)">★</button>
          <button class="ai-act-btn" title="Yeniden adlandır" onclick="startRenameAiSession('${escAttr(id)}',event)">✎</button>
          <button class="ai-act-btn" title="Yeni sekmede aç" onclick="event.stopPropagation();switchAiSession('${escAttr(id)}',{newTab:true})">↗</button>
          <button class="ai-act-btn ai-hist-del${isDel?' confirm':''}" title="${isDel?'Kalıcı silmek için tekrar tıkla':'Sohbeti kalıcı sil'}" onclick="deleteAiSession('${escAttr(id)}',event)">${isDel?'Sil?':'✕'}</button>
        </div>
      </div>
      <div class="ai-hist-meta">${stateHtml}</div>
    </div>`;
  };
  if(!filtered.length){
    list.innerHTML=`<div class="ai-drawer-empty">${q?'Eşleşen sohbet yok.':'Kayıtlı sohbet yok.<br>Yazdığında otomatik kaydedilir.'}</div>`;
    return;
  }
  let html='';
  if(pinned.length){
    html+=`<div class="ai-hist-sec">Sabitlenenler</div>`+pinned.map(renderItem).join('');
  }
  if(recent.length){
    if(pinned.length) html+=`<div class="ai-hist-sec">Son Sohbetler</div>`;
    html+=recent.map(renderItem).join('');
  }
  list.innerHTML=html;
  list.querySelectorAll('.ai-hist-item').forEach(el=>{
    const sid=el.dataset.sid;
    el.onclick=e=>{
      if(e.target.closest('.ai-hist-acts')||e.target.closest('.ai-rename-in')) return;
      switchAiSession(sid,{newTab:e.ctrlKey||e.metaKey});
    };
    el.onauxclick=e=>{
      if(e.button===1){ e.preventDefault(); switchAiSession(sid,{newTab:true}); }
    };
    el.ondblclick=e=>{
      if(e.target.closest('.ai-hist-acts')||e.target.closest('.ai-rename-in')) return;
      startRenameAiSession(sid,e);
    };
  });
}
function renderAiDrawer(){ renderSessions(); }
const MSG_ICONS={
  copy:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  edit:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  retry:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  note:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/></svg>',
  pin:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/></svg>',
  speak:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  print:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>'
};
function flashMsgBtn(btn){
  if(!btn) return;
  const old=btn.innerHTML;
  btn.innerHTML=MSG_ICONS.check;
  btn.classList.add('ok');
  setTimeout(()=>{ if(btn.isConnected){ btn.innerHTML=old; btn.classList.remove('ok'); } },1400);
}
function extractMsgCleanHtml(m){
  const d=document.createElement('div');
  d.innerHTML=m&&m.h?m.h:'';
  d.querySelectorAll('.route,.ctool,.cdrag,.emb-x,.msg-act,.sc-act').forEach(el=>el.remove());
  return d;
}
function extractMsgText(sessId,idx){
  const s=ai[sessId], m=s&&s.msgs&&s.msgs[idx];
  if(!m) return '';
  if(typeof m.raw==='string'&&m.raw.trim()) return m.raw.trim();
  const d=extractMsgCleanHtml(m);
  return (d.innerText||d.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
}
function copyTextSafe(txt){
  if(!txt) return Promise.reject();
  if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
  const ta=document.createElement('textarea');
  ta.value=txt; ta.style.cssText='position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); } finally{ ta.remove(); }
  return Promise.resolve();
}
function copyChatMsg(sessId,idx,btn){
  const txt=extractMsgText(sessId,idx);
  if(!txt){ toast('Kopyalanacak metin bulunamadı'); return; }
  copyTextSafe(txt).then(()=>flashMsgBtn(btn)).catch(()=>toast('Kopyalama başarısız'));
}
function activeInputForSession(sessId){
  if(isStudySessId(sessId)) return $('#scIn');
  if(sessId==='side_ai') return $('#chatIn');
  return $('#aiInput');
}
function editChatMsg(sessId,idx){
  const txt=extractMsgText(sessId,idx);
  const inp=activeInputForSession(sessId);
  if(!inp){ toast('Giriş kutusu bulunamadı'); return; }
  inp.value=txt;
  autoGrow(inp);
  syncGemBoxState(inp);
  inp.focus();
  inp.setSelectionRange(inp.value.length,inp.value.length);
}
function resendChatMsg(sessId,idx){
  const txt=extractMsgText(sessId,idx);
  if(!txt) return;
  aiSend(sessId,txt);
}
function regenChatMsg(sessId,idx){
  const s=ai[sessId]; if(!s) return;
  if(s.running||s.pending){ toast('Bu oturum şu an çalışıyor'); return; }
  for(let j=idx-1;j>=0;j--){
    if(s.msgs[j]&&s.msgs[j].w==='me'){
      const pTxt=extractMsgText(sessId,j);
      if(pTxt){ aiSend(sessId,pTxt,null,false,false,[],{skipUserMsg:true}); return; }
    }
  }
  if(s.lastReq) retryLastAi(sessId,false);
  else toast('Yeniden üretilecek önceki istem bulunamadı');
}
async function appendMarkdownToNoteId(noteId,raw,btn,openAfter=false){
  if(!noteId||!String(noteId).startsWith('note:')||!raw) return;
  const rel=noteId.slice(5);
  try{
    let n=noteCache[noteId];
    if(!n) n=await api('/api/note?rel='+encodeURIComponent(rel));
    noteCache[noteId]=await api('/api/note',{rel,content:(n.content||'').replace(/\s*$/,'')+'\n\n---\n\n'+raw+'\n'});
    invalidateNoteDomCache(noteId);
    if(active===noteId) renderMain();
    else if(openAfter) openPage(noteId);
    if(btn) flashMsgBtn(btn);
    toast('💾 Yanıt nota eklendi ve kaydedildi',noteId);
  }catch(e){ toast('⚠ Nota eklenemedi: '+e.message); }
}
let _pendingAppendPayload=null;
function openAppendToNotePicker(raw,btn){
  if(!raw) return;
  _pendingAppendPayload={raw,btn};
  const box=$('#kasaModalBox');
  if(!box){ toast('📝 Önce bir not aç'); return; }
  const openNoteIds=new Set(openTabs.filter(t=>String(t).startsWith('note:')));
  const allNotes=Object.keys(pages).filter(id=>id.startsWith('note:')).map(id=>{
    const p=pages[id]||{};
    const rel=id.slice(5);
    return {id,title:p.t||rel.split('/').pop(),folder:p.folder||p.kasa||rel.split('/')[0]||'',open:openNoteIds.has(id)};
  }).sort((a,b)=>(b.open-a.open)||a.title.localeCompare(b.title,'tr'));
  const targets=flattenFolderTargets();
  const defTarget=defaultTargetInScope()||(targets[0]?targets[0].rel:'');
  const opts=targets.length
    ? targets.map(t=>`<option value="${t.rel}" ${t.rel===defTarget?'selected':''}>${'  '.repeat(t.depth)}${t.depth?'└─ 📁 ':'❖ '}${escHtml(t.label)}</option>`).join('')
    : kasalarData.map(k=>`<option value="${k.key}">${k.icon} ${escHtml(k.title)}</option>`).join('');
  const suggestTitle=(raw.replace(/^#+\s*/,'').split('\n').find(l=>l.trim())||'AI Notu').replace(/[*_`>#]/g,'').trim().slice(0,56);

  box.innerHTML=`
    <h3>📝 Yanıtı Nota Ekle</h3>
    <div style="display:flex;gap:6px;margin-bottom:4px">
      <button type="button" class="btn" id="apTabPick" style="flex:1;padding:6px 10px" onclick="switchAppendTab('pick')">📄 Mevcut Nota Ekle</button>
      <button type="button" class="hb" id="apTabNew" style="flex:1;padding:6px 10px" onclick="switchAppendTab('new')">＋ Yeni Not Oluştur</button>
    </div>
    <div id="apPanePick">
      <input id="apSearch" placeholder="Not veya kasa ara…" oninput="filterAppendNotes(this.value)" style="margin-bottom:6px">
      <div id="apList" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:2px"></div>
      <label style="display:flex;flex-direction:row;align-items:center;gap:7px;margin-top:8px;font-size:12px;cursor:pointer">
        <input type="checkbox" id="apOpenAfter" style="width:auto"> Ekledikten sonra notu aç
      </label>
    </div>
    <div id="apPaneNew" style="display:none">
      <label>Hedef Kasa / Klasör
        <select id="apKasa">${opts}</select>
      </label>
      <label>Yeni Not Başlığı
        <input id="apNewTitle" value="${escAttr(suggestTitle)}" placeholder="Not başlığı…">
      </label>
      <label style="display:flex;flex-direction:row;align-items:center;gap:7px;margin-top:4px;font-size:12px;cursor:pointer">
        <input type="checkbox" id="apNewOpenAfter" checked style="width:auto"> Oluşturduktan sonra notu aç
      </label>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button type="button" class="hb" onclick="closeKasaModal()">İptal</button>
        <button type="button" class="btn" style="padding:7px 14px" onclick="submitAppendNewNote()">Oluştur ve Ekle</button>
      </div>
    </div>`;
  window._apAllNotes=allNotes;
  filterAppendNotes('');
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(()=>{ if($('#apPaneNew')&&$('#apPaneNew').style.display!=='none') submitAppendNewNote(); });
  setTimeout(()=>$('#apSearch')?.focus(),40);
}
function switchAppendTab(mode){
  const isPick=mode==='pick';
  $('#apPanePick').style.display=isPick?'':'none';
  $('#apPaneNew').style.display=isPick?'none':'';
  $('#apTabPick').className=isPick?'btn':'hb';
  $('#apTabNew').className=isPick?'hb':'btn';
  if(!isPick) setTimeout(()=>$('#apNewTitle')?.focus(),40);
}
function filterAppendNotes(q){
  const list=$('#apList'); if(!list) return;
  const s=(q||'').trim().toLowerCase();
  const rows=(window._apAllNotes||[]).filter(n=>!s||n.title.toLowerCase().includes(s)||n.folder.toLowerCase().includes(s));
  if(!rows.length){
    list.innerHTML=`<div style="padding:14px;text-align:center;color:var(--mut);font-size:12px">Eşleşen not bulunamadı — "＋ Yeni Not Oluştur" sekmesini kullanabilirsin.</div>`;
    return;
  }
  list.innerHTML=rows.slice(0,60).map(n=>`
    <button type="button" class="hb" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;text-align:left" onclick="pickAppendNote('${escAttr(n.id)}')">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.open?'⭐ ':'📄 '}${escHtml(n.title)}</span>
      <span style="font:10.5px var(--mono);color:var(--mut);flex-shrink:0">${escHtml(n.folder)}</span>
    </button>`).join('');
}
async function pickAppendNote(noteId){
  const payload=_pendingAppendPayload; _pendingAppendPayload=null;
  const openAfter=!!$('#apOpenAfter')?.checked;
  closeKasaModal();
  if(!payload) return;
  await appendMarkdownToNoteId(noteId,payload.raw,payload.btn,openAfter);
}
async function submitAppendNewNote(){
  const payload=_pendingAppendPayload;
  const target=$('#apKasa')?.value;
  const title=($('#apNewTitle')?.value||'').trim();
  const openAfter=!!$('#apNewOpenAfter')?.checked;
  if(!title){ $('#apNewTitle')?.focus(); return; }
  _pendingAppendPayload=null;
  closeKasaModal();
  if(!payload) return;
  try{
    const res=await api('/api/note/create',{kasa:target,title,content:payload.raw+'\n'});
    await loadVault();
    if(openAfter){ unlockedNotes.add(res.id); openPage(res.id); }
    if(payload.btn) flashMsgBtn(payload.btn);
    toast(`📝 "${title}" oluşturuldu ve yanıt eklendi`,res.id);
  }catch(e){ toast('⚠ Not oluşturulamadı: '+e.message); }
}
async function appendChatMsgToNote(sessId,idx,btn){
  const raw=extractMsgText(sessId,idx);
  if(!raw) return;
  if(!String(active).startsWith('note:')){
    openAppendToNotePicker(raw,btn);
    return;
  }
  await appendMarkdownToNoteId(active,raw,btn,false);
}
function saveChatMsgToStudio(sessId,idx,btn){
  const s=ai[sessId], m=s&&s.msgs&&s.msgs[idx];
  if(!m) return;
  const d=extractMsgCleanHtml(m);
  const txt=extractMsgText(sessId,idx);
  studioAdd((txt.split('\n')[0]||txt).slice(0,48)||'Not',txt,d.innerHTML);
  flashMsgBtn(btn);
  toast('📌 Studio notlarına kaydedildi');
}
let _speakingBtn=null;
function speakChatMsg(sessId,idx,btn){
  if(!('speechSynthesis' in window)){ toast('Sesli okuma bu tarayıcıda desteklenmiyor'); return; }
  const wasOn=btn&&btn.classList.contains('on');
  window.speechSynthesis.cancel();
  if(_speakingBtn){ _speakingBtn.classList.remove('on'); _speakingBtn=null; }
  if(wasOn) return;
  const raw=extractMsgText(sessId,idx).replace(/```[\s\S]*?```/g,' kod bloğu ').replace(/[#*`>_~]/g,' ').trim();
  if(!raw) return;
  const u=new SpeechSynthesisUtterance(raw);
  u.lang='tr-TR';
  u.onend=u.onerror=()=>{ if(_speakingBtn){ _speakingBtn.classList.remove('on'); _speakingBtn=null; } };
  if(btn){ btn.classList.add('on'); _speakingBtn=btn; }
  window.speechSynthesis.speak(u);
}
function printChatMsg(sessId,idx){
  const s=ai[sessId], m=s&&s.msgs&&s.msgs[idx];
  if(!m) return;
  const d=extractMsgCleanHtml(m);
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc=frame.contentDocument||frame.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>AgyDesk Çıktısı</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>@page{size:A4 portrait;margin:14mm}body{font:11pt/1.55 'Instrument Sans',system-ui,sans-serif;color:#111;background:#fff;margin:0}h1,h2,h3{margin:12px 0 6px;break-after:avoid}pre{background:#f5f5f5;border:1px solid #ddd;padding:10px;border-radius:6px;white-space:pre-wrap;font:9.5pt/1.45 Consolas,monospace}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f2f2f2}blockquote{border-left:3px solid #888;margin:8px 0;padding:4px 10px;color:#333}</style>
</head><body>${d.innerHTML}</body></html>`);
  doc.close();
  setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); } finally{ setTimeout(()=>frame.remove(),1500); } },250);
}
function renderMsgRowHtml(sessId,x,i,isStudy){
  const sid=escAttr(sessId);
  const clsMe=isStudy?'sc-msg me':'msg me';
  const clsAi=isStudy?'sc-msg a':'msg';
  const rowBase=isStudy?'msg-row sc-row':'msg-row';
  if(x.ap||x.authCard) return `<div class="${rowBase} a"><div class="${clsAi}">${x.h}</div></div>`;
  if(x.w==='me'){
    return `<div class="${rowBase} me" data-sess="${sid}" data-idx="${i}"><div class="${clsMe}">${x.h}</div><div class="msg-act"><button type="button" class="mact" onclick="copyChatMsg('${sid}',${i},this)" title="İstem metnini kopyala">${MSG_ICONS.copy}</button><button type="button" class="mact" onclick="editChatMsg('${sid}',${i})" title="Düzenlemek için kutuya al">${MSG_ICONS.edit}</button><button type="button" class="mact" onclick="resendChatMsg('${sid}',${i})" title="Bu istemi tekrar gönder">${MSG_ICONS.retry}</button></div></div>`;
  }
  return `<div class="${rowBase} a" data-sess="${sid}" data-idx="${i}"><div class="${clsAi}">${x.h}</div><div class="msg-act"><button type="button" class="mact" onclick="copyChatMsg('${sid}',${i},this)" title="Yanıtı kopyala">${MSG_ICONS.copy}</button><button type="button" class="mact" onclick="regenChatMsg('${sid}',${i})" title="Yanıtı yeniden üret">${MSG_ICONS.retry}</button><button type="button" class="mact" onclick="appendChatMsgToNote('${sid}',${i},this)" title="Açık olan nota ekle">${MSG_ICONS.note}</button><button type="button" class="mact" onclick="saveChatMsgToStudio('${sid}',${i},this)" title="Studio notlarına sabitle">${MSG_ICONS.pin}</button><button type="button" class="mact" onclick="speakChatMsg('${sid}',${i},this)" title="Sesli oku / durdur">${MSG_ICONS.speak}</button><button type="button" class="mact" onclick="printChatMsg('${sid}',${i})" title="A4 yazdır">${MSG_ICONS.print}</button></div></div>`;
}
function currentEffortLabel(){
  const found=EFFORTS.find(e=>e.id===curEffort);
  return found?found.label:'Low';
}
function currentModelPrefLabel(){
  const found=MODEL_PREFS.find(m=>m.id===curModelPref);
  return found?found.short:'Oto';
}
function syncUnifiedModelPills(){
  const effTxt=currentModelPrefLabel()+' · '+currentEffortLabel();
  $$('.gem-unified-pill').forEach(btn=>{
    const sid=btn.dataset.msess;
    const m=(ai[sid]&&ai[sid].mode)||'y';
    const eEl=btn.querySelector('.gem-u-eff');
    const mEl=btn.querySelector('.gem-u-mode');
    if(eEl) eEl.textContent=effTxt;
    if(mEl){
      mEl.textContent=(MODES[m]&&MODES[m].n)||'Akıllı';
      mEl.className='gem-u-mode mode-'+m;
    }
    btn.title=btn.dataset.showmode==='0'
      ? `Model & Düşünme Derinliği: ${effTxt}`
      : `Model: ${effTxt} · İzin: ${(MODES[m]&&MODES[m].d)||''} (Shift+Tab)`;
  });
}
function closeGemModelMenu(){
  const m=$('#gemModelMenu');
  if(m) m.remove();
}
function toggleGemModelMenu(btn,sid,showMode=true){
  const existing=$('#gemModelMenu');
  if(existing){
    const same=existing.dataset.sid===sid&&existing.dataset.sm===(showMode?'1':'0');
    existing.remove();
    if(same) return;
  }
  const curM=(ai[sid]&&ai[sid].mode)||'y';
  const menu=document.createElement('div');
  menu.id='gemModelMenu';
  menu.className='gem-model-menu';
  menu.dataset.sid=sid;
  menu.dataset.sm=showMode?'1':'0';
  menu.innerHTML=`
    <div class="gmm-sec">Model</div>
    ${MODEL_PREFS.map(mp=>`<button type="button" class="gmm-item${mp.id===curModelPref?' on':''}" onclick="setModelPref('${mp.id}');closeGemModelMenu()">
      <span class="gmm-main">${mp.label}</span>
      <span class="gmm-sub">${mp.tip}</span>
      <span class="gmm-chk">${mp.id===curModelPref?'✓':''}</span>
    </button>`).join('')}
    <div class="gmm-div"></div>
    <div class="gmm-sec">Düşünme Derinliği</div>
    ${EFFORTS.map(e=>`<button type="button" class="gmm-item${e.id===curEffort?' on':''}" onclick="setEffort('${e.id}');closeGemModelMenu()">
      <span class="gmm-main">${currentModelPrefLabel()} · ${e.label}</span>
      <span class="gmm-sub">${e.tip}</span>
      <span class="gmm-chk">${e.id===curEffort?'✓':''}</span>
    </button>`).join('')}
    ${showMode?`<div class="gmm-div"></div>
    <div class="gmm-sec">İzin Modu</div>
    ${Object.entries(MODES).map(([k,m])=>`<button type="button" class="gmm-item${k===curM?' on':''}" onclick="setMode2('${escAttr(sid)}','${k}');closeGemModelMenu()">
      <span class="gmm-main mode-${k}">${m.n}</span>
      <span class="gmm-sub">${m.d}</span>
      <span class="gmm-chk mode-${k}">${k===curM?'✓':''}</span>
    </button>`).join('')}`:''}
  `;
  document.body.appendChild(menu);
  const r=btn.getBoundingClientRect();
  const mw=menu.offsetWidth||256, mh=menu.offsetHeight||200;
  const left=Math.max(10,Math.min(window.innerWidth-mw-10,r.right-mw));
  const top=Math.max(10,r.top-mh-8);
  menu.style.left=left+'px';
  menu.style.top=top+'px';
  setTimeout(()=>{
    const onDoc=ev=>{
      if(!menu.isConnected){ document.removeEventListener('mousedown',onDoc); document.removeEventListener('keydown',onKey); return; }
      if(!menu.contains(ev.target)&&ev.target!==btn&&!btn.contains(ev.target)){ closeGemModelMenu(); document.removeEventListener('mousedown',onDoc); document.removeEventListener('keydown',onKey); }
    };
    const onKey=ev=>{
      if(ev.key==='Escape'){ closeGemModelMenu(); document.removeEventListener('mousedown',onDoc); document.removeEventListener('keydown',onKey); }
    };
    document.addEventListener('mousedown',onDoc);
    document.addEventListener('keydown',onKey);
  },0);
}
function gemComposerHtml(opts){
  const sid=escAttr(opts.sessId);
  const cls='gem-box'+(opts.compact?' exp gem-compact':'');
  const att=opts.attachId?`<div class="chat-att-bar gem-att-bar" id="${escAttr(opts.attachId)}"></div>`:'';
  const curM=(ai[opts.sessId]&&ai[opts.sessId].mode)||'y';
  const showMode=Boolean(opts.showMode);
  const effControl=`<button type="button" class="gem-eff-pill gem-unified-pill" data-msess="${sid}" data-showmode="${showMode?'1':'0'}" onclick="toggleGemModelMenu(this,'${sid}',${showMode})" title="${showMode?'Model, düşünme derinliği & İzin modu (Shift+Tab)':'Model & Düşünme Derinliği (Effort)'}"><span class="gem-u-eff">${currentModelPrefLabel()} · ${currentEffortLabel()}</span>${showMode?`<span class="gem-u-sep">·</span><span class="gem-u-mode mode-${curM}">${(MODES[curM]&&MODES[curM].n)||'Akıllı'}</span>`:''}<svg class="gem-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`;
  return `<div class="gem-wrap"><div class="${cls}" data-gem-sess="${sid}">
    ${att}
    <textarea id="${opts.inputId}" rows="1" placeholder="${escAttr(opts.placeholder||"AgyDesk'e sorun…")}"></textarea>
    <button class="gem-ic gem-plus" type="button" title="Ekle: Görsel, Skill veya Bağlam" onclick="toggleGemPlusMenu(this,'${sid}','${opts.inputId}')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <div class="gem-right">
      ${effControl}
      <button class="gem-ic gem-mic" type="button" title="Sesle yaz (Türkçe dikte)" onclick="toggleGemMic(this,'${opts.inputId}')"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4M8 21h8"/></svg></button>
      <button class="gem-send" id="${opts.sendId}" type="button" title="Gönder (Enter)"><svg class="ic-up" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg><svg class="ic-stop" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg></button>
    </div>
  </div>${opts.showDisclaimer?`<div class="gem-note">${opts.disclaimer||'AgyDesk yerel not ve kaynaklarla çalışır · Ctrl+V görsel · / komut'}</div>`:''}</div>`;
}
let _gemMeasureCtx=null;
function measureGemTextWidth(inputEl,text){
  if(!text) return 0;
  if(!_gemMeasureCtx){
    const c=document.createElement('canvas');
    _gemMeasureCtx=c.getContext('2d');
  }
  if(!_gemMeasureCtx) return text.length*8;
  const cs=getComputedStyle(inputEl);
  _gemMeasureCtx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return _gemMeasureCtx.measureText(text).width;
}
function syncGemBoxState(inputEl){
  if(!inputEl) return;
  const box=inputEl.closest('.gem-box'); if(!box) return;
  const sid=box.dataset.gemSess, s=ai[sid];
  const hasAtt=Boolean(s&&((s.attachments&&s.attachments.length)||(s.sources&&s.sources.length)));
  const val=inputEl.value||'';
  const hasVal=val.trim().length>0||hasAtt;
  const isCompact=box.classList.contains('gem-compact');
  const wasExp=box.classList.contains('exp');
  let isMulti=isCompact||hasAtt||val.includes('\n');
  if(!isMulti&&val.length>0){
    const plusEl=box.querySelector('.gem-plus');
    const rightEl=box.querySelector('.gem-right');
    const singleAvailW=wasExp
      ? Math.max(80,box.clientWidth-20-(plusEl?plusEl.offsetWidth:34)-(rightEl?rightEl.offsetWidth:180)-12-8)
      : Math.max(80,inputEl.clientWidth-8);
    const textW=measureGemTextWidth(inputEl,val);
    const threshold=wasExp?singleAvailW-36:singleAvailW-24;
    isMulti=textW>=threshold||(!wasExp&&inputEl.scrollHeight>42);
  }
  box.classList.toggle('has-val',hasVal);
  box.classList.toggle('exp',isMulti);
  if(wasExp!==isMulti) autoGrow(inputEl);
  const running=Boolean(s&&(s.running||s.pending));
  box.classList.toggle('is-running',running);
  const sendBtn=box.querySelector('.gem-send');
  if(sendBtn) sendBtn.title=running?'Durdur':'Gönder (Enter)';
}
function syncAllGemBoxes(){
  $$('.gem-box textarea').forEach(syncGemBoxState);
}
let _gemPlusMenu=null;
function closeGemPlusMenu(){
  if(_gemPlusMenu){ _gemPlusMenu.remove(); _gemPlusMenu=null; }
}
function toggleGemPlusMenu(btn,sessId,inputId){
  if(_gemPlusMenu){ closeGemPlusMenu(); return; }
  const menu=document.createElement('div');
  menu.className='gem-plus-menu';
  const hasNote=String(active).startsWith('note:');
  menu.innerHTML=`
    <button type="button" class="gem-pm-item" data-act="img">🖼 Görsel ekle</button>
    <button type="button" class="gem-pm-item" data-act="slash">⚡ Skill / komut ekle (/)</button>
    ${hasNote?'<button type="button" class="gem-pm-item" data-act="note">📄 Açık notu soruya bağla</button>':''}
    <div class="gem-pm-sep"></div>
    <button type="button" class="gem-pm-item" data-act="ozet">☰ Kaynakları özetle</button>
    <button type="button" class="gem-pm-item" data-act="fisle">▤ A4 sınav föyü üret</button>
  `;
  document.body.appendChild(menu);
  const r=btn.getBoundingClientRect();
  const mh=menu.offsetHeight||180, mw=menu.offsetWidth||210;
  menu.style.left=Math.max(8,Math.min(r.left,innerWidth-mw-8))+'px';
  menu.style.top=Math.max(8,r.top-mh-8)+'px';
  _gemPlusMenu=menu;
  menu.onclick=e=>{
    const it=e.target.closest('.gem-pm-item'); if(!it) return;
    const act=it.dataset.act, inp=$('#'+inputId);
    closeGemPlusMenu();
    if(act==='img'){ pickChatImages(sessId); return; }
    if(act==='slash'&&inp){ inp.value=(inp.value?inp.value+' ':'')+'/'; autoGrow(inp); syncGemBoxState(inp); inp.focus(); inp.setSelectionRange(inp.value.length,inp.value.length); syncAiSlash(inp); return; }
    if(act==='note'&&inp&&hasNote){ const t=(noteCache[active]&&noteCache[active].title)||active.slice(5); inp.value=`"${t}" notuma göre: `+(inp.value||''); autoGrow(inp); syncGemBoxState(inp); inp.focus(); return; }
    if((act==='ozet'||act==='fisle')&&SK[act]){ aiSend(sessId,SK[act].prompt||('/'+act),act); }
  };
  setTimeout(()=>{
    const onDoc=ev=>{ if(!menu.contains(ev.target)&&ev.target!==btn){ closeGemPlusMenu(); document.removeEventListener('mousedown',onDoc); } };
    document.addEventListener('mousedown',onDoc);
  },0);
}
let _gemRec=null, _gemRecBtn=null;
function toggleGemMic(btn,inputId){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('🎙 Bu tarayıcı sesli dikteyi desteklemiyor'); return; }
  if(_gemRec){
    try{ _gemRec.stop(); }catch(e){}
    return;
  }
  const inp=$('#'+inputId); if(!inp) return;
  const rec=new SR();
  rec.lang='tr-TR'; rec.continuous=false; rec.interimResults=false;
  _gemRec=rec; _gemRecBtn=btn;
  btn.classList.add('recording');
  rec.onresult=e=>{
    const transcript=[...e.results].map(r=>r[0]&&r[0].transcript||'').join(' ').trim();
    if(transcript){
      inp.value=(inp.value?inp.value.trimEnd()+' ':'')+transcript;
      autoGrow(inp); syncGemBoxState(inp); inp.focus();
    }
  };
  rec.onerror=ev=>{ if(ev.error!=='aborted') toast('🎙 Mikrofon hatası: '+ev.error); };
  rec.onend=()=>{
    if(_gemRecBtn) _gemRecBtn.classList.remove('recording');
    _gemRec=null; _gemRecBtn=null;
  };
  try{ rec.start(); }catch(e){ btn.classList.remove('recording'); _gemRec=null; _gemRecBtn=null; }
}
function isEmptyAiWelcome(id){
  if(!id||isSideId(id)||!isAI(id)) return false;
  const s=ai[id];
  return Boolean(s&&!hasChatActivity(s)&&!s.running&&!s.pending);
}
function aiHeroHtml(){
  return `<div class="ai-hero">
    <div class="ai-hero-mark" aria-hidden="true">◆</div>
    <h1 class="ai-hero-title">Tekrar hoş geldin, Cavit</h1>
    <p class="ai-hero-sub">CLI çalışma alanı · Kaynak eklemek için sol panelden dosya sürükleyip bırak</p>
  </div>`;
}
function aiBody(id){
  const s=ai[id];
  if(isEmptyAiWelcome(id)) return aiHeroHtml();
  const live=(s.running&&s.streamText)?`<div class="msg-row a"><div class="msg a live-stream" data-sid="${escAttr(id)}">${escHtml(s.streamText)}</div></div>`:'';
  return (s.caveman?'<div class="mchip">🪨 caveman modu açık</div>':'')+s.msgs.map((x,i)=>renderMsgRowHtml(id,x,i,false)).join('')+live+
    (s.running?`<div class="run" data-run-sid="${escAttr(id)}"><span class="spin"></span> <span data-step-sid="${escAttr(id)}">${escHtml(s.step||'Çalışıyor…')}</span></div>`:'');
}
function updateChatStepInPlace(sid,stepText){
  const els=$$('[data-step-sid]').filter(el=>el.dataset.stepSid===sid);
  if(!els.length) return false;
  els.forEach(el=>{ el.textContent=stepText||'Çalışıyor…'; });
  return true;
}
function updateChatDeltaInPlace(sid,streamText){
  let liveEls=$$('.live-stream').filter(el=>el.dataset.sid===sid);
  if(!liveEls.length){
    const runEls=$$('[data-run-sid]').filter(el=>el.dataset.runSid===sid);
    if(!runEls.length) return false;
    runEls.forEach(runEl=>{
      if(runEl.closest('#scChat')){
        const d=document.createElement('div');
        d.className='sc-msg a live-stream';
        d.dataset.sid=sid;
        runEl.parentNode.insertBefore(d,runEl);
      }else{
        const row=document.createElement('div');
        row.className='msg-row a';
        const d=document.createElement('div');
        d.className='msg a live-stream';
        d.dataset.sid=sid;
        row.appendChild(d);
        runEl.parentNode.insertBefore(row,runEl);
      }
    });
    liveEls=$$('.live-stream').filter(el=>el.dataset.sid===sid);
  }
  if(!liveEls.length) return false;
  liveEls.forEach(el=>{
    const sc=el.closest('#aichat, #chat, #scChat');
    const atBottom=!sc||(sc.scrollHeight-sc.clientHeight-sc.scrollTop)<120;
    el.textContent=streamText;
    if(sc&&atBottom) sc.scrollTop=sc.scrollHeight;
  });
  return true;
}
function scrollChatToLastReply(c,s){
  if(!c||!s||!s._scrollToLastReply) return false;
  const rows=c.querySelectorAll('.msg-row.a');
  const last=rows.length?rows[rows.length-1]:null;
  s._scrollToLastReply=false;
  if(!last) return false;
  const cRect=c.getBoundingClientRect();
  const rRect=last.getBoundingClientRect();
  c.scrollTop=Math.max(0,c.scrollTop+(rRect.top-cRect.top)-10);
  return true;
}
function renderSideAi(){
  const c=$('#chat'), s=ai.side_ai;
  if(!c||!s) return;
  const prevLen=c.dataset.msgCount?+c.dataset.msgCount:-1;
  const prevScroll=c.scrollTop;
  const nearBottom=prevLen<0||(c.scrollHeight-c.clientHeight-c.scrollTop)<80;
  c.innerHTML=aiBody('side_ai');
  c.dataset.msgCount=String(s.msgs.length);
  let pinBottom=false;
  if(scrollChatToLastReply(c,s)){
    pinBottom=false;
  }else if(s.msgs.length!==prevLen||nearBottom){
    c.scrollTop=c.scrollHeight;
    pinBottom=true;
  }else{
    c.scrollTop=prevScroll;
  }
  const stBtn=$('#sideAiStop');
  if(stBtn) stBtn.style.display=(s.running||s.pending)?'inline-flex':'none';
  syncAllGemBoxes();
  runMermaid('#chat .mermaid',false,pinBottom?()=>{ if($('#chat')) $('#chat').scrollTop=$('#chat').scrollHeight; }:null);
  if(active==='studychat'&&$('#scChat')) renderStudyChatBody();
}
function clearSideAi(){
  api('/api/clear',{session:'side_ai'}).catch(()=>{});
  ai.side_ai.msgs=[{w:'a',h:'🧹 Sohbet bağlamı sıfırlandı. Seçili kaynaklarınla yeni bir soru sorabilirsin.'}];
  ai.side_ai.running=false; ai.side_ai.streamText=''; ai.side_ai.pending=null; ai.side_ai.attachments=[];
  renderChatAttachments('side_ai');
  renderSideAi();
}
function clearSrcAi(){
  const sid=getStudySessId();
  const s=ensureStudySession(sid);
  delete chatScrollMap['studychat:'+sid];
  api('/api/clear',{session:sid}).catch(()=>{});
  s.msgs=[{w:'a',h:'🧹 Sohbet bağlamı sıfırlandı. Seçili kaynaklarınla yeni bir soru sorabilirsin.'}];
  s.running=false; s.streamText=''; s.unread=false; s.pending=null; s.attachments=[];
  renderChatAttachments(sid);
  renderStudyChatBody();
  renderTabs();
}
function escAttr(v){
  return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const isChatImageFile=f=>f&&((f.type&&f.type.startsWith('image/'))||/\.(png|jpe?g|jfif|gif|webp|bmp|svg|avif)$/i.test(f.name||''));
function normalizedChatImgName(f){
  const raw=(f&&f.name)||'';
  if(/\.(png|jpe?g|jfif|gif|webp|bmp|svg|avif)$/i.test(raw)) return raw;
  const extMap={'image/jpeg':'.jpg','image/jpg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/bmp':'.bmp','image/svg+xml':'.svg','image/avif':'.avif'};
  const ext=extMap[(f&&f.type||'').toLowerCase()]||'.png';
  const base=raw.replace(/\.[^.]+$/,'')||'ekran_goruntusu';
  return base+ext;
}
let chatImgTarget=null;
function pickChatImages(sessionId){
  chatImgTarget=sessionId||'side_ai';
  const inp=$('#chatImgIn');
  if(inp){ inp.value=''; inp.click(); }
}
function handleChatImgSelect(files){
  const target=chatImgTarget||'side_ai';
  chatImgTarget=null;
  if(files&&files.length) attachChatImages(target,files);
}
const MAX_UPLOAD_BYTES=100*1024*1024;
async function uploadAssetFile(file,name,noteTarget){
  if(!file) throw new Error('Dosya seçilmedi');
  if(typeof file.size==='number'){
    if(file.size===0) throw new Error('Seçilen dosya boş (0 bayt)');
    if(file.size>MAX_UPLOAD_BYTES) throw new Error('Dosya 100 MB sınırını aşıyor');
  }
  let buf;
  try{
    buf=await file.arrayBuffer();
  }catch(e){
    throw new Error('Dosya okunamadı (OneDrive çevrimiçi dosya veya erişim engeli olabilir)');
  }
  if(!buf||!buf.byteLength) throw new Error('Dosya içeriği boş');
  const url=`/api/upload?name=${encodeURIComponent(name)}&note=${encodeURIComponent(noteTarget||'')}`;
  let r;
  try{
    r=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':(file.type||'application/octet-stream')},
      body:buf
    });
  }catch(err){
    let alive=false;
    try{ const p=await fetch('/api/ping',{cache:'no-store'}); alive=p.ok; }catch(_){}
    if(!alive) throw new Error('AgyDesk yerel sunucusuna (127.0.0.1:8780) ulaşılamıyor — uygulamayı yeniden açın');
    throw new Error((err&&err.message)||'Ağ yükleme hatası');
  }
  if(!r.ok){
    let m=r.statusText||('HTTP '+r.status);
    try{
      const txt=await r.text();
      if(txt){
        try{ const j=JSON.parse(txt); m=j.detail||j.error||m; }
        catch(_){ m=txt.slice(0,220); }
      }
    }catch(_){}
    if(r.status===413) m='Dosya boyutu sunucu sınırını aşıyor (maks. 100 MB)';
    throw new Error(m);
  }
  return await r.json();
}
async function attachChatImages(sessionId,fileList){
  const s=ai[sessionId]; if(!s) return;
  if(!s.attachments) s.attachments=[];
  const imgs=[...(fileList||[])].filter(isChatImageFile);
  if(!imgs.length){ toast('Yalnızca görsel dosyaları (PNG, JPG, WebP, GIF) eklenebilir'); return; }
  const left=Math.max(0,8-s.attachments.length);
  if(!left){ toast('Tek mesajda en fazla 8 görsel gönderilebilir'); return; }
  if(imgs.length>left) toast('İlk '+left+' görsel eklendi (maksimum 8)');
  for(const f of imgs.slice(0,left)){
    try{
      const u=await uploadAssetFile(f,normalizedChatImgName(f),'.chat_images');
      s.attachments.push({rel:u.rel,name:u.name,url:'/api/raw/'+encodeURI(u.rel)});
    }catch(e){ toast('⚠ Görsel yüklenemedi: '+e.message); }
  }
  renderChatAttachments(sessionId);
}
function addChatSource(sessionId,item){
  const s=ai[sessionId]; if(!s||!item) return;
  if(!Array.isArray(s.sources)) s.sources=[];
  const addOne=(rel,label)=>{
    if(!rel) return false;
    if(s.sources.some(x=>x.rel===rel)) return false;
    s.sources.push({rel,label:label||rel.split('/').pop()});
    return true;
  };
  let added=0;
  if(item.kind==='file'&&item.rel){
    if(addOne(item.rel,item.label)) added=1;
  }else if((item.kind==='folder'||item.kind==='kasa')&&item.rel){
    const prefix=item.rel.replace(/\/+$/,'')+'/';
    const matches=Object.values(pages).filter(p=>p&&p.rel&&(p.rel===item.rel||p.rel.startsWith(prefix))).slice(0,25);
    matches.forEach(p=>{ if(addOne(p.rel,p.t||p.rel.split('/').pop())) added++; });
  }
  renderChatAttachments(sessionId);
  if(added>1) toast(`📎 ${added} kaynak sohbete eklendi`);
  else if(added===1) toast(`📎 "${item.label||item.rel.split('/').pop()}" sohbete eklendi`);
  else toast('Bu kaynak zaten sohbete bağlı');
}
function removeChatSource(sessionId,idx){
  const s=ai[sessionId]; if(!s||!Array.isArray(s.sources)) return;
  s.sources.splice(idx,1);
  renderChatAttachments(sessionId);
}
function removeChatAttachment(sessionId,idx){
  const s=ai[sessionId]; if(!s||!s.attachments) return;
  s.attachments.splice(idx,1);
  renderChatAttachments(sessionId);
}
function renderChatAttachments(sessionId){
  const s=ai[sessionId];
  const list=(s&&s.attachments)||[];
  const srcs=(s&&Array.isArray(s.sources))?s.sources:[];
  const imgHtml=list.map((im,i)=>{
    const sn=escAttr(im.name||'Görsel');
    const sr=escAttr(im.rel||'');
    const su=escAttr(im.url||('/api/raw/'+encodeURI(im.rel||'')));
    return `<div class="att-chip"><img src="${su}" alt="${sn}" title="Önizle: ${sn}" data-rel="${sr}" data-name="${sn}" onclick="openRightViewer(this.dataset.rel,this.dataset.name)" ondblclick="openDocInTab(this.dataset.rel,this.dataset.name)"><button class="att-x" type="button" data-sess="${escAttr(sessionId)}" onclick="removeChatAttachment(this.dataset.sess,${i})" title="Görseli kaldır">✕</button></div>`;
  }).join('');
  const srcHtml=srcs.map((sc,i)=>{
    const nm=escHtml(sc.label||sc.rel.split('/').pop());
    const sr=escAttr(sc.rel);
    const sn=escAttr(sc.label||sc.rel.split('/').pop());
    return `<div class="att-src-chip" title="Bağlı kaynak: ${sr} · Tıkla: Önizle"><span class="att-src-ic">📄</span><span class="att-src-nm" data-rel="${sr}" data-name="${sn}" onclick="openRightViewer(this.dataset.rel,this.dataset.name)">${nm}</span><button class="att-src-x" type="button" data-sess="${escAttr(sessionId)}" onclick="removeChatSource(this.dataset.sess,${i})" title="Kaynağı kaldır">✕</button></div>`;
  }).join('');
  const html=srcHtml+imgHtml;
  if(sessionId==='side_ai'){
    const a=$('#sideAttach'); if(a) a.innerHTML=html;
  }else if(isStudySessId(sessionId)){
    if(sessionId===getStudySessId()){ const b=$('#scAttach'); if(b) b.innerHTML=html; }
  }else if(active===sessionId){
    const c=$('#aiAttach'); if(c) c.innerHTML=html;
  }
  syncAllGemBoxes();
}
function wireChatDrop(el,getSessionId,onSkill){
  if(!el) return;
  const isTreeOk=ev=>(typeof isTreeDragging!=='undefined'&&isTreeDragging&&draggedTreeItem)||(ev.dataTransfer&&[...ev.dataTransfer.types].includes('application/x-agydesk-tree'));
  const isSkillOk=ev=>onSkill&&!hasFiles(ev)&&!isTreeOk(ev)&&ev.dataTransfer&&[...ev.dataTransfer.types].includes('text/plain');
  ['dragenter','dragover'].forEach(evName=>el.addEventListener(evName,ev=>{
    if(!hasFiles(ev)&&!isTreeOk(ev)&&!isSkillOk(ev)) return;
    ev.preventDefault();
    if(isTreeOk(ev)&&ev.dataTransfer) ev.dataTransfer.dropEffect='copy';
    el.classList.add('chat-hot');
    if(el.id==='aidrop') el.classList.add('hot');
  }));
  el.addEventListener('dragleave',ev=>{
    if(ev.target===el||!el.contains(ev.relatedTarget)){
      el.classList.remove('chat-hot','hot');
    }
  });
  el.addEventListener('drop',ev=>{
    el.classList.remove('chat-hot','hot');
    if(isTreeOk(ev)){
      ev.preventDefault(); ev.stopPropagation();
      let item=draggedTreeItem;
      if(!item&&ev.dataTransfer){
        try{ const raw=ev.dataTransfer.getData('application/x-agydesk-tree'); if(raw) item=JSON.parse(raw); }catch(e){}
      }
      if(item) addChatSource(getSessionId(),item);
      return;
    }
    if(hasFiles(ev)){
      ev.preventDefault(); ev.stopPropagation();
      const imgs=[...(ev.dataTransfer.files||[])].filter(isChatImageFile);
      if(imgs.length) attachChatImages(getSessionId(),imgs);
      else toast('Sohbete görsel veya sol panelden kasa dosyası bırakabilirsin');
      return;
    }
    if(isSkillOk(ev)){
      ev.preventDefault();
      onSkill(ev.dataTransfer.getData('text/plain'));
    }
  });
}
let _lastMermaidTheme='';
function runMermaid(sel,force=false,onDone=null){
  if(!window.mermaid)return;
  const els=$$(sel).filter(el=>el.offsetParent!==null);
  if(!els.length)return;
  const mTheme=(typeof curTheme!=='undefined'&&(curTheme==='eink'||curTheme==='sepia'||curTheme==='mono-light'))?'neutral':'dark';
  const todo=[];
  els.forEach(el=>{
    if(!el.dataset.msrc) el.dataset.msrc=el.textContent;
    if(force||(el.getAttribute('data-processed')&&el.dataset.mtheme&&el.dataset.mtheme!==mTheme)){
      el.removeAttribute('data-processed');
      el.textContent=el.dataset.msrc;
    }
    if(!el.getAttribute('data-processed')){
      el.dataset.mtheme=mTheme;
      todo.push(el);
    }
  });
  if(!todo.length)return;
  try{
    if(_lastMermaidTheme!==mTheme){
      mermaid.initialize({startOnLoad:false,theme:mTheme});
      _lastMermaidTheme=mTheme;
    }
    const p=mermaid.run({nodes:todo});
    if(p&&typeof p.then==='function'){
      p.then(()=>{ if(typeof onDone==='function') onDone(); }).catch(()=>{});
    }else if(typeof onDone==='function'){
      onDone();
    }
  }catch(e){}
}
function aiRefresh(id){
  if(isStudySessId(id)){ if(id===getStudySessId()) renderStudyChatBody(); renderTabs(); return; }
  if(id==='side_ai'){ renderSideAi(); renderTabs(); return; }
  if(active===id&&$('#aichat')){
    const mainEl=$('#aiMain');
    if(mainEl) mainEl.classList.toggle('ai-empty',isEmptyAiWelcome(id));
    const c=$('#aichat'), s=ai[id];
    const prevLen=c.dataset.msgCount?+c.dataset.msgCount:-1;
    const prevScroll=c.scrollTop;
    const nearBottom=prevLen<0||(c.scrollHeight-c.clientHeight-c.scrollTop)<80;
    c.firstChild.innerHTML=aiBody(id);
    c.dataset.msgCount=String(s.msgs.length);
    let pinBottom=false;
    if(scrollChatToLastReply(c,s)){
      pinBottom=false;
    }else if(s.msgs.length!==prevLen||nearBottom){
      c.scrollTop=c.scrollHeight;
      pinBottom=true;
    }else{
      c.scrollTop=prevScroll;
    }
    saveChatScroll(id);aiHead(id);
    runMermaid('#aichat .mermaid',false,pinBottom?()=>{ if(active===id&&$('#aichat')){ $('#aichat').scrollTop=$('#aichat').scrollHeight; saveChatScroll(id); } }:null);
  }
  syncAllGemBoxes();
  renderTabs(); renderSessions(); renderAiDrawer();
}
/* ---------- İzin modları ---------- */
const MODES={g:{n:'Onaylı',i:'🟢',d:'Her yazma/silme/komut için sorar'},y:{n:'Akıllı',i:'🟡',d:'Güvenli işleri sormadan yapar, riskli işte durur'},r:{n:'Tam otomatik',i:'🔴',d:'Hiçbir şey sormaz (agya)'}};
const RISKY=/\bsil|force|push|yazdır|gönder|drop|reset|rm -rf/i, WRITE=/yaz\b|oluştur|düzenle|kaydet|çalıştır|\bkod|pcb|refactor|patch|kur\b|ekle/i;
const WRITE_SK=['surgical-patch','safe-refactor','lean-build','pcb','replica-skill','fisle'];
function classify(text,skill){ if(RISKY.test(text))return 'risky'; if((skill&&WRITE_SK.includes(skill))||WRITE.test(text))return 'write'; return 'safe'; }
const api=async(url,body,method)=>{const r=await fetch(url,body||method?{method:method||'POST',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}:undefined);if(!r.ok){let m=r.statusText;try{m=(await r.json()).detail||m}catch(e){}throw new Error(m)}return r.json()};
function logAct(id,msg,kind){ api('/api/log',{session:id,msg,kind:kind||''}).catch(()=>{}); }
async function loadLog(){
  try{ const rows=await api('/api/log'); const l=$('#logList'); if(!l)return;
    l.innerHTML=rows.length?rows.map(e=>`<div class="lg ${e.kind}"><span>${new Date(e.ts*1000).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><div>${e.msg.replace(/</g,'&lt;')}<small>${ai[e.session]?ai[e.session].title:e.session}</small></div></div>`).join(''):'<div style="color:var(--mut);font-size:12.5px">Henüz etkinlik yok.</div>';
  }catch(e){}
}
const renderLog=loadLog;
const MODEL_PREFS=[
  {id:'auto',short:'Oto',label:'Otomatik (Akıllı)',tip:'AgyNote/Study: Hydrogen & Neon · AgyAI: tam yönlendirme'},
  {id:'gemini-neon',short:'Neon',label:'Gemini 4 Neon',tip:'Güçlü akıl yürütme ve analiz (Gemini kotası)'},
  {id:'gemini-hydrogen',short:'Hydrogen',label:'Gemini 4 Hydrogen',tip:'Hızlı ve ekonomik günlük model (Gemini kotası)'}
];
let curModelPref=localStorage.getItem('agydesk_model_pref')||'auto';
if(!MODEL_PREFS.some(m=>m.id===curModelPref)) curModelPref='auto';
function setModelPref(val){
  if(!MODEL_PREFS.some(m=>m.id===val)) return;
  curModelPref=val;
  localStorage.setItem('agydesk_model_pref',val);
  persistUiState({agydesk_model_pref:val});
  syncUnifiedModelPills();
}
const EFFORTS=[
  {id:'low',label:'Low',tip:'Hızlı yanıt (varsayılan)'},
  {id:'medium',label:'Medium',tip:'Dengeli hız ve analiz'},
  {id:'high',label:'High',tip:'Yüksek akıl yürütme'},
  {id:'xhigh',label:'XHigh',tip:'Maksimum derinlik (Hydrogen & Neon)'}
];
let curEffort=localStorage.getItem('agydesk_effort')||'low';
if(!EFFORTS.some(e=>e.id===curEffort)) curEffort='low';
function effortOptionsHtml(){
  return EFFORTS.map(e=>`<option value="${e.id}" title="${e.tip}"${e.id===curEffort?' selected':''}>Hydrogen · ${e.label}</option>`).join('');
}
function effortSelectHtml(){
  return `<select class="eff-sel" onchange="setEffort(this.value)" title="Model düşünme derinliği (Effort)">${effortOptionsHtml()}</select>`;
}
function syncEffortSelects(){
  $$('.eff-sel').forEach(el=>{
    if(!el.options.length) el.innerHTML=effortOptionsHtml();
    el.value=curEffort;
  });
  syncUnifiedModelPills();
}
function setEffort(val){
  if(!EFFORTS.some(e=>e.id===val)) return;
  curEffort=val;
  persistUiState({agydesk_effort:val});
  syncEffortSelects();
}
function setMode2(id,m){
  if(!ai[id]||!MODES[m]) return;
  ai[id].mode=m;
  logAct(id,`İzin modu → ${MODES[m].n}`,'m');
  syncUnifiedModelPills();
  aiHead(id);
  renderTabs();
}
function cycleMode(id){ const o=['g','y','r']; setMode2(id,o[(o.indexOf(ai[id].mode)+1)%3]); }
function aiHead(id){
  const h=$('#aihead'); if(!h)return; const s=ai[id]; if(!s) return;
  const savedCnt=getSortedAiSessions(false).length;
  const title=getAiSessionTitle(id);
  const leftOpen=!app.classList.contains('no-left');
  h.innerHTML=`<button class="hb ai-drawer-tog${leftOpen?' on':''}" id="aiDrawerTog" onclick="toggleAiDrawer()" title="Sol paneli (sohbetler & notlar) aç/kapat (Ctrl+B)">
     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path class="pane-fill" d="M5.5 4H9.5V20H5.5A2.5 2.5 0 0 1 3 17.5V6.5A2.5 2.5 0 0 1 5.5 4Z" fill="currentColor" stroke="none"/><rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="9.5" y1="4" x2="9.5" y2="20"/></svg>
     <span>Sohbetler</span>${savedCnt?`<span class="ai-cnt-pill" id="aiHeadCount">${savedCnt}</span>`:`<span class="ai-cnt-pill" id="aiHeadCount" style="display:none"></span>`}
   </button>
   <button class="ai-title-btn" onclick="if(app.classList.contains('no-left'))toggleAiDrawer();startRenameAiSession('${escAttr(id)}',event)" title="Sohbet başlığını düzenle">${escHtml(title)}</button>
   <span style="flex:1"></span>
   ${s.checkpoints?`<button class="hb" onclick="aiUndo('${id}')">↶ Geri al (${s.checkpoints})</button>`:''}
   ${(s.running||s.pending)?`<button class="hb stop" onclick="aiStop('${id}')">■ Dur</button>`:''}
   <button class="hb" onclick="newSession()" title="Yeni sohbet başlat">＋ Yeni</button>`;
}
async function aiUndo(id){ const s=ai[id]; if(!s.checkpoints)return;
  try{ const r=await api('/api/undo',{session:id}); s.checkpoints=0; s.msgs.push({w:'a',h:`↶ ${r.undone} checkpoint geri alındı. İzlenen dosyalar önceki duruma döndü.`}); }
  catch(e){ s.msgs.push({w:'a',h:'⚠ Geri alma başarısız: '+e.message}); }
  aiRefresh(id); }
async function aiStop(id){ const s=ai[id]; try{await api('/api/stop',{session:id});}catch(e){} s.pending=null; s.msgs=s.msgs.filter(m=>!m.ap&&!m.guardId); s.running=false; s.streamText=''; s.msgs.push({w:'a',h:'■ Durduruldu. Çalışan iş kesildi.'}); aiRefresh(id); }
function guardDecide(sessId,reqId,rootKey,allow){
  const s=ai[sessId];
  const cb=document.getElementById('galw-'+reqId);
  const remember=!!(allow&&cb&&cb.checked);
  if(s){ s.msgs=s.msgs.filter(m=>m.guardId!==reqId); aiRefresh(sessId); }
  api('/api/guard/decide',{id:reqId,session:sessId,allow,remember,root_key:rootKey}).catch(()=>{});
  const kind=rootKey==='shell'?'Terminal komutu':(rootKey==='browser'?'Chrome tarayıcı erişimi':'Klasör erişimi');
  logAct(sessId, allow?`✓ ${kind} onaylandı (${rootKey}${remember?' · oturum boyunca':''})`:`✗ ${kind} reddedildi (${rootKey})`, allow?'ok':'w');
}
function approve(id,yes){
  const s=ai[id],p=s.pending; if(!p)return;
  const alw=document.getElementById('alw-'+id); if(yes&&alw&&alw.checked){s.allow[p.risk]=true;}
  s.msgs=s.msgs.filter(m=>!m.ap); s.pending=null;
  if(yes){logAct(id,`✓ Onaylandı: ${p.text||'[Görsel]'}`,'ok'); aiSend(id,p.text,p.skill,true,true,p.images||[]);}
  else{s.msgs.push({w:'a',h:'✗ Reddedildi. İşlem yapılmadı.'}); logAct(id,`✗ Reddedildi: ${p.text||'[Görsel]'}`,'w'); aiRefresh(id);}
}
function getVisibleApprovalSession(){
  const candidates=[];
  if(active==='studychat') candidates.push(getStudySessId());
  else if(isAI(active)) candidates.push(active);
  if(!app.classList.contains('no-right')&&$('#rb-ai.on')) candidates.push('side_ai');
  for(const sid of candidates){
    const s=ai[sid];
    if(!s) continue;
    if(s.msgs&&s.msgs.some(m=>m.guardId)) return sid;
    if(s.pending) return sid;
  }
  return null;
}
function triggerActiveApproval(sessId,allow){
  const sid=sessId||getVisibleApprovalSession();
  const s=sid&&ai[sid]; if(!s) return false;
  for(let idx=(s.msgs||[]).length-1;idx>=0;idx--){
    const m=s.msgs[idx];
    if(m&&m.guardId){
      guardDecide(sid,m.guardId,m.guardRootKey||'',allow);
      return true;
    }
  }
  if(s.pending){
    approve(sid,allow);
    return true;
  }
  return false;
}
const chatDrafts={};
function renderAI(m){
  const s=ai[active]; if(!s) return; s.unread=false;
  const prevInp=$('#aiInput');
  if(prevInp&&prevInp.dataset&&prevInp.dataset.sessId&&prevInp.value) chatDrafts[prevInp.dataset.sessId]=prevInp.value;
  m.scrollTop=0;
  m.innerHTML=`<div class="aiwrap ai-shell">
    <div class="ai-main${isEmptyAiWelcome(active)?' ai-empty':''}" id="aiMain">
      <div class="aihead" id="aihead"></div>
      <div class="aichat" id="aichat"><div class="col">${aiBody(active)}</div></div>
      <div class="aiin" id="aidrop"><div class="col">
      ${gemComposerHtml({sessId:active,inputId:'aiInput',sendId:'aiSend',attachId:'aiAttach',placeholder:"AgyDesk'e sorun…",compact:false,showMode:true,showDisclaimer:true,disclaimer:'Sadece sol panelden sürüklediğin kaynaklar bağlanır · Ctrl+V görsel · / komut'})}</div></div>
    </div>
  </div>`;
  aiHead(active);
  renderSessions();
  const inp=$('#aiInput'),go=()=>{
    const cur=ai[active];
    if(cur&&(cur.running||cur.pending)){ aiStop(active); return; }
    const v=inp.value;
    if(!v.trim()&&!(cur&&cur.attachments&&cur.attachments.length))return;
    delete chatDrafts[active];
    inp.value='';autoGrow(inp);syncGemBoxState(inp);aiSend(active,v);
  };
  if(inp){ inp.dataset.sessId=active; if(chatDrafts[active]){ inp.value=chatDrafts[active]; autoGrow(inp); syncGemBoxState(inp); } }
  $('#aiSend').onclick=go; inp.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.stopPropagation();if(!inp.value.trim()&&triggerActiveApproval(active,true))return;go()}}; inp.oninput=()=>{chatDrafts[active]=inp.value;autoGrow(inp);syncGemBoxState(inp);}; wireAiSlash(inp); inp.focus();
  wireChatDrop($('#aidrop'),()=>active,k=>{if(SK[k])aiSend(active,SK[k].prompt||('Skill: '+SK[k].h),k);});
  wireChatDrop($('#aichat'),()=>active);
  renderChatAttachments(active);
  syncAllGemBoxes();
  const c=$('#aichat');
  const sessId=active;
  c.addEventListener('scroll',()=>saveChatScroll(sessId),{passive:true});
  const saved=chatScrollMap[sessId];
  if(scrollChatToLastReply(c,s)){
    saveChatScroll(sessId);
  }else if(saved&&!saved.atBottom){
    c.scrollTop=saved.top;
    requestAnimationFrame(()=>{ if(active===sessId&&$('#aichat')) $('#aichat').scrollTop=saved.top; });
  }else{
    c.scrollTop=c.scrollHeight;
  }
  renderSessions(); renderTabs(); runMermaid('#aichat .mermaid');
}
async function triggerAgyLogin(){
  try{
    const r=await api('/api/auth/login',{});
    lastHealthData.auth_running=true;
    renderHealthBar(lastHealthData);
    toast(r.status==='running'?'🔑 Giriş penceresi zaten açık, Chrome’u tamamla':'🔑 Chrome’da Google girişi başlatılıyor…');
  }catch(e){ toast('⚠ Giriş başlatılamadı: '+e.message); }
}
function retryLastAi(id,forceLocal){
  const s=ai[id]; if(!s||!s.lastReq) return;
  if(s.running||s.pending){ toast('Bu oturum şu an meşgul'); return; }
  s.msgs=s.msgs.filter(m=>!m.authCard);
  const req=s.lastReq;
  aiSend(id,req.text,req.skill,false,false,req.images||[],{skipUserMsg:true,force_provider:forceLocal?'local':null});
}
async function aiSend(id,text,skill,ok,resume,explicitImgs,extraOpts){
  const s=ai[id]; if(!s) return;
  const skipUser=Boolean(extraOpts&&extraOpts.skipUserMsg);
  const rawText=String(text||'').trim();
  if(!skill&&rawText.startsWith('/')){const k=rawText.slice(1).split(' ')[0]; if(SK[k])skill=k;}
  if(skill&&SK[skill]&&(SK[skill].kind==='cmd'||SK[skill].kind==='mode')){s.msgs.push({w:'me',h:'/'+skill});aiInstant(id,skill);return;}
  if(s.running||s.pending){s.msgs.push({w:'a',h:'Bu oturum meşgul veya onay bekliyor. Onayla ya da ■ Dur butonuna bas.'});aiRefresh(id);return;}
  const imgs=(ok||skipUser)?(explicitImgs||[]):[...(s.attachments||[])];
  if(!rawText&&!imgs.length) return;
  s.lastReq={text:rawText,skill:skill||null,images:imgs};
  if(!ok&&!skipUser){
    s.attachments=[];
    renderChatAttachments(id);
    const escTxt=rawText.replace(/</g,'&lt;').replace(/\n/g,'<br>');
    const imgHtml=imgs.length?`<div class="chat-imgs">${imgs.map(im=>{
      const sn=escAttr(im.name||'Görsel');
      const sr=escAttr(im.rel||'');
      const su=escAttr(im.url||('/api/raw/'+encodeURI(im.rel||'')));
      return `<img class="chat-img" src="${su}" alt="${sn}" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede aç" data-rel="${sr}" data-name="${sn}" onclick="openRightViewer(this.dataset.rel,this.dataset.name)" ondblclick="openDocInTab(this.dataset.rel,this.dataset.name)">`;
    }).join('')}</div>`:'';
    const msgHtml=imgHtml+(escTxt?`<div>${escTxt}</div>`:'');
    s.msgs.push({w:'me',h:msgHtml,raw:rawText});
    api('/api/chats',{session:id,w:'me',h:msgHtml}).catch(()=>{});
  }
  if(!isSideId(id)){
    const meta=aiMeta.items[id];
    if(!(meta&&meta.customTitle)&&(s.title==='Yeni Sohbet'||s.title.startsWith('AI Oturumu'))){
      s.title=deriveAiTitle(s);
    }
    touchAiMeta(id,{updatedAt:Math.floor(Date.now()/1000)});
  }
  const isAgyCli=!isSideId(id);
  const actNote=isAgyCli?null:(String(active).startsWith('note:')?active.slice(5):null);
  const reqSources=isAgyCli
    ? (Array.isArray(s.sources)?s.sources.map(x=>x.rel).filter(Boolean):[])
    : getCheckedSources();
  s._scrollToLastReply=false;
  s.running=true;
  s.streamText='';
  s.step='İstek gönderiliyor…';
  aiRefresh(id);
  let res;
  try{
    res=await api('/api/run',{
      session:id,
      text:rawText,
      images:imgs.map(im=>im.rel),
      skill:skill||null,
      mode:s.mode,
      effort:curEffort,
      allow:s.allow,
      approved:!!ok,
      sources:reqSources,
      active_note:actNote,
      force_provider:(extraOpts&&extraOpts.force_provider)||(curModelPref!=='auto'?curModelPref:null),
      win_id:WIN_ID
    });
  }catch(e){ s.running=false; s.msgs.push({w:'a',h:'⚠ Backend hatası: '+e.message}); aiRefresh(id); return; }
  if(res.status==='approval'){
    s.running=false;
    s.pending={text:rawText,skill,risk:res.risk,images:imgs};
    const why=res.risk==='risky'?'Riskli işlem (silme / dış gönderim / geri alınamaz)':'Dosya yazma / komut çalıştırma';
    s.msgs.push({w:'a',ap:true,h:`<div class="appr"><b>⚠ Onay gerekli</b><div>${why}:<br><code>${(rawText||'[Görsel analizi]').replace(/</g,'&lt;')}</code></div><label><input type="checkbox" id="alw-${id}"> Bu oturumda bu tür işlemlere hep izin ver</label><div class="ab"><button type="button" class="btn" data-appr-allow="1" onclick="approve('${id}',true)">İzin ver (Enter)</button><button type="button" class="hb" data-appr-deny="1" onclick="approve('${id}',false)">Reddet</button></div></div>`});
    aiRefresh(id); return;
  }
  s._scrollToLastReply=false;
  s.running=true; s.checkpoints=res.checkpoints; s.step='Yönlendiriliyor → '+res.route.label;
  if(!updateChatStepInPlace(id,s.step)) aiRefresh(id);
}
async function autoOpenTouchedFiles(touched){
  if(!Array.isArray(touched)||!touched.length) return;
  await loadVault();
  const f=touched[0];
  if(!f) return;
  if(f.in_vault&&f.rel){
    const noteId='note:'+f.rel;
    if(typeof removePdfSlot==='function'&&String(f.ext||'').toLowerCase()==='.pdf') removePdfSlot(noteId);
    if(curMode==='ai'){
      writeNoRight=false;
      layoutMode('write');
      rtab('ai');
    }
    openDocInTab(f.rel,f.name||f.rel.split('/').pop());
  }else if(f.path){
    if(typeof openRightViewer==='function') await openRightViewer(f.path,f.name);
  }
}
/* ---------- Sunucu olayları (SSE) ---------- */
function startEvents(){
  if(window._agyEs){ try{window._agyEs.close();}catch(_){} }
  const es=new EventSource('/api/events');
  window._agyEs=es;
  es.onmessage=e=>{
    const d=JSON.parse(e.data), s=ai[d.session];
    if(d.win_id&&d.win_id!==WIN_ID) return;
    if(d.event==='quota'){ if(d.quota)applyQuota(d.quota); }
    else if(d.event==='delta'&&s){
      s.streamText=(s.streamText||'')+(d.delta||'');
      if(!updateChatDeltaInPlace(d.session,s.streamText)) aiRefresh(d.session);
    }
    else if(d.event==='step'&&s){
      s.step=d.step;
      if(!updateChatStepInPlace(d.session,d.step)) aiRefresh(d.session);
    }
    else if(d.event==='guard_approval'&&s){
      s.msgs=s.msgs.filter(m=>m.guardId!==d.id);
      const isShell=d.root_key==='shell';
      const isBrowser=d.root_key==='browser';
      const actEsc=escHtml(d.action||(isShell?'Terminal Komutu':(isBrowser?'Chrome Tarayıcı Erişimi':'Erişim')));
      const lblEsc=escHtml(d.root_label||d.root_key||'Kişisel Klasör');
      const pathEsc=escHtml(d.path||'');
      const dstHtml=d.dst_path?` → <code>${escHtml(d.dst_path)}</code>`:'';
      const sidA=escAttr(d.session), idA=escAttr(d.id), rkA=escAttr(d.root_key||'');
      const titleHtml=isShell?`🔐 Terminal Komutu Onayı · AgyStudy`:(isBrowser?`🌐 Chrome Tarayıcı Erişim Onayı · Açık Pencere`:`🔐 Klasör Erişim Onayı · ${lblEsc}`);
      const rememberTxt=isShell?`Bu oturumda terminal komutlarına hep izin ver`:(isBrowser?`Bu oturumda Chrome tarayıcı erişimine hep izin ver`:`Bu oturumda "${lblEsc}" klasörüne hep izin ver`);
      s.msgs.push({w:'a',guardId:d.id,guardRootKey:d.root_key||'',h:`<div class="appr"><b>${titleHtml}</b><div>${actEsc}:<br><code>${pathEsc}</code>${dstHtml}</div><label><input type="checkbox" id="galw-${idA}"> ${rememberTxt}</label><div class="ab"><button type="button" class="btn" data-appr-allow="1" onclick="guardDecide('${sidA}','${idA}','${rkA}',true)">İzin ver (Enter)</button><button type="button" class="hb" data-appr-deny="1" onclick="guardDecide('${sidA}','${idA}','${rkA}',false)">Reddet</button></div></div>`});
      if(isStudySessId(d.session)&&active!=='studychat'){ toast(isShell?`🔐 AgyStudy terminal komutu onayı bekliyor`:(isBrowser?`🌐 AgyStudy Chrome erişim onayı bekliyor`:`🔐 AgyStudy erişim onayı bekliyor (${d.root_label||'Klasör'})`),'studychat'); }
      aiRefresh(d.session);
    }
    else if(d.event==='guard_approval_done'&&s){
      const before=s.msgs.length;
      s.msgs=s.msgs.filter(m=>m.guardId!==d.id);
      if(s.msgs.length!==before) aiRefresh(d.session);
    }
    else if(d.event==='done'&&s){
      const wasRunning=!!s.running;
      s.running=false; s.streamText=''; if(d.quota)applyQuota(d.quota);
      const prevMsg=s.msgs[s.msgs.length-1];
      if(prevMsg&&prevMsg.w==='a'&&prevMsg.raw===d.reply){ aiRefresh(d.session); return; }
      linkifyAndOpen(d.reply);
      const r=d.route, c=r.provider==='local'?'l':'c', safe=mdToHtml(d.reply);
      const effChip=d.effort?`<span class="chip">${d.effort}</span>`:'';
      const tok=d.tokens?`<span class="chip">${d.tokens} token</span>`:'';
      const badge=d.real?(r.provider==='local'?'':'<span class="chip c">agy CLI</span>'):'<span class="chip">Yerel</span>';
      const printBtn=`<button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="window.print()" title="Canon G3080 A4 Çift Yüz Renkli Yazdır">🖨 Yazdır</button>`;
      const h=`${safe}<div class="route"><span class="chip ${c}">${r.label}</span>${effChip}<span>${r.reason}</span>${badge}${tok}${printBtn}</div>`;
      s.msgs.push({w:'a',h,raw:d.reply});
      s._scrollToLastReply=true;
      if(isStudySessId(d.session)&&studioPendingTitle){ studioAdd(studioPendingTitle,d.reply,safe,getStudyKasaKey(d.session)); studioPendingTitle=null; }
      if(wasRunning) api('/api/chats',{session:d.session,w:'a',h}).catch(()=>{});
      if(!isSideId(d.session)&&isAI(d.session)) touchAiMeta(d.session,{updatedAt:Math.floor(Date.now()/1000),setLastActive:d.session===active});
      if(d.session==='side_ai' && $('#outs')){
        const outBox=document.createElement('div'); outBox.className='out';
        outBox.innerHTML=`<div class="oh"><span>◆ AI Çıktısı · ${r.label}</span><span><button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="appendReplyToNote(this)" data-md="${encodeURIComponent(d.reply)}">📝 Nota Ekle</button> <button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="window.print()">🖨 Canon A4 Yazdır</button></span></div><div class="ob">${safe}</div>`;
        $('#outs').appendChild(outBox);
        runMermaid('#outs .mermaid');
      }
      if(isStudySessId(d.session)&&active!=='studychat'){s.unread=true;toast(`✓ "${s.title}" tamamlandı`,'studychat');}
      else if(!isSideId(d.session)&&active!==d.session){s.unread=true;toast(`✓ "${s.title}" tamamlandı`,d.session);}
      aiRefresh(d.session);
      if(Array.isArray(d.touched_files)&&d.touched_files.length) autoOpenTouchedFiles(d.touched_files);
      else loadVault();
    }
    else if(d.event==='auth'){
      lastHealthData.auth_running=d.status==='pending';
      lastHealthData.auth_needed=d.status==='failed';
      renderHealthBar(lastHealthData);
      if(d.status==='ok'){ toast('✓ agy oturumu açıldı — soruyu tekrar gönderebilirsin'); }
      else if(d.status==='failed'){ toast('⚠ Oturum açılamadı: '+(d.error||'Zaman aşımı')); }
    }
    else if(d.event==='error'&&s){
      s.running=false; s.streamText=''; if(d.quota)applyQuota(d.quota);
      const errEsc=String(d.error).replace(/</g,'&lt;');
      if(d.code==='auth_required'){
        lastHealthData.auth_needed=true; renderHealthBar(lastHealthData);
        const sidAttr=escAttr(d.session);
        const locBtn=d.ollama_available?`<button class="hb" onclick="retryLastAi('${sidAttr}',true)">⚡ Yerel Ollama ile Yanıtla</button>`:'';
        s.msgs.push({w:'a',authCard:true,h:`<div class="appr"><b>🔑 Google / agy Oturumu Gerekli</b><div>Tarayıcıdaki oturum açma tamamlanmadı veya süresi doldu:<br><code>${errEsc}</code></div><div class="ab" style="margin-top:8px;flex-wrap:wrap"><button class="btn" onclick="triggerAgyLogin()">🔑 Chrome'da Oturum Aç</button><button class="hb" onclick="retryLastAi('${sidAttr}',false)">↻ Tekrar Gönder</button>${locBtn}</div></div>`});
      }else{
        s.msgs.push({w:'a',h:'⚠ Sağlayıcı hatası: '+errEsc});
      }
      aiRefresh(d.session);
    }
    else if(d.event==='log'){ loadLog(); }
  };
  let _sseRecoveryTimer=null;
  es.onerror=()=>{
    if(_sseRecoveryTimer) clearTimeout(_sseRecoveryTimer);
    _sseRecoveryTimer=setTimeout(()=>{ _sseRecoveryTimer=null; loadChats(); loadVault(); loadHealth(); }, 2500);
  };
}
async function appendReplyToNote(btn){
  const raw=decodeURIComponent(btn.dataset.md||'');
  if(!raw) return;
  if(!String(active).startsWith('note:')){
    openAppendToNotePicker(raw,btn);
    return;
  }
  await appendMarkdownToNoteId(active,raw,btn,false);
}
async function loadChats(){
  try{
    const all=await api('/api/chats');
    let changed=false;
    let activeChanged=false;
    const nowSec=Math.floor(Date.now()/1000);
    const entries=Object.entries(all);
    entries.forEach(([sid,msgs],idx)=>{
      if(!ai[sid]){
        if(isStudySessId(sid)){ ensureStudySession(sid); changed=true; }
        else{ aiN++; ai[sid]={title:'Yeni Sohbet',msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]}; changed=true; }
      }
      if(ai[sid].running||ai[sid].pending) return;
      if(msgs&&msgs.length){
        const mapped=msgs.map(m=>({w:m.w,h:(m.w==='a'&&m.h&&!String(m.h).trim().startsWith('<'))?mdToHtml(m.h):m.h}));
        const cur=ai[sid].msgs||[];
        const sameLen=cur.length===mapped.length;
        const sameTail=sameLen&&(cur.length===0||(cur[cur.length-1].w===mapped[mapped.length-1].w&&cur[cur.length-1].h===mapped[mapped.length-1].h));
        if(!sameTail){
          ai[sid].msgs=mapped;
          changed=true;
          if(sid===active) activeChanged=true;
        }
        if(!isSideId(sid)){
          const meta=aiMeta.items[sid]||{};
          if(!meta.updatedAt){
            aiMeta.items[sid]={...meta,updatedAt:nowSec-(entries.length-idx)*60};
          }
          const nextTitle=getAiSessionTitle(sid);
          if(ai[sid].title!==nextTitle){ ai[sid].title=nextTitle; changed=true; }
        }
      }
    });
    if(ai.ai1&&!hasChatActivity(ai.ai1)&&!openTabs.includes('ai1')&&active!=='ai1'&&getSortedAiSessions(false).length){
      delete ai.ai1;
      changed=true;
    }
    if(!changed) return;
    renderSessions(); renderAiDrawer(); renderTabs(); renderSideAi();
    if(isAI(active)&&activeChanged){
      if($('#aichat')) aiRefresh(active);
      else renderMain();
    }else if(active==='studychat'&&$('#scChat')){
      renderStudyChatBody();
    }
  }catch(e){}
}
function toast(t,id){
  const d=document.createElement('div'); d.className='toast'; d.textContent=t; d.onclick=()=>{if(id)openPage(id);d.remove()};
  document.body.appendChild(d); setTimeout(()=>d.remove(),6000);
}

/* ---------- NotebookLM Tarzı Kasalar Ana Ekranı & Modallar ---------- */
function fmtRelTime(ts){
  if(!ts) return '';
  const now=new Date();
  const d=new Date(ts*1000);
  const diff=Math.max(0,Math.floor(now.getTime()/1000-ts));
  if(diff<60) return 'Az önce';
  if(diff<3600) return `${Math.floor(diff/60)} dk önce`;
  const hhmm=d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const targetStart=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
  const dayDiff=Math.round((todayStart-targetStart)/86400000);
  if(dayDiff===0) return `Bugün ${hhmm}`;
  if(dayDiff===1) return `Dün ${hhmm}`;
  return d.toLocaleDateString('tr-TR',{day:'numeric',month:'short'});
}
function renderToolsGridHtml(){
  return `<div class="ksect-hd" style="margin-top:34px">
      <h2>⚡ Mühendislik Araçları &amp; Çalışma İstasyonları</h2>
      <span class="ksect-sub">Anında geçiş</span>
    </div>
    <div class="ktools">
      <div class="ktool" onclick="openPage('trafo')">
        <div class="ic">⚡</div>
        <div><b>Trafo Lab Analizörü</b><small>Boşta &amp; kısa devre hesabı, canlı fazör</small></div>
      </div>
      <div class="ktool" onclick="openPage('sim')">
        <div class="ic">∿</div>
        <div><b>RC Filtre Simülatörü</b><small>Canlı Bode genlik eğrisi &amp; kesim frekansı</small></div>
      </div>
      <div class="ktool" onclick="setMode('plan')">
        <div class="ic">▦</div>
        <div><b>AgyCal</b><small>Akıllı takvim, doğal dil komutu &amp; sınav radarı</small></div>
      </div>
      <div class="ktool" onclick="setMode('ai')">
        <div class="ic">◆</div>
        <div><b>Tam Ekran AI İstasyonu</b><small>Çoklu oturum, agy CLI &amp; yerel modeller</small></div>
      </div>
    </div>`;
}
function renderRootDocsHtml(docs){
  if(!docs||!docs.length) return '';
  return `<div class="ksect-hd">
      <h2>📌 Ortak Kök Belgeler</h2>
      <span class="ksect-sub">${docs.length} dosya</span>
    </div>
    <div class="rdocs">
      ${docs.map(d=>{
        const badge=rootDocScopeBadge(d);
        const relJs=escHtml(d.rel).replace(/'/g,"\\'");
        return `<div class="rdoc-chip" oncontextmenu="openRootDocScopeMenu(event,'${relJs}')">
          <button type="button" class="rdoc" onclick="openPage('${escHtml(d.id)}')" title="${escHtml(d.rel)} · ${escHtml(badge.title)}">
            <span>${escHtml(d.icon||'📄')}</span>
            <span>${escHtml(d.title)}</span>
          </button>
          <button type="button" class="rdoc-sp-btn${badge.global?' global':''}" onclick="openRootDocScopeMenu(event,'${relJs}')" title="${escHtml(badge.title)} · Değiştirmek için tıkla">${escHtml(badge.text)}</button>
        </div>`;
      }).join('')}
    </div>`;
}
function renderKasaCardHtml(k,showSpaceBadge=false){
  const sp=showSpaceBadge?getSpaceObj(k.space):null;
  const counts=k.counts||{total:0,notes:0,docs:0,images:0};
  return `<div class="kcard" draggable="true" ondragstart="handleSpaceDragStart(event,'${k.key}')" ondragend="handleSpaceDragEnd(event)" style="--kacc:${escHtml(k.accent||'#e0a458')}" onclick="enterKasa('${k.key}','write')">
    <div class="kcard-top">
      <div class="kcard-ic">${escHtml(k.icon||'📘')}</div>
      <div class="kcard-head-actions">
        ${sp?`<span class="kcard-space-pill" title="Bağlı Çalışma Alanı">${escHtml(sp.icon)} ${escHtml(sp.title)}</span>`:''}
        <span class="kcard-tag">${escHtml(k.tag||'Çalışma Kasası')}</span>
        <button type="button" class="kcard-more" title="Kasa seçenekleri, düzenle veya taşı" onclick="event.stopPropagation();openKasaCardMenu(event,'${k.key}')">⋯</button>
      </div>
    </div>
    <div>
      <h3>${escHtml(k.title)}</h3>
      <div class="kcard-desc" style="margin-top:4px">${escHtml(k.desc||'')}</div>
    </div>
    <div class="kcard-previews">
      ${(k.previews||[]).slice(0,3).map(p=>`
        <div class="kprev" onclick="event.stopPropagation();currentKasa='${k.key}';${k.space?`currentSpace='${k.space}';`:''}rebuildTreeAndSources();openPage('${escHtml(p.id)}')" title="${escHtml(p.title)}">
          <span>${escHtml(p.icon||'📄')}</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(p.title)}</span>
        </div>
      `).join('')||'<div class="kprev" style="color:var(--mut)">Henüz not yok — tıklayıp ekle</div>'}
    </div>
    <div class="kcard-foot">
      <span><b>${counts.total} kaynak</b> (${counts.notes} not${counts.docs?`, ${counts.docs} belge`:''}${counts.images?`, ${counts.images} görsel`:''}) · ${fmtRelTime(k.mtime)}</span>
      <div class="kcard-acts" onclick="event.stopPropagation()">
        <button onclick="triggerAssetUpload('${k.key}')" title="Bu kasaya bilgisayardan belge veya fotoğraf yükle">📎 Ekle</button>
        <button onclick="openNewNoteModal('${k.key}')" title="Bu kasaya yeni not ekle">＋ Not</button>
        <button onclick="enterKasa('${k.key}','study')" title="NotebookLM Çalışma Modunda Aç">◈ Çalış</button>
      </div>
    </div>
  </div>`;
}
function renderKasaRowHtml(k,showSpaceBadge=false){
  const sp=showSpaceBadge?getSpaceObj(k.space):null;
  const counts=k.counts||{total:0,notes:0,docs:0,images:0};
  return `<div class="krow" draggable="true" ondragstart="handleSpaceDragStart(event,'${k.key}')" ondragend="handleSpaceDragEnd(event)" style="--kacc:${escHtml(k.accent||'#e0a458')}" onclick="enterKasa('${k.key}','write')">
    <div class="krow-ico">${escHtml(k.icon||'📘')}</div>
    <div class="krow-main">
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <span class="krow-title">${escHtml(k.title)}</span>
        ${sp?`<span class="kcard-space-pill">${escHtml(sp.icon)} ${escHtml(sp.title)}</span>`:''}
        <span class="kcard-tag">${escHtml(k.tag||'Kasa')}</span>
      </div>
      <div class="krow-sub">${escHtml(k.desc||'')}</div>
    </div>
    <div class="krow-stats">
      <span>${counts.notes} not · ${counts.docs+counts.images} dosya</span>
      <span>${fmtRelTime(k.mtime)}</span>
    </div>
    <div class="kcard-acts" onclick="event.stopPropagation()">
      <button onclick="openNewNoteModal('${k.key}')" title="Yeni not ekle">＋ Not</button>
      <button onclick="enterKasa('${k.key}','study')" title="Çalışma Modunda Aç">◈ Çalış</button>
      <button class="kcard-more" onclick="openKasaCardMenu(event,'${k.key}')" title="Seçenekler">⋯</button>
    </div>
  </div>`;
}
function renderKasalarBody(bodyEl){
  if(!bodyEl) return;
  const rawQ=kasaSearchQ.trim();
  const q=rawQ.toLowerCase();
  const activeSpaceObj=currentSpace!=='all'?getSpaceObj(currentSpace):null;

  if(q){
    const kMatches=kasalarData.filter(k=>{
      if(activeSpaceObj&&k.space!==activeSpaceObj.id) return false;
      return k.title.toLowerCase().includes(q)
        ||(k.desc||'').toLowerCase().includes(q)
        ||(k.tag||'').toLowerCase().includes(q)
        ||(k.previews||[]).some(p=>p.title.toLowerCase().includes(q));
    });
    const otherMatches=activeSpaceObj?kasalarData.filter(k=>k.space!==activeSpaceObj.id&&(
      k.title.toLowerCase().includes(q)||(k.desc||'').toLowerCase().includes(q)||(k.tag||'').toLowerCase().includes(q)||(k.previews||[]).some(p=>p.title.toLowerCase().includes(q))
    )):[];
    const pageHits=Object.entries(pages)
      .filter(([id,p])=>id.startsWith('note:')&&p&&(!activeSpaceObj||(!p.kasa?rootDocMatchesSpace(p,activeSpaceObj.id):p.space===activeSpaceObj.id))&&((p.t||'').toLowerCase().includes(q)||(p.rel||'').toLowerCase().includes(q)))
      .slice(0,10);

    bodyEl.innerHTML=`
      <div class="ksrch-summary">
        <span><span style="color:var(--cu)">🔎</span> "<b>${escHtml(rawQ)}</b>" için ${activeSpaceObj?`<b>${escHtml(activeSpaceObj.title)}</b> alanında`:'tüm alanlarda'} <b>${kMatches.length} kasa</b>, <b>${pageHits.length} doğrudan not/belge</b> bulundu.</span>
        ${activeSpaceObj?`<button type="button" class="hb" style="padding:4px 10px;font-size:12px" onclick="selectSpaceFilter('all')">Tüm Alanlarda Ara</button>`:''}
      </div>
      ${kMatches.length?`<div class="ksect-hd"><h2>❖ Eşleşen Kasalar</h2><span class="ksect-sub">${kMatches.length}</span></div>
        <div class="kgrid">${kMatches.map(k=>renderKasaCardHtml(k,true)).join('')}</div>`
      :`<div class="scard-empty" style="margin-bottom:24px"><span>Bu alanda "${escHtml(rawQ)}" ile eşleşen kasa yok.</span>${activeSpaceObj?`<button class="hb" onclick="selectSpaceFilter('all')">Tüm Alanlarda Ara</button>`:''}</div>`}
      ${pageHits.length?`<div class="ksect-hd"><h2>📄 Doğrudan Eşleşen Not &amp; Belgeler</h2><span class="ksect-sub">${pageHits.length}</span></div>
        <div class="rdocs">${pageHits.map(([id,p])=>`<button type="button" class="rdoc" onclick="${p.kasa?`currentKasa='${p.kasa}';${p.space?`currentSpace='${p.space}';`:''}rebuildTreeAndSources();`:''}openPage('${escHtml(id)}')"><span>${escHtml(p.i||'📄')}</span><span>${escHtml(p.t||id)}</span><span class="rdoc-sp">${escHtml(p.folder||'Ortak')}</span></button>`).join('')}</div>`:''}
      ${otherMatches.length?`<div class="ksect-hd"><h2>🗂 Diğer Alanlardaki Eşleşmeler</h2><span class="ksect-sub">${otherMatches.length}</span></div>
        <div class="kgrid">${otherMatches.map(k=>renderKasaCardHtml(k,true)).join('')}</div>`:''}
    `;
    return;
  }

  if(!activeSpaceObj){
    const globalRoots=rootDocsData.filter(d=>isRootDocGlobal(d));
    bodyEl.innerHTML=`
      <div class="ksect-hd">
        <h2>🗂 Çalışma Alanların (${spacesData.length})</h2>
        <span class="kdrag-hint">Alan kartına tıkla → içindeki kasaları gör</span>
      </div>
      <div class="sgrid">
        ${spacesData.map(sp=>{
          const spKasas=kasalarData.filter(k=>k.space===sp.id);
          const spScopedRoots=rootDocsData.filter(d=>rootDocOnlyInSpace(d,sp.id));
          const sc=sp.counts||{total:0,notes:0,docs:0,images:0};
          const chipsHtml=spKasas.length
            ? spKasas.slice(0,5).map(k=>`
                <button type="button" class="skchip" style="--kchip-acc:${escHtml(k.accent||sp.accent||'#e0a458')}" onclick="event.stopPropagation();enterKasa('${k.key}','write')" title="${escHtml(k.title)} (${k.counts?k.counts.total:0} kaynak)">
                  <span>${escHtml(k.icon||'📘')}</span>
                  <span>${escHtml(k.title)}</span>
                </button>
              `).join('') + (spKasas.length>5?`<span class="skchip-more">+${spKasas.length-5} kasa daha</span>`:'')
            : `<div class="scard-empty"><span>Henüz kasa eklenmemiş</span><button type="button" class="hb" style="padding:3px 9px;font-size:11px" onclick="event.stopPropagation();openNewKasaModal('${escHtml(sp.id)}')">＋ Kasa Ekle</button></div>`;
          return `<div class="scard" style="--sp-acc:${escHtml(sp.accent||'#e0a458')}" onclick="enterSpace('${escHtml(sp.id)}')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'${escHtml(sp.id)}')">
            <div class="scard-top">
              <div class="scard-id">
                <div class="scard-ico">${escHtml(sp.icon||'🗂')}</div>
                <div class="scard-titles">
                  <div class="scard-tag">${escHtml(sp.tag||'Çalışma Alanı')}</div>
                  <div class="scard-title">${escHtml(sp.title)}</div>
                </div>
              </div>
              <button type="button" class="scard-act-btn" title="Alan seçenekleri (Düzenle / Kasa Ekle)" onclick="event.stopPropagation();openSpaceCardMenu(event,'${escHtml(sp.id)}')">⋯</button>
            </div>
            <div class="scard-desc">${escHtml(sp.desc||'')}</div>
            <div class="scard-chips">${chipsHtml}</div>
            <div class="scard-foot">
              <div class="scard-stat">
                <span><b>${spKasas.length}</b> kasa</span>
                <span>·</span>
                <span><b>${sc.notes}</b> not</span>
                ${(sc.docs+sc.images)?`<span>·</span><span><b>${sc.docs+sc.images}</b> kaynak</span>`:''}
                ${spScopedRoots.length?`<span>·</span><span><b>${spScopedRoots.length}</b> ortak</span>`:''}
              </div>
              <span class="scard-go">Alana Gir →</span>
            </div>
          </div>`;
        }).join('')}
        <div class="scard new-card" onclick="openSpaceModal()">
          <div style="font-size:26px;margin-bottom:4px;color:var(--cu)">＋</div>
          <b style="font-size:15px;color:var(--txt)">Yeni Çalışma Alanı Ekle</b>
          <span style="font-size:12.5px;color:var(--mut);max-width:230px">Örn. Dönem 8, Staj Dosyaları, Bitirme Projesi veya Sertifikalar</span>
        </div>
      </div>

      ${renderRootDocsHtml(globalRoots)}
      ${renderToolsGridHtml()}
    `;
    return;
  }

  const sp=activeSpaceObj;
  const spKasas=kasalarData.filter(k=>k.space===sp.id);
  const spRoots=rootDocsData.filter(d=>rootDocMatchesSpace(d,sp.id));

  const cardsHtml=spKasas.length
    ? (kasaViewMode==='list'
        ? `<div class="klist">${spKasas.map(k=>renderKasaRowHtml(k,false)).join('')}</div>`
        : `<div class="kgrid">
            ${spKasas.map(k=>renderKasaCardHtml(k,false)).join('')}
            <div class="kcard new-card" onclick="openNewKasaModal('${escHtml(sp.id)}')">
              <div style="font-size:28px;margin-bottom:4px">＋</div>
              <b style="font-size:15px;color:var(--txt)">${escHtml(sp.title)} Alanına Kasa Ekle</b>
              <span style="font-size:12.5px;max-width:220px">Yeni ders, laboratuvar, proje veya belge kasası oluştur</span>
            </div>
          </div>`)
    : `<div class="scard" style="--sp-acc:${escHtml(sp.accent||'#e0a458')};align-items:center;text-align:center;padding:38px 24px;margin-bottom:28px;cursor:default">
        <div class="scard-ico" style="width:56px;height:56px;font-size:28px">${escHtml(sp.icon||'🗂')}</div>
        <div>
          <div style="font-size:18px;font-weight:650;color:var(--txt)">${escHtml(sp.title)} henüz boş</div>
          <div style="color:var(--mut);font-size:13px;max-width:440px;margin-top:6px">Buraya yeni bir kasa ekleyebilir, başka bir alandaki kasayı yukarıdaki haplardan bu alana taşıyabilir veya doğrudan belge yükleyebilirsin.</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px">
          <button type="button" class="btn" style="padding:8px 16px" onclick="openNewKasaModal('${escHtml(sp.id)}')">＋ Bu Alana İlk Kasayı Ekle</button>
          <button type="button" class="hb" onclick="triggerSpaceUpload('${escHtml(sp.id)}')">📎 Doğrudan Belge / Görsel Ekle</button>
        </div>
      </div>`;

  bodyEl.innerHTML=`
    <div class="ksect-hd">
      <h2>❖ Kasalar (${spKasas.length})</h2>
      ${spKasas.length?`<span class="kdrag-hint">İpucu: Kartı üstteki başka bir alan hapına sürükleyerek taşıyabilirsin</span>`:''}
    </div>
    ${cardsHtml}
    ${renderRootDocsHtml(spRoots)}
    ${renderToolsGridHtml()}
  `;
}

function renderKasalarHome(m){
  const activeSpaceObj=currentSpace!=='all'?getSpaceObj(currentSpace):null;
  const totalKasas=kasalarData.length;
  const totalNotes=kasalarData.reduce((a,k)=>a+(k.counts?k.counts.notes:0),0);
  const totalDocs=kasalarData.reduce((a,k)=>a+(k.counts?k.counts.docs+k.counts.images:0),0);
  const hasQ=kasaSearchQ.length>0;

  if(!activeSpaceObj){
    /* ---- SEVİYE 1: ÇALIŞMA ALANLARI ---- */
    m.innerHTML=`<div class="khome">
      <div class="khero">
        <div>
          <h1><span style="color:var(--cu)">❖</span> Çalışma Alanları</h1>
          <p>Derslerini ve belgelerini dönem ve türe göre düzenli tut · <b>${spacesData.length} alan</b>, <b>${totalKasas} kasa</b>, <b>${totalNotes} not</b>, <b>${totalDocs} kaynak</b>.</p>
        </div>
        <div class="kbar">
          <div class="ksrch-wrap">
            <input class="ksrch" id="kasaSrchIn" placeholder="Alan, kasa veya ders notu ara…" value="${escHtml(kasaSearchQ)}">
            <button type="button" class="ksrch-clr ${hasQ?'show':''}" id="kasaSrchClr" title="Aramayı temizle">✕</button>
          </div>
          <button class="btn" style="padding:8px 14px" onclick="openSpaceModal()">＋ Yeni Alan</button>
          <button class="hb" onclick="openNewKasaModal()">＋ Yeni Kasa</button>
          <button class="hb" onclick="triggerAssetUpload()" title="Aktif kasaya belge/fotoğraf yükle">📎 Belge Ekle</button>
        </div>
      </div>
      <div id="kasaHomeBody"></div>
    </div>`;
  }else{
    /* ---- SEVİYE 2: SEÇİLİ ÇALIŞMA ALANI İÇİNDEKİ KASALAR ---- */
    const sp=activeSpaceObj;
    const spKasas=kasalarData.filter(k=>k.space===sp.id);
    const spNotes=spKasas.reduce((a,k)=>a+(k.counts?k.counts.notes:0),0);
    const spDocs=spKasas.reduce((a,k)=>a+(k.counts?k.counts.docs+k.counts.images:0),0);

    const pillsHtml=spacesData.map(s=>`
      <button type="button" class="spill ${s.id===sp.id?'on':''}" style="--sp-acc:${escHtml(s.accent||'#e0a458')}" onclick="enterSpace('${escHtml(s.id)}')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'${escHtml(s.id)}')" title="${escHtml(s.title)} · Kasayı buraya sürükleyip taşıyabilirsin">
        <span>${escHtml(s.icon||'🗂')}</span>
        <span>${escHtml(s.title)}</span>
        <span class="spill-cnt">${s.count_kasas||0}</span>
      </button>
    `).join('')+`<button type="button" class="spill" onclick="openSpaceModal()" title="Yeni Çalışma Alanı Oluştur">＋ Yeni Alan</button>`;

    m.innerHTML=`<div class="khome">
      <div class="snav">
        <div class="snav-left">
          <button type="button" class="snav-back" onclick="selectSpaceFilter('all',true)">← Tüm Alanlar</button>
          <div class="snav-pills">${pillsHtml}</div>
        </div>
        <div class="vmode" title="Görünüm Modu">
          <button type="button" class="${kasaViewMode!=='list'?'on':''}" onclick="setKasaViewMode('grid')">⊞ Kart</button>
          <button type="button" class="${kasaViewMode==='list'?'on':''}" onclick="setKasaViewMode('list')">☰ Liste</button>
        </div>
      </div>

      <div class="khero">
        <div>
          <h1><span>${escHtml(sp.icon||'🗂')}</span> ${escHtml(sp.title)} <span class="scard-tag" style="--sp-acc:${escHtml(sp.accent||'#e0a458')};margin:0;vertical-align:middle">${escHtml(sp.tag||'Alan')}</span></h1>
          <p>${escHtml(sp.desc||'')} · <b>${spKasas.length} kasa</b>, <b>${spNotes} not</b>, <b>${spDocs} PDF/görsel kaynak</b>.</p>
        </div>
        <div class="kbar">
          <div class="ksrch-wrap">
            <input class="ksrch" id="kasaSrchIn" placeholder="Bu alanda kasa veya not ara…" value="${escHtml(kasaSearchQ)}">
            <button type="button" class="ksrch-clr ${hasQ?'show':''}" id="kasaSrchClr" title="Aramayı temizle">✕</button>
          </div>
          <button class="hb" onclick="openSpaceModal('${escHtml(sp.id)}')">✎ Alanı Düzenle</button>
          <button class="hb" onclick="triggerSpaceUpload('${escHtml(sp.id)}')">📎 Belge Ekle</button>
          <button class="btn" style="padding:8px 14px" onclick="openNewKasaModal('${escHtml(sp.id)}')">＋ Yeni Kasa</button>
        </div>
      </div>
      <div id="kasaHomeBody"></div>
    </div>`;
  }

  const bodyEl=$('#kasaHomeBody');
  renderKasalarBody(bodyEl);

  const sIn=$('#kasaSrchIn');
  const sClr=$('#kasaSrchClr');
  let lastTrimQ=kasaSearchQ.trim().toLowerCase();
  if(sIn){
    sIn.oninput=e=>{
      kasaSearchQ=e.target.value;
      if(sClr) sClr.classList.toggle('show',kasaSearchQ.length>0);
      const nextTrimQ=kasaSearchQ.trim().toLowerCase();
      if(nextTrimQ!==lastTrimQ){
        lastTrimQ=nextTrimQ;
        renderKasalarBody(bodyEl);
      }
    };
    sIn.onkeydown=e=>{
      if(e.key==='Escape'&&kasaSearchQ){
        e.preventDefault();
        kasaSearchQ='';
        sIn.value='';
        if(sClr) sClr.classList.remove('show');
        lastTrimQ='';
        renderKasalarBody(bodyEl);
      }
    };
  }
  if(sClr){
    sClr.onclick=()=>{
      kasaSearchQ='';
      if(sIn){ sIn.value=''; sIn.focus(); }
      sClr.classList.remove('show');
      lastTrimQ='';
      renderKasalarBody(bodyEl);
    };
  }
}

function closeKasaModal(){ $('#kasaModal').classList.remove('show'); }
$('#kasaModal').onclick=e=>{ if(e.target.id==='kasaModal') closeKasaModal(); };
function bindKasaModalEnter(submitFn){
  const box=$('#kasaModalBox');
  if(!box) return;
  box.onkeydown=e=>{
    if(e.key==='Escape'){ e.preventDefault(); closeKasaModal(); return; }
    if(e.key!=='Enter'||e.isComposing) return;
    const tag=(e.target.tagName||'').toUpperCase();
    if(tag==='BUTTON'||tag==='A') return;
    if(tag==='TEXTAREA'){
      if(e.ctrlKey||e.metaKey){ e.preventDefault(); submitFn(); }
      return;
    }
    if(tag==='INPUT'&&(e.target.type==='file'||e.target.type==='button'||e.target.type==='submit')) return;
    e.preventDefault();
    submitFn();
  };
}

function openSpaceModal(spaceId=null){
  const existing=spaceId?getSpaceObj(spaceId):null;
  const box=$('#kasaModalBox');
  box.innerHTML=`
    <h3>${existing?`✎ Çalışma Alanını Düzenle · ${escHtml(existing.title)}`:'🗂 Yeni Çalışma Alanı Oluştur'}</h3>
    <label>Alan Adı
      <input id="msTitle" placeholder="ör. Dönem 8, Staj & Başvuru, Bitirme Projesi" value="${escHtml(existing?existing.title:'')}">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>İkon Seç
        <select id="msIcon">${renderIconOptions(existing?existing.icon:'🗂')}</select>
      </label>
      <label>Kısa Etiket
        <input id="msTag" placeholder="ör. EEM · 8. Dönem" value="${escHtml(existing?existing.tag:'Çalışma Alanı')}">
      </label>
    </div>
    <label>Vurgu Rengi
      ${renderAccentSwatches('msAccent',existing?existing.accent:'#79c0ff')}
    </label>
    <label>Kısa Açıklama
      <textarea id="msDesc" rows="2" placeholder="Bu alanda toplanacak ders kasaları veya belge türleri…">${escHtml(existing?existing.desc:'')}</textarea>
    </label>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px">
      ${(existing&&spacesData.length>1)?`<button class="hb" style="color:var(--err,#f85149);border-color:color-mix(in srgb,var(--err,#f85149) 40%,var(--line))" onclick="deleteSpaceConfirm('${escHtml(existing.id)}')">🗑 Alanı Sil</button>`:'<span></span>'}
      <div style="display:flex;gap:8px">
        <button class="hb" onclick="closeKasaModal()">İptal</button>
        <button class="btn" style="padding:7px 16px" onclick="submitSpace(${existing?`'${escHtml(existing.id)}'`:'null'})">${existing?'Değişiklikleri Kaydet':'Alanı Oluştur'}</button>
      </div>
    </div>`;
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(()=>submitSpace(existing?existing.id:null));
  setTimeout(()=>$('#msTitle')?.focus(),50);
}
async function submitSpace(spaceId=null){
  const title=$('#msTitle').value.trim();
  const icon=$('#msIcon').value;
  const tag=$('#msTag').value.trim();
  const accent=$('#msAccent').value.trim()||'#e0a458';
  const desc=$('#msDesc').value.trim();
  if(!title){ $('#msTitle').focus(); return; }
  const prev=spaceId?getSpaceObj(spaceId):null;
  const prevCopy=prev?{id:prev.id,title:prev.title,icon:prev.icon,accent:prev.accent,tag:prev.tag,desc:prev.desc}:null;
  try{
    const res=await api('/api/space',{id:spaceId||undefined,title,icon,accent,tag,desc});
    let activeId=res.id;
    pushAppUndo({
      label:prevCopy?`"${prevCopy.title}" alan düzenlemesi`:`"${res.title}" alanını oluşturma`,
      undo:async()=>{
        if(prevCopy){
          await api('/api/space',prevCopy);
        }else{
          await api('/api/space?id='+encodeURIComponent(activeId),null,'DELETE');
          if(currentSpace===activeId) currentSpace='all';
        }
        await loadVault();
      },
      redo:async()=>{
        const saved=await api('/api/space',{id:prevCopy?prevCopy.id:undefined,title,icon,accent,tag,desc});
        activeId=saved.id;
        await loadVault();
      }
    });
    closeKasaModal();
    await loadVault();
    enterSpace(res.id);
    toast(`🗂 "${res.title}" çalışma alanı kaydedildi`);
  }catch(e){ alert('Çalışma alanı kaydedilemedi: '+e.message); }
}
async function deleteSpaceConfirm(spaceId){
  const sp=getSpaceObj(spaceId);
  if(!sp) return;
  if(!confirm(`"${sp.title}" çalışma alanı kaldırılsın mı?\n\nBu alandaki kasalar ve dosyalar ASLA silinmez; varsayılan başka bir alana güvenle aktarılır.`)) return;
  const spCopy={title:sp.title,icon:sp.icon,accent:sp.accent,tag:sp.tag,desc:sp.desc};
  const affectedKeys=kasalarData.filter(k=>k.space===spaceId).map(k=>k.key);
  try{
    const res=await api('/api/space?id='+encodeURIComponent(spaceId),null,'DELETE');
    let restoredId=null;
    pushAppUndo({
      label:`"${spCopy.title}" alanını geri alma`,
      undo:async()=>{
        const created=await api('/api/space',spCopy);
        restoredId=created.id;
        for(const key of affectedKeys){
          await api('/api/kasa/update',{key,space:restoredId});
        }
        await loadVault();
        enterSpace(restoredId);
      },
      redo:async()=>{
        const delId=restoredId||spaceId;
        await api('/api/space?id='+encodeURIComponent(delId),null,'DELETE');
        if(currentSpace===delId) currentSpace='all';
        await loadVault();
      }
    });
    closeKasaModal();
    if(currentSpace===spaceId) currentSpace=res.fallback||'all';
    await loadVault();
    toast(`🗂 "${sp.title}" kaldırıldı (Ctrl+Z: Geri al)`);
  }catch(e){ alert('Alan silinemedi: '+e.message); }
}

function openNewKasaModal(defaultSpaceId=null){
  const prefSpace=defaultSpaceId||(currentSpace!=='all'?currentSpace:(spacesData[0]?spacesData[0].id:'belgeler'));
  const box=$('#kasaModalBox');
  box.innerHTML=`
    <h3>❖ Yeni Çalışma Kasası Oluştur</h3>
    <label>Bağlı Çalışma Alanı
      <select id="mkSpace">
        ${spacesData.map(sp=>`<option value="${escHtml(sp.id)}" ${sp.id===prefSpace?'selected':''}>${escHtml(sp.icon||'🗂')} ${escHtml(sp.title)}</option>`).join('')}
      </select>
    </label>
    <label>Kasa / Ders / Belge Grubu Adı
      <input id="mkTitle" placeholder="ör. Güç Elektroniği, Bitirme Projesi veya Sertifikalar">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>İkon Seç
        <select id="mkIcon">${renderIconOptions('📘')}</select>
      </label>
      <label>Etiket (Kısa Kategori)
        <input id="mkTag" placeholder="ör. EEM · Dönem 8" value="Çalışma Kasası">
      </label>
    </div>
    <label>Kart Rengi
      ${renderAccentSwatches('mkAccent',(getSpaceObj(prefSpace)||{}).accent||'#e0a458')}
    </label>
    <label>Kısa Açıklama
      <textarea id="mkDesc" rows="2" placeholder="Bu kasada tutulacak ders notları, deney föyleri ve kaynaklar…"></textarea>
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="hb" onclick="closeKasaModal()">İptal</button>
      <button class="btn" style="padding:7px 16px" onclick="submitNewKasa()">Oluştur ve Aç</button>
    </div>`;
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(submitNewKasa);
  setTimeout(()=>$('#mkTitle').focus(),50);
}
async function submitNewKasa(){
  const title=$('#mkTitle').value.trim();
  const tag=$('#mkTag').value.trim();
  const icon=$('#mkIcon').value;
  const desc=$('#mkDesc').value.trim();
  const space=$('#mkSpace')?$('#mkSpace').value:'';
  const accent=$('#mkAccent')?$('#mkAccent').value:'#e0a458';
  if(!title){ $('#mkTitle').focus(); return; }
  try{
    const res=await api('/api/kasa',{title,tag,icon,desc,space,accent});
    closeKasaModal();
    await loadVault();
    enterKasa(res.key,'write');
    toast(`❖ "${title}" kasası oluşturuldu`,res.index_id);
  }catch(e){ alert('Kasa oluşturulamadı: '+e.message); }
}

function openEditKasaModal(kasaKey){
  const kObj=kasalarData.find(k=>k.key===kasaKey);
  if(!kObj) return;
  const box=$('#kasaModalBox');
  box.innerHTML=`
    <h3>✎ Kasayı Düzenle · ${escHtml(kObj.title)}</h3>
    <label>Çalışma Alanı (Kasa Taşıma)
      <select id="ekSpace">
        ${spacesData.map(sp=>`<option value="${escHtml(sp.id)}" ${sp.id===kObj.space?'selected':''}>${escHtml(sp.icon||'🗂')} ${escHtml(sp.title)}</option>`).join('')}
      </select>
    </label>
    <label>Görünen Kasa Adı
      <input id="ekTitle" value="${escHtml(kObj.title)}">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>İkon Seç
        <select id="ekIcon">${renderIconOptions(kObj.icon||'📘')}</select>
      </label>
      <label>Etiket
        <input id="ekTag" value="${escHtml(kObj.tag||'')}">
      </label>
    </div>
    <label>Kart Rengi
      ${renderAccentSwatches('ekAccent',kObj.accent||'#e0a458')}
    </label>
    <label>Kısa Açıklama
      <textarea id="ekDesc" rows="2">${escHtml(kObj.desc||'')}</textarea>
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="hb" onclick="closeKasaModal()">İptal</button>
      <button class="btn" style="padding:7px 16px" onclick="submitEditKasa('${kasaKey}')">Kaydet</button>
    </div>`;
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(()=>submitEditKasa(kasaKey));
  setTimeout(()=>$('#ekTitle').focus(),50);
}
async function submitEditKasa(kasaKey){
  const title=$('#ekTitle').value.trim();
  const space=$('#ekSpace').value;
  const icon=$('#ekIcon').value;
  const tag=$('#ekTag').value.trim();
  const accent=$('#ekAccent').value.trim();
  const desc=$('#ekDesc').value.trim();
  if(!title){ $('#ekTitle').focus(); return; }
  const prevObj=kasalarData.find(k=>k.key===kasaKey);
  const prevMeta=prevObj?{key:kasaKey,title:prevObj.title,space:prevObj.space,icon:prevObj.icon,tag:prevObj.tag,accent:prevObj.accent,desc:prevObj.desc}:null;
  const nextMeta={key:kasaKey,title,space,icon,tag,accent,desc};
  try{
    await api('/api/kasa/update',nextMeta);
    if(prevMeta){
      pushAppUndo({
        label:`"${prevMeta.title}" kasa düzenlemesi`,
        undo:async()=>{ await api('/api/kasa/update',prevMeta); await loadVault(); },
        redo:async()=>{ await api('/api/kasa/update',nextMeta); await loadVault(); }
      });
    }
    closeKasaModal();
    await loadVault();
    toast(`❖ "${title}" güncellendi (Ctrl+Z: Geri al)`);
  }catch(e){ alert('Kasa güncellenemedi: '+e.message); }
}

function defaultTargetInScope(){
  if(currentKasa!=='all') return currentKasa;
  if(currentSpace!=='all'){
    const spKasa=kasalarData.find(k=>k.space===currentSpace);
    if(spKasa) return spKasa.key;
  }
  return '';
}
function openNewFolderModal(defaultParent,parentLabel){
  const targets=flattenFolderTargets();
  const fallbackParent=defaultParent||defaultTargetInScope()||(targets[0]?targets[0].rel:'Elektrik_Makineleri_Lab');
  const box=$('#kasaModalBox');
  box.innerHTML=`
    <h3>📁 Yeni Açılır Klasör Oluştur</h3>
    <label>Üst Kasa / Klasör
      <select id="mfParent">
        ${targets.map(t=>`<option value="${t.rel}" ${t.rel===fallbackParent?'selected':''}>${'  '.repeat(t.depth)}${t.depth?'└─ ':'❖ '}${escHtml(t.label)}</option>`).join('')}
      </select>
    </label>
    <label>Klasör Adı
      <input id="mfName" placeholder="ör. Çalışma Kağıtları, Vize Soruları, Ödevler…">
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="hb" onclick="closeKasaModal()">İptal</button>
      <button class="btn" style="padding:7px 16px" onclick="submitNewFolder()">Klasör Oluştur</button>
    </div>`;
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(submitNewFolder);
  setTimeout(()=>$('#mfName')?.focus(),50);
}
async function submitNewFolder(){
  const parent=$('#mfParent').value;
  const name=$('#mfName').value.trim();
  if(!name){ $('#mfName').focus(); return; }
  try{
    const res=await api('/api/folder',{parent,name});
    closeKasaModal();
    const topKasa=res.kasa||parent.split('/')[0];
    TREE_OPEN[topKasa]=true;
    TREE_OPEN[parent]=true;
    if(res.rel) TREE_OPEN[res.rel]=true;
    if(currentKasa!=='all'&&currentKasa!==topKasa) currentKasa=topKasa;
    await loadVault();
    saveSessionTabs();
    toast(`📁 "${res.name}" klasörü oluşturuldu`);
  }catch(e){ alert('Klasör oluşturulamadı: '+e.message); }
}

function openNewNoteModal(defaultTarget){
  const targets=flattenFolderTargets();
  const targetRel=defaultTarget||defaultTargetInScope()||(targets[0]?targets[0].rel:'Elektrik_Makineleri_Lab');
  const box=$('#kasaModalBox');
  const opts=targets.length
    ? targets.map(t=>`<option value="${t.rel}" ${t.rel===targetRel?'selected':''}>${'  '.repeat(t.depth)}${t.depth?'└─ 📁 ':'❖ '}${escHtml(t.label)}</option>`).join('')
    : kasalarData.map(k=>`<option value="${k.key}" ${k.key===targetRel?'selected':''}>${k.icon} ${k.title}</option>`).join('');
  box.innerHTML=`
    <h3>📝 Kasaya / Klasöre Yeni Not &amp; Belge/Fotoğraf Ekle</h3>
    <label>Hedef Kasa / Klasör
      <select id="mnKasa">${opts}</select>
    </label>
    <label>📎 Bilgisayardan Belge / Fotoğraf Seç (PDF, Word, Görsel, MD, TXT)
      <input type="file" id="mnFiles" multiple accept=".md,.txt,.html,.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,image/*" style="cursor:pointer" onchange="if(this.files.length&&!$('#mnTitle').value.trim()){$('#mnTitle').value=this.files[0].name.replace(/\\.[^.]+$/,'').replace(/[_-]+/g,' ');}">
    </label>
    <label>Not Başlığı (Sadece dosya yüklüyorsan boş bırakabilirsin)
      <input id="mnTitle" placeholder="ör. Deney 4 — Asenkron Motor Hız Kontrolü">
    </label>
    <label>İlk İçerik (Markdown / LaTeX)
      <textarea id="mnBody" rows="4" placeholder="# Başlık\n\nNot içeriğini buraya yazabilir veya yukarıdan belge/fotoğraf seçebilirsin…"></textarea>
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="hb" onclick="closeKasaModal()">İptal</button>
      <button class="btn" style="padding:7px 16px" onclick="submitNewNote()">Ekle ve Aç</button>
    </div>`;
  $('#kasaModal').classList.add('show');
  bindKasaModalEnter(submitNewNote);
  setTimeout(()=>$('#mnTitle').focus(),50);
}
async function submitNewNote(){
  const target=$('#mnKasa').value;
  const topKasa=target.split('/')[0];
  const title=$('#mnTitle').value.trim();
  const content=$('#mnBody').value;
  const filesEl=$('#mnFiles');
  const files=filesEl&&filesEl.files?[...filesEl.files]:[];
  if(!title&&!files.length){ $('#mnTitle').focus(); return; }
  try{
    closeKasaModal();
    if(currentKasa!=='all') currentKasa=topKasa;
    TREE_OPEN[topKasa]=true;
    TREE_OPEN[target]=true;
    if(title){
      const res=await api('/api/note/create',{kasa:target,title,content});
      if(files.length){
        await dropImagesToNote(res.id,files);
      }
      await loadVault();
      unlockedNotes.add(res.id);
      openPage(res.id);
      toast(`📝 "${title}"${files.length?` (+${files.length} ek dosya)`:''} oluşturuldu`,res.id);
    }else if(files.length){
      pendingUploadTarget=target;
      await handleGlobalUpload(files);
    }
  }catch(e){ alert('İşlem hatası: '+e.message); }
}

let pendingUploadTarget=null;
let pendingSpaceUpload=null;
function triggerAssetUpload(targetKasaOrRel){
  if(String(targetKasaOrRel||'').startsWith('note:')&&targetKasaOrRel===notionState.noteId&&notionState.locked){
    toast('🔒 Düzenleme kilitli — ek yüklemek için önce "🔒 Kilitli" butonuna tıklayın',targetKasaOrRel);
    return;
  }
  pendingUploadTarget=targetKasaOrRel||null;
  pendingSpaceUpload=null;
  const inp=$('#hiddenFileIn');
  if(inp){ inp.value=''; inp.click(); }
}
function triggerSpaceUpload(spaceId){
  pendingSpaceUpload=spaceId||null;
  pendingUploadTarget=null;
  const inp=$('#hiddenFileIn');
  if(inp){ inp.value=''; inp.click(); }
}
async function handleGlobalUpload(fileList){
  if(!fileList||!fileList.length) return;
  const explicitTarget=pendingUploadTarget;
  const spaceUploadId=pendingSpaceUpload;
  pendingUploadTarget=null;
  pendingSpaceUpload=null;
  try{
    let targetRel='';
    const attachToNote=explicitTarget
      ?(String(explicitTarget).startsWith('note:')?explicitTarget:null)
      :(!spaceUploadId&&String(active).startsWith('note:')?active:null);
    if(attachToNote){
      await dropImagesToNote(attachToNote,[...fileList]);
      return;
    }
    if(explicitTarget){
      targetRel=explicitTarget;
    }else if(spaceUploadId){
      const existingKasa=kasalarData.find(k=>k.space===spaceUploadId);
      if(existingKasa){
        targetRel=existingKasa.key;
      }else{
        const sp=getSpaceObj(spaceUploadId);
        const defTitle=spaceUploadId==='belgeler'?'Genel Belgeler':`${sp?sp.title:spaceUploadId} Belgeleri`;
        const created=await api('/api/kasa',{
          title:defTitle,
          tag:sp?sp.tag:'Çalışma Kasası',
          icon:sp?sp.icon:'🗂',
          accent:sp?sp.accent:'#7bc47f',
          space:spaceUploadId,
          desc:`${sp?sp.title:'Çalışma alanı'} belgeleri ve kaynakları.`
        });
        targetRel=created.key;
      }
    }else{
      targetRel=defaultTargetInScope()||(kasalarData[0]?kasalarData[0].key:'');
    }
    const uploaded=[];
    for(const f of fileList){
      uploaded.push(await uploadAssetFile(f,f.name,targetRel));
    }
    if(targetRel){
      TREE_OPEN[targetRel.split('/')[0]]=true;
      TREE_OPEN[targetRel]=true;
    }
    await loadVault();
    if(uploaded.length===1){
      const u=uploaded[0];
      if(isSideDoc(u.rel||u.id)){
        openRightViewer(u.rel,u.name);
      }else{
        openPage(u.id);
      }
    }else{
      renderMain();
    }
    toast(`📎 ${uploaded.length} belge/fotoğraf kasaya eklendi`,uploaded[0]?uploaded[0].id:undefined);
  }catch(e){ alert('Yükleme hatası: '+e.message); }
}

async function removeEmbed(fileRef){
  const id=active; if(!String(id).startsWith('note:')) return;
  if(notionState.locked){ toast('🔒 Not kilitli — ek kaldırmak için önce düzenleme kilidini açın',id); return; }
  const noteRel=id.slice(5); const n=noteCache[id]; if(!n) return;
  const base=String(fileRef).split('/').pop().split('\\').pop();
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const b=esc(base);
  const re=new RegExp('[ \\t]*!?\\[\\[[^\\]\\n]*'+b+'[^\\]\\n]*\\]\\][ \\t]*\\n?|[ \\t]*!?\\[[^\\]\\n]*\\]\\([^)\\n]*'+b+'[^)\\n]*\\)[ \\t]*\\n?','gi');
  if(!re.test(n.content)){ alert('Not metninde bu ek bulunamadı.'); return; }
  re.lastIndex=0;
  if(!confirm('"'+base+'" eki bu nottan kaldırılsın mı?')) return;
  const content=n.content.replace(re,'');
  try{
    noteCache[id]=await api('/api/note',{rel:noteRel,content});
    await loadVault(); renderMain();
    toast('Ek nottan kaldırıldı');
    const fileRel=String(fileRef).includes('/')?String(fileRef):(noteRel.split('/')[0]+'/'+base);
    if(pages['note:'+fileRel]&&confirm('Dosya kasada duruyor. Tamamen silinsin mi?')) deleteActiveNote('note:'+fileRel);
  }catch(e){ alert('Kaldırılamadı: '+e.message); }
}
async function deleteActiveNote(id){
  if(!String(id).startsWith('note:')) return;
  const rel=id.slice(5);
  if(!confirm(`"${rel}" dosyasını kasadan silmek istediğine emin misin?`)) return;
  const ext=rel.includes('.')?rel.slice(rel.lastIndexOf('.')).toLowerCase():'';
  const restorableText=['.md','.txt','.html','.csv'].includes(ext);
  let backupContent=null;
  if(restorableText){
    if(noteCache[id]&&typeof noteCache[id].content==='string'){
      backupContent=noteCache[id].content;
    }else{
      try{
        const loaded=await api('/api/note?rel='+encodeURIComponent(rel));
        if(loaded&&typeof loaded.content==='string') backupContent=loaded.content;
      }catch(e){}
    }
  }
  try{
    await api('/api/note?rel='+encodeURIComponent(rel),null,'DELETE');
    delete noteCache[id];
    invalidateNoteDomCache(id);
    delete pages[id];
    checkedSources.delete(rel);
    closeTab(id,{silentUndo:true});
    if(typeof rvCurrentRel!=='undefined'&&rvCurrentRel===rel&&viewerPrev) closeRightViewer();
    await loadVault();
    renderTree();
    if(String(active).startsWith('note:')||openTabs.length) try{renderMain()}catch(e){}
    if(restorableText&&backupContent!==null){
      pushAppUndo({
        label:`"${rel.split('/').pop()}" dosyasını geri yükle`,
        undo:async()=>{
          noteCache[id]=await api('/api/note',{rel,content:backupContent});
          await loadVault();
          openPage(id);
        },
        redo:async()=>{
          await api('/api/note?rel='+encodeURIComponent(rel),null,'DELETE');
          delete noteCache[id];
          delete pages[id];
          closeTab(id,{silentUndo:true});
          await loadVault();
        }
      });
      toast(`🗑 Silindi: ${rel} (Ctrl+Z: Geri yükle)`);
    }else{
      toast(`🗑 Silindi: ${rel}`);
    }
  }catch(e){ alert('Silinemedi: '+e.message); }
}

/* ---------- Sağ Panel: Gerçek Sayfa & Kasa Özellikleri ---------- */
function updateRightProps(){
  const host=$('#propsContent'); if(!host) return;
  if(String(active).startsWith('note:')){
    const rel=active.slice(5);
    const p=pages[active]||{t:rel,folder:'Kasa',ext:'.md'};
    if((p.ext||'').toLowerCase()==='.pdf'){
      const info=pdfInfoCache[active];
      const inLinks=backlinksMap[active]||[];
      host.innerHTML=`
        <div class="src" style="margin:0"><span>Kasa</span><b class="mono" style="color:var(--cu)">${p.folder||'—'}</b></div>
        <div class="src" style="margin:0"><span>PDF Dosyası</span><b class="mono" style="font-size:11px">${rel}</b></div>
        <div class="src" style="margin:0"><span>Boyut &amp; Sayfa</span><b class="mono">${info?`${info.pages} sayfa · ${info.size_kb} KB`:'Okunuyor…'}</b></div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="hb" style="flex:1" onclick="togglePdfDrawer('${active}','text')">🔍 Metin &amp; OCR</button>
          <button class="hb" style="flex:1" onclick="togglePdfDrawer('${active}','scratch')">✎ Not Tut</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="hb" style="flex:1" onclick="dockDocToRightAndReturn('${active}')">📌 Sağ Panele Al</button>
          <button class="hb" style="flex:1" onclick="printPdfFrame('${rel}')">🖨 Yazdır</button>
        </div>
        <div class="ph" style="padding:10px 0 2px"><span>Buraya Bağlananlar (${inLinks.length})</span></div>
        ${inLinks.length?inLinks.map(x=>`<div class="ti" onclick="openPage('${x.id}')">↖ ${x.title}</div>`).join(''):'<div style="color:var(--mut);font-size:12px;padding:2px 6px">Geri bağlantı yok</div>'}
      `;
      return;
    }
    const n=noteCache[active];
    const txt=n&&n.content?n.content:'';
    const words=txt.trim()?txt.trim().split(/\s+/).length:0;
    const lines=txt?txt.split('\n').length:0;
    const readMin=Math.max(1,Math.ceil(words/180));
    const headings=[...txt.matchAll(/^(#{1,3})\s+(.+)$/gm)].map(m=>({lvl:m[1].length,t:m[2].replace(/[*_`]/g,'').trim()}));
    const outLinks=[...txt.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(m=>resolveWiki(m[0].slice(2,-2))).filter(x=>x.id);
    const uniqOut=[]; outLinks.forEach(x=>{if(!uniqOut.some(u=>u.id===x.id))uniqOut.push(x);});
    const inLinks=backlinksMap[active]||[];

    const isRootFile=!rel.includes('/');
    const rootScopeRow=isRootFile?(()=>{
      const badge=rootDocScopeBadge(n||p);
      const relJs=escHtml(rel).replace(/'/g,"\\'");
      return `<div class="src" style="margin:0;cursor:pointer" onclick="openRootDocScopeMenu(event,'${relJs}')" title="${escHtml(badge.title)} · Değiştirmek için tıkla"><span>Kapsam</span><b class="mono" style="color:var(--cu)">${escHtml(badge.text)} ▾</b></div>`;
    })():'';

    host.innerHTML=`
      <div class="src" style="margin:0"><span>Kasa</span><b class="mono" style="color:var(--cu)">${p.folder||'—'}</b></div>
      ${rootScopeRow}
      <div class="src" style="margin:0"><span>Dosya</span><b class="mono" style="font-size:11px">${rel}</b></div>
      <div class="src" style="margin:0"><span>İstatistik</span><b class="mono">${words} kelime · ${lines} satır (~${readMin} dk)</b></div>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="hb" style="flex:1" onclick="window.print()">🖨 A4 Yazdır</button>
        <button class="hb" style="flex:1" onclick="openNewNoteModal('${p.kasa||''}')">＋ Yeni Not</button>
      </div>
      ${headings.length?`<div class="ph" style="padding:10px 0 2px"><span>İçindekiler (${headings.length})</span></div>`+
        headings.slice(0,14).map(h=>`<div class="ti" style="padding-left:${(h.lvl-1)*10+6}px;font-size:12px" onclick="scrollToHeading('${h.t.replace(/'/g,"\\'")}')">§ ${h.t}</div>`).join(''):''}
      <div class="ph" style="padding:10px 0 2px"><span>Not İçi Bağlantılar (${uniqOut.length})</span></div>
      ${uniqOut.length?uniqOut.map(x=>`<div class="ti" onclick="openPage('${x.id}')">↗ ${x.label}</div>`).join(''):'<div style="color:var(--mut);font-size:12px;padding:2px 6px">Bağlantı yok</div>'}
      <div class="ph" style="padding:10px 0 2px"><span>Buraya Bağlananlar (${inLinks.length})</span></div>
      ${inLinks.length?inLinks.map(x=>`<div class="ti" onclick="openPage('${x.id}')">↖ ${x.title}</div>`).join(''):'<div style="color:var(--mut);font-size:12px;padding:2px 6px">Geri bağlantı yok</div>'}
    `;
  }else{
    const kObj=kasalarData.find(k=>k.key===currentKasa);
    const spObj=getSpaceObj(currentSpace)||(kObj?getSpaceObj(kObj.space):null);
    const visKasas=currentSpace==='all'?kasalarData:kasalarData.filter(k=>k.space===currentSpace);
    host.innerHTML=`
      <div class="src" style="margin:0"><span>Görünüm</span><b class="mono">${escHtml(pg(active).t)}</b></div>
      <div class="src" style="margin:0"><span>Çalışma Alanı</span><b class="mono">${spObj?`${escHtml(spObj.icon)} ${escHtml(spObj.title)}`:'Tüm Alanlar'}</b></div>
      <div class="src" style="margin:0"><span>Aktif Kasa</span><b class="mono" style="color:var(--cu)">${kObj?escHtml(kObj.title):'Tüm Kasalar'}</b></div>
      <div class="src" style="margin:0"><span>Seçili Kaynak</span><b class="mono">${getCheckedSources().length} kaynak AI'a bağlı</b></div>
      <div class="ph" style="padding:10px 0 2px"><span>Hızlı Kasa Geçişi (${visKasas.length})</span></div>
      ${visKasas.map(k=>`<div class="ti" onclick="enterKasa('${k.key}','write')">${escHtml(k.icon)} ${escHtml(k.title)} <small style="margin-left:auto;color:var(--mut)">${k.counts.total}</small></div>`).join('')}
    `;
  }
}
function scrollToHeading(text){
  const view=$('#mdView'); if(!view) return;
  const els=[...view.querySelectorAll('.nblock-h1,.nblock-h2,.nblock-h3,h1,h2,h3')];
  const hit=els.find(el=>el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
  if(hit) hit.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------- Ana alan & PDF/Belge Stüdyosu ---------- */
const pdfState={};
const pdfInfoCache={};
const pdfSlotMap=new Map();
const noteDomCache=new Map();
const NOTE_DOM_CACHE_LIMIT=14;
let _pdfNavSeq=0;
function invalidateNoteDomCache(id){
  if(id) noteDomCache.delete(id);
}
function getPdfSlot(id){
  return pdfSlotMap.get(id)||null;
}
function disposePdfSlot(slot){
  if(!slot) return;
  if(slot.dataset&&slot.dataset.blobUrl){
    try{ URL.revokeObjectURL(slot.dataset.blobUrl); }catch(e){}
    delete slot.dataset.blobUrl;
  }
  slot.remove();
}
function removePdfSlot(id){
  const slot=pdfSlotMap.get(id);
  if(slot){ disposePdfSlot(slot); pdfSlotMap.delete(id); }
}
function syncPdfSlotsWithTabs(){
  const keep=new Set(openTabs);
  for(const [id,slot] of pdfSlotMap.entries()){
    if(!keep.has(id)){ disposePdfSlot(slot); pdfSlotMap.delete(id); }
  }
  for(const id of noteDomCache.keys()){
    if(!keep.has(id)) noteDomCache.delete(id);
  }
}
function activatePdfCache(id){
  const stage=$('#pdfCacheStage');
  const m=$('#main');
  if(stage) stage.classList.add('active');
  if(m){ m.style.visibility='hidden'; m.style.pointerEvents='none'; }
  for(const [k,slot] of pdfSlotMap.entries()){
    slot.classList.toggle('active',k===id);
  }
}
function deactivatePdfCache(){
  const stage=$('#pdfCacheStage');
  const m=$('#main');
  if(stage) stage.classList.remove('active');
  if(m){ m.style.visibility=''; m.style.pointerEvents=''; }
  for(const slot of pdfSlotMap.values()) slot.classList.remove('active');
}
function fitImgStudio(img,rot){
  if(!img||!img.naturalWidth||!img.naturalHeight) return;
  const box=img.parentElement;
  const wrap=img.closest('.img-studio');
  if(!box||!wrap) return;
  const r=((rot%360)+360)%360;
  const swapped=(r===90||r===270);
  const cw=Math.max(200,(wrap.clientWidth||window.innerWidth)-48);
  const nw=img.naturalWidth,nh=img.naturalHeight;
  const visW=swapped?nh:nw;
  const visH=swapped?nw:nh;
  const scale=Math.min(1,cw/visW);
  const w=Math.round(nw*scale);
  const h=Math.round(nh*scale);
  img.style.maxWidth='none';
  img.style.width=w+'px';
  img.style.height=h+'px';
  box.style.width=Math.round(visW*scale)+'px';
  box.style.height=Math.round(visH*scale)+'px';
}
function getSavedImgRot(id){
  try{
    const m=JSON.parse(localStorage.getItem(IMG_ROT_KEY)||'{}');
    return (m&&typeof m[id]==='number')?m[id]:0;
  }catch(e){ return 0; }
}
function saveImgRot(id,rot){
  try{
    const m=JSON.parse(localStorage.getItem(IMG_ROT_KEY)||'{}')||{};
    const norm=((rot%360)+360)%360;
    if(norm===0) delete m[id];
    else m[id]=norm;
    persistUiState({[IMG_ROT_KEY]:JSON.stringify(m)});
  }catch(e){}
}
function getPdfState(id){
  if(!pdfState[id]){
    const savedFlt=localStorage.getItem('agydesk_pdf_filter');
    const initFlt=(savedFlt==='normal'||savedFlt==='night'||savedFlt==='sepia')?savedFlt:'sepia';
    pdfState[id]={page:1,totalPages:0,zoom:'FitH',filter:initFlt,drawer:null,scratch:localStorage.getItem('agydesk_scratch_'+id)||''};
  }
  return pdfState[id];
}
function buildPdfUrl(rel,st,bust=false){
  const z=st.zoom||'FitH';
  const zoomParam=(z==='FitH'||z==='Fit')?`view=${z}`:`zoom=${z}`;
  const q=bust?`_pv=${++_pdfNavSeq}`:'';
  return `${rawUrlForRel(rel,q)}#page=${st.page||1}&${zoomParam}`;
}
function updatePdfFrame(id,reloadHash=false){
  const st=getPdfState(id);
  const slot=getPdfSlot(id);
  const root=slot||document;
  const wrap=slot?slot.querySelector('.pdf-frame-wrap, .pptx-stage, .xlsx-stage, .img-studio'):$('#pdfFrameWrap');
  if(wrap){
    wrap.classList.toggle('night',st.filter==='night');
    wrap.classList.toggle('sepia',st.filter==='sepia');
    const ifr=wrap.querySelector('iframe');
    if(ifr&&ifr.style.filter) ifr.style.filter='';
  }
  root.querySelectorAll('.pdf-flt-btn').forEach(b=>b.classList.toggle('on',b.dataset.flt===st.filter));
  root.querySelectorAll('.pdf-dd[title="Okuma Modu"]').forEach(dd=>{
    const m={normal:'☀ Orijinal',night:'🌙 Gece',sepia:'📜 Sepya'}[st.filter||'normal']||'☀ Orijinal';
    const btn=dd.firstElementChild;
    if(btn) btn.textContent=m+' ▾';
    dd.querySelectorAll('.pdf-dd-menu button').forEach(b=>{
      const flt=b.dataset.flt;
      b.classList.toggle('on',flt?flt===st.filter:Boolean(b.getAttribute('onclick')?.includes(`'${st.filter}'`)));
    });
  });
  root.querySelectorAll('.pdf-zm-btn').forEach(b=>b.classList.toggle('on',b.dataset.zm===String(st.zoom)));
  const pgIn=slot?slot.querySelector('.pg-in'):$('#pdfPgIn');
  if(pgIn&&document.activeElement!==pgIn) pgIn.value=st.page;
  if(reloadHash){
    const rel=id.slice(5);
    const fr=slot?slot.querySelector('iframe.pdf-main-frame'):$('#pdfMainFrame');
    if(fr){
      // Chromium/WebView2 PDFium ignores hash-only (#page= / #view=) updates on an existing iframe;
      // replacing the iframe with a fresh query-busted URL forces PDFium to jump to the target page & zoom.
      const nextUrl=buildPdfUrl(rel,st,true);
      const clone=fr.cloneNode(false);
      clone.src=nextUrl;
      fr.replaceWith(clone);
    }
  }
}
function closePdfDds(){
  document.querySelectorAll('.pdf-dd.open').forEach(d=>d.classList.remove('open'));
}
function togglePdfDd(btn){
  const dd=btn?.closest('.pdf-dd');
  if(!dd) return;
  const was=dd.classList.contains('open');
  closePdfDds();
  if(!was) dd.classList.add('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest?.('.pdf-dd')) closePdfDds();
});

function setPdfFilter(id,flt){
  const targetId=id||active;
  const st=getPdfState(targetId);
  st.filter=(flt==='night'||flt==='sepia'||flt==='normal')?flt:'normal';
  persistUiState({agydesk_pdf_filter:st.filter});
  updatePdfFrame(targetId,false);
}
function setPdfZoom(id,zm){
  const st=getPdfState(id);
  st.zoom=zm;
  updatePdfFrame(id,true);
}
function stepPdfZoom(id,dir){
  const st=getPdfState(id);
  const steps=[75,90,100,115,125,150,175,200];
  let cur=typeof st.zoom==='number'?st.zoom:100;
  let idx=steps.findIndex(x=>x>=cur);
  if(idx===-1) idx=steps.length-1;
  idx=Math.max(0,Math.min(steps.length-1,idx+dir));
  st.zoom=steps[idx];
  updatePdfFrame(id,true);
}
function stepPdfPage(id,delta){
  const st=getPdfState(id);
  const maxP=st.totalPages||999;
  st.page=Math.max(1,Math.min(maxP,(st.page||1)+delta));
  updatePdfFrame(id,true);
}
function jumpPdfPage(id,val){
  const st=getPdfState(id);
  const maxP=st.totalPages||999;
  const n=parseInt(val,10);
  if(!isNaN(n)&&n>=1){
    st.page=Math.min(maxP,n);
    updatePdfFrame(id,true);
  }
}
function togglePdfDrawer(id,mode){
  const st=getPdfState(id);
  st.drawer=(st.drawer===mode)?null:mode;
  renderPdfDrawer(id);
}
function renderPdfDrawer(id){
  const st=getPdfState(id);
  const slot=getPdfSlot(id);
  const root=slot||document;
  const dr=slot?slot.querySelector('.pdf-side-drawer'):$('#pdfDrawer');
  if(!dr) return;
  root.querySelectorAll('.pdf-drw-btn').forEach(b=>b.classList.toggle('on',b.dataset.drw===st.drawer));
  if(!st.drawer){
    dr.classList.remove('open');
    return;
  }
  dr.classList.add('open');
  const rel=id.slice(5);
  const p=pages[id]||{t:rel,kasa:''};
  const info=pdfInfoCache[id];
  if(st.drawer==='text'){
    const pgs=info&&info.pages_text?info.pages_text:[];
    dr.innerHTML=`
      <div class="pdf-drawer-head">
        <span>🔍 PDF Metin &amp; Formül İnceleyici</span>
        <div style="display:flex;gap:4px">
          ${info&&info.full_text?`<button class="hb" style="padding:2px 7px;font-size:10.5px" onclick="convertPdfToMdNote('${id}')" title="Çıkarılan metni yeni bir Markdown ders notuna dönüştür">📝 Nota Dönüştür</button>`:''}
          <button class="hb" style="padding:2px 6px;font-size:10.5px" onclick="togglePdfDrawer('${id}',null)">✕</button>
        </div>
      </div>
      <div class="pdf-drawer-body">
        ${!info?`<div style="color:var(--mut)"><span class="spin"></span> PDF sayfaları taranıyor…</div>`:
          (info.scanned?`<div class="pdf-pg-card">⚠ Bu PDF taranmış görsel (el yazısı / kamera taraması) içeriyor. Doğrudan metin katmanı bulunamadı ancak sağdaki <b>AI Asistanı</b> veya <b>Skill</b> araçlarıyla analiz edebilirsin.</div>`:
          pgs.filter(x=>x.text).map(x=>`
            <div class="pdf-pg-card">
              <div class="phdr">
                <span style="cursor:pointer" onclick="jumpPdfPage('${id}',${x.page})" title="PDF'de bu sayfaya git">📄 Sayfa ${x.page} ↗</span>
                <div style="display:flex;gap:4px">
                  <button class="hb" style="padding:1px 6px;font-size:10px" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(x.text)}'));toast('✓ Sayfa ${x.page} metni kopyalandı')">⧉ Kopyala</button>
                  <button class="hb" style="padding:1px 6px;font-size:10px" onclick="askAiAboutPdfPage('${id}',${x.page})">◆ AI'a Sor</button>
                </div>
              </div>
              <div style="white-space:pre-wrap;font-family:var(--sans);max-height:180px;overflow:auto">${x.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
            </div>
          `).join(''))}
      </div>`;
  }else if(st.drawer==='scratch'){
    dr.innerHTML=`
      <div class="pdf-drawer-head">
        <span>✎ Hızlı Çalışma &amp; Okuma Notu</span>
        <div style="display:flex;gap:4px">
          <button class="btn" style="padding:2px 8px;font-size:10.5px" onclick="savePdfScratchAsNote('${id}')" title="Bu çalışma notunu kasaya gerçek Markdown notu olarak kaydet">💾 Kasaya Not Olarak Kaydet</button>
          <button class="hb" style="padding:2px 6px;font-size:10.5px" onclick="togglePdfDrawer('${id}',null)">✕</button>
        </div>
      </div>
      <div class="pdf-drawer-body">
        <div style="font-size:11.5px;color:var(--mut)">PDF'i okurken çıkardığın formülleri, önemli noktaları veya soruları buraya not al (otomatik saklanır):</div>
        <textarea class="pdf-scratch" placeholder="# ${p.t} — Çalışma Notlarım\n\n- Kritik formül: $...$\n- Hoca vurgusu: ...">${(st.scratch||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
      </div>`;
    const ta=dr.querySelector('.pdf-scratch');
    if(ta){
      ta.oninput=e=>{
        st.scratch=e.target.value;
        localStorage.setItem('agydesk_scratch_'+id,st.scratch);
      };
      ta.focus();
    }
  }
}
async function convertPdfToMdNote(id){
  const rel=id.slice(5);
  const p=pages[id]||{t:rel,kasa:''};
  const info=pdfInfoCache[id];
  if(!info||!info.full_text){ toast('⚠ Bu PDF dosyasında metin katmanı bulunamadı'); return; }
  const kasa=p.kasa||(rel.includes('/')?rel.split('/')[0]:(currentKasa!=='all'?currentKasa:'Difransiyel_Denklemler'));
  const title=`${p.t.replace(/\.pdf$/i,'')} (Çıkarılmış Not)`;
  const content=`# ${title}\n\n> [!NOTE] **Kaynak PDF Bağlantısı**\n> Bu not ![[${rel}]] dosyasından AgyDesk PDF Stüdyosu ile çıkarılmıştır.\n\n${info.full_text}\n`;
  try{
    const res=await api('/api/note/create',{kasa,title,content});
    await loadVault();
    unlockedNotes.add(res.id);
    openPage(res.id);
    toast(`📝 "${title}" oluşturuldu ve açıldı`,res.id);
  }catch(e){ alert('Not oluşturulamadı: '+e.message); }
}
async function savePdfScratchAsNote(id){
  const st=getPdfState(id);
  const rel=id.slice(5);
  const p=pages[id]||{t:rel,kasa:''};
  const txt=(st.scratch||'').trim();
  if(!txt){ toast('⚠ Kaydedilecek not metni boş'); return; }
  const kasa=p.kasa||(rel.includes('/')?rel.split('/')[0]:(currentKasa!=='all'?currentKasa:'Difransiyel_Denklemler'));
  const baseTitle=p.t.replace(/\.[^.]+$/,'');
  const title=`${baseTitle} — Okuma Notları`;
  const content=`# ${title}\n\n> **İlgili Kaynak:** ![[${rel}]]\n\n${txt}\n`;
  try{
    const res=await api('/api/note/create',{kasa,title,content});
    await loadVault();
    openRightViewer(rel,p.t);
    unlockedNotes.add(res.id);
    openPage(res.id);
    toast(`💾 Çalışma notun kasaya kaydedildi (PDF sağ panele alındı!)`,res.id);
  }catch(e){ alert('Kaydedilemedi: '+e.message); }
}
function askAiAboutPdfPage(id,pgNum){
  const info=pdfInfoCache[id];
  const pgObj=info&&info.pages_text?info.pages_text.find(x=>x.page===pgNum):null;
  const snippet=pgObj&&pgObj.text?pgObj.text.slice(0,1500):'';
  rtab('ai');
  aiSend('side_ai',`Açık olan PDF'in ${pgNum}. sayfasındaki şu içeriği adım adım açıkla ve sınav için kritik noktalarını vurgula:\n\n${snippet}`);
}
function dockDocToRightAndReturn(id){
  const rel=id.slice(5);
  const p=pages[id]||{t:rel};
  const otherTab=openTabs.find(t=>t!==id&&t!=='kasalar')||firstVaultTab();
  openTabs=openTabs.filter(t=>t!==id);
  unlockedNotes.delete(id);
  pruneUnlockedNotes();
  if(!openTabs.length) openTabs=[otherTab];
  active=openTabs[openTabs.length-1];
  removePdfSlot(id);
  if(id.startsWith('note:')&&/\.(pptx?|ppsx)$/i.test(id)) evictPptxPdf(id.slice(5));
  renderTabs(); renderTree(); renderMain();
  openRightViewer(rel,p.t);
  toast('📌 Belge sağ panele sabitlendi, sol/orta alanda notunla yan yana çalışabilirsin');
}
function printPdfFrame(rel){
  const slot=getPdfSlot(active);
  const fr=(slot&&slot.querySelector('iframe.pdf-main-frame'))||$('#pdfMainFrame');
  if(fr&&fr.contentWindow){
    try{ fr.contentWindow.focus(); fr.contentWindow.print(); return; }catch(e){}
  }
  window.print();
}

function evictPptxPdf(rel){
  if(!rel) return;
  fetch('/api/pptx_pdf?rel='+encodeURIComponent(rel),{method:'DELETE'}).catch(()=>{});
}
function evictXlsxPdf(rel){
  if(!rel) return;
  fetch('/api/xlsx_pdf?rel='+encodeURIComponent(rel),{method:'DELETE'}).catch(()=>{});
}
async function openXlsxAsRamPdf(rel,stageEl,btnEl,nightMode){
  if(!stageEl) return;
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='⏳ Excel RAM PDF hazırlanıyor…'; }
  stageEl.style.padding='0';
  stageEl.innerHTML=`<div style="padding:40px;color:var(--mut);text-align:center"><span class="spin"></span> Tablo yatay sayfaya sığdırılıp PDF'e dönüştürülüyor (diskte tutulmaz, kapanınca RAM'den silinir)…</div>`;
  try{
    const url='/api/xlsx_pdf?rel='+encodeURIComponent(rel);
    const resp=await fetch(url);
    if(!resp.ok){
      const msg=await resp.text();
      throw new Error(msg||('HTTP '+resp.status));
    }
    const blob=await resp.blob();
    const blobUrl=URL.createObjectURL(blob);
    const useCssFilter=stageEl.classList.contains('xlsx-stage')&&stageEl.id==='pdfFrameWrap';
    const filt=(!useCssFilter&&nightMode)?'filter:invert(0.90) hue-rotate(180deg) contrast(0.96);':'';
    stageEl.innerHTML=`<iframe src="${blobUrl}#view=FitH" style="flex:1;width:100%;height:100%;min-height:70vh;border:0;background:#fff;${filt}"></iframe>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='⊞ Tablo Görünümüne Dön'; }
  }catch(e){
    stageEl.style.padding='';
    stageEl.innerHTML=`<div style="padding:24px;color:var(--err)"><b>PDF Dönüştürme Hatası</b><p>${escHtml(e.message)}</p></div>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='📄 Tam Görünüm (RAM PDF)'; }
  }
}
function xlsxColLetter(idx){
  let s='', n=idx;
  while(n>=0){ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; }
  return s;
}
function mountXlsxViewer(stageEl,d){
  if(!stageEl) return;
  const sheets=(d&&d.sheets)||[];
  if(!sheets.length){
    stageEl.innerHTML=`<div style="padding:24px;color:var(--mut)">${escHtml((d&&d.note)||'Bu dosyada okunabilir sayfa bulunamadı.')}</div>`;
    return;
  }
  let curIdx=0, filterQ='';
  const render=()=>{
    const sh=sheets[curIdx]||sheets[0];
    const colCount=Math.max(1,sh.col_count||0);
    const allRows=sh.rows||[];
    const q=filterQ.trim().toLowerCase();
    const visible=[];
    allRows.forEach((r,i)=>{
      if(!q || i===0 || r.some(c=>String(c||'').toLowerCase().includes(q))){
        visible.push({idx:i+1, cells:r});
      }
    });
    const tabsHtml=sheets.map((s,i)=>`<button class="xlsx-tab${i===curIdx?' on':''}" data-si="${i}">${escHtml(s.name)}</button>`).join('');
    let th='<tr><th class="xlsx-rn">#</th>';
    for(let c=0;c<colCount;c++) th+=`<th>${xlsxColLetter(c)}</th>`;
    th+='</tr>';
    const tbody=visible.map(({idx,cells})=>{
      let tds=`<td class="xlsx-rn">${idx}</td>`;
      for(let c=0;c<colCount;c++){
        const raw=cells[c]!=null?String(cells[c]):'';
        const isNum=raw!=='' && /^[+-]?\d+([.,]\d+)?(%|₺|\$|€)?$/.test(raw.trim());
        tds+=`<td class="${isNum?'num':''}" title="${escAttr(raw)}">${escHtml(raw)}</td>`;
      }
      return `<tr class="${idx===1?'xlsx-first-row':''}">${tds}</tr>`;
    }).join('');
    const meta=`${visible.length}/${allRows.length} satır · ${colCount} sütun${sh.truncated?' · (kısmi)':''}`;
    stageEl.innerHTML=`
      <div class="xlsx-toolbar">
        <div class="xlsx-tabs">${tabsHtml}</div>
        <div class="xlsx-tools-r">
          <input type="text" class="xlsx-search" placeholder="Tabloda ara…" value="${escAttr(filterQ)}">
          <span class="xlsx-meta mono">${meta}</span>
        </div>
      </div>
      <div class="xlsx-grid-wrap">
        <table class="xlsx-table"><thead>${th}</thead><tbody>${tbody}</tbody></table>
      </div>`;
    stageEl.querySelectorAll('.xlsx-tab').forEach(btn=>{
      btn.onclick=()=>{ curIdx=parseInt(btn.dataset.si,10)||0; render(); };
    });
    const inp=stageEl.querySelector('.xlsx-search');
    if(inp){
      inp.oninput=(ev)=>{
        const pos=ev.target.selectionStart;
        filterQ=ev.target.value;
        render();
        const ni=stageEl.querySelector('.xlsx-search');
        if(ni){ ni.focus(); ni.setSelectionRange(pos,pos); }
      };
    }
  };
  render();
}
async function openPptxAsRamPdf(rel,stageEl,btnEl,filterMode){
  if(!stageEl) return false;
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='⏳ PowerPoint RAM PDF hazırlanıyor…'; }
  stageEl.style.padding='0';
  stageEl.style.overflow='hidden';
  stageEl.innerHTML=`<div style="padding:40px;color:#ccc;text-align:center"><span class="spin"></span> Sunum arka planda PDF'e dönüştürülüyor (diskte dosya tutulmaz, kapanınca RAM'den silinir)…</div>`;
  try{
    const url='/api/pptx_pdf?rel='+encodeURIComponent(rel);
    const resp=await fetch(url);
    if(!resp.ok){
      const msg=await resp.text();
      throw new Error(msg||('HTTP '+resp.status));
    }
    const blob=await resp.blob();
    const blobUrl=URL.createObjectURL(blob);
    const slot=stageEl.closest?.('.pdf-tab-slot');
    if(slot){
      if(slot.dataset.blobUrl){
        try{ URL.revokeObjectURL(slot.dataset.blobUrl); }catch(e){}
      }
      slot.dataset.blobUrl=blobUrl;
    }
    const useCssFilter=stageEl.classList.contains('pptx-stage');
    let filt='';
    if(!useCssFilter){
      const mode=(typeof filterMode==='string')?filterMode:(filterMode?'night':'normal');
      const f=(RV_MODES[mode]||RV_MODES.normal).filt;
      if(f&&f!=='none') filt=`filter:${f};`;
    }
    stageEl.innerHTML=`<iframe class="pdf-main-frame" src="${blobUrl}#view=FitH" style="flex:1;width:100%;height:100%;min-height:0;border:0;background:#fff;transition:filter .2s;${filt}"></iframe>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='⚡ Hızlı Slaytlar'; }
    return true;
  }catch(e){
    stageEl.style.padding='';
    stageEl.style.overflow='auto';
    stageEl.innerHTML=`<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">PDF Dönüştürme Hatası</h2></div><div class="pptx-slide-body"><p>${escHtml(e.message)}</p></div></div>`;
    if(btnEl){ btnEl.disabled=false; btnEl.textContent='📄 Tam Görünüm (RAM PDF)'; }
    return false;
  }
}
function renderPptxSlidesHtml(d){
  if(d&&d.note) return `<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">${escHtml(d.title||'Sunum')}</h2><span class="pptx-slide-num">Bilgi</span></div><div class="pptx-slide-body"><p>${escHtml(d.note)}</p></div></div>`;
  const slides=(d&&d.slides)||[];
  if(!slides.length) return `<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">${escHtml((d&&d.title)||'Sunum')}</h2></div><div class="pptx-slide-body"><p>Bu sunumda okunabilir metin veya görsel slayt bulunamadı.</p></div></div>`;
  const sw=(d&&d.slide_w)||9144000, sh=(d&&d.slide_h)||6858000;
  return slides.map(s=>{
    const els=s.elements||[];
    if(els.length){
      const inner=els.map(el=>{
        const st=`left:${el.x.toFixed(2)}%;top:${el.y.toFixed(2)}%;width:${el.w.toFixed(2)}%;height:${el.h.toFixed(2)}%;`;
        if(el.kind==='pic'){
          return `<img class="pptx-el-pic" src="${el.src}" style="${st}" loading="lazy">`;
        }
        const prst=el.prst||'rect';
        if(prst==='line'||prst.includes('Arrow')||prst.includes('Connector')){
          const col=el.stroke||'#334155';
          return `<svg style="position:absolute;${st}pointer-events:none;overflow:visible" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="50" x2="96" y2="50" stroke="${col}" stroke-width="3"/><polygon points="92,35 100,50 92,65" fill="${col}"/></svg>`;
        }
        const bg=el.fill?`background:${el.fill};`:'';
        const bd=el.stroke?`border:1.5px solid ${el.stroke};`:'';
        const rad=prst==='ellipse'?'border-radius:50%;':(prst==='roundRect'?'border-radius:10px;':'');
        const ps=(el.paras||[]).map(t=>`<p>${escHtml(t)}</p>`).join('');
        return `<div class="pptx-el-shape${el.is_title?' is-title':''}" style="${st}${bg}${bd}${rad}">${ps}</div>`;
      }).join('');
      return `<section class="pptx-canvas-wrap" id="slide-${s.num}"><div class="pptx-canvas" style="aspect-ratio:${sw}/${sh}">${inner}<span class="pptx-canvas-badge">${s.num} / ${slides.length}</span></div></section>`;
    }
    const imgs=(s.images&&s.images.length)?`<div class="pptx-slide-imgs">${s.images.map(src=>`<img src="${src}" loading="lazy">`).join('')}</div>`:'';
    const body=(s.lines&&s.lines.length)?`<div class="pptx-slide-body">${s.lines.map(ln=>`<p>${escHtml(ln)}</p>`).join('')}</div>`:'';
    return `<section class="pptx-slide" id="slide-${s.num}">
      <div class="pptx-slide-head">
        <h2 class="pptx-slide-title">${escHtml(s.title||('Slayt '+s.num))}</h2>
        <span class="pptx-slide-num">Slayt ${s.num} / ${slides.length}</span>
      </div>
      ${body}
      ${imgs}
    </section>`;
  }).join('');
}

async function renderVaultNote(m,id){
  const rel=id.slice(5);
  const p=pages[id]||{t:decodeURIComponent(rel.split('/').pop()||rel),folder:'Obsidian Kasası',ext:(rel.includes('.')?rel.slice(rel.lastIndexOf('.')).toLowerCase():'.md')};
  const ext=(p.ext||(rel.includes('.')?rel.slice(rel.lastIndexOf('.')).toLowerCase():'.md')).toLowerCase();

  if(ext==='.pdf'){
    const st=getPdfState(id);
    const isSrcChecked=checkedSources.has(rel);
    const filtCls=st.filter==='night'?'night':(st.filter==='sepia'?'sepia':'');
    const stage=$('#pdfCacheStage');
    let slot=getPdfSlot(id);
    if(slot&&stage&&slot.parentElement===stage){
      activatePdfCache(id);
      const aiBtn=slot.querySelector('.pdf-ai-btn');
      if(aiBtn){
        aiBtn.style.borderColor=isSrcChecked?'var(--ok)':'';
        aiBtn.style.color=isSrcChecked?'var(--ok)':'';
        aiBtn.textContent=isSrcChecked?'✓ AI Kaynağı':'＋ AI\'a Bağla';
      }
      updatePdfFrame(id,false);
      updateRightProps();
      return;
    }
    if(slot){ slot.remove(); pdfSlotMap.delete(id); }

    const modeMeta={normal:{ic:'☀',lbl:'Orijinal'},night:{ic:'🌙',lbl:'Gece'},sepia:{ic:'📜',lbl:'Sepya'}}[st.filter||'normal']||{ic:'☀',lbl:'Orijinal'};
    slot=document.createElement('div');
    slot.className='pdf-tab-slot active';
    slot.dataset.pdfId=id;
    slot.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}">
          <span>📄</span><b>${p.t}</b>
        </div>
        <span class="pdf-badge pdf-meta-badge">${st.totalPages?`${st.totalPages} sayfa`:'PDF Stüdyosu'}</span>

        <span style="flex:1"></span>

        <div class="pdf-dd" title="Okuma Modu">
          <button class="hb" onclick="event.stopPropagation();togglePdfDd(this)">${modeMeta.ic} ${modeMeta.lbl} ▾</button>
          <div class="pdf-dd-menu">
            <button data-flt="normal" class="${st.filter==='normal'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'normal');closePdfDds()">☀ Orijinal</button>
            <button data-flt="night" class="${st.filter==='night'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'night');closePdfDds()">🌙 Gece</button>
            <button data-flt="sepia" class="${st.filter==='sepia'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'sepia');closePdfDds()">📜 Sepya</button>
          </div>
        </div>

        <div class="pdf-grp">
          <button class="pdf-drw-btn ${st.drawer==='text'?'on':''}" data-drw="text" onclick="togglePdfDrawer('${id}','text')" title="PDF içindeki metinleri ve formülleri sayfa sayfa incele / kopyala">🔍 Metin &amp; OCR</button>
          <button class="pdf-drw-btn ${st.drawer==='scratch'?'on':''}" data-drw="scratch" onclick="togglePdfDrawer('${id}','scratch')" title="PDF okurken yan tarafta hızlı çalışma notu tut">✎ Not Tut</button>
        </div>

        <div class="pdf-dd">
          <button class="hb pdf-ai-btn" style="${isSrcChecked?'border-color:var(--ok);color:var(--ok)':'border-color:var(--cu);color:var(--cu)'}" onclick="event.stopPropagation();togglePdfDd(this)" title="AI Araçları">✨ AI ▾</button>
          <div class="pdf-dd-menu">
            <button class="${isSrcChecked?'on':''}" onclick="onSourceCheck('${rel}',!checkedSources.has('${rel}'));closePdfDds();renderMain()">${isSrcChecked?'✓ AI Kaynağı (Çıkar)':'＋ AI Kaynağına Bağla'}</button>
            <button onclick="checkedSources.add('${rel}');rebuildTreeAndSources();closePdfDds();runSkill('ozet')">✨ AI ile Özetle</button>
            <button onclick="checkedSources.add('${rel}');rebuildTreeAndSources();closePdfDds();runSkill('fisle')">▤ A4 Sınav Föyü Çıkar</button>
          </div>
        </div>

        <button class="hb" onclick="dockDocToRightAndReturn('${id}')" title="Bu PDF'i sağ panele sabitleyip not sekmene geri dön (Yan Yana Çalışma)">📌 Sağ Panele Al</button>
      </div>
      <div class="pdf-stage">
        <div class="pdf-frame-wrap ${filtCls}">
          <iframe class="pdf-main-frame" src="${buildPdfUrl(rel,st)}"></iframe>
        </div>
        <div class="pdf-side-drawer ${st.drawer?'open':''}"></div>
      </div>
    </div>`;
    if(stage){
      stage.appendChild(slot);
      pdfSlotMap.set(id,slot);
      activatePdfCache(id);
    }else{
      m.innerHTML='';
      m.appendChild(slot);
      pdfSlotMap.set(id,slot);
    }
    if(st.drawer) renderPdfDrawer(id);
    if(!pdfInfoCache[id]){
      api('/api/pdf_info?rel='+encodeURIComponent(rel)).then(info=>{
        pdfInfoCache[id]=info;
        st.totalPages=info.pages||0;
        const b=slot.querySelector('.pdf-meta-badge');
        if(b) b.textContent=`${info.pages||'?'} sayfa · ${info.size_kb} KB${info.scanned?' · Taranmış':''}`;
        if(st.drawer==='text') renderPdfDrawer(id);
        updateRightProps();
      }).catch(()=>{});
    }else{
      const info=pdfInfoCache[id];
      st.totalPages=info.pages||0;
      const b=slot.querySelector('.pdf-meta-badge');
      if(b) b.textContent=`${info.pages||'?'} sayfa · ${info.size_kb} KB${info.scanned?' · Taranmış':''}`;
    }
    updateRightProps();
    return;
  }

  if(/\.(pptx?|ppsx)$/i.test(ext)){
    const st=getPdfState(id);
    const isSrcChecked=checkedSources.has(rel);
    const filtCls=st.filter==='night'?'night':(st.filter==='sepia'?'sepia':'');
    const cacheStage=$('#pdfCacheStage');
    let slot=getPdfSlot(id);
    if(slot&&cacheStage&&slot.parentElement===cacheStage){
      activatePdfCache(id);
      const aiBtn=slot.querySelector('.pdf-ai-btn');
      if(aiBtn){
        aiBtn.style.borderColor=isSrcChecked?'var(--ok)':'var(--cu)';
        aiBtn.style.color=isSrcChecked?'var(--ok)':'var(--cu)';
      }
      updatePdfFrame(id,false);
      updateRightProps();
      return;
    }
    if(slot){ disposePdfSlot(slot); pdfSlotMap.delete(id); }

    const modeMeta={normal:{ic:'☀',lbl:'Orijinal'},night:{ic:'🌙',lbl:'Gece'},sepia:{ic:'📜',lbl:'Sepya'}}[st.filter||'normal']||{ic:'☀',lbl:'Orijinal'};
    slot=document.createElement('div');
    slot.className='pdf-tab-slot active';
    slot.dataset.pdfId=id;
    slot.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}"><span>📊</span><b>${p.t}</b></div>
        <span class="pdf-badge pptx-meta-badge">Sunum · PDF Görünümü</span>
        <span style="flex:1"></span>
        <div class="pdf-dd" title="Okuma Modu">
          <button class="hb" onclick="event.stopPropagation();togglePdfDd(this)">${modeMeta.ic} ${modeMeta.lbl} ▾</button>
          <div class="pdf-dd-menu">
            <button data-flt="normal" class="${st.filter==='normal'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'normal');closePdfDds()">☀ Orijinal</button>
            <button data-flt="night" class="${st.filter==='night'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'night');closePdfDds()">🌙 Gece</button>
            <button data-flt="sepia" class="${st.filter==='sepia'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'sepia');closePdfDds()">📜 Sepya</button>
          </div>
        </div>
        <div class="pdf-dd">
          <button class="hb pdf-ai-btn" style="${isSrcChecked?'border-color:var(--ok);color:var(--ok)':'border-color:var(--cu);color:var(--cu)'}" onclick="event.stopPropagation();togglePdfDd(this)" title="AI Araçları">✨ AI ▾</button>
          <div class="pdf-dd-menu">
            <button class="${isSrcChecked?'on':''}" onclick="onSourceCheck('${escAttr(rel)}',!checkedSources.has('${escAttr(rel)}'));closePdfDds();renderMain()">${isSrcChecked?'✓ AI Kaynağı (Çıkar)':'＋ AI Kaynağına Bağla'}</button>
            <button onclick="checkedSources.add('${escAttr(rel)}');rebuildTreeAndSources();closePdfDds();runSkill('ozet')">✨ AI ile Özetle</button>
            <button onclick="checkedSources.add('${escAttr(rel)}');rebuildTreeAndSources();closePdfDds();runSkill('fisle')">▤ A4 Sınav Föyü Çıkar</button>
          </div>
        </div>
        <button class="hb pptx-ram-btn" style="border-color:var(--cu);color:var(--cu)" title="Tam Görünüm (RAM PDF) ile Hızlı Slaytlar arasında geçiş yap">⚡ Hızlı Slaytlar</button>
        <button class="hb" onclick="openExternalTarget(null,'${escAttr(rel)}')" title="PowerPoint uygulamasında aç">↗ Uygulamada Aç</button>
        <button class="hb" onclick="dockDocToRightAndReturn(this.closest('.pdf-tab-slot')?.dataset.pdfId||active)">📌 Sağ Panele Al</button>
        <button class="hb" onclick="printPdfFrame('${escAttr(rel)}')" title="Sunumu PDF olarak kaydet / A4 Yazdır">🖨</button>
      </div>
      <div class="pptx-stage ${filtCls}">
        <div style="padding:40px;color:#ccc"><span class="spin"></span> Sunum tam görünüm (RAM PDF) hazırlanıyor…</div>
      </div>
    </div>`;
    if(cacheStage){
      cacheStage.appendChild(slot);
      pdfSlotMap.set(id,slot);
      activatePdfCache(id);
    }else{
      m.innerHTML='';
      m.appendChild(slot);
      pdfSlotMap.set(id,slot);
    }
    let pptxMode='pdf', pptxData=null;
    const ramBtn=slot.querySelector('.pptx-ram-btn');
    const stage=slot.querySelector('.pptx-stage');
    const b=slot.querySelector('.pptx-meta-badge');
    const showFastSlides=async ()=>{
      if(!pptxData) pptxData=await api('/api/pptx?rel='+encodeURIComponent(rel));
      if(stage){ stage.style.padding=''; stage.style.overflow='auto'; stage.innerHTML=renderPptxSlidesHtml(pptxData); }
      if(ramBtn) ramBtn.textContent='📄 Tam Görünüm (RAM PDF)';
      if(b) b.textContent=`${pptxData.count||0} slayt · Hızlı Görünüm`;
    };
    if(ramBtn) ramBtn.onclick=async ()=>{
      if(pptxMode==='pdf'){
        pptxMode='fast';
        try{ await showFastSlides(); }catch(e){ if(stage) stage.innerHTML=`<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">Sunum okunamadı</h2></div><div class="pptx-slide-body"><p>${escHtml(e.message)}</p></div></div>`; }
      }else{
        pptxMode='pdf';
        const ok=await openPptxAsRamPdf(rel,stage,ramBtn,st.filter);
        if(ok&&b) b.textContent='RAM PDF · Tam Görünüm';
      }
    };
    const okPdf=await openPptxAsRamPdf(rel,stage,ramBtn,st.filter);
    if(okPdf){
      if(b) b.textContent='RAM PDF · Tam Görünüm';
    }else{
      pptxMode='fast';
      try{
        await showFastSlides();
      }catch(e){
        if(stage) stage.innerHTML=`<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">Sunum okunamadı</h2></div><div class="pptx-slide-body"><p>${escHtml(e.message)}</p></div></div>`;
      }
    }
    updateRightProps();
    return;
  }

  if(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)){
    const st=getPdfState(id);
    if(typeof st.imgZoom!=='number') st.imgZoom=100;
    if(typeof st.imgRot!=='number') st.imgRot=getSavedImgRot(id);
    if(typeof st.imgInv!=='boolean') st.imgInv=false;
    const filtCls=st.filter==='night'?'night':(st.filter==='sepia'?'sepia':'');
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap"><span>🖼</span><b>${p.t}</b></div>
        <span class="pdf-badge">${p.folder||''}</span>
        <div class="pdf-grp">
          <button onclick="const s=getPdfState('${id}');s.imgZoom=Math.max(25,(s.imgZoom||100)-25);renderMain()">−</button>
          <span>%${st.imgZoom}</span>
          <button onclick="const s=getPdfState('${id}');s.imgZoom=Math.min(400,(s.imgZoom||100)+25);renderMain()">＋</button>
          <button onclick="const s=getPdfState('${id}');s.imgZoom=100;s.imgRot=0;s.imgInv=false;saveImgRot('${id}',0);renderMain()">Sıfırla</button>
        </div>
        <div class="pdf-grp">
          <button onclick="const s=getPdfState('${id}');s.imgRot=((s.imgRot||0)-90)%360;saveImgRot('${id}',s.imgRot);renderMain()" title="Sola Döndür">↺ 90°</button>
          <button onclick="const s=getPdfState('${id}');s.imgRot=((s.imgRot||0)+90)%360;saveImgRot('${id}',s.imgRot);renderMain()" title="Sağa Döndür">↻ 90°</button>
          <button class="${st.imgInv?'on':''}" onclick="const s=getPdfState('${id}');s.imgInv=!s.imgInv;renderMain()" title="Renkleri Ters Çevir (Şema/Tahta İnceleme)">◑ Kontrast</button>
        </div>
        <div class="pdf-grp" title="Okuma Modu">
          <button class="pdf-flt-btn ${st.filter==='normal'?'on':''}" data-flt="normal" onclick="setPdfFilter(active,'normal')">☀</button>
          <button class="pdf-flt-btn ${st.filter==='night'?'on':''}" data-flt="night" onclick="setPdfFilter(active,'night')">🌙</button>
          <button class="pdf-flt-btn ${st.filter==='sepia'?'on':''}" data-flt="sepia" onclick="setPdfFilter(active,'sepia')">📜</button>
        </div>
        <span style="flex:1"></span>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')" title="Görseli sağ panele sabitleyip nota dön">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()" title="A4 Yazdır">🖨</button>
      </div>
      <div class="img-studio ${filtCls}" id="pdfFrameWrap">
        <div class="img-rot-box" style="zoom:${(st.imgZoom||100)/100}">
          <img src="${rawUrlForRel(rel)}" onload="fitImgStudio(this,${st.imgRot||0})" style="transform:rotate(${st.imgRot||0}deg);${st.imgInv?'filter:invert(0.92) hue-rotate(180deg)':''}">
        </div>
      </div>
    </div>`;
    const imgEl=m.querySelector('.img-studio img');
    if(imgEl&&imgEl.complete) fitImgStudio(imgEl,st.imgRot||0);
    updateRightProps();
    return;
  }

  if(/\.(xlsx?|xlsm|csv)$/i.test(ext)){
    const st=getPdfState(id);
    const isSrcChecked=checkedSources.has(rel);
    const filtCls=st.filter==='night'?'night':(st.filter==='sepia'?'sepia':'');
    const modeMeta={normal:{ic:'☀',lbl:'Orijinal'},night:{ic:'🌙',lbl:'Gece'},sepia:{ic:'📜',lbl:'Sepya'}}[st.filter||'normal']||{ic:'☀',lbl:'Orijinal'};
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}"><span>📗</span><b>${p.t}</b></div>
        <span class="pdf-badge" id="xlsxMetaBadge">Excel · Tablo Görünümü</span>
        <span style="flex:1"></span>
        <div class="pdf-dd" title="Okuma Modu">
          <button class="hb" onclick="event.stopPropagation();togglePdfDd(this)">${modeMeta.ic} ${modeMeta.lbl} ▾</button>
          <div class="pdf-dd-menu">
            <button data-flt="normal" class="${st.filter==='normal'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'normal');closePdfDds()">☀ Orijinal</button>
            <button data-flt="night" class="${st.filter==='night'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'night');closePdfDds()">🌙 Gece</button>
            <button data-flt="sepia" class="${st.filter==='sepia'?'on':''}" onclick="setPdfFilter(this.closest('.pdf-tab-slot')?.dataset.pdfId||active,'sepia');closePdfDds()">📜 Sepya</button>
          </div>
        </div>
        <div class="pdf-dd">
          <button class="hb" style="${isSrcChecked?'border-color:var(--ok);color:var(--ok)':'border-color:var(--cu);color:var(--cu)'}" onclick="event.stopPropagation();togglePdfDd(this)" title="AI Araçları">✨ AI ▾</button>
          <div class="pdf-dd-menu">
            <button class="${isSrcChecked?'on':''}" onclick="onSourceCheck('${rel}',!checkedSources.has('${rel}'));closePdfDds();renderMain()">${isSrcChecked?'✓ AI Kaynağı (Çıkar)':'＋ AI Kaynağına Bağla'}</button>
            <button onclick="checkedSources.add('${rel}');rebuildTreeAndSources();closePdfDds();runSkill('ozet')">✨ AI ile Özetle</button>
          </div>
        </div>
        <button class="hb" id="xlsxRamPdfBtn" style="border-color:var(--cu);color:var(--cu)" title="Excel ile yatay sığdırılmış RAM PDF görünümü aç (diske kaydetmez)">📄 Tam Görünüm</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()" title="A4 Yazdır">🖨</button>
      </div>
      <div class="xlsx-stage ${filtCls}" id="pdfFrameWrap">
        <div style="padding:40px;color:var(--mut)"><span class="spin"></span> Tablo yükleniyor…</div>
      </div>
    </div>`;
    let xlsxMode='grid', xlsxData=null;
    const ramBtn=$('#xlsxRamPdfBtn');
    const stage=$('#pdfFrameWrap');
    const b=$('#xlsxMetaBadge');
    if(ramBtn) ramBtn.onclick=async ()=>{
      if(xlsxMode==='pdf'&&xlsxData){
        xlsxMode='grid';
        mountXlsxViewer(stage,xlsxData);
        ramBtn.textContent='📄 Tam Görünüm (RAM PDF)';
        if(b) b.textContent=`${(xlsxData.sheets||[]).length} sayfa · Tablo Görünümü`;
        evictXlsxPdf(rel);
      }else{
        xlsxMode='pdf';
        await openXlsxAsRamPdf(rel,stage,ramBtn,st.filter==='night');
        if(b) b.textContent='RAM PDF · Yatay Sığdırılmış';
      }
    };
    try{
      const d=await api('/api/xlsx?rel='+encodeURIComponent(rel));
      xlsxData=d;
      if(d&&d.is_legacy_xls){
        xlsxMode='pdf';
        await openXlsxAsRamPdf(rel,stage,ramBtn,st.filter==='night');
        if(b) b.textContent='RAM PDF · Eski .xls';
      }else{
        mountXlsxViewer(stage,d);
        if(b) b.textContent=`${(d.sheets||[]).length} sayfa · Tablo Görünümü`;
      }
    }catch(e){
      if(stage) stage.innerHTML=`<div style="padding:24px;color:var(--err)"><b>Tablo okunamadı</b><p>${escHtml(e.message)}</p></div>`;
    }
    updateRightProps();
    return;
  }

  if(/\.(docx?)$/i.test(ext)){
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap"><span>📘</span><b>${p.t}</b></div>
        <span class="pdf-badge" id="docxMetaBadge">Word Belgesi · ${p.folder||''}</span>
        <span style="flex:1"></span>
        <button class="hb" id="docxRamPdfBtn" style="border-color:var(--cu);color:var(--cu)" title="Word belgesini RAM üzerinde birebir PDF görünümünde aç">📄 Tam Görünüm (RAM PDF)</button>
        <button class="hb" onclick="openExternalTarget(null,'${escAttr(rel)}')" title="Word uygulamasında aç">↗ Uygulamada Aç</button>
        <button class="hb" style="border-color:var(--cu);color:var(--cu)" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('ozet')">✨ AI Özetle</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()">🖨 A4 Yazdır</button>
      </div>
      <div id="docxMainStage" style="flex:1;overflow:auto;display:flex;flex-direction:column;padding:8px 0"><div class="doc" id="docxMainBody"><span class="spin"></span> Word belgesi okunuyor…</div></div>
    </div>`;
    let docxMode='html', docxHtml='';
    const ramBtn=$('#docxRamPdfBtn');
    const stage=$('#docxMainStage');
    const renderDocxHtml=()=>{
      if(!stage) return;
      stage.style.padding='8px 0';
      stage.innerHTML=`<div class="doc" id="docxMainBody"><h1>${p.t}</h1><div class="meta"><span>📘 ${p.folder||''}</span><span>·</span><span>${rel}</span></div><div class="rview-docx" style="padding:0">${docxHtml}</div></div>`;
    };
    if(ramBtn) ramBtn.onclick=async ()=>{
      if(docxMode==='pdf'&&docxHtml){
        docxMode='html';
        renderDocxHtml();
        ramBtn.textContent='📄 Tam Görünüm (RAM PDF)';
      }else{
        docxMode='pdf';
        await openDocxAsRamPdf(rel,stage,ramBtn,false);
      }
    };
    try{
      const d=await api('/api/docx?rel='+encodeURIComponent(rel));
      docxHtml=d.html||'';
      if(d&&d.is_legacy_doc){
        docxMode='pdf';
        await openDocxAsRamPdf(rel,stage,ramBtn,false);
      }else{
        renderDocxHtml();
      }
    }catch(e){
      const host=$('#docxMainBody');
      if(host) host.innerHTML=`<h1>Belge okunamadı</h1><p>${e.message}</p>`;
    }
    updateRightProps();
    return;
  }

  if(ext==='.html'||ext==='.htm'){
    const stage=$('#pdfCacheStage');
    let slot=getPdfSlot(id);
    if(slot&&slot.isConnected){
      activatePdfCache(id);
      updateRightProps();
      return;
    }
    if(slot){ slot.remove(); pdfSlotMap.delete(id); }
    slot=document.createElement('div');
    slot.className='pdf-tab-slot active';
    slot.dataset.pdfId=id;
    slot.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}"><span>${p.i||'🌐'}</span><b>${p.t}</b></div>
        <span class="pdf-badge">${p.folder||''} · ${rel}</span>
        <span style="flex:1"></span>
        <button class="hb" onclick="const s=getPdfSlot('${id}');const f=s&&s.querySelector('iframe.html-main-frame');if(f){f.src=rawUrlForRel('${escAttr(rel)}','_t='+Date.now());}" title="HTML sayfasını baştan yükle (sıfırla)">↻ Yenile</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="toggleZen()">◐ Odak</button>
      </div>
      <iframe class="html-main-frame" src="${rawUrlForRel(rel)}" style="flex:1;border:0;width:100%;background:#fff"></iframe>
    </div>`;
    if(stage){
      stage.appendChild(slot);
      pdfSlotMap.set(id,slot);
      activatePdfCache(id);
    }else{
      m.innerHTML='';
      m.appendChild(slot);
      pdfSlotMap.set(id,slot);
    }
    updateRightProps();
    return;
  }
  if(notionState.saveTimer&&notionState.noteId&&notionState.noteId!==id){
    flushNotionSave(notionState.noteId,false);
  }
  if(!noteCache[id]){
    m.innerHTML=`<div class="doc notion-doc"><div class="notion-topbar"><span class="spin"></span> Not yükleniyor: ${rel}…</div></div>`;
    try{ noteCache[id]=await api('/api/note?rel='+encodeURIComponent(rel)); }
    catch(e){ m.innerHTML=`<div class="doc notion-doc"><h1>Not okunamadı</h1><p>${e.message}</p></div>`; return; }
  }
  const n=noteCache[id];
  updateRightProps();
  const baseDir=n.rel.includes('/')?n.rel.slice(0,n.rel.lastIndexOf('/')):'';
  const isDiffNote=notionState.noteId!==id;
  if(isDiffNote){
    editMode=false;
    notionState.openEditorSet.clear();
  }
  notionState.noteId=id;
  notionState.baseDir=baseDir;
  notionState.frontmatter=splitLeadingFrontmatter(n.content||'').frontmatter;
  notionState.locked=!unlockedNotes.has(id);
  if(notionState.locked) editMode=false;
  const cachedDom=noteDomCache.get(id);
  if(!editMode&&cachedDom&&cachedDom.content===(n.content||'')&&cachedDom.locked===!!notionState.locked){
    noteDomCache.delete(id);
    notionState.blocks=cachedDom.blocks;
    notionUndoInit(id,notionState.blocks);
    m.replaceChildren(cachedDom.node);
    ensureNotionOverlays();
    renderNotionMinimap();
    _mountedNoteScrollId=id;
    restoreMainScroll(id);
    wireDrop();
    wireNoteImages(m,id);
    return;
  }
  notionState.blocks=parseNoteBlocks(n.content||'');
  notionUndoInit(id,notionState.blocks);

  const bodyHtml=editMode
    ?`<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--line);font:12px var(--mono);color:var(--mut)">
        <span></> Ham Markdown Kaynak Kodu Modu</span>
        <div style="display:flex;gap:6px">
          <button class="notion-btn on" onclick="saveActiveNote('${id}')">✨ Notion Tuvaline Dön & Kaydet (Ctrl+S)</button>
        </div>
      </div>
      <textarea class="md-ed" id="mdEd" oninput="scheduleRawMdAutoSave('${id}')">${n.content.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>`
    :`<div id="mdView" class="notion-canvas ${notionState.locked?'locked':''}"></div>
      <div class="notion-tail" onclick="notionAppendBottomBlock('${id}')">
        <span style="color:var(--cu);font-weight:700">＋</span>
        <span>Yeni blok eklemek için tıkla veya herhangi bir satırda <code style="color:var(--cu);background:var(--bg);padding:1px 5px;border-radius:4px">/</code> tuşuna bas…</span>
      </div>`;

  m.innerHTML=`<div class="doc notion-doc ${notionState.locked?'locked':''}" id="doc">
    <div class="notion-topbar">
      <div class="notion-crumb">
        <span class="nc-item" onclick="openKasalarHome(true)" title="Çalışma Alanlarına Dön">❖ Çalışma Alanları</span>
        <span>/</span>
        ${(n.kasa||p.kasa)
          ?`<span class="nc-item" onclick="enterKasa('${n.kasa||p.kasa||''}','write')">📘 ${n.folder}</span>`
          :`<span class="nc-item" onclick="${(!isRootDocGlobal(n)&&n.space)?`enterSpace('${escHtml(n.space)}')`:'openKasalarHome(true)'}" title="Ortak Kök Belge çalışma alanına git">📌 ${n.folder}</span>`}
        <span>/</span>
        <span class="nc-cur">${p.t||n.rel.split('/').pop()}</span>
      </div>
      <span class="notion-lock-pill ${notionState.locked?'locked':''}" id="notionLockPill" onclick="toggleNotionLock('${id}')" title="Notion tarzı kilitle / düzenlemeyi aç">
        ${notionState.locked?'🔒 Kilitli (Salt Okunur)':'🔓 Doğrudan Düzenleme Açık'}
      </span>
      <span class="notion-save-pill saved" id="notionSavePill" onclick="flushNotionSave('${id}',true)" style="cursor:pointer" title="Değişiklikler anında otomatik kaydedilir (Tıkla veya Ctrl+S: Şimdi kaydet)">✓ Kaydedildi</span>
      <div class="notion-actions">
        <button class="notion-btn notion-edit-btn" onclick="openSlashFromTop('${id}')" title="Yeni blok ekle (Başlık, Callout, Matematik, Tablo, Mermaid, AI)">＋ Blok Ekle <small style="opacity:.65">/</small></button>
        <button class="notion-btn notion-edit-btn" onclick="triggerAssetUpload('${id}')" title="Bilgisayardan belge (PDF, Word) veya fotoğraf ekle">📎 Ek Yükle</button>
        <button class="notion-btn" onclick="openNewNoteModal('${n.kasa||p.kasa||''}')" title="Bu kasaya yeni not ekle (Alt+N)">＋ Yeni Not</button>
        <button class="notion-btn notion-edit-btn ${editMode?'on':''}" onclick="toggleEditNote('${id}')" title="Notion Görsel Tuval ile Ham Markdown kodu arasında geçiş yap">${editMode?'✨ Notion Tuval':'</> Markdown'}</button>
        <button class="notion-btn" onclick="window.print()" title="Canon G3080 A4 Yazdır">🖨 A4 Yazdır</button>
        <button class="notion-btn danger" onclick="deleteActiveNote('${id}')" title="Notu Sil">🗑</button>
      </div>
    </div>
    ${bodyHtml}
    <div class="drop" id="drop" onclick="triggerAssetUpload('${id}')" style="cursor:pointer">📎 <b>Bilgisayardan Belge / Fotoğraf Ekle (Tıkla veya Sürükle-Bırak)</b> · PDF, Word, Görsel veya sağdaki <b>Skill</b> kartlarını buraya bırak</div>
    <div id="outs"></div>
  </div>`;
  ensureNotionOverlays();
  if(!editMode){
    _notionLoadingNote=true;
    try{ renderNotionCanvasDOM(); }finally{ _notionLoadingNote=false; }
  }else{
    const mm=$('#notionMinimap'); if(mm) mm.style.display='none';
  }
  _mountedNoteScrollId=id;
  restoreMainScroll(id);
  wireDrop();
  wireNoteImages(m,id);
}

/* ============================================================================
   AGYDESK NOTION BLOCK & LIVE WYSIWYG EDITOR ENGINE
   ============================================================================ */
const notionState={
  noteId:null,
  baseDir:'',
  locked:true,
  blocks:[],
  saveTimer:null,
  slashOpen:false,
  slashBlockIdx:-1,
  slashFilter:'',
  slashSelIdx:0,
  slashMode:'slash', // 'slash' | 'gutter' | 'menu'
  dragIdx:null,
  activeMathChip:null,
  openEditorSet:new Set()
};

const notionUndoStacks=new Map();
let _notionUndoApplying=false;
let _notionLoadingNote=false;
let _notionSnapTimer=null;
let lastNotionEditAt=0;

function cloneNotionBlocks(blocks){
  return JSON.parse(JSON.stringify(blocks||[]));
}
function notionFocusBlockIdx(){
  const ae=document.activeElement;
  const blk=ae&&ae.closest?ae.closest('.nblock'):null;
  if(!blk) return null;
  const n=Number(blk.dataset.bidx);
  return Number.isFinite(n)?n:null;
}
function notionUndoInit(noteId,blocks){
  if(!noteId) return;
  const ser=serializeNoteBlocks(blocks||[]);
  const cur=notionUndoStacks.get(noteId);
  if(cur&&cur.stack.length&&cur.stack[cur.idx]&&cur.stack[cur.idx].ser===ser) return;
  notionUndoStacks.set(noteId,{stack:[{blocks:cloneNotionBlocks(blocks),ser,focusIdx:null}],idx:0});
}
function notionRecordSnapshot(noteId=notionState.noteId,focusIdx=null){
  if(!noteId||_notionUndoApplying||_notionLoadingNote) return;
  if(_notionSnapTimer){ clearTimeout(_notionSnapTimer); _notionSnapTimer=null; }
  const ser=serializeNoteBlocks(notionState.blocks||[]);
  let st=notionUndoStacks.get(noteId);
  if(!st){
    st={stack:[{blocks:cloneNotionBlocks(notionState.blocks),ser,focusIdx}],idx:0};
    notionUndoStacks.set(noteId,st);
    return;
  }
  const cur=st.stack[st.idx];
  if(cur&&cur.ser===ser) return;
  st.stack=st.stack.slice(0,st.idx+1);
  st.stack.push({blocks:cloneNotionBlocks(notionState.blocks),ser,focusIdx});
  if(st.stack.length>60) st.stack.shift();
  st.idx=st.stack.length-1;
  lastNotionEditAt=Date.now();
}
function scheduleNotionUndoSnapshot(delay=340){
  if(_notionUndoApplying||_notionLoadingNote||!notionState.noteId) return;
  const nid=notionState.noteId;
  if(_notionSnapTimer) clearTimeout(_notionSnapTimer);
  _notionSnapTimer=setTimeout(()=>{
    _notionSnapTimer=null;
    if(notionState.noteId===nid) notionRecordSnapshot(nid,notionFocusBlockIdx());
  },delay);
}
function notionUndo(){
  const nid=notionState.noteId;
  if(!nid||notionState.locked||editMode) return false;
  syncAllNotionBlocksFromDOM();
  let st=notionUndoStacks.get(nid);
  if(!st||!st.stack.length) return false;
  const liveSer=serializeNoteBlocks(notionState.blocks||[]);
  if(st.stack[st.idx]&&st.stack[st.idx].ser!==liveSer){
    st.stack=st.stack.slice(0,st.idx+1);
    st.stack.push({blocks:cloneNotionBlocks(notionState.blocks),ser:liveSer,focusIdx:notionFocusBlockIdx()});
    st.idx=st.stack.length-1;
  }
  if(st.idx<=0) return false;
  st.idx--;
  const snap=st.stack[st.idx];
  _notionUndoApplying=true;
  try{
    notionState.blocks=cloneNotionBlocks(snap.blocks);
    const fIdx=snap.focusIdx!==null?Math.min(snap.focusIdx,Math.max(0,notionState.blocks.length-1)):null;
    renderNotionCanvasDOM(fIdx,true);
    scheduleNotionAutoSave(nid);
    toast('↶ Not düzenlemesi geri alındı');
    return true;
  }finally{
    _notionUndoApplying=false;
  }
}
function notionRedo(){
  const nid=notionState.noteId;
  if(!nid||notionState.locked||editMode) return false;
  const st=notionUndoStacks.get(nid);
  if(!st||st.idx>=st.stack.length-1) return false;
  st.idx++;
  const snap=st.stack[st.idx];
  _notionUndoApplying=true;
  try{
    notionState.blocks=cloneNotionBlocks(snap.blocks);
    const fIdx=snap.focusIdx!==null?Math.min(snap.focusIdx,Math.max(0,notionState.blocks.length-1)):null;
    renderNotionCanvasDOM(fIdx,true);
    scheduleNotionAutoSave(nid);
    toast('↷ Not düzenlemesi ileri alındı');
    return true;
  }finally{
    _notionUndoApplying=false;
  }
}

const CALLOUT_TYPES={
  NOTE:{label:'BİLGİ',icon:'📘',title:'Kaynak ve Ders Bilgisi'},
  IMPORTANT:{label:'ÖNEMLİ',icon:'🔥',title:'Kritik Tanım & Kural'},
  WARNING:{label:'UYARI',icon:'⚠️',title:'Hoca Tuzağı & Dikkat'},
  TIP:{label:'İPUCU',icon:'💡',title:'Pratik Çözüm Yolu'},
  CAUTION:{label:'DİKKAT',icon:'🚨',title:'Kritik Uyarı'}
};
const CALLOUT_KEYS=Object.keys(CALLOUT_TYPES);

const NOTION_SLASH_ITEMS=[
  {id:'p',cat:'Temel Bloklar',ic:'¶',t:'Düz Metin / Paragraf',d:'Standart ders notu paragrafı',kbd:'Metin',kw:'metin paragraf text p'},
  {id:'h1',cat:'Temel Bloklar',ic:'H1',t:'Ana Başlık 1',d:'Büyük sayfa veya ünite başlığı',kbd:'#',kw:'baslik 1 h1 heading title'},
  {id:'h2',cat:'Temel Bloklar',ic:'H2',t:'Bölüm Başlığı 2',d:'Alt çizgili ana konu başlığı',kbd:'##',kw:'baslik 2 h2 bolum'},
  {id:'h3',cat:'Temel Bloklar',ic:'H3',t:'Alt Başlık 3',d:'Vurgulu alt konu veya örnek başlığı',kbd:'###',kw:'baslik 3 h3 ornek'},
  {id:'ul',cat:'Temel Bloklar',ic:'•',t:'Madde İşaretli Liste',d:'Sırasız madde listesi oluştur',kbd:'-',kw:'liste madde bullet ul'},
  {id:'ol',cat:'Temel Bloklar',ic:'1.',t:'Numaralı Liste',d:'Adım adım sıralı liste oluştur',kbd:'1.',kw:'numarali liste sirali ol'},
  {id:'todo',cat:'Temel Bloklar',ic:'☑',t:'Yapılacaklar (Checklist)',d:'İşaretlenebilir çalışma/görev kutusu',kbd:'[]',kw:'todo checklist gorev kutu'},
  {id:'callout_NOTE',cat:'Bilgi Kutuları (Callout)',ic:'📘',t:'Bilgi Kutusu [!NOTE]',d:'Ders bilgisi, kaynak veya açıklama kartı',kbd:'!note',kw:'bilgi kutusu note callout'},
  {id:'callout_IMPORTANT',cat:'Bilgi Kutuları (Callout)',ic:'🔥',t:'Önemli Tanım [!IMPORTANT]',d:'Teorem, kanun veya sınav tanım kutusu',kbd:'!imp',kw:'onemli tanim important teorem'},
  {id:'callout_WARNING',cat:'Bilgi Kutuları (Callout)',ic:'⚠️',t:'Hoca Tuzağı / Uyarı [!WARNING]',d:'Sınavlarda sık yapılan hatalar ve tuzaklar',kbd:'!warn',kw:'uyari hoca tuzagi warning dikkat'},
  {id:'callout_TIP',cat:'Bilgi Kutuları (Callout)',ic:'💡',t:'Pratik İpucu [!TIP]',d:'Kısa yol ve mühendislik pratiği',kbd:'!tip',kw:'ipucu tip pratik'},
  {id:'math',cat:'Mühendislik & Akademik',ic:'∑',t:'Matematik Denklemi (LaTeX)',d:'Canlı KaTeX önizlemeli blok denklem ($$)',kbd:'$$',kw:'matematik denklem latex formül katex math'},
  {id:'table',cat:'Mühendislik & Akademik',ic:'▦',t:'Tablo (Canlı Düzenlenebilir)',d:'Satır ve sütunları doğrudan düzenlenen tablo',kbd:'| |',kw:'tablo table karsilastirma'},
  {id:'mermaid',cat:'Mühendislik & Akademik',ic:'◈',t:'Mermaid Akış / Blok Diyagramı',d:'Canlı çizilen akış şeması veya blok diyagram',kbd:'```m',kw:'mermaid diyagram sema akis'},
  {id:'code',cat:'Mühendislik & Akademik',ic:'</>',t:'Kod Bloğu (C / STM32 / Python)',d:'Renklendirilmiş gömülü sistem & analiz kodu',kbd:'```',kw:'kod code c stm32 python matlab'},
  {id:'quote',cat:'Mühendislik & Akademik',ic:'❝',t:'Alıntı Bloğu',d:'Kitap veya referans alıntısı',kbd:'>',kw:'alinti quote'},
  {id:'hr',cat:'Mühendislik & Akademik',ic:'―',t:'Ayırıcı Çizgi',d:'Bölümler arası yatay çizgi',kbd:'---',kw:'cizgi ayirici divider hr'},
  {id:'upload',cat:'Medya & AI',ic:'📎',t:'Belge / Fotoğraf Yükle',d:'Bilgisayardan PDF, Word veya görsel göm',kbd:'Ek',kw:'belge fotograf pdf resim yukle'},
  {id:'ai_expand',cat:'Medya & AI',ic:'✨',t:'AI ile Konuyu Genişlet & Örnekle',d:'Bu konuya sınav sorusu ve detaylı açıklama üret',kbd:'AI',kw:'ai yapay zeka ornek soru acikla'}
];

let _blkUid=1;
const nextBlkId=()=>'nb_'+(++_blkUid)+'_'+Math.random().toString(36).slice(2,6);
const escHtml=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function splitLeadingFrontmatter(md){
  const norm=String(md||'').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if(!norm.startsWith('---\n')) return {frontmatter:'',body:norm};
  const lines=norm.split('\n');
  let hasKv=false;
  const maxLines=Math.min(lines.length,65);
  for(let idx=1;idx<maxLines;idx++){
    const tr=lines[idx].trim();
    if(tr==='---'||tr==='...'){
      if(!hasKv) return {frontmatter:'',body:norm};
      return {
        frontmatter:lines.slice(0,idx+1).join('\n'),
        body:lines.slice(idx+1).join('\n').replace(/^\n+/,'')
      };
    }
    if(tr&&!tr.startsWith('#')&&tr.includes(':')) hasKv=true;
  }
  return {frontmatter:'',body:norm};
}

function parseNoteBlocks(md){
  const fmSplit=splitLeadingFrontmatter(md);
  const lines=fmSplit.body.split('\n');
  const blocks=[];
  let i=0;
  while(i<lines.length){
    const ln=lines[i];
    const trimmed=ln.trim();
    if(!trimmed){ i++; continue; }

    // 1. Fenced code / mermaid / sema
    const fenceM=ln.match(/^\s*```(\w*)(?:[ \t]+([^\n]*))?$/);
    if(fenceM){
      const lang=(fenceM[1]||'').toLowerCase();
      const extra=(fenceM[2]||'').trim();
      const body=[];
      i++;
      while(i<lines.length&&!/^\s*```\s*$/.test(lines[i])){ body.push(lines[i]); i++; }
      if(i<lines.length) i++;
      if(lang==='mermaid') blocks.push({id:nextBlkId(),type:'mermaid',code:body.join('\n')});
      else if(lang==='sema') blocks.push({id:nextBlkId(),type:'sema',name:extra||'rc-lowpass',code:body.join('\n')});
      else blocks.push({id:nextBlkId(),type:'code',lang:lang||'c',code:body.join('\n')});
      continue;
    }

    // 2. Display Math $$ ... $$ (single-line or multi-line, including indented)
    if(/^\s*\$\$/.test(ln)){
      const indent=/^\s{2,}/.test(ln)?1:0;
      const singleM=trimmed.match(/^\$\$([\s\S]+?)\$\$$/);
      if(singleM&&trimmed!=='$$'){
        blocks.push({id:nextBlkId(),type:'math',tex:singleM[1].trim(),indent});
        i++; continue;
      }
      const texLines=[];
      const firstAfter=trimmed.slice(2).trim();
      if(firstAfter) texLines.push(firstAfter);
      i++;
      while(i<lines.length){
        const cur=lines[i].trim();
        if(cur.endsWith('$$')){
          const before=cur.slice(0,-2).trim();
          if(before) texLines.push(before);
          i++; break;
        }
        texLines.push(lines[i]);
        i++;
      }
      blocks.push({id:nextBlkId(),type:'math',tex:texLines.join('\n').trim(),indent});
      continue;
    }

    // 3. Callout or Blockquote (> ...)
    if(/^\s*>\s?/.test(ln)){
      const qLines=[];
      while(i<lines.length&&/^\s*>\s?/.test(lines[i])){
        qLines.push(lines[i].replace(/^\s*>\s?/,''));
        i++;
      }
      const first=qLines[0]||'';
      const coM=first.match(/^\[!(\w+)\]\s*(.*)/);
      if(coM){
        const kind=coM[1].toUpperCase();
        const title=coM[2].trim();
        const bodyLines=qLines.slice(1);
        blocks.push({
          id:nextBlkId(),
          type:'callout',
          kind:CALLOUT_TYPES[kind]?kind:'NOTE',
          title:title||CALLOUT_TYPES[kind]?.title||'Not',
          lines:bodyLines.length?bodyLines:['']
        });
      }else{
        blocks.push({id:nextBlkId(),type:'quote',text:qLines.join('\n')});
      }
      continue;
    }

    // 4. Table (| ... |)
    if(/^\|(.+)\|$/.test(trimmed)){
      const tLines=[];
      while(i<lines.length&&/^\|(.+)\|$/.test(lines[i].trim())){
        tLines.push(lines[i].trim());
        i++;
      }
      const parseRow=r=>r.slice(1,-1).split('|').map(c=>c.trim());
      const headers=parseRow(tLines[0]);
      let aligns=headers.map(()=>':---');
      let startRow=1;
      if(tLines.length>1){
        const cand=parseRow(tLines[1]);
        if(cand.every(c=>/^:?-{2,}:?$/.test(c))){
          aligns=cand;
          startRow=2;
        }
      }
      const rows=tLines.slice(startRow).map(r=>{
        const cells=parseRow(r);
        while(cells.length<headers.length) cells.push('');
        return cells.slice(0,headers.length);
      });
      if(!rows.length) rows.push(headers.map(()=>''));
      blocks.push({id:nextBlkId(),type:'table',headers,aligns,rows});
      continue;
    }

    // 5. Horizontal Rule
    if(/^---+$|^\*\*\*+$/.test(trimmed)){
      blocks.push({id:nextBlkId(),type:'hr'});
      i++; continue;
    }

    // 6. Headings
    if(/^#\s+(.+)/.test(ln)){ blocks.push({id:nextBlkId(),type:'h1',text:RegExp.$1.trim()}); i++; continue; }
    if(/^##\s+(.+)/.test(ln)){ blocks.push({id:nextBlkId(),type:'h2',text:RegExp.$1.trim()}); i++; continue; }
    if(/^###\s+(.+)/.test(ln)){ blocks.push({id:nextBlkId(),type:'h3',text:RegExp.$1.trim()}); i++; continue; }

    // 7. Standalone Embed (![[...]] or ![...](...))
    if(/^!\[\[[^\]]+\]\]$/.test(trimmed)||/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)){
      blocks.push({id:nextBlkId(),type:'embed',raw:trimmed});
      i++; continue;
    }

    // 8. Checklist / Todo (- [ ] or - [x])
    const todoM=ln.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    if(todoM){
      blocks.push({id:nextBlkId(),type:'todo',checked:todoM[2].toLowerCase()==='x',text:todoM[3],indent:todoM[1].length>=2?1:0});
      i++; continue;
    }

    // 9. Bullet List (- or *)
    const ulM=ln.match(/^(\s*)[-*]\s+(.*)/);
    if(ulM){
      blocks.push({id:nextBlkId(),type:'ul',text:ulM[2],indent:ulM[1].length>=2?1:0});
      i++; continue;
    }

    // 10. Numbered List (1. ...)
    const olM=ln.match(/^(\s*)(\d+)\.\s+(.*)/);
    if(olM){
      blocks.push({id:nextBlkId(),type:'ol',num:Number(olM[2])||1,text:olM[3],indent:olM[1].length>=2?1:0});
      i++; continue;
    }

    // 11. Paragraph
    blocks.push({id:nextBlkId(),type:'p',text:ln});
    i++;
  }
  if(!blocks.length){
    blocks.push({id:nextBlkId(),type:'h1',text:''});
    blocks.push({id:nextBlkId(),type:'p',text:''});
  }
  return blocks;
}

function serializeNoteBlocks(blocks,frontmatter){
  const out=[];
  let olCounter=0;
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i];
    const prev=blocks[i-1];
    const next=blocks[i+1];
    if(b.type!=='ol'&&!b.indent) olCounter=0;

    if(b.type==='h1') out.push(`# ${b.text||''}`);
    else if(b.type==='h2') out.push(`## ${b.text||''}`);
    else if(b.type==='h3') out.push(`### ${b.text||''}`);
    else if(b.type==='hr') out.push(`---`);
    else if(b.type==='p') out.push(b.text||'');
    else if(b.type==='todo'){
      const pad=b.indent?'   ':'';
      out.push(`${pad}- [${b.checked?'x':' '}] ${b.text||''}`);
    }else if(b.type==='ul'){
      const pad=b.indent?'   ':'';
      out.push(`${pad}- ${b.text||''}`);
    }else if(b.type==='ol'){
      olCounter=b.indent?1:(olCounter+1);
      const num=b.num||olCounter;
      const pad=b.indent?'   ':'';
      out.push(`${pad}${num}. ${b.text||''}`);
    }else if(b.type==='callout'){
      const head=`> [!${b.kind||'NOTE'}] ${b.title||''}`.trimEnd();
      const body=(b.lines||[]).map(l=>`> ${l}`);
      out.push([head,...body].join('\n'));
    }else if(b.type==='quote'){
      out.push(String(b.text||'').split('\n').map(l=>`> ${l}`).join('\n'));
    }else if(b.type==='math'){
      const pad=b.indent?'   ':'';
      if(String(b.tex||'').includes('\n')) out.push(`${pad}$$\n${b.tex}\n${pad}$$`);
      else out.push(`${pad}$$${b.tex||''}$$`);
    }else if(b.type==='mermaid'){
      out.push('```mermaid\n'+(b.code||'')+'\n```');
    }else if(b.type==='sema'){
      out.push('```sema '+(b.name||'rc-lowpass')+'\n'+(b.code||'')+'\n```');
    }else if(b.type==='code'){
      out.push('```'+(b.lang||'')+'\n'+(b.code||'')+'\n```');
    }else if(b.type==='embed'){
      out.push(b.raw||'');
    }else if(b.type==='table'){
      const hdr=`| ${(b.headers||[]).join(' | ')} |`;
      const alg=`| ${(b.headers||[]).map((_, idx)=>(b.aligns&&b.aligns[idx])||':---').join(' | ')} |`;
      const rws=(b.rows||[]).map(r=>`| ${r.map(c=>String(c||'').replace(/\|/g,'\\|')).join(' | ')} |`);
      out.push([hdr,alg,...rws].join('\n'));
    }

    // Blank line spacing rules for clean Markdown output
    if(next){
      const sameList=(['ul','ol','todo'].includes(b.type)&&['ul','ol','todo'].includes(next.type))
        ||(['ul','ol','todo'].includes(b.type)&&next.type==='math'&&next.indent)
        ||(b.type==='math'&&b.indent&&['ul','ol','todo'].includes(next.type));
      if(!sameList) out.push('');
    }
  }
  const body=out.join('\n')+'\n';
  const fm=(frontmatter!==undefined)?frontmatter:(typeof notionState!=='undefined'&&notionState?notionState.frontmatter:'');
  return fm?(fm+'\n\n'+body):body;
}

/* ---------- Inline Markdown <-> Editable DOM (With Lossless KaTeX & WikiLink Chips) ---------- */
function renderKatexSafe(tex,displayMode=false){
  if(window.katex){
    try{ return katex.renderToString(String(tex||'').trim(),{displayMode,throwOnError:false}); }catch(e){}
  }
  return `<code style="color:var(--cu)">${escHtml(tex)}</code>`;
}

function inlineMdToEditableHtml(md,base){
  const tokens=[];
  const stash=html=>`@@NTOK_${tokens.push(html)-1}@@`;
  let s=String(md||'');

  // 1. Inline Display Math $$...$$
  s=s.replace(/\$\$([^\n]+?)\$\$/g,(_,tex)=>{
    const clean=tex.trim();
    return stash(`<span class="n-math-chip" contenteditable="false" data-tex="${escAttr(clean)}" data-display="1" onclick="openInlineMathPop(this,event)" title="LaTeX formülünü düzenlemek için tıkla: $$${escAttr(clean)}$$">${renderKatexSafe(clean,false)}</span>`);
  });
  // 2. Inline Math $...$
  s=s.replace(/\$([^\$\n]+?)\$/g,(_,tex)=>{
    const clean=tex.trim();
    return stash(`<span class="n-math-chip" contenteditable="false" data-tex="${escAttr(clean)}" data-display="0" onclick="openInlineMathPop(this,event)" title="LaTeX formülünü düzenlemek için tıkla: $${escAttr(clean)}$">${renderKatexSafe(clean,false)}</span>`);
  });
  // 3. WikiLinks & Inline Embeds ![[...]] or [[...]]
  s=s.replace(/(!?\[\[([^\]]+)\]\])/g,(_,raw,inner)=>{
    const isBang=raw.startsWith('!');
    const parts=inner.split('|');
    const target=parts[0].trim();
    const label=(parts[1]||target.split('/').pop()).trim();
    const resolveRel=t=>normalizeVaultAssetRel(t,base);
    if(/\.(pdf|docx?|pptx?|xlsx?|csv|txt|png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(target)){
      const rel=resolveRel(target);
      const safeLbl=label.replace(/'/g,'');
      const ext=target.slice(target.lastIndexOf('.')).toLowerCase();
      const ic=ext==='.pdf'?'📄':(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)?'🖼':'📘');
      return stash(`<span class="n-wiki-chip" contenteditable="false" data-raw="${escAttr(raw)}" data-rel="${escAttr(rel)}" data-lbl="${escAttr(safeLbl)}" onclick="openRightViewer(this.dataset.rel,this.dataset.lbl)" ondblclick="openDocInTab(this.dataset.rel,this.dataset.lbl)" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede aç (${escAttr(rel)})">${ic} ${escHtml(label)}</span>`);
    }
    const {id,label:wLbl}=resolveWiki(inner);
    return stash(`<span class="n-wiki-chip" contenteditable="false" data-raw="${escAttr(raw)}" onclick="${id?`openPage('${escAttr(id)}')`:''}" title=" Bağlantıyı aç: ${escAttr(wLbl)}">📄 ${escHtml(wLbl)}</span>`);
  });

  // 4. Escape HTML
  s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 5. Inline code `...`
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>stash(`<code>${c}</code>`));

  // 6. Standard inline styles
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/\*([^*\n]+)\*/g,'<i>$1</i>');
  s=s.replace(/~~([^~\n]+)~~/g,'<s>$1</s>');
  s=s.replace(/==([^=\n]+)==/g,'<mark>$1</mark>');
  s=s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,'<a href="$2" data-mdlink="$2" onclick="if(event.ctrlKey||notionState.locked){return openTargetLink(event,this.dataset.mdlink);}">$1</a>');

  s=s.replace(/@@NTOK_(\d+)@@/g,(_,idx)=>tokens[+idx]);
  return s;
}

function editableDomToInlineMd(root){
  if(!root) return '';
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE){
      return (node.nodeValue||'').replace(/\u00A0/g,' ');
    }
    if(node.nodeType!==Node.ELEMENT_NODE) return '';
    const el=node;
    if(el.dataset){
      if(el.dataset.tex!==undefined){
        return el.dataset.display==='1'?`$$${el.dataset.tex}$$`:`$${el.dataset.tex}$`;
      }
      if(el.dataset.raw!==undefined){
        return el.dataset.raw;
      }
    }
    const tag=el.tagName.toUpperCase();
    if(tag==='BR') return '';
    let inner='';
    for(const ch of el.childNodes) inner+=walk(ch);
    if(!inner&&tag!=='IMG') return '';
    if(tag==='B'||tag==='STRONG') return `**${inner}**`;
    if(tag==='I'||tag==='EM') return `*${inner}*`;
    if(tag==='S'||tag==='STRIKE'||tag==='DEL') return `~~${inner}~~`;
    if(tag==='U') return `<u>${inner}</u>`;
    if(tag==='MARK') return `==${inner}==`;
    if(tag==='CODE') return `\`${el.textContent||''}\``;
    if(tag==='A') return `[${inner}](${el.getAttribute('data-mdlink')||el.getAttribute('href')||''})`;
    return inner;
  };
  let res='';
  for(const ch of root.childNodes) res+=walk(ch);
  return res.replace(/\n+/g,' ').trimEnd();
}

function syncBlockFromDOM(idx){
  const b=notionState.blocks[idx];
  const view=$('#mdView');
  if(!b||!view) return;
  const blkEl=view.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(!blkEl) return;

  if(['h1','h2','h3','p','ul','ol','todo','quote'].includes(b.type)){
    const ed=blkEl.querySelector('.n-ed');
    if(ed) b.text=editableDomToInlineMd(ed);
  }else if(b.type==='callout'){
    const tEl=blkEl.querySelector('.n-callout-title');
    if(tEl) b.title=editableDomToInlineMd(tEl);
    const lEls=[...blkEl.querySelectorAll('.n-callout-line')];
    if(lEls.length) b.lines=lEls.map(el=>editableDomToInlineMd(el));
  }else if(b.type==='table'){
    const hEls=[...blkEl.querySelectorAll('thead .n-table-cell')];
    if(hEls.length) b.headers=hEls.map(el=>editableDomToInlineMd(el));
    const rEls=[...blkEl.querySelectorAll('tbody tr')];
    if(rEls.length){
      b.rows=rEls.map(tr=>[...tr.querySelectorAll('.n-table-cell')].map(el=>editableDomToInlineMd(el)));
    }
  }
}

function syncAllNotionBlocksFromDOM(){
  for(let i=0;i<notionState.blocks.length;i++) syncBlockFromDOM(i);
}

function setSavePillState(state,text){
  const pill=$('#notionSavePill');
  if(!pill) return;
  pill.className='notion-save-pill '+state;
  pill.textContent=text;
}

function scheduleNotionAutoSave(noteId){
  const id=noteId||notionState.noteId;
  if(!id||!String(id).startsWith('note:')) return;
  if(!_notionUndoApplying) scheduleNotionUndoSnapshot(650);
  setSavePillState('saving','● Kaydediliyor…');
  if(notionState.saveTimer) clearTimeout(notionState.saveTimer);
  notionState.saveTimer=setTimeout(()=>flushNotionSave(id,false),650);
}

function scheduleRawMdAutoSave(id){
  setSavePillState('saving','● Kaydediliyor…');
  if(notionState.saveTimer) clearTimeout(notionState.saveTimer);
  notionState.saveTimer=setTimeout(()=>{
    const ed=$('#mdEd');
    if(!ed||!noteCache[id]) return;
    const rel=id.slice(5);
    noteCache[id].content=ed.value;
  invalidateNoteDomCache(id);
    api('/api/note',{rel,content:ed.value}).then(saved=>{
      const prevScope=JSON.stringify(rootDocSpacesList(pages[id]||noteCache[id]));
      noteCache[id]=saved;
      setSavePillState('saved','✓ Kaydedildi');
      updateRightProps();
      if(!rel.includes('/')&&JSON.stringify(rootDocSpacesList(saved))!==prevScope){ loadVault(); }
    }).catch(()=>{ setSavePillState('saving','⚠ Kayıt hatası'); });
  },700);
}

async function flushNotionSave(noteId,manual=false){
  const id=noteId||notionState.noteId;
  if(!id||!String(id).startsWith('note:')) return;
  if(manual&&notionState.locked&&!notionState.saveTimer&&id===notionState.noteId){
    toast('🔒 Sayfa kilitli (Değişiklik yok)',id);
    return;
  }
  if(notionState.saveTimer){ clearTimeout(notionState.saveTimer); notionState.saveTimer=null; }
  const rel=id.slice(5);
  let md='';
  if(editMode&&$('#mdEd')){
    md=$('#mdEd').value;
  }else{
    syncAllNotionBlocksFromDOM();
    md=serializeNoteBlocks(notionState.blocks);
  }
  if(noteCache[id]) noteCache[id].content=md;
  invalidateNoteDomCache(id);
  setSavePillState('saving','● Kaydediliyor…');
  try{
    const prevScope=JSON.stringify(rootDocSpacesList(pages[id]||noteCache[id]));
    const saved=await api('/api/note',{rel,content:md});
    noteCache[id]=saved;
  invalidateNoteDomCache(id);
    setSavePillState('saved','✓ Kaydedildi');
    updateRightProps();
    renderNotionMinimap();
    if(!rel.includes('/')&&JSON.stringify(rootDocSpacesList(saved))!==prevScope){ loadVault(); }
    if(manual) toast('💾 Not diske kaydedildi: '+rel, id);
  }catch(e){
    setSavePillState('saving','⚠ Kaydedilemedi');
    if(manual) alert('Kaydetme hatası: '+e.message);
  }
}

function renderSingleBlockInnerHTML(b,idx,olSeq){
  const ce=notionState.locked?'false':'true';
  const base=notionState.baseDir;
  const gutter=`<div class="nblock-gutter" contenteditable="false">
    <button class="ng-btn" type="button" onclick="openSlashForBlock(${idx},event)" title="Altına yeni blok ekle (veya '/' yaz)">＋</button>
    <button class="ng-btn drag" type="button" draggable="true" ondragstart="onNotionBlockDragStart(event,${idx})" onclick="openBlockActionMenu(${idx},event)" title="Sürükle: Taşı · Tıkla: Blok Menüsü (Dönüştür, Çoğalt, Sil)">⋮⋮</button>
  </div>`;

  if(b.type==='h1'){
    return `${gutter}<div class="n-ed" contenteditable="${ce}" data-ph="Ana Başlık 1…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='h2'){
    return `${gutter}<div class="n-ed" contenteditable="${ce}" data-ph="Bölüm Başlığı 2…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='h3'){
    return `${gutter}<div class="n-ed" contenteditable="${ce}" data-ph="Alt Başlık 3…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='p'){
    return `${gutter}<div class="n-ed" contenteditable="${ce}" data-ph="Not yazmaya başla veya komutlar için '/' tuşuna bas…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='ul'){
    return `${gutter}<span class="n-bullet" contenteditable="false">•</span><div class="n-ed" contenteditable="${ce}" data-ph="Liste maddesi…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='ol'){
    return `${gutter}<span class="n-ol-num" contenteditable="false">${olSeq}.</span><div class="n-ed" contenteditable="${ce}" data-ph="Sıralı madde…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='todo'){
    return `${gutter}<input type="checkbox" class="n-todo-chk" ${b.checked?'checked':''} ${notionState.locked?'disabled':''} onchange="toggleNotionTodo(${idx},this.checked)"><div class="n-ed" contenteditable="${ce}" data-ph="Yapılacak görev…">${inlineMdToEditableHtml(b.text,base)}</div>`;
  }
  if(b.type==='hr'){
    return `${gutter}<hr style="margin:12px 0;border:0;border-top:1px solid var(--line)">`;
  }
  if(b.type==='quote'){
    return `${gutter}<blockquote><div class="n-ed" contenteditable="${ce}" data-ph="Alıntı metni…">${inlineMdToEditableHtml(b.text,base)}</div></blockquote>`;
  }
  if(b.type==='callout'){
    const meta=CALLOUT_TYPES[b.kind]||CALLOUT_TYPES.NOTE;
    const linesHtml=(b.lines&&b.lines.length?b.lines:['']).map((ln,lIdx)=>
      `<div class="n-callout-line" contenteditable="${ce}" data-lidx="${lIdx}" data-ph="Bilgi satırı ekle…">${inlineMdToEditableHtml(ln,base)}</div>`
    ).join('');
    return `${gutter}<div class="n-callout" data-kind="${b.kind||'NOTE'}">
      <div class="n-callout-head">
        <button type="button" class="n-callout-ic" onclick="cycleCalloutKind(${idx})" title="Kutu türünü değiştir (Bilgi / Önemli / Uyarı / İpucu)">${meta.icon}</button>
        <span class="n-callout-badge" onclick="cycleCalloutKind(${idx})" title="Tıkla: Türü değiştir">${meta.label}</span>
        <div class="n-callout-title" contenteditable="${ce}" data-ph="Kutu başlığı…">${inlineMdToEditableHtml(b.title,base)}</div>
      </div>
      <div class="n-callout-body">${linesHtml}</div>
    </div>`;
  }
  if(b.type==='math'){
    const isOpen=notionState.openEditorSet.has(b.id);
    const syms=['\\frac{a}{b}','\\frac{d^2 y}{dx^2}','\\frac{\\partial u}{\\partial x}','\\sqrt{x}','\\int_{a}^{b}','\\sum_{n=1}^{\\infty}','\\implies','\\alpha','\\theta','\\omega'];
    return `${gutter}<div class="n-math-block ${b.indent?'ind-1':''}" onclick="toggleBlockSubEditor('${b.id}',event)">
      <span class="n-mb-hint">∑ LaTeX Denklemini Düzenle</span>
      <div class="n-math-render" id="mrend_${b.id}">${renderKatexSafe(b.tex,true)}</div>
      <div class="n-block-editor ${isOpen?'open':''}" id="bed_${b.id}" onclick="event.stopPropagation()">
        <div class="n-math-syms">
          ${syms.map(s=>`<button type="button" onclick="insertMathSym('${b.id}','${s.replace(/\\/g,'\\\\')}')">$${s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/,'$1/$2').replace(/\\/g,'')}$</button>`).join('')}
        </div>
        <textarea id="mta_${b.id}" placeholder="LaTeX denklemi yazın (ör. \\frac{d^2y}{dx^2} + y = 0)" oninput="onBlockMathInput(${idx},'${b.id}',this.value)">${escHtml(b.tex)}</textarea>
      </div>
    </div>`;
  }
  if(b.type==='mermaid'){
    const isOpen=notionState.openEditorSet.has(b.id);
    return `${gutter}<div class="cbox" style="margin:8px 0">
      <div class="ctool">
        <span class="clang">◈ Mermaid Diyagramı</span>
        <span class="csep"></span>
        <button type="button" onclick="toggleBlockSubEditor('${b.id}',event)">✎ ${isOpen?'Kapat':'Diyagram Kodu'}</button>
      </div>
      <div class="mermaid" id="merm_${b.id}" style="background:var(--bg);padding:16px;border-radius:10px;border:1px solid var(--line)">${escHtml((b.code||'').trim())}</div>
      <div class="n-block-editor ${isOpen?'open':''}" id="bed_${b.id}" style="background:var(--bg);padding:10px;border:1px solid var(--line);border-top:0;border-radius:0 0 10px 10px">
        <textarea id="mta_${b.id}" style="min-height:110px" oninput="onBlockMermaidInput(${idx},'${b.id}',this.value)">${escHtml(b.code)}</textarea>
      </div>
    </div>`;
  }
  if(b.type==='code'){
    const isOpen=notionState.openEditorSet.has(b.id);
    const key=(b.lang||'c').toLowerCase();
    const lbl=LANG_NAMES[key]||(key?key.toUpperCase():'Kod');
    const esc=escHtml(b.code||'');
    return `${gutter}<div class="cbox" style="margin:8px 0">
      <div class="ctool">
        <span class="clang">${lbl}</span>
        <span class="csep"></span>
        <button type="button" onclick="toggleBlockSubEditor('${b.id}',event)" title="Kodu düzenle">✎ Düzenle</button>
        <button type="button" onclick="copyBlock(this)" title="Kodu kopyala">⧉</button>
        <button type="button" onclick="wrapBlock(this)" title="Satır kaydırma">↵</button>
      </div>
      <pre onclick="if(!notionState.locked)toggleBlockSubEditor('${b.id}',event)"><code id="chl_${b.id}">${hlCode(esc,key)}</code></pre>
      <div class="n-block-editor ${isOpen?'open':''}" id="bed_${b.id}" style="background:var(--bg);padding:10px;border:1px solid var(--line);border-top:0;border-radius:0 0 10px 10px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font:11px var(--mono);color:var(--mut)">Dil:</span>
          <select class="nb-sel" onchange="onBlockCodeLang(${idx},'${b.id}',this.value)">
            ${['c','cpp','py','matlab','js','bash','spice','vhdl','txt'].map(l=>`<option value="${l}" ${l===key?'selected':''}>${LANG_NAMES[l]||l.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <textarea id="mta_${b.id}" style="min-height:120px" oninput="onBlockCodeInput(${idx},'${b.id}',this.value)">${escHtml(b.code)}</textarea>
      </div>
    </div>`;
  }
  if(b.type==='sema'){
    return `${gutter}${wrapWindow(`<div class="sema">${semaSvg(b.name)}</div>`,'Devre Şeması · '+b.name,false)}`;
  }
  if(b.type==='embed'){
    return `${gutter}<div>${mdToHtml(b.raw,base)}</div>`;
  }
  if(b.type==='table'){
    const ths=(b.headers||[]).map((h,cIdx)=>`<th><div class="n-table-cell" contenteditable="${ce}" data-r="-1" data-c="${cIdx}">${inlineMdToEditableHtml(h,base)}</div></th>`).join('');
    const trs=(b.rows||[]).map((r,rIdx)=>`<tr>${r.map((cell,cIdx)=>`<td><div class="n-table-cell" contenteditable="${ce}" data-r="${rIdx}" data-c="${cIdx}">${inlineMdToEditableHtml(cell,base)}</div></td>`).join('')}</tr>`).join('');
    return `${gutter}<div class="n-table-wrap">
      <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
      <div class="n-table-bar" contenteditable="false">
        <button type="button" class="n-tbtn" onclick="notionTableAddRow(${idx})">＋ Satır Ekle</button>
        <button type="button" class="n-tbtn" onclick="notionTableAddCol(${idx})">＋ Sütun Ekle</button>
        ${(b.rows||[]).length>1?`<button type="button" class="n-tbtn" onclick="notionTableDelRow(${idx})">− Son Satırı Sil</button>`:''}
        ${(b.headers||[]).length>1?`<button type="button" class="n-tbtn" onclick="notionTableDelCol(${idx})">− Son Sütunu Sil</button>`:''}
      </div>
    </div>`;
  }
  return `${gutter}<div class="n-ed" contenteditable="${ce}">${inlineMdToEditableHtml(b.text||'',base)}</div>`;
}

function blockClassFor(b){
  if(b.type==='h1') return 'nblock nblock-h1';
  if(b.type==='h2') return 'nblock nblock-h2';
  if(b.type==='h3') return 'nblock nblock-h3';
  if(b.type==='p') return 'nblock nblock-p';
  if(b.type==='ul'||b.type==='ol') return `nblock nblock-list ${b.indent?'ind-1':''}`;
  if(b.type==='todo') return `nblock nblock-list nblock-todo ${b.checked?'done':''} ${b.indent?'ind-1':''}`;
  if(b.type==='quote') return 'nblock nblock-quote';
  return `nblock nblock-${b.type}`;
}

function renderNotionCanvasDOM(focusIdx=null,caretAtEnd=true){
  const view=$('#mdView');
  if(!view) return;
  view.classList.toggle('locked',!!notionState.locked);
  let olSeq=0;
  const html=notionState.blocks.map((b,idx)=>{
    if(b.type==='ol') olSeq=b.indent?1:(olSeq+1);
    else if(!b.indent) olSeq=0;
    return `<div class="${blockClassFor(b)}" data-bidx="${idx}" data-bid="${b.id}" ondragover="onNotionBlockDragOver(event,${idx})" ondragleave="onNotionBlockDragLeave(event)" ondrop="onNotionBlockDrop(event,${idx})">${renderSingleBlockInnerHTML(b,idx,b.num||olSeq)}</div>`;
  }).join('');
  view.innerHTML=html;
  wireNotionCanvasEvents(view);
  renderNotionMinimap();
  if(window.mermaid) runMermaid('#mdView .mermaid');
  if(!_notionUndoApplying&&!_notionLoadingNote&&notionState.noteId){
    notionRecordSnapshot(notionState.noteId,focusIdx!==null?focusIdx:notionFocusBlockIdx());
  }
  if(focusIdx!==null&&focusIdx>=0&&focusIdx<notionState.blocks.length){
    focusNotionBlock(focusIdx,caretAtEnd);
  }
}

function focusNotionBlock(idx,toEnd=true){
  const view=$('#mdView'); if(!view) return;
  const blk=view.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(!blk) return;
  const target=blk.querySelector('.n-ed, .n-callout-title, .n-callout-line, .n-table-cell, textarea');
  if(!target) return;
  target.focus();
  if(target.tagName==='TEXTAREA'){
    const len=target.value.length;
    target.setSelectionRange(toEnd?len:0,toEnd?len:0);
    return;
  }
  const sel=window.getSelection();
  const range=document.createRange();
  range.selectNodeContents(target);
  range.collapse(!toEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getCaretTextOffset(el){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount) return 0;
  const r=sel.getRangeAt(0);
  const pre=r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer,r.startOffset);
  return pre.toString().length;
}

function wireNotionCanvasEvents(view){
  let gutterHideTimer=null;
  let hoveredBlk=null;
  const clearGutterTimer=()=>{ if(gutterHideTimer){ clearTimeout(gutterHideTimer); gutterHideTimer=null; } };
  view.onmouseover=e=>{
    const blk=e.target.closest('.nblock');
    if(!blk||!view.contains(blk)) return;
    clearGutterTimer();
    if(hoveredBlk&&hoveredBlk!==blk) hoveredBlk.classList.remove('gutter-open');
    hoveredBlk=blk;
    blk.classList.add('gutter-open');
  };
  view.onmouseleave=()=>{
    clearGutterTimer();
    gutterHideTimer=setTimeout(()=>{
      if(hoveredBlk){ hoveredBlk.classList.remove('gutter-open'); hoveredBlk=null; }
    },240);
  };
  view.onfocusin=e=>{
    view.querySelectorAll('.nblock.focused').forEach(x=>x.classList.remove('focused'));
    const blk=e.target.closest('.nblock');
    if(blk) blk.classList.add('focused');
  };

  view.oninput=e=>{
    if(notionState.locked) return;
    const t=e.target;
    const blkEl=t.closest('.nblock');
    if(!blkEl) return;
    const idx=Number(blkEl.dataset.bidx);
    const b=notionState.blocks[idx];
    if(!b) return;

    // Check live Markdown auto-shortcuts at start of .n-ed
    if(t.classList.contains('n-ed')){
      const rawTxt=(t.textContent||'').replace(/\u00A0/g,' ');

      // 1) Block-level prefixes (# , ## , ### , - , 1. , [] , > , --- , $$, ```)
      const turnMap=[
        {re:/^#\s(.*)$/,type:'h1'},
        {re:/^##\s(.*)$/,type:'h2'},
        {re:/^###\s(.*)$/,type:'h3'},
        {re:/^[-*]\s\[([ xX])\]\s(.*)$/,type:'todo'},
        {re:/^\[\]\s(.*)$/,type:'todo_empty'},
        {re:/^[-*]\s(.*)$/,type:'ul'},
        {re:/^(\d+)\.\s(.*)$/,type:'ol'},
        {re:/^>\s(.*)$/,type:'quote'},
        {re:/^!note\s(.*)$/i,type:'callout_NOTE'},
        {re:/^!warn\s(.*)$/i,type:'callout_WARNING'},
        {re:/^!imp\s(.*)$/i,type:'callout_IMPORTANT'}
      ];
      for(const rule of turnMap){
        const m=rawTxt.match(rule.re);
        if(m){
          if(rule.type==='todo'){ b.type='todo'; b.checked=m[1].toLowerCase()==='x'; b.text=m[2]; }
          else if(rule.type==='todo_empty'){ b.type='todo'; b.checked=false; b.text=m[1]; }
          else if(rule.type==='ol'){ b.type='ol'; b.num=Number(m[1])||1; b.text=m[2]; }
          else if(rule.type.startsWith('callout_')){
            b.type='callout'; b.kind=rule.type.split('_')[1]; b.title=m[1]||CALLOUT_TYPES[b.kind].title; b.lines=[''];
          }else{
            b.type=rule.type; b.text=m[1];
          }
          renderNotionCanvasDOM(idx,true);
          scheduleNotionAutoSave();
          return;
        }
      }
      if(rawTxt.trim()==='---'){
        b.type='hr'; delete b.text;
        notionState.blocks.splice(idx+1,0,{id:nextBlkId(),type:'p',text:''});
        renderNotionCanvasDOM(idx+1,false);
        scheduleNotionAutoSave();
        return;
      }
      if(rawTxt.trim()==='$$'){
        b.type='math'; b.tex=''; delete b.text;
        notionState.openEditorSet.add(b.id);
        renderNotionCanvasDOM(idx,true);
        scheduleNotionAutoSave();
        return;
      }
      if(/^```\w*\s*$/.test(rawTxt.trim())){
        const lang=rawTxt.trim().slice(3).trim()||'c';
        if(lang==='mermaid'){ b.type='mermaid'; b.code='flowchart LR\n    A["Giriş"] --> B["Çıkış"]'; }
        else { b.type='code'; b.lang=lang; b.code=''; }
        delete b.text;
        notionState.openEditorSet.add(b.id);
        renderNotionCanvasDOM(idx,true);
        scheduleNotionAutoSave();
        return;
      }

      // 2) Live inline $math$ conversion when closing $ is typed
      const inlineMathMatch=rawTxt.match(/\$([^$\n]{1,80})\$\s$/);
      if(inlineMathMatch){
        b.text=editableDomToInlineMd(t);
        renderNotionCanvasDOM(idx,true);
        scheduleNotionAutoSave();
        return;
      }

      // 3) Slash '/' Command Trigger
      const slashM=rawTxt.match(/(?:^|\s)\/([a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_]*)$/);
      if(slashM){
        openSlashMenuAtCaret(idx,slashM[1]||'');
      }else if(notionState.slashOpen&&notionState.slashMode==='slash'){
        closeNotionSlash();
      }
    }

    syncBlockFromDOM(idx);
    scheduleNotionAutoSave();
  };

  view.onkeydown=e=>{
    if(notionState.locked) return;
    const t=e.target;
    const blkEl=t.closest('.nblock');
    if(!blkEl) return;
    const idx=Number(blkEl.dataset.bidx);
    const b=notionState.blocks[idx];
    if(!b) return;

    // Navigate Slash Menu if open
    if(notionState.slashOpen){
      const items=getFilteredSlashItems();
      if(e.key==='ArrowDown'){ e.preventDefault(); notionState.slashSelIdx=(notionState.slashSelIdx+1)%Math.max(1,items.length); renderSlashMenuDOM(); return; }
      if(e.key==='ArrowUp'){ e.preventDefault(); notionState.slashSelIdx=(notionState.slashSelIdx-1+Math.max(1,items.length))%Math.max(1,items.length); renderSlashMenuDOM(); return; }
      if(e.key==='Enter'||e.key==='Tab'){
        if(items[notionState.slashSelIdx]){
          e.preventDefault();
          applySlashCommand(items[notionState.slashSelIdx].id);
          return;
        }
      }
      if(e.key==='Escape'){ e.preventDefault(); closeNotionSlash(); return; }
    }

    // Inside Callout lines
    if(t.classList.contains('n-callout-line')||t.classList.contains('n-callout-title')){
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        syncBlockFromDOM(idx);
        const lIdx=t.classList.contains('n-callout-title')?-1:Number(t.dataset.lidx||0);
        if(!b.lines) b.lines=[''];
        b.lines.splice(lIdx+1,0,'');
        renderNotionCanvasDOM();
        const newLine=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"] .n-callout-line[data-lidx="${lIdx+1}"]`);
        if(newLine) newLine.focus();
        scheduleNotionAutoSave();
        return;
      }
      if(e.key==='Backspace'&&t.classList.contains('n-callout-line')&&!(t.textContent||'').trim()){
        const lIdx=Number(t.dataset.lidx||0);
        if((b.lines||[]).length>1){
          e.preventDefault();
          syncBlockFromDOM(idx);
          b.lines.splice(lIdx,1);
          renderNotionCanvasDOM();
          const prevLine=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"] .n-callout-line[data-lidx="${Math.max(0,lIdx-1)}"]`);
          if(prevLine) prevLine.focus();
          scheduleNotionAutoSave();
          return;
        }
      }
      return;
    }

    // Inside Table cells
    if(t.classList.contains('n-table-cell')){
      if(e.key==='Tab'){
        e.preventDefault();
        const cells=[...blkEl.querySelectorAll('.n-table-cell')];
        const curPos=cells.indexOf(t);
        const nextPos=e.shiftKey?curPos-1:curPos+1;
        if(cells[nextPos]) cells[nextPos].focus();
        else if(!e.shiftKey) notionTableAddRow(idx);
        return;
      }
      return;
    }

    if(!t.classList.contains('n-ed')) return;

    // Tab / Shift+Tab indentation for lists & todos
    if(e.key==='Tab'&&['ul','ol','todo'].includes(b.type)){
      e.preventDefault();
      syncBlockFromDOM(idx);
      b.indent=e.shiftKey?0:1;
      renderNotionCanvasDOM(idx,true);
      scheduleNotionAutoSave();
      return;
    }

    // Enter key inside text blocks
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      syncBlockFromDOM(idx);
      const rawTxt=(t.textContent||'').trim();
      // Empty list/todo/quote -> convert to normal paragraph
      if(!rawTxt&&['ul','ol','todo','quote'].includes(b.type)){
        b.type='p'; b.indent=0;
        renderNotionCanvasDOM(idx,false);
        scheduleNotionAutoSave();
        return;
      }
      const nextType=['ul','ol','todo'].includes(b.type)?b.type:'p';
      const nextBlk={id:nextBlkId(),type:nextType,text:'',indent:b.indent||0};
      if(nextType==='todo') nextBlk.checked=false;
      notionState.blocks.splice(idx+1,0,nextBlk);
      renderNotionCanvasDOM(idx+1,false);
      scheduleNotionAutoSave();
      return;
    }

    // Backspace at start of block
    if(e.key==='Backspace'){
      const offset=getCaretTextOffset(t);
      const rawTxt=(t.textContent||'').trim();
      if(offset===0){
        if(['h1','h2','h3','ul','ol','todo','quote'].includes(b.type)){
          e.preventDefault();
          syncBlockFromDOM(idx);
          b.type='p'; b.indent=0;
          renderNotionCanvasDOM(idx,false);
          scheduleNotionAutoSave();
          return;
        }
        if(!rawTxt&&notionState.blocks.length>1){
          e.preventDefault();
          notionState.blocks.splice(idx,1);
          renderNotionCanvasDOM(Math.max(0,idx-1),true);
          scheduleNotionAutoSave();
          return;
        }
      }
    }

    // Up / Down arrow between blocks
    if(e.key==='ArrowUp'&&getCaretTextOffset(t)===0&&idx>0){
      e.preventDefault();
      focusNotionBlock(idx-1,true);
    }else if(e.key==='ArrowDown'&&getCaretTextOffset(t)>=(t.textContent||'').length&&idx<notionState.blocks.length-1){
      e.preventDefault();
      focusNotionBlock(idx+1,false);
    }
  };
}

/* ---------- Block Actions, Callout Cycling, Todo & Table Helpers ---------- */
async function toggleNotionLock(id){
  if(notionState.locked){
    unlockedNotes.add(id);
  invalidateNoteDomCache(id);
    notionState.locked=false;
    renderMain();
    toast('🔓 Doğrudan Notion düzenleme açıldı',id);
  }else{
    unlockedNotes.delete(id);
    notionState.locked=true;
    if(editMode){
      await saveActiveNote(id);
      toast('🔒 Değişiklikler kaydedildi ve sayfa kilitlendi',id);
      return;
    }
    renderMain();
    toast('🔒 Sayfa kilitlendi (Salt okunur mod)',id);
  }
}

function toggleNotionTodo(idx,checked){
  if(notionState.locked) return;
  const b=notionState.blocks[idx];
  if(!b) return;
  b.checked=!!checked;
  const blkEl=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(blkEl) blkEl.classList.toggle('done',!!checked);
  scheduleNotionAutoSave();
}

function cycleCalloutKind(idx){
  if(notionState.locked) return;
  syncBlockFromDOM(idx);
  const b=notionState.blocks[idx];
  if(!b||b.type!=='callout') return;
  const cur=CALLOUT_KEYS.indexOf(b.kind||'NOTE');
  b.kind=CALLOUT_KEYS[(cur+1)%CALLOUT_KEYS.length];
  renderNotionCanvasDOM(idx,true);
  scheduleNotionAutoSave();
}

function toggleBlockSubEditor(bid,ev){
  if(ev) ev.stopPropagation();
  if(notionState.locked) return;
  if(notionState.openEditorSet.has(bid)) notionState.openEditorSet.delete(bid);
  else notionState.openEditorSet.add(bid);
  const box=document.getElementById('bed_'+bid);
  if(box){
    box.classList.toggle('open',notionState.openEditorSet.has(bid));
    const ta=document.getElementById('mta_'+bid);
    if(ta&&notionState.openEditorSet.has(bid)) ta.focus();
  }
}

function onBlockMathInput(idx,bid,val){
  const b=notionState.blocks[idx]; if(!b) return;
  b.tex=val;
  const r=document.getElementById('mrend_'+bid);
  if(r) r.innerHTML=renderKatexSafe(val,true);
  scheduleNotionAutoSave();
}

function insertMathSym(bid,sym){
  const ta=document.getElementById('mta_'+bid);
  if(!ta) return;
  const s=ta.selectionStart||0, e=ta.selectionEnd||0;
  ta.setRangeText(sym,s,e,'end');
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

let _mermaidTimer=null;
function onBlockMermaidInput(idx,bid,val){
  const b=notionState.blocks[idx]; if(!b) return;
  b.code=val;
  scheduleNotionAutoSave();
  if(_mermaidTimer) clearTimeout(_mermaidTimer);
  _mermaidTimer=setTimeout(()=>{
    const host=document.getElementById('merm_'+bid);
    if(host&&window.mermaid){
      host.removeAttribute('data-processed');
      host.textContent=val.trim();
      runMermaid('#merm_'+bid);
    }
  },350);
}

function onBlockCodeInput(idx,bid,val){
  const b=notionState.blocks[idx]; if(!b) return;
  b.code=val;
  const chl=document.getElementById('chl_'+bid);
  if(chl) chl.innerHTML=hlCode(escHtml(val),b.lang||'c');
  scheduleNotionAutoSave();
}

function onBlockCodeLang(idx,bid,lang){
  const b=notionState.blocks[idx]; if(!b) return;
  b.lang=lang;
  renderNotionCanvasDOM();
  scheduleNotionAutoSave();
}

function notionTableAddRow(idx){
  syncBlockFromDOM(idx);
  const b=notionState.blocks[idx]; if(!b||b.type!=='table') return;
  b.rows.push((b.headers||['']).map(()=>''));
  renderNotionCanvasDOM();
  const lastCell=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"] tbody tr:last-child .n-table-cell`);
  if(lastCell) lastCell.focus();
  scheduleNotionAutoSave();
}

function notionTableAddCol(idx){
  syncBlockFromDOM(idx);
  const b=notionState.blocks[idx]; if(!b||b.type!=='table') return;
  b.headers.push('Yeni Sütun');
  if(b.aligns) b.aligns.push(':---');
  b.rows.forEach(r=>r.push(''));
  renderNotionCanvasDOM();
  scheduleNotionAutoSave();
}

function notionTableDelRow(idx){
  syncBlockFromDOM(idx);
  const b=notionState.blocks[idx]; if(!b||b.type!=='table'||b.rows.length<=1) return;
  b.rows.pop();
  renderNotionCanvasDOM();
  scheduleNotionAutoSave();
}

function notionTableDelCol(idx){
  syncBlockFromDOM(idx);
  const b=notionState.blocks[idx]; if(!b||b.type!=='table'||b.headers.length<=1) return;
  b.headers.pop();
  if(b.aligns) b.aligns.pop();
  b.rows.forEach(r=>r.pop());
  renderNotionCanvasDOM();
  scheduleNotionAutoSave();
}

function notionAppendBottomBlock(){
  if(notionState.locked) return;
  syncAllNotionBlocksFromDOM();
  notionState.blocks.push({id:nextBlkId(),type:'p',text:''});
  renderNotionCanvasDOM(notionState.blocks.length-1,false);
  scheduleNotionAutoSave();
}

/* ---------- Drag & Drop Block Reordering ---------- */
function onNotionBlockDragStart(ev,idx){
  syncAllNotionBlocksFromDOM();
  notionState.dragIdx=idx;
  ev.dataTransfer.effectAllowed='move';
  ev.dataTransfer.setData('text/plain',String(idx));
}
function onNotionBlockDragOver(ev,idx){
  if(notionState.dragIdx===null||notionState.dragIdx===idx) return;
  ev.preventDefault();
  const blk=ev.currentTarget;
  const rect=blk.getBoundingClientRect();
  const topHalf=(ev.clientY-rect.top)<rect.height/2;
  blk.classList.toggle('drag-over-top',topHalf);
  blk.classList.toggle('drag-over-bot',!topHalf);
}
function onNotionBlockDragLeave(ev){
  ev.currentTarget.classList.remove('drag-over-top','drag-over-bot');
}
function onNotionBlockDrop(ev,targetIdx){
  ev.currentTarget.classList.remove('drag-over-top','drag-over-bot');
  const from=notionState.dragIdx;
  notionState.dragIdx=null;
  if(from===null||from===targetIdx) return;
  ev.preventDefault();
  const rect=ev.currentTarget.getBoundingClientRect();
  const after=(ev.clientY-rect.top)>=rect.height/2;
  const [moved]=notionState.blocks.splice(from,1);
  let dest=targetIdx+(after?1:0);
  if(from<dest) dest--;
  notionState.blocks.splice(Math.max(0,dest),0,moved);
  renderNotionCanvasDOM(Math.max(0,dest),true);
  scheduleNotionAutoSave();
}

/* ---------- Floating Overlays: Slash Menu, Bubble Toolbar & Inline Math Popover ---------- */
function ensureNotionOverlays(){
  if(!$('#notionSlashMenu')){
    const sm=document.createElement('div');
    sm.id='notionSlashMenu';
    sm.className='notion-slash';
    document.body.appendChild(sm);
  }
  if(!$('#notionBubble')){
    const bb=document.createElement('div');
    bb.id='notionBubble';
    bb.className='notion-bubble';
    bb.onmousedown=e=>e.preventDefault(); // Keep text selection active!
    bb.innerHTML=`
      <select class="nb-sel" id="nbTurnSel" onchange="notionBubbleTurnInto(this.value)" title="Bloğu dönüştür">
        <option value="">Dönüştür…</option>
        <option value="p">¶ Metin</option>
        <option value="h1">H1 Başlık 1</option>
        <option value="h2">H2 Başlık 2</option>
        <option value="h3">H3 Başlık 3</option>
        <option value="ul">• Madde Listesi</option>
        <option value="ol">1. Numaralı Liste</option>
        <option value="todo">☑ Yapılacaklar</option>
        <option value="callout_NOTE">📘 Bilgi Kutusu</option>
        <option value="callout_IMPORTANT">🔥 Önemli Kutusu</option>
        <option value="callout_WARNING">⚠️ Uyarı Kutusu</option>
        <option value="quote">❝ Alıntı</option>
      </select>
      <span class="nb-sep"></span>
      <button type="button" class="nb-btn" onclick="notionFormat('bold')" title="Kalın (Ctrl+B)"><b>B</b></button>
      <button type="button" class="nb-btn" onclick="notionFormat('italic')" title="İtalik (Ctrl+I)"><i>I</i></button>
      <button type="button" class="nb-btn" onclick="notionFormat('underline')" title="Altı Çizili (Ctrl+U)"><u>U</u></button>
      <button type="button" class="nb-btn" onclick="notionFormat('strikeThrough')" title="Üstü Çizili"><s>S</s></button>
      <button type="button" class="nb-btn" onclick="notionWrapSelection('code')" title="Satır İçi Kod (Ctrl+E)">&lt;/&gt;</button>
      <button type="button" class="nb-btn" onclick="notionWrapSelection('mark')" title="Fosforlu Vurgula">🖍</button>
      <button type="button" class="nb-btn" onclick="notionWrapSelection('math')" title="Seçili ifadeyi LaTeX Matematik Formülüne ($...$) çevir">∑ Formül</button>
      <span class="nb-sep"></span>
      <button type="button" class="nb-btn" style="color:var(--cu)" onclick="notionAskAiSelection()" title="Seçili kısmı AI ile açıkla veya soru çöz">✨ AI</button>
    `;
    document.body.appendChild(bb);
  }
  if(!$('#notionMathPop')){
    const mp=document.createElement('div');
    mp.id='notionMathPop';
    mp.className='notion-math-pop';
    mp.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;font:600 11px var(--mono);color:var(--cu)">
        <span>∑ Satır İçi LaTeX Formül Düzenleyici</span>
        <button type="button" class="nb-btn" onclick="closeInlineMathPop()" style="height:20px">✕</button>
      </div>
      <input type="text" class="nmp-in" id="nmpInput" placeholder="Örn: \\frac{d^2y}{dx^2} + 2y = 0" oninput="onInlineMathPopInput(this.value)" onkeydown="if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();closeInlineMathPop();}">
      <div class="n-math-syms">
        ${['\\frac{a}{b}','x^{2}','y_{n}','\\sqrt{x}','\\partial','\\int','\\implies','\\neq','\\leq','\\geq','\\infty'].map(s=>`<button type="button" onclick="insertInlinePopSym('${s.replace(/\\/g,'\\\\')}')">${s.replace(/\\/g,'')}</button>`).join('')}
      </div>
      <div class="nmp-prev" id="nmpPrev"></div>
    `;
    document.body.appendChild(mp);
  }
}

function getFilteredSlashItems(){
  const q=(notionState.slashFilter||'').toLowerCase().trim();
  if(!q) return NOTION_SLASH_ITEMS;
  return NOTION_SLASH_ITEMS.filter(it=>
    it.t.toLowerCase().includes(q)||it.d.toLowerCase().includes(q)||it.kw.includes(q)||it.id.toLowerCase().includes(q)
  );
}

function renderSlashMenuDOM(){
  const sm=$('#notionSlashMenu'); if(!sm) return;
  const items=getFilteredSlashItems();
  if(!items.length){
    sm.innerHTML=`<div style="padding:12px;color:var(--mut);font-size:12px;text-align:center">Komut bulunamadı: "/${escHtml(notionState.slashFilter)}"</div>`;
    return;
  }
  let curCat='';
  let html='';
  items.forEach((it,idx)=>{
    if(it.cat!==curCat){
      curCat=it.cat;
      html+=`<div class="ns-head"><span>${curCat}</span>${idx===0?'<span>↑↓ Seç · Enter</span>':''}</div>`;
    }
    html+=`<div class="ns-item ${idx===notionState.slashSelIdx?'act':''}" onmousedown="event.preventDefault();applySlashCommand('${it.id}')">
      <div class="ns-ic">${it.ic}</div>
      <div class="ns-info"><div class="ns-title">${it.t}</div><div class="ns-desc">${it.d}</div></div>
      <span class="ns-kbd">${it.kbd}</span>
    </div>`;
  });
  sm.innerHTML=html;
  const actEl=sm.querySelector('.ns-item.act');
  if(actEl) actEl.scrollIntoView({block:'nearest'});
}

function positionPopupNearRect(el,rect,w=310,h=340){
  const x=Math.max(16,Math.min(window.innerWidth-w-16,rect.left));
  const spaceBelow=window.innerHeight-rect.bottom;
  const y=spaceBelow>h||spaceBelow>rect.top
    ?Math.min(window.innerHeight-h-12,rect.bottom+6)
    :Math.max(12,rect.top-h-6);
  el.style.left=x+'px';
  el.style.top=y+'px';
}

function openSlashMenuAtCaret(idx,filterStr=''){
  ensureNotionOverlays();
  notionState.slashOpen=true;
  notionState.slashMode='slash';
  notionState.slashBlockIdx=idx;
  notionState.slashFilter=filterStr;
  notionState.slashSelIdx=0;
  const sm=$('#notionSlashMenu');
  renderSlashMenuDOM();
  sm.classList.add('show');
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){
    const r=sel.getRangeAt(0).getBoundingClientRect();
    if(r.width||r.height){ positionPopupNearRect(sm,r); return; }
  }
  const blk=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(blk) positionPopupNearRect(sm,blk.getBoundingClientRect());
}

function openSlashForBlock(idx,ev){
  if(ev) ev.stopPropagation();
  syncAllNotionBlocksFromDOM();
  notionState.blocks.splice(idx+1,0,{id:nextBlkId(),type:'p',text:''});
  renderNotionCanvasDOM(idx+1,false);
  const blk=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx+1}"]`);
  ensureNotionOverlays();
  notionState.slashOpen=true;
  notionState.slashMode='gutter';
  notionState.slashBlockIdx=idx+1;
  notionState.slashFilter='';
  notionState.slashSelIdx=0;
  const sm=$('#notionSlashMenu');
  renderSlashMenuDOM();
  sm.classList.add('show');
  if(blk) positionPopupNearRect(sm,blk.getBoundingClientRect());
}

function openSlashFromTop(id){
  if(notionState.locked){ toast('🔒 Düzenleme kilitli — önce "🔒 Kilitli" butonuna tıklayın',id); return; }
  if(editMode) toggleEditNote(id);
  openSlashForBlock(notionState.blocks.length-1);
}

function openBlockActionMenu(idx,ev){
  if(ev) ev.stopPropagation();
  syncAllNotionBlocksFromDOM();
  ensureNotionOverlays();
  notionState.slashOpen=true;
  notionState.slashMode='menu';
  notionState.slashBlockIdx=idx;
  const sm=$('#notionSlashMenu');
  sm.innerHTML=`
    <div class="ns-head"><span>Blok İşlemleri (#${idx+1})</span></div>
    <div class="ns-item" onmousedown="event.preventDefault();blockMenuAction(${idx},'dup')"><div class="ns-ic">⧉</div><div class="ns-info"><div class="ns-title">Bloğu Çoğalt</div><div class="ns-desc">Aynı bloğun kopyasını altına ekle</div></div></div>
    <div class="ns-item" onmousedown="event.preventDefault();blockMenuAction(${idx},'up')"><div class="ns-ic">↑</div><div class="ns-info"><div class="ns-title">Yukarı Taşı</div><div class="ns-desc">Bloğu bir üst sıraya al</div></div></div>
    <div class="ns-item" onmousedown="event.preventDefault();blockMenuAction(${idx},'down')"><div class="ns-ic">↓</div><div class="ns-info"><div class="ns-title">Aşağı Taşı</div><div class="ns-desc">Bloğu bir alt sıraya al</div></div></div>
    <div class="ns-item" onmousedown="event.preventDefault();blockMenuAction(${idx},'ai')"><div class="ns-ic">✨</div><div class="ns-info"><div class="ns-title">AI ile Açıkla & Genişlet</div><div class="ns-desc">Bu bloğu sağdaki AI asistanına gönder</div></div></div>
    <div class="ns-item" onmousedown="event.preventDefault();blockMenuAction(${idx},'del')"><div class="ns-ic" style="color:var(--bad)">🗑</div><div class="ns-info"><div class="ns-title" style="color:var(--bad)">Bloğu Sil</div><div class="ns-desc">Bu bloğu sayfadan kaldır</div></div></div>
    <div class="ns-head" style="margin-top:4px"><span>Başka Bloğa Dönüştür</span></div>
    ${NOTION_SLASH_ITEMS.slice(0,12).map(it=>`<div class="ns-item" onmousedown="event.preventDefault();applySlashCommand('${it.id}',true)"><div class="ns-ic">${it.ic}</div><div class="ns-info"><div class="ns-title">${it.t}</div></div></div>`).join('')}
  `;
  sm.classList.add('show');
  if(ev&&ev.currentTarget) positionPopupNearRect(sm,ev.currentTarget.getBoundingClientRect());
}

function blockMenuAction(idx,act){
  closeNotionSlash();
  const b=notionState.blocks[idx]; if(!b) return;
  if(act==='dup'){
    const clone=JSON.parse(JSON.stringify(b));
    clone.id=nextBlkId();
    notionState.blocks.splice(idx+1,0,clone);
    renderNotionCanvasDOM(idx+1,true);
  }else if(act==='up'&&idx>0){
    const [it]=notionState.blocks.splice(idx,1);
    notionState.blocks.splice(idx-1,0,it);
    renderNotionCanvasDOM(idx-1,true);
  }else if(act==='down'&&idx<notionState.blocks.length-1){
    const [it]=notionState.blocks.splice(idx,1);
    notionState.blocks.splice(idx+1,0,it);
    renderNotionCanvasDOM(idx+1,true);
  }else if(act==='del'){
    if(notionState.blocks.length<=1){ notionState.blocks=[{id:nextBlkId(),type:'p',text:''}]; }
    else notionState.blocks.splice(idx,1);
    renderNotionCanvasDOM(Math.max(0,idx-1),true);
  }else if(act==='ai'){
    const md=serializeNoteBlocks([b],'').trim();
    rtab('ai');
    aiSend('side_ai',`Notumdaki şu bloğu detaylıca açıkla ve sınav düzeyinde bir örnek ekle:\n\n${md}`);
    return;
  }
  scheduleNotionAutoSave();
}

function closeNotionSlash(){
  notionState.slashOpen=false;
  const sm=$('#notionSlashMenu');
  if(sm) sm.classList.remove('show');
}

function applySlashCommand(cmdId,keepText=false){
  const idx=notionState.slashBlockIdx;
  closeNotionSlash();
  if(idx<0||idx>=notionState.blocks.length) return;
  syncAllNotionBlocksFromDOM();
  const b=notionState.blocks[idx];
  // Strip trailing /filter if triggered by typing '/'
  let cleanText=b.text||'';
  if(!keepText&&notionState.slashMode==='slash'){
    cleanText=cleanText.replace(/(?:^|\s)\/[a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_]*$/,'').trim();
  }
  if(cmdId==='upload'){
    triggerAssetUpload(notionState.noteId);
    return;
  }
  if(cmdId==='ai_expand'){
    rtab('ai');
    aiSend('side_ai',`Açık olan "${pg(notionState.noteId).t}" notu için bu bölüme uygun çözümlü bir sınav sorusu ve özet tablo hazırla.`);
    return;
  }
  const replaceOrInsert=(newBlk)=>{
    if(cleanText&&!keepText){
      b.text=cleanText;
      notionState.blocks.splice(idx+1,0,newBlk);
      return idx+1;
    }else{
      const keepContent=cleanText||b.title||(b.lines&&b.lines.join(' '))||'';
      Object.keys(b).forEach(k=>{if(k!=='id')delete b[k];});
      Object.assign(b,newBlk);
      if(keepText&&keepContent&&['p','h1','h2','h3','ul','ol','todo','quote'].includes(b.type)) b.text=keepContent;
      return idx;
    }
  };

  let targetIdx=idx;
  if(['p','h1','h2','h3','ul','ol','quote'].includes(cmdId)){
    targetIdx=replaceOrInsert({type:cmdId,text:keepText?cleanText:''});
  }else if(cmdId==='todo'){
    targetIdx=replaceOrInsert({type:'todo',checked:false,text:keepText?cleanText:''});
  }else if(cmdId.startsWith('callout_')){
    const kind=cmdId.split('_')[1];
    targetIdx=replaceOrInsert({type:'callout',kind,title:CALLOUT_TYPES[kind].title,lines:[keepText&&cleanText?cleanText:'']});
  }else if(cmdId==='math'){
    targetIdx=replaceOrInsert({type:'math',tex:'\\frac{d^2 y}{dx^2} + \\omega_0^2 y = 0'});
    notionState.openEditorSet.add(notionState.blocks[targetIdx].id);
  }else if(cmdId==='table'){
    targetIdx=replaceOrInsert({type:'table',headers:['Kavram / Parametre','Formül & Sembol','Birim / Açıklama'],aligns:[':---',':---:',':---'],rows:[['','',''],['','','']]});
  }else if(cmdId==='mermaid'){
    targetIdx=replaceOrInsert({type:'mermaid',code:'flowchart LR\n    G["Giriş X(s)"] --> H["Sistem H(s)"] --> Y["Çıkış Y(s)"]'});
    notionState.openEditorSet.add(notionState.blocks[targetIdx].id);
  }else if(cmdId==='code'){
    targetIdx=replaceOrInsert({type:'code',lang:'c',code:'// STM32 / Mühendislik Kodu\nvoid EXTI0_IRQHandler(void) {\n    EXTI->PR |= (1U << 0);\n}'});
    notionState.openEditorSet.add(notionState.blocks[targetIdx].id);
  }else if(cmdId==='hr'){
    targetIdx=replaceOrInsert({type:'hr'});
    notionState.blocks.splice(targetIdx+1,0,{id:nextBlkId(),type:'p',text:''});
    targetIdx++;
  }
  renderNotionCanvasDOM(targetIdx,true);
  scheduleNotionAutoSave();
}

/* ---------- Bubble Toolbar & Inline Formatting ---------- */
let _selBubbleRaf=0;
document.addEventListener('selectionchange',()=>{
  const bb=$('#notionBubble'); if(!bb) return;
  if(notionState.locked||editMode){ bb.classList.remove('show'); return; }
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed){ bb.classList.remove('show'); return; }
  if(_selBubbleRaf) return;
  _selBubbleRaf=requestAnimationFrame(()=>{
    _selBubbleRaf=0;
    const s=window.getSelection();
    if(!s||s.isCollapsed||!s.toString().trim()){ bb.classList.remove('show'); return; }
    const anchor=s.anchorNode?(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement):null;
    if(!anchor||!anchor.closest||!anchor.closest('#mdView')){ bb.classList.remove('show'); return; }
    const r=s.getRangeAt(0).getBoundingClientRect();
    if(!r.width&&!r.height){ bb.classList.remove('show'); return; }
    const selEl=$('#nbTurnSel');
    if(selEl) selEl.value='';
    bb.classList.add('show');
    const x=Math.max(12,Math.min(window.innerWidth-390,r.left+r.width/2-180));
    const y=Math.max(10,r.top-42);
    bb.style.left=x+'px';
    bb.style.top=y+'px';
  });
});

function notionFormat(cmd){
  document.execCommand(cmd,false,null);
  const sel=window.getSelection();
  const blk=sel&&sel.anchorNode?(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)?.closest('.nblock'):null;
  if(blk){
    syncBlockFromDOM(Number(blk.dataset.bidx));
    scheduleNotionAutoSave();
  }
}

function notionWrapSelection(kind){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed) return;
  const txt=sel.toString();
  const blk=(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)?.closest('.nblock');
  if(!blk) return;
  const idx=Number(blk.dataset.bidx);
  if(kind==='math'){
    const clean=txt.replace(/^\$+|\$+$/g,'').trim();
    const chipHtml=`<span class="n-math-chip" contenteditable="false" data-tex="${escAttr(clean)}" data-display="0" onclick="openInlineMathPop(this,event)">${renderKatexSafe(clean,false)}</span>&nbsp;`;
    document.execCommand('insertHTML',false,chipHtml);
  }else if(kind==='code'){
    document.execCommand('insertHTML',false,`<code>${escHtml(txt)}</code>`);
  }else if(kind==='mark'){
    document.execCommand('insertHTML',false,`<mark>${escHtml(txt)}</mark>`);
  }
  syncBlockFromDOM(idx);
  scheduleNotionAutoSave();
  $('#notionBubble')?.classList.remove('show');
}

function notionBubbleTurnInto(val){
  if(!val) return;
  const sel=window.getSelection();
  const blk=sel&&sel.anchorNode?(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)?.closest('.nblock'):null;
  if(!blk) return;
  notionState.slashBlockIdx=Number(blk.dataset.bidx);
  applySlashCommand(val,true);
  $('#notionBubble')?.classList.remove('show');
}

function notionAskAiSelection(){
  const sel=window.getSelection();
  const txt=sel?sel.toString().trim():'';
  if(!txt) return;
  $('#notionBubble')?.classList.remove('show');
  rtab('ai');
  aiSend('side_ai',`Notumda seçtiğim şu ifadeyi/denklemi açıkla:\n\n> ${txt}`);
}

/* ---------- Inline Math Chip Live Popover ---------- */
function openInlineMathPop(chipEl,ev){
  if(ev) ev.stopPropagation();
  if(notionState.locked) return;
  ensureNotionOverlays();
  document.querySelectorAll('.n-math-chip.editing').forEach(x=>x.classList.remove('editing'));
  chipEl.classList.add('editing');
  notionState.activeMathChip=chipEl;
  const pop=$('#notionMathPop');
  const inp=$('#nmpInput');
  const prev=$('#nmpPrev');
  const tex=chipEl.dataset.tex||'';
  inp.value=tex;
  prev.innerHTML=renderKatexSafe(tex,true);
  pop.classList.add('show');
  positionPopupNearRect(pop,chipEl.getBoundingClientRect(),360,160);
  setTimeout(()=>{ inp.focus(); inp.select(); },20);
}

function onInlineMathPopInput(val){
  const chip=notionState.activeMathChip;
  const prev=$('#nmpPrev');
  if(prev) prev.innerHTML=renderKatexSafe(val,true);
  if(chip){
    chip.dataset.tex=val;
    chip.innerHTML=renderKatexSafe(val,false);
    const blk=chip.closest('.nblock');
    if(blk){
      syncBlockFromDOM(Number(blk.dataset.bidx));
      scheduleNotionAutoSave();
    }
  }
}

function insertInlinePopSym(sym){
  const inp=$('#nmpInput'); if(!inp) return;
  const s=inp.selectionStart||0, e=inp.selectionEnd||0;
  inp.setRangeText(sym,s,e,'end');
  onInlineMathPopInput(inp.value);
  inp.focus();
}

function closeInlineMathPop(){
  document.querySelectorAll('.n-math-chip.editing').forEach(x=>x.classList.remove('editing'));
  notionState.activeMathChip=null;
  $('#notionMathPop')?.classList.remove('show');
}

document.addEventListener('mousedown',e=>{
  if(notionState.slashOpen&&!e.target.closest('#notionSlashMenu')&&!e.target.closest('.ng-btn')){
    closeNotionSlash();
  }
  if(notionState.activeMathChip&&!e.target.closest('#notionMathPop')&&!e.target.closest('.n-math-chip')){
    closeInlineMathPop();
  }
});

/* ---------- Right-Edge Notion Outline Minimap ---------- */
let _mmEntries=[];
let _mmActiveIdx=-999;
let _floatLockSig='';
function buildMinimapEntries(){
  const mm=$('#notionMinimap'), view=$('#mdView');
  if(!mm||!view){ _mmEntries=[]; return; }
  const ticks=[...mm.querySelectorAll('.nm-tick')];
  const links=new Map();
  mm.querySelectorAll('.nm-link').forEach(l=>links.set(Number(l.dataset.bidx),l));
  const blks=new Map();
  view.querySelectorAll('.nblock[data-bidx]').forEach(b=>blks.set(Number(b.dataset.bidx),b));
  _mmEntries=ticks.map(t=>{
    const bidx=Number(t.dataset.bidx);
    return {bidx,tick:t,link:links.get(bidx)||null,blk:blks.get(bidx)||null};
  });
}
function renderNotionMinimap(){
  const mm=$('#notionMinimap'); if(!mm) return;
  _mmActiveIdx=-999;
  const headings=[];
  notionState.blocks.forEach((b,idx)=>{
    if(b.type==='h1'||b.type==='h2'||b.type==='h3'){
      const lvl=Number(b.type.slice(1));
      const clean=(b.text||'').replace(/[*_`~=$]/g,'').trim();
      if(clean) headings.push({idx,lvl,text:clean});
    }
  });
  if(headings.length<2){ mm.style.display='none'; _mmEntries=[]; return; }
  mm.style.display='flex';
  mm.innerHTML=headings.map(h=>`<div class="nm-tick lvl-${h.lvl}" data-bidx="${h.idx}" onclick="scrollToNotionBlock(${h.idx})" title="${escAttr(h.text)}"></div>`).join('')+
    `<div class="nm-card">
      <div class="nm-head">İçindekiler (${headings.length} başlık)</div>
      ${headings.map(h=>`<div class="nm-link lvl-${h.lvl}" data-bidx="${h.idx}" onclick="scrollToNotionBlock(${h.idx})">${escHtml(h.text)}</div>`).join('')}
    </div>`;
  buildMinimapEntries();
  requestAnimationFrame(()=>{ syncNotionMinimapActive(); });
}

function setMinimapActiveIdx(idx){
  if(idx===_mmActiveIdx) return;
  for(const ent of _mmEntries){
    const on=ent.bidx===idx;
    if(ent.tick) ent.tick.classList.toggle('on',on);
    if(ent.link) ent.link.classList.toggle('on',on);
  }
  _mmActiveIdx=idx;
}

function syncNotionMinimapActive(){
  const mm=$('#notionMinimap'), view=$('#mdView'), sc=$('#main');
  if(!mm||!view||!sc||mm.style.display==='none') return;
  if(_mmClickLock){
    if(Date.now()<_mmClickLock.until){
      setMinimapActiveIdx(_mmClickLock.idx);
      return;
    }
    _mmClickLock=null;
  }
  if(!_mmEntries.length||(_mmEntries[0].blk&&!_mmEntries[0].blk.isConnected)) buildMinimapEntries();
  if(!_mmEntries.length) return;
  const scRect=sc.getBoundingClientRect();
  const threshold=scRect.top+96;
  const atBottom=(sc.scrollTop+sc.clientHeight)>=sc.scrollHeight-6;
  let activeIdx=_mmEntries[0].bidx;
  if(atBottom){
    const botLimit=scRect.bottom-24;
    for(const ent of _mmEntries){
      if(ent.blk&&ent.blk.getBoundingClientRect().top<=botLimit) activeIdx=ent.bidx;
    }
  }else{
    for(const ent of _mmEntries){
      if(!ent.blk) continue;
      if(ent.blk.getBoundingClientRect().top<=threshold) activeIdx=ent.bidx;
      else break;
    }
  }
  setMinimapActiveIdx(activeIdx);
}
function syncNotionFloatLock(){
  const fl=$('#notionFloatLock'), m=$('#main'), doc=$('#doc'), pill=$('#notionLockPill');
  const pdfStage=$('#pdfCacheStage');
  if(!fl||!m||!doc||!pill||!String(active).startsWith('note:')||(pdfStage&&pdfStage.classList.contains('active'))){
    if(fl&&(_floatLockSig!=='hide'||fl.style.display!=='none')){ fl.style.display='none'; _floatLockSig='hide'; }
    return;
  }
  const mRect=m.getBoundingClientRect();
  const pRect=pill.getBoundingClientRect();
  if(pRect.bottom>mRect.top+6){
    if(_floatLockSig!=='hide'||fl.style.display!=='none'){ fl.style.display='none'; _floatLockSig='hide'; }
    return;
  }
  const sig='show|'+(notionState.locked?'1':'0');
  if(sig===_floatLockSig&&fl.style.display==='inline-flex') return;
  _floatLockSig=sig;
  fl.style.display='inline-flex';
  fl.classList.toggle('locked',!!notionState.locked);
  fl.textContent=notionState.locked?'🔒':'🔓';
  fl.title=notionState.locked
    ?'Salt okunur (Düzenlemeyi açmak için tıkla)'
    :'Düzenleme açık (Kilitlemek için tıkla)';
}
window.addEventListener('resize',()=>requestAnimationFrame(syncNotionFloatLock));

function scrollToNotionBlock(idx){
  const el=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(el){
    _mmClickLock={idx,until:Date.now()+600};
    setMinimapActiveIdx(idx);
    el.scrollIntoView({behavior:'smooth',block:'start'});
  }
}

/* ---------- Not içine görsel / PDF / DOCX sürükle-bırak & yapıştır ---------- */
const isUploadable=f=>f&&(f.type.startsWith('image/')||/\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|html|png|jpe?g|jfif|gif|webp|bmp|svg|avif)$/i.test(f.name||''));
async function uploadImages(files,rel){
  const out=[];
  for(const f of files){
    if(!isUploadable(f))continue;
    out.push(await uploadAssetFile(f,f.name||'gorsel.png',rel));
  }
  return out;
}
async function dropImagesToNote(id,files){
  if(id===notionState.noteId&&notionState.locked){
    toast('🔒 Not kilitli — dosya eklemek için önce düzenleme kilidini açın',id);
    return;
  }
  const rel=id.slice(5);
  try{
    const items=await uploadImages(files,rel); if(!items.length)return;
    const embeds=items.map(x=>x.embed);
    const block='\n\n'+embeds.join('\n\n')+'\n\n';
    if(editMode&&$('#mdEd')){ const ed=$('#mdEd'),p=ed.selectionStart; ed.setRangeText(block,p,p,'end'); ed.focus(); scheduleRawMdAutoSave(id); toast(`📎 ${embeds.length} dosya eklendi`,id); }
    else{
      syncAllNotionBlocksFromDOM();
      embeds.forEach(em=>notionState.blocks.push({id:nextBlkId(),type:'embed',raw:em}));
      const md=serializeNoteBlocks(notionState.blocks);
      noteCache[id]=await api('/api/note',{rel,content:md});
  invalidateNoteDomCache(id);
      await loadVault(); renderMain();
      toast(`📎 ${embeds.length} dosya nota blok olarak eklendi`,id);
    }
  }catch(e){ alert('Dosya eklenemedi: '+e.message); }
}
const hasFiles=e=>e.dataTransfer&&[...e.dataTransfer.types].includes('Files');
function wireNoteImages(m,id){
  m.ondragover=e=>{ if(hasFiles(e)){e.preventDefault();m.classList.add('imgdrop');} };
  m.ondragleave=e=>{ if(e.target===m)m.classList.remove('imgdrop'); };
  m.ondrop=e=>{ m.classList.remove('imgdrop'); if(hasFiles(e)){e.preventDefault(); dropImagesToNote(id,[...e.dataTransfer.files]);} };
}
window.addEventListener('dragover',e=>{ if(hasFiles(e))e.preventDefault(); });
window.addEventListener('drop',e=>{ if(hasFiles(e))e.preventDefault(); });
window.addEventListener('paste',e=>{
  const cd=e.clipboardData; if(!cd) return;
  const files=[];
  if(cd.files&&cd.files.length){
    for(const f of cd.files) if(f.type&&f.type.startsWith('image/')) files.push(f);
  }else if(cd.items&&cd.items.length){
    for(const it of cd.items){
      if(it.kind==='file'&&it.type&&it.type.startsWith('image/')){ const f=it.getAsFile(); if(f) files.push(f); }
    }
  }
  if(!files.length) return;
  const ae=document.activeElement;
  const aid=ae?ae.id:'';
  if(aid==='chatIn'||(ae&&ae.closest&&ae.closest('#rb-ai'))){
    e.preventDefault(); attachChatImages('side_ai',files); return;
  }
  if(aid==='scIn'||(ae&&ae.closest&&ae.closest('.sc-wrap'))){
    e.preventDefault(); attachChatImages(getStudySessId(),files); return;
  }
  if(aid==='aiInput'||(ae&&ae.closest&&ae.closest('.aiwrap'))){
    e.preventDefault(); attachChatImages(active,files); return;
  }
  if(active==='studychat'){ e.preventDefault(); attachChatImages(getStudySessId(),files); return; }
  if(isAI(active)){ e.preventDefault(); attachChatImages(active,files); return; }
  if(String(active).startsWith('note:')){ e.preventDefault(); dropImagesToNote(active,files); }
});
async function toggleEditNote(id){
  if(!editMode&&notionState.locked){
    toast('🔒 Düzenleme kilitli — önce "🔒 Kilitli" butonuna tıklayın',id);
    return;
  }
  saveMainScroll(id);
  if(!editMode){
    syncAllNotionBlocksFromDOM();
    if(noteCache[id]) noteCache[id].content=serializeNoteBlocks(notionState.blocks);
    editMode=true;
    renderMain();
  }else{
    await saveActiveNote(id);
  }
}
async function saveActiveNote(id){
  saveMainScroll(id);
  const ed=$('#mdEd');
  const rel=id.slice(5);
  try{
    const content=ed?ed.value:(syncAllNotionBlocksFromDOM(),serializeNoteBlocks(notionState.blocks));
    noteCache[id]=await api('/api/note',{rel,content});
  invalidateNoteDomCache(id);
    editMode=false;
    await loadVault();
    toast('💾 Not kaydedildi: '+rel, id);
    renderMain();
  }catch(e){ alert('Kaydetme hatası: '+e.message); }
}
function renderBlankTab(m){
  const lk='display:block;color:var(--cu);cursor:pointer;padding:5px 0;font-size:14px';
  m.innerHTML=`<div style="height:100%;min-height:60vh;display:flex;align-items:center;justify-content:center">
    <div style="text-align:left;min-width:240px">
      <div style="font-size:12px;color:var(--mut);margin-bottom:10px">Sol panelden bir dosya seç · orta tık: yeni sekme</div>
      <span style="${lk}" onclick="openNewNoteModal()">Yeni not oluştur (Alt+N)</span>
      <span style="${lk}" onclick="openPage('kasalar')">Kasalar ana ekranı</span>
      <span style="${lk}" onclick="closeTab(active)">Sekmeyi kapat (Ctrl+W)</span>
    </div></div>`;
}
function stashActiveNoteDom(m){
  const prevId=_mountedNoteScrollId;
  if(!prevId||!m) return;
  if(prevId===active){
    noteDomCache.delete(active);
    return;
  }
  if(editMode||notionState.saveTimer||notionState.noteId!==prevId) return;
  const cachedNote=noteCache[prevId];
  if(!cachedNote) return;
  const docEl=m.querySelector('#doc');
  if(!docEl||!docEl.querySelector('#mdView')) return;
  docEl.remove();
  noteDomCache.delete(prevId);
  noteDomCache.set(prevId,{
    node:docEl,
    content:cachedNote.content||'',
    locked:!!notionState.locked,
    blocks:notionState.blocks,
    baseDir:notionState.baseDir
  });
  while(noteDomCache.size>NOTE_DOM_CACHE_LIMIT){
    const oldest=noteDomCache.keys().next().value;
    noteDomCache.delete(oldest);
  }
}
function renderMain(){
  const m=$('#main');
  const mm=$('#notionMinimap'); if(mm) mm.style.display='none';
  const fl=$('#notionFloatLock'); if(fl){ fl.style.display='none'; _floatLockSig='hide'; }
  saveMainScroll();
  stashActiveNoteDom(m);
  if(!active.startsWith('note:')){
    _mountedNoteScrollId=null;
    m.ondragover=null; m.ondragleave=null; m.ondrop=null;
  }
  if(!isCachedFrameTab(active)) deactivatePdfCache();
  if(active==='kasalar') renderKasalarHome(m);
  else if(isBlank(active)) renderBlankTab(m);
  else if(active.startsWith('note:')) renderVaultNote(m,active);
  else if(active==='studychat') renderStudyChat(m);
  else if(active==='cal') renderCal(m,!calLoaded);
  else if(active==='trafo') renderTrafoLab(m);
  else if(isAI(active)) renderAI(m);
  else renderSim(m);
  syncPdfFocusMode();
  syncNotionFloatLock();
}

const SK={
 ozet:{h:'Özet Çıkar',prompt:'Açık olan notu ve seçili kaynakları maddeler halinde, sınavda çıkabilecek kritik formülleri ve kavramları vurgulayarak özetle.',r:['yerel/hızlı','özet']},
 fisle:{h:'Sınav Föyü Hazırla (A4)',prompt:'Açık olan nottan A4 iki sütun sığacak yoğunlukta, tüm temel formülleri, birimleri ve hoca tuzak sorularını içeren eksiksiz bir Sınav Çalışma Föyü hazırla.',r:['sınav föyü','A4 çift yüz']},
 spice:{h:'Devre → SPICE & Analiz',prompt:'Açık olan nottaki devreyi analiz et, eşdeğer devre parametrelerini, transfer fonksiyonunu ve SPICE netlist taslağını çıkar.',r:['devre','SPICE']},
 teardown:{h:'Sistem & Mekanizma Analizi',prompt:'Bu konudaki fiziksel/elektriksel yapıyı katmanlarına ayırarak çalışma prensibini ve arıza/kayıp mekanizmalarını açıkla.',r:['derin analiz','mimari']},
 whisper:{h:'Ders Notu Yapılandır',prompt:'Bu ham ders/deney içeriğini temiz başlıklar, tablolar ve LaTeX formüllerle yapılandırılmış ders notuna dönüştür.',r:['yapılandırma','not']},
 pcb:{h:'Donanım & Шema Taslağı',prompt:'Bu devre/sistem için gerekli donanım bloklarını, pin/bağlantı kurallarını ve koruma elemanlarını listele.',r:['donanım','şema']}
};
function runSkill(k){
  const s=SK[k]; if(!s)return;
  if(curMode==='study'){ studioPendingTitle=s.h; if(active!=='studychat') openPage('studychat'); }
  rtab('ai');
  const promptText=s.prompt||(`/${k} — aktif not ve seçili kaynaklar üzerinde uygula.`);
  aiSend(curMode==='study'?getStudySessId():'side_ai',promptText,k);
}
function wireDrop(){
  const dz=$('#drop'); if(!dz)return;
  ['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('hot')}));
  dz.addEventListener('dragleave',()=>dz.classList.remove('hot'));
  dz.addEventListener('drop',ev=>{if(ev.dataTransfer.files.length)return;ev.preventDefault();dz.classList.remove('hot');runSkill(ev.dataTransfer.getData('text/plain'));});
}

/* ---------- Google Takvim Esinli Akademik Takvim & Planlama Stüdyosu ---------- */
let calEvents=[];
let calLoaded=false;
const GCAL_MONTHS=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const GCAL_MONTHS_SHORT=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
const GCAL_DAYS=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
const GCAL_DAYS_FULL=['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

const GCAL_KINDS={
  exam:{id:'exam',label:'Sınav / Vize / Quiz',icon:'🔴',solid:'#d93025',color:'#ff6b6b',bg:'#ff6b6b22',bd:'#ff6b6b88'},
  lab:{id:'lab',label:'Lab & Deney',icon:'⚡',solid:'#188038',color:'#52b788',bg:'#52b78824',bd:'#52b78888'},
  task:{id:'task',label:'Ödev & Proje Teslimi',icon:'📘',solid:'#e37400',color:'#e0a458',bg:'#e0a45824',bd:'#e0a45888'},
  study:{id:'study',label:'Derin Çalışma / Pomodoro',icon:'🎯',solid:'#1a73e8',color:'#7aa2f7',bg:'#7aa2f724',bd:'#7aa2f788'},
  lecture:{id:'lecture',label:'Ders / Amfi',icon:'🏛',solid:'#8e24aa',color:'#bb9af7',bg:'#bb9af720',bd:'#bb9af788'},
  event:{id:'event',label:'Paddock & Etkinlik',icon:'🏁',solid:'#db2777',color:'#f472b6',bg:'#f472b624',bd:'#f472b688'}
};
const isLightTheme=()=>typeof curTheme!=='undefined'&&(curTheme==='mono-light'||curTheme==='eink'||curTheme==='sepia');
const gcalInk=k=>(isLightTheme()?k.solid:k.color);

// Sabit Haftalık EEM Ders Programı (Pzt=1 .. Cum=5)
const EEM_WEEKLY_SCHEDULE=[
  {dow:1,start:'13:00',end:'14:00',title:'Egzersiz ve Beslenme (ÜSD)',kasa:'Universite_Secmeli_Beslenme',loc:'Çevrimiçi',desc:'Doç. Dr. Halil İbrahim CEYLAN · Online ÜSD'},
  {dow:2,start:'12:00',end:'15:00',title:'Yüksek Gerilim Tekniği ve Tesisi (MEL407)',kasa:'Yuksek_Gerilim_Teknigi',loc:'D5',desc:'Doç. Dr. Muhammed Fatih ÇORAPSIZ'},
  {dow:3,start:'09:00',end:'11:00',title:'Katıhal Elektroniği (MEL451)',kasa:'Katihal_Elektronigi',loc:'D11',desc:'Prof. Dr. Hasan EFEOĞLU'},
  {dow:3,start:'14:00',end:'17:00',title:'Kontrol Sistemlerine Giriş (MEL303)',kasa:'Kontrol_Sistemlerine_Giris',loc:'D4',desc:'Dr. Öğr. Üyesi Kaan CAN'},
  {dow:4,start:'08:00',end:'11:00',title:'Seçmeli Tasarım I (MUH107)',kasa:'Secmeli_Tasarim',loc:'Çevrimiçi',desc:'Doç. Dr. Muhammed Fatih ÇORAPSIZ'},
  {dow:4,start:'12:00',end:'15:00',title:'Mikrodalga Tekniği (MEL401)',kasa:'Mikrodalga',loc:'D3',desc:'Doç. Dr. Gökhan ÖZTÜRK'},
  {dow:5,start:'09:00',end:'12:00',title:'Diferansiyel Denklemler (FMT171-H)',kasa:'Difransiyel_Denklemler',loc:'OBS (Mühendislik)',desc:'Doç. Dr. Sıdıka Şule ŞENER KILIÇ'},
  {dow:5,start:'10:00',end:'12:00',title:'İş Sağlığı ve Güvenliği I (ISG101-B)',kasa:'Is_Sagligi_ve_Guvenligi',loc:'Çevrimiçi',desc:'Doç. Dr. Yunus Emre BENKLİ (FMT171 ile çakışıyor)'}
];

const SEED_META_DEFAULTS={
  3:{start:'19:00',end:'21:00',loc:'Çalışma Masası',desc:'Blok diyagram indirgeme, Mason kazanç formülü ve Routh-Hurwitz soru çözümü.'},
  6:{start:'13:30',end:'16:00',loc:'Elektrik Makineleri Lab',desc:'3 fazlı transformatör bağlantı grupları (Dy11/Yy0), boşta ve kısa devre deney föyü.'},
  9:{start:'15:00',end:'17:00',loc:'Proje Atölyesi',desc:'İHA itki sistemi, BLDC motor-ESC seçimi ve güç bütçesi ara raporu teslimi.'},
  12:{start:'14:00',end:'16:00',loc:'D-204 / Kütüphane',desc:'Townsend & Streamer mekanizmaları, Paschen yasası ve kısmi deşarj (PD) not tekrarı.'},
  18:{start:'10:00',end:'12:00',loc:'Amfi B-102',desc:'VİZE SINAVI: Transfer fonksiyonu, Routh-Hurwitz kararlılık kriteri, kararlı hal hatası ve köklerin yer eğrisi.'},
  20:{start:'14:00',end:'16:00',loc:'Amfi A-201',desc:'VİZE SINAVI: Gazlarda/sıvılarda/katılarda delinme, küre elektrotlar, darbe gerilimi üreteçleri.'},
  24:{start:'10:30',end:'12:00',loc:'EM Laboratuvarı',desc:'Tek fazlı ve 3 fazlı transformatör eşdeğer devre, fazör diyagramı ve verim/regülasyon sözlü sınavı.'}
};

const GCAL={
  view:localStorage.getItem('agydesk_gcal_view')||'month', // 'day' | 'week' | 'month' | 'agenda' | 'semester'
  cursor:gcalTodayISO(), // YYYY-MM-DD
  miniMonth:null, // Date object for mini calendar month
  sideOpen:localStorage.getItem('agydesk_gcal_side')!=='0',
  showSchedule:localStorage.getItem('agydesk_gcal_sched')!=='0',
  search:'',
  agendaFilter:'all', // 'all' | 'exam' | 'pending' | 'done'
  kasaFilter:'all',
  kinds:{exam:true,lab:true,task:true,study:true,lecture:true,event:true},
  editingId:null,
  pomo:{sec:25*60,total:25*60,running:false,timer:null,endAt:null,mode:'25 dk Odak',taskTitle:'',customTitle:false}
};

function gcalPad(n){ return String(n).padStart(2,'0'); }
function gcalToISO(d){ return `${d.getFullYear()}-${gcalPad(d.getMonth()+1)}-${gcalPad(d.getDate())}`; }
function gcalFromISO(s){
  const [y,m,d]=(s||'2026-11-12').split('-').map(Number);
  return new Date(y||2026,(m||11)-1,d||12,12,0,0);
}
function gcalTodayISO(){
  const now=new Date();
  return gcalToISO(now);
}
function gcalDowMon(d){
  // Pazartesi=0 .. Pazar=6
  return (d.getDay()+6)%7;
}
function gcalStartOfWeek(d){
  const c=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0);
  c.setDate(c.getDate()-gcalDowMon(c));
  return c;
}
function gcalAddDays(d,n){
  const c=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0);
  c.setDate(c.getDate()+n);
  return c;
}
function gcalMin(hhmm){
  if(!hhmm||!hhmm.includes(':')) return 9*60;
  const [h,m]=hhmm.split(':').map(Number);
  return (isNaN(h)?9:h)*60+(isNaN(m)?0:m);
}
function gcalFmtMin(m){
  const c=Math.max(0,Math.min(23*60+59,Math.round(m)));
  return `${gcalPad(Math.floor(c/60))}:${gcalPad(c%60)}`;
}
function gcalDiffDays(isoA,isoB){
  const a=gcalFromISO(isoA), b=gcalFromISO(isoB);
  return Math.round((a-b)/(86400*1000));
}
function gcalFormatEta(ev,nowDate){
  const now=nowDate||new Date();
  if(ev.done) return {text:'✓ Bitti',state:'past',title:'Tamamlandı'};
  const iso=ev.date||gcalTodayISO();
  const [y,mo,da]=iso.split('-').map(Number);
  if(ev.allDay){
    const dd=gcalDiffDays(iso,gcalToISO(now));
    if(dd===0) return {text:'Tüm Gün',state:'now',title:'Bugün tüm gün'};
    if(dd>0) return {text:`${dd} gün`,state:'upcoming',title:`${dd} gün sonra`};
    return {text:'Geçti',state:'past',title:'Geçmiş etkinlik'};
  }
  const sMin=gcalMin(ev.start);
  const eMin=Math.max(sMin+1,gcalMin(ev.end||ev.start));
  const startDt=new Date(y,(mo||1)-1,da||1,Math.floor(sMin/60),sMin%60,0,0);
  const endDt=new Date(y,(mo||1)-1,da||1,Math.floor(eMin/60),eMin%60,0,0);
  if(now<startDt){
    const mins=Math.max(1,Math.ceil((startDt-now)/60000));
    if(mins<60) return {text:`${mins} dk`,state:'soon',title:`Başlamasına ${mins} dakika kaldı`};
    if(mins<1440){
      const h=Math.floor(mins/60), m=mins%60;
      const txt=m?`${h} sa ${m} dk`:`${h} sa`;
      return {text:txt,state:'upcoming',title:`Başlamasına ${txt} kaldı`};
    }
    const days=Math.floor(mins/1440), hrs=Math.floor((mins%1440)/60);
    const txt=hrs?`${days}g ${hrs}sa`:`${days} gün`;
    return {text:txt,state:'upcoming',title:`Başlamasına ${txt} kaldı`};
  }
  if(now<endDt){
    const rem=Math.max(1,Math.ceil((endDt-now)/60000));
    const h=Math.floor(rem/60), m=rem%60;
    const remTxt=h?(m?`${h} sa ${m} dk`:`${h} sa`):`${m} dk`;
    return {text:`Şimdi · ${remTxt}`,state:'now',title:`Devam ediyor · Bitmesine ${remTxt}`};
  }
  return {text:'Bitti',state:'past',title:'Etkinlik sona erdi'};
}
let _lastGcalEtaMin='';
function updateGcalCountdowns(nowDate){
  const now=nowDate||new Date();
  const key=`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if(key===_lastGcalEtaMin) return;
  const nodes=document.querySelectorAll('.gag-eta[data-date]');
  if(!nodes.length) return;
  _lastGcalEtaMin=key;
  nodes.forEach(el=>{
    const eta=gcalFormatEta({
      date:el.dataset.date,
      start:el.dataset.start,
      end:el.dataset.end,
      allDay:el.dataset.allday==='1',
      done:el.dataset.done==='1'
    },now);
    if(el.textContent!==eta.text) el.textContent=eta.text;
    const cls=`gag-eta ${eta.state}`;
    if(el.className!==cls) el.className=cls;
    if(el.title!==eta.title) el.title=eta.title;
  });
}
function gcalKasaTitle(k){
  if(!k||k==='all') return 'Genel Akademik';
  const found=(window.kasalarData||[]).find(x=>x.key===k);
  return found?found.title:k.replace(/_/g,' ');
}

function gcalFmtDateHuman(iso){
  const d=gcalFromISO(iso);
  return `${GCAL_DAYS_FULL[d.getDay()]}, ${d.getDate()} ${GCAL_MONTHS[d.getMonth()]}`;
}

function parseCalEvent(raw){
  let meta={};
  let kasaStr=raw.kasa||'';
  if(kasaStr.trim().startsWith('{')){
    try{ meta=JSON.parse(kasaStr); kasaStr=meta.kasa||''; }catch(e){}
  }
  const dayNum=Math.max(1,Math.min(31,Number(raw.day)||12));
  const seedDef=SEED_META_DEFAULTS[dayNum]||{};
  const kind=GCAL_KINDS[raw.kind]?raw.kind:(GCAL_KINDS[meta.kind]?meta.kind:'task');
  const defStart=kind==='exam'?'10:00':kind==='lab'?'13:30':kind==='study'?'20:00':'15:00';
  const defEnd=kind==='exam'?'12:00':kind==='lab'?'16:00':kind==='study'?'21:30':'16:30';
  const date=meta.date||`2026-11-${gcalPad(dayNum)}`;
  const isAllDay=!!meta.allDay;
  return {
    id:raw.id,
    day:dayNum,
    date,
    title:raw.title||'Etkinlik',
    kind,
    kasa:kasaStr||'',
    start:isAllDay?(meta.start||''):(meta.start||seedDef.start||defStart),
    end:isAllDay?(meta.end||''):(meta.end||seedDef.end||defEnd),
    allDay:isAllDay,
    loc:meta.loc||seedDef.loc||(kind==='exam'?'Sınav Amfisi':kind==='lab'?'Laboratuvar':''),
    desc:meta.desc||seedDef.desc||'',
    guests:meta.guests||'',
    meet:meta.meet||'',
    repeat:meta.repeat||'Yinelenmez',
    notify:meta.notify||'Bir gün önce şu saatte: 5pm bildir',
    done:!!meta.done,
    recurring:false
  };
}

function packCalMeta(ev){
  return JSON.stringify({
    kasa:ev.kasa||'',
    date:ev.date,
    start:ev.allDay?'':(ev.start||'10:00'),
    end:ev.allDay?'':(ev.end||'11:30'),
    allDay:!!ev.allDay,
    loc:ev.loc||'',
    desc:ev.desc||'',
    guests:ev.guests||'',
    meet:ev.meet||'',
    repeat:ev.repeat||'Yinelenmez',
    notify:ev.notify||'Bir gün önce şu saatte: 5pm bildir',
    done:!!ev.done,
    kind:ev.kind||'task'
  });
}

function getAllEventsForDate(isoDate){
  const list=calEvents.filter(e=>e.date===isoDate && GCAL.kinds[e.kind]!==false);
  if(GCAL.showSchedule && GCAL.kinds.lecture!==false && isoDate>='2026-09-28' && isoDate<='2027-01-03' && isoDate!=='2026-10-29' && isoDate!=='2027-01-01'){
    const d=gcalFromISO(isoDate);
    const dow=d.getDay(); // 0=Paz, 1=Pzt..6=Cmt
    // 2026-2027 Güz Eğitim-Öğretim dönemi (28.09.2026 - 03.01.2027, resmi tatiller hariç)
    EEM_WEEKLY_SCHEDULE.filter(s=>s.dow===dow).forEach((s,idx)=>{
      list.push({
        id:`lec_${isoDate}_${idx}`,
        day:d.getDate(),
        date:isoDate,
        title:s.title,
        kind:'lecture',
        kasa:s.kasa,
        start:s.start,
        end:s.end,
        allDay:false,
        loc:s.loc,
        desc:s.desc,
        done:false,
        recurring:true
      });
    });
  }
  return list.filter(e=>{
    if(GCAL.kasaFilter!=='all' && e.kasa!==GCAL.kasaFilter) return false;
    if(GCAL.search){
      const q=GCAL.search.toLowerCase();
      const hay=`${e.title} ${e.loc||''} ${e.desc||''} ${gcalKasaTitle(e.kasa)}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=>(a.allDay?-1:0)-(b.allDay?-1:0)||gcalMin(a.start)-gcalMin(b.start));
}

async function loadCalEvents(force=false){
  if(!calLoaded||force){
    try{
      const rows=await api('/api/calendar');
      if(Array.isArray(rows)) calEvents=rows.map(parseCalEvent);
      calLoaded=true;
    }catch(e){
      if(!calEvents.length){ calEvents=[]; }
    }
  }
}

document.addEventListener('click',()=>{const d=document.getElementById('gcalViewDd');if(d)d.classList.remove('open')});
function gcalSetView(v){
  GCAL.view=v;
  localStorage.setItem('agydesk_gcal_view',v);
  renderCal($('#main'),false);
}
function gcalToggleSide(){
  GCAL.sideOpen=!GCAL.sideOpen;
  localStorage.setItem('agydesk_gcal_side',GCAL.sideOpen?'1':'0');
  const el=$('.gcal');
  if(el) el.classList.toggle('no-side',!GCAL.sideOpen);
}
function gcalToggleSchedule(){
  GCAL.showSchedule=!GCAL.showSchedule;
  localStorage.setItem('agydesk_gcal_sched',GCAL.showSchedule?'1':'0');
  renderCal($('#main'),false);
  toast(GCAL.showSchedule?'🎓 Haftalık EEM ders programı katmanı açıldı':'🎓 Haftalık ders programı katmanı gizlendi');
}
function gcalGoToday(){
  GCAL.cursor=gcalTodayISO();
  GCAL.miniMonth=gcalFromISO(GCAL.cursor);
  renderCal($('#main'),false);
}
function gcalStep(dir){
  const d=gcalFromISO(GCAL.cursor);
  if(GCAL.view==='day') d.setDate(d.getDate()+dir);
  else if(GCAL.view==='week') d.setDate(d.getDate()+dir*7);
  else if(GCAL.view==='month') d.setMonth(d.getMonth()+dir);
  else if(GCAL.view==='schedule') d.setMonth(d.getMonth()+dir);
  else if(GCAL.view==='agenda') d.setMonth(d.getMonth()+dir);
  else if(GCAL.view==='semester') d.setMonth(d.getMonth()+dir*4);
  GCAL.cursor=gcalToISO(d);
  GCAL.miniMonth=new Date(d.getFullYear(),d.getMonth(),1,12,0,0);
  renderCal($('#main'),false);
}
function gcalSelectDate(iso,switchView=null){
  GCAL.cursor=iso;
  GCAL.miniMonth=gcalFromISO(iso);
  if(switchView) GCAL.view=switchView;
  renderCal($('#main'),false);
}
function gcalStepMini(dir){
  const m=GCAL.miniMonth||gcalFromISO(GCAL.cursor);
  GCAL.miniMonth=new Date(m.getFullYear(),m.getMonth()+dir,1,12,0,0);
  renderCal($('#main'),false);
}
function gcalToggleKind(k){
  GCAL.kinds[k]=!(GCAL.kinds[k]!==false);
  const el=document.querySelector(`.gcal-flt[data-kind="${k}"]`);
  if(el){
    el.classList.toggle('off',GCAL.kinds[k]===false);
    renderCalStageOnly();
    return;
  }
  renderCal($('#main'),false);
}
function gcalHeaderTitle(){
  const d=gcalFromISO(GCAL.cursor);
  if(GCAL.view==='day'){
    return `${d.getDate()} ${GCAL_MONTHS[d.getMonth()]} ${d.getFullYear()} · ${GCAL_DAYS_FULL[d.getDay()]}`;
  }
  if(GCAL.view==='week'){
    const s=gcalStartOfWeek(d), e=gcalAddDays(s,6);
    if(s.getMonth()===e.getMonth()) return `${s.getDate()} – ${e.getDate()} ${GCAL_MONTHS[s.getMonth()]} ${s.getFullYear()}`;
    return `${s.getDate()} ${GCAL_MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${GCAL_MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`;
  }
  if(GCAL.view==='semester'){
    return `Güz – Kış Akademik Dönemi (${d.getFullYear()})`;
  }
  return `${GCAL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function renderMiniCal(){
  const m=GCAL.miniMonth||gcalFromISO(GCAL.cursor);
  const y=m.getFullYear(), mo=m.getMonth();
  const first=new Date(y,mo,1,12,0,0);
  const startOffset=gcalDowMon(first);
  const startDate=gcalAddDays(first,-startOffset);
  const todayIso=gcalTodayISO();
  let cells='';
  GCAL_DAYS.forEach(dn=>{ cells+=`<div class="gmini-dh">${dn[0]}</div>`; });
  for(let i=0;i<42;i++){
    const cur=gcalAddDays(startDate,i);
    const iso=gcalToISO(cur);
    const isOther=cur.getMonth()!==mo;
    const isToday=iso===todayIso;
    const isSel=iso===GCAL.cursor;
    const dayEvs=calEvents.filter(e=>e.date===iso);
    const dots=dayEvs.slice(0,3).map(e=>`<i style="background:${(GCAL_KINDS[e.kind]||GCAL_KINDS.task).color}"></i>`).join('');
    cells+=`<div class="gmini-d ${isOther?'dim':''} ${isSel?'sel':''} ${isToday?'today':''}" onclick="gcalSelectDate('${iso}')">
      <span>${cur.getDate()}</span>
      ${dots?`<div class="gmini-dots">${dots}</div>`:''}
    </div>`;
  }
  return `<div class="gmini">
    <div class="gmini-hd">
      <span>${GCAL_MONTHS[mo]} ${y}</span>
      <div style="display:flex;gap:2px">
        <button class="gcal-icbtn" style="width:22px;height:22px" onclick="gcalStepMini(-1)" title="Önceki Ay">◀</button>
        <button class="gcal-icbtn" style="width:22px;height:22px" onclick="gcalStepMini(1)" title="Sonraki Ay">▶</button>
      </div>
    </div>
    <div class="gmini-grid">${cells}</div>
  </div>`;
}

function renderExamRadar(){
  const todayIso=gcalTodayISO();
  const upcoming=calEvents
    .filter(e=>!e.done && (e.kind==='exam'||e.kind==='lab'||e.kind==='task') && gcalDiffDays(e.date,todayIso)>=-1)
    .sort((a,b)=>a.date.localeCompare(b.date)||gcalMin(a.start)-gcalMin(b.start))
    .slice(0,5);
  if(!upcoming.length){
    return `<div style="font-size:12px;color:var(--mut);padding:6px 4px">Yaklaşan sınav veya teslim bulunmuyor.</div>`;
  }
  return upcoming.map(e=>{
    const diff=gcalDiffDays(e.date,todayIso);
    const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
    const badgeTxt=diff<0?'Dün':diff===0?'BUGÜN!':diff===1?'Yarın':`${diff} gün kaldı`;
    const pct=Math.max(8,Math.min(100,Math.round((14-Math.min(14,Math.max(0,diff)))/14*100)));
    return `<div class="gcal-cd" onclick="openCalModal(${e.id})" title="${e.title} · ${e.date}${e.allDay?' · Tüm Gün':(e.start?' '+e.start:'')}">
      <div class="gcal-cd-top">
        <span>${k.icon} ${e.title}</span>
        <span class="gcal-cd-badge" style="background:${k.solid};color:#fff;border:1px solid ${k.solid}">${badgeTxt}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font:10.5px var(--mono);color:var(--mut)">
        <span>${e.date.split('-').reverse().slice(0,2).join('.')} · ${e.allDay?'Tüm Gün':e.start}</span>
        <span>${gcalKasaTitle(e.kasa).slice(0,18)}</span>
      </div>
      <div class="gcal-cd-bar"><i style="width:${pct}%;background:${k.color}"></i></div>
    </div>`;
  }).join('');
}

function renderMonthStage(){
  const d=gcalFromISO(GCAL.cursor);
  const y=d.getFullYear(), mo=d.getMonth();
  const first=new Date(y,mo,1,12,0,0);
  const startOffset=gcalDowMon(first);
  const startDate=gcalAddDays(first,-startOffset);
  const todayIso=gcalTodayISO();

  let hdr=GCAL_DAYS.map(dn=>`<div>${dn}</div>`).join('');
  let cells='';
  for(let i=0;i<42;i++){
    const cur=gcalAddDays(startDate,i);
    const iso=gcalToISO(cur);
    const isOther=cur.getMonth()!==mo;
    const isToday=iso===todayIso;
    const isWknd=cur.getDay()===0||cur.getDay()===6;
    const evs=getAllEventsForDate(iso);
    const dayLabel=(cur.getDate()===1||i===0)?`${cur.getDate()} ${GCAL_MONTHS_SHORT[cur.getMonth()]}`:cur.getDate();
    cells+=`<div class="gmcell ${isOther?'other':''} ${isWknd?'wknd':''} ${isToday?'today':''}" data-date="${iso}"
      onclick="gcalCellClick(event,'${iso}')"
      ondblclick="openCalModal(null,'${iso}')"
      ondragover="gcalDragOver(event)"
      ondragleave="gcalDragLeave(event)"
      ondrop="gcalDropOnDay(event,'${iso}')">
      <div class="gmcell-top">
        <span class="gmcell-num" onclick="event.stopPropagation();gcalSelectDate('${iso}','day')" title="Günlük görünüme git">${dayLabel}</span>
        ${isToday?`<span style="font:700 9.5px var(--mono);color:var(--cu)">BUGÜN</span>`:(evs.length?`<span style="font:10px var(--mono);opacity:.6">${evs.length}</span>`:'')}
      </div>
      <div class="gmcell-evs">
        ${evs.map(e=>{
          const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
          const safeTitle=e.title.replace(/"/g,'&quot;');
          return `<div class="gev-pill ${e.done?'done':''}" draggable="${!e.recurring}"
            ondragstart="gcalDragStart(event,'${e.id}')"
            onclick="event.stopPropagation();openCalModal('${e.id}')"
            style="background:${k.solid};color:#fff;border-left-color:transparent"
            title="${e.allDay?'Tüm Gün':`${e.start}–${e.end}`} · ${safeTitle}${e.loc?' ('+e.loc+')':''}">
            ${e.allDay?`<b>•</b>`:`<b>${e.start}</b>`}<span>${e.title}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }
  return `<div class="gmonth">
    <div class="gmonth-hdr">${hdr}</div>
    <div class="gmonth-grid">${cells}</div>
  </div>`;
}

function layoutOverlappingEvents(evs){
  // Çakışan saatli etkinlikleri yan yana sütunlara böler (Google Calendar algoritması)
  const sorted=[...evs].sort((a,b)=>gcalMin(a.start)-gcalMin(b.start)||(gcalMin(b.end)-gcalMin(a.end)));
  const clusters=[];
  let curCluster=[], clusterEnd=-1;
  sorted.forEach(e=>{
    const s=gcalMin(e.start), en=Math.max(s+30,gcalMin(e.end));
    if(curCluster.length && s<clusterEnd){
      curCluster.push(e);
      clusterEnd=Math.max(clusterEnd,en);
    }else{
      if(curCluster.length) clusters.push(curCluster);
      curCluster=[e];
      clusterEnd=en;
    }
  });
  if(curCluster.length) clusters.push(curCluster);

  const positioned=[];
  clusters.forEach(cl=>{
    const cols=[];
    cl.forEach(e=>{
      const s=gcalMin(e.start), en=Math.max(s+30,gcalMin(e.end));
      let placed=false;
      for(let c=0;c<cols.length;c++){
        if(cols[c]<=s){
          cols[c]=en;
          positioned.push({ev:e,col:c,totalCols:0});
          placed=true;
          break;
        }
      }
      if(!placed){
        cols.push(en);
        positioned.push({ev:e,col:cols.length-1,totalCols:0});
      }
    });
    const nCols=cols.length;
    positioned.slice(-cl.length).forEach(p=>{ p.totalCols=nCols; });
  });
  return positioned;
}

function renderTimeGrid(daysList,isSingleDay=false){
  const START_H=0, END_H=24; // 00:00 .. 24:00 (24 saat * 60px = 1440px)
  const todayIso=gcalTodayISO();
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes();
  const colCls=isSingleDay?'cols-1':'cols-7';

  let topHdr=`<div class="gw-tz">GMT+3</div>`;
  let allDayCells=`<div class="gw-ad-lbl">TÜM GÜN</div>`;
  daysList.forEach(d=>{
    const iso=gcalToISO(d);
    const isToday=iso===todayIso;
    const dn=GCAL_DAYS[gcalDowMon(d)];
    topHdr+=`<div class="gw-dh ${isToday?'today':''}" onclick="gcalSelectDate('${iso}','day')" title="Günlük görünüme geç">
      <div class="dn">${dn}</div>
      <div class="dd">${d.getDate()}</div>
    </div>`;
    const allEvs=getAllEventsForDate(iso);
    const adEvs=allEvs.filter(e=>e.allDay||e.kind==='exam');
    allDayCells+=`<div class="gw-ad-cell" onclick="openCalModal(null,'${iso}')" title="${iso} — Tüm gün etkinliği ekle">
      ${adEvs.map(e=>{
        const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
        return `<div class="gev-pill ${e.done?'done':''}" onclick="event.stopPropagation();openCalModal('${e.id}')" style="background:${k.solid};color:#fff;border-left-color:transparent">
          <span>${k.icon} ${e.title}</span>
        </div>`;
      }).join('')}
    </div>`;
  });

  let timeLabels='';
  for(let h=START_H;h<END_H;h++){
    timeLabels+=`<div class="gw-tlbl">${h===START_H?'':`${gcalPad(h)}:00`}</div>`;
  }

  let colsHtml='';
  daysList.forEach(d=>{
    const iso=gcalToISO(d);
    const isToday=iso===todayIso;
    let slots='';
    for(let h=START_H;h<END_H;h++){
      const hh=`${gcalPad(h)}:00`;
      slots+=`<div class="gw-slot" onclick="openCalModal(null,'${iso}','${hh}')"
        ondragover="gcalDragOver(event)"
        ondragleave="gcalDragLeave(event)"
        ondrop="gcalDropOnSlot(event,'${iso}',${h})"
        title="${iso} ${hh} — Etkinlik eklemek için tıkla"></div>`;
    }
    const evs=getAllEventsForDate(iso).filter(e=>!e.allDay);
    const pos=layoutOverlappingEvents(evs);
    const evBlocks=pos.map(({ev,col,totalCols})=>{
      const k=GCAL_KINDS[ev.kind]||GCAL_KINDS.task;
      const sMin=Math.max(START_H*60,gcalMin(ev.start));
      const eMin=Math.min(END_H*60,Math.max(sMin+35,gcalMin(ev.end)));
      const topPx=Math.max(0,(sMin-START_H*60));
      const heightPx=Math.max(28,(eMin-sMin)-2);
      const widthPct=100/totalCols;
      const leftPct=col*widthPct;
      return `<div class="gw-ev ${ev.recurring?'lec':''} ${ev.done?'done':''}"
        draggable="${!ev.recurring}"
        ondragstart="gcalDragStart(event,'${ev.id}')"
        onclick="event.stopPropagation();openCalModal('${ev.id}')"
        style="top:${topPx}px;height:${heightPx}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 5px);background:${k.solid};color:#fff;border:1px solid ${k.solid}">
        <div class="et">${ev.start} – ${ev.end}</div>
        <div class="en">${k.icon} ${ev.title}</div>
        ${heightPx>=48&&ev.loc?`<div class="el">📍 ${ev.loc}</div>`:''}
        ${heightPx>=68&&ev.kasa?`<div class="el">❖ ${gcalKasaTitle(ev.kasa)}</div>`:''}
      </div>`;
    }).join('');

    let nowLine='';
    if(isToday && nowMin>=START_H*60 && nowMin<=END_H*60){
      const nowTop=nowMin-START_H*60;
      nowLine=`<div class="gw-now" style="top:${nowTop}px"><span class="gw-now-tag">${gcalPad(now.getHours())}:${gcalPad(now.getMinutes())}</span></div>`;
    }
    colsHtml+=`<div class="gw-col ${isToday?'today':''}">${slots}${evBlocks}${nowLine}</div>`;
  });

  return `<div class="gweek">
    <div class="gweek-scroll" id="gweekScroll">
      <div class="gweek-head">
        <div class="gweek-top ${colCls}">${topHdr}</div>
        <div class="gw-allday ${colCls}">${allDayCells}</div>
      </div>
      <div class="gweek-grid ${colCls}" style="height:${(END_H-START_H)*60}px">
        <div class="gw-times">${timeLabels}</div>
        ${colsHtml}
      </div>
    </div>
  </div>`;
}

function renderWeekStage(){
  const start=gcalStartOfWeek(gcalFromISO(GCAL.cursor));
  const days=Array.from({length:7},(_,i)=>gcalAddDays(start,i));
  return renderTimeGrid(days,false);
}

function renderDayStage(){
  const cur=gcalFromISO(GCAL.cursor);
  const iso=GCAL.cursor;
  const dayEvs=getAllEventsForDate(iso);
  const p=GCAL.pomo;
  const pct=Math.round((p.sec/Math.max(1,p.total))*100);
  const mm=gcalPad(Math.floor(p.sec/60)), ss=gcalPad(p.sec%60);
  const pomoLabel=gcalGetPomoLabel();

  // O günkü ders kasalarına ait notları bul
  const activeKasas=new Set(dayEvs.map(e=>e.kasa).filter(Boolean));
  const relatedNotes=Object.entries(window.pages||{}).filter(([id,pg])=>id.startsWith('note:')&&(activeKasas.size?activeKasas.has(pg.kasa):true)).slice(0,6);

  return `<div class="gday-wrap">
    ${renderTimeGrid([cur],true)}
    <div class="gcal-resizer gcal-resizer-r" onmousedown="gcalStartResize(event,'cockpit')" ondblclick="gcalResetResize('cockpit')" title="Sürükle: Pomodoro / Odak panelini boyutlandır (Çift tık: sıfırla)"></div>
    <div class="gday-cockpit">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font:600 11px var(--mono);color:var(--cu);text-transform:uppercase">GÜNLÜK ODAK KOKPİTİ</div>
          <div style="font-size:16px;font-weight:600">${cur.getDate()} ${GCAL_MONTHS[cur.getMonth()]} ${GCAL_DAYS_FULL[cur.getDay()]}</div>
        </div>
        <button class="gcal-btn pri" onclick="openCalModal(null,'${iso}','14:00')">＋ Saat Ekle</button>
      </div>

      <!-- Pomodoro Odak Sayacı -->
      <div class="gpomo">
        <div class="gpomo-ring" id="gpomoRing" style="--pp:${pct}" onpointerdown="gcalPomoDialDown(event)" title="Halkadan tutup sürükleyerek süreyi ayarla">
          <span class="gpomo-knob" id="gpomoKnob"></span>
          <span class="gpomo-time" id="gpomoTime">${mm}:${ss}</span>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
          <div id="gpomoMode" style="font:600 11px var(--mono);color:var(--cu)">⏱ POMODORO ÇALIŞMA SAYACI · ${p.mode}</div>
          <div style="font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${pomoLabel}">🎯 ${pomoLabel}</span>${p.customTitle?`<button class="gcal-icbtn" title="Aktif kasaya dön" onclick="gcalClearPomoCustom()" style="font-size:11px;padding:0 5px">↺</button>`:''}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center">
            <button class="gcal-btn ${p.running?'on':''}" onclick="gcalPomoToggle()">${p.running?'⏸ Duraklat':'▶ Başlat'}</button>
            <button class="gcal-btn" onclick="gcalPomoReset(25,'25 dk Odak')">25 dk</button>
            <button class="gcal-btn" onclick="gcalPomoReset(50,'50 dk Derin')">50 dk</button>
            <button class="gcal-btn" onclick="gcalPomoReset(90,'90 dk Blok')">90 dk</button>
            <button class="gcal-btn" onclick="gcalPomoReset(5,'5 dk Mola')">Mola</button>
          </div>
          <div class="gpomo-prefs">${(()=>{const pr=getPomoPrefs();return `
            <button type="button" class="gpomo-pref ${pr.rail?'on':''}" onclick="togglePomoPref('rail')" title="AgyCal kapalıyken sol kenar çubuğunda geri sayım halkası göster">${pr.rail?'✓':'○'} Sol Rail Halkası</button>
            <button type="button" class="gpomo-pref ${pr.title?'on':''}" onclick="togglePomoPref('title')" title="Sayacı tarayıcı/pencere başlığında göster">${pr.title?'✓':'○'} Pencere Başlığı</button>
          `;})()}</div>
        </div>
      </div>

      <!-- Seçili Günün Görev & Etkinlik Listesi -->
      <div class="gcal-sec">
        <div class="gcal-sec-hd"><span>GÜNÜN PLANI (${dayEvs.length})</span><span style="color:var(--cu);cursor:pointer" onclick="gcalAskAiForDay('${iso}')">✨ AI ile Günü Planla</span></div>
        ${dayEvs.length?dayEvs.map(e=>{
          const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
          const eta=gcalFormatEta(e);
          return `<div class="gag-card" style="padding:8px 11px" onclick="openCalModal('${e.id}')">
            ${!e.recurring?`<input type="checkbox" ${e.done?'checked':''} onclick="event.stopPropagation();gcalToggleDone(${e.id})" style="accent-color:var(--cu);cursor:pointer">`:`<span class="gag-dot" style="background:${k.color}"></span>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;font-weight:600;${e.done?'text-decoration:line-through;opacity:.55':''}">${k.icon} ${e.title}</div>
              <div style="font:11px var(--mono);color:var(--mut)">${e.allDay?'Tüm Gün':`${e.start}–${e.end}`}${e.loc?' · 📍 '+e.loc:''}</div>
            </div>
            <span class="gag-eta ${eta.state}" data-date="${e.date||iso}" data-start="${e.start||''}" data-end="${e.end||''}" data-allday="${e.allDay?'1':'0'}" data-done="${e.done?'1':'0'}" title="${eta.title}">${eta.text}</span>
            <button class="gcal-icbtn" onclick="event.stopPropagation();gcalStartPomoFor('${e.title.replace(/'/g,"\\'")}')" title="Bu görev için Pomodoro başlat">⏱</button>
          </div>`;
        }).join(''):`<div style="padding:14px;border:1px dashed var(--line);border-radius:10px;color:var(--mut);font-size:12.5px;text-align:center">Bu gün için kayıtlı sınav veya görev yok. Zaman çizelgesinde bir saate tıklayarak ekleyebilirsin.</div>`}
      </div>

      <!-- İlgili Kasa Notları -->
      <div class="gcal-sec">
        <div class="gcal-sec-hd"><span>İLGİLİ DERS NOTLARI &amp; KAYNAKLAR</span></div>
        ${relatedNotes.map(([id,pg])=>`
          <div class="gag-card" style="padding:7px 10px" onclick="openPage('${id}',true,{newTab:true})">
            <span>${pg.i||'📄'}</span>
            <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${pg.t}</div>
            <span style="font:10px var(--mono);color:var(--cu)">${pg.folder||''} ↗</span>
          </div>
        `).join('')}
      </div>
    </div>
  </div>`;
}

function renderAgendaStage(){
  const todayIso=gcalTodayISO();
  let list=calEvents.filter(e=>GCAL.kinds[e.kind]!==false);
  if(GCAL.kasaFilter!=='all') list=list.filter(e=>e.kasa===GCAL.kasaFilter);
  if(GCAL.agendaFilter==='exam') list=list.filter(e=>e.kind==='exam'||e.kind==='lab');
  if(GCAL.agendaFilter==='pending') list=list.filter(e=>!e.done);
  if(GCAL.agendaFilter==='done') list=list.filter(e=>e.done);
  if(GCAL.search){
    const q=GCAL.search.toLowerCase();
    list=list.filter(e=>`${e.title} ${e.loc||''} ${e.desc||''} ${gcalKasaTitle(e.kasa)}`.toLowerCase().includes(q));
  }
  list.sort((a,b)=>a.date.localeCompare(b.date)||gcalMin(a.start)-gcalMin(b.start));

  const byDate={};
  list.forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
  const dates=Object.keys(byDate).sort();
  const anchorIso=dates.find(iso=>iso>=todayIso)||dates[dates.length-1]||'';

  return `<div class="gagenda">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line)">
      <div>
        <h2 style="font-size:20px;letter-spacing:-.02em">📋 Akademik Planlama &amp; Sınav Ajandası</h2>
        <div style="font-size:12.5px;color:var(--mut)">Tüm vize, lab, proje teslimi ve çalışma bloklarının kronolojik yol haritası</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <div class="gcal-seg">
          <button class="${GCAL.agendaFilter==='all'?'on':''}" onclick="GCAL.agendaFilter='all';renderCal($('#main'),false)">Tümü (${calEvents.length})</button>
          <button class="${GCAL.agendaFilter==='exam'?'on':''}" onclick="GCAL.agendaFilter='exam';renderCal($('#main'),false)">🔴 Sınav &amp; Lab</button>
          <button class="${GCAL.agendaFilter==='pending'?'on':''}" onclick="GCAL.agendaFilter='pending';renderCal($('#main'),false)">⏳ Bekleyenler</button>
          <button class="${GCAL.agendaFilter==='done'?'on':''}" onclick="GCAL.agendaFilter='done';renderCal($('#main'),false)">✓ Tamamlananlar</button>
        </div>
        <button class="gcal-btn" onclick="const a=document.getElementById('gagTodayAnchor');if(a)a.scrollIntoView({behavior:'smooth',block:'start'})">📅 Bugüne Git</button>
        <button class="gcal-btn pri" onclick="gcalAskAiStudyPlan()">✨ AI Çalışma Programı Çıkar</button>
      </div>
    </div>
    ${dates.length?dates.map(iso=>{
      const d=gcalFromISO(iso);
      const diff=gcalDiffDays(iso,todayIso);
      const isToday=diff===0;
      const relTxt=diff===0?'BUGÜN':diff===1?'YARIN':diff===-1?'DÜN':diff>1?`${diff} gün sonra`:`${Math.abs(diff)} gün önce`;
      const anchorAttr=iso===anchorIso?' id="gagTodayAnchor"':'';
      return `<div class="gag-day"${anchorAttr}>
        <div class="gag-date ${isToday?'today':''}">
          <span class="dnum">${d.getDate()}</span>
          <div>
            <div class="dmeta">${GCAL_MONTHS_SHORT[d.getMonth()]} · ${GCAL_DAYS[gcalDowMon(d)]}</div>
            <div style="font:600 10.5px var(--mono);color:${isToday?'var(--cu)':diff>0&&diff<=7?'var(--err)':'var(--mut)'}">${relTxt}</div>
          </div>
        </div>
        <div class="gag-list">
          ${byDate[iso].map(e=>{
            const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
            return `<div class="gag-card" onclick="openCalModal('${e.id}')">
              <input type="checkbox" ${e.done?'checked':''} onclick="event.stopPropagation();gcalToggleDone(${e.id})" style="accent-color:var(--cu);width:15px;height:15px;cursor:pointer" title="Tamamlandı olarak işaretle">
              <span class="gag-dot" style="background:${k.color}"></span>
              <span class="gag-time">${e.allDay?'Tüm Gün':`${e.start} – ${e.end}`}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13.5px;${e.done?'text-decoration:line-through;opacity:.55':''}">${k.icon} ${e.title}</div>
                ${e.desc?`<div style="font-size:12px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.desc}</div>`:''}
              </div>
              ${e.loc?`<span style="font:11px var(--mono);color:var(--mut);padding:2px 7px;background:var(--bg2);border-radius:6px;white-space:nowrap">📍 ${e.loc}</span>`:''}
              ${e.kasa?`<span class="pdf-badge" onclick="event.stopPropagation();enterKasa('${e.kasa}','write')" title="Dersin kasasına git">❖ ${gcalKasaTitle(e.kasa)}</span>`:''}
              <button class="gcal-btn" style="padding:3px 8px;font-size:11px" onclick="event.stopPropagation();gcalPrepWithAi(${e.id})" title="AI ile bu sınava/göreve çalış">✨ Hazırlan</button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join(''):`<div style="padding:40px;text-align:center;color:var(--mut)">Seçili filtreye uygun etkinlik bulunamadı.</div>`}
  </div>`;
}

function gcalIsoWeek(d){
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=t.getUTCDay()||7;
  t.setUTCDate(t.getUTCDate()+4-day);
  const yStart=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil((((t-yStart)/86400000)+1)/7);
}

function gprogMonthBanner(m,y){
  const scenes=[
    // 0: Ocak - Karlı yıldızlı gece, dağlar, çamlar, kulübe ve küçük uçak
    {bg:'linear-gradient(160deg,#152238 0%,#1f3354 60%,#2c4870 100%)',svg:`
      <circle cx="310" cy="24" r="14" fill="#fef3c7" opacity=".9"/>
      <circle cx="315" cy="21" r="12" fill="#1f3354"/>
      <circle cx="95" cy="20" r="1.6" fill="#fff" opacity=".8"/><circle cx="155" cy="14" r="1.2" fill="#fff" opacity=".6"/><circle cx="230" cy="26" r="1.5" fill="#fff" opacity=".75"/><circle cx="380" cy="18" r="1.4" fill="#fff" opacity=".7"/><circle cx="430" cy="30" r="1.8" fill="#fff" opacity=".8"/>
      <path d="M0,128 L0,82 L75,48 L155,86 L245,42 L340,84 L430,52 L520,80 L520,128 Z" fill="#2a4060"/>
      <path d="M0,128 L0,96 Q120,76 250,98 T520,88 L520,128 Z" fill="#dbeafe" opacity=".9"/>
      <path d="M0,128 L0,108 Q180,94 350,110 T520,104 L520,128 Z" fill="#f8fafc"/>
      <polygon points="62,102 74,66 86,102" fill="#1e3a2f"/><polygon points="82,104 92,74 102,104" fill="#254b3c"/>
      <polygon points="410,100 424,60 438,100" fill="#1e3a2f"/><polygon points="436,103 448,70 460,103" fill="#254b3c"/>
      <rect x="190" y="84" width="28" height="18" rx="2" fill="#7c2d12"/><polygon points="186,85 204,70 222,85" fill="#9a3412"/><rect x="200" y="90" width="8" height="12" fill="#fde68a"/>
    `},
    // 1: Şubat - Kış tepeleri, buz gölü ve uçan kuşlar
    {bg:'linear-gradient(160deg,#1e3a5f 0%,#3a608f 60%,#7aa6cc 100%)',svg:`
      <circle cx="410" cy="34" r="18" fill="#fde68a" opacity=".85"/>
      <path d="M0,128 L0,78 Q90,46 185,78 T380,66 L520,84 L520,128 Z" fill="#cbd5e1" opacity=".45"/>
      <path d="M0,128 L0,94 Q130,78 270,96 T520,90 L520,128 Z" fill="#e2e8f0"/>
      <path d="M0,128 L0,110 Q200,100 360,112 T520,106 L520,128 Z" fill="#f1f5f9"/>
      <path d="M120,42 Q126,36 132,42 Q138,36 144,42" stroke="#fff" stroke-width="1.8" fill="none" opacity=".8"/>
      <path d="M158,32 Q163,27 168,32 Q173,27 178,32" stroke="#fff" stroke-width="1.5" fill="none" opacity=".7"/>
      <polygon points="330,98 342,64 354,98" fill="#334155"/><polygon points="350,100 360,72 370,100" fill="#475569"/>
    `},
    // 2: Mart - Bahar başlangıcı, kiraz çiçekleri ve rüzgarlı tepe
    {bg:'linear-gradient(160deg,#2d5a4c 0%,#4b8b72 60%,#8fc9a3 100%)',svg:`
      <circle cx="420" cy="32" r="20" fill="#fef08a" opacity=".9"/>
      <path d="M0,128 L0,88 Q120,62 240,90 T520,76 L520,128 Z" fill="#3f7d58"/>
      <path d="M0,128 L0,104 Q170,86 340,104 T520,96 L520,128 Z" fill="#5aa469"/>
      <rect x="86" y="72" width="6" height="36" fill="#5c4033"/>
      <circle cx="89" cy="64" r="20" fill="#fbcfe8"/><circle cx="74" cy="70" r="14" fill="#f9a8d4"/><circle cx="104" cy="70" r="14" fill="#f9a8d4"/>
      <polygon points="310,30 326,42 310,56 294,42" fill="#fb7185"/><path d="M310,56 Q315,74 306,90" stroke="#fff" stroke-width="1.4" fill="none" opacity=".7"/>
    `},
    // 3: Nisan - Yağmur bulutları, gökkuşağı ve filizler
    {bg:'linear-gradient(160deg,#2b4c7e 0%,#4a7ab5 60%,#89b4e0 100%)',svg:`
      <path d="M180,105 A95,95 0 0,1 370,105" stroke="#fca5a5" stroke-width="5" fill="none" opacity=".55"/>
      <path d="M188,105 A87,87 0 0,1 362,105" stroke="#fde047" stroke-width="5" fill="none" opacity=".55"/>
      <path d="M196,105 A79,79 0 0,1 354,105" stroke="#86efac" stroke-width="5" fill="none" opacity=".55"/>
      <path d="M0,128 L0,96 Q140,76 280,98 T520,92 L520,128 Z" fill="#3b7a57"/>
      <path d="M0,128 L0,110 Q200,98 380,112 T520,108 L520,128 Z" fill="#4d9b6a"/>
      <circle cx="110" cy="36" r="16" fill="#fff" opacity=".85"/><circle cx="128" cy="34" r="20" fill="#fff" opacity=".9"/><circle cx="148" cy="38" r="15" fill="#fff" opacity=".85"/>
    `},
    // 4: Mayıs - Çiçekli çayır ve sıcak güneş
    {bg:'linear-gradient(160deg,#1f6f50 0%,#3da36d 55%,#9be29f 100%)',svg:`
      <circle cx="430" cy="34" r="22" fill="#fde047" opacity=".95"/>
      <path d="M0,128 L0,90 Q130,68 260,92 T520,82 L520,128 Z" fill="#2e8b57"/>
      <path d="M0,128 L0,106 Q170,92 340,108 T520,100 L520,128 Z" fill="#43aa68"/>
      <circle cx="80" cy="108" r="4" fill="#fef08a"/><circle cx="135" cy="112" r="4" fill="#f9a8d4"/><circle cx="215" cy="106" r="4" fill="#fff"/><circle cx="290" cy="114" r="4" fill="#fde047"/><circle cx="370" cy="108" r="4" fill="#f9a8d4"/>
    `},
    // 5: Haziran - Deniz, yelkenli ve yaz güneşi
    {bg:'linear-gradient(160deg,#0f4c81 0%,#1f78b4 55%,#67b7dc 100%)',svg:`
      <circle cx="425" cy="32" r="20" fill="#fde047" opacity=".95"/>
      <path d="M0,128 L0,88 Q120,76 260,88 T520,86 L520,128 Z" fill="#0ea5e9"/>
      <path d="M0,128 L0,104 Q140,94 280,104 T520,102 L520,128 Z" fill="#0284c7"/>
      <polygon points="220,84 220,42 252,78" fill="#fff"/><polygon points="216,84 216,50 194,80" fill="#e0f2fe"/>
      <path d="M188,84 L258,84 L248,94 L198,94 Z" fill="#f97316"/>
    `},
    // 6: Temmuz - Dağ kampı, çadır ve yaz gökyüzü
    {bg:'linear-gradient(160deg,#1d4ed8 0%,#3b82f6 55%,#93c5fd 100%)',svg:`
      <circle cx="110" cy="34" r="20" fill="#fef08a"/>
      <path d="M0,128 L0,84 L95,44 L190,88 L295,38 L405,86 L520,56 L520,128 Z" fill="#1e3a8a" opacity=".55"/>
      <path d="M0,128 L0,98 Q180,82 360,102 T520,94 L520,128 Z" fill="#15803d"/>
      <polygon points="270,104 300,68 330,104" fill="#f59e0b"/><polygon points="292,104 300,80 308,104" fill="#78350f"/>
      <polygon points="370,102 384,66 398,102" fill="#14532d"/>
    `},
    // 7: Ağustos - Altın gün batımı ve palmiyeler
    {bg:'linear-gradient(160deg,#7c2d12 0%,#ea580c 55%,#fbbf24 100%)',svg:`
      <circle cx="260" cy="84" r="34" fill="#fef08a" opacity=".92"/>
      <path d="M0,128 L0,94 Q140,80 280,96 T520,90 L520,128 Z" fill="#9a3412"/>
      <path d="M0,128 L0,110 Q200,98 380,112 T520,106 L520,128 Z" fill="#431407"/>
      <path d="M405,108 Q412,76 420,56" stroke="#290d04" stroke-width="5" fill="none"/>
      <path d="M420,56 Q395,48 382,62 M420,56 Q442,46 456,60 M420,56 Q418,36 432,34 M420,56 Q400,66 394,78" stroke="#290d04" stroke-width="3" fill="none"/>
    `},
    // 8: Eylül - Sonbahar tepeleri ve dökülen yapraklar
    {bg:'linear-gradient(160deg,#78350f 0%,#b45309 55%,#f59e0b 100%)',svg:`
      <circle cx="415" cy="36" r="18" fill="#fef3c7" opacity=".9"/>
      <path d="M0,128 L0,88 Q120,62 250,90 T520,80 L520,128 Z" fill="#92400e"/>
      <path d="M0,128 L0,106 Q170,90 340,108 T520,98 L520,128 Z" fill="#78350f"/>
      <circle cx="96" cy="70" r="22" fill="#ea580c"/><circle cx="122" cy="76" r="16" fill="#dc2626"/><rect x="104" y="84" width="6" height="24" fill="#451a03"/>
      <ellipse cx="220" cy="48" rx="5" ry="2.5" fill="#fed7aa" transform="rotate(25 220 48)"/><ellipse cx="275" cy="64" rx="5" ry="2.5" fill="#fca5a5" transform="rotate(-20 275 64)"/>
    `},
    // 9: Ekim - Kızıl orman ve sonbahar sisi
    {bg:'linear-gradient(160deg,#4c1d24 0%,#88292f 55%,#d97706 100%)',svg:`
      <path d="M0,128 L0,84 Q110,56 230,88 T520,76 L520,128 Z" fill="#7f1d1d" opacity=".7"/>
      <path d="M0,128 L0,102 Q160,84 320,104 T520,94 L520,128 Z" fill="#450a0a"/>
      <polygon points="70,104 86,58 102,104" fill="#b45309"/><polygon points="100,106 114,66 128,106" fill="#dc2626"/>
      <polygon points="360,102 376,56 392,102" fill="#b45309"/><polygon points="392,104 406,66 420,104" fill="#991b1b"/>
      <circle cx="240" cy="108" r="7" fill="#f97316"/><circle cx="256" cy="110" r="5" fill="#fb923c"/>
    `},
    // 10: Kasım - Puslu geç sonbahar tepeleri ve rüzgar
    {bg:'linear-gradient(160deg,#2c3e50 0%,#4a607a 55%,#8fa3b8 100%)',svg:`
      <circle cx="385" cy="36" r="18" fill="#fde68a" opacity=".75"/>
      <path d="M0,128 L0,86 Q125,58 260,88 T520,78 L520,128 Z" fill="#3b4d61"/>
      <path d="M0,128 L0,104 Q180,88 350,106 T520,98 L520,128 Z" fill="#2b3a4a"/>
      <path d="M90,104 L90,68 M90,82 L76,70 M90,78 L104,68" stroke="#1e293b" stroke-width="3" fill="none"/>
      <path d="M180,46 Q240,40 295,48" stroke="#e2e8f0" stroke-width="1.5" fill="none" opacity=".45"/>
      <path d="M210,58 Q265,52 325,60" stroke="#e2e8f0" stroke-width="1.2" fill="none" opacity=".35"/>
    `},
    // 11: Aralık - Karlı çam ormanı ve kutup ışıkları
    {bg:'linear-gradient(160deg,#0f172a 0%,#1e3a5f 55%,#2dd4bf 100%)',svg:`
      <path d="M40,48 Q150,12 260,44 T480,26" stroke="#5eead4" stroke-width="16" fill="none" opacity=".22" stroke-linecap="round"/>
      <circle cx="90" cy="22" r="1.5" fill="#fff" opacity=".85"/><circle cx="195" cy="16" r="1.3" fill="#fff" opacity=".7"/><circle cx="330" cy="24" r="1.7" fill="#fff" opacity=".85"/><circle cx="430" cy="18" r="1.4" fill="#fff" opacity=".75"/>
      <path d="M0,128 L0,92 Q140,74 280,94 T520,86 L520,128 Z" fill="#cbd5e1"/>
      <path d="M0,128 L0,108 Q190,96 360,110 T520,104 L520,128 Z" fill="#f1f5f9"/>
      <polygon points="65,108 80,62 95,108" fill="#0f5132"/><polygon points="94,110 107,72 120,110" fill="#146c43"/>
      <polygon points="390,106 406,58 422,106" fill="#0f5132"/><polygon points="420,108 434,68 448,108" fill="#146c43"/>
    `}
  ];
  const sc=scenes[m%12];
  return `<div class="gprog-month" style="background:${sc.bg}">
    <div class="gprog-month-title">${GCAL_MONTHS[m]} ${y}</div>
    <svg class="gprog-month-art" viewBox="0 0 520 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${sc.svg}</svg>
  </div>`;
}

let _gprogState=null;

function gprogBuildRange(startDt,endDt,todayIso,st){
  let html='';
  for(let dt=new Date(startDt);dt<=endDt;dt=gcalAddDays(dt,1)){
    const iso=gcalToISO(dt);
    const m=dt.getMonth(), y=dt.getFullYear();
    if(m!==st.curMonth){
      st.curMonth=m;
      html+=gprogMonthBanner(m,y);
    }
    const dow=gcalDowMon(dt);
    const wStart=gcalAddDays(dt,-dow);
    const wEnd=gcalAddDays(wStart,6);
    const wKey=gcalToISO(wStart);
    const evs=getAllEventsForDate(iso);
    const isToday=iso===todayIso;
    const isAnchor=!st.anchorSet&&iso>=todayIso;
    if(isAnchor) st.anchorSet=true;

    if(wKey!==st.lastWeekKey){
      st.lastWeekKey=wKey;
      const wNo=gcalIsoWeek(dt);
      const sameMon=wStart.getMonth()===wEnd.getMonth();
      const rangeTxt=sameMon
        ?`${wStart.getDate()} – ${wEnd.getDate()} ${GCAL_MONTHS_SHORT[wEnd.getMonth()]}`
        :`${wStart.getDate()} ${GCAL_MONTHS_SHORT[wStart.getMonth()]} – ${wEnd.getDate()} ${GCAL_MONTHS_SHORT[wEnd.getMonth()]}`;
      html+=`<div class="gprog-week">${wNo}. Hafta, ${rangeTxt}</div>`;
    }
    if(!evs.length && !isToday) continue;

    const anchorAttr=isAnchor?' id="gprogTodayAnchor"':'';
    const dayAbbr=GCAL_DAYS[dow];
    html+=`<div class="gprog-day ${isToday?'today':''}"${anchorAttr}>
      <div class="gprog-date">
        <span class="dn">${dayAbbr}</span>
        <span class="dd">${dt.getDate()}</span>
      </div>
      <div class="gprog-list">
        ${evs.length?evs.map(e=>{
          const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
          const timeTxt=e.allDay?'Tüm Gün':`${e.start}–${e.end}`;
          return `<div class="gprog-ev ${e.done?'done':''}" onclick="openCalModal('${e.id}')" style="background:${k.solid}">
            <div class="gprog-ev-title">${k.icon} ${e.title}</div>
            <div class="gprog-ev-sub">${timeTxt}${e.loc?` · ${e.loc}`:''}</div>
          </div>`;
        }).join(''):`<div class="gprog-empty" onclick="openCalModal(null,'${iso}')">Bugün için etkinlik yok · eklemek için tıkla</div>`}
      </div>
    </div>`;
  }
  return html;
}

function gprogAppendMore(){
  if(!_gprogState||_gprogState.loading) return;
  const inner=document.getElementById('gprogInner');
  if(!inner) return;
  _gprogState.loading=true;
  const nextStart=gcalAddDays(_gprogState.endDt,1);
  const nextEnd=new Date(nextStart.getFullYear(),nextStart.getMonth()+3,0,12,0,0);
  const chunk=gprogBuildRange(nextStart,nextEnd,gcalTodayISO(),_gprogState);
  _gprogState.endDt=nextEnd;
  if(chunk) inner.insertAdjacentHTML('beforeend',chunk);
  _gprogState.loading=false;
}

let _gprogRaf=0;
function gprogUpdateParallax(sc){
  if(!sc) return;
  const sr=sc.getBoundingClientRect();
  const mid=sr.top+sr.height*0.5;
  const updates=[];
  sc.querySelectorAll('.gprog-month').forEach(m=>{
    const r=m.getBoundingClientRect();
    if(r.bottom<sr.top-80||r.top>sr.bottom+80) return;
    const art=m.querySelector('.gprog-month-art');
    if(!art) return;
    const shift=Math.max(-18,Math.min(18,-((r.top+r.bottom)*0.5-mid)*0.07));
    updates.push([art,shift]);
  });
  for(let i=0;i<updates.length;i++){
    updates[i][0].style.transform=`translate3d(0,${updates[i][1].toFixed(1)}px,0) scale(1.18)`;
  }
}

function gprogOnScroll(el){
  if(!el) return;
  if(el.scrollTop+el.clientHeight>=el.scrollHeight-420) gprogAppendMore();
  if(!_gprogRaf){
    _gprogRaf=requestAnimationFrame(()=>{ _gprogRaf=0; gprogUpdateParallax(el); });
  }
}

function gprogInit(){
  const sc=document.querySelector('.gprog');
  if(!sc) return;
  gprogUpdateParallax(sc);
}

function renderScheduleStage(){
  const todayIso=gcalTodayISO();
  const cur=gcalFromISO(GCAL.cursor);
  const start=new Date(cur.getFullYear(),cur.getMonth(),1,12,0,0);
  const end=new Date(cur.getFullYear(),cur.getMonth()+4,0,12,0,0);
  _gprogState={curMonth:-1,lastWeekKey:'',anchorSet:false,endDt:end,loading:false};
  const html=gprogBuildRange(start,end,todayIso,_gprogState);
  return `<div class="gprog" onscroll="gprogOnScroll(this)"><div class="gprog-inner" id="gprogInner">${html}</div></div>`;
}

function renderSemesterStage(){
  const baseYear=gcalFromISO(GCAL.cursor).getFullYear();
  const semMonths=[
    {y:baseYear,m:9},  // Ekim
    {y:baseYear,m:10}, // Kasım
    {y:baseYear,m:11}, // Aralık
    {y:baseYear+1,m:0} // Ocak
  ];
  const exams=calEvents.filter(e=>e.kind==='exam').length;
  const labs=calEvents.filter(e=>e.kind==='lab').length;
  const tasks=calEvents.filter(e=>e.kind==='task'||e.kind==='study').length;
  const doneCount=calEvents.filter(e=>e.done).length;
  const todayIso=gcalTodayISO();

  const monthCards=semMonths.map(({y,m})=>{
    const first=new Date(y,m,1,12,0,0);
    const offset=gcalDowMon(first);
    const start=gcalAddDays(first,-offset);
    let cells=GCAL_DAYS.map(d=>`<div class="gmini-dh">${d[0]}</div>`).join('');
    for(let i=0;i<42;i++){
      const cur=gcalAddDays(start,i);
      const iso=gcalToISO(cur);
      const isOther=cur.getMonth()!==m;
      const evs=calEvents.filter(e=>e.date===iso);
      const hasExam=evs.some(e=>e.kind==='exam');
      const hasLab=evs.some(e=>e.kind==='lab');
      const hasTask=evs.length>0;
      const bg=isOther?'transparent':hasExam?'#ff6b6b38':hasLab?'#52b78838':hasTask?'#e0a45835':'transparent';
      const bd=iso===todayIso?'2px solid var(--cu)':hasExam?'1px solid #ff6b6b':hasLab?'1px solid #52b788':'0';
      cells+=`<div class="gmini-d ${isOther?'dim':''}" style="background:${bg};border:${bd}" onclick="gcalSelectDate('${iso}','month')" title="${iso}${evs.length?' · '+evs.map(x=>x.title).join(', '):''}">${cur.getDate()}</div>`;
    }
    return `<div class="gmini" style="padding:14px">
      <div class="gmini-hd" style="font-size:14px;margin-bottom:10px">
        <span>${GCAL_MONTHS[m]} ${y}</span>
        <span style="font:11px var(--mono);color:var(--cu)">${calEvents.filter(e=>e.date.startsWith(`${y}-${gcalPad(m+1)}`)).length} etkinlik</span>
      </div>
      <div class="gmini-grid" style="gap:4px">${cells}</div>
    </div>`;
  }).join('');

  return `<div class="gsem">
    <div>
      <h2 style="font-size:21px;letter-spacing:-.02em">🎓 Akademik Dönem Haritası &amp; Yoğunluk Radarı</h2>
      <div style="font-size:12.5px;color:var(--mut)">4 aylık Güz/Kış dönemi sınav yoğunluğu ısı haritası — bir güne tıklayarak o aya/güne odaklanabilirsin</div>
    </div>
    <div class="gsem-stats">
      <div class="gsem-stat"><span style="font:11px var(--mono);color:var(--mut)">TOPLAM SINAV / VİZE</span><b style="color:${gcalInk(GCAL_KINDS.exam)}">${exams}</b><small style="color:var(--mut)">Kırmızı işaretli günler</small></div>
      <div class="gsem-stat"><span style="font:11px var(--mono);color:var(--mut)">LAB &amp; DENEY</span><b style="color:${gcalInk(GCAL_KINDS.lab)}">${labs}</b><small style="color:var(--mut)">Yeşil işaretli günler</small></div>
      <div class="gsem-stat"><span style="font:11px var(--mono);color:var(--mut)">ÖDEV &amp; ÇALIŞMA BLOĞU</span><b style="color:${gcalInk(GCAL_KINDS.task)}">${tasks}</b><small style="color:var(--mut)">Kehribar işaretli günler</small></div>
      <div class="gsem-stat"><span style="font:11px var(--mono);color:var(--mut)">TAMAMLAMA ORANI</span><b style="color:var(--ok)">${calEvents.length?Math.round(doneCount/calEvents.length*100):0}%</b><small style="color:var(--mut)">${doneCount}/${calEvents.length} tamamlandı</small></div>
    </div>
    <div class="gsem-months">${monthCards}</div>
  </div>`;
}

function gcalApplySavedWidths(){
  const sw=Number(localStorage.getItem('agydesk_gcal_side_w')||0);
  const cw=Number(localStorage.getItem('agydesk_gcal_cockpit_w')||0);
  if(sw>=180 && sw<=440) document.documentElement.style.setProperty('--gcal-side-w',sw+'px');
  if(cw>=360 && cw<=640) document.documentElement.style.setProperty('--gcal-cockpit-w',cw+'px');
  else if(cw>0 && cw<360){
    document.documentElement.style.setProperty('--gcal-cockpit-w','360px');
    localStorage.setItem('agydesk_gcal_cockpit_w','360');
  }
}
function gcalStartResize(ev,which){
  if(ev.button!==0) return;
  ev.preventDefault();
  const handle=ev.currentTarget;
  handle.classList.add('on');
  document.body.style.cursor='col-resize';
  const startX=ev.clientX;
  const target=which==='side'?$('.gcal-side'):$('.gday-cockpit');
  const startW=target?target.getBoundingClientRect().width:(which==='side'?256:380);
  const onMove=e=>{
    const dx=e.clientX-startX;
    const raw=which==='side'?(startW+dx):(startW-dx);
    const min=which==='side'?180:360, max=which==='side'?440:640;
    const w=Math.round(Math.max(min,Math.min(max,raw)));
    const prop=which==='side'?'--gcal-side-w':'--gcal-cockpit-w';
    const key=which==='side'?'agydesk_gcal_side_w':'agydesk_gcal_cockpit_w';
    document.documentElement.style.setProperty(prop,w+'px');
    localStorage.setItem(key,String(w));
  };
  const onUp=()=>{
    handle.classList.remove('on');
    document.body.style.cursor='';
    window.removeEventListener('mousemove',onMove);
    window.removeEventListener('mouseup',onUp);
  };
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
}
function gcalResetResize(which){
  const prop=which==='side'?'--gcal-side-w':'--gcal-cockpit-w';
  const key=which==='side'?'agydesk_gcal_side_w':'agydesk_gcal_cockpit_w';
  document.documentElement.style.removeProperty(prop);
  localStorage.removeItem(key);
}

async function renderCal(m,fetchApi=true){
  if(!m) m=$('#main');
  gcalApplySavedWidths();
  if(fetchApi&&!calLoaded) await loadCalEvents(false);
  if(!GCAL.miniMonth) GCAL.miniMonth=gcalFromISO(GCAL.cursor);
  if(typeof renderTabs==='function') renderTabs();

  const stageHtml=GCAL.view==='day'?renderDayStage()
    :GCAL.view==='week'?renderWeekStage()
    :GCAL.view==='schedule'?renderScheduleStage()
    :GCAL.view==='agenda'?renderAgendaStage()
    :GCAL.view==='semester'?renderSemesterStage()
    :renderMonthStage();

  const p=GCAL.pomo;
  const pomoMm=gcalPad(Math.floor(p.sec/60)), pomoSs=gcalPad(p.sec%60);
  const nowDt=new Date();
  const curMonShort=GCAL_MONTHS[nowDt.getMonth()].slice(0,3).toUpperCase();
  const conflicts=gcalDetectConflicts();
  const prevSideScroll=m.querySelector('.gcal-side')?.scrollTop||0;
  const prevWeekScroll=m.querySelector('#gweekScroll')?.scrollTop;

  m.innerHTML=`<div class="gcal ${GCAL.sideOpen?'':'no-side'}">
    <!-- Üst AgyCal Araç Çubuğu -->
    <div class="gcal-top">
      <button class="gcal-icbtn" onclick="gcalToggleSide()" title="Sol Mini Takvim &amp; Filtre Panelini Aç/Kapat">☰</button>
      <div class="gcal-brand">
        <div class="gic">
          <div class="gic-m">${curMonShort}</div>
          <div class="gic-d">${nowDt.getDate()}</div>
        </div>
        <span class="gcal-brand-txt"><b>Agy</b><span>Cal</span></span>
        <span class="gcal-brand-badge">PRO</span>
      </div>
      <div class="gcal-nav">
        <button class="gcal-btn" onclick="gcalGoToday()" title="Bugüne Git (Kısayol: T)">Bugün</button>
        <button class="gcal-icbtn" onclick="gcalStep(-1)" title="Önceki Dönem">◀</button>
        <button class="gcal-icbtn" onclick="gcalStep(1)" title="Sonraki Dönem">▶</button>
      </div>
      <div class="gcal-title">${gcalHeaderTitle()}</div>

      ${conflicts.length?`<span class="acal-tab-pill exam" style="padding:3px 8px;font-size:11px;cursor:pointer" onclick="gcalSelectDate('${conflicts[0].date}','day')" title="${conflicts.map(c=>c.label).join(' | ')}">⚠️ ${conflicts.length} Saat Çakışması</span>`:''}

      <span style="flex:1"></span>

      <div class="gcal-search">
        <i>🔍</i>
        <input id="gcalSearchIn" value="${GCAL.search.replace(/"/g,'&quot;')}" placeholder="AgyCal'de ara…" oninput="GCAL.search=this.value;renderCalStageOnly()">
      </div>

      <button class="gcal-btn ${GCAL.showSchedule?'on':''}" onclick="gcalToggleSchedule()" title="Haftalık sabit EEM ders programını takvimde göster/gizle">🎓 Ders Programı</button>

      <button class="gcal-btn ${p.running?'on':''}" onclick="gcalSetView('day')" title="Günlük Odak &amp; Pomodoro Sayacı">⏱ <span id="gcalTopPomo">${pomoMm}:${pomoSs}</span></button>

      <button class="gcal-btn" onclick="gcalExportICS()" title="AgyCal takvimini .ics olarak indir (Google/Apple/Telefon Takvimine aktar)">📲 .ics</button>

      <div class="gcal-dd" id="gcalViewDd"><button class="gcal-btn" onclick="event.stopPropagation();const dd=document.getElementById('gcalViewDd');const host=dd.closest('.gcal');const r=dd.getBoundingClientRect();const hr=host?host.getBoundingClientRect():{left:0,right:innerWidth};dd.classList.toggle('align-right',(hr.right-r.left)<180&&(r.right-hr.left)>=180);dd.classList.toggle('open')" title="Görünüm Değiştir (D/W/M/P/A/Y)">${({day:'Gün',week:'Hafta',month:'Ay',schedule:'Program',agenda:'Planlama',semester:'Dönem'})[GCAL.view]||'Ay'} ▾</button><div class="gcal-dd-menu">${[['day','Gün','D'],['week','Hafta','W'],['month','Ay','M'],['schedule','Program','P'],['agenda','Planlama','A'],['semester','Dönem','Y']].map(v=>`<button class="${GCAL.view===v[0]?'on':''}" onclick="gcalSetView('${v[0]}')">${v[1]}<kbd>${v[2]}</kbd></button>`).join('')}</div></div>

      <button class="gcal-btn pri" onclick="openCalModal(null,GCAL.cursor)" title="Yeni Etkinlik / Sınav Oluştur (Kısayol: C)">＋ Oluştur</button>
    </div>

    <!-- AgyCal Doğal Dil Sihirli Komut Çubuğu -->
    <div class="gcal-smartbar">
      <div class="gcal-smart-in">
        <span style="color:var(--cu);font-size:14px">⚡</span>
        <input id="gcalSmartInput" placeholder="AgyCal Sihirli Ekle: &quot;Bugün sunumu bitir #görev&quot; veya &quot;Cuma 14:00 Yüksek Gerilim Lab #lab @D-204&quot; yazıp Enter'a bas (Kısayol: Q)" oninput="gcalSmartPreview(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();gcalSmartSubmit();}">
        <button class="gcal-btn pri" style="padding:3px 9px;font-size:11.5px" onclick="gcalSmartSubmit()">Ekle ↵</button>
      </div>
      <div class="gcal-smart-prev" id="gcalSmartPrev">
        <span style="color:var(--mut)">Örnek: <u style="cursor:pointer;color:var(--cu)" onclick="const el=$('#gcalSmartInput');el.value='Cuma 14:00–16:00 Trafo Boşta Çalışma Deneyi #lab @D-102';gcalSmartPreview(el.value);el.focus()">Cuma 14:00 Trafo Deneyi #lab @D-102</u></span>
      </div>
    </div>

    <!-- Gövde: Sol Mini Takvim + Ana Görünüm Sahnesi -->
    <div class="gcal-body">
      <aside class="gcal-side">
        <button class="gcal-create-big" onclick="openCalModal(null,GCAL.cursor)">
          <span style="font-size:18px;line-height:1">＋</span>
          <span>Yeni Sınav / Etkinlik</span>
        </button>

        ${renderMiniCal()}

        <div class="gcal-sec">
          <div class="gcal-sec-hd">
            <span>🔥 YAKLAŞAN SINAV RADARI</span>
            <span style="color:var(--ok)">● Canlı</span>
          </div>
          ${renderExamRadar()}
        </div>

        <div class="gcal-sec">
          <div class="gcal-sec-hd"><span>TAKVİMLERİM (KATEGORİLER)</span></div>
          ${Object.values(GCAL_KINDS).map(k=>{
            const on=GCAL.kinds[k.id]!==false;
            const cnt=k.id==='lecture'?EEM_WEEKLY_SCHEDULE.length+' ders/hf':calEvents.filter(e=>e.kind===k.id).length;
            return `<div class="gcal-flt ${on?'':'off'}" data-kind="${k.id}" onclick="gcalToggleKind('${k.id}')">
              <span class="chk" style="background:${k.color}">✓</span>
              <span style="flex:1">${k.icon} ${k.label}</span>
              <small style="font:10.5px var(--mono);color:var(--mut)">${cnt}</small>
            </div>`;
          }).join('')}
        </div>

        <div class="gcal-sec">
          <div class="gcal-sec-hd"><span>DERS KASASI FİLTRESİ</span></div>
          <select class="gmodal-in" style="padding:5px 8px;font-size:12px" onchange="GCAL.kasaFilter=this.value;renderCalStageOnly()">
            ${renderKasaGroupOptions(GCAL.kasaFilter==='all'?'':GCAL.kasaFilter,'❖ Tüm Ders Kasaları').replace('value=""','value="all"')}
          </select>
        </div>

        <button class="gcal-btn" style="width:100%;justify-content:center;border-color:var(--cu);color:var(--cu);margin-top:auto" onclick="gcalAskAiStudyPlan()">
          ✨ Bu Haftayı AI ile Planla
        </button>
      </aside>
      <div class="gcal-resizer gcal-resizer-l" onmousedown="gcalStartResize(event,'side')" ondblclick="gcalResetResize('side')" title="Sürükle: Sol takvim panelini boyutlandır (Çift tık: sıfırla)"></div>

      <div class="gcal-stage" id="gcalStage">
        ${stageHtml}
      </div>
    </div>

    <!-- Etkinlik Oluşturma / Düzenleme / Detay Modalı -->
    <div class="gmodal-bg" id="gcalModalBg" onclick="if(event.target.id==='gcalModalBg')closeCalModal()">
      <div class="gmodal" id="gcalModal"></div>
    </div>
  </div>`;
  const nextSide=m.querySelector('.gcal-side');
  if(nextSide&&prevSideScroll) nextSide.scrollTop=prevSideScroll;
  const nextWeek=m.querySelector('#gweekScroll');
  if(nextWeek){
    if(typeof prevWeekScroll==='number'&&prevWeekScroll>0) nextWeek.scrollTop=prevWeekScroll;
    else requestAnimationFrame(gcalScrollToNow);
  }
  if(GCAL.view==='agenda'||GCAL.view==='schedule'){
    requestAnimationFrame(()=>{
      const a=document.getElementById(GCAL.view==='agenda'?'gagTodayAnchor':'gprogTodayAnchor');
      if(a) a.scrollIntoView({block:'start'});
      if(GCAL.view==='schedule') gprogInit();
    });
  }
}

function gcalScrollToNow(){
  const sc=$('#gweekScroll'); if(!sc) return;
  const now=new Date();
  const nowPx=now.getHours()*60+now.getMinutes();
  const target=Math.max(0,Math.min(sc.scrollHeight-sc.clientHeight,Math.round(nowPx-sc.clientHeight*0.38)));
  sc.scrollTop=target;
}

function renderCalStageOnly(){
  const st=$('#gcalStage');
  if(!st) return;
  const scrollSel=['.gweek-scroll','.gday-cockpit','.gagenda','.gprog','.gsem'];
  const saved=scrollSel.map(sel=>[sel,st.querySelector(sel)?.scrollTop||0]);
  st.innerHTML=GCAL.view==='day'?renderDayStage()
    :GCAL.view==='week'?renderWeekStage()
    :GCAL.view==='schedule'?renderScheduleStage()
    :GCAL.view==='agenda'?renderAgendaStage()
    :GCAL.view==='semester'?renderSemesterStage()
    :renderMonthStage();
  saved.forEach(([sel,top])=>{
    const el=st.querySelector(sel);
    if(el&&top) el.scrollTop=top;
  });
  if(GCAL.view==='schedule') gprogInit();
}

function gcalCellClick(ev,iso){
  GCAL.cursor=iso;
  $$('.gmcell').forEach(c=>c.style.outline=c.dataset.date===iso?'1.5px solid var(--cu)':'');
}

/* --- Sürükle & Bırak (Drag & Drop) ile Etkinlik Taşıma --- */
let gcalDraggedId=null;
function gcalDragStart(ev,id){
  gcalDraggedId=id;
  ev.dataTransfer.setData('text/gcal',String(id));
  ev.dataTransfer.effectAllowed='move';
}
function gcalDragOver(ev){
  ev.preventDefault();
  ev.dataTransfer.dropEffect='move';
  ev.currentTarget.classList.add('drop-hot');
}
function gcalDragLeave(ev){
  ev.currentTarget.classList.remove('drop-hot');
}
async function gcalDropOnDay(ev,targetIso){
  ev.preventDefault();
  ev.currentTarget.classList.remove('drop-hot');
  const id=Number(ev.dataTransfer.getData('text/gcal')||gcalDraggedId);
  const item=calEvents.find(x=>x.id===id);
  if(!item||item.date===targetIso) return;
  item.date=targetIso;
  item.day=gcalFromISO(targetIso).getDate();
  await persistCalEventUpdate(item);
  toast(`▦ "${item.title}" → ${targetIso} tarihine taşındı`);
}
async function gcalDropOnSlot(ev,targetIso,hour){
  ev.preventDefault();
  ev.currentTarget.classList.remove('drop-hot');
  const id=Number(ev.dataTransfer.getData('text/gcal')||gcalDraggedId);
  const item=calEvents.find(x=>x.id===id);
  if(!item) return;
  const dur=item.allDay?60:Math.max(30,gcalMin(item.end)-gcalMin(item.start));
  const newStart=hour*60;
  item.date=targetIso;
  item.day=gcalFromISO(targetIso).getDate();
  item.allDay=false;
  item.start=gcalFmtMin(newStart);
  item.end=gcalFmtMin(newStart+dur);
  await persistCalEventUpdate(item);
  toast(`▦ "${item.title}" → ${targetIso} ${item.start} saatine taşındı`);
}

async function persistCalEventUpdate(item){
  try{
    if(item.id && typeof item.id==='number'){
      await api('/api/calendar/'+item.id,null,'DELETE').catch(()=>{});
    }
    const saved=await api('/api/calendar',{
      day:item.day,
      title:item.title,
      kind:item.kind,
      kasa:packCalMeta(item)
    });
    if(saved&&saved.id) item.id=saved.id;
  }catch(e){}
  renderCal($('#main'),false);
}

/* --- Etkinlik Oluşturma / Düzenleme Modalı (Google Takvim Birebir UI) --- */
function openCalModal(evId=null,defaultDate=null,defaultStart=null){
  const bg=$('#gcalModalBg'), box=$('#gcalModal');
  if(!bg||!box) return;
  box.style.transform='';
  let ev=null;
  if(evId!==null && evId!==undefined){
    ev=calEvents.find(x=>String(x.id)===String(evId));
    if(!ev && String(evId).startsWith('lec_')){
      const parts=String(evId).split('_');
      const iso=parts[1];
      const all=getAllEventsForDate(iso);
      ev=all.find(x=>String(x.id)===String(evId));
    }
  }
  const isRec=ev&&ev.recurring;
  const isEdit=!!(ev&&!isRec);
  GCAL.editingId=isEdit?ev.id:null;

  const dateVal=ev?ev.date:(defaultDate||GCAL.cursor||gcalTodayISO());
  const isAllDay=ev?!!ev.allDay:!defaultStart;
  const startVal=(ev&&ev.start)?ev.start:(defaultStart||'10:00');
  const endVal=(ev&&ev.end)?ev.end:gcalFmtMin(gcalMin(startVal)+60);
  const kindVal=ev?ev.kind:'exam';
  const kasaVal=ev?ev.kasa:(currentKasa!=='all'?currentKasa:'');
  const locVal=ev?(ev.loc||''):'';
  const descVal=ev?(ev.desc||''):'';
  const guestsVal=ev?(ev.guests||''):'';
  const meetVal=ev?(ev.meet||''):'';
  const repeatVal=ev?(ev.repeat||'Yinelenmez'):'Yinelenmez';
  const notifyVal=ev?(ev.notify||'Bir gün önce şu saatte: 5pm bildir'):'Bir gün önce şu saatte: 5pm bildir';
  const titleVal=ev?ev.title:'';
  const humanDate=gcalFmtDateHuman(dateVal);
  const curKindObj=GCAL_KINDS[kindVal]||GCAL_KINDS.exam;

  if(isRec){
    const k=GCAL_KINDS[ev.kind]||GCAL_KINDS.lecture;
    box.innerHTML=`
      <div class="gm-top" onmousedown="gcalStartModalDrag(event)">
        <span class="gm-handle" title="Taşı">＝</span>
        <button class="gm-close" onclick="closeCalModal()" title="Kapat">✕</button>
      </div>
      <div class="gm-title-wrap">
        <div style="font:600 20px var(--sans);color:var(--txt);padding-bottom:6px;border-bottom:2px solid ${k.color}">${k.icon} ${ev.title}</div>
      </div>
      <div class="gm-rows" style="padding:8px 20px 14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;font:12.5px var(--mono);color:var(--cu);margin-bottom:8px">
          <span>📅 ${humanDate}</span><span>·</span><span>⏰ ${ev.start} – ${ev.end}</span><span>·</span><span>📍 ${ev.loc||'Amfi'}</span>
        </div>
        <div style="font-size:13.5px;color:var(--txt);line-height:1.55;margin-bottom:10px">${ev.desc||'Haftalık sabit EEM ders programı bloğu.'}</div>
        <div style="padding:10px 12px;background:var(--bg);border-radius:10px;font-size:12px;color:var(--mut)">
          💡 Bu blok haftalık EEM ders programından otomatik yansıtılmaktadır.
        </div>
      </div>
      <div class="gm-foot">
        <button class="gm-more-btn" onclick="closeCalModal();enterKasa('${ev.kasa}','write')">❖ Ders Kasasını Aç</button>
        <div style="display:flex;gap:8px">
          <button class="gm-pill-btn" onclick="closeCalModal();gcalStartPomoFor('${ev.title.replace(/'/g,"\\'")}')">⏱ Pomodoro</button>
          <button class="gm-save-btn" onclick="closeCalModal();rtab('ai');aiSend('side_ai','${ev.title} dersinin bu haftaki konuları (${ev.desc}) için sınav odaklı özet ve çalışma soruları hazırla.')">✨ AI ile Çalış</button>
        </div>
      </div>`;
    bg.classList.add('show');
    return;
  }

  box.innerHTML=`
    <!-- Üst Sürükleme Çubuğu (= ve ✕) -->
    <div class="gm-top" onmousedown="gcalStartModalDrag(event)">
      <span class="gm-handle" title="Paneli sürükle">＝</span>
      <div style="display:flex;align-items:center;gap:4px">
        ${isEdit?`
          <button class="gm-close" onclick="closeCalModal();gcalPrepWithAi(${ev.id})" title="AI ile Sınava Hazırlan" style="font-size:14px">✨</button>
          <button class="gm-close" onclick="deleteCalFromModal(${ev.id})" title="Etkinliği Sil" style="color:var(--err);font-size:14px">🗑</button>
        `:''}
        <button class="gm-close" onclick="closeCalModal()" title="Kapat (Esc)">✕</button>
      </div>
    </div>

    <!-- Başlık ve Zaman Ekle (Mavi alt çizgili) -->
    <div class="gm-title-wrap">
      <input class="gm-title-in" id="gmTitle" placeholder="Başlık ekle (saat isteğe bağlı)" value="${titleVal.replace(/"/g,'&quot;')}" onkeydown="if(event.key==='Enter')saveCalFromModal()">
    </div>

    <!-- Etkinlik / Görev / Sınav / Lab Sekmeleri -->
    <div class="gm-tabs" id="gmKindWrap">
      <button type="button" class="gm-tab gm-kbtn ${kindVal==='exam'?'on':''}" data-k="exam" onclick="gcalSetModalKind('exam')">Etkinlik / Sınav</button>
      <button type="button" class="gm-tab gm-kbtn ${kindVal==='task'?'on':''}" data-k="task" onclick="gcalSetModalKind('task')">Görev</button>
      <button type="button" class="gm-tab gm-kbtn ${kindVal==='lab'?'on':''}" data-k="lab" onclick="gcalSetModalKind('lab')">Lab Deneyi</button>
      <button type="button" class="gm-tab gm-kbtn ${kindVal==='study'?'on':''}" data-k="study" onclick="gcalSetModalKind('study')">Çalışma</button>
      <button type="button" class="gm-tab gm-kbtn ${kindVal==='event'?'on':''}" data-k="event" onclick="gcalSetModalKind('event')">🏁 Paddock & Etkinlik</button>
    </div>

    <!-- İkonlu Google Calendar Satırları -->
    <div class="gm-rows">
      <!-- 1. Saat / Tarih Satırı -->
      <div class="gm-r align-top" onclick="gcalExpandTimeRow()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
        </div>
        <div class="gm-rbody">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span id="gmDateHuman" style="font-weight:500">${humanDate} &nbsp;–&nbsp; ${humanDate}</span>
            <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
              <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--mut);cursor:pointer;user-select:none">
                <input type="checkbox" id="gmAllDay" ${isAllDay?'checked':''} onchange="gcalToggleAllDay(this.checked)" style="accent-color:var(--gblue);cursor:pointer"> Tüm gün
              </label>
              <button type="button" class="gm-pill-btn" id="gmAddTimeBtn" style="display:${isAllDay?'inline-block':'none'}" onclick="gcalExpandTimeRow(true)">Zaman ekle</button>
            </div>
          </div>
          <div class="gm-sub" id="gmRepeatSub">${isAllDay?`Tüm gün · ${repeatVal}`:`${repeatVal} · ${startVal} – ${endVal}`}</div>
          <div id="gmTimeExpand" style="display:${isAllDay?'none':'flex'};flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center" onclick="event.stopPropagation()">
            <input type="date" class="gmodal-in" id="gmDate" value="${dateVal}" style="width:138px" onchange="$('#gmDateHuman').innerHTML=gcalFmtDateHuman(this.value)+' &nbsp;–&nbsp; '+gcalFmtDateHuman(this.value)">
            <span id="gmTimeInputs" style="display:${isAllDay?'none':'inline-flex'};align-items:center;gap:6px">
              <input type="time" class="gmodal-in" id="gmStart" value="${startVal}" style="width:98px" onchange="gcalSyncTimeSub()">
              <span style="color:var(--mut)">–</span>
              <input type="time" class="gmodal-in" id="gmEnd" value="${endVal}" style="width:98px" onchange="gcalSyncTimeSub()">
            </span>
            <select class="gmodal-in" id="gmRepeat" style="width:130px;font-size:12px" onchange="gcalSyncTimeSub()">
              <option value="Yinelenmez" ${repeatVal==='Yinelenmez'?'selected':''}>Yinelenmez</option>
              <option value="Her hafta" ${repeatVal==='Her hafta'?'selected':''}>Her hafta</option>
              <option value="Her gün" ${repeatVal==='Her gün'?'selected':''}>Her gün</option>
              <option value="Sınav haftası boyunca" ${repeatVal==='Sınav haftası boyunca'?'selected':''}>Sınav haftası boyunca</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 2. Davetli / Çalışma Grubu Ekle -->
      <div class="gm-r" onclick="$('#gmGuests')?.focus()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="gm-rbody">
          <input class="gm-inline-in" id="gmGuests" placeholder="Davetli ekle" value="${guestsVal.replace(/"/g,'&quot;')}">
        </div>
      </div>

      <!-- 3. Google Meet / Canlı AI Çalışma Görüşmesi Ekle -->
      <div class="gm-r" onclick="gcalToggleMeetRow()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24" style="stroke:none">
            <rect x="2" y="6" width="13" height="12" rx="2.5" fill="#fbbc04"/>
            <path d="M15 9.5l5-3.5v12l-5-3.5v-5z" fill="#34a853"/>
            <rect x="2" y="6" width="6" height="6" rx="1.5" fill="#ea4335"/>
            <rect x="9" y="12" width="6" height="6" rx="1" fill="#4285f4"/>
          </svg>
        </div>
        <div class="gm-rbody">
          <div id="gmMeetTxt" style="color:${meetVal?'var(--gblue)':'var(--mut)'};font-weight:${meetVal?'500':'400'}">${meetVal||'Google Meet video konferans görüşmesi ekle'}</div>
          <input type="hidden" id="gmMeet" value="${meetVal.replace(/"/g,'&quot;')}">
        </div>
      </div>

      <!-- 4. Konum Ekle -->
      <div class="gm-r" onclick="$('#gmLoc')?.focus()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="gm-rbody">
          <input class="gm-inline-in" id="gmLoc" placeholder="konum ekle" value="${locVal.replace(/"/g,'&quot;')}">
        </div>
      </div>

      <!-- 5. Açıklama veya Google Drive / Kasa Eki Ekle -->
      <div class="gm-r align-top" onclick="gcalExpandDescRow()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>
        </div>
        <div class="gm-rbody">
          <input class="gm-inline-in" id="gmDescShort" placeholder="açıklama veya Google Drive eki ekle" value="${descVal.replace(/"/g,'&quot;')}" style="display:${descVal?'none':'block'}" onfocus="gcalExpandDescRow()">
          <div id="gmDescWrap" style="display:${descVal?'flex':'none'};flex-direction:column;gap:6px" onclick="event.stopPropagation()">
            <textarea class="gmodal-in" id="gmDesc" rows="2" placeholder="Açıklama, sınav konuları veya çalışma notu ekle…" style="resize:vertical">${descVal.replace(/</g,'&lt;')}</textarea>
            <div style="display:flex;gap:6px;align-items:center">
              <select class="gmodal-in" style="font-size:11.5px;padding:4px 8px" onchange="if(this.value){const ta=$('#gmDesc');ta.value=(ta.value?ta.value+'\\n':'')+'📎 Ekli Kasa Notu: [['+this.value+']]';this.value='';}">
                <option value="">📎 AgyDesk Kasasından Not / PDF Ekle…</option>
                ${Object.entries(window.pages||{}).filter(([id])=>id.startsWith('note:')).slice(0,25).map(([id,p])=>`<option value="${id.slice(5)}">${p.folder?p.folder+' · ':''}${p.t}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 6. Takvim Sahibi / Kasa & Bildirim Satırı -->
      <div class="gm-r align-top" onclick="gcalExpandKasaRow()">
        <div class="gm-ic">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="gm-rbody">
          <div style="display:flex;align-items:center;gap:8px">
            <span id="gmOwnerName" style="font-weight:500">Cavit ÖZGEN${kasaVal?' · '+gcalKasaTitle(kasaVal):''}</span>
            <span class="gm-dot" id="gmColorDot" style="background:${curKindObj.color}" onclick="event.stopPropagation();gcalCycleModalKind()" title="Renk / Kategori değiştir"></span>
          </div>
          <div class="gm-sub" id="gmNotifySub">Uygun · Varsayılan görünürlük · ${notifyVal}</div>
          <div id="gmKasaExpand" style="display:none;flex-wrap:wrap;gap:6px;margin-top:6px" onclick="event.stopPropagation()">
            <select class="gmodal-in" id="gmKasa" style="flex:1;min-width:150px;font-size:12px" onchange="$('#gmOwnerName').textContent='Cavit ÖZGEN'+(this.value?' · '+gcalKasaTitle(this.value):'')">
              ${renderKasaGroupOptions(kasaVal,'Genel Akademik Takvim')}
            </select>
            <select class="gmodal-in" id="gmNotify" style="flex:1;min-width:150px;font-size:12px" onchange="$('#gmNotifySub').textContent='Uygun · Varsayılan görünürlük · '+this.value">
              <option value="Bir gün önce şu saatte: 5pm bildir" ${notifyVal.includes('5pm')?'selected':''}>Bir gün önce: 5pm bildir</option>
              <option value="30 dakika önce bildir" ${notifyVal.includes('30')?'selected':''}>30 dakika önce bildir</option>
              <option value="1 saat önce bildir" ${notifyVal.includes('1 saat')?'selected':''}>1 saat önce bildir</option>
              <option value="Sınav sabahı 08:00 bildir" ${notifyVal.includes('08:00')?'selected':''}>Sınav sabahı 08:00 bildir</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Alt Çubuk: Diğer seçenekler & Mavi Kaydet Butonu -->
    <div class="gm-foot">
      ${isEdit && ev.kasa?`<button type="button" class="gm-more-btn" onclick="closeCalModal();enterKasa('${ev.kasa}','write')">❖ Ders Kasası</button>`:'<span></span>'}
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
        <button type="button" class="gm-more-btn" onclick="gcalShowAllModalOptions()">Diğer seçenekler</button>
        <button type="button" class="gm-save-btn" onclick="saveCalFromModal()">Kaydet</button>
      </div>
    </div>`;
  bg.classList.add('show');
  setTimeout(()=>$('#gmTitle')?.focus(),40);
}

function gcalSetModalKind(kid){
  $$('.gm-kbtn').forEach(b=>b.classList.toggle('on',b.dataset.k===kid));
  const dot=$('#gmColorDot');
  if(dot && GCAL_KINDS[kid]) dot.style.background=GCAL_KINDS[kid].color;
}
function gcalCycleModalKind(){
  const order=['exam','task','lab','study'];
  const cur=$('.gm-kbtn.on')?.dataset.k||'exam';
  const next=order[(order.indexOf(cur)+1)%order.length];
  gcalSetModalKind(next);
}
function gcalSyncTimeSub(){
  const sub=$('#gmRepeatSub'), rep=$('#gmRepeat')?.value||'Yinelenmez';
  if(!sub) return;
  const allDay=!!$('#gmAllDay')?.checked;
  if(allDay){
    sub.textContent=`Tüm gün · ${rep}`;
  }else{
    const s=$('#gmStart')?.value||'10:00', e=$('#gmEnd')?.value||'11:00';
    sub.textContent=`${rep} · ${s} – ${e}`;
  }
}
function gcalToggleAllDay(checked){
  const ex=$('#gmTimeExpand'), ti=$('#gmTimeInputs'), btn=$('#gmAddTimeBtn');
  if(ti) ti.style.display=checked?'none':'inline-flex';
  if(btn) btn.style.display=checked?'inline-block':'none';
  if(!checked && ex) ex.style.display='flex';
  gcalSyncTimeSub();
  if(!checked) $('#gmStart')?.focus();
}
function gcalExpandTimeRow(focusTime=false){
  const ex=$('#gmTimeExpand'), btn=$('#gmAddTimeBtn'), cb=$('#gmAllDay'), ti=$('#gmTimeInputs');
  if(ex) ex.style.display='flex';
  if(focusTime){
    if(cb) cb.checked=false;
    if(ti) ti.style.display='inline-flex';
    if(btn) btn.style.display='none';
    gcalSyncTimeSub();
    $('#gmStart')?.focus();
  }
}
function gcalExpandDescRow(){
  const s=$('#gmDescShort'), w=$('#gmDescWrap');
  if(s) s.style.display='none';
  if(w){ w.style.display='flex'; $('#gmDesc')?.focus(); }
}
function gcalExpandKasaRow(){
  const ex=$('#gmKasaExpand');
  if(ex) ex.style.display=ex.style.display==='none'?'flex':'none';
}
function gcalToggleMeetRow(){
  const inp=$('#gmMeet'), txt=$('#gmMeetTxt');
  if(!inp||!txt) return;
  if(inp.value){
    inp.value='';
    txt.textContent='Google Meet video konferans görüşmesi ekle';
    txt.style.color='var(--mut)';
    txt.style.fontWeight='400';
  }else{
    const code='agy-'+Math.random().toString(36).slice(2,5)+'-'+Math.random().toString(36).slice(2,6);
    inp.value=`meet.google.com/${code}`;
    txt.textContent=`🎥 ${inp.value} (Canlı Çalışma Odası Eklendi)`;
    txt.style.color='var(--gblue)';
    txt.style.fontWeight='500';
  }
}
function gcalShowAllModalOptions(){
  gcalExpandTimeRow();
  gcalExpandDescRow();
  const ex=$('#gmKasaExpand');
  if(ex) ex.style.display='flex';
}
function gcalStartModalDrag(ev){
  if(ev.target.closest('button')) return;
  const box=$('#gcalModal'); if(!box) return;
  const rect=box.getBoundingClientRect();
  const startX=ev.clientX, startY=ev.clientY;
  const curTx=parseFloat(box.dataset.tx||'0'), curTy=parseFloat(box.dataset.ty||'0');
  const onMove=e=>{
    const nx=curTx+(e.clientX-startX), ny=curTy+(e.clientY-startY);
    box.dataset.tx=nx; box.dataset.ty=ny;
    box.style.transform=`translate(${nx}px, ${ny}px)`;
  };
  const onUp=()=>{
    window.removeEventListener('mousemove',onMove);
    window.removeEventListener('mouseup',onUp);
  };
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
}

function closeCalModal(){
  const box=$('#gcalModal');
  if(box){ box.style.transform=''; box.dataset.tx='0'; box.dataset.ty='0'; }
  $('#gcalModalBg')?.classList.remove('show');
  GCAL.editingId=null;
}

async function saveCalFromModal(){
  const title=($('#gmTitle')?.value||'').trim()||'(Başlıksız etkinlik)';
  const kindBtn=$('.gm-kbtn.on');
  const kind=kindBtn?kindBtn.dataset.k:'exam';
  const date=$('#gmDate')?.value||GCAL.cursor||gcalTodayISO();
  const allDay=!!$('#gmAllDay')?.checked;
  const start=allDay?'':($('#gmStart')?.value||'10:00');
  const end=allDay?'':($('#gmEnd')?.value||'11:00');
  const kasa=$('#gmKasa')?.value||'';
  const loc=($('#gmLoc')?.value||'').trim();
  const desc=(($('#gmDesc')?.value||$('#gmDescShort')?.value)||'').trim();
  const guests=($('#gmGuests')?.value||'').trim();
  const meet=($('#gmMeet')?.value||'').trim();
  const repeat=$('#gmRepeat')?.value||'Yinelenmez';
  const notify=$('#gmNotify')?.value||'Bir gün önce şu saatte: 5pm bildir';
  const day=gcalFromISO(date).getDate();

  let item=GCAL.editingId?calEvents.find(x=>x.id===GCAL.editingId):null;
  if(item){
    Object.assign(item,{title,kind,date,day,start,end,allDay,kasa,loc,desc,guests,meet,repeat,notify});
    await persistCalEventUpdate(item);
    toast(`✓ "${title}" güncellendi`);
  }else{
    const newEv={id:Date.now(),day,date,title,kind,kasa,start,end,allDay,loc,desc,guests,meet,repeat,notify,done:false};
    try{
      const saved=await api('/api/calendar',{day,title,kind,kasa:packCalMeta(newEv)});
      if(saved&&saved.id) newEv.id=saved.id;
    }catch(e){}
    calEvents.push(newEv);
    GCAL.cursor=date;
    renderCal($('#main'),false);
    toast(`▦ Takvime eklendi: ${title}`);
  }
  closeCalModal();
}

async function deleteCalFromModal(id){
  const ev=calEvents.find(x=>x.id===id);
  if(!ev) return;
  try{ await api('/api/calendar/'+id,null,'DELETE'); }catch(e){}
  calEvents=calEvents.filter(x=>x.id!==id);
  closeCalModal();
  renderCal($('#main'),false);
  toast(`🗑 "${ev.title}" silindi`);
}

async function gcalToggleDone(id){
  const ev=calEvents.find(x=>x.id===id);
  if(!ev) return;
  ev.done=!ev.done;
  await persistCalEventUpdate(ev);
  toast(ev.done?`✓ "${ev.title}" tamamlandı!`:`↺ "${ev.title}" tekrar aktif edildi`);
}

/* --- Pomodoro, Doğal Dil Motoru (.ics) & AI Entegrasyonu --- */
function gcalDetectConflicts(){
  const out=[];
  const byDate={};
  calEvents.filter(e=>!e.done && !e.allDay).forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
  Object.entries(byDate).forEach(([dt,list])=>{
    if(list.length<2) return;
    const sorted=[...list].sort((a,b)=>(a.start||'09:00').localeCompare(b.start||'09:00'));
    for(let i=0;i<sorted.length-1;i++){
      const a=sorted[i], b=sorted[i+1];
      if((a.end||'10:00')>(b.start||'09:00')){
        out.push({date:dt,label:`${dt}: "${a.title}" (${a.start}-${a.end}) ile "${b.title}" (${b.start}-${b.end}) çakışıyor`});
      }
    }
  });
  return out;
}

function gcalParseNaturalLanguage(raw){
  let txt=String(raw||'').trim();
  if(!txt) return null;
  let date=GCAL.cursor||gcalTodayISO();
  let start='', end='', allDay=true, kind='task', loc='', kasa='';
  const now=gcalFromISO(gcalTodayISO());

  // 1) Konum (@D-204 veya @Amfi-2)
  const locM=txt.match(/@([^\s#]+)/);
  if(locM){ loc=locM[1].replace(/_/g,' '); txt=txt.replace(locM[0],'').trim(); }

  // 2) Etiket (#sınav, #lab, #görev, #çalışma)
  const tagM=txt.match(/#(sınav|sinav|vize|quiz|lab|deney|görev|gorev|ödev|odev|çalışma|calisma)/i);
  if(tagM){
    const tg=tagM[1].toLowerCase();
    if(/sınav|sinav|vize|quiz/.test(tg)) kind='exam';
    else if(/lab|deney/.test(tg)) kind='lab';
    else if(/çalışma|calisma/.test(tg)) kind='study';
    else kind='task';
    txt=txt.replace(tagM[0],'').trim();
  }

  // 3) Saat aralığı (14:00-16:00, 14:00) veya doğal Türkçe saat ("akşam saat 5 de", "saat 17", "sabah 9'da")
  const timeM=txt.match(/(?<![\p{L}\p{N}])([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?(?:\s*['’]?(?:da|de|ta|te|a|e))?(?![\p{L}\p{N}])/iu);
  if(timeM){
    allDay=false;
    const h1=Number(timeM[1]), m1=timeM[2];
    start=`${gcalPad(h1)}:${m1}`;
    if(timeM[3]!==undefined){
      end=`${gcalPad(Number(timeM[3]))}:${timeM[4]}`;
    }else{
      end=`${gcalPad(Math.min(23,h1+1))}:${m1}`;
    }
    txt=txt.replace(timeM[0],'').trim();
  }else{
    const natM=txt.match(/(?<![\p{L}\p{N}])(?:(sabah|öğle|öğlen|öğleden\s+sonra|akşam|gece)\s+)?(?:saat\s+)?([01]?\d|2[0-3])(?:\s+(buçuk|çeyrek))?(?:\s*['’]?(?:da|de|ta|te|a|e)|\s+(?:da|de|ta|te))(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(sabah|öğle|öğlen|öğleden\s+sonra|akşam|gece)\s+(?:saat\s+)?([01]?\d|2[0-3])(?:\s+(buçuk|çeyrek))?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])saat\s+([01]?\d|2[0-3])(?:\s+(buçuk|çeyrek))?(?![\p{L}\p{N}])/iu);
    if(natM){
      const hasExplicitPeriod=Boolean(natM[1]||natM[4]||natM[7]);
      const hasSaat= /\bsaat\b/i.test(natM[0]);
      const hasSuffix= /(?:'|’|\s)(?:da|de|ta|te|a|e)$/i.test(natM[0]);
      if(hasExplicitPeriod||hasSaat||hasSuffix){
        allDay=false;
        const period=(natM[1]||natM[4]||'').toLowerCase();
        let h=Number(natM[2]||natM[5]||natM[7]);
        const frac=(natM[3]||natM[6]||'').toLowerCase();
        const mStr=frac==='buçuk'?'30':frac==='çeyrek'?'15':'00';
        if(/akşam|öğleden\s+sonra/.test(period)&&h>=1&&h<=11) h+=12;
        else if(/gece/.test(period)&&h===12) h=0;
        else if(/gece/.test(period)&&h>=8&&h<=11) h+=12;
        start=`${gcalPad(h)}:${mStr}`;
        end=`${gcalPad(Math.min(23,h+1))}:${mStr}`;
        txt=txt.replace(natM[0],'').trim();
      }
    }
  }

  // 4) Tarih ("bugün", "yarın", haftanın günleri [yazım hatası toleranslı], veya "19 Kasım")
  const monthNames=['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
  const dmMatch=txt.match(new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2})\\s+(${monthNames.join('|')})(?![\\p{L}\\p{N}])`,'iu'));
  if(dmMatch){
    const dNum=Number(dmMatch[1]);
    const mIdx=monthNames.indexOf(dmMatch[2].toLowerCase());
    if(mIdx!==-1) date=`${now.getFullYear()}-${gcalPad(mIdx+1)}-${gcalPad(dNum)}`;
    txt=txt.replace(dmMatch[0],'').trim();
  }else if(/(?<![\p{L}\p{N}])bugün(?![\p{L}\p{N}])/iu.test(txt)){
    date=gcalTodayISO();
    txt=txt.replace(/(?<![\p{L}\p{N}])bugün(?![\p{L}\p{N}])/iu,'').trim();
  }else if(/(?<![\p{L}\p{N}])yarın(?![\p{L}\p{N}])/iu.test(txt)){
    const d=new Date(now); d.setDate(d.getDate()+1); date=gcalToISO(d);
    txt=txt.replace(/(?<![\p{L}\p{N}])yarın(?![\p{L}\p{N}])/iu,'').trim();
  }else{
    const trFold=s=>s.toLocaleLowerCase('tr-TR').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/(.)\1+/g,'$1');
    const lev=(a,b)=>{
      const m=a.length, n=b.length, dp=Array.from({length:m+1},(_,i)=>Array(n+1).fill(0));
      for(let i=0;i<=m;i++) dp[i][0]=i;
      for(let j=0;j<=n;j++) dp[0][j]=j;
      for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
        dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
      return dp[m][n];
    };
    const dayTargets=[
      ['pazartesi',0,2],['pzt',0,0],
      ['sali',1,0],['sal',1,0],
      ['carsamba',2,2],['car',2,0],
      ['persembe',3,2],['per',3,0],
      ['cuma',4,0],['cum',4,0],
      ['cumartesi',5,2],['cmt',5,0],
      ['pazar',6,1],['paz',6,0]
    ];
    const words=txt.match(/[\p{L}]+(?:\s+günü)?/gu)||[];
    for(const wRaw of words){
      const base=wRaw.replace(/\s+günü$/iu,'');
      const wf=trFold(base);
      let matchedIdx=null;
      for(const [tgt,idx,maxDist] of dayTargets){
        if(wf===tgt||(maxDist>0&&Math.abs(wf.length-tgt.length)<=maxDist&&lev(wf,tgt)<=maxDist)){
          matchedIdx=idx; break;
        }
      }
      if(matchedIdx!==null){
        const curMonIdx=gcalDowMon(now);
        let delta=(matchedIdx-curMonIdx+7)%7;
        if(delta===0) delta=7;
        const d=new Date(now); d.setDate(d.getDate()+delta);
        date=gcalToISO(d);
        const esc=wRaw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        txt=txt.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`,'iu'),'').trim();
        break;
      }
    }
  }

  // 5) Otomatik Kategori & Ders Kasası Çıkarımı
  const fullLow=(txt+' '+raw).toLowerCase();
  if(!tagM){
    if(/vize|final|quiz|sınav|sözlü/.test(fullLow)) kind='exam';
    else if(/lab|deney|föy/.test(fullLow)) kind='lab';
    else if(/tekrar|pomodoro|çalışma/.test(fullLow)) kind='study';
  }
  if(/makina|trafo|senkron|asenkron/.test(fullLow)) kasa='elektrik-makinalari';
  else if(/kontrol|pid|bode|nyquist|kök/.test(fullLow)) kasa='kontrol-sistemleri';
  else if(/yüksek gerilim|yg|manevra|izolatör|delinme/.test(fullLow)) kasa='yuksek-gerilim';
  else if(/iha|tasarım|seçmeli|otonom/.test(fullLow)) kasa='secmeli-tasarim';
  else if(/güç|bara|yük akışı/.test(fullLow)) kasa='guc-sistemleri';

  const title=txt.replace(/\s+/g,' ').trim()||'(Başlıksız etkinlik)';
  return {title,date,start,end,allDay,kind,loc,kasa};
}

function gcalSmartPreview(val){
  const box=$('#gcalSmartPrev');
  if(!box) return;
  const p=gcalParseNaturalLanguage(val);
  if(!p){
    box.innerHTML=`<span style="color:var(--mut)">Örnek: <u style="cursor:pointer;color:var(--cu)" onclick="const el=$('#gcalSmartInput');el.value='Bugün sunumu bitir #görev';gcalSmartPreview(el.value);el.focus()">Bugün sunumu bitir #görev</u> · <u style="cursor:pointer;color:var(--cu)" onclick="const el=$('#gcalSmartInput');el.value='Cuma 14:00–16:00 Trafo Boşta Çalışma Deneyi #lab @D-102';gcalSmartPreview(el.value);el.focus()">Cuma 14:00 Trafo Deneyi #lab @D-102</u></span>`;
    return;
  }
  const kObj=GCAL_KINDS[p.kind]||GCAL_KINDS.task;
  const kInk=gcalInk(kObj);
  box.innerHTML=`
    <span class="gcal-smart-chip" style="border-color:${kInk}66;color:${kInk}">${kObj.icon} ${kObj.label}</span>
    <span class="gcal-smart-chip">📅 ${p.date}</span>
    ${p.allDay?`<span class="gcal-smart-chip">☀️ Tüm Gün</span>`:`<span class="gcal-smart-chip">🕒 ${p.start}–${p.end}</span>`}
    ${p.loc?`<span class="gcal-smart-chip">📍 ${p.loc}</span>`:''}
    ${p.kasa?`<span class="gcal-smart-chip" style="color:var(--cu)">📘 ${gcalKasaTitle(p.kasa)}</span>`:''}
  `;
}

async function gcalSmartSubmit(){
  const inp=$('#gcalSmartInput');
  if(!inp||!inp.value.trim()) return;
  const p=gcalParseNaturalLanguage(inp.value);
  if(!p) return;
  const day=gcalFromISO(p.date).getDate();
  const newEv={id:Date.now(),day,date:p.date,title:p.title,kind:p.kind,kasa:p.kasa,start:p.start,end:p.end,allDay:!!p.allDay,loc:p.loc,desc:'',guests:'',meet:'',repeat:'Yinelenmez',notify:'Bir gün önce şu saatte: 5pm bildir',done:false};
  try{
    const saved=await api('/api/calendar',{day,title:p.title,kind:p.kind,kasa:packCalMeta(newEv)});
    if(saved&&saved.id) newEv.id=saved.id;
  }catch(e){}
  calEvents.push(newEv);
  GCAL.cursor=p.date;
  inp.value='';
  renderCal($('#main'),false);
  toast(`⚡ AgyCal Sihirli Ekle: "${p.title}" (${p.date}${p.allDay?' · Tüm Gün':' '+p.start})`);
}

function gcalExportICS(){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AgyDesk//AgyCal PRO//TR','CALSCALE:GREGORIAN','X-WR-CALNAME:AgyCal Akademik Takvim'];
  const fmtDt=(iso,hm)=>iso.replace(/-/g,'')+'T'+(hm||'09:00').replace(':','')+'00';
  calEvents.forEach(ev=>{
    const dtCompact=(ev.date||'').replace(/-/g,'');
    lines.push(
      'BEGIN:VEVENT',
      `UID:agycal-${ev.id}@agydesk.local`,
      `DTSTAMP:${fmtDt(gcalTodayISO(),'09:00')}`,
      ev.allDay?`DTSTART;VALUE=DATE:${dtCompact}`:`DTSTART:${fmtDt(ev.date,ev.start||'09:00')}`,
      ev.allDay?`DTEND;VALUE=DATE:${dtCompact}`:`DTEND:${fmtDt(ev.date,ev.end||'10:00')}`,
      `SUMMARY:${(ev.title||'').replace(/[,;\\]/g,' ')}`,
      ev.loc?`LOCATION:${ev.loc.replace(/[,;\\]/g,' ')}`:'',
      ev.desc?`DESCRIPTION:${ev.desc.replace(/\n/g,'\\n')}`:'',
      'BEGIN:VALARM','TRIGGER:-PT60M','ACTION:DISPLAY','DESCRIPTION:AgyCal Hatırlatıcı','END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  const blob=new Blob([lines.filter(Boolean).join('\r\n')],{type:'text/calendar;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`AgyCal-${gcalTodayISO()}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('📲 AgyCal .ics takvim dosyası indirildi (Google/Apple Takvim ile uyumlu)');
}

const GCAL_POMO_KEY='agydesk_pomo_state';
let _pomoAudioCtx=null;
function gcalWarmPomoAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return null;
    if(!_pomoAudioCtx) _pomoAudioCtx=new AC();
    if(_pomoAudioCtx.state==='suspended') _pomoAudioCtx.resume().catch(()=>{});
    return _pomoAudioCtx;
  }catch(e){ return null; }
}
function gcalPlayPomoBell(){
  const ctx=gcalWarmPomoAudio();
  if(!ctx) return;
  const play=()=>{
    try{
      const notes=[523.25,659.25,783.99,1046.5];
      [0,1.05,2.1].forEach(round=>{
        notes.forEach((freq,idx)=>{
          const t0=ctx.currentTime+round+idx*0.14;
          const osc=ctx.createOscillator();
          const osc2=ctx.createOscillator();
          const gain=ctx.createGain();
          osc.type='triangle';
          osc.frequency.setValueAtTime(freq,t0);
          osc2.type='sine';
          osc2.frequency.setValueAtTime(freq*2,t0);
          const g2=ctx.createGain();
          g2.gain.setValueAtTime(0.18,t0);
          gain.gain.setValueAtTime(0.0001,t0);
          gain.gain.exponentialRampToValueAtTime(0.32,t0+0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001,t0+0.58);
          osc.connect(gain);
          osc2.connect(g2);
          g2.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc2.start(t0);
          osc.stop(t0+0.6);
          osc2.stop(t0+0.6);
        });
      });
    }catch(e){}
  };
  if(ctx.state==='suspended') ctx.resume().then(play).catch(()=>{});
  else play();
}
function gcalShowPomoBanner(taskTitle,mode){
  document.querySelectorAll('.pomo-done-banner').forEach(el=>el.remove());
  const isBreak=/mola/i.test(mode||'');
  const nextMins=isBreak?25:5;
  const nextMode=isBreak?'25 dk Odak':'5 dk Mola';
  const b=document.createElement('div');
  b.className='pomo-done-banner';
  b.innerHTML=`<div class="pomo-done-ic">⏱</div>
    <div class="pomo-done-body">
      <div class="pomo-done-title">Pomodoro Süresi Bitti!</div>
      <div class="pomo-done-sub"></div>
    </div>
    <div class="pomo-done-act">
      <button class="pomo-done-btn" type="button">${nextMode}</button>
      <button class="pomo-done-close" type="button" title="Kapat">✕</button>
    </div>`;
  b.querySelector('.pomo-done-sub').textContent=`${mode||'Odak'} · ${taskTitle||'Odak Oturumu'}`;
  const close=()=>b.remove();
  b.querySelector('.pomo-done-close').onclick=close;
  b.querySelector('.pomo-done-btn').onclick=()=>{
    close();
    gcalPomoReset(nextMins,nextMode);
    gcalPomoToggle();
  };
  document.body.appendChild(b);
  setTimeout(()=>{ if(b.isConnected) b.remove(); },18000);
}
function gcalNotifyPomoDone(taskTitle,mode){
  gcalPlayPomoBell();
  gcalShowPomoBanner(taskTitle,mode);
  try{
    if('Notification' in window&&Notification.permission==='granted'){
      const n=new Notification('⏱ Pomodoro Süresi Bitti!',{
        body:`${mode} · ${taskTitle}`,
        tag:'agydesk-pomo-done',
        renotify:true
      });
      n.onclick=()=>{ window.focus(); n.close(); };
      setTimeout(()=>n.close(),18000);
    }
  }catch(e){}
  const origTitle=document.title;
  let ticks=0;
  let flash=null;
  const stopFlash=()=>{
    if(flash){ clearInterval(flash); flash=null; }
    document.title=origTitle;
    window.removeEventListener('focus',stopFlash);
  };
  window.addEventListener('focus',stopFlash,{once:true});
  flash=setInterval(()=>{
    document.title=ticks%2===0?'🔔 Süre Bitti! · AgyDesk':'⏱ Mola Zamanı · AgyDesk';
    if(++ticks>=14) stopFlash();
  },850);
}
function gcalGetDetectedKasa(){
  try{
    if(!Array.isArray(kasalarData)||!kasalarData.length) return null;
    if(typeof currentKasa!=='undefined'&&currentKasa&&currentKasa!=='all'){
      const k=kasalarData.find(x=>x.key===currentKasa);
      if(k) return k;
    }
    if(typeof active!=='undefined'&&typeof pages!=='undefined'&&pages[active]&&pages[active].kasa){
      const k=kasalarData.find(x=>x.key===pages[active].kasa);
      if(k) return k;
    }
    if(typeof openTabs!=='undefined'&&Array.isArray(openTabs)&&typeof pages!=='undefined'){
      for(let i=openTabs.length-1;i>=0;i--){
        const tid=openTabs[i];
        if(String(tid).startsWith('note:')&&pages[tid]&&pages[tid].kasa){
          const k=kasalarData.find(x=>x.key===pages[tid].kasa);
          if(k) return k;
        }
      }
    }
  }catch(e){}
  return null;
}
function gcalGetActiveKasaTitle(){
  const p=GCAL.pomo;
  const det=gcalGetDetectedKasa();
  const isBreak=/mola/i.test(p.mode||'');
  if(det&&det.title){
    if(isBreak) return `${det.title} · Kısa Mola`;
    return /çalışma(sı)?$/i.test(det.title.trim())?det.title:`${det.title} Çalışması`;
  }
  if(isBreak) return 'Kısa Mola · Zihnini Dinlendir';
  if(/90/.test(p.mode||'')) return 'Tam Akış · Derin Blok';
  if(/50/.test(p.mode||'')) return 'Derin Odak Seansı';
  return 'Odaklanma Zamanı';
}
function gcalGetPomoLabel(){
  const p=GCAL.pomo;
  if(p.customTitle&&p.taskTitle) return p.taskTitle;
  return gcalGetActiveKasaTitle();
}
function gcalClearPomoCustom(){
  GCAL.pomo.customTitle=false;
  GCAL.pomo.taskTitle='';
  gcalSavePomo();
  if($('#main .gcal')) renderCal($('#main'),false);
  if($('#ppop')?.classList.contains('show')){ renderPomoPop(); syncOpenRailPops(); }
}
function gcalSavePomo(){
  try{
    const p=GCAL.pomo;
    localStorage.setItem(GCAL_POMO_KEY,JSON.stringify({
      sec:p.sec,
      total:p.total,
      running:p.running,
      endAt:p.endAt||null,
      mode:p.mode,
      taskTitle:p.taskTitle,
      customTitle:!!p.customTitle
    }));
  }catch(e){}
}
function gcalStartPomoInterval(){
  const p=GCAL.pomo;
  if(p.timer) clearInterval(p.timer);
  p.timer=setInterval(()=>{
    const rem=p.endAt?Math.max(0,Math.ceil((p.endAt-Date.now())/1000)):Math.max(0,p.sec-1);
    p.sec=rem;
    gcalUpdatePomoDom();
    if(rem<=0){
      clearInterval(p.timer); p.timer=null; p.running=false; p.endAt=null;
      gcalSavePomo();
      gcalNotifyPomoDone(gcalGetPomoLabel(),p.mode);
      renderTabs();
      if($('#main .gcal')) renderCal($('#main'),false);
    }
  },1000);
}
function initGcalPomo(){
  try{
    const raw=localStorage.getItem(GCAL_POMO_KEY);
    if(!raw) return;
    const st=JSON.parse(raw);
    if(!st||typeof st!=='object') return;
    const p=GCAL.pomo;
    if(Number.isFinite(st.total)&&st.total>0) p.total=st.total;
    if(typeof st.mode==='string'&&st.mode) p.mode=st.mode;
    if(st.customTitle===true&&typeof st.taskTitle==='string'&&st.taskTitle){
      p.taskTitle=st.taskTitle;
      p.customTitle=true;
    }else{
      p.taskTitle='';
      p.customTitle=false;
    }
    if(st.running&&Number.isFinite(st.endAt)){
      const rem=Math.max(0,Math.ceil((st.endAt-Date.now())/1000));
      if(rem>0){
        p.sec=rem;
        p.running=true;
        p.endAt=st.endAt;
        gcalStartPomoInterval();
      }else{
        p.sec=0;
        p.running=false;
        p.endAt=null;
        gcalSavePomo();
        setTimeout(()=>gcalNotifyPomoDone(gcalGetPomoLabel(),p.mode),400);
      }
    }else if(Number.isFinite(st.sec)&&st.sec>=0){
      p.sec=st.sec;
      p.running=false;
      p.endAt=null;
    }
  }catch(e){}
  gcalUpdatePomoDom();
}
const GCAL_POMO_PREFS_KEY='agydesk_pomo_prefs';
function getPomoPrefs(){
  try{
    const raw=localStorage.getItem(GCAL_POMO_PREFS_KEY);
    const o=raw?JSON.parse(raw):{};
    return {rail:o.rail!==false,title:o.title!==false};
  }catch(e){ return {rail:true,title:true}; }
}
function togglePomoPref(key){
  const prefs=getPomoPrefs();
  prefs[key]=!prefs[key];
  try{ localStorage.setItem(GCAL_POMO_PREFS_KEY,JSON.stringify(prefs)); }catch(e){}
  gcalUpdatePomoDom();
  if($('#main .gcal')) renderCal($('#main'),false);
}
function gcalUpdatePomoDom(){
  const p=GCAL.pomo;
  const prefs=getPomoPrefs();
  const mm=gcalPad(Math.floor(p.sec/60)), ss=gcalPad(p.sec%60);
  const pct=Math.round((p.sec/Math.max(1,p.total))*100);
  const topEl=$('#gcalTopPomo'); if(topEl) topEl.textContent=`${mm}:${ss}`;
  const tabEl=$('#acalTabPomo'); if(tabEl) tabEl.textContent=`⏱ ${mm}:${ss}`;
  const tEl=$('#gpomoTime'); if(tEl) tEl.textContent=`${mm}:${ss}`;
  const rEl=$('#gpomoRing'); if(rEl) rEl.style.setProperty('--pp',pct);
  const railEl=$('#railPomo');
  if(railEl){
    const showRail=prefs.rail&&(p.running||p.sec<p.total);
    railEl.style.display=showRail?'flex':'none';
    railEl.style.setProperty('--p',pct);
    railEl.classList.toggle('paused',!p.running);
    const rMin=$('#railPomoMin'); if(rMin) rMin.textContent=p.sec>=60?Math.ceil(p.sec/60)+'m':p.sec+'s';
    const rTime=$('#railPomoTime'); if(rTime) rTime.textContent=`${mm}:${ss}`;
  }
  const ppop=$('#ppop');
  if(ppop?.classList.contains('show')){
    const pt=$('#ppopTime'); if(pt) pt.textContent=`${mm}:${ss}`;
    const pr=$('#ppopRing'); if(pr) pr.style.setProperty('--pp',pct);
    const pm=$('#ppopMode'); if(pm) pm.textContent=p.mode||'Odak';
    const ps=$('#ppopStatus'); if(ps) ps.textContent=p.running?'Odak aktif':(p.sec<p.total?'Duraklatıldı':'Hazır');
    const pb=$('#ppopToggleBtn');
    if(pb){
      pb.textContent=p.running?'⏸ Duraklat':'▶ Başlat';
      pb.classList.toggle('on',!!p.running);
    }
  }
  syncOpenRailPops();
  const topPomo=$('#topPomo');
  const showTop=Boolean(prefs.title&&(p.running||(p.sec>0&&p.sec<p.total)));
  if(topPomo){
    topPomo.style.display=showTop?'inline-flex':'none';
    if(showTop){
      topPomo.classList.toggle('paused',!p.running);
      topPomo.innerHTML=`<span class="tp-dot"></span><span>${mm}:${ss}</span>`;
      topPomo.title=`${p.mode||'Odak'} · ${p.running?'Çalışıyor':'Duraklatıldı'} · Tıkla: Mini kontrol · Sağ tık: Duraklat/Başlat`;
    }
  }
  if(prefs.title&&p.running&&p.sec>0){
    const nextWinTitle=`⏱ ${mm}:${ss} — AgyDesk`;
    if(document.title!==nextWinTitle){
      document.title=nextWinTitle;
      try{ if(window.ipc&&typeof window.ipc.postMessage==='function') window.ipc.postMessage('title:'+nextWinTitle); }catch(e){}
    }
  }else if(p.sec>0||!prefs.title){
    syncWindowTitle();
  }
}
function gcalPomoToggle(){
  const p=GCAL.pomo;
  if(p.running){
    if(p.endAt) p.sec=Math.max(0,Math.ceil((p.endAt-Date.now())/1000));
    clearInterval(p.timer); p.timer=null; p.running=false; p.endAt=null;
  }else{
    gcalWarmPomoAudio();
    if('Notification' in window&&Notification.permission==='default'){
      Notification.requestPermission().catch(()=>{});
    }
    if(p.sec<=0) p.sec=p.total;
    p.running=true;
    p.endAt=Date.now()+p.sec*1000;
    gcalStartPomoInterval();
  }
  gcalSavePomo();
  gcalUpdatePomoDom();
  renderTabs();
  if($('#main .gcal')) renderCal($('#main'),false);
}
function gcalPomoReset(mins,modeName){
  const p=GCAL.pomo;
  if(p.timer) clearInterval(p.timer);
  const totalSec=Math.max(1,Math.round(mins*60));
  p.running=false; p.timer=null; p.endAt=null;
  p.total=totalSec; p.sec=totalSec; p.mode=modeName;
  gcalSavePomo();
  gcalUpdatePomoDom();
  renderTabs();
  if($('#main .gcal')) renderCal($('#main'),false);
  if($('#ppop')?.classList.contains('show')){ renderPomoPop(); syncOpenRailPops(); }
}
function gcalPomoRestartCurrent(){
  const p=GCAL.pomo;
  const mins=Math.max(1,Math.round(p.total/60));
  gcalPomoReset(mins,p.mode||`${mins} dk Odak`);
}
function gcalPomoDialDown(e,ringEl=null){
  const ring=ringEl||$('#gpomoRing');
  if(!ring) return;
  e.preventDefault();
  ring.classList.add('dragging');
  const p=GCAL.pomo;
  const maxMins=Math.max(1,Math.round(p.total/60));
  let lastDeg=(p.sec/Math.max(1,p.total))*360;
  const applyPointer=ev=>{
    const r=ring.getBoundingClientRect();
    const dx=ev.clientX-(r.left+r.width/2);
    const dy=ev.clientY-(r.top+r.height/2);
    let deg=Math.atan2(dx,-dy)*(180/Math.PI);
    if(deg<0) deg+=360;
    if(lastDeg>270&&deg<90) deg=360;
    else if(lastDeg<90&&deg>270) deg=0;
    lastDeg=deg;
    const mins=Math.max(1,Math.min(maxMins,Math.round((deg/360)*maxMins)));
    p.sec=mins*60;
    if(p.running) p.endAt=Date.now()+p.sec*1000;
    p.mode=`${mins} dk Odak`;
    const mEl=$('#gpomoMode'); if(mEl) mEl.textContent=`⏱ POMODORO ÇALIŞMA SAYACI · ${p.mode}`;
    gcalUpdatePomoDom();
  };
  applyPointer(e);
  const onMove=ev=>applyPointer(ev);
  const onUp=()=>{
    ring.classList.remove('dragging');
    window.removeEventListener('pointermove',onMove);
    window.removeEventListener('pointerup',onUp);
    window.removeEventListener('pointercancel',onUp);
    gcalSavePomo();
  };
  window.addEventListener('pointermove',onMove);
  window.addEventListener('pointerup',onUp);
  window.addEventListener('pointercancel',onUp);
}
function gcalStartPomoFor(title){
  GCAL.pomo.taskTitle=title;
  GCAL.pomo.customTitle=true;
  GCAL.view='day';
  gcalPomoReset(25,'25 dk Odak');
  gcalPomoToggle();
  toast(`⏱ "${title}" için 25 dk Pomodoro başlatıldı`);
}

function gcalPrepWithAi(evId){
  const ev=calEvents.find(x=>x.id===evId);
  if(!ev) return;
  if(ev.kasa && ev.kasa!=='all'){
    currentKasa=ev.kasa;
    rebuildTreeAndSources();
  }
  rtab('ai');
  aiSend('side_ai',`Takvimimdeki şu sınav/görev için (${ev.date} ${ev.start}, ${ev.title}${ev.desc?' — Konular: '+ev.desc:''}) adım adım çalışma planı, kritik formüller ve çıkabilecek 3 klasik sınav sorusu hazırla.`);
}

function gcalAskAiForDay(iso){
  const evs=getAllEventsForDate(iso);
  const summary=evs.map(e=>`- ${e.start}–${e.end}: ${e.title} (${gcalKasaTitle(e.kasa)})`).join('\n')||'Boş gün';
  rtab('ai');
  aiSend('side_ai',`${iso} tarihli günlük programım şöyle:\n${summary}\n\nBu günü en verimli şekilde geçirmem için saatlik Pomodoro çalışma blokları ve tekrar stratejisi öner.`);
}

function gcalAskAiStudyPlan(){
  const upcoming=calEvents.filter(e=>!e.done).sort((a,b)=>a.date.localeCompare(b.date)).map(e=>`- ${e.date} (${e.start}): [${(GCAL_KINDS[e.kind]||GCAL_KINDS.task).label}] ${e.title} (${gcalKasaTitle(e.kasa)})`).join('\n');
  rtab('ai');
  aiSend('side_ai',`Akademik takvimimdeki yaklaşan sınav, lab ve teslimlerim:\n${upcoming}\n\nBana bugünden başlayarak vize ve teslimlere eksiksiz yetişmemi sağlayacak, hangi gün hangi dersin hangi konusuna kaç saat çalışmam gerektiğini gösteren akıllı bir haftalık çalışma tablosu çıkar.`);
}

function getThemeCanvasPal(){
  const cs=getComputedStyle(document.body);
  const g=(v,f)=>cs.getPropertyValue(v).trim()||f;
  return {
    line:g('--line','#272c28'),
    mut:g('--mut','#8c958c'),
    cu:g('--cu','#e0a458'),
    ok:g('--ok','#7bc47f'),
    blue:g('--blue','#79c0ff'),
    txt:g('--txt','#e6e9e4')
  };
}

/* ---------- Filtre simülasyonu ---------- */
function renderSim(m){
  m.innerHTML=`<div class="sim"><h1>Düşük Geçiren Filtre</h1>
  <div style="color:var(--mut)">RC filtre · Bode genlik eğrisi, canlı</div>
  <canvas id="cv" width="860" height="320"></canvas>
  <div class="sl"><span>R</span><input type="range" id="rR" min="100" max="10000" value="1000" step="100"><b id="vR"></b></div>
  <div class="sl"><span>C</span><input type="range" id="rC" min="10" max="1000" value="100" step="10"><b id="vC"></b></div>
  <div class="sl"><span>fc</span><b id="vF" style="margin-left:auto;font-size:15px"></b></div></div>`;
  const draw=()=>{
    const pal=getThemeCanvasPal();
    const R=+$('#rR').value,C=+$('#rC').value*1e-9,fc=1/(2*Math.PI*R*C);
    $('#vR').textContent=R>=1000?(R/1000)+' kΩ':R+' Ω'; $('#vC').textContent=$('#rC').value+' nF'; $('#vF').textContent=(fc>=1000?(fc/1000).toFixed(2)+' kHz':fc.toFixed(0)+' Hz');
    const cv=$('#cv'),g=cv.getContext('2d'),W=cv.width,H=cv.height;
    g.clearRect(0,0,W,H);
    g.strokeStyle=pal.line;g.fillStyle=pal.mut;g.font='11px JetBrains Mono, monospace';
    for(let i=0;i<=6;i++){const x=60+i*(W-80)/6;g.beginPath();g.moveTo(x,10);g.lineTo(x,H-30);g.stroke();g.fillText(['10','100','1k','10k','100k','1M','10M'][i],x-10,H-12);}
    for(let db=0;db>=-60;db-=20){const y=10+(-db)/60*(H-40);g.beginPath();g.moveTo(60,y);g.lineTo(W-20,y);g.stroke();g.fillText(db+' dB',8,y+4);}
    g.strokeStyle=pal.cu;g.lineWidth=2.2;g.beginPath();
    for(let x=0;x<=W-80;x++){const f=Math.pow(10,1+x/(W-80)*6),mag=-10*Math.log10(1+Math.pow(f/fc,2));const y=10+Math.min(60,-mag)/60*(H-40);x?g.lineTo(60+x,y):g.moveTo(60+x,y);}
    g.stroke();
    const fx=60+(Math.log10(fc)-1)/6*(W-80);
    if(fx>60&&fx<W-20){g.setLineDash([4,4]);g.strokeStyle=pal.ok;g.beginPath();g.moveTo(fx,10);g.lineTo(fx,H-30);g.stroke();g.setLineDash([]);g.fillStyle=pal.ok;g.fillText('−3 dB',fx+6,24);}
  };
  ['rR','rC'].forEach(i=>$('#'+i).oninput=draw); draw();
}

/* ---------- Trafo Lab Analizörü (Defter Verileri & Canlı Fazör/Eşdeğer Devre) ---------- */
const TRAFO_STATE={
  Rp:5.6, Rs:1.4, Np:552, Ns:213, ocIdx:4, scIdx:2,
  oc:[
    {V:100, I_mA:17.8, P:1.5},
    {V:132, I_mA:21.15, P:2.0},
    {V:150, I_mA:23.0, P:3.0},
    {V:160, I_mA:24.17, P:3.5},
    {V:190, I_mA:28.0, P:4.0}
  ],
  sc:[
    {V:10.45, I:0.418, P:5.0},
    {V:22.33, I:0.794, P:17.0},
    {V:29.45, I:1.02, P:30.0}
  ]
};
function calcOC(r){
  const I=r.I_mA/1000, S=r.V*I;
  const rawCos=S>0?r.P/S:0, cos=Math.min(1,Math.max(0,rawCos));
  const phi=Math.acos(cos)*180/Math.PI, sin=Math.sqrt(Math.max(0,1-cos*cos));
  const Q=S*sin, Ife=I*cos, Im=I*sin;
  const Rfe=Ife>1e-6?r.V/Ife:0, Xm=Im>1e-6?r.V/Im:0;
  return {I,S,rawCos,cos,phi,sin,Q,Ife_mA:Ife*1000,Im_mA:Im*1000,Rfe,Xm};
}
function calcSC(r){
  const S=r.V*r.I, rawCos=S>0?r.P/S:0, over=rawCos>1;
  const cos=Math.min(1,Math.max(0,rawCos));
  const phi=Math.acos(cos)*180/Math.PI, sin=Math.sqrt(Math.max(0,1-cos*cos));
  const Z=r.I>1e-6?r.V/r.I:0, Res=r.I>1e-6?r.P/(r.I*r.I):0;
  const Xes=Z>Res?Math.sqrt(Z*Z-Res*Res):Z*sin;
  return {S,rawCos,over,cos,phi,sin,Z,Res,Xes};
}
function liveTrafoSvg(st,ocC,scC){
  const a=st.Np/st.Ns, a2=a*a, RsP=a2*st.Rs;
  const Xp=scC.Xes/2, XsP=scC.Xes/2;
  const Y1=78, Y2=202;
  return `<svg viewBox="0 0 740 245" font-family="JetBrains Mono,monospace" style="width:100%;height:auto;background:var(--bg);border:1px solid var(--line);border-radius:10px">`+
    `<rect x="232" y="92" width="126" height="98" rx="6" fill="none" stroke="var(--line)" stroke-dasharray="4 3"/>`+
    svLine(42,Y1,90,Y1)+svCurArrow(42,Y1,90,Y1,`I₀=${st.oc[st.ocIdx].I_mA}mA`,SV.grn,0,-12)+
    svResH(90,Y1,60,`Rₚ=${st.Rp.toFixed(1)}Ω`)+svLine(150,Y1,168,Y1)+
    svIndH(168,Y1,60,`jXₚ≈j${Xp.toFixed(2)}Ω`)+svLine(228,Y1,376,Y1)+
    svDot(260,Y1)+svLine(260,Y1,260,110)+svCurArrow(260,84,260,110,`${ocC.Ife_mA.toFixed(1)}mA`,SV.ln,-22,2)+
    svResV(260,110,62,`R_fe=${Math.round(ocC.Rfe)}Ω`,-12)+svLine(260,172,260,Y2)+svDot(260,Y2)+
    svDot(326,Y1)+svLine(326,Y1,326,110)+svCurArrow(326,84,326,110,`${ocC.Im_mA.toFixed(1)}mA`,SV.acc,22,2)+
    svIndV(326,110,62,`jX_m=j${Math.round(ocC.Xm)}Ω`,12)+svLine(326,172,326,Y2)+svDot(326,Y2)+
    svCurArrow(335,Y1,376,Y1,`I_kd=${st.sc[st.scIdx].I}A`,SV.grn,0,-12)+
    svResH(376,Y1,64,`Rₛ′=${RsP.toFixed(2)}Ω`,`(R_eş,AC=${scC.Res.toFixed(2)}Ω)`)+svLine(440,Y1,462,Y1)+
    svIndH(462,Y1,64,`jXₛ′≈j${XsP.toFixed(2)}Ω`,`(Z_kd=${scC.Z.toFixed(2)}Ω)`)+svLine(526,Y1,655,Y1)+
    svLine(42,Y2,655,Y2)+
    svTerm(38,Y1,'+',-10)+svTerm(38,Y2,'−',18)+svTxt(22,144,`${st.oc[st.ocIdx].V}V`,SV.ln,'middle',12)+
    svTerm(660,Y1,'+',-10)+svTerm(660,Y2,'−',18)+svTxt(695,144,`a=${a.toFixed(2)}`,SV.ln,'middle',11.5)+
    svTxt(295,228,`Seçili Kademe → Boşta #${st.ocIdx+1} (${st.oc[st.ocIdx].V}V, cosφ₀=${ocC.cos.toFixed(3)}) · Kısa Devre #${st.scIdx+1} (${st.sc[st.scIdx].V}V, cosφ_kd=${scC.cos.toFixed(3)})`,SV.dim,'middle',10.8)+
  `</svg>`;
}
async function exportTrafoToNote(){
  const st=TRAFO_STATE, a=st.Np/st.Ns, a2=a*a;
  const ocRows=st.oc.map((r,i)=>{
    const c=calcOC(r);
    return `| **${i+1}** | ${r.V} | ${r.I_mA} | ${r.P} | ${c.S.toFixed(2)} | **${c.cos.toFixed(4)}** | ${c.phi.toFixed(2)}° | ${c.Ife_mA.toFixed(2)} | ${c.Im_mA.toFixed(2)} | ${Math.round(c.Rfe)} | ${Math.round(c.Xm)} |`;
  }).join('\n');
  const scRows=st.sc.map((r,i)=>{
    const c=calcSC(r);
    const cosStr=c.over?`1.000 *(ham: ${c.rawCos.toFixed(2)} ⚠️)*`:`**${c.cos.toFixed(4)}**`;
    return `| **${i+1}** | ${r.V} | ${r.I} | ${r.P} | ${c.S.toFixed(2)} | ${cosStr} | ${c.phi.toFixed(2)}° | ${c.Z.toFixed(2)} | ${c.Res.toFixed(2)} | ${c.Xes.toFixed(2)} |`;
  }).join('\n');
  const mdBlock=`\n\n---\n\n## 📊 Laboratuvar Defteri Ölçüm Sonuçları ve Çözümleri (Otomatik Hesaplandı)\n\n- **DC Sargı Dirençleri ve Sarım Sayıları:** $R_p = ${st.Rp}\\,\\Omega$, $R_s = ${st.Rs}\\,\\Omega$, $N_p = ${st.Np}\\text{ sarım}$, $N_s = ${st.Ns}\\text{ sarım}$\n- **Dönüştürme Oranı:** $$a = \\frac{N_p}{N_s} = \\frac{${st.Np}}{${st.Ns}} = ${a.toFixed(4)}, \\quad a^2 = ${a2.toFixed(4)}, \\quad R_s' = a^2 R_s = ${(a2*st.Rs).toFixed(2)}\\,\\Omega$$\n\n### 1. Boşta Çalışma Deneyi Sonuçları ve $\\cos(\\varphi_0)$ Hesapları\n\n$$\\cos(\\varphi_0) = \\frac{P_0}{V_0 \\cdot I_0}, \\quad I_{fe} = I_0 \\cos(\\varphi_0), \\quad I_m = I_0 \\sin(\\varphi_0), \\quad R_{fe} = \\frac{V_0}{I_{fe}}, \\quad X_m = \\frac{V_0}{I_m}$$\n\n| Kademe | $V_{BÇ}$ (V) | $I_{BÇ}$ (mA) | $P_{BÇ}$ (W) | $S_0$ (VA) | $\\cos(\\varphi_0)$ | $\\varphi_0$ (°) | $I_{fe}$ (mA) | $I_m$ (mA) | $R_{fe}$ ($\\Omega$) | $X_m$ ($\\Omega$) |\n|---|---|---|---|---|---|---|---|---|---|---|\n${ocRows}\n\n### 2. Kısa Devre Deneyi Sonuçları ve $\\cos(\\varphi_{kd})$ Hesapları\n\n$$\\cos(\\varphi_{kd}) = \\frac{P_{kd}}{V_{kd} \\cdot I_{kd}}, \\quad Z_{kd} = \\frac{V_{kd}}{I_{kd}}, \\quad R_{eş} = \\frac{P_{kd}}{I_{kd}^2}, \\quad X_{eş} = \\sqrt{Z_{kd}^2 - R_{eş}^2}$$\n\n| Kademe | $V_{kd}$ (V) | $I_{kd}$ (A) | $P_{kd}$ (W) | $S_{kd}$ (VA) | $\\cos(\\varphi_{kd})$ | $\\varphi_{kd}$ (°) | $Z_{kd}$ ($\\Omega$) | $R_{eş}$ ($\\Omega$) | $X_{eş}$ ($\\Omega$) |\n|---|---|---|---|---|---|---|---|---|---|\n${scRows}\n\n> [!WARNING] 1. Kademe Wattmetre Duyarlılık Yorumu\n> 1. kademede $S_{kd} = 10.45 \\times 0.418 = 4.37\\text{ VA}$ iken analog wattmetrede $P_{kd} = 5\\text{ W}$ okunmuştur (alt skala yuvarlama hatası nedeniyle $P_{kd}/S_{kd} = 1.145 > 1$). Nominal akıma yakın **2. ve 3. kademeler** ($I_{kd} = 0.794\\text{ A}$ ve $1.02\\text{ A}$) baz alındığında $Z_{kd} \\approx 28.87\\,\\Omega$, $R_{eş,AC} \\approx 28.83\\,\\Omega$ ve $\\cos(\\varphi_{kd}) \\approx 0.9987$ elde edilir.\n`;
  const rel='Elektrik_Makineleri_Lab/Deney_2_Tek_Fazli_Transformator.md';
  const id='note:'+rel;
  try{
    const cur=await api('/api/note?rel='+encodeURIComponent(rel));
    const marker='## 📊 Laboratuvar Defteri Ölçüm Sonuçları ve Çözümleri';
    const baseContent=cur.content.includes(marker)?cur.content.slice(0,cur.content.indexOf(marker)).replace(/\n---\s*$/,''):cur.content;
    noteCache[id]=await api('/api/note',{rel,content:baseContent.replace(/\s*$/,'')+mdBlock});
    toast('✅ Defter hesapları Deney 2 notuna aktarıldı!',id);
    openPage(id);
  }catch(e){ alert('Nota aktarma hatası: '+e.message); }
}
function renderTrafoLab(m){
  const st=TRAFO_STATE;
  const a=st.Np/st.Ns, a2=a*a, RsP=a2*st.Rs, Rdc=st.Rp+RsP;
  const ocCalcs=st.oc.map(calcOC), scCalcs=st.sc.map(calcSC);
  const curOC=ocCalcs[st.ocIdx]||ocCalcs[0], curSC=scCalcs[st.scIdx]||scCalcs[0];
  m.innerHTML=`<div class="sim" style="max-width:1020px;padding:24px 28px 90px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <h1 style="font-size:24px">⚡ Trafo Lab Analizörü — El Yazısı Defter Verilerin</h1>
        <div style="color:var(--mut);font-size:13px">Sayfa 4–6'daki Boşta Çalışma & Kısa Devre ölçümlerin otomatik çözüldü. Satırlara tıklayarak fazör ve şemayı canlı incele.</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="hb" onclick="openRightViewer('Elektrik_Makineleri_Lab/_gorseller/IMG20261102121140_120042.jpg','Defter Sayfası')" title="Defter fotoğrafını sağda aç">📷 Defter Fotoğrafı</button>
        <button class="btn" style="padding:7px 14px;font-size:12.5px" onclick="exportTrafoToNote()">📄 Hesapları Deney 2 Notuna Aktar</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;background:var(--bg);border:1px solid var(--line);padding:12px;border-radius:10px;font:12px var(--mono)">
      <label style="display:flex;flex-direction:column;gap:3px;color:var(--mut)">Rₚ (Primer DC Ω)<input type="number" step="0.1" value="${st.Rp}" onchange="TRAFO_STATE.Rp=+this.value||0.1;renderTrafoLab($('#main'))" style="background:var(--bg2);border:1px solid var(--line);color:var(--txt);padding:5px 8px;border-radius:6px;font:inherit"></label>
      <label style="display:flex;flex-direction:column;gap:3px;color:var(--mut)">Rₛ (Sekonder DC Ω)<input type="number" step="0.1" value="${st.Rs}" onchange="TRAFO_STATE.Rs=+this.value||0.1;renderTrafoLab($('#main'))" style="background:var(--bg2);border:1px solid var(--line);color:var(--txt);padding:5px 8px;border-radius:6px;font:inherit"></label>
      <label style="display:flex;flex-direction:column;gap:3px;color:var(--mut)">Nₚ (Primer Sarım)<input type="number" step="1" value="${st.Np}" onchange="TRAFO_STATE.Np=+this.value||1;renderTrafoLab($('#main'))" style="background:var(--bg2);border:1px solid var(--line);color:var(--txt);padding:5px 8px;border-radius:6px;font:inherit"></label>
      <label style="display:flex;flex-direction:column;gap:3px;color:var(--mut)">Nₛ (Sekonder Sarım)<input type="number" step="1" value="${st.Ns}" onchange="TRAFO_STATE.Ns=+this.value||1;renderTrafoLab($('#main'))" style="background:var(--bg2);border:1px solid var(--line);color:var(--txt);padding:5px 8px;border-radius:6px;font:inherit"></label>
      <div style="display:flex;flex-direction:column;justify-content:center;padding:4px 8px;border-left:2px solid var(--cu)">
        <span style="color:var(--mut)">Dönüştürme Oranı</span>
        <b style="color:var(--cu);font-size:14px">a = ${a.toFixed(4)}</b>
        <small style="color:var(--mut)">a² = ${a2.toFixed(3)} (Düşürücü)</small>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;padding:4px 8px;border-left:2px solid var(--ok)">
        <span style="color:var(--mut)">İndirgenmiş DC Direnç</span>
        <b style="color:var(--ok);font-size:14px">R_eş,DC = ${Rdc.toFixed(2)} Ω</b>
        <small style="color:var(--mut)">Rₛ′ = a²Rₛ = ${RsP.toFixed(2)} Ω</small>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:12px;align-items:stretch">
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="ph" style="padding:0">Canlı Primere İndirgenmiş Eşdeğer Devre (Kademe #${st.ocIdx+1} & #${st.scIdx+1})</div>
        ${liveTrafoSvg(st,curOC,curSC)}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="ph" style="padding:0">Canlı Fazör Diyagramı (I₀ = I_fe + jI_m) & Karakteristik Eğri</div>
        <canvas id="trafoCv" width="440" height="245" style="height:100%"></canvas>
      </div>
    </div>

    <div>
      <div class="ph" style="padding:0 0 6px"><span>1. Boşta Çalışma Deneyi Sonuçları (Defterde "cos φ₀ hesaplanacak" Sütunu Çözüldü)</span><span style="color:var(--cu)">Satıra tıkla → şemaya yansıt</span></div>
      <table style="width:100%;border-collapse:collapse;font:12.5px var(--mono);border:1px solid var(--line)">
        <thead><tr style="background:var(--bg);color:var(--cu)">
          <th style="padding:7px">#</th><th>V_BÇ (V)</th><th>I_BÇ (mA)</th><th>P_BÇ (W)</th><th>S₀ (VA)</th>
          <th style="background:var(--cu-d)">cos(φ₀) ★</th><th>φ₀ (°)</th><th>I_fe (mA)</th><th>I_m (mA)</th><th>R_fe (Ω)</th><th>X_m (Ω)</th>
        </tr></thead>
        <tbody>
          ${st.oc.map((r,i)=>{
            const c=ocCalcs[i], sel=i===st.ocIdx;
            return `<tr onclick="TRAFO_STATE.ocIdx=${i};renderTrafoLab($('#main'))" style="cursor:pointer;background:${sel?'var(--cu-d)':(i%2?'var(--bg3)':'transparent')};border-bottom:1px solid var(--line)">
              <td style="padding:6px 8px;color:${sel?'var(--cu)':'var(--mut)'}"><b>${i+1})</b></td>
              <td><input type="number" step="1" value="${r.V}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.oc[${i}].V=+this.value;renderTrafoLab($('#main'))" style="width:62px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td><input type="number" step="0.01" value="${r.I_mA}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.oc[${i}].I_mA=+this.value;renderTrafoLab($('#main'))" style="width:68px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td><input type="number" step="0.1" value="${r.P}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.oc[${i}].P=+this.value;renderTrafoLab($('#main'))" style="width:58px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td style="padding:6px 8px">${c.S.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--cu);font-weight:600;background:var(--cu-d)">${c.cos.toFixed(4)}</td>
              <td style="padding:6px 8px">${c.phi.toFixed(1)}°</td>
              <td style="padding:6px 8px;color:var(--cu)">${c.Ife_mA.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--blue)">${c.Im_mA.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--ok)">${Math.round(c.Rfe)}</td>
              <td style="padding:6px 8px;color:var(--blue)">${Math.round(c.Xm)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div>
      <div class="ph" style="padding:0 0 6px"><span>2. Kısa Devre Deneyi Sonuçları (Defterde "cos φ_kd hesaplanacak" Sütunu Çözüldü)</span><span style="color:var(--cu)">Satıra tıkla → şemaya yansıt</span></div>
      <table style="width:100%;border-collapse:collapse;font:12.5px var(--mono);border:1px solid var(--line)">
        <thead><tr style="background:var(--bg);color:var(--cu)">
          <th style="padding:7px">#</th><th>V_kd (V)</th><th>I_kd (A)</th><th>P_kd (W)</th><th>S_kd (VA)</th>
          <th style="background:var(--cu-d)">cos(φ_kd) ★</th><th>φ_kd (°)</th><th>Z_kd (Ω)</th><th>R_eş (Ω)</th><th>X_eş (Ω)</th><th>Xₚ ≈ Xₛ′ (Ω)</th>
        </tr></thead>
        <tbody>
          ${st.sc.map((r,i)=>{
            const c=scCalcs[i], sel=i===st.scIdx;
            return `<tr onclick="TRAFO_STATE.scIdx=${i};renderTrafoLab($('#main'))" style="cursor:pointer;background:${sel?'var(--cu-d)':(i%2?'var(--bg3)':'transparent')};border-bottom:1px solid var(--line)">
              <td style="padding:6px 8px;color:${sel?'var(--cu)':'var(--mut)'}"><b>${i+1})</b></td>
              <td><input type="number" step="0.01" value="${r.V}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.sc[${i}].V=+this.value;renderTrafoLab($('#main'))" style="width:68px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td><input type="number" step="0.001" value="${r.I}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.sc[${i}].I=+this.value;renderTrafoLab($('#main'))" style="width:68px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td><input type="number" step="0.5" value="${r.P}" onclick="event.stopPropagation()" onchange="TRAFO_STATE.sc[${i}].P=+this.value;renderTrafoLab($('#main'))" style="width:58px;background:transparent;border:1px solid var(--line);color:var(--txt);padding:2px 5px;border-radius:4px;font:inherit"></td>
              <td style="padding:6px 8px">${c.S.toFixed(2)}</td>
              <td style="padding:6px 8px;color:${c.over?'var(--err)':'var(--cu)'};font-weight:600;background:var(--cu-d)" title="${c.over?'P_kd > V_kd·I_kd (Wattmetre alt skala yuvarlama sapması)':''}">${c.over?`1.000 (ham:${c.rawCos.toFixed(2)}⚠)`:c.cos.toFixed(4)}</td>
              <td style="padding:6px 8px">${c.phi.toFixed(1)}°</td>
              <td style="padding:6px 8px">${c.Z.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--ok)">${c.Res.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--blue)">${c.Xes.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--blue)">${(c.Xes/2).toFixed(2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="margin-top:8px;padding:10px 12px;background:var(--bg);border-left:3px solid var(--cu);border-radius:0 8px 8px 0;font-size:12.5px;color:var(--txt)">
        <b style="color:var(--cu)">💡 Raporda Hoca Puanı Kazandıran Bulgu (Kısa Devre 1. Kademe):</b> Defterindeki 1. kademede <code>V_kd·I_kd = 10.45 × 0.418 = 4.37 VA</code> iken wattmetreden <code>P_kd = 5 W</code> okunmuş (analog wattmetrenin alt skalada ~0.6 W yuvarlama sapması nedeniyle <code>P_kd / S_kd = 1.145 &gt; 1</code> çıkıyor). 2. ve 3. kademelerde (<code>0.794 A</code> ve <code>1.02 A</code>) bu hata kaybolur ve <code>Z_kd ≈ 28.87 Ω</code>, <code>R_eş,AC ≈ 28.83 Ω</code>, <code>cos(φ_kd) = 0.9987</code> bulunur. Ayrıca <code>R_eş,AC (28.8 Ω) &gt; R_eş,DC (15.0 Ω)</code> farkı AC deri etkisi (skin effect) ve kaçak akı ek kayıplarından kaynaklanır.
      </div>
    </div>
  </div>`;

  const cv=$('#trafoCv'); if(!cv)return;
  const pal=getThemeCanvasPal();
  const g=cv.getContext('2d'), W=cv.width, H=cv.height;
  g.clearRect(0,0,W,H);
  g.font='11px JetBrains Mono, monospace';
  // Sol yarı: Fazör Diyagramı (V1, I0, Ife, Im)
  const ox=34, oy=36, len=150;
  g.strokeStyle=pal.line; g.lineWidth=1;
  g.beginPath(); g.moveTo(ox,oy); g.lineTo(ox+len+18,oy); g.moveTo(ox,oy); g.lineTo(ox,oy+len+18); g.stroke();
  g.fillStyle=pal.mut; g.fillText('Fazör (Boşta #'+ (st.ocIdx+1) +')', ox, 20);
  // V1 vektörü (yatay referans)
  g.strokeStyle=pal.cu; g.lineWidth=2.2;
  g.beginPath(); g.moveTo(ox,oy); g.lineTo(ox+len,oy); g.stroke();
  g.fillStyle=pal.cu; g.fillText(`V₁=${st.oc[st.ocIdx].V}V (0°)`, ox+len-52, oy-7);
  // Ife (yatay) ve Im (dikey aşağı - endüktif geri)
  const rad=curOC.phi*Math.PI/180;
  const rI=len*0.88, ix=ox+rI*Math.cos(rad), iy=oy+rI*Math.sin(rad);
  g.setLineDash([4,3]); g.strokeStyle=pal.mut; g.lineWidth=1.1;
  g.beginPath(); g.moveTo(ix,oy); g.lineTo(ix,iy); g.moveTo(ox,iy); g.lineTo(ix,iy); g.stroke();
  g.setLineDash([]);
  // Ife
  g.strokeStyle=pal.ok; g.lineWidth=2;
  g.beginPath(); g.moveTo(ox,oy); g.lineTo(ix,oy); g.stroke();
  g.fillStyle=pal.ok; g.fillText(`I_fe=${curOC.Ife_mA.toFixed(1)}mA`, ox+12, oy+14);
  // Im
  g.strokeStyle=pal.blue; g.lineWidth=2;
  g.beginPath(); g.moveTo(ox,oy); g.lineTo(ox,iy); g.stroke();
  g.fillStyle=pal.blue; g.fillText(`I_m=${curOC.Im_mA.toFixed(1)}mA`, ox+5, Math.min(H-10,iy+14));
  // I0
  g.strokeStyle=pal.txt; g.lineWidth=2.3;
  g.beginPath(); g.moveTo(ox,oy); g.lineTo(ix,iy); g.stroke();
  g.beginPath(); g.arc(ox,oy,34,0,rad); g.strokeStyle=pal.cu; g.lineWidth=1.4; g.stroke();
  g.fillStyle=pal.cu; g.fillText(`φ₀=${curOC.phi.toFixed(1)}°`, ox+38, oy+22);
  g.fillStyle=pal.txt; g.fillText(`I₀=${st.oc[st.ocIdx].I_mA}mA`, ix-28, iy+15);

  // Sağ yarı: Boşta Çalışma Mıknatıslanma Eğrisi (V0 - I0)
  const gx=245, gy=32, gw=175, gh=175;
  g.strokeStyle=pal.line; g.lineWidth=1;
  g.strokeRect(gx,gy,gw,gh);
  g.fillStyle=pal.mut; g.fillText('Mıknatıslanma (V₀–I₀)', gx, 20);
  g.fillText('I₀(mA) →', gx+gw-55, gy+gh+16);
  g.strokeStyle=pal.cu; g.lineWidth=2; g.beginPath();
  st.oc.forEach((p,idx)=>{
    const px=gx+12+(p.I_mA-15)/16*(gw-24);
    const py=gy+gh-12-(p.V-80)/125*(gh-24);
    if(idx===0) g.moveTo(px,py); else g.lineTo(px,py);
  });
  g.stroke();
  st.oc.forEach((p,idx)=>{
    const px=gx+12+(p.I_mA-15)/16*(gw-24);
    const py=gy+gh-12-(p.V-80)/125*(gh-24);
    g.fillStyle=idx===st.ocIdx?pal.ok:pal.cu;
    g.beginPath(); g.arc(px,py,idx===st.ocIdx?5.5:3.5,0,Math.PI*2); g.fill();
    g.fillStyle=idx===st.ocIdx?pal.txt:pal.mut;
    g.fillText(`${p.V}V`, px-12, py-8);
  });
}

/* ---------- NotebookLM tarzı: ortada sohbet, sağda Studio ---------- */
const STUDIO_KEY='agydesk_studio_notes';
let studioNotes=[]; try{ studioNotes=JSON.parse(localStorage.getItem(STUDIO_KEY)||'[]'); }catch(e){}
let studioPendingTitle=null, studioOpenId=null;
const STUDIO_TILES=[['ozet','☰'],['fisle','▤'],['whisper','✎'],['teardown','◈'],['spice','∿'],['pcb','▦']];
function saveStudio(){ try{ localStorage.setItem(STUDIO_KEY,JSON.stringify(studioNotes.slice(0,100))); }catch(e){} }
function getScopedStudioNotes(){
  const k=currentKasa||'all';
  return studioNotes.filter(n=>(n.kasa||'all')===k);
}
function studioAdd(title,md,html,kasaKey=currentKasa){
  studioNotes.unshift({id:'sn'+Date.now(),kasa:(kasaKey||'all'),t:title,md:md||'',h:html||mdToHtml(md||''),ts:Date.now()});
  saveStudio(); renderStudio();
}
function studioSaveMsg(i){
  const m=getStudySess().msgs[i]; if(!m) return;
  const d=document.createElement('div'); d.innerHTML=m.h; d.querySelectorAll('.route').forEach(x=>x.remove());
  const txt=d.textContent.trim();
  studioAdd(txt.slice(0,48)||'Not',txt,d.innerHTML,currentKasa);
  toast('📌 Studio notlarına kaydedildi');
}
function studioDel(id){ studioNotes=studioNotes.filter(n=>n.id!==id); saveStudio(); renderStudio(); }
function studioCopy(id){ const n=studioNotes.find(x=>x.id===id); if(n&&navigator.clipboard) navigator.clipboard.writeText(n.md||n.t); }
function studioToggle(id){ studioOpenId=(studioOpenId===id)?null:id; renderStudio(); }
function renderStudio(){
  const b=$('#rb-studio'); if(!b) return;
  const scoped=getScopedStudioNotes();
  const kObj=kasalarData.find(k=>k.key===currentKasa);
  const kName=kObj?kObj.title:'Tüm Kasalar';
  b.innerHTML=`<div class="rview-head"><span>✦</span><b>Studio</b><span class="st-kasa-pill" title="${escAttr(kName)}">${escHtml(kName)}</span></div><div class="st-wrap">
    <div class="st-h"><span>Oluştur</span></div>
    <div class="st-grid">${STUDIO_TILES.map(([k,ic])=>`<button class="st-tile" onclick="runSkill('${k}')"><span class="ic">${ic}</span>${SK[k].h}</button>`).join('')}</div>
    <div class="st-h"><span>Notlar</span><span>${scoped.length}</span></div>
    ${scoped.length?scoped.map(n=>`<div class="st-card"><div class="t" onclick="studioToggle('${n.id}')">${studioOpenId===n.id?'▾':'▸'} ${n.t.replace(/</g,'&lt;')}</div>${studioOpenId===n.id?`<div class="full">${n.h}</div>`:`<div class="pv">${(n.md||'').replace(/[<#*]/g,'').slice(0,220)}</div>`}<div class="ft"><span>${new Date(n.ts).toLocaleString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span><span style="flex:1"></span><button onclick="studioCopy('${n.id}')" title="Kopyala">⧉</button><button onclick="studioDel('${n.id}')" title="Sil">🗑</button></div></div>`).join(''):`<div class="st-empty"><b>${escHtml(kName)}</b> kasası için oluşturulan çıktılar ve 📌 ile kaydettiğin yanıtlar burada birikir.</div>`}
  </div>`;
  runMermaid('#rb-studio .mermaid');
}
function studioSend(q){
  q=(q||'').trim();
  const sid=getStudySessId();
  const s=ensureStudySession(sid);
  if(!q&&!(s&&s.attachments&&s.attachments.length)) return;
  studioPendingTitle=null; aiSend(sid,q);
}
function renderStudyChat(m){
  const sid=getStudySessId();
  const s=ensureStudySession(sid);
  s.unread=false;
  const prevSc=$('#scIn');
  if(prevSc&&prevSc.dataset&&prevSc.dataset.sessId&&prevSc.value) chatDrafts[prevSc.dataset.sessId]=prevSc.value;
  m.scrollTop=0;
  m.innerHTML=`<div class="sc-wrap"><div class="sc-head"><b>Sohbet</b><label class="sc-src-wrap" title="Kasa değiştir (her kasa kendi sohbetine ve Studio notlarına sahiptir)">📚 <select class="sc-src-sel" id="scSrcSel" onchange="selectKasaFilter(this.value)"></select><svg class="sc-src-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></label><span style="flex:1"></span><button class="hb" onclick="clearSrcAi()" title="Bu kasanın sohbetini sıfırla">🧹 Temizle</button><button class="hb stop" id="scStop" style="display:none" onclick="aiStop(getStudySessId())">■ Dur</button></div>
    <div class="sc-body" id="scChat"></div>
    <div class="sc-foot"><div class="sc-chips" id="scChips"></div><div class="sc-foot-in">${gemComposerHtml({sessId:sid,inputId:'scIn',sendId:'scGo',attachId:'scAttach',placeholder:"Kaynaklarınıza ve AgyDesk'e sorun…",compact:false,showDisclaimer:true})}</div></div></div>`;
  const i=$('#scIn'), go=()=>{
    const curSid=getStudySessId();
    const cur=ensureStudySession(curSid);
    if(cur&&(cur.running||cur.pending)){ aiStop(curSid); return; }
    const v=i.value;
    if(!v.trim()&&!(cur&&cur.attachments&&cur.attachments.length)) return;
    delete chatDrafts[curSid];
    i.value=''; autoGrow(i); syncGemBoxState(i); studioSend(v);
  };
  if(i){ i.dataset.sessId=sid; if(chatDrafts[sid]){ i.value=chatDrafts[sid]; autoGrow(i); syncGemBoxState(i); } }
  $('#scGo').onclick=go;
  i.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); e.stopPropagation(); if(!i.value.trim()&&triggerActiveApproval(getStudySessId(),true)) return; go(); } };
  i.oninput=()=>{ chatDrafts[getStudySessId()]=i.value; autoGrow(i); syncGemBoxState(i); };
  wireAiSlash(i);
  wireChatDrop(m.querySelector('.sc-wrap'),()=>getStudySessId());
  renderChatAttachments(sid);
  syncAllGemBoxes();
  updateSideAiCtx(); renderStudyChatBody(); i.focus();
}
function renderStudyChatBody(){
  const c=$('#scChat'); if(!c||active!=='studychat') return;
  const sid=getStudySessId();
  const s=ensureStudySession(sid);
  const msgs=s.msgs.map((x,i)=>({x,i})).filter(o=>!(o.i===0&&o.x.w==='a'&&s.msgs.length===1&&!isCompactMsg(o.x)));
  const prevLen=c.dataset.msgCount?+c.dataset.msgCount:-1;
  const prevScroll=c.scrollTop;
  const isInitialMount=c.dataset.rendered!==sid;
  const nearBottom=!isInitialMount&&(c.scrollHeight-c.clientHeight-c.scrollTop)<80;
  if(!c.dataset.scrollHooked){
    c.dataset.scrollHooked='1';
    c.addEventListener('scroll',()=>saveChatScroll('studychat'),{passive:true});
  }
  const n=getCheckedSources().length;
  const kObj=kasalarData.find(k=>k.key===currentKasa);
  const kName=kObj?kObj.title:'Tüm Kasalar';
  let h='';
  if(!msgs.length&&!s.running){
    h=`<div class="sc-hero"><div class="big">${escHtml(kName)}</div><div class="sub">${n} kaynak seçili · soru sor ya da sağdaki Studio'dan çıktı oluştur</div></div>`;
  }else{
    h=msgs.map(({x,i})=>renderMsgRowHtml(sid,x,i,true)).join('');
    if(s.running&&s.streamText) h+=`<div class="sc-msg a live-stream" data-sid="${escAttr(sid)}">${escHtml(s.streamText)}</div>`;
    if(s.running) h+=`<div class="sc-msg a" data-run-sid="${escAttr(sid)}"><span class="spin"></span> <span data-step-sid="${escAttr(sid)}">${escHtml(s.step||'Çalışıyor…')}</span></div>`;
  }
  c.innerHTML=`<div class="sc-col">${h}</div>`;
  c.dataset.rendered=sid;
  c.dataset.msgCount=String(msgs.length);
  let pinBottom=false;
  if(scrollChatToLastReply(c,s)){
    saveChatScroll('studychat');
  }else if(isInitialMount){
    const saved=chatScrollMap['studychat:'+sid];
    if(saved&&!saved.atBottom){
      c.scrollTop=saved.top;
      requestAnimationFrame(()=>{ if(active==='studychat'&&$('#scChat')&&getStudySessId()===sid) $('#scChat').scrollTop=saved.top; });
    }else{
      c.scrollTop=c.scrollHeight;
      pinBottom=true;
    }
  }else if(msgs.length!==prevLen||nearBottom){
    c.scrollTop=c.scrollHeight;
    pinBottom=true;
  }else{
    c.scrollTop=prevScroll;
  }
  const st=$('#scStop'); if(st) st.style.display=(s.running||s.pending)?'inline-flex':'none';
  const ch=$('#scChips');
  if(ch) ch.innerHTML=msgs.length?'':['Bu kaynakları özetle','Kritik formülleri listele','Sınavda çıkabilecek sorular'].map(q=>`<button onclick="studioSend('${q}')">${q}</button>`).join('');
  syncAllGemBoxes();
  runMermaid('#scChat .mermaid',false,pinBottom?()=>{ if(active==='studychat'&&$('#scChat')&&getStudySessId()===sid){ $('#scChat').scrollTop=$('#scChat').scrollHeight; saveChatScroll('studychat'); } }:null);
}
/* ---------- Sohbet / yönlendirici (Sağ Panel Gerçek AI) ---------- */
function chat(who,html){
  ai.side_ai.msgs.push({w:who==='me'?'me':'a',h:html});
  renderSideAi();
}
function autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight+2,Math.round(innerHeight*0.5))+'px'}
function send(){
  const cur=ai.side_ai;
  if(cur&&(cur.running||cur.pending)){ aiStop('side_ai'); return; }
  const i=$('#chatIn'),q=i.value.trim();
  if(!q&&!(cur&&cur.attachments&&cur.attachments.length))return;
  i.value='';autoGrow(i);syncGemBoxState(i);
  aiSend('side_ai',q);
}
$('#send').onclick=send; $('#chatIn').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.stopPropagation();if(!e.target.value.trim()&&triggerActiveApproval('side_ai',true))return;send()}}; $('#chatIn').oninput=e=>{autoGrow(e.target);syncGemBoxState(e.target);}; wireAiSlash($('#chatIn'));
wireChatDrop($('#rb-ai'),()=>'side_ai');

/* ---------- Sağ sekmeler & Panel düğmeleri ---------- */
function syncPaneBtns(){
  const l=$('#leftTog'), r=$('#rightTog'), d=$('#aiDrawerTog');
  const leftOpen=!app.classList.contains('no-left');
  if(l) l.classList.toggle('on', leftOpen);
  if(d) d.classList.toggle('on', leftOpen);
  if(r) r.classList.toggle('on', !app.classList.contains('no-right'));
}
function togglePane(side){
  if(app.classList.contains('zen')){
    app.classList.remove('zen','pdf-zen');
    const zb=$('#zenBtn'); if(zb) zb.classList.remove('on');
    applyPaneWidths();
  }
  if(side==='right'&&viewerPrev&&!app.classList.contains('no-right')){
    closeRightViewer();
    return;
  }
  app.classList.toggle(side==='left'?'no-left':'no-right');
  if(side==='left'&&curMode==='write') writeNoLeft=app.classList.contains('no-left');
  if(side==='right'&&curMode==='write') writeNoRight=app.classList.contains('no-right');
  if(side==='left'&&curMode==='study') studyNoLeft=app.classList.contains('no-left');
  if(side==='right'&&curMode==='study') studyNoRight=app.classList.contains('no-right');
  applyPaneWidths();
  syncPaneBtns();
  syncPdfFocusMode();
  saveSessionTabs();
  if(side==='right'&&!app.classList.contains('no-right')){
    if(curMode!=='study'&&!$('#rb-ai.on')) rtab('ai');
    requestAnimationFrame(()=>{ const inp=$('#chatIn'); if(inp&&$('#rb-ai.on')) inp.focus(); });
  }
}
function toggleAllTreeFolders(){
  const folders=[];
  const walk=arr=>arr.forEach(x=>{
    if(x&&Array.isArray(x.k)){
      folders.push(x);
      walk(x.k);
    }
  });
  walk(tree);
  if(!folders.length) return;
  const targetOpen=!folders.some(x=>x.open);
  folders.forEach(x=>{
    x.open=targetOpen;
    const tk=x.spaceId?('space:'+x.spaceId):(x.rel||((x.id||'')+'|'+x.n));
    TREE_OPEN[tk]=targetOpen;
  });
  renderTree();
  syncTreeToggleBtns();
  saveSessionTabs();
}
function syncTreeToggleBtns(){
  let anyOpen=false;
  const walk=arr=>arr.forEach(x=>{
    if(x&&Array.isArray(x.k)){
      if(x.open) anyOpen=true;
      walk(x.k);
    }
  });
  walk(tree);
  const tip=anyOpen?'Tüm klasörleri kapat':'Tüm klasörleri aç';
  const aiBtn=$('#aiTreeTogBtn');
  if(aiBtn) aiBtn.title=tip;
  const act=$('#leftActBtn');
  if(act&&curMode!=='ai') act.title=tip;
}
function leftHeaderAct(){
  if(curMode==='ai'){ newSession(); return; }
  toggleAllTreeFolders();
}
$$('.rt').forEach(t=>t.onclick=()=>{
  $('#rtabsBar').style.display='';
  viewerPrev=null;
  $$('.rt').forEach(x=>x.classList.toggle('on',x===t));
  $$('.rbody').forEach(b=>b.classList.toggle('on',b.id==='rb-'+t.dataset.rt));
  if(t.dataset.rt==='props') updateRightProps();
  if(t.dataset.rt==='studio') runMermaid('#rb-studio .mermaid');
  saveSessionTabs();
});
function rtab(n){
  if(n==='ai'&&curMode==='study') n='studio';
  $('#rtabsBar').style.display='';
  viewerPrev=null;
  const el=$(`.rt[data-rt=${n}]`);
  if(el) el.click();
  app.classList.remove('no-right');
  if(curMode==='write') writeNoRight=false;
  if(curMode==='study') studyNoRight=false;
  syncPaneBtns();
  saveSessionTabs();
}
function initResizers(){
  const rl=$('#resLeft'), rr=$('#resRight');
  const bind=(el,side)=>{
    if(!el)return;
    el.addEventListener('mousedown',ev=>{
      if(ev.button!==0)return;
      ev.preventDefault();
      el.classList.add('on');
      app.classList.add('resizing');
      const onMove=e=>{
        const avail=paneAvailW();
        if(side==='left'){
          const target=clampLeft(e.clientX-RAIL_W);
          leftPct=clampLeftPct(target/avail);
        }else{
          const target=clampRight(window.innerWidth-e.clientX);
          rightPct=clampRightPct(target/avail);
        }
        applyPaneWidths();
      };
      const onUp=()=>{
        el.classList.remove('on');
        app.classList.remove('resizing');
        window.removeEventListener('mousemove',onMove);
        window.removeEventListener('mouseup',onUp);
        saveSessionTabs();
      };
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
    });
    el.addEventListener('dblclick',()=>{
      if(side==='left') leftPct=LEFT_PCT_DEF;
      else rightPct=viewerPrev?VIEWER_PCT_MIN:RIGHT_PCT_DEF;
      applyPaneWidths();
      saveSessionTabs();
    });
  };
  bind(rl,'left');
  bind(rr,'right');
  let lastAppW=0;
  const syncOnResize=()=>{
    const w=app?app.clientWidth:window.innerWidth;
    if(w===lastAppW) return;
    lastAppW=w;
    applyPaneWidths();
  };
  window.addEventListener('resize',syncOnResize);
  if(typeof ResizeObserver!=='undefined'&&app){
    new ResizeObserver(syncOnResize).observe(app);
  }
  applyPaneWidths();
}
initResizers();

function syncWinMaxIcon(){
  const btn=$('#winMaxBtn');
  if(!btn) return;
  const isMax=(window.outerWidth>=screen.availWidth-4 && window.outerHeight>=screen.availHeight-4)
    || Boolean(document.fullscreenElement);
  btn.title=isMax?'Önceki boyut':'Ekranı kapla';
  btn.setAttribute('aria-label',btn.title);
  btn.innerHTML=isMax
    ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 3V1.5h5.5V7H7" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><rect x="1.5" y="3" width="5.5" height="5.5" rx=".6" stroke="currentColor" stroke-width="1.15"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.5" y="1.5" width="7" height="7" rx=".8" stroke="currentColor" stroke-width="1.2"/></svg>';
}
window.addEventListener('resize',syncWinMaxIcon);
document.addEventListener('fullscreenchange',syncWinMaxIcon);
syncWinMaxIcon();

function winAct(cmd,skipSessionSave=false){
  if(cmd==='close'&&!skipSessionSave){
    try{ saveMainScroll(); saveSessionTabs(true); flushUiStateRemote(true); }catch(e){}
  }
  if(window.ipc && typeof window.ipc.postMessage==='function'){
    window.ipc.postMessage(cmd);
    if(cmd==='max') setTimeout(syncWinMaxIcon,80);
  }else if(cmd==='close'){
    window.close();
  }
}
(function initWindowBarDrag(){
  const tb=$('#topbar');
  if(!tb) return;
  const isInteractive=(el)=>Boolean(el&&el.closest('button,.tab,.tab-add,.win-btn,.win-ctrls,input,select,textarea,a'));
  tb.addEventListener('mousedown',(e)=>{
    if(e.button!==0 || isInteractive(e.target)) return;
    const sx=e.screenX, sy=e.screenY;
    let moved=false;
    const onMove=(ev)=>{
      if(moved) return;
      if(Math.abs(ev.screenX-sx)>3 || Math.abs(ev.screenY-sy)>3){
        moved=true;
        cleanup();
        winAct('drag');
      }
    };
    const cleanup=()=>{
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',cleanup);
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',cleanup);
  });
  tb.addEventListener('dblclick',(e)=>{
    if(isInteractive(e.target)) return;
    winAct('max');
  });
})();

/* ---------- Modlar ---------- */
let curMode='kasalar';
let writeNoLeft=false;
let writeNoRight=true;
let studyNoLeft=false;
let studyNoRight=false;
function layoutMode(m){
  const prevMode=curMode;
  curMode=m;
  if(app){ app.dataset.mode=m; app.classList.toggle('mode-ai',m==='ai'); }
  $$('.rbtn[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  const logo=$('.rail .logo');
  if(logo) logo.classList.toggle('on',m==='kasalar');
  const show=(treeVis,src,sess,title)=>{
    $('#tree').style.display=treeVis?'':'none';
    $('#sources').style.display=src?'block':'none';
    $('#sessWrap').style.display=sess?'flex':'none';
    $('#leftTitle').textContent=title;
    const act=$('#leftActBtn');
    if(act){ act.textContent=sess?'＋':'↕'; act.title=sess?'Yeni AI oturumu':'Klasörleri daralt/genişlet'; }
  };
  $('.rt[data-rt=ai]').style.display=(m==='ai'||m==='study')?'none':'';
  $('.rt[data-rt=studio]').style.display=(m==='study')?'':'none';
  if(m!=='study'&&m!=='ai'&&($('.rt[data-rt=studio].on')||prevMode==='ai')){ const a=$('.rt[data-rt=ai]'); if(a)a.click(); }
  if(m==='kasalar'){app.classList.add('no-left','no-right');show(1,0,0,'Kasa Notları');}
  if(m==='write'){app.classList.toggle('no-left',!!writeNoLeft);app.classList.toggle('no-right',!!writeNoRight);show(1,0,0,'Kasa Notları');}
  if(m==='study'){show(0,1,0,'Kaynaklar');renderStudio();const stEl=$('.rt[data-rt=studio]');if(stEl)stEl.click();app.classList.toggle('no-left',!!studyNoLeft);app.classList.toggle('no-right',!!studyNoRight);}
  if(m==='plan'){app.classList.add('no-left','no-right');show(1,0,0,'Kasa Notları');}
  if(m==='ai'){app.classList.remove('no-left');app.classList.add('no-right');show(1,0,1,'AI Oturumları');const el=$('.rt[data-rt=skills]');if(el)el.click();renderSessions();}
  applyPaneWidths();
  syncPaneBtns();
  saveSessionTabs();
  scheduleRecordNavState();
}
function setMode(m){
  if(app.classList.contains('zen')){
    app.classList.remove('zen','pdf-zen');
    const zb=$('#zenBtn'); if(zb) zb.classList.remove('on');
  }
  layoutMode(m);
  if(m==='kasalar')openPage('kasalar');
  if(m==='plan')openPage('cal');
  if(m==='ai'){const cur=isAI(active)?active:ensureWindowAiSession(); openPage(cur);}
  if(m==='study') openPage('studychat');
  else if(m==='write'&&(isAI(active)||active==='kasalar')){
    const o=openTabs.find(x=>!isAI(x)&&x!=='kasalar')||firstVaultTab();
    openPage(o);
  }
}
function isPdfTab(id){
  if(!String(id||'').startsWith('note:')) return false;
  const p=pages[id];
  const ext=(p&&p.ext?p.ext:String(id).slice(String(id).lastIndexOf('.'))).toLowerCase();
  return ext==='.pdf';
}
function isHtmlTab(id){
  if(!String(id||'').startsWith('note:')) return false;
  const p=pages[id];
  const ext=(p&&p.ext?p.ext:String(id).slice(String(id).lastIndexOf('.'))).toLowerCase();
  return ext==='.html'||ext==='.htm';
}
function isPptxTab(id){
  if(!String(id||'').startsWith('note:')) return false;
  const p=pages[id];
  const ext=(p&&p.ext?p.ext:String(id).slice(String(id).lastIndexOf('.'))).toLowerCase();
  return /\.(pptx?|ppsx)$/i.test(ext);
}
function isCachedFrameTab(id){
  return isPdfTab(id)||isHtmlTab(id)||isPptxTab(id);
}
function syncPdfFocusMode(){
  if(!app) return;
  const on=app.classList.contains('zen')&&isCachedFrameTab(active);
  app.classList.toggle('pdf-zen',on);
}
function toggleZen(){
  const isZen=app.classList.toggle('zen');
  const btn=$('#zenBtn');
  if(btn) btn.classList.toggle('on',isZen);
  syncPaneBtns();
  syncPdfFocusMode();
  if(!isZen) applyPaneWidths();
}
$$('.rbtn[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('#zenBtn').onclick=toggleZen;

/* ---------- Kısayollar ---------- */
function cycleTab(dir){
  if(openTabs.length<2)return;
  const i=openTabs.indexOf(active);
  const next=(i+dir+openTabs.length)%openTabs.length;
  openPage(openTabs[next]);
}
document.addEventListener('keydown',e=>{
  if(e.key==='BrowserBack'||(e.altKey&&!e.ctrlKey&&!e.metaKey&&e.key==='ArrowLeft')){
    e.preventDefault();
    navBack();
    return;
  }
  if(e.key==='BrowserForward'||(e.altKey&&!e.ctrlKey&&!e.metaKey&&e.key==='ArrowRight')){
    e.preventDefault();
    navForward();
    return;
  }
  if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.isComposing){
    if(!$('#kasaModalBg')?.classList.contains('show')&&!$('#gcalModalBg')?.classList.contains('show')){
      const t=e.target;
      const onDenyBtn=!!(t&&t.closest&&t.closest('[data-appr-deny]'));
      const onEditable=!!(t&&(t.isContentEditable||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||(t.tagName==='INPUT'&&t.type!=='checkbox'&&t.type!=='radio'&&t.type!=='button'&&t.type!=='submit')));
      if(!onDenyBtn&&!onEditable){
        const apSid=getVisibleApprovalSession();
        if(apSid&&triggerActiveApproval(apSid,true)){
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }
  }
  if(e.key==='Tab'&&e.ctrlKey){
    e.preventDefault();
    cycleTab(e.shiftKey?-1:1);
    return;
  }
  if(e.key==='Tab'&&e.shiftKey&&!e.ctrlKey&&isAI(active)){e.preventDefault();cycleMode(active);return;}
  if(e.key==='Escape'){
    if($('#notionTreeMenu')?.classList.contains('show')){ closeNotionTreeMenu(); return; }
    if(notionState.slashOpen){ closeNotionSlash(); return; }
    if(notionState.activeMathChip){ closeInlineMathPop(); return; }
    if($('#gcalModalBg')?.classList.contains('show')){ closeCalModal(); return; }
    if(app.classList.contains('zen')){ toggleZen(); return; }
    closeKasaModal();
  }
  if(active==='cal'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!e.target.isContentEditable&&!$('#gcalModalBg')?.classList.contains('show')){
    const k=e.key.toLowerCase();
    if(k==='d'){e.preventDefault();gcalSetView('day');return;}
    if(k==='w'){e.preventDefault();gcalSetView('week');return;}
    if(k==='m'){e.preventDefault();gcalSetView('month');return;}
    if(k==='p'){e.preventDefault();gcalSetView('schedule');return;}
    if(k==='a'){e.preventDefault();gcalSetView('agenda');return;}
    if(k==='y'){e.preventDefault();gcalSetView('semester');return;}
    if(k==='t'){e.preventDefault();gcalGoToday();return;}
    if(k==='c'){e.preventDefault();openCalModal(null,GCAL.cursor);return;}
    if(k==='q'){e.preventDefault();$('#gcalSmartInput')?.focus();return;}
  }
  if(e.altKey&&!e.ctrlKey&&!e.shiftKey&&(e.key==='n'||e.key==='N')){e.preventDefault();openNewNoteModal();return;}
  if((e.ctrlKey||e.altKey)&&!e.shiftKey&&/^[1-9]$/.test(e.key)){
    e.preventDefault();
    const n=+e.key;
    const target=(n===9&&openTabs.length>9)?openTabs[openTabs.length-1]:openTabs[n-1];
    if(target)openPage(target);
    return;
  }
  if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
  const lk=(e.key||'').toLowerCase();
  if(lk==='z'||e.code==='KeyZ'||lk==='y'||e.code==='KeyY'){
    if(e.target&&(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))) return;
    const isRedo=(lk==='z'||e.code==='KeyZ')?e.shiftKey:!e.shiftKey;
    if(e.target&&e.target.closest&&e.target.closest('#mdView')&&String(active).startsWith('note:')&&!editMode){
      e.preventDefault();
      e.stopPropagation();
      const ok=isRedo?notionRedo():notionUndo();
      if(!ok) toast(isRedo?'İleri alınacak not değişikliği yok':'Geri alınacak not değişikliği yok');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    (async()=>{
      let handled=false;
      if(isRedo){
        if(String(active).startsWith('note:')&&curMode==='write'&&!editMode&&lastNotionEditAt>lastAppActionAt){
          handled=notionRedo()||await performAppRedo();
        }else{
          handled=await performAppRedo()||(String(active).startsWith('note:')&&!editMode&&notionRedo());
        }
      }else{
        if(String(active).startsWith('note:')&&curMode==='write'&&!editMode&&lastNotionEditAt>lastAppActionAt){
          handled=notionUndo()||await performAppUndo();
        }else{
          handled=await performAppUndo()||(String(active).startsWith('note:')&&!editMode&&notionUndo());
        }
      }
      if(!handled) toast(isRedo?'İleri alınacak işlem yok':'Geri alınacak işlem yok');
    })();
    return;
  }
  if((lk==='t'||e.code==='KeyT')&&e.shiftKey){e.preventDefault();reopenLastClosedTab();return;}
  if(!e.ctrlKey)return;
  if((e.key==='s'||e.key==='S')&&String(active).startsWith('note:')){e.preventDefault();flushNotionSave(active,true);return;}
  if(e.target.isContentEditable&&!notionState.locked&&e.target.closest&&e.target.closest('#mdView')){
    const lk=e.key.toLowerCase();
    if(lk==='b'&&!e.shiftKey){e.preventDefault();notionFormat('bold');return;}
    if(lk==='i'&&!e.shiftKey){e.preventDefault();notionFormat('italic');return;}
    if(lk==='u'&&!e.shiftKey){e.preventDefault();notionFormat('underline');return;}
    if(lk==='e'&&!e.shiftKey){e.preventDefault();notionWrapSelection('code');return;}
    if(lk==='m'&&!e.shiftKey){e.preventDefault();notionWrapSelection('math');return;}
  }
  if(e.shiftKey&&(e.key==='PageUp'||(!['INPUT','TEXTAREA'].includes(e.target.tagName)&&!e.target.isContentEditable&&e.key==='ArrowLeft'))){e.preventDefault();moveActiveTab(-1);return;}
  if(e.shiftKey&&(e.key==='PageDown'||(!['INPUT','TEXTAREA'].includes(e.target.tagName)&&!e.target.isContentEditable&&e.key==='ArrowRight'))){e.preventDefault();moveActiveTab(1);return;}
  if(e.key==='PageDown'){e.preventDefault();cycleTab(1);return;}
  if(e.key==='PageUp'){e.preventDefault();cycleTab(-1);return;}
  if(e.key==='w'||e.key==='W'){e.preventDefault();closeTab(active);return;}
  if((e.key==='t'||e.key==='T')&&!e.shiftKey){e.preventDefault();newBlankTab();return;}
  if(e.key==='b'||e.key==='B'){e.preventDefault();togglePane('left');}
  if(e.key==='j'||e.key==='J'){e.preventDefault();togglePane('right');}
  if(e.key==='.'){e.preventDefault();toggleZen();}
});

/* ---------- Skill kütüphanesi (komut / mod / yetenek / araç) ---------- */
const mk=(h,prompt,r,kind)=>({h,prompt,r,kind});
Object.assign(SK,{
 browser:mk('/browser','Şu an açık olan Chrome penceremdeki aktif sekmeyi incele ve istediğim işlemi yap.',['komut','açık Chrome','MCP'],''),
 usage:mk('/usage','Canlı agy CLI kota ve kullanım durumunu göster.',['komut','agy /usage','anında'],'cmd'),
 compact:mk('/compact','Bağlamı sıkıştır.',['komut','token tasarrufu','anında'],'cmd'),
 clear:mk('/clear','Oturumu temizle.',['komut','—','anında'],'cmd'),
 caveman:mk('Caveman','mod',['mod','−%65 token','anında'],'mode'),
 'caveman-commit':mk('Caveman Commit','Son değişiklikler için kısa ve net bir Conventional Commits mesajı yaz.',['yerel','commit']),
 'caveman-review':mk('Caveman Review','Açık olan notu veya kodu incele, hataları ve eksikleri tek satırlık maddelerle listele.',['yerel','inceleme']),
 plan:mk('/plan','Bu konu veya proje için adım adım çalışma/uygulama planı, kritik formüller ve risk analizi çıkar.',['Sonnet','planlama']),
 goal:mk('/goal','Bu görevi eksiksiz tamamlayana kadar tüm alt adımları yürüterek çöz.',['Sonnet','uzun görev']),
 boost:mk('/boost','Derinlemesine matematiksel ve fiziksel analiz yap, tüm ara adımları doğrula.',['Opus','ağır görev']),
 graphify:mk('Graphify','Seçili kasa kaynakları arasındaki kavram ilişkilerini ve konu bağlantısını Mermaid diyagramı ile çıkar.',['graf','bağlantı']),
 'investigate-first':mk('Investigate First','Olası kök nedenleri kanıta göre sırala ve teşhis koy.',['Sonnet','analiz']),
 'surgical-patch':mk('Surgical Patch','En dar katmanda hedefe yönelik çözüm/yama üret.',['Sonnet','kod']),
 'safe-refactor':mk('Safe Refactor','Davranışı koruyarak yapıyı temizle ve düzenle.',['Sonnet','kod']),
 'lean-build':mk('Lean Build','Gereksiz karmaşıklıktan kaçınarak doğrudan çalışan sade çözüm üret.',['Sonnet','kod']),
 'verify-and-stop':mk('Verify & Stop','Çözümün kabul koşullarını ve sınır değerlerini doğrula.',['yerel','doğrulama']),
 'llm-council':mk('LLM Council','Problemi 4 farklı mühendislik perspektifinden değerlendirip sentez karara var.',['Opus','karar']),
 taste:mk('Taste (UI)','Görsel ve yapısal düzeni yüksek tasarım standartlarına göre iyileştir.',['Sonnet','tasarım']),
 'replica-skill':mk('Replica','Hedef sistemi alt bileşenlerine ayırarak yeniden kurgula.',['Sonnet','mimari'])
});
const GROUPS=[
 ['Mühendislik & Ders Araçları',[['ozet','≡','Aktif notu & kaynakları özetle',''],['fisle','▤','A4 iki sütun sınav föyü hazırla',''],['spice','∿','Devre analizi & SPICE netlist',''],['teardown','⬡','Sistem & kayıp mekanizması analizi',''],['whisper','◉','Ham metni ders notuna yapılandır',''],['pcb','▣','Donanım & şema blok taslağı','']]],
 ['Komutlar',[['browser','🌐','Açık Chrome penceresine bağlan',''],['usage','◔','Canlı agy /usage kotası','cmd'],['compact','⇲','Bağlamı sıkıştır','cmd'],['clear','⌫','Oturumu temizle','cmd'],['plan','☰','Adım adım çalışma planı',''],['goal','◎','Uzun hedef modu',''],['boost','⚡','Derin matematiksel analiz','']]],
 ['Modlar',[['caveman','🪨','Kısa, token tasarruflu yanıt','mode'],['caveman-commit','↳','Commit mesajı',''],['caveman-review','✓','Kısa inceleme','']]],
 ['Yetenekler',[['graphify','⌘','Kavram grafı çıkar',''],['investigate-first','?','Önce teşhis',''],['surgical-patch','✂','Dar yama',''],['safe-refactor','⟳','Güvenli refactor',''],['lean-build','▢','Sade geliştirme',''],['verify-and-stop','■','Doğrula ve dur',''],['llm-council','☷','Çok perspektifli karar','']]]
];
function buildSkills(q=''){
  const r=$('#skList'); if(!r)return; r.innerHTML='';
  GROUPS.forEach(([g,items])=>{
    const its=items.filter(i=>(i[0]+i[2]).toLowerCase().includes(q.toLowerCase())); if(!its.length)return;
    r.insertAdjacentHTML('beforeend',`<div class="grp">${g}</div>`);
    its.forEach(([k,ic,desc,kind])=>{
      const d=document.createElement('div'); d.className='skill s'; d.draggable=true; d.dataset.skill=k;
      d.innerHTML=`<div class="ic">${ic}</div><div>${k.startsWith('caveman')||kind==='cmd'||['plan','goal','boost','browser'].includes(k)?'/':''}${k}<small>${desc}</small></div><span class="tg">${kind==='cmd'?'KOMUT':kind==='mode'?'MOD':'ÇALIŞTIR'}</span>`;
      d.onclick=()=>{
        const targetSess=isAI(active)?active:(active==='studychat'?getStudySessId():'side_ai');
        if(kind==='cmd'||kind==='mode'){
          if(!isAI(active)) rtab('ai');
          aiSend(targetSess,'/'+k,k);
        }else{
          if(isAI(active)) aiSend(active,SK[k].prompt||('Skill: '+SK[k].h),k);
          else runSkill(k);
        }
      };
      r.appendChild(d);
    });
  });
}
$('#rb-skills').innerHTML='<input class="sk-search" id="skQ" placeholder="Skill ara… (ozet, fisle, spice, plan, caveman)"><div id="skList" style="display:flex;flex-direction:column;gap:8px"></div><div style="color:var(--mut);font-size:12px">Bir karta tıkladığında açık not ve seçili kasa kaynakları üzerinde <b>gerçek AI</b> ile çalışır; ya da kartı doğrudan nota sürükleyip bırakabilirsin.</div>';
$('#skQ').oninput=e=>buildSkills(e.target.value);
document.addEventListener('dragstart',e=>{const s=e.target.closest&&e.target.closest('.skill[data-skill]'); if(s)e.dataTransfer.setData('text/plain',s.dataset.skill);});
buildSkills();

/* ---------- VS Code IntelliSense Tarzı AI /Komut Otomatik Tamamlama ---------- */
const _aiSlash={el:null,inp:null,items:[],idx:0,start:0,end:0,q:''};
function getAiSlashCatalog(){
  const list=[], seen=new Set();
  GROUPS.forEach(([group,items])=>{
    items.forEach(([k,ic,desc,kind])=>{
      seen.add(k);
      list.push({key:k,ic:ic||'/',desc:desc||(SK[k]&&SK[k].h)||'',kind:kind||'skill',group});
    });
  });
  Object.keys(SK).forEach(k=>{
    if(seen.has(k)) return;
    const s=SK[k];
    list.push({key:k,ic:'✦',desc:s.h||'',kind:s.kind||'skill',group:'Diğer'});
  });
  return list;
}
function ensureAiSlashEl(){
  if(_aiSlash.el) return _aiSlash.el;
  const el=document.createElement('div');
  el.className='ai-slash';
  el.id='aiSlashMenu';
  document.body.appendChild(el);
  el.addEventListener('mousedown',e=>{
    const row=e.target.closest('.ai-slash-item');
    if(!row) return;
    e.preventDefault();
    const it=_aiSlash.items[+row.dataset.i];
    if(it) applyAiSlash(it);
  });
  document.addEventListener('mousedown',e=>{
    if(!_aiSlash.el||!_aiSlash.el.classList.contains('show')) return;
    if(!_aiSlash.el.contains(e.target)&&e.target!==_aiSlash.inp) closeAiSlash();
  });
  _aiSlash.el=el;
  return el;
}
function closeAiSlash(){
  if(_aiSlash.el) _aiSlash.el.classList.remove('show');
  _aiSlash.items=[];
  _aiSlash.idx=0;
}
function highlightSlashCmd(key,q){
  if(!q) return '/'+key;
  const idx=key.toLowerCase().indexOf(q);
  if(idx<0) return '/'+key;
  return '/'+key.slice(0,idx)+'<mark>'+key.slice(idx,idx+q.length)+'</mark>'+key.slice(idx+q.length);
}
function renderAiSlash(){
  const el=ensureAiSlashEl();
  const {items,idx,q,inp}=_aiSlash;
  if(!inp||!items.length){
    el.innerHTML=`<div class="ai-slash-empty">“/${q}” ile eşleşen komut yok</div>`;
  }else{
    const rows=items.map((it,i)=>{
      const tagCls=it.kind==='cmd'?'cmd':(it.kind==='mode'?'mode':'');
      const tagTxt=it.kind==='cmd'?'Komut':(it.kind==='mode'?'Mod':'Skill');
      return `<div class="ai-slash-item${i===idx?' on':''}" data-i="${i}"><span class="ai-slash-ic">${it.ic}</span><span class="ai-slash-cmd">${highlightSlashCmd(it.key,q)}</span><span class="ai-slash-desc">${it.desc}</span><span class="ai-slash-tag ${tagCls}">${tagTxt}</span></div>`;
    }).join('');
    el.innerHTML=`<div class="ai-slash-list">${rows}</div><div class="ai-slash-foot"><span>↑↓ gezin · Tab / Enter seç</span><span>Esc kapat</span></div>`;
  }
  el.classList.add('show');
  const box=inp.closest('.gem-box')||inp;
  const r=box.getBoundingClientRect();
  const w=Math.min(380,Math.max(280,r.width));
  el.style.width=w+'px';
  const mh=el.offsetHeight||240;
  const left=Math.max(8,Math.min(r.left,innerWidth-w-8));
  const topAbove=r.top-mh-6;
  el.style.left=left+'px';
  el.style.top=(topAbove>8?topAbove:Math.min(innerHeight-mh-8,r.bottom+6))+'px';
  const activeRow=el.querySelector('.ai-slash-item.on');
  if(activeRow) activeRow.scrollIntoView({block:'nearest'});
}
function syncAiSlash(inp){
  if(!inp) return;
  const pos=inp.selectionStart??inp.value.length;
  const before=inp.value.slice(0,pos);
  const m=before.match(/(?:^|\s)(\/([a-zA-Z0-9_-]*))$/);
  if(!m){ closeAiSlash(); return; }
  const q=(m[2]||'').toLowerCase();
  const catalog=getAiSlashCatalog();
  const matched=catalog.map(it=>{
    const kl=it.key.toLowerCase(), dl=it.desc.toLowerCase();
    let score=99;
    if(!q) score=0;
    else if(kl.startsWith(q)) score=0;
    else if(kl.includes(q)) score=1;
    else if(dl.includes(q)) score=2;
    return score<99?{it,score}:null;
  }).filter(Boolean).sort((a,b)=>a.score-b.score).map(x=>x.it);
  _aiSlash.inp=inp;
  _aiSlash.start=pos-m[1].length;
  _aiSlash.end=pos;
  _aiSlash.q=q;
  _aiSlash.items=matched;
  _aiSlash.idx=0;
  renderAiSlash();
}
function applyAiSlash(it){
  const inp=_aiSlash.inp; if(!inp) return;
  const suffix=(it.kind==='cmd'||it.kind==='mode')?'':' ';
  const ins='/'+it.key+suffix;
  const v=inp.value;
  inp.value=v.slice(0,_aiSlash.start)+ins+v.slice(_aiSlash.end);
  const nextPos=_aiSlash.start+ins.length;
  inp.focus();
  inp.setSelectionRange(nextPos,nextPos);
  autoGrow(inp);
  syncGemBoxState(inp);
  closeAiSlash();
}
function wireAiSlash(inp){
  if(!inp||inp.dataset.aiSlashWired) return;
  inp.dataset.aiSlashWired='1';
  inp.addEventListener('input',()=>syncAiSlash(inp));
  inp.addEventListener('click',()=>syncAiSlash(inp));
  inp.addEventListener('keydown',e=>{
    if(!_aiSlash.el||!_aiSlash.el.classList.contains('show')||_aiSlash.inp!==inp) return;
    const len=_aiSlash.items.length;
    if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); closeAiSlash(); return; }
    if(!len) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); e.stopImmediatePropagation(); _aiSlash.idx=(_aiSlash.idx+1)%len; renderAiSlash(); return; }
    if(e.key==='ArrowUp'){ e.preventDefault(); e.stopImmediatePropagation(); _aiSlash.idx=(_aiSlash.idx-1+len)%len; renderAiSlash(); return; }
    if(e.key==='Tab'||(e.key==='Enter'&&!e.shiftKey&&!e.isComposing)){
      e.preventDefault(); e.stopImmediatePropagation();
      applyAiSlash(_aiSlash.items[_aiSlash.idx]);
    }
  },true);
}

function aiInstant(id,k){
  const s=ai[id];
  if(k==='clear'){ api('/api/clear',{session:id}).catch(()=>{}); s.msgs=[{w:'a',h:'🧹 Oturum temizlendi. agy konuşma bağlamı sıfırlandı.'}]; s.attachments=[]; renderChatAttachments(id); }
  else if(k==='usage'){
    s.msgs.push({w:'a',h:'⏳ <code>agy -p "/usage"</code> üzerinden canlı kota sorgulanıyor…'});
    aiRefresh(id);
    loadQuota(true).then(()=>{
      const rowsHtml=quota.map(q=>{
        const mSub=q.models?`<div style="font-size:10.5px;color:var(--mut);margin-top:2px;font-weight:400">${escHtml(q.models)}</div>`:'';
        return q.u===null
          ?`<tr><td style="padding:4px 6px"><b>${escHtml(q.n)}</b>${mSub}</td><td style="padding:4px 6px"><span class="chip l">∞ Sınırsız</span></td><td style="padding:4px 6px">${escHtml(q.reset)}</td></tr>`
          :`<tr><td style="padding:4px 6px"><b>${escHtml(q.n)}</b>${mSub}</td><td style="padding:4px 6px"><span class="chip ${q.u>=100?'':(q.u>85?'':'c')}">${q.u>=100?'%0 · Tükendi':'%'+(100-q.u)+' kaldı'}</span></td><td style="padding:4px 6px">${escHtml(q.reset)}</td></tr>`;
      }).join('');
      const msgObj=s.msgs[s.msgs.length-1];
      const h=`<b>📊 Canlı Antigravity (<code>/usage</code>) Kota Durumu</b><table style="width:100%;margin-top:8px;border-collapse:collapse;font:12px var(--mono)"><thead><tr style="border-bottom:1px solid var(--line);color:var(--mut);text-align:left"><th style="padding:4px 6px">Havuz / Modeller</th><th style="padding:4px 6px">Kalan Hak</th><th style="padding:4px 6px">Pencere &amp; Yenilenme</th></tr></thead><tbody>${rowsHtml}</tbody></table><div class="route"><span class="chip c">agy /usage</span><span>Canlı sunucu kotası senkronize edildi</span></div>`;
      if(msgObj) msgObj.h=h; else s.msgs.push({w:'a',h});
      api('/api/chats',{session:id,w:'a',h}).catch(()=>{});
      aiRefresh(id);
    });
    return;
  }
  else if(k==='compact'){
    if(s.running||s.pending){ toast('Bu oturum şu an meşgul'); return; }
    const prevTitle=(!isSideId(id)&&isAI(id))?getAiSessionTitle(id):'';
    const recent=s.msgs.filter(m=>m.w==='me').map(m=>stripHtmlCompact(m.raw||m.h)).filter(Boolean).slice(-5);
    const prevMsgs=[...s.msgs];
    s.running=true; s.step='Konuşma özeti çıkarılıyor…';
    s.msgs=[{w:'a',compact:true,h:'⏳ <b>Bağlam sıkıştırılıyor…</b> Konuşma özeti çıkarılıp yeni temiz oturum hazırlanıyor.'}];
    if(prevTitle&&prevTitle!=='Yeni Sohbet') touchAiMeta(id,{title:prevTitle});
    aiRefresh(id);
    api('/api/compact',{session:id,recent_msgs:recent}).then(res=>{
      const sumHtml=res.real?mdToHtml(res.summary||''):`<div style="margin-top:6px">${escHtml(res.summary||'(henüz içerik yok)')}</div>`;
      const chipCls=res.real?'c':'l';
      const badge=res.real?'yeni temiz oturum hazır':'yerel özet';
      const h=`🗜 <b>Bağlam sıkıştırıldı.</b>${sumHtml}<div class="route"><span class="chip ${chipCls}">${escHtml(res.label||'özetleyici')}</span><span>${badge}</span></div>`;
      s.msgs=[{w:'a',compact:true,h,raw:res.summary||''}];
      s.running=false; s.step='';
      api('/api/chats',{session:id,w:'a',h}).catch(()=>{});
      if(prevTitle&&prevTitle!=='Yeni Sohbet') touchAiMeta(id,{title:prevTitle});
      if(res.real) loadQuota(true);
      aiRefresh(id);
    }).catch(e=>{
      s.msgs=prevMsgs;
      s.msgs.push({w:'a',h:`⚠️ Bağlam sıkıştırılamadı: ${escHtml(e.message||'bilinmeyen hata')}`});
      s.running=false; s.step='';
      aiRefresh(id);
    });
    return;
  } else if(k==='caveman'){
    s.caveman=!s.caveman;
    s.msgs.push({w:'a',h:s.caveman?'🪨 Caveman açık. Yanıt kısa. Teknik içerik aynı.':'Caveman kapalı. Normal yanıt.'});
  }
  aiRefresh(id);
}

/* ---------- Kullanım & kalan haklar ---------- */
let quota=[{n:'Yükleniyor…',u:0,reset:'',models:''}];
let _lastQuotaSyncAt=0;
const fmtReset=q=>q.detail?q.detail:(q.cloud?(q.used_pct>=100?`Tükendi · ${Math.floor(q.reset_s/3600)} sa ${Math.floor(q.reset_s%3600/60)} dk sonra yenilenir`:(q.count?`${q.count}/${q.limit} istek · ${Math.floor(q.reset_s/3600)} sa ${Math.floor(q.reset_s%3600/60)} dk sonra yenilenir`:`0/${q.limit} istek`)):`sınırsız · ${q.count} istek`);
function applyQuota(rows){ _lastQuotaSyncAt=Date.now(); quota=rows.map(q=>({n:q.label,u:q.used_pct,reset:fmtReset(q),models:q.models||'',group:q.group||q.id,source:q.source||''})); renderUsage(); }
async function loadQuota(force=false){ try{ applyQuota(await api(force?'/api/quota?refresh=1':'/api/quota')); return true; }catch(e){ return false; } }
async function refreshQuota(ev){ ev&&ev.stopPropagation(); const b=$('#urefresh'); if(b){b.disabled=true;b.textContent='⟳ …';} const ok=await loadQuota(true); const b2=$('#urefresh'); if(b2){b2.disabled=false;b2.textContent=ok?'✓ Güncellendi':'⚠ Hata';setTimeout(()=>{const b3=$('#urefresh');if(b3)b3.textContent='⟳ Yenile';},1500);} }
function useQuota(){}
function quotaRows(){
  return quota.map(q=>{
    if(q.u===null){
      return `<div class="qrow"><div class="l"><span>${escHtml(q.n)}</span><b style="color:var(--ok)">∞</b></div><div class="bar g"><i style="width:100%"></i></div><small>${escHtml(q.reset)}</small></div>`;
    }
    const rem=Math.max(0,Math.min(100,Math.round(100-q.u)));
    return `<div class="qrow"><div class="l"><span>${escHtml(q.n)}</span><b style="${rem<=0?'color:var(--err)':(rem<15?'color:var(--cu)':'')}">${rem<=0?'Tükendi':'%'+rem+' kaldı'}</b></div><div class="bar ${rem<15?'w':''}"><i style="width:${rem}%"></i></div><small>${escHtml(q.reset)}</small>${q.models?`<small class="qmodels" title="${escAttr(q.models)}">${escHtml(q.models)}</small>`:''}</div>`;
  }).join('');
}
function renderUsage(){
  const cloud=[]; const seenGroups=new Set();
  quota.forEach(q=>{ if(q.u!==null){ const gk=q.group||q.n; if(!seenGroups.has(gk)){ seenGroups.add(gk); cloud.push(q); } } });
  const left=cloud.length?Math.round(cloud.reduce((a,q)=>a+(100-q.u),0)/cloud.length):100;
  $('#uring').style.setProperty('--p',left); $('#uringTxt').textContent=left+'%';
  const liveTag=quota.some(q=>q.source==='agy_cli')?' <span class="chip c" style="font-size:9.5px;padding:1px 5px;text-transform:none">agy /usage</span>':'';
  $('#upop').innerHTML=`<h4><span>AI kullanımı${liveTag}</span><button class="urefresh" id="urefresh" title="agy /usage ile kotaları yenile" onclick="refreshQuota(event)">⟳ Yenile</button></h4>${quotaRows()}
   <div style="font:11px var(--mono);color:var(--mut);border-top:1px solid var(--line);padding-top:8px">Kota havuzları doğrudan <code>agy -p "/usage"</code> üzerinden otomatik okunur ve 5 dk'da bir kendini günceller.</div>`;
  const ql=$('#quotaList'); if(ql)ql.innerHTML=quotaRows();
}
(()=>{const rr=$('#rb-router'); rr.querySelectorAll('.quota').forEach(e=>e.remove()); rr.querySelector('.ph').insertAdjacentHTML('afterend','<div id="quotaList"></div>');})();
$('#uring').onclick=e=>{e.stopPropagation();$('#mpop')?.classList.remove('show');$('#ppop')?.classList.remove('show');const opening=!$('#upop').classList.contains('show');$('#upop').classList.toggle('show');if(opening)loadQuota();};
document.addEventListener('click',e=>{if(!e.target.closest('#upop'))$('#upop').classList.remove('show');});
setInterval(()=>{ if(!document.hidden) loadQuota(false); }, 300000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && Date.now()-_lastQuotaSyncAt>300000) loadQuota(false); });
loadQuota(); loadHealth(); loadLog(); startEvents();

/* ---------- Tema Yönetimi & Hızlı Seçici ---------- */
const THEMES = [
  { id: 'obsidian', name: 'Obsidian Kehribar', desc: 'Varsayılan karanlık odak', dot: '#e0a458', cat: 'dark' },
  { id: 'forest', name: 'Zümrüt & Adaçayı', desc: 'Göz dinlendirici gece yeşili', dot: '#52b788', cat: 'dark' },
  { id: 'nord', name: 'Nord Buzul Mavisi', desc: 'Soğuk & sakin gece', dot: '#88c0d0', cat: 'dark' },
  { id: 'solarized', name: 'Solarized Gece', desc: 'Okyanus derinliği ve turkuaz', dot: '#2aa198', cat: 'dark' },
  { id: 'tokyo', name: 'Tokyo Night', desc: 'Modern mavi-mor siber tonlar', dot: '#7aa2f7', cat: 'dark' },
  { id: 'gruvbox', name: 'Gruvbox Retro', desc: 'Sıcak sepyamsı koyu mod', dot: '#d79921', cat: 'dark' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', desc: 'Canlı pembe & mor kontrast', dot: '#f72585', cat: 'dark' },
  { id: 'mono-dark', name: 'Saf Siyah-Beyaz', desc: 'Sade, Obsidian & NotebookLM tarzı', dot: '#000000', cat: 'dark' },
  { id: 'mono-light', name: 'Saf Beyaz-Siyah (Açık)', desc: 'Sade kâğıt beyazı, siyah vurgu', dot: '#ffffff', cat: 'light' },
  { id: 'eink', name: 'E-Ink Kağıt (Açık)', desc: 'Sıfır parlama, kitap okuma', dot: '#1b4a2c', cat: 'light' },
  { id: 'sepia', name: 'Papirüs Sepya (Açık)', desc: 'Yumuşak sıcak gündüz modu', dot: '#874218', cat: 'light' }
];

let curTheme = localStorage.getItem('agydesk_theme') || 'obsidian';

function applyTheme(themeId, persist=true) {
  const t = THEMES.find(x => x.id === themeId) || THEMES[0];
  curTheme = t.id;
  document.body.setAttribute('data-theme', curTheme);
  document.documentElement.style.colorScheme = t.cat === 'light' ? 'light' : 'dark';
  if (persist) { try{ sessionStorage.setItem('agydesk_win_theme',curTheme); }catch(e){} persistUiState({ agydesk_theme: curTheme }, true); saveSessionTabs(); }
  noteDomCache.clear();
  renderThemePop();
  if ($('#spop')?.classList.contains('show')) renderSettingsPop();
  if (active === 'sim' || active === 'trafo') renderMain();
  else if (active === 'cal') renderCal($('#main'), false);
  if (window.mermaid) {
    runMermaid('#mdView .mermaid, #chat .mermaid, #scChat .mermaid, #aichat .mermaid, #outs .mermaid, #rb-studio .mermaid', true);
  }
}

function renderThemePop() {
  const pop = $('#tpop');
  if (!pop) return;
  const darks = THEMES.filter(t => t.cat === 'dark');
  const lights = THEMES.filter(t => t.cat === 'light');
  const btn = t => `
    <button class="tbtn ${t.id === curTheme ? 'active' : ''}" onclick="applyTheme('${t.id}')" title="${t.desc}">
      <span class="tdot" style="background:${t.dot}"></span>
      <div style="min-width:0;overflow:hidden">
        <div class="tbtn-name">${t.name}</div>
        <div class="tbtn-desc">${t.desc}</div>
      </div>
    </button>`;
  pop.innerHTML = `
    <div class="tpop-head">
      <span>🎨 AgyDesk Temaları</span>
      <span style="font-size:10.5px;color:var(--cu);font-weight:600">${THEMES.length} Tema</span>
    </div>
    <div class="tpop-sec">🌙 Karanlık Odak (${darks.length})</div>
    <div class="tgrid">
      ${darks.map(btn).join('')}
    </div>
    <div class="tpop-sec" style="margin-top:6px">☀️ Açık & Kağıt Odak (${lights.length})</div>
    <div class="tgrid">
      ${lights.map(btn).join('')}
    </div>
  `;
}

function openThemePop() {
  const pop = $('#tpop');
  if (!pop) return;
  $('#fpop')?.classList.remove('show');
  $('#mpop')?.classList.remove('show');
  $('#ppop')?.classList.remove('show');
  renderThemePop();
  pop.classList.toggle('show');
}

function initThemes() {
  applyTheme(curTheme, false);
  const btn = $('#themeBtn');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); openThemePop(); };
  const tp = $('#tpop');
  if (tp) tp.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tpop') && !e.target.closest('#themeBtn')) {
      $('#tpop')?.classList.remove('show');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#tpop')?.classList.remove('show');
  });
}

/* ---------- Metin ayarları (Notion tarzı) ---------- */
const FONTS=[
  {id:'sans',n:'Varsayılan',v:"'Instrument Sans',system-ui,sans-serif",s:'Ag'},
  {id:'serif',n:'Serif',v:"'Lora',Georgia,Cambria,'Times New Roman',serif",s:'Ag'},
  {id:'mono',n:'Mono',v:"'JetBrains Mono',ui-monospace,Consolas,monospace",s:'Ag'}
];
const TZ_MIN=0.8, TZ_MAX=1.8;
let curFont=localStorage.getItem('agydesk_font')||'sans';
let curTz=parseFloat(localStorage.getItem('agydesk_tz'))||1;
let appliedTz=null;
let fullW=localStorage.getItem('agydesk_fullw')==='1';
const TZ_SCROLL_SEL='.main,.main .aichat,.main .sc-body,.main .pptx-stage,.main .img-studio';
const TZ_BLK_SEL='p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,hr,.msg-row,.sc-msg,.out,.callout,.katex-display';
let _tzSaveTimer=null;
let _mainAnchor=null;
let _mainAnchorTimer=null;
function probeCenterAnchor(el){
  const sh=el.scrollHeight, ch=el.clientHeight;
  if(sh<=ch+4||el.scrollTop<=2) return null;
  const r=el.getBoundingClientRect();
  if(r.width<40||r.height<40) return null;
  const midY=r.top+r.height*0.5;
  const hit=document.elementFromPoint(r.left+r.width*0.5,midY);
  let blk=null, offVp=0;
  if(hit&&el.contains(hit)){
    const cand=hit.closest(TZ_BLK_SEL)||hit;
    if(cand&&cand!==el&&el.contains(cand)){
      blk=cand;
      offVp=cand.getBoundingClientRect().top-midY;
    }
  }
  return {el,blk,offVp,ratio:(el.scrollTop+ch*0.5)/sh};
}
function applyCenterAnchor(s){
  if(!s||!s.el||!s.el.isConnected) return;
  const el=s.el, sh=el.scrollHeight, ch=el.clientHeight;
  if(sh<=ch) return;
  if(s.blk&&s.blk.isConnected&&el.contains(s.blk)){
    const r=el.getBoundingClientRect();
    const midY=r.top+r.height*0.5;
    const newOffVp=s.blk.getBoundingClientRect().top-midY;
    const scale=(el.classList.contains('main')||+curTz===1)?1:curTz;
    const dy=(newOffVp-s.offVp)/scale;
    if(Number.isFinite(dy)){
      el.scrollTop=Math.max(0,Math.min(sh-ch,el.scrollTop+dy));
      return;
    }
  }
  el.scrollTop=Math.max(0,Math.min(sh-ch,s.ratio*sh-ch*0.5));
}
function captureTzCenters(){
  const snaps=[];
  document.querySelectorAll(TZ_SCROLL_SEL).forEach(el=>{
    const s=probeCenterAnchor(el);
    if(s) snaps.push(s);
  });
  return snaps;
}
function restoreTzCenters(snaps){
  for(const s of snaps) applyCenterAnchor(s);
}
function initMainResizeAnchor(){
  const main=document.querySelector('.main');
  if(!main||main._tzResizeInit) return;
  main._tzResizeInit=true;
  let lastW=main.clientWidth;
  const refreshAnchor=()=>{
    _mainAnchorTimer=null;
    _mainAnchor=probeCenterAnchor(main);
  };
  main.addEventListener('scroll',()=>{
    if(!_mainAnchorTimer) _mainAnchorTimer=setTimeout(refreshAnchor,100);
  },{passive:true});
  if(typeof ResizeObserver!=='undefined'){
    const ro=new ResizeObserver(()=>{
      const w=main.clientWidth;
      if(Math.abs(w-lastW)<2) return;
      lastW=w;
      if(_mainAnchor&&_mainAnchor.el===main){
        applyCenterAnchor(_mainAnchor);
      }
    });
    ro.observe(main);
  }
}
function applyTextPrefs(persist=true){
  curTz=Math.min(TZ_MAX,Math.max(TZ_MIN,Math.round(curTz*20)/20));
  const tzChanged=appliedTz!==null&&Math.abs(curTz-appliedTz)>1e-6;
  const snaps=tzChanged?captureTzCenters():[];
  const f=FONTS.find(x=>x.id===curFont)||FONTS[0];
  document.documentElement.style.setProperty('--cfont',f.v);
  document.documentElement.style.setProperty('--tz',curTz);document.documentElement.classList.toggle('tz-on',+curTz!==1);
  document.body.classList.toggle('fw-full',fullW);
  appliedTz=curTz;
  if(snaps.length){
    restoreTzCenters(snaps);
    const main=document.querySelector('.main');
    if(main) _mainAnchor=probeCenterAnchor(main);
  }
  if(persist){
    clearTimeout(_tzSaveTimer);
    _tzSaveTimer=setTimeout(()=>{
      persistUiState({
        agydesk_font:f.id,
        agydesk_tz:String(curTz),
        agydesk_fullw:fullW?'1':'0'
      },true);
    },250);
  }
  const pop=$('#fpop');
  if(pop&&pop.classList.contains('show')) renderFontPop();
}
function setFont(id){curFont=id;applyTextPrefs(true);}
function setTz(v){curTz=+v;applyTextPrefs(true);}
function stepTz(d){curTz+=d*0.1;applyTextPrefs(true);}
function toggleFullW(){fullW=!fullW;applyTextPrefs(true);}
function renderFontPop(){
  const pop=$('#fpop'); if(!pop)return;
  pop.innerHTML=`
    <div class="tpop-head"><span>Aa Yazı ayarları</span><span style="font-size:10.5px;color:var(--cu)">%${Math.round(curTz*100)}</span></div>
    <div class="tpop-sec">Yazı tipi</div>
    <div class="fgrid">${FONTS.map(f=>`<button class="fbtn ${f.id===curFont?'active':''}" style="font-family:${f.v}" onclick="setFont('${f.id}')">${f.s}<small>${f.n}</small></button>`).join('')}</div>
    <div class="tpop-sec" style="margin-top:6px">Yazı boyutu</div>
    <div class="fsize"><button onclick="stepTz(-1)" title="Küçült (Ctrl −)">A−</button>
      <input type="range" min="${TZ_MIN}" max="${TZ_MAX}" step="0.05" value="${curTz}" oninput="setTz(this.value)">
      <button onclick="stepTz(1)" title="Büyüt (Ctrl +)">A+</button>
      <button onclick="setTz(1)" title="Sıfırla (Ctrl 0)">⟲</button></div>
    <div class="frow" style="margin-top:6px"><span>Tam genişlik</span><button class="fsw ${fullW?'on':''}" onclick="toggleFullW()" title="Not sayfasını tüm genişliğe yay"></button></div>
    <div style="font:11px var(--mono);color:var(--mut)">Kısayol: Ctrl + / Ctrl − / Ctrl 0</div>`;
}
function initTextPrefs(){
  applyTextPrefs(false);
  initMainResizeAnchor();
  const b=$('#fontBtn');
  if(b) b.onclick=e=>{e.stopPropagation();$('#tpop')?.classList.remove('show');$('#mpop')?.classList.remove('show');$('#ppop')?.classList.remove('show');renderFontPop();$('#fpop').classList.toggle('show');};
  const fp=$('#fpop'); if(fp) fp.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',e=>{ if(!e.target.closest('#fontBtn')) $('#fpop')?.classList.remove('show'); });
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||e.altKey) return;
    if(e.key==='+'||e.key==='='){e.preventDefault();stepTz(1);}
    else if(e.key==='-'||e.key==='_'){e.preventDefault();stepTz(-1);}
    else if(e.key==='0'){e.preventDefault();setTz(1);}
  });
  document.addEventListener('wheel',e=>{ if(e.ctrlKey){e.preventDefault();stepTz(e.deltaY<0?1:-1);} },{passive:false});
}

/* ---------- Ayarlar & İvme Kısıtlı Yumuşak Kaydırma (AgySmoothScroll) ---------- */
const SCROLL_PRESETS={
  'native':     { name:'Doğal',       sub:'Tarayıcı varsayılanı', maxSpeed:1800, maxAccel:5200, gain:6.8, mult:1.0 },
  'lerp':       { name:'Saf Lerp',    sub:'Lenis tarzı akış',     maxSpeed:2400, maxAccel:99999,gain:7.5, mult:1.0 },
  'accel-fast': { name:'İvme · Akıcı',sub:'Sıfır geri sekme',     maxSpeed:1800, maxAccel:5200, gain:6.8, mult:1.0 },
  'accel-cine': { name:'İvme · Sinematik', sub:'Uzun S-eğrisi',   maxSpeed:1350, maxAccel:2600, gain:4.4, mult:1.15 }
};
const SCROLL_CFG=(()=>{
  const def={ mode:'accel-fast', mult:1.0, bypassTouchpad:true };
  try{
    const raw=JSON.parse(localStorage.getItem('agydesk_scroll_cfg')||'null');
    if(raw&&SCROLL_PRESETS[raw.mode]) return Object.assign(def,raw);
  }catch(_){}
  return def;
})();
const _smoothStates=new WeakMap();

function saveScrollCfg(){
  try{ localStorage.setItem('agydesk_scroll_cfg',JSON.stringify(SCROLL_CFG)); }catch(_){}
}
function setScrollMode(mode){
  if(!SCROLL_PRESETS[mode]) return;
  SCROLL_CFG.mode=mode;
  SCROLL_CFG.mult=SCROLL_PRESETS[mode].mult;
  saveScrollCfg();
  renderSettingsPop();
}
function setScrollMult(v){
  SCROLL_CFG.mult=Math.max(0.5,Math.min(2.2,parseFloat(v)||1.0));
  saveScrollCfg();
  const lbl=$('#spopMultLbl');
  if(lbl) lbl.textContent=SCROLL_CFG.mult.toFixed(1)+'x';
}
function toggleScrollTouchpad(){
  SCROLL_CFG.bypassTouchpad=!SCROLL_CFG.bypassTouchpad;
  saveScrollCfg();
  renderSettingsPop();
}
function renderSettingsPop(){
  const pop=$('#spop'); if(!pop) return;
  const cur=SCROLL_PRESETS[SCROLL_CFG.mode]||SCROLL_PRESETS['accel-fast'];
  const darks=THEMES.filter(t=>t.cat==='dark');
  const lights=THEMES.filter(t=>t.cat==='light');
  const tBtn=t=>`
    <button class="tbtn ${t.id===curTheme?'active':''}" onclick="applyTheme('${t.id}')" title="${t.desc}">
      <span class="tdot" style="background:${t.dot}"></span>
      <div style="min-width:0;overflow:hidden">
        <div class="tbtn-name">${t.name}</div>
        <div class="tbtn-desc">${t.desc}</div>
      </div>
    </button>`;
  pop.innerHTML=`
    <div class="tpop-head"><span>⚙ Ayarlar</span><span style="font-size:10.5px;color:var(--cu)">${cur.name}</span></div>
    <div class="tpop-sec">Kaydırma akışı (Fare tekerleği)</div>
    <div class="sgrid">${Object.entries(SCROLL_PRESETS).map(([k,p])=>
      `<button class="sbtn ${k===SCROLL_CFG.mode?'active':''}" onclick="setScrollMode('${k}')">${p.name}<small>${p.sub}</small></button>`
    ).join('')}</div>
    <div class="tpop-sec" style="margin-top:8px;display:flex;justify-content:space-between"><span>Kaydırma adımı</span><span id="spopMultLbl" style="color:var(--cu)">${SCROLL_CFG.mult.toFixed(1)}x</span></div>
    <div class="fsize">
      <input type="range" min="0.5" max="2.2" step="0.1" value="${SCROLL_CFG.mult}" oninput="setScrollMult(this.value)" style="flex:1">
      <button onclick="setScrollMult(1);renderSettingsPop()" title="Varsayılan (1.0x)">⟲</button>
    </div>
    <div class="frow" style="margin-top:6px"><span>Touchpad pas geç</span><button class="fsw ${SCROLL_CFG.bypassTouchpad?'on':''}" onclick="toggleScrollTouchpad()" title="Dizüstü dokunmatik yüzeyinde doğal kaydırmayı koru"></button></div>
    <div style="font:10.5px var(--mono);color:var(--mut);margin-top:4px">Shift + Tekerlek: Yatay akış (Excel)</div>
    <div class="tpop-sec" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line)">Pil göstergesi</div>
    <div class="sgrid">
      <button class="sbtn ${batteryVisMode==='unplugged'?'active':''}" onclick="setBatteryVisMode('unplugged')">Sadece pilde<small>Prizde gizle</small></button>
      <button class="sbtn ${batteryVisMode==='always'?'active':''}" onclick="setBatteryVisMode('always')">Her zaman<small>Prizde de göster</small></button>
    </div>
    <div class="tpop-sec" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line)">🌙 Karanlık Temalar (${darks.length})</div>
    <div class="tgrid">${darks.map(tBtn).join('')}</div>
    <div class="tpop-sec" style="margin-top:6px">☀️ Açık & Kağıt Temalar (${lights.length})</div>
    <div class="tgrid">${lights.map(tBtn).join('')}</div>`;
}
function _agyIsScrollable(el,axis){
  const cs=getComputedStyle(el);
  const ov=axis==='y'?cs.overflowY:cs.overflowX;
  if(ov!=='auto'&&ov!=='scroll') return false;
  return axis==='y'?(el.scrollHeight>el.clientHeight+1):(el.scrollWidth>el.clientWidth+1);
}
function _agyCanScrollDir(el,dx,dy){
  const canY=dy!==0&&_agyIsScrollable(el,'y')&&((dy>0&&el.scrollTop<el.scrollHeight-el.clientHeight-1)||(dy<0&&el.scrollTop>1));
  const canX=dx!==0&&_agyIsScrollable(el,'x')&&((dx>0&&el.scrollLeft<el.scrollWidth-el.clientWidth-1)||(dx<0&&el.scrollLeft>1));
  return canY||canX;
}
function _agyFindScrollTarget(startEl,dx,dy){
  let cur=startEl;
  while(cur&&cur!==document.body&&cur!==document.documentElement){
    if(cur.dataset&&cur.dataset.noSmoothScroll==='1') return null;
    if(_agyCanScrollDir(cur,dx,dy)) return cur;
    cur=cur.parentElement;
  }
  return null;
}
function _agyStepSmooth(el,ts){
  const st=_smoothStates.get(el);
  if(!st) return;
  const now=ts||performance.now();
  const dt=Math.min(0.05,Math.max(0.004,(now-(st.lastTs||now))/1000));
  st.lastTs=now;
  if(Math.abs(el.scrollTop-st.lastAppliedY)>3||Math.abs(el.scrollLeft-st.lastAppliedX)>3){
    st.raf=0; st.velX=st.velY=0; return;
  }
  const maxY=Math.max(0,el.scrollHeight-el.clientHeight);
  const maxX=Math.max(0,el.scrollWidth-el.clientWidth);
  st.targetY=Math.max(0,Math.min(maxY,st.targetY));
  st.targetX=Math.max(0,Math.min(maxX,st.targetX));
  const forceCine=el.classList&&el.classList.contains('gprog');
  const mode=forceCine?'accel-cine':SCROLL_CFG.mode;
  const p=SCROLL_PRESETS[mode]||SCROLL_PRESETS['accel-fast'];

  if(mode==='lerp'){
    const alpha=1-Math.exp(-p.gain*dt);
    const ny=st.posY+(st.targetY-st.posY)*alpha;
    const nx=st.posX+(st.targetX-st.posX)*alpha;
    st.velY=(ny-st.posY)/dt; st.velX=(nx-st.posX)/dt;
    st.posY=ny; st.posX=nx;
  }else{
    const stepAxis=(pos,target,vel,maxBound)=>{
      const dist=target-pos, absD=Math.abs(dist), sgn=dist>=0?1:-1;
      const vBrake=Math.sqrt(2*p.maxAccel*0.82*absD);
      const des=sgn*Math.min(p.maxSpeed,absD*p.gain,vBrake);
      const maxDv=p.maxAccel*dt;
      let nVel=vel+Math.max(-maxDv,Math.min(maxDv,des-vel));
      let nPos=pos+nVel*dt;
      if((dist>0&&nPos>target)||(dist<0&&nPos<target)){ nPos=target; nVel=0; }
      return [Math.max(0,Math.min(maxBound,nPos)),nVel];
    };
    [st.posY,st.velY]=stepAxis(st.posY,st.targetY,st.velY,maxY);
    [st.posX,st.velX]=stepAxis(st.posX,st.targetX,st.velX,maxX);
  }

  const doneY=Math.abs(st.targetY-st.posY)<0.6&&Math.abs(st.velY)<8;
  const doneX=Math.abs(st.targetX-st.posX)<0.6&&Math.abs(st.velX)<8;
  if(doneY&&doneX){
    st.posY=st.targetY; st.posX=st.targetX; st.velY=st.velX=0;
    el.scrollTop=st.posY; el.scrollLeft=st.posX;
    st.lastAppliedY=el.scrollTop; st.lastAppliedX=el.scrollLeft;
    st.raf=0; st.lastTs=0; return;
  }
  el.scrollTop=st.posY; el.scrollLeft=st.posX;
  st.lastAppliedY=el.scrollTop; st.lastAppliedX=el.scrollLeft;
  st.raf=requestAnimationFrame(t=>_agyStepSmooth(el,t));
}
function initSmoothScroll(){
  const sb=$('#settingsBtn');
  if(sb) sb.onclick=e=>{
    e.stopPropagation();
    $('#tpop')?.classList.remove('show');
    $('#fpop')?.classList.remove('show');
    $('#mpop')?.classList.remove('show');
    $('#ppop')?.classList.remove('show');
    renderSettingsPop();
    $('#spop')?.classList.toggle('show');
  };
  const sp=$('#spop');
  if(sp) sp.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',e=>{ if(!e.target.closest('#settingsBtn')) $('#spop')?.classList.remove('show'); });

  document.addEventListener('wheel',e=>{
    const inGprog=Boolean(e.target.closest?.('.gprog'));
    if(e.ctrlKey||e.metaKey||(SCROLL_CFG.mode==='native'&&!inGprog)) return;
    let dx=e.deltaX, dy=e.deltaY;
    if(e.deltaMode===1){ dx*=36; dy*=36; }
    else if(e.deltaMode===2){ dx*=400; dy*=400; }
    if(e.shiftKey&&dx===0&&dy!==0){ dx=dy; dy=0; }
    if(dx===0&&dy===0) return;

    const isTouchpad=e.deltaMode===0&&Math.abs(dy)>0&&Math.abs(dy)<40&&Math.abs(dy)%10!==0;
    if(SCROLL_CFG.bypassTouchpad&&isTouchpad) return;

    const target=_agyFindScrollTarget(e.target,dx,dy);
    if(!target) return;

    e.preventDefault();
    let st=_smoothStates.get(target);
    if(!st){
      st={posX:target.scrollLeft,posY:target.scrollTop,targetX:target.scrollLeft,targetY:target.scrollTop,velX:0,velY:0,raf:0,lastTs:0,lastAppliedX:target.scrollLeft,lastAppliedY:target.scrollTop};
      _smoothStates.set(target,st);
    }
    if(!st.raf){
      st.posX=target.scrollLeft; st.posY=target.scrollTop;
      st.targetX=target.scrollLeft; st.targetY=target.scrollTop;
      st.lastAppliedX=target.scrollLeft; st.lastAppliedY=target.scrollTop;
      st.velX=0; st.velY=0; st.lastTs=performance.now();
    }
    const maxY=Math.max(0,target.scrollHeight-target.clientHeight);
    const maxX=Math.max(0,target.scrollWidth-target.clientWidth);
    const mult=target.classList.contains('gprog')?SCROLL_PRESETS['accel-cine'].mult:SCROLL_CFG.mult;
    st.targetY=Math.max(0,Math.min(maxY,st.targetY+dy*mult));
    st.targetX=Math.max(0,Math.min(maxX,st.targetX+dx*mult));
    if(!st.raf) st.raf=requestAnimationFrame(t=>_agyStepSmooth(target,t));
  },{passive:false});
}

/* ---------- Sol ray: sürükle-bırak ile sıralama ---------- */
function applyRailOrder(saved){
  const rail=document.querySelector('.rail');
  if(!rail||!Array.isArray(saved)||!saved.length) return;
  const btns=[...rail.querySelectorAll('.rbtn,.rail-pomo')];
  const keyOf=(b,i)=>b.dataset.k||(b.dataset.k=b.dataset.mode||b.id||(i===0?'attach':'newnote'));
  btns.forEach((b,i)=>keyOf(b,i));
  const sp=rail.querySelector('.sp'), uring=rail.querySelector('.uring');
  const map={sp};
  btns.forEach(b=>{ map[b.dataset.k]=b; });
  const placed=new Set();
  saved.forEach(k=>{
    if(map[k]&&!placed.has(k)){
      rail.insertBefore(map[k],uring);
      placed.add(k);
    }
  });
  if(sp&&!placed.has('sp')) rail.insertBefore(sp,uring);
  btns.forEach(b=>{
    if(!placed.has(b.dataset.k)) rail.insertBefore(b,uring);
  });
  if(uring) rail.insertBefore(uring,null);
  syncOpenRailPops();
}
function initRailDrag(){
  const rail=document.querySelector('.rail'); if(!rail) return;
  const btns=[...rail.querySelectorAll('.rbtn,.rail-pomo')];
  const keyOf=(b,i)=>b.dataset.k||(b.dataset.k=b.dataset.mode||b.id||(i===0?'attach':'newnote'));
  btns.forEach((b,i)=>keyOf(b,i));
  const sp=rail.querySelector('.sp');
  try{
    const saved=JSON.parse(localStorage.getItem('agydesk_rail')||'null');
    if(Array.isArray(saved)) applyRailOrder(saved);
  }catch(e){}
  const save=()=>{
    const order=[...rail.querySelectorAll('.rbtn,.rail-pomo,.sp')].map(b=>b.classList.contains('sp')?'sp':b.dataset.k);
    persistUiState({agydesk_rail:JSON.stringify(order)},true);
  };
  let drag=null;
  btns.forEach(b=>{
    b.draggable=true;
    b.addEventListener('dragstart',e=>{ drag=b; b.classList.add('rdrag'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/rail',b.dataset.k); });
    b.addEventListener('dragend',()=>{ b.classList.remove('rdrag'); rail.querySelectorAll('.rover-t,.rover-b').forEach(x=>x.classList.remove('rover-t','rover-b')); drag=null; });
    b.addEventListener('dragover',e=>{
      if(!drag||drag===b) return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      const r=b.getBoundingClientRect(), top=e.clientY<r.top+r.height/2;
      b.classList.toggle('rover-t',top); b.classList.toggle('rover-b',!top);
    });
    b.addEventListener('dragleave',()=>b.classList.remove('rover-t','rover-b'));
    b.addEventListener('drop',e=>{
      if(!drag||drag===b) return;
      e.preventDefault();
      const r=b.getBoundingClientRect(), top=e.clientY<r.top+r.height/2;
      rail.insertBefore(drag, top?b:b.nextSibling);
      b.classList.remove('rover-t','rover-b');
      save();
      syncOpenRailPops();
    });
  });
  if(sp){
    sp.addEventListener('dragover',e=>{
      if(!drag) return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
    });
    sp.addEventListener('drop',e=>{
      if(!drag) return;
      e.preventDefault();
      const r=sp.getBoundingClientRect(), top=e.clientY<r.top+r.height/2;
      rail.insertBefore(drag, top?sp:sp.nextSibling);
      save();
      syncOpenRailPops();
    });
  }
}

/* ---------- Üst köşe saati ---------- */
const CLOCK_FMTS=['hm','hmd','hms'];
let clockFmt=localStorage.getItem('agydesk_clock_fmt')||'hm';
let _lastClockHtml='';
function updateAppClock(){
  const el=$('#appClock'); if(!el) return;
  const now=new Date();
  const hm=`${gcalPad(now.getHours())}:${gcalPad(now.getMinutes())}`;
  const sec=gcalPad(now.getSeconds());
  const shortD=`${now.getDate()} ${GCAL_MONTHS_SHORT[now.getMonth()]}`;
  const fullD=`${now.getDate()} ${GCAL_MONTHS[now.getMonth()]} ${now.getFullYear()} ${GCAL_DAYS_FULL[now.getDay()]}`;
  const html=clockFmt==='hms'?`${hm}:${sec}`:clockFmt==='hmd'?`<span class="clk-d">${shortD}</span><span>${hm}</span>`:hm;
  if(html!==_lastClockHtml){ el.innerHTML=html; _lastClockHtml=html; }
  const tip=`${fullD} · Görünümü değiştir (saat / tarih / saniye)`;
  if(el.title!==tip) el.title=tip;
  updateGcalCountdowns(now);
}
function cycleClockFmt(){
  const i=CLOCK_FMTS.indexOf(clockFmt);
  clockFmt=CLOCK_FMTS[(i+1)%CLOCK_FMTS.length];
  persistUiState({agydesk_clock_fmt:clockFmt},true);
  _lastClockHtml='';
  updateAppClock();
}
function initAppClock(){
  if(!CLOCK_FMTS.includes(clockFmt)) clockFmt='hm';
  updateAppClock();
  setInterval(updateAppClock,1000);
}

/* ---------- Üst köşe pil göstergesi ---------- */
const BAT_MODES=['unplugged','always'];
let batteryVisMode=localStorage.getItem('agydesk_bat_mode')||'unplugged';
let _lastBatData=null;
let _lastBatKey='';
function fmtBatTime(secs){
  if(typeof secs!=='number'||secs<=0) return '';
  const h=Math.floor(secs/3600), m=Math.round((secs%3600)/60);
  if(h>0&&m>0) return `${h} sa ${m} dk`;
  if(h>0) return `${h} sa`;
  return `${Math.max(1,m)} dk`;
}
function renderAppBattery(d){
  const el=$('#appBattery'); if(!el) return;
  if(!d||!d.available||(batteryVisMode==='unplugged'&&d.plugged)){
    if(el.style.display!=='none') el.style.display='none';
    _lastBatKey='';
    return;
  }
  const pct=Math.max(0,Math.min(100,Number(d.percent)||0));
  const plugged=!!d.plugged;
  const cls=plugged?'chg':pct<=10?'crit':pct<=25?'low':'';
  const key=`${pct}|${plugged?1:0}|${d.secs_left||0}|${batteryVisMode}`;
  if(key!==_lastBatKey){
    _lastBatKey=key;
    el.innerHTML=`<span class="bat-pill" style="--bat:${pct}"><span class="bat-fill"></span><span class="bat-num">${plugged?'⚡':''}${pct}</span></span><span class="bat-nub"></span>`;
    el.className='top-bat'+(cls?' '+cls:'');
    const rem=fmtBatTime(d.secs_left);
    el.title=plugged?`Prizde · %${pct}`:`Pilde · %${pct}${rem?' · Kalan: '+rem:''}`;
  }
  if(el.style.display!=='inline-flex') el.style.display='inline-flex';
}
function setBatteryVisMode(mode){
  if(!BAT_MODES.includes(mode)) return;
  batteryVisMode=mode;
  persistUiState({agydesk_bat_mode:mode},true);
  _lastBatKey='';
  renderAppBattery(_lastBatData);
  const sp=$('#spop');
  if(sp&&sp.classList.contains('show')) renderSettingsPop();
}
async function pollAppBattery(){
  try{
    const r=await fetch('/api/system/battery');
    if(!r.ok) return;
    _lastBatData=await r.json();
    renderAppBattery(_lastBatData);
  }catch(e){}
}
function initAppBattery(){
  if(!BAT_MODES.includes(batteryVisMode)) batteryVisMode='unplugged';
  pollAppBattery();
  setInterval(pollAppBattery,15000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) pollAppBattery(); });
}

/* ---------- Sol Ray Medya Kumandası (SMTC + Spotify Connect Hibrit) ---------- */
const MEDIA_ICONS={
  spotify:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.7"/><path d="M7.3 9.7c3.4-1 7-.7 9.8.8M8 12.6c2.8-.8 5.8-.5 8.1.7M8.7 15.3c2.1-.6 4.4-.4 6.2.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  youtube:'<svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 9.4 15.4 12l-5.2 2.6V9.4Z" fill="currentColor"/></svg>',
  ytmusic:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="5.6" stroke="currentColor" stroke-width="1.3" opacity=".8"/><path d="M10.3 9.5 15 12l-4.7 2.5V9.5Z" fill="currentColor"/></svg>',
  vlc:'<svg viewBox="0 0 24 24" fill="none"><path d="M9.6 4.5h4.8l3.1 11.5H6.5L9.6 4.5Z" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 9.2h7M7.5 12.6h9M4.5 16.5h15l1 3h-17l1-3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  soundcloud:'<svg viewBox="0 0 24 24" fill="none"><path d="M11.5 17h6.2a3.3 3.3 0 0 0 .3-6.6 4.5 4.5 0 0 0-8.6-1.3V17h2.1Z" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3.5 14v3M6 12v5M8.5 10.5V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  apple:'<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 13v-2M10.5 16V8M13.5 14.5v-5M16.5 13v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  browser:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.2" fill="currentColor" opacity=".14" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 9.2 15.2 12l-5 2.8V9.2Z" fill="currentColor"/></svg>',
  media:'<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 14v-4M8.2 17.5v-11M12 19V5M15.8 16.5v-9M19.5 14v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  idle:'<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 13.5v-3M8.2 16V8M12 18V6M15.8 15.5v-7M19.5 13.5v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".82"/></svg>'
};
const mediaIcon=p=>MEDIA_ICONS[p]||MEDIA_ICONS.media;

const MEDIA_CTRL_SVG={
  prev:'<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.2 3.2a.7.7 0 0 1 .7.7v8.2a.7.7 0 0 1-1.4 0V3.9a.7.7 0 0 1 .7-.7Zm9.5.9a.8.8 0 0 1 1.2.7v6.4a.8.8 0 0 1-1.2.7L6.3 8.7a.8.8 0 0 1 0-1.4l6.4-3.2Z"/></svg>',
  play:'<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M4.6 3.1a.9.9 0 0 1 1-.04l7.2 4.2a.85.85 0 0 1 0 1.48l-7.2 4.2a.9.9 0 0 1-1.35-.78V3.84a.9.9 0 0 1 .35-.74Z"/></svg>',
  pause:'<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><rect x="3.8" y="3" width="3" height="10" rx=".9"/><rect x="9.2" y="3" width="3" height="10" rx=".9"/></svg>',
  next:'<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.8 3.2a.7.7 0 0 0-.7.7v8.2a.7.7 0 0 0 1.4 0V3.9a.7.7 0 0 0-.7-.7Zm-9.5.9a.8.8 0 0 0-1.2.7v6.4a.8.8 0 0 0 1.2.7l6.4-3.2a.8.8 0 0 0 0-1.4L3.3 4.1Z"/></svg>',
  chevron:'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  gear:'<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.2v1.3M8 12.5v1.3M2.2 8h1.3M12.5 8h1.3M3.9 3.9l.95.95M11.15 11.15l.95.95M12.1 3.9l-.95.95M4.85 11.15l-.95.95"/></svg>',
  volHigh:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2h2.4L8.2 3.5v9L4.9 9.8H2.5a.8.8 0 0 1-.8-.8V7a.8.8 0 0 1 .8-.8Z" fill="currentColor" stroke="none"/><path d="M10.4 5.6a3.3 3.3 0 0 1 0 4.8M12.3 3.8a5.8 5.8 0 0 1 0 8.4"/></svg>',
  volLow:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2h2.4L8.2 3.5v9L4.9 9.8H2.5a.8.8 0 0 1-.8-.8V7a.8.8 0 0 1 .8-.8Z" fill="currentColor" stroke="none"/><path d="M10.5 5.8a3.1 3.1 0 0 1 0 4.4"/></svg>',
  volMute:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2h2.4L8.2 3.5v9L4.9 9.8H2.5a.8.8 0 0 1-.8-.8V7a.8.8 0 0 1 .8-.8Z" fill="currentColor" stroke="none"/><path d="M10.4 6.1l3.8 3.8M14.2 6.1l-3.8 3.8"/></svg>'
};

const SP_REDIRECT=window.location.origin+'/';
const SP_SCOPES='user-read-playback-state user-modify-playback-state user-read-currently-playing';
let preferredPcApp=localStorage.getItem('agydesk_media_app')||'';
let selectedMediaKey=localStorage.getItem('agydesk_media_sel')||(preferredPcApp?'pc:'+preferredPcApp:'');
function loadJsonLs(k,def){try{return JSON.parse(localStorage.getItem(k)||'')||def;}catch{return def;}}
const mediaThumbCache=loadJsonLs('agydesk_media_thumbs',{});
const mediaAppLastThumb={};
const mediaPlatCache=loadJsonLs('agydesk_media_plats',{});
let mediaShowSetup=false;
let mediaPinned=false;
let mediaHoverTimer=null;
let mediaPollSeq=0;
let mediaHasPolledPc=false;
let mediaState={
  source:'idle',activeKey:'',platform:'idle',platformLabel:'Medya Yok',title:'Aktif medya yok',
  artist:'',thumb:'',playing:false,pct:0,device:'',deviceId:'',isActiveDevice:false,targetApp:'',players:[]
};
let pcMedia={active:null,sessions:[]};
let pcVol={level:null,muted:false};
let spMedia={connected:false,playing:false,title:'',artist:'',thumb:'',pct:0,device:'',devices:[]};

function spConnected(){return !!localStorage.getItem('agydesk_sp_token');}
function b64url(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}

async function startSpotifyConnect(){
  const inp=$('#spCidIn');
  const cid=(inp?inp.value:localStorage.getItem('agydesk_sp_cid')||'').trim();
  if(!cid)return;
  localStorage.setItem('agydesk_sp_cid',cid);
  const verifier=b64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem('agydesk_sp_verifier',verifier);
  const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const u=new URL('https://accounts.spotify.com/authorize');
  u.searchParams.set('client_id',cid);
  u.searchParams.set('response_type','code');
  u.searchParams.set('redirect_uri',SP_REDIRECT);
  u.searchParams.set('code_challenge_method','S256');
  u.searchParams.set('code_challenge',challenge);
  u.searchParams.set('scope',SP_SCOPES);
  location.href=u.toString();
}

async function handleSpotifyOAuthCallback(){
  const p=new URLSearchParams(location.search);
  const code=p.get('code');
  if(!code)return;
  const cid=localStorage.getItem('agydesk_sp_cid');
  const verifier=localStorage.getItem('agydesk_sp_verifier');
  if(!cid||!verifier)return;
  try{
    const r=await fetch('https://accounts.spotify.com/api/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:cid,grant_type:'authorization_code',code,redirect_uri:SP_REDIRECT,code_verifier:verifier})
    });
    const d=await r.json();
    if(d.access_token){
      localStorage.setItem('agydesk_sp_token',d.access_token);
      if(d.refresh_token)localStorage.setItem('agydesk_sp_refresh',d.refresh_token);
      localStorage.setItem('agydesk_sp_exp',String(Date.now()+(d.expires_in-60)*1000));
      mediaShowSetup=false;
    }
  }catch{}
  history.replaceState({},'',location.pathname);
}

async function ensureSpotifyToken(){
  const tok=localStorage.getItem('agydesk_sp_token');
  if(!tok)return null;
  const exp=Number(localStorage.getItem('agydesk_sp_exp')||0);
  if(Date.now()<exp)return tok;
  const ref=localStorage.getItem('agydesk_sp_refresh');
  const cid=localStorage.getItem('agydesk_sp_cid');
  if(!ref||!cid)return tok;
  try{
    const r=await fetch('https://accounts.spotify.com/api/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:cid,grant_type:'refresh_token',refresh_token:ref})
    });
    const d=await r.json();
    if(d.access_token){
      localStorage.setItem('agydesk_sp_token',d.access_token);
      if(d.refresh_token)localStorage.setItem('agydesk_sp_refresh',d.refresh_token);
      localStorage.setItem('agydesk_sp_exp',String(Date.now()+(d.expires_in-60)*1000));
      return d.access_token;
    }
  }catch{}
  return tok;
}

function disconnectSpotify(){
  ['agydesk_sp_token','agydesk_sp_refresh','agydesk_sp_exp'].forEach(k=>localStorage.removeItem(k));
  spMedia={connected:false,playing:false,title:'',artist:'',thumb:'',pct:0,device:'',devices:[]};
  if(selectedMediaKey.startsWith('sp:')){
    selectedMediaKey='';
    localStorage.removeItem('agydesk_media_sel');
  }
  recomputeMediaState();
  renderMediaUI();
}

async function spApi(url,opts={}){
  const tok=await ensureSpotifyToken();
  if(!tok)return null;
  const r=await fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:'Bearer '+tok}});
  if(r.status===401){disconnectSpotify();return null;}
  return r;
}

function saveMediaCacheMap(lsKey,obj,maxEntries,maxChars){
  try{
    const keys=Object.keys(obj);
    while(keys.length>maxEntries){delete obj[keys.shift()];}
    let s=JSON.stringify(obj);
    while(maxChars&&s.length>maxChars&&keys.length>1){delete obj[keys.shift()];s=JSON.stringify(obj);}
    if(!maxChars||s.length<=maxChars)localStorage.setItem(lsKey,s);
  }catch{}
}
function cacheMediaThumb(app,title,thumb){
  if(!thumb)return;
  const k=`${app||''}|${title||''}`;
  if(mediaThumbCache[k]!==thumb){
    mediaThumbCache[k]=thumb;
    saveMediaCacheMap('agydesk_media_thumbs',mediaThumbCache,6,260000);
  }
  if(app)mediaAppLastThumb[app]={title:title||'',thumb};
}
function lookupMediaThumb(app,title){
  const k=`${app||''}|${title||''}`;
  if(mediaThumbCache[k])return mediaThumbCache[k];
  const last=app&&mediaAppLastThumb[app];
  if(last&&last.thumb&&(!title||last.title===title))return last.thumb;
  return '';
}
function normalizeSessionPlat(s){
  if(!s)return s;
  const k=`${s.app||''}|${s.title||''}`;
  if(s.platform&&s.platform!=='browser'&&s.platform!=='media'&&s.platform!=='idle'){
    const prev=mediaPlatCache[k];
    if(!prev||prev.platform!==s.platform){
      mediaPlatCache[k]={platform:s.platform,platformLabel:s.platform_label||s.platform};
      saveMediaCacheMap('agydesk_media_plats',mediaPlatCache,20,0);
    }
    return s;
  }
  const hit=s.title&&mediaPlatCache[k];
  if(hit)return{...s,platform:hit.platform,platform_label:hit.platformLabel};
  return s;
}

async function pollPcMedia(){
  const seq=++mediaPollSeq;
  const wantApp=selectedMediaKey.startsWith('pc:')?selectedMediaKey.slice(3):preferredPcApp;
  try{
    const qs=wantApp?`?app=${encodeURIComponent(wantApp)}`:'';
    const r=await fetch('/api/media/status'+qs);
    if(!r.ok)return;
    const d=await r.json();
    if(seq!==mediaPollSeq)return;
    mediaHasPolledPc=true;
    const sessions=(d.sessions||[]).map(normalizeSessionPlat);
    let act=d.active?normalizeSessionPlat(d.active):null;
    if(act){
      if(act.thumbnail)cacheMediaThumb(act.app,act.title,act.thumbnail);
      else act.thumbnail=lookupMediaThumb(act.app,act.title);
    }
    pcMedia={active:act,sessions};
    if(typeof d.volume==='number'&&!mediaVolDragging&&Date.now()>_mediaVolLocalUntil){
      pcVol={level:Math.max(0,Math.min(100,Math.round(d.volume))),muted:!!d.muted};
    }
  }catch{}
}

async function pollSpotifyConnect(){
  if(!spConnected()){spMedia.connected=false;return;}
  try{
    const r=await spApi('https://api.spotify.com/v1/me/player');
    if(!r)return;
    spMedia.connected=true;
    if(r.status===204){
      const dr=await spApi('https://api.spotify.com/v1/me/player/devices');
      spMedia.devices=dr?((await dr.json()).devices||[]):[];
      spMedia.playing=false;
      spMedia.title='';spMedia.artist='';spMedia.thumb='';spMedia.pct=0;spMedia.posMs=0;spMedia.durMs=0;spMedia.device='';
      return;
    }
    const d=await r.json();
    const dr=await spApi('https://api.spotify.com/v1/me/player/devices');
    const item=d.item||{};
    const posMs=d.progress_ms||0;
    const durMs=item.duration_ms||0;
    spMedia={
      connected:true,
      playing:!!d.is_playing,
      title:item.name||'',
      artist:(item.artists||[]).map(a=>a.name).join(', '),
      thumb:item.album?.images?.[2]?.url||item.album?.images?.[0]?.url||'',
      pct:durMs?Math.round((posMs/durMs)*100):0,
      posMs,
      durMs,
      device:d.device?.name||'Spotify',
      devices:dr?((await dr.json()).devices||[]):[]
    };
  }catch{}
}

function getUnifiedPlayers(){
  const players=[];
  for(const s of(pcMedia.sessions||[])){
    const actThumb=(pcMedia.active&&pcMedia.active.app===s.app)?pcMedia.active.thumbnail:'';
    const posMs=Number(s.position_ms)||0;
    const durMs=Number(s.duration_ms)||0;
    players.push({
      key:'pc:'+s.app,kind:'pc',app:s.app,deviceId:'',isActiveDevice:false,
      platform:s.platform||'media',platformLabel:s.platform_label||'PC Medya',
      title:s.title||'Bilinmiyor',artist:s.artist||'',
      thumb:actThumb||lookupMediaThumb(s.app,s.title),
      playing:!!s.playing,device:s.platform_label||'PC',
      pct:durMs?Math.round((posMs/durMs)*100):0,posMs,durMs
    });
  }
  if(spConnected()){
    const hasPcSp=(pcMedia.sessions||[]).some(s=>s.platform==='spotify');
    const devs=spMedia.devices||[];
    let addedSp=false;
    for(const d of devs){
      if(d.type==='Computer'&&hasPcSp)continue;
      if(!d.is_active&&d.type==='Computer'&&!spMedia.title)continue;
      addedSp=true;
      const devIcon=(d.type==='Tablet'||d.type==='Smartphone')?'📱 ':'💻 ';
      players.push({
        key:'sp:'+d.id,kind:'sp',app:'',deviceId:d.id,isActiveDevice:!!d.is_active,
        platform:'spotify',platformLabel:d.is_active?'Spotify':`Spotify · ${d.name}`,
        title:(d.is_active&&spMedia.title)?spMedia.title:(spMedia.title||d.name),
        artist:d.is_active?(spMedia.artist||d.name):(devIcon+d.name),
        thumb:d.is_active?spMedia.thumb:'',
        playing:!!(d.is_active&&spMedia.playing),
        device:d.name,pct:d.is_active?spMedia.pct:0,
        posMs:d.is_active?(spMedia.posMs||0):0,
        durMs:d.is_active?(spMedia.durMs||0):0
      });
    }
    if(!addedSp&&!hasPcSp&&spMedia.title){
      players.push({
        key:'sp:default',kind:'sp',app:'',deviceId:'',isActiveDevice:true,
        platform:'spotify',platformLabel:'Spotify Connect',
        title:spMedia.title,artist:spMedia.artist||spMedia.device||'Spotify',
        thumb:spMedia.thumb,playing:spMedia.playing,device:spMedia.device||'Spotify',
        pct:spMedia.pct,posMs:spMedia.posMs||0,durMs:spMedia.durMs||0
      });
    }
  }
  return players;
}

function recomputeMediaState(){
  const players=getUnifiedPlayers();
  let sel=selectedMediaKey?players.find(p=>p.key===selectedMediaKey):null;
  if(!sel&&selectedMediaKey&&mediaHasPolledPc){
    if(!selectedMediaKey.startsWith('sp:')||spMedia.connected){
      selectedMediaKey='';
      preferredPcApp='';
      localStorage.removeItem('agydesk_media_sel');
      localStorage.removeItem('agydesk_media_app');
    }
  }
  if(!sel){
    sel=players.find(p=>p.playing)||players[0]||null;
  }
  if(sel){
    mediaState={
      source:sel.kind,activeKey:sel.key,platform:sel.platform,platformLabel:sel.platformLabel,
      title:sel.title,artist:sel.artist||(sel.device||''),thumb:sel.thumb,playing:sel.playing,
      pct:sel.pct||0,posMs:sel.posMs||0,durMs:sel.durMs||0,updatedAt:Date.now(),
      device:sel.device,deviceId:sel.deviceId||'',isActiveDevice:!!sel.isActiveDevice,
      targetApp:sel.app||'',players
    };
    return;
  }
  mediaState={
    source:'idle',activeKey:'',platform:'idle',platformLabel:'Medya Yok',title:'Şu an çalan medya yok',
    artist:'Spotify, YouTube veya PC medyası bekleniyor',thumb:'',playing:false,pct:0,posMs:0,durMs:0,updatedAt:Date.now(),
    device:'',deviceId:'',isActiveDevice:false,targetApp:'',players
  };
}

function setSelectedMedia(player){
  selectedMediaKey=player?player.key:'';
  if(selectedMediaKey)localStorage.setItem('agydesk_media_sel',selectedMediaKey);
  else localStorage.removeItem('agydesk_media_sel');
  preferredPcApp=(player&&player.kind==='pc')?player.app:'';
  if(preferredPcApp)localStorage.setItem('agydesk_media_app',preferredPcApp);
  else localStorage.removeItem('agydesk_media_app');
  mediaPollSeq++;
  recomputeMediaState();
  renderMediaUI();
}

async function cycleMediaPlayer(){
  const players=mediaState.players&&mediaState.players.length?mediaState.players:getUnifiedPlayers();
  if(players.length<2)return;
  const curIdx=players.findIndex(p=>p.key===mediaState.activeKey);
  const next=players[(curIdx+1)%players.length];
  setSelectedMedia(next);
  await refreshMediaNow();
}

function toggleMediaSetup(){
  mediaShowSetup=!mediaShowSetup;
  renderMediaPop();
}

async function openMediaApp(){
  const s=mediaState;
  if(!s||s.source==='idle') return;
  closeMediaPop(true);
  try{
    const r=await fetch('/api/media/open',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({app:s.targetApp||'',title:s.title||'',platform:s.platform||''})
    });
    if(!r.ok) toast('Medya uygulaması açılamadı');
  }catch{
    toast('Medya uygulaması açılamadı');
  }
}

async function mediaCmd(action){
  if(mediaState.source==='sp'){
    if(mediaState.deviceId&&!mediaState.isActiveDevice&&action==='playpause'){
      await spApi('https://api.spotify.com/v1/me/player',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({device_ids:[mediaState.deviceId],play:true})
      });
    }else{
      const devQ=mediaState.deviceId?`?device_id=${encodeURIComponent(mediaState.deviceId)}`:'';
      const ep=action==='playpause'?(mediaState.playing?'pause':'play'):(action==='next'?'next':'previous');
      await spApi(`https://api.spotify.com/v1/me/player/${ep}${devQ}`,{method:action==='playpause'?'PUT':'POST'});
    }
  }else{
    await fetch('/api/media/cmd',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,app:mediaState.targetApp||''})
    });
  }
  setTimeout(refreshMediaNow,240);
}

let _lastRailPlat='';
let _lastRailTip='';
let _mediaPulseTimer=null;
function syncMediaPulse(playing){
  const btn=$('#mediaBtn');
  if(!playing||document.hidden||!btn){
    if(_mediaPulseTimer){clearInterval(_mediaPulseTimer);_mediaPulseTimer=null;}
    if(btn){btn.style.removeProperty('--mp-o');btn.style.removeProperty('--mp-s');}
    return;
  }
  if(_mediaPulseTimer)return;
  const tick=()=>{
    if(document.hidden||!mediaState.playing){syncMediaPulse(false);return;}
    const w=0.5-0.5*Math.cos(((Date.now()%1800)/1800)*Math.PI*2);
    btn.style.setProperty('--mp-o',(1-0.55*w).toFixed(2));
    btn.style.setProperty('--mp-s',(1-0.20*w).toFixed(3));
  };
  tick();
  _mediaPulseTimer=setInterval(tick,67);
}
document.addEventListener('visibilitychange',()=>{if(mediaState.playing)syncMediaPulse(!document.hidden);});
function renderMediaRail(){
  const btn=$('#mediaBtn'); if(!btn)return;
  const plat=mediaState.platform||'idle';
  if(plat!==_lastRailPlat){
    btn.innerHTML=mediaIcon(plat);
    _lastRailPlat=plat;
  }
  const isPlaying=!!mediaState.playing;
  const isActive=!!(mediaPinned||$('#mpop')?.classList.contains('show'));
  if(btn.classList.contains('playing')!==isPlaying) btn.classList.toggle('playing',isPlaying);
  if(btn.classList.contains('active')!==isActive) btn.classList.toggle('active',isActive);
  syncMediaPulse(isPlaying);
  const tip=mediaState.source==='idle'
    ?'AgyPlay (Çalan yok)'
    :`${mediaState.playing?'▶':'❚❚'} ${mediaState.title}${mediaState.artist?' — '+mediaState.artist:''} (${mediaState.platformLabel})`;
  if(tip!==_lastRailTip){
    btn.dataset.tip=tip;
    _lastRailTip=tip;
  }
}

let mediaSeeking=false;
function fmtMediaTime(ms){
  const sec=Math.max(0,Math.floor((Number(ms)||0)/1000));
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  const s=sec%60;
  return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function liveMediaPosMs(){
  const dur=Number(mediaState.durMs)||0;
  let pos=Number(mediaState.posMs)||0;
  if(mediaState.playing&&mediaState.updatedAt){
    pos+=Math.max(0,Date.now()-mediaState.updatedAt);
  }
  if(dur>0&&pos>dur)pos=dur;
  return Math.max(0,Math.round(pos));
}
function onMediaSeekInput(val){
  mediaSeeking=true;
  const pos=Number(val)||0;
  const dur=Number(mediaState.durMs)||1;
  const pct=Math.max(0,Math.min(100,(pos/dur)*100));
  const el=$('#mpopSeek'), cur=$('#mpopCurTime');
  if(el) el.style.setProperty('--p',pct.toFixed(1)+'%');
  if(cur) cur.textContent=fmtMediaTime(pos);
}
async function mediaSeek(val){
  const pos=Math.max(0,Math.round(Number(val)||0));
  mediaSeeking=false;
  mediaState.posMs=pos;
  mediaState.updatedAt=Date.now();
  if(mediaState.source==='sp'){
    const devQ=mediaState.deviceId?`&device_id=${encodeURIComponent(mediaState.deviceId)}`:'';
    await spApi(`https://api.spotify.com/v1/me/player/seek?position_ms=${pos}${devQ}`,{method:'PUT'});
  }else if(mediaState.source==='pc'){
    await fetch('/api/media/cmd',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'seek',position_ms:pos,app:mediaState.targetApp||''})
    });
  }
  setTimeout(refreshMediaNow,320);
}
setInterval(()=>{
  if(mediaSeeking||!$('#mpop')?.classList.contains('show'))return;
  const dur=Number(mediaState.durMs)||0;
  if(dur<=0)return;
  const pos=liveMediaPosMs();
  const pct=Math.max(0,Math.min(100,(pos/dur)*100));
  const el=$('#mpopSeek'), cur=$('#mpopCurTime');
  if(el){ el.value=pos; el.style.setProperty('--p',pct.toFixed(1)+'%'); }
  if(cur) cur.textContent=fmtMediaTime(pos);
},1000);

let mediaVolDragging=false;
let _mediaVolLocalUntil=0;
let _mediaVolSendTimer=null;
let _mediaVolPending=null;
let _mediaVolReqSeq=0;

function mediaVolIcon(level,muted){
  if(muted||level===0) return MEDIA_CTRL_SVG.volMute;
  if(level!==null&&level<50) return MEDIA_CTRL_SVG.volLow;
  return MEDIA_CTRL_SVG.volHigh;
}
function syncMediaVolDom(){
  const sl=$('#mpopVol'), pct=$('#mpopVolPct'), btn=$('#mpopVolBtn');
  if(!sl&&!pct&&!btn) return;
  const known=typeof pcVol.level==='number';
  const lvl=known?pcVol.level:0;
  const muted=!!pcVol.muted;
  const eff=muted?0:lvl;
  if(sl){
    sl.value=String(lvl);
    sl.style.setProperty('--p',eff+'%');
    sl.classList.toggle('muted',muted);
  }
  if(pct) pct.textContent=known?String(lvl):'—';
  if(btn){
    btn.classList.toggle('muted',muted||lvl===0);
    btn.title=muted?'Sesi aç':'Sesi kapat';
    btn.innerHTML=mediaVolIcon(known?lvl:50,muted);
  }
}
async function flushMediaVol(){
  if(_mediaVolSendTimer){clearTimeout(_mediaVolSendTimer);_mediaVolSendTimer=null;}
  const payload=_mediaVolPending;
  _mediaVolPending=null;
  if(!payload) return;
  const seq=++_mediaVolReqSeq;
  try{
    const r=await fetch('/api/media/volume',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(!r.ok) return;
    const d=await r.json();
    if(seq===_mediaVolReqSeq&&!mediaVolDragging&&!_mediaVolPending&&typeof d.volume==='number'){
      pcVol={level:Math.max(0,Math.min(100,Math.round(d.volume))),muted:!!d.muted};
      syncMediaVolDom();
    }
  }catch{}
}
function queueMediaVol(payload,immediate=false){
  _mediaVolPending=payload;
  if(immediate){
    flushMediaVol();
    return;
  }
  if(!_mediaVolSendTimer){
    _mediaVolSendTimer=setTimeout(flushMediaVol,55);
  }
}
function onMediaVolInput(val){
  mediaVolDragging=true;
  const v=Math.max(0,Math.min(100,Math.round(Number(val)||0)));
  pcVol={level:v,muted:v>0?false:pcVol.muted};
  _mediaVolLocalUntil=Date.now()+800;
  syncMediaVolDom();
  queueMediaVol({volume:v},false);
}
function commitMediaVol(val){
  mediaVolDragging=false;
  const v=Math.max(0,Math.min(100,Math.round(Number(val)||0)));
  pcVol={level:v,muted:v>0?false:pcVol.muted};
  _mediaVolLocalUntil=Date.now()+800;
  syncMediaVolDom();
  queueMediaVol({volume:v},true);
}
function toggleMediaMute(){
  pcVol={level:pcVol.level,muted:!pcVol.muted};
  _mediaVolLocalUntil=Date.now()+800;
  syncMediaVolDom();
  queueMediaVol({toggle_mute:true},true);
}
function onMediaVolWheel(e){
  if(!e||!e.deltaY) return;
  e.preventDefault();
  e.stopPropagation();
  const base=typeof pcVol.level==='number'?pcVol.level:50;
  const step=e.deltaY<0?2:-2;
  const next=Math.max(0,Math.min(100,base+step));
  pcVol={level:next,muted:next>0?false:pcVol.muted};
  _mediaVolLocalUntil=Date.now()+800;
  syncMediaVolDom();
  queueMediaVol({volume:next},false);
}

let _lastMediaPopSig='';
function renderMediaPop(){
  const pop=$('#mpop'); if(!pop)return;
  if((mediaSeeking||mediaVolDragging)&&pop.classList.contains('show'))return;
  const activeEl=document.activeElement;
  if(activeEl&&activeEl.id==='spCidIn'&&pop.classList.contains('show'))return;

  const hasSp=spConnected();
  const s=mediaState;
  const players=s.players||[];
  const dur=Number(s.durMs)||0;
  const pos=dur>0?liveMediaPosMs():0;
  const pct=dur>0?Math.max(0,Math.min(100,(pos/dur)*100)):(s.pct||0);
  const sig=[s.activeKey,s.platform,s.title,s.artist,s.thumb?s.thumb.slice(0,48):'',s.playing?1:0,dur>0?dur:0,players.length,mediaShowSetup?1:0,hasSp?1:0].join('|');
  if(sig===_lastMediaPopSig&&pop.firstElementChild){
    const el=$('#mpopSeek'), cur=$('#mpopCurTime');
    if(el){ el.value=pos; el.style.setProperty('--p',pct.toFixed(1)+'%'); }
    if(cur) cur.textContent=fmtMediaTime(pos);
    if(!mediaVolDragging&&Date.now()>_mediaVolLocalUntil) syncMediaVolDom();
    return;
  }
  _lastMediaPopSig=sig;

  const multi=players.length>1;
  const curIdx=players.findIndex(p=>p.key===s.activeKey);
  const nextPl=multi?players[(curIdx+1)%players.length]:null;
  const nextTip=nextPl
    ?`Sonraki oynatıcı: ${nextPl.platformLabel} (${((curIdx+1)%players.length)+1}/${players.length})`
    :'Başka aktif medya oynatıcı yok';
  const artHtml=s.thumb?`<img src="${escAttr(s.thumb)}" alt="">`:mediaIcon(s.platform);

  const seekHtml=dur>0?`
    <div class="mpop-seek-wrap">
      <input type="range" id="mpopSeek" class="mpop-seek" min="0" max="${dur}" step="1000" value="${pos}" style="--p:${pct.toFixed(1)}%" oninput="onMediaSeekInput(this.value)" onchange="mediaSeek(this.value)" title="İstediğin saniyeye/dakikaya sürükle">
      <div class="mpop-times"><span id="mpopCurTime">${fmtMediaTime(pos)}</span><span>${fmtMediaTime(dur)}</span></div>
    </div>`:(s.source==='sp'&&s.pct>0?`<div class="mpop-bar"><i style="width:${s.pct}%"></i></div>`:'');

  const savedCid=escAttr(localStorage.getItem('agydesk_sp_cid')||'');
  const setupHtml=mediaShowSetup?`
    <div class="mpop-setup">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="color:var(--txt);font-size:11.5px">Spotify Connect (PC + Tablet)</b>
        ${hasSp?'<button class="mpop-btn" onclick="disconnectSpotify()">Bağlantıyı Kes</button>':''}
      </div>
      ${hasSp?'<span style="color:var(--ok)">✓ Spotify hesabı bağlı (oynatıcılar › ile döner)</span>':`
        <span>1. <b>developer.spotify.com/dashboard</b> → Create app → Redirect URI:</span>
        <code>${escAttr(SP_REDIRECT)}</code>
        <input id="spCidIn" value="${savedCid}" placeholder="Spotify Client ID yapıştır">
        <button class="mpop-btn on" style="text-align:center" onclick="startSpotifyConnect()">Spotify'a Bağlan</button>
      `}
    </div>`:'';

  const volKnown=typeof pcVol.level==='number';
  const volVal=volKnown?pcVol.level:0;
  const volMuted=!!pcVol.muted;
  const volEff=volMuted?0:volVal;
  const volHtml=`
    <div class="mpop-vol" id="mpopVolWrap" title="PC Sesi · Fare tekerleği ile ayarla">
      <button type="button" id="mpopVolBtn" class="mpop-vbtn ${volMuted||volVal===0?'muted':''}" onclick="toggleMediaMute()" title="${volMuted?'Sesi aç':'Sesi kapat'}">${mediaVolIcon(volKnown?volVal:50,volMuted)}</button>
      <input type="range" id="mpopVol" class="mpop-seek mpop-vslider ${volMuted?'muted':''}" min="0" max="100" step="1" value="${volVal}" style="--p:${volEff}%" oninput="onMediaVolInput(this.value)" onchange="commitMediaVol(this.value)" aria-label="PC Sesi">
      <span id="mpopVolPct" class="mpop-vpct">${volKnown?volVal:'—'}</span>
    </div>`;

  pop.innerHTML=`
    <div class="mpop-head">
      <span class="mpop-plat">${mediaIcon(s.platform)}<span>${escAttr(s.platformLabel)}</span></span>
      <div class="mpop-actions">
        <button class="mpop-sbtn ${mediaShowSetup?'on':''}" onclick="toggleMediaSetup()" title="Spotify Connect (Tablet & PC) ayarları">${MEDIA_CTRL_SVG.gear}</button>
        <button class="mpop-next" onclick="cycleMediaPlayer()" ${multi?'':'disabled'} title="${escAttr(nextTip)}">${MEDIA_CTRL_SVG.chevron}</button>
      </div>
    </div>
    <div class="mpop-card ${s.source!=='idle'?'clickable':''}">
      <div class="mpop-info" ${s.source!=='idle'?`onclick="openMediaApp()" title="${escAttr((s.platformLabel||'Medya')+' uygulamasını aç')}"`:''}>
        <div class="mpop-title">${escAttr(s.title)}</div>
        <div class="mpop-artist">${escAttr(s.artist||'')}</div>
      </div>
      <div class="mpop-art" ${s.source!=='idle'?`onclick="openMediaApp()" title="${escAttr((s.platformLabel||'Medya')+' uygulamasını aç')}"`:''}>${artHtml}</div>
    </div>
    ${seekHtml}
    <div class="mpop-ctrls">
      <button class="mpop-cbtn" onclick="mediaCmd('prev')" title="Önceki parça">${MEDIA_CTRL_SVG.prev}</button>
      <button class="mpop-cbtn main" onclick="mediaCmd('playpause')" title="Oynat / Duraklat">${s.playing?MEDIA_CTRL_SVG.pause:MEDIA_CTRL_SVG.play}</button>
      <button class="mpop-cbtn" onclick="mediaCmd('next')" title="Sonraki parça">${MEDIA_CTRL_SVG.next}</button>
    </div>
    ${volHtml}
    ${setupHtml}
  `;
}

function positionRailPop(pop,anchor){
  if(!pop||!anchor) return;
  const r=anchor.getBoundingClientRect();
  if(!r.width&&!r.height) return;
  const popW=pop.offsetWidth||308;
  const popH=pop.offsetHeight||220;
  const left=Math.max(8,Math.min(Math.round(r.right+8),window.innerWidth-popW-8));
  const btnCenter=r.top+r.height/2;
  const top=Math.max(8,Math.min(Math.round(btnCenter-popH/2),window.innerHeight-popH-8));
  pop.style.left=left+'px';
  pop.style.top=top+'px';
  pop.style.bottom='auto';
}
function syncOpenRailPops(){
  const mpop=$('#mpop');
  if(mpop?.classList.contains('show')) positionRailPop(mpop,$('#mediaBtn'));
  const ppop=$('#ppop');
  if(ppop?.classList.contains('show')) positionRailPop(ppop,$('#railPomo'));
}

function renderMediaUI(){
  renderMediaRail();
  const pop=$('#mpop');
  if(pop?.classList.contains('show')){
    renderMediaPop();
    positionRailPop(pop,$('#mediaBtn'));
  }
}

let _mediaRefreshInFlight=null;
async function refreshMediaNow(){
  if(_mediaRefreshInFlight) return _mediaRefreshInFlight;
  _mediaRefreshInFlight=(async()=>{
    try{
      await Promise.all([pollPcMedia(),pollSpotifyConnect()]);
      recomputeMediaState();
      renderMediaUI();
    }finally{
      _mediaRefreshInFlight=null;
    }
  })();
  return _mediaRefreshInFlight;
}

let _mediaVolPollTimer=null;
let _mediaVolPollInFlight=false;
async function pollPcVolumeFast(){
  if(_mediaVolPollInFlight||mediaVolDragging||_mediaVolPending||Date.now()<_mediaVolLocalUntil) return;
  _mediaVolPollInFlight=true;
  try{
    const r=await fetch('/api/media/volume',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!r.ok) return;
    const d=await r.json();
    if(!mediaVolDragging&&!_mediaVolPending&&Date.now()>_mediaVolLocalUntil&&typeof d.volume==='number'){
      const lvl=Math.max(0,Math.min(100,Math.round(d.volume)));
      const muted=!!d.muted;
      if(lvl!==pcVol.level||muted!==pcVol.muted){
        pcVol={level:lvl,muted};
        syncMediaVolDom();
      }
    }
  }catch{}finally{
    _mediaVolPollInFlight=false;
  }
}
function stopMediaVolPoll(){
  if(_mediaVolPollTimer){clearInterval(_mediaVolPollTimer);_mediaVolPollTimer=null;}
}
function startMediaVolPoll(){
  if(_mediaVolPollTimer) return;
  pollPcVolumeFast();
  _mediaVolPollTimer=setInterval(()=>{
    const pop=$('#mpop');
    if(document.hidden||!pop||!pop.classList.contains('show')){
      stopMediaVolPoll();
      return;
    }
    pollPcVolumeFast();
  },160);
}

function openMediaPop(pin=false){
  const pop=$('#mpop'); if(!pop)return;
  $('#upop')?.classList.remove('show');
  $('#tpop')?.classList.remove('show');
  $('#fpop')?.classList.remove('show');
  $('#ppop')?.classList.remove('show');
  if(pin)mediaPinned=true;
  renderMediaPop();
  pop.classList.add('show');
  positionRailPop(pop,$('#mediaBtn'));
  renderMediaRail();
  startMediaVolPoll();
}

function closeMediaPop(force=false){
  if(force)mediaPinned=false;
  if(!force&&mediaPinned)return;
  $('#mpop')?.classList.remove('show');
  stopMediaVolPoll();
  renderMediaRail();
}

function initMediaHub(){
  const btn=$('#mediaBtn'), pop=$('#mpop');
  if(!btn||!pop)return;
  renderMediaRail();
  handleSpotifyOAuthCallback().then(()=>refreshMediaNow());

  btn.addEventListener('mouseenter',()=>{
    clearTimeout(mediaHoverTimer);
    openMediaPop(false);
    refreshMediaNow();
  });
  btn.addEventListener('mouseleave',()=>{
    mediaHoverTimer=setTimeout(()=>closeMediaPop(false),240);
  });
  pop.addEventListener('mouseenter',()=>clearTimeout(mediaHoverTimer));
  pop.addEventListener('mouseleave',()=>{
    mediaHoverTimer=setTimeout(()=>closeMediaPop(false),240);
  });
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    clearTimeout(mediaHoverTimer);
    if(mediaPinned&&pop.classList.contains('show'))closeMediaPop(true);
    else{openMediaPop(true);refreshMediaNow();}
  });
  pop.addEventListener('click',e=>e.stopPropagation());
  pop.addEventListener('wheel',e=>{
    if(e.target.closest('#mpopVolWrap')||pop.scrollHeight<=pop.clientHeight+2){
      onMediaVolWheel(e);
    }
  },{passive:false});
  btn.addEventListener('wheel',e=>{
    if(!pop.classList.contains('show')) openMediaPop(false);
    onMediaVolWheel(e);
  },{passive:false});
  document.addEventListener('click',e=>{
    if(!e.target.closest('#mpop')&&!e.target.closest('#mediaBtn'))closeMediaPop(true);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&pop.classList.contains('show'))closeMediaPop(true);
    if((e.key==='AudioVolumeUp'||e.key==='AudioVolumeDown'||e.key==='AudioVolumeMute')&&pop.classList.contains('show')){
      setTimeout(pollPcVolumeFast,25);
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      refreshMediaNow();
      scheduleMediaPoll();
      if(pop.classList.contains('show')) startMediaVolPoll();
    }else{
      stopMediaVolPoll();
    }
  });
  let _mediaPollTimer=null;
  function scheduleMediaPoll(){
    if(_mediaPollTimer) clearTimeout(_mediaPollTimer);
    if(document.hidden) return;
    const ms=pop.classList.contains('show')?2500:(mediaState.playing?5000:8000);
    _mediaPollTimer=setTimeout(async()=>{
      if(!document.hidden) await refreshMediaNow();
      scheduleMediaPoll();
    },ms);
  }
  scheduleMediaPoll();
}

function renderPomoPop(){
  const pop=$('#ppop'); if(!pop) return;
  const p=GCAL.pomo;
  const mm=gcalPad(Math.floor(p.sec/60)), ss=gcalPad(p.sec%60);
  const pct=Math.round((p.sec/Math.max(1,p.total))*100);
  const pomoLabel=gcalGetPomoLabel();
  const mins=Math.round(p.total/60), isBreak=/mola/i.test(p.mode||'');
  const statusTxt=p.running?'Odak aktif':(p.sec<p.total?'Duraklatıldı':'Hazır');
  pop.innerHTML=`
    <div class="ppop-head">
      <span class="ppop-badge">⏱ <span id="ppopMode">${escAttr(p.mode||'Odak')}</span></span>
      <button type="button" class="ppop-cal" onclick="closePomoPop();openPage('cal');gcalSetView('day')" title="AgyCal Günlük Görünümünü Aç">▦ AgyCal</button>
    </div>
    <div class="ppop-body">
      <div class="ppop-ring" id="ppopRing" style="--pp:${pct}" onpointerdown="gcalPomoDialDown(event,this)" title="Halkadan sürükleyerek süreyi ayarla">
        <span class="ppop-knob"></span>
        <span class="ppop-ring-txt" id="ppopTime">${mm}:${ss}</span>
      </div>
      <div class="ppop-info">
        <div class="ppop-task" title="${escAttr(pomoLabel)}">
          <span>🎯 ${escAttr(pomoLabel)}</span>
          ${p.customTitle?`<button type="button" class="gcal-icbtn" title="Aktif kasaya dön" onclick="gcalClearPomoCustom()" style="font-size:11px;padding:0 5px">↺</button>`:''}
        </div>
        <div class="ppop-stat" id="ppopStatus">${statusTxt}</div>
      </div>
    </div>
    <div class="ppop-acts">
      <button type="button" class="ppop-btn pri ${p.running?'on':''}" id="ppopToggleBtn" onclick="gcalPomoToggle()">${p.running?'⏸ Duraklat':'▶ Başlat'}</button>
      <button type="button" class="ppop-btn" onclick="gcalPomoRestartCurrent()" title="Mevcut süreyi başa al">↺ Sıfırla</button>
    </div>
    <div class="ppop-presets">
      <button type="button" class="ppop-chip ${!isBreak&&mins===25?'on':''}" onclick="gcalPomoReset(25,'25 dk Odak')">25 dk</button>
      <button type="button" class="ppop-chip ${!isBreak&&mins===50?'on':''}" onclick="gcalPomoReset(50,'50 dk Derin')">50 dk</button>
      <button type="button" class="ppop-chip ${!isBreak&&mins===90?'on':''}" onclick="gcalPomoReset(90,'90 dk Blok')">90 dk</button>
      <button type="button" class="ppop-chip ${isBreak&&mins===5?'on':''}" onclick="gcalPomoReset(5,'5 dk Mola')">Mola</button>
    </div>
  `;
}
function openPomoPop(){
  const pop=$('#ppop'); if(!pop) return;
  $('#upop')?.classList.remove('show');
  $('#tpop')?.classList.remove('show');
  $('#fpop')?.classList.remove('show');
  closeMediaPop(true);
  renderPomoPop();
  pop.classList.add('show');
  positionRailPop(pop,$('#railPomo'));
}
function closePomoPop(){
  $('#ppop')?.classList.remove('show');
}
function togglePomoPop(e){
  e?.stopPropagation();
  const pop=$('#ppop'); if(!pop) return;
  if(pop.classList.contains('show')) closePomoPop();
  else openPomoPop();
}
function initPomoPop(){
  const pop=$('#ppop'); if(!pop) return;
  pop.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',e=>{
    if(!e.target.closest('#ppop')&&!e.target.closest('#railPomo')&&!e.target.closest('#topPomo')) closePomoPop();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&pop.classList.contains('show')) closePomoPop();
  });
  window.addEventListener('resize',syncOpenRailPops);
}

async function hydrateUiState(){
  try{
    const r=await fetch('/api/ui_state');
    if(!r.ok){ _uiStateHydrated=true; flushUiStateRemote(false); return; }
    const srv=await r.json();
    if(!srv||typeof srv!=='object'){ _uiStateHydrated=true; flushUiStateRemote(false); return; }
    const srvKeys=Object.keys(srv);
    if(!srvKeys.length){
      _uiStateHydrated=true;
      if(Object.keys(_initialLocalSeed).length) persistUiState(_initialLocalSeed,true);
      else flushUiStateRemote(false);
      return;
    }
    const missingSeed={};
    Object.entries(_initialLocalSeed).forEach(([k,v])=>{
      if(!(k in srv)&&v!==null&&v!==undefined) missingSeed[k]=v;
    });
    UI_SYNC_KEYS.forEach(k=>{
      if(k===CLOSED_WINS_KEY&&_closedWinsDirty) return;
      if(typeof srv[k]==='string') localStorage.setItem(k,srv[k]);
    });
    let _hasWinTheme=false; try{ _hasWinTheme=!!sessionStorage.getItem('agydesk_win_theme'); }catch(e){}
    if(typeof srv.agydesk_theme==='string'&&!_hasWinTheme){
      applyTheme(srv.agydesk_theme,false);
    }
    let textChanged=false;
    if(typeof srv.agydesk_font==='string'&&srv.agydesk_font!==curFont){ curFont=srv.agydesk_font; textChanged=true; }
    if(typeof srv.agydesk_tz==='string'){
      const tz=parseFloat(srv.agydesk_tz);
      if(Number.isFinite(tz)&&tz!==curTz){ curTz=tz; textChanged=true; }
    }
    if(typeof srv.agydesk_fullw==='string'){
      const fw=srv.agydesk_fullw==='1';
      if(fw!==fullW){ fullW=fw; textChanged=true; }
    }
    if(textChanged) applyTextPrefs(false);
    if(typeof srv.agydesk_kview==='string') kasaViewMode=srv.agydesk_kview==='list'?'list':'grid';
    if(typeof srv.agydesk_effort==='string'&&EFFORTS.some(e=>e.id===srv.agydesk_effort)){ curEffort=srv.agydesk_effort; syncEffortSelects(); }
    if(typeof srv.agydesk_clock_fmt==='string'&&CLOCK_FMTS.includes(srv.agydesk_clock_fmt)){ clockFmt=srv.agydesk_clock_fmt; _lastClockHtml=''; updateAppClock(); }
    if(typeof srv.agydesk_bat_mode==='string'&&BAT_MODES.includes(srv.agydesk_bat_mode)){ batteryVisMode=srv.agydesk_bat_mode; _lastBatKey=''; renderAppBattery(_lastBatData); }
    if(typeof srv[NOTE_SCROLL_KEY]==='string'){
      try{
        const sc=JSON.parse(srv[NOTE_SCROLL_KEY]);
        if(sc&&typeof sc==='object') Object.assign(noteScrollMap,sc);
      }catch(e){}
    }
    if(typeof srv.agydesk_rail==='string'){
      try{
        const saved=JSON.parse(srv.agydesk_rail);
        if(Array.isArray(saved)) applyRailOrder(saved);
      }catch(e){}
    }
    if(typeof srv[AI_META_KEY]==='string'){
      try{
        const am=JSON.parse(srv[AI_META_KEY]);
        if(am&&typeof am==='object'){
          if(am.lastActive) aiMeta.lastActive=am.lastActive;
          if(am.items&&typeof am.items==='object') aiMeta.items={...aiMeta.items,...am.items};
        }
      }catch(e){}
    }
    if(typeof srv[AI_DRAWER_KEY]==='string'){
      aiDrawerOpen=srv[AI_DRAWER_KEY]==='1';
    }
    if(typeof srv[CLOSED_TABS_KEY]==='string'&&!CLOSED_TABS.length){
      try{
        const ct=JSON.parse(srv[CLOSED_TABS_KEY]);
        if(Array.isArray(ct)){
          ct.forEach(x=>{
            if(x&&x.id&&!String(x.id).startsWith('blank:')&&x.id!=='kasalar') CLOSED_TABS.push(x);
          });
        }
      }catch(e){}
    }
    if(_bootNeedServerClosedWin&&typeof srv[CLOSED_WINS_KEY]==='string'){
      _bootNeedServerClosedWin=false;
      try{ sessionStorage.removeItem(TAB_STORE_KEY); }catch(e){}
      if(restoreSessionTabs()) initNavHistory();
      else saveSessionTabs(false);
    }else if(String(active).startsWith('note:')&&$('#doc')){
      restoreMainScroll(active);
    }
    _uiStateHydrated=true;
    if(Object.keys(missingSeed).length) persistUiState(missingSeed,true);
    else flushUiStateRemote(false);
  }catch(e){
    _uiStateHydrated=true;
    flushUiStateRemote(false);
  }
}

async function refreshActiveNote(id=active){
  if(!id||!String(id).startsWith('note:')){ location.reload(); return; }
  if(typeof saveMainScroll==='function') saveMainScroll(id);
  delete noteCache[id];
  if(typeof noteDomCache!=='undefined') noteDomCache.delete(id);
  await loadVault();
  if(active===id) await renderMain();
  toast('✓ Not yenilendi',id);
}
function initNoteContextMenu(){
  let menu=$('#agyCtxMenu');
  if(!menu){
    menu=document.createElement('div');
    menu.id='agyCtxMenu';
    menu.className='agy-ctx-menu';
    document.body.appendChild(menu);
  }
  const hide=()=>menu.classList.remove('on');
  const copyTxt=t=>{
    if(!t) return;
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(()=>document.execCommand('copy'));
    else document.execCommand('copy');
  };
  const selectNoteContent=editable=>{
    if(editable){
      if(editable.select){ editable.focus(); editable.select(); return; }
      const r=document.createRange(); r.selectNodeContents(editable);
      const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); return;
    }
    const target=$('#mdView')||$('#doc')||$('#main');
    if(!target) return;
    const r=document.createRange(); r.selectNodeContents(target);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  const sendCtxAi=prompt=>{ rtab('ai'); aiSend('side_ai',prompt); };

  document.addEventListener('click',e=>{ if(!menu.contains(e.target)) hide(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') hide(); });
  window.addEventListener('blur',hide);
  const mainEl=$('#main');
  if(mainEl) mainEl.addEventListener('scroll',hide,{passive:true});

  document.addEventListener('contextmenu',e=>{
    if(e.defaultPrevented||e.shiftKey){ hide(); return; }
    const inApp=e.target&&e.target.closest('#main, #right, #left');
    if(!inApp){ hide(); return; }
    e.preventDefault();
    const isNote=Boolean(active&&String(active).startsWith('note:'));
    const sel=String(window.getSelection?window.getSelection():'');
    const selTrim=sel.trim();
    const hasSel=selTrim.length>0;
    const editable=e.target.closest('textarea, input, [contenteditable="true"]');
    const linkEl=e.target.closest('a[href], [data-target], [data-mdlink]');
    const imgEl=e.target.closest('img');
    const blockEl=e.target.closest('.nblock');
    const msgEl=e.target.closest('[data-sess][data-idx]');
    const blockTxt=blockEl&&blockEl.innerText?blockEl.innerText.trim():'';
    const msgTxt=msgEl&&msgEl.innerText?msgEl.innerText.trim():'';
    const docTxt=(isNote?($('#mdView')?.innerText||$('#doc')?.innerText||''):($('#main')?.innerText||'')).trim();
    const isLocked=typeof notionState==='object'&&!!notionState.locked;
    const isEditMd=isNote&&typeof editNoteIds!=='undefined'&&editNoteIds.has(active);
    const isFocus=app&&app.classList.contains('no-left')&&app.classList.contains('no-right');
    const aiTarget=hasSel?selTrim:(blockTxt||msgTxt||docTxt.slice(0,3000));
    const words=t=>t?t.split(/\s+/).filter(Boolean).length:0;

    menu.innerHTML='';

    // 1. Canlı bilgi şeridi
    const meta=document.createElement('div');
    meta.className='agy-ctx-meta';
    const modeLabel=isNote?`📄 Not · ${words(docTxt)} kelime`:(active==='studychat'?'📚 AgyStudy':(isAI(active)?'🤖 AI Sohbet':'❖ AgyDesk'));
    meta.textContent=hasSel
      ? `✦ Seçim: ${words(selTrim)} kelime · ${selTrim.length} karakter`
      : modeLabel;
    menu.appendChild(meta);

    // 2. Üst hızlı düzenleme şeridi (Kes / Kopyala / Yapıştır / Tümünü Seç)
    const quickBar=document.createElement('div');
    quickBar.className='agy-ctx-quick';
    const quickActs=[
      {icon:'✂',title:'Kes (Ctrl+X)',disabled:!(editable&&hasSel),fn:()=>document.execCommand('cut')},
      {icon:'📋',title:'Kopyala (Ctrl+C)',disabled:!hasSel,fn:()=>{ copyTxt(sel); toast('✓ Kopyalandı'); }},
      {icon:'📌',title:'Yapıştır (Ctrl+V)',disabled:!editable,fn:()=>{
        if(navigator.clipboard&&navigator.clipboard.readText){
          navigator.clipboard.readText().then(t=>{ if(t) document.execCommand('insertText',false,t); }).catch(()=>document.execCommand('paste'));
        }else document.execCommand('paste');
      }},
      {icon:'☑',title:'Tümünü Seç (Ctrl+A)',disabled:false,fn:()=>selectNoteContent(editable)}
    ];
    quickActs.forEach(qa=>{
      const b=document.createElement('button');
      b.type='button'; b.className='agy-ctx-qbtn'+(qa.disabled?' disabled':'');
      b.disabled=!!qa.disabled; b.title=qa.title; b.textContent=qa.icon;
      b.onclick=()=>{ if(!qa.disabled){ hide(); qa.fn(); } };
      quickBar.appendChild(b);
    });
    menu.appendChild(quickBar);

    const addSep=()=>{ const d=document.createElement('div'); d.className='agy-ctx-sep'; menu.appendChild(d); };
    const addItem=it=>{
      const b=document.createElement('button');
      b.type='button';
      b.className='agy-ctx-item'+(it.accent?' accent':'')+(it.disabled?' disabled':'');
      b.disabled=!!it.disabled;
      const lbl=document.createElement('span'); lbl.textContent=it.label; b.appendChild(lbl);
      if(it.key){ const k=document.createElement('kbd'); k.className='agy-ctx-key'; k.textContent=it.key; b.appendChild(k); }
      b.onclick=()=>{ if(it.disabled) return; hide(); it.fn(); };
      menu.appendChild(b);
    };

    // 3. Bağlam-duyarlı Link / Görsel / Web Arama
    if(linkEl){
      const href=linkEl.getAttribute('data-target')||linkEl.getAttribute('data-mdlink')||linkEl.getAttribute('href')||'';
      if(href&&href!=='#'){
        addSep();
        addItem({label:'↗ Bağlantıyı Aç',fn:()=>{ if(typeof openTargetLink==='function') openTargetLink(e,href,true); else window.open(href,'_blank','noopener'); }});
        addItem({label:'🔗 Bağlantıyı Kopyala',fn:()=>{ copyTxt(href); toast('✓ Bağlantı kopyalandı'); }});
      }
    }
    if(imgEl&&imgEl.src){
      addSep();
      addItem({label:'🖼 Görseli Aç',fn:()=>window.open(imgEl.src,'_blank','noopener')});
      addItem({label:'🔗 Görsel Adresini Kopyala',fn:()=>{ copyTxt(imgEl.src); toast('✓ Görsel adresi kopyalandı'); }});
    }
    if(hasSel){
      addSep();
      addItem({label:'🔍 Web\'de Ara',fn:()=>window.open('https://www.google.com/search?q='+encodeURIComponent(selTrim),'_blank','noopener')});
    }

    // 4. Kompakt 2x2 AI Komut Izgarası
    if(aiTarget){
      addSep();
      const aiGrid=document.createElement('div');
      aiGrid.className='agy-ctx-aigrid';
      const aiActs=[
        {label:hasSel?'✨ Seçimi Açıkla':(blockTxt?'✨ Bloğu Açıkla':'✨ Notu Açıkla'),fn:()=>sendCtxAi(`Notumdaki şu kısmı açıkla:\n\n> ${aiTarget}`)},
        {label:'🧠 Notu Özetle',fn:()=>sendCtxAi(`Açık olan notumu kısa ve net maddelerle özetle:\n\n${docTxt.slice(0,4500)}`)},
        {label:'❓ Quiz Üret',fn:()=>sendCtxAi(`Şu içerikten çalışmam için 3 adet kısa soru + cevap anahtarı üret:\n\n${aiTarget.slice(0,3000)}`)},
        {label:'🌐 Düzelt / Çevir',fn:()=>sendCtxAi(`Şu metni akıcı, teknik doğruluğu bozmadan Türkçeye çevir veya düzenle:\n\n> ${aiTarget.slice(0,2500)}`)}
      ];
      aiActs.forEach(aa=>{
        const b=document.createElement('button');
        b.type='button'; b.className='agy-ctx-aibtn'; b.textContent=aa.label;
        b.onclick=()=>{ hide(); aa.fn(); };
        aiGrid.appendChild(b);
      });
      menu.appendChild(aiGrid);
    }

    // 5. Not & Görünüm İşlemleri
    addSep();
    if(msgEl&&msgEl.classList.contains('a')){
      addItem({label:'📝 Bu Yanıtı Nota Ekle',accent:true,fn:()=>appendChatMsgToNote(msgEl.dataset.sess,Number(msgEl.dataset.idx),null)});
    }
    if(isNote){
      addItem({label:isLocked?'🔓 Düzenlemeyi Aç':'🔒 Salt Okunur Kilitle',fn:()=>{ if(typeof toggleNotionLock==='function') toggleNotionLock(active); }});
      if(!isLocked&&!isEditMd){
        addItem({label:'＋ Blok Ekle',key:'/',fn:()=>{ if(typeof openSlashFromTop==='function') openSlashFromTop(active); }});
      }
      addItem({label:isEditMd?'✨ Notion Tuvaline Geç':'</> Markdown Görünümü',fn:()=>{ if(typeof toggleEditNote==='function') toggleEditNote(active); }});
    }
    addItem({label:isFocus?'◫ Panelleri Göster':'⚡ Odak Modu',fn:()=>{
      if(!app) return;
      const next=!isFocus;
      app.classList.toggle('no-left',next);
      app.classList.toggle('no-right',next);
      if(curMode==='write'){ writeNoLeft=next; writeNoRight=next; }
      if(curMode==='study'){ studyNoLeft=next; studyNoRight=next; }
      if(typeof syncPaneBtns==='function') syncPaneBtns();
      if(typeof saveSessionTabs==='function') saveSessionTabs();
    }});
    if(isNote){
      addItem({label:'📝 Ham Markdown Kopyala',fn:()=>{
        const raw=(noteCache&&noteCache[active]&&noteCache[active].raw)||docTxt;
        copyTxt(raw); toast('✓ Markdown panoya kopyalandı');
      }});
    }
    addItem({label:'🖨 Yazdır (A4)',key:'Ctrl+P',fn:()=>window.print()});

    // 6. Canlı Tema Şeridi (menüyü kapatmadan anlık tema değiştir)
    if(typeof THEMES!=='undefined'&&typeof applyTheme==='function'){
      addSep();
      const tRow=document.createElement('div');
      tRow.className='agy-ctx-themes';
      THEMES.forEach(t=>{
        const d=document.createElement('button');
        d.type='button';
        d.className='agy-ctx-tdot'+(t.id===curTheme?' on':'');
        d.style.background=t.dot;
        d.title=`Tema: ${t.name||t.id}`;
        d.onclick=ev=>{
          ev.stopPropagation();
          applyTheme(t.id);
          tRow.querySelectorAll('.agy-ctx-tdot').forEach(x=>x.classList.remove('on'));
          d.classList.add('on');
        };
        tRow.appendChild(d);
      });
      menu.appendChild(tRow);
    }

    // 7. Yenileme
    addSep();
    addItem({label:'⟳ Notu Yenile',disabled:!isNote,fn:()=>refreshActiveNote(active)});
    addItem({label:'↻ Uygulamayı Yenile',key:'Ctrl+R',fn:()=>location.reload()});

    const hint=document.createElement('div');
    hint.className='agy-ctx-hint';
    hint.textContent='Shift + Sağ Tık: Sistem Menüsü';
    menu.appendChild(hint);

    menu.classList.add('on');
    const r=menu.getBoundingClientRect();
    const x=Math.min(e.clientX,Math.max(8,window.innerWidth-r.width-8));
    const y=Math.min(e.clientY,Math.max(8,window.innerHeight-r.height-8));
    menu.style.left=x+'px'; menu.style.top=y+'px';
  });
}

/* ---------- Başlat (Son açık sekmeleri geri yükle; yoksa Kasalar ana ekranı) ---------- */
initMainScrollTracking();
initThemes(); initTextPrefs(); initSmoothScroll(); initRailDrag(); initAppClock(); initAppBattery(); initMediaHub(); initPomoPop(); initGcalPomo(); initNoteContextMenu(); syncEffortSelects(); syncAllGemBoxes();
let _bootFresh=false; try{ _bootFresh=!sessionStorage.getItem(TAB_STORE_KEY)&&!new URLSearchParams(location.search).get('detach_tab'); }catch(e){}
if(!restoreSessionTabs()){
  _restoringSession=true;
  openTabs=['kasalar'];
  active='kasalar';
  setMode('kasalar');
  _restoringSession=false;
  saveSessionTabs(false);
}
initNavHistory();
window.addEventListener('beforeunload',()=>{
  saveMainScroll();
  saveSessionTabs(true);
  gcalSavePomo();
  flushUiStateRemote(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    saveMainScroll();
    saveSessionTabs();
    gcalSavePomo();
    flushUiStateRemote(true);
  }
});
hydrateUiState().finally(()=>{
  loadVault(); loadChats(); loadCalEvents(false).then(()=>renderTabs());
});
