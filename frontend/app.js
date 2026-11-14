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

/* Fare Yan Tuşları (XBUTTON1=3 Geri, XBUTTON2=4 İleri) */
document.addEventListener('mousedown',e=>{
  if(e.button===3||e.button===4){ e.preventDefault(); e.stopPropagation(); }
},true);
document.addEventListener('auxclick',e=>{
  if(e.button===3||e.button===4){ e.preventDefault(); e.stopPropagation(); }
},true);
document.addEventListener('mouseup',e=>{
  if(e.button===3){ e.preventDefault(); e.stopPropagation(); navBack(); }
  else if(e.button===4){ e.preventDefault(); e.stopPropagation(); navForward(); }
},true);

/* ---------- Uygulama Geneli Geri Al / Yinele (Ctrl+Z / Ctrl+Y) ---------- */
const APP_UNDO_STACK=[];
const APP_REDO_STACK=[];
const CLOSED_TABS=[];
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
  while(CLOSED_TABS.length){
    const item=CLOSED_TABS.pop();
    if(!item||!item.id) continue;
    if(String(item.id).startsWith('note:')&&!pages[item.id]) continue;
    if(isAI(item.id)&&!ai[item.id]) continue;
    if(!openTabs.includes(item.id)){
      const pos=Math.min(Math.max(0,item.idx),openTabs.length);
      openTabs.splice(pos,0,item.id);
    }
    openPage(item.id);
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
function mdToHtml(md,base){
  const mathBlocks=[], codeBlocks=[];
  let s=String(md).replace(/\r\n/g,'\n');
  const resolveRel=t=>/^https?:\/\//i.test(t)?t:(base?base+'/'+t:t);
  const imgPh=(t,alt)=>{
    t=String(t).trim(); const e=p=>'/api/raw/'+encodeURI(p);
    const rel=resolveRel(t);
    const tag=/^https?:\/\//i.test(t)
      ?`<img class="nimg" src="${t}" alt="${alt}" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede tam ekran aç" onclick="openRightViewer('${t}','${alt||'Görsel'}')" ondblclick="openDocInTab('${t}','${alt||'Görsel'}')">`
      :`<img class="nimg" src="${e(rel)}" data-alt="${e(t)}" data-rel="${rel}" alt="${alt}" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede tam ekran aç" loading="lazy" onclick="openRightViewer(this.dataset.rel||this.src,this.alt)" ondblclick="openDocInTab(this.dataset.rel||this.src,this.alt)" onerror="if(this.dataset.alt&&!this.dataset.t){this.dataset.t=1;this.src=this.dataset.alt;this.dataset.rel='${t}'}"><button class="emb-x" onclick="event.stopPropagation();removeEmbed('${t}')" title="Bu eki nottan kaldır">✕ kaldır</button>`;
    return `@@CODE_${codeBlocks.push(tag)-1}@@`;
  };
  const docPh=(t,alt)=>{
    t=String(t).trim(); const rel=resolveRel(t);
    const ext=t.slice(t.lastIndexOf('.')).toLowerCase();
    const ic=ext==='.pdf'?'📄':(ext.startsWith('.ppt')?'📊':(ext.startsWith('.xls')||ext==='.csv'?'📗':'📘'));
    const lbl=alt||t.split('/').pop();
    const safeLbl=lbl.replace(/'/g,'');
    const tag=`<span class="doc-chip" onclick="openRightViewer('${rel}','${safeLbl}')" ondblclick="openDocInTab('${rel}','${safeLbl}')" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede tam ekran aç (${rel})">${ic} ${lbl} <small style="opacity:.65">👁 önizle</small><small style="opacity:.85;margin-left:3px;padding:1px 5px;border-radius:4px;background:var(--cu-d);border:1px solid color-mix(in srgb,var(--cu) 35%,transparent)" onclick="event.stopPropagation();openDocInTab('${rel}','${safeLbl}')" title="AgyDesk içinde yeni sekmede tam ekran aç">⤢ sekmede aç</small><button class="emb-x" onclick="event.stopPropagation();removeEmbed('${t}')" title="Bu eki nottan kaldır">✕ kaldır</button></span>`;
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
  s=s.replace(/!\[([^\]]*)\]\(([^)\s]+\.(?:pdf|docx?|pptx?|xlsx?|csv|txt))\)/gi,(_,a,t)=>docPh(t,a));
  s=s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,(_,a,t)=>imgPh(t,a));
  s=s.replace(/\[\[([^\]]+)\]\]/g,(_,inner)=>{
    const {id,label}=resolveWiki(inner);
    return id?`<span class="link" onclick="openPage('${id}')">📄 ${label}</span>`:`<span class="link">[[${label}]]</span>`;
  });
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
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
const TAB_STORE_KEY='agydesk_tabs_v1';
const NOTE_SCROLL_KEY='agydesk_note_scrolls_v1';
const UI_SYNC_KEYS=[
  'agydesk_theme',
  TAB_STORE_KEY,
  NOTE_SCROLL_KEY,
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
function saveMainScroll(forceId=null){
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
  if(target>0){
    const reapply=()=>{
      if(!_pendingScrollRestore||_pendingScrollRestore.id!==id||_pendingScrollRestore.userScrolled) return;
      const curM=$('#main');
      if(!curM||active!==id||!curM.querySelector('#doc')) return;
      curM.scrollTop=target;
      syncNotionMinimapActive();
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
        syncNotionMinimapActive();
      }
    });
  },{passive:true});
}

function saveSessionTabs(){
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
      noRight:app?app.classList.contains('no-right'):false,
      leftW:typeof leftW==='number'?leftW:248,
      rightW:typeof rightW==='number'?rightW:340,
      rightTab:curRt?curRt.dataset.rt:'ai'
    };
    const raw=JSON.stringify(payload);
    localStorage.setItem(TAB_STORE_KEY,raw);
    persistUiState({[TAB_STORE_KEY]:raw},true);
  }catch(e){}
}
function restoreSessionTabs(){
  try{
    const raw=localStorage.getItem(TAB_STORE_KEY);
    if(!raw) return false;
    const saved=JSON.parse(raw);
    if(!saved||!Array.isArray(saved.openTabs)||!saved.openTabs.length) return false;
    _restoringSession=true;
    if(saved.treeOpen&&typeof saved.treeOpen==='object'){
      Object.assign(TREE_OPEN,saved.treeOpen);
    }
    if(typeof saved.currentSpace==='string'&&saved.currentSpace) currentSpace=saved.currentSpace;
    if(typeof saved.currentKasa==='string'&&saved.currentKasa) currentKasa=saved.currentKasa;
    const cleaned=[];
    saved.openTabs.forEach(t=>{
      if(typeof t!=='string'||!t||cleaned.includes(t)) return;
      if(t.startsWith('blank:')){
        const num=parseInt(t.slice(6),10);
        if(Number.isFinite(num)&&num>blankN) blankN=num;
      }else if(t.startsWith('ai')&&t!=='side_ai'){
        const num=parseInt(t.slice(2),10);
        if(Number.isFinite(num)&&num>aiN) aiN=num;
        if(!ai[t]) ai[t]={title:'AI Oturumu '+t.replace('ai',''),msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
      }
      cleaned.push(t);
    });
    if(!cleaned.length){ _restoringSession=false; return false; }
    openTabs=cleaned;
    active=(typeof saved.active==='string'&&openTabs.includes(saved.active))?saved.active:openTabs[0];
    const targetMode=saved.curMode||(active==='kasalar'?'kasalar':(isAI(active)?'ai':(active==='cal'?'plan':(active==='studychat'?'study':'write'))));
    layoutMode(targetMode);
    if(typeof saved.noLeft==='boolean') app.classList.toggle('no-left',saved.noLeft);
    if(typeof saved.noRight==='boolean') app.classList.toggle('no-right',saved.noRight);
    if(typeof saved.leftW==='number'&&Number.isFinite(saved.leftW)) leftW=clampLeft(saved.leftW);
    if(typeof saved.rightW==='number'&&Number.isFinite(saved.rightW)) rightW=clampRight(saved.rightW);
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
  const chips=[
    `<button type="button" class="sp-pill ${currentSpace==='all'?'on':''}" onclick="selectSpaceFilter('all')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'all')" title="Tüm Çalışma Alanları">❖ Tümü <span class="sp-pill-cnt">${kasalarData.length}</span></button>`,
    ...spacesData.map(sp=>`
      <button type="button" class="sp-pill ${currentSpace===sp.id?'on':''}" style="--sp-acc:${escHtml(sp.accent||'#e0a458')}" onclick="selectSpaceFilter('${escHtml(sp.id)}')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'${escHtml(sp.id)}')" title="${escHtml(sp.title)} · Kasayı sürükleyip bırakabilirsin">
        <span>${escHtml(sp.icon||'🗂')}</span>
        <span>${escHtml(sp.title)}</span>
        <span class="sp-pill-cnt">${sp.count_kasas||0}</span>
      </button>
    `),
    `<button type="button" class="sp-pill add" onclick="openSpaceModal()" title="Yeni Çalışma Alanı Oluştur">＋</button>`
  ];
  host.innerHTML=chips.join('');
}
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
      const sk='space:'+sp.id;
      const isOpen=(sk in TREE_OPEN)?TREE_OPEN[sk]:(sp.id==='donem_7'||(spKasas.length>0&&spKasas.length<=3));
      return {
        n:`${sp.title} (${spKasas.length})`,
        i:sp.icon||'🗂',
        spaceId:sp.id,
        accent:sp.accent||'#e0a458',
        open:isOpen,
        k:spKasas
      };
    });
    const orphan=vaultTree.filter(g=>!spacesData.some(sp=>sp.id===g.space));
    if(orphan.length) topGroups.push(...orphan);
  }else{
    topGroups=vaultTree.map(g=>({...g}));
  }
  const visRoots=(currentKasa==='all')?rootDocsData.filter(d=>currentSpace==='all'||d.space===currentSpace):[];
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
  if(!sel) return;
  const spObj=getSpaceObj(currentSpace);
  const visKasas=currentSpace==='all'?kasalarData:kasalarData.filter(k=>k.space===currentSpace);
  const allLabel=spObj?`${spObj.icon} ${spObj.title} (${visKasas.length})`:`Tüm Kasalar (${kasalarData.length})`;
  if(currentSpace!=='all'){
    sel.innerHTML=`<option value="all">${escHtml(allLabel)}</option>`+
      visKasas.map(k=>`<option value="${escHtml(k.key)}" ${currentKasa===k.key?'selected':''}>${escHtml(k.icon+' '+k.title)} (${k.counts?k.counts.total:0})</option>`).join('');
  }else{
    sel.innerHTML=renderKasaGroupOptions(currentKasa==='all'?'':currentKasa, allLabel).replace('value=""','value="all"');
  }
  sel.value=(currentKasa!=='all'&&visKasas.some(k=>k.key===currentKasa))?currentKasa:'all';
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
      Object.keys(pages).forEach(k=>{ if(k.startsWith('note:')) delete pages[k]; });
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
    renderTree(); renderTabs();
    if(!sameNoteMounted) renderMain();
    updateRightProps(); updateSideAiCtx(); saveSessionTabs();
  }catch(e){ console.error('loadVault error:',e); }
}

async function loadHealth(){
  try{
    const h=await api('/api/health');
    const el=$('#stHealth');
    if(el){
      const parts=[];
      if(h.agy) parts.push('agy CLI: aktif');
      if(h.ollama) parts.push('Ollama: aktif');
      if(h.git_checkpoints) parts.push('Git Checkpoint: açık');
      el.textContent=parts.length?parts.join(' · '):'Sağlayıcı hazır';
    }
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
    return src.kind==='file'?{position:'into',targetRel:'_root_docs'}:null;
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
    const isRootDocsBucket=x.rel==='_root_docs';
    const isRootKasa=Boolean(!isSpace&&x.k&&x.rel&&!String(x.rel).includes('/')&&!isRootDocsBucket);
    const isSubfolder=Boolean(!isSpace&&x.k&&x.rel&&String(x.rel).includes('/'));
    const isVaultFile=Boolean(!isSpace&&!x.k&&x.rel&&String(x.id||'').startsWith('note:'));
    const flags={isSpace,isRootKasa,isSubfolder,isVaultFile,isRootDocsBucket};
    const isDraggableItem=isRootKasa||isSubfolder||isVaultFile;
    d.className='ti'+(x.k?' folder':'')+(isSpace?' space-node':'')+(isRootKasa?' root-kasa':'')+(x.open?' open':'')+(x.id===active?' on':'');
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
    }else if(x.k&&(x.rel||x.kasa)&&x.rel!=='_root_docs'){
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
const SIDE_EXT=['.pdf','.docx','.doc','.pptx','.ppsx','.ppt','.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif'];
function isSideDoc(relOrId){
  const s=String(relOrId||'').toLowerCase();
  if(SIDE_EXT.some(e=>s.endsWith(e)))return true;
  const p=pages[relOrId];
  return !!(p&&p.ext&&SIDE_EXT.includes(p.ext));
}
let leftW=248, rightW=340, viewerPrev=null;
const LEFT_MIN=200, LEFT_MAX=480, RIGHT_MIN=280, RIGHT_MAX=680, CENTER_MIN=420;
function clampLeft(w){
  const rOpen=!app.classList.contains('no-right');
  const maxByCenter=window.innerWidth-52-(rOpen?rightW:0)-CENTER_MIN;
  const hi=Math.max(LEFT_MIN,Math.min(LEFT_MAX,Math.floor(window.innerWidth*0.38),maxByCenter));
  return Math.max(LEFT_MIN,Math.min(hi,Math.round(w)));
}
function clampRight(w){
  const lOpen=!app.classList.contains('no-left');
  const maxByCenter=window.innerWidth-52-(lOpen?leftW:0)-CENTER_MIN;
  const hi=Math.max(RIGHT_MIN,Math.min(RIGHT_MAX,Math.floor(window.innerWidth*0.50),maxByCenter));
  return Math.max(RIGHT_MIN,Math.min(hi,Math.round(w)));
}
function applyPaneWidths(){
  app.style.setProperty('--left',leftW+'px');
  app.style.setProperty('--right',rightW+'px');
}
let rvCurrentRel='', rvCurrentTitle='', rvNight=localStorage.getItem('agydesk_pdf_night')==='1';
function toggleRightViewerNight(){
  rvNight=!rvNight;
  localStorage.setItem('agydesk_pdf_night',rvNight?'1':'0');
  const nb=$('#rvNightBtn');
  if(nb){ nb.classList.toggle('on',rvNight); nb.style.borderColor=rvNight?'var(--cu)':''; nb.style.color=rvNight?'var(--cu)':''; }
  const fr=$('#rvBody iframe');
  if(fr) fr.style.filter=rvNight?'invert(0.90) hue-rotate(180deg) contrast(0.96)':'none';
}
function openDocInTab(relOrUrl,title){
  let raw=String(relOrUrl||'');
  if(raw.startsWith('note:')) raw=raw.slice(5);
  const cleanRel=raw.replace(/^.*\/api\/raw\//,'');
  const id='note:'+cleanRel;
  if(!pages[id]){
    const ext=(cleanRel.includes('.')?cleanRel.slice(cleanRel.lastIndexOf('.')):'').toLowerCase();
    const ic=ext==='.pdf'?'📄':(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)?'🖼':(/\.(pptx?|ppsx)$/i.test(ext)?'📊':(/\.(docx?)$/i.test(ext)?'📘':'📄')));
    const fKey=cleanRel.includes('/')?cleanRel.split('/')[0]:'';
    const kObj=kasalarData.find(k=>k.key===fKey);
    pages[id]={t:title||decodeURIComponent(cleanRel.split('/').pop()||cleanRel),i:ic,rel:cleanRel,folder:kObj?kObj.title:(fKey||'Obsidian Kasası'),kasa:fKey,ext:ext||'.pdf'};
  }
  if(viewerPrev) closeRightViewer();
  openPage(id,true);
}
async function openRightViewer(relOrUrl,title){
  let raw=String(relOrUrl||'');
  if(raw.startsWith('note:'))raw=raw.slice(5);
  const isHttp=/^https?:\/\//i.test(raw)&&!raw.includes('/api/raw/');
  const cleanRel=raw.replace(/^.*\/api\/raw\//,'');
  const url=isHttp?raw:('/api/raw/'+encodeURI(cleanRel));
  const low=cleanRel.toLowerCase();
  const name=title||decodeURIComponent(cleanRel.split('/').pop()||'Dosya');
  rvCurrentRel=cleanRel; rvCurrentTitle=name;
  $('#rvTitle').textContent=name;
  const op=$('#rvOpen');
  if(op){
    op.style.display='';
    op.onclick=e=>{ e.preventDefault(); openDocInTab(cleanRel,name); };
  }
  const nb=$('#rvNightBtn');
  if(nb){
    nb.style.display=low.endsWith('.pdf')?'':'none';
    nb.classList.toggle('on',rvNight);
    nb.style.borderColor=rvNight?'var(--cu)':'';
    nb.style.color=rvNight?'var(--cu)':'';
  }
  const b=$('#rvBody');
  if(!viewerPrev){
    const curRt=$('.rt.on');
    viewerPrev={wasClosed:app.classList.contains('no-right'),rt:curRt?curRt.dataset.rt:'ai',w:rightW};
  }
  rightW=clampRight(Math.max(rightW,500));
  applyPaneWidths();
  $('#rtabsBar').style.display='none';
  $$('.rbody').forEach(el=>el.classList.toggle('on',el.id==='rb-viewer'));
  app.classList.remove('no-right');
  syncPaneBtns();
  if(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(low)){
    const safeName=name.replace(/'/g,'');
    b.innerHTML=`<div style="padding:14px;display:flex;flex-direction:column;align-items:center;gap:10px"><img src="${url}" style="max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:zoom-in" onclick="openDocInTab('${cleanRel}','${safeName}')" title="AgyDesk içinde yeni sekmede tam boy aç"><div class="mono" style="font-size:11px;color:var(--mut)">${cleanRel} · <span class="link" onclick="openDocInTab('${cleanRel}','${safeName}')">⤢ Sekmede Tam Ekran Aç</span></div></div>`;
  }else if(low.endsWith('.pdf')){
    const filt=rvNight?'filter:invert(0.90) hue-rotate(180deg) contrast(0.96);':'';
    b.innerHTML=`<iframe src="${url}#view=FitH" style="flex:1;width:100%;height:100%;border:0;background:#fff;transition:filter .2s;${filt}"></iframe>`;
  }else if(/\.(pptx?|ppsx)$/i.test(low)){
    b.innerHTML=`<div style="padding:20px;color:var(--mut)"><span class="spin"></span> Sunum slaytları hazırlanıyor: ${name}…</div>`;
    try{
      const d=await api('/api/pptx?rel='+encodeURIComponent(cleanRel));
      b.innerHTML=`<div class="rview-pptx">${renderPptxSlidesHtml(d)}</div>`;
    }catch(e){
      b.innerHTML=`<div style="padding:20px;color:var(--err)">Sunum okunamadı: ${e.message}</div>`;
    }
  }else if(/\.(docx?)$/i.test(low)){
    b.innerHTML=`<div style="padding:20px;color:var(--mut)"><span class="spin"></span> Word belgesi okunuyor: ${name}…</div>`;
    try{
      const d=await api('/api/docx?rel='+encodeURIComponent(cleanRel));
      b.innerHTML=`<div class="rview-docx">${d.html}</div>`;
    }catch(e){
      b.innerHTML=`<div style="padding:20px;color:var(--err)">Belge okunamadı: ${e.message}</div>`;
    }
  }else{
    b.innerHTML=`<iframe src="${url}" style="flex:1;width:100%;height:100%;border:0;background:#fff"></iframe>`;
  }
}
function closeRightViewer(){
  $('#rtabsBar').style.display='';
  const prev=viewerPrev;
  viewerPrev=null;
  if(prev){
    rightW=clampRight(prev.w||340);
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
  const i=openTabs.indexOf(active);
  openTabs.splice(i===-1?openTabs.length:i+1,0,id);
  openPage(id);
}
/* opts.replace: aktif sekmenin içeriğini değiştir (Obsidian tıklama) · opts.newTab: her zaman yeni sekme (orta tık) */
function openPage(id,forceTab=false,opts={}){
  if(isAI(id)&&!ai[id])return;
  if(active!==id) saveMainScroll();
  const p=pages[id];
  if(!forceTab&&!openTabs.includes(id)&&((p&&p.ext&&SIDE_EXT.includes(p.ext))||(String(id).startsWith('note:')&&isSideDoc(id)))){
    openRightViewer(p?p.rel:id.slice(5),p?p.t:'');
    return;
  }
  if(!openTabs.includes(id)){
    const ai_=openTabs.indexOf(active);
    const canReplace=opts.replace&&!opts.newTab&&ai_!==-1&&!isAI(active)&&active!=='kasalar'&&!isAI(id);
    if(canReplace) openTabs[ai_]=id;
    else if(opts.newTab&&ai_!==-1) openTabs.splice(ai_+1,0,id);
    else openTabs.push(id);
    pruneUnlockedNotes();
  }
  active=id;
  if(p&&p.kasa&&currentKasa!=='all'&&currentKasa!==p.kasa){
    currentKasa=p.kasa;
    const sel=$('#kasaSelect'); if(sel) sel.value=currentKasa;
    rebuildTreeAndSources();
  }
  if(id==='kasalar'&&curMode!=='kasalar') layoutMode('kasalar');
  else if(isAI(id)&&curMode!=='ai') layoutMode('ai');
  else if(id!=='kasalar'&&!isAI(id)&&curMode==='kasalar') layoutMode('write');
  syncPdfSlotsWithTabs();
  renderTabs(); renderTree(); renderSessions(); renderMain(); updateSideAiCtx(); updateRightProps(); syncPdfFocusMode(); saveSessionTabs();
  scheduleRecordNavState();
}
function closeTab(id,opts={}){
  if(isAI(id)){ closeSession(id); return; }
  if(active===id) saveMainScroll();
  const idx=openTabs.indexOf(id);
  const pgTitle=(typeof pg==='function'?pg(id).t:id);
  openTabs=openTabs.filter(t=>t!==id);
  unlockedNotes.delete(id);
  pruneUnlockedNotes();
  if(!openTabs.length)openTabs=['kasalar'];
  if(active===id)active=openTabs[Math.min(idx,openTabs.length-1)];
  if(active==='kasalar') layoutMode('kasalar');
  removePdfSlot(id);
  if(!opts.silentUndo&&idx!==-1&&id!=='kasalar'){
    CLOSED_TABS.push({id,idx});
    if(CLOSED_TABS.length>30) CLOSED_TABS.shift();
    pushAppUndo({
      label:`"${pgTitle}" sekmesi`,
      undo:async()=>{
        if(!openTabs.includes(id)) openTabs.splice(Math.min(idx,openTabs.length),0,id);
        openPage(id);
      },
      redo:async()=>{ closeTab(id,{silentUndo:true}); }
    });
  }
  renderTabs();renderTree();renderMain();updateSideAiCtx();updateRightProps();syncPdfFocusMode();saveSessionTabs();
  scheduleRecordNavState();
}
const isAI=id=>id.startsWith('ai');
pages.studychat={t:'Sohbet',i:'❖'};
const pg=id=>isAI(id)?{t:(ai[id]?ai[id].title:id),i:'◆'}:(isBlank(id)?{t:'Yeni sekme',i:'📄'}:(pages[id]||{t:id,i:'📝'}));
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
function renderTabs(){
  const t=$('#tabs'); t.innerHTML='';
  t.ondragover=e=>{
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
  };
  t.ondrop=e=>{
    if(e.target===t||e.target.classList.contains('tab-add')){
      e.preventDefault();
      const srcId=e.dataTransfer.getData('text/plain')||draggedTabId;
      if(!srcId) return;
      const srcIdx=openTabs.indexOf(srcId);
      if(srcIdx!==-1&&srcIdx!==openTabs.length-1){
        const [moved]=openTabs.splice(srcIdx,1);
        openTabs.push(moved);
        renderTabs();
        saveSessionTabs();
      }
    }
  };
  openTabs.forEach((id,idx)=>{
    const d=document.createElement('div'); d.className='tab'+(id===active?' on':'');
    d.draggable=true;
    d.dataset.tabId=id;
    const s=isAI(id)?ai[id]:null;
    const info=pg(id);
    const shortcutHint=idx<8?` (Ctrl+${idx+1})`:(idx===openTabs.length-1?' (Ctrl+9)':'');
    d.title=info.t+shortcutHint+' · Sürükleyerek sırasını değiştir';
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
    const badge=s?`<span class="md ${s.mode}" title="${MODES[s.mode].n}"></span>`+(s.running?'<span class="spin"></span>':(s.pending?'<span class="udot" style="background:var(--cu)"></span>':(s.unread?'<span class="udot"></span>':''))):calBadge;
    d.innerHTML=`<span class="tic">${svgIcon(info.i)}</span><span class="tt">${info.t}</span>${badge}<span class="x" data-x="${id}" title="Sekmeyi kapat (Ctrl+W)">✕</span>`;
    d.ondragstart=e=>{
      isTabDragging=true;
      draggedTabId=id;
      e.dataTransfer.setData('text/plain',id);
      e.dataTransfer.effectAllowed='move';
      d.classList.add('dragging');
    };
    d.ondragend=()=>{
      setTimeout(()=>{ isTabDragging=false; },60);
      draggedTabId=null;
      t.querySelectorAll('.tab').forEach(el=>el.classList.remove('dragging','drag-over-left','drag-over-right'));
    };
    d.ondragover=e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      if(!draggedTabId||draggedTabId===id) return;
      const rect=d.getBoundingClientRect();
      const mid=rect.left+rect.width/2;
      if(e.clientX<mid){
        d.classList.add('drag-over-left');
        d.classList.remove('drag-over-right');
      }else{
        d.classList.add('drag-over-right');
        d.classList.remove('drag-over-left');
      }
    };
    d.ondragleave=e=>{
      if(!d.contains(e.relatedTarget)){
        d.classList.remove('drag-over-left','drag-over-right');
      }
    };
    d.ondrop=e=>{
      e.preventDefault();
      d.classList.remove('drag-over-left','drag-over-right');
      const srcId=e.dataTransfer.getData('text/plain')||draggedTabId;
      if(!srcId||srcId===id) return;
      let dropIdx=openTabs.indexOf(id);
      const rect=d.getBoundingClientRect();
      if(e.clientX>rect.left+rect.width/2){
        dropIdx++;
      }
      const srcIdx=openTabs.indexOf(srcId);
      if(srcIdx===-1||dropIdx===-1) return;
      const [moved]=openTabs.splice(srcIdx,1);
      if(srcIdx<dropIdx) dropIdx--;
      openTabs.splice(dropIdx,0,moved);
      renderTabs();
      saveSessionTabs();
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
const ai={
  ai1:{title:'AI Oturumu 1',msgs:[{w:'a',h:DEFAULT_AI_WELCOME}],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]},
  side_ai:{title:'Sağ Panel AI',msgs:[{w:'a',h:'Merhaba! Açık olan notun ve sol panelde işaretli <b>Kasa kaynaklarının</b> gerçek içeriğine bağlıyım. Soru sorabilir, özet/sınav föyü isteyebilir veya sağdan bir <b>Skill</b> çalıştırabilirsin.'}],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]}
};
let aiN=1;
function newSession(){
  aiN++;
  while(ai['ai'+aiN]) aiN++;
  const id='ai'+aiN;
  ai[id]={title:'AI Oturumu '+aiN,msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
  openPage(id);
}
function closeSession(id,ev){
  if(ev) ev.stopPropagation();
  if(id==='side_ai') return;
  const s=ai[id];
  if(s&&s.running) api('/api/stop',{session:id}).catch(()=>{});
  api('/api/clear',{session:id}).catch(()=>{});
  const tabIdx=openTabs.indexOf(id);
  openTabs=openTabs.filter(t=>t!==id);
  unlockedNotes.delete(id);
  pruneUnlockedNotes();
  delete ai[id];
  const realSessions=Object.keys(ai).filter(k=>k!=='side_ai');
  if(!realSessions.length){
    aiN=1;
    ai.ai1={title:'AI Oturumu 1',msgs:[{w:'a',h:DEFAULT_AI_WELCOME}],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]};
  }
  if(!openTabs.length){
    const fallback=(curMode==='ai')?'ai1':'kasalar';
    openTabs=[fallback];
  }
  if(active===id){
    const nextInTabs=openTabs[Math.min(Math.max(0,tabIdx),openTabs.length-1)];
    const remAI=openTabs.find(isAI)||'ai1';
    if(curMode==='ai'&&openTabs.some(isAI)){
      active=openTabs.find(isAI);
    }else if(curMode==='ai'&&!nextInTabs){
      if(!openTabs.includes(remAI)) openTabs.push(remAI);
      active=remAI;
    }else{
      active=nextInTabs||openTabs[openTabs.length-1];
      if(!isAI(active)&&curMode==='ai') layoutMode(active==='kasalar'?'kasalar':'write');
    }
  }
  renderSessions(); renderTabs(); renderTree(); renderMain();
}
function renderSessions(){
  const l=$('#sessions'); if(!l)return; l.innerHTML='';
  Object.entries(ai).filter(([id])=>id!=='side_ai').forEach(([id,s])=>{
    const d=document.createElement('div'); d.className='ses'+(id===active?' on':'');
    d.title=s.title;
    d.innerHTML=`<span class="sic">${svgIcon('◆')}</span><span class="st">${s.title}</span><small>${s.running?'<span class="spin"></span> çalışıyor':(s.unread?'● yeni sonuç':'boşta')}</small><button class="ses-x" title="Oturumu kapat" data-del="${id}">✕</button>`;
    d.onclick=e=>{
      if(e.target.closest('.ses-x')){ closeSession(id,e); return; }
      openPage(id);
    };
    l.appendChild(d);
  });
}
function aiBody(id){
  const s=ai[id];
  return (s.caveman?'<div class="mchip">🪨 caveman modu açık</div>':'')+s.msgs.map(x=>`<div class="msg ${x.w==='me'?'me':''}">${x.h}</div>`).join('')+
    (s.running?`<div class="run"><span class="spin"></span> Çalışıyor…<div class="st">${s.step}</div><div class="prog"><i></i></div></div>`:'');
}
function renderSideAi(){
  const c=$('#chat'), s=ai.side_ai;
  if(!c||!s) return;
  c.innerHTML=aiBody('side_ai');
  c.scrollTop=c.scrollHeight;
  const stBtn=$('#sideAiStop');
  if(stBtn) stBtn.style.display=(s.running||s.pending)?'inline-flex':'none';
  runMermaid('#chat .mermaid');
  renderStudyChatBody();
}
function clearSideAi(){
  api('/api/clear',{session:'side_ai'}).catch(()=>{});
  ai.side_ai.msgs=[{w:'a',h:'🧹 Sohbet bağlamı sıfırlandı. Seçili kaynaklarınla yeni bir soru sorabilirsin.'}];
  ai.side_ai.running=false; ai.side_ai.pending=null; ai.side_ai.attachments=[];
  renderChatAttachments('side_ai');
  renderSideAi();
}
function escAttr(v){
  return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const isChatImageFile=f=>f&&((f.type&&f.type.startsWith('image/'))||/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name||''));
function normalizedChatImgName(f){
  const raw=(f&&f.name)||'';
  if(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(raw)) return raw;
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
      const r=await fetch(`/api/upload?name=${encodeURIComponent(normalizedChatImgName(f))}&note=.chat_images`,{method:'POST',body:f});
      if(!r.ok){let m=r.statusText;try{m=(await r.json()).detail||m}catch(e){}throw new Error(m)}
      const u=await r.json();
      s.attachments.push({rel:u.rel,name:u.name,url:'/api/raw/'+encodeURI(u.rel)});
    }catch(e){ toast('⚠ Görsel yüklenemedi: '+e.message); }
  }
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
  const html=list.map((im,i)=>{
    const sn=escAttr(im.name||'Görsel');
    const sr=escAttr(im.rel||'');
    const su=escAttr(im.url||('/api/raw/'+encodeURI(im.rel||'')));
    return `<div class="att-chip"><img src="${su}" alt="${sn}" title="Önizle: ${sn}" data-rel="${sr}" data-name="${sn}" onclick="openRightViewer(this.dataset.rel,this.dataset.name)" ondblclick="openDocInTab(this.dataset.rel,this.dataset.name)"><button class="att-x" type="button" data-sess="${escAttr(sessionId)}" onclick="removeChatAttachment(this.dataset.sess,${i})" title="Görseli kaldır">✕</button></div>`;
  }).join('');
  if(sessionId==='side_ai'){
    const a=$('#sideAttach'); if(a) a.innerHTML=html;
    const b=$('#scAttach'); if(b) b.innerHTML=html;
  }else if(active===sessionId){
    const c=$('#aiAttach'); if(c) c.innerHTML=html;
  }
}
function wireChatDrop(el,getSessionId,onSkill){
  if(!el) return;
  const isSkillOk=ev=>onSkill&&!hasFiles(ev)&&ev.dataTransfer&&[...ev.dataTransfer.types].includes('text/plain');
  ['dragenter','dragover'].forEach(evName=>el.addEventListener(evName,ev=>{
    if(!hasFiles(ev)&&!isSkillOk(ev)) return;
    ev.preventDefault();
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
    if(hasFiles(ev)){
      ev.preventDefault(); ev.stopPropagation();
      const imgs=[...(ev.dataTransfer.files||[])].filter(isChatImageFile);
      if(imgs.length) attachChatImages(getSessionId(),imgs);
      else toast('Sohbete yalnızca görsel dosyaları bırakılabilir (notlara belge eklemek için 📎 kullan)');
      return;
    }
    if(isSkillOk(ev)){
      ev.preventDefault();
      onSkill(ev.dataTransfer.getData('text/plain'));
    }
  });
}
function runMermaid(sel,force=false){
  if(!window.mermaid)return;
  const mTheme=(typeof curTheme!=='undefined'&&(curTheme==='eink'||curTheme==='sepia'||curTheme==='mono-light'))?'neutral':'dark';
  $$(sel).forEach(el=>{
    if(!el.dataset.msrc) el.dataset.msrc=el.textContent;
    else if(force){ el.removeAttribute('data-processed'); el.textContent=el.dataset.msrc; }
  });
  try{ mermaid.initialize({startOnLoad:false,theme:mTheme}); mermaid.run({querySelector:sel}); }catch(e){}
}
function aiRefresh(id){
  if(id==='side_ai'){ renderSideAi(); renderTabs(); return; }
  if(active===id&&$('#aichat')){const c=$('#aichat');c.firstChild.innerHTML=aiBody(id);c.scrollTop=c.scrollHeight;aiHead(id);runMermaid('#aichat .mermaid');}
  renderTabs(); renderSessions();
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
const EFFORTS=[
  {id:'low',label:'Low',tip:'Hızlı yanıt (varsayılan)'},
  {id:'medium',label:'Medium',tip:'Dengeli hız ve analiz'},
  {id:'high',label:'High',tip:'Yüksek akıl yürütme'},
  {id:'xhigh',label:'XHigh',tip:'Maksimum derinlik (Gemini 4 Hydrogen)'}
];
let curEffort=localStorage.getItem('agydesk_effort')||'low';
if(!EFFORTS.some(e=>e.id===curEffort)) curEffort='low';
function effortOptionsHtml(){
  return EFFORTS.map(e=>`<option value="${e.id}" title="${e.tip}"${e.id===curEffort?' selected':''}>${e.label}</option>`).join('');
}
function effortSelectHtml(){
  return `<select class="eff-sel" onchange="setEffort(this.value)" title="Model düşünme derinliği (Effort)">${effortOptionsHtml()}</select>`;
}
function syncEffortSelects(){
  $$('.eff-sel').forEach(el=>{
    if(!el.options.length) el.innerHTML=effortOptionsHtml();
    el.value=curEffort;
  });
}
function setEffort(val){
  if(!EFFORTS.some(e=>e.id===val)) return;
  curEffort=val;
  persistUiState({agydesk_effort:val});
  syncEffortSelects();
}
function setMode2(id,m){ ai[id].mode=m; logAct(id,`İzin modu → ${MODES[m].i} ${MODES[m].n}`,'m'); aiHead(id); renderTabs(); }
function cycleMode(id){ const o=['g','y','r']; setMode2(id,o[(o.indexOf(ai[id].mode)+1)%3]); }
function aiHead(id){
  const h=$('#aihead'); if(!h)return; const s=ai[id];
  h.innerHTML=`<div class="seg">${Object.entries(MODES).map(([k,m])=>`<button class="${s.mode===k?'on '+k:''}" onclick="setMode2('${id}','${k}')" title="${m.d}">${m.i} ${m.n}</button>`).join('')}</div>
   <span class="mdesc">${MODES[s.mode].d}</span><span style="flex:1"></span>
   ${effortSelectHtml()}
   <button class="hb" ${s.checkpoints?'':'disabled'} onclick="aiUndo('${id}')">↶ Geri al (${s.checkpoints})</button>
   <button class="hb stop" ${s.running||s.pending?'':'disabled'} onclick="aiStop('${id}')">■ Dur</button>`;
}
async function aiUndo(id){ const s=ai[id]; if(!s.checkpoints)return;
  try{ const r=await api('/api/undo',{session:id}); s.checkpoints=0; s.msgs.push({w:'a',h:`↶ ${r.undone} checkpoint geri alındı. İzlenen dosyalar önceki duruma döndü.`}); }
  catch(e){ s.msgs.push({w:'a',h:'⚠ Geri alma başarısız: '+e.message}); }
  aiRefresh(id); }
async function aiStop(id){ const s=ai[id]; try{await api('/api/stop',{session:id});}catch(e){} s.pending=null; s.msgs=s.msgs.filter(m=>!m.ap); s.running=false; s.msgs.push({w:'a',h:'■ Durduruldu. Çalışan iş kesildi.'}); aiRefresh(id); }
function approve(id,yes){
  const s=ai[id],p=s.pending; if(!p)return;
  const alw=document.getElementById('alw-'+id); if(yes&&alw&&alw.checked){s.allow[p.risk]=true;}
  s.msgs=s.msgs.filter(m=>!m.ap); s.pending=null;
  if(yes){logAct(id,`✓ Onaylandı: ${p.text||'[Görsel]'}`,'ok'); aiSend(id,p.text,p.skill,true,true,p.images||[]);}
  else{s.msgs.push({w:'a',h:'✗ Reddedildi. İşlem yapılmadı.'}); logAct(id,`✗ Reddedildi: ${p.text||'[Görsel]'}`,'w'); aiRefresh(id);}
}
function renderAI(m){
  const s=ai[active]; s.unread=false;
  m.scrollTop=0;
  m.innerHTML=`<div class="aiwrap"><div class="aihead" id="aihead"></div><div class="aichat" id="aichat"><div class="col">${aiBody(active)}</div></div>
   <div class="aiin" id="aidrop"><div class="col"><div class="aihint">⬇ Skill kartını veya görseli buraya bırak · Ctrl+V yapıştır · / ile komut</div>
   <div class="chat-att-bar ai-att-bar" id="aiAttach"></div>
   <div class="inp"><button class="att-btn" id="aiImgBtn" type="button" onclick="pickChatImages('${active}')" title="Sohbete resim ekle (veya Ctrl+V yapıştır / sürükle-bırak)">🖼</button><textarea id="aiInput" rows="1" placeholder="Bu oturuma bir görev ver…"></textarea><button class="btn" id="aiSend">Gönder</button></div></div></div></div>`;
  aiHead(active);
  const inp=$('#aiInput'),go=()=>{
    const cur=ai[active], v=inp.value;
    if(!v.trim()&&!(cur&&cur.attachments&&cur.attachments.length))return;
    inp.value='';autoGrow(inp);aiSend(active,v);
  };
  $('#aiSend').onclick=go; inp.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();go()}}; inp.oninput=()=>autoGrow(inp); inp.focus();
  wireChatDrop($('#aidrop'),()=>active,k=>{if(SK[k])aiSend(active,SK[k].prompt||('Skill: '+SK[k].h),k);});
  wireChatDrop($('#aichat'),()=>active);
  renderChatAttachments(active);
  const c=$('#aichat'); c.scrollTop=c.scrollHeight; renderSessions(); renderTabs(); runMermaid('#aichat .mermaid');
}
async function aiSend(id,text,skill,ok,resume,explicitImgs){
  const s=ai[id]; if(!s) return;
  const rawText=String(text||'').trim();
  if(!skill&&rawText.startsWith('/')){const k=rawText.slice(1).split(' ')[0]; if(SK[k])skill=k;}
  if(skill&&SK[skill]&&(SK[skill].kind==='cmd'||SK[skill].kind==='mode')){s.msgs.push({w:'me',h:'/'+skill});aiInstant(id,skill);return;}
  if(s.running||s.pending){s.msgs.push({w:'a',h:'Bu oturum meşgul veya onay bekliyor. Onayla ya da ■ Dur butonuna bas.'});aiRefresh(id);return;}
  const imgs=ok?(explicitImgs||[]):[...(s.attachments||[])];
  if(!rawText&&!imgs.length) return;
  if(!ok){
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
    s.msgs.push({w:'me',h:msgHtml});
    api('/api/chats',{session:id,w:'me',h:msgHtml}).catch(()=>{});
  }
  if(id!=='side_ai'&&s.title.startsWith('AI Oturumu')){
    const ttl=(rawText||(imgs[0]&&imgs[0].name)||'Görsel analizi').replace(/^Skill: /,'');
    s.title=ttl.slice(0,22);
  }
  const actNote=String(active).startsWith('note:')?active.slice(5):null;
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
      sources:getCheckedSources(),
      active_note:actNote
    });
  }catch(e){ s.msgs.push({w:'a',h:'⚠ Backend hatası: '+e.message}); aiRefresh(id); return; }
  if(res.status==='approval'){
    s.pending={text:rawText,skill,risk:res.risk,images:imgs};
    const why=res.risk==='risky'?'Riskli işlem (silme / dış gönderim / geri alınamaz)':'Dosya yazma / komut çalıştırma';
    s.msgs.push({w:'a',ap:true,h:`<div class="appr"><b>⚠ Onay gerekli</b><div>${why}:<br><code>${(rawText||'[Görsel analizi]').replace(/</g,'&lt;')}</code></div><label><input type="checkbox" id="alw-${id}"> Bu oturumda bu tür işlemlere hep izin ver</label><div class="ab"><button class="btn" onclick="approve('${id}',true)">İzin ver</button><button class="hb" onclick="approve('${id}',false)">Reddet</button></div></div>`});
    aiRefresh(id); return;
  }
  s.running=true; s.checkpoints=res.checkpoints; s.step='Yönlendiriliyor → '+res.route.label; aiRefresh(id);
}
/* ---------- Sunucu olayları (SSE) ---------- */
function startEvents(){
  const es=new EventSource('/api/events');
  es.onmessage=e=>{
    const d=JSON.parse(e.data), s=ai[d.session];
    if(d.event==='step'&&s){s.step=d.step;aiRefresh(d.session);}
    else if(d.event==='done'&&s){
      s.running=false; if(d.quota)applyQuota(d.quota);
      linkifyAndOpen(d.reply);
      const r=d.route, c=r.provider==='local'?'l':'c', safe=mdToHtml(d.reply);
      const effChip=d.effort?`<span class="chip">${d.effort}</span>`:'';
      const tok=d.tokens?`<span class="chip">${d.tokens} token</span>`:'';
      const badge=d.real?(r.provider==='local'?'':'<span class="chip c">agy CLI</span>'):'<span class="chip">Yerel</span>';
      const printBtn=`<button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="window.print()" title="Canon G3080 A4 Çift Yüz Renkli Yazdır">🖨 Yazdır</button>`;
      const h=`${safe}<div class="route"><span class="chip ${c}">${r.label}</span>${effChip}<span>${r.reason}</span>${badge}${tok}${printBtn}</div>`;
      s.msgs.push({w:'a',h});
      if(d.session==='side_ai'&&studioPendingTitle){ studioAdd(studioPendingTitle,d.reply,safe); studioPendingTitle=null; }
      api('/api/chats',{session:d.session,w:'a',h}).catch(()=>{});
      if(d.session==='side_ai' && $('#outs')){
        const outBox=document.createElement('div'); outBox.className='out';
        outBox.innerHTML=`<div class="oh"><span>◆ AI Çıktısı · ${r.label}</span><span><button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="appendReplyToNote(this)" data-md="${encodeURIComponent(d.reply)}">📝 Nota Ekle</button> <button class="hb" style="padding:1px 7px;font-size:10.5px" onclick="window.print()">🖨 Canon A4 Yazdır</button></span></div><div class="ob">${safe}</div>`;
        $('#outs').appendChild(outBox);
        runMermaid('#outs .mermaid');
      }
      if(d.session!=='side_ai'&&active!==d.session){s.unread=true;toast(`✓ "${s.title}" tamamlandı`,d.session);}
      aiRefresh(d.session);
      loadVault();
    }
    else if(d.event==='error'&&s){ s.running=false; if(d.quota)applyQuota(d.quota); s.msgs.push({w:'a',h:'⚠ Sağlayıcı hatası: '+String(d.error).replace(/</g,'&lt;')}); aiRefresh(d.session); }
    else if(d.event==='log'){ loadLog(); }
  };
  es.onerror=()=>{ setTimeout(()=>{ loadChats(); loadVault(); loadHealth(); }, 2500); };
}
async function appendReplyToNote(btn){
  if(!String(active).startsWith('note:')) return;
  const raw=decodeURIComponent(btn.dataset.md||'');
  const rel=active.slice(5);
  const n=noteCache[active];
  if(!n) return;
  try{
    noteCache[active]=await api('/api/note',{rel,content:n.content.replace(/\s*$/,'')+'\n\n---\n\n'+raw+'\n'});
    renderMain();
    toast('💾 Yanıt nota eklendi ve kaydedildi',active);
  }catch(e){ alert('Nota eklenemedi: '+e.message); }
}
async function loadChats(){
  try{
    const all=await api('/api/chats');
    Object.entries(all).forEach(([sid,msgs])=>{
      if(!ai[sid]){ aiN++; ai[sid]={title:'AI Oturumu '+sid.replace('ai',''),msgs:[],running:false,unread:false,step:'',mode:'y',allow:{},checkpoints:0,timers:[],pending:null,attachments:[]}; }
      if(msgs&&msgs.length){
        ai[sid].msgs=msgs.map(m=>({w:m.w,h:(m.w==='a'&&m.h&&!String(m.h).trim().startsWith('<'))?mdToHtml(m.h):m.h}));
        if(sid!=='side_ai'){
          const firstMe=msgs.find(m=>m.w==='me');
          if(firstMe){
            const stripped=firstMe.h.replace(/<[^>]+>/g,'').trim();
            ai[sid].title=(stripped||'Görsel analizi').slice(0,22);
          }
        }
      }
    });
    renderSessions(); renderTabs(); renderSideAi();
    if(isAI(active)) renderMain();
  }catch(e){}
}
function toast(t,id){
  const d=document.createElement('div'); d.className='toast'; d.textContent=t; d.onclick=()=>{if(id)openPage(id);d.remove()};
  document.body.appendChild(d); setTimeout(()=>d.remove(),6000);
}

/* ---------- NotebookLM Tarzı Kasalar Ana Ekranı & Modallar ---------- */
function fmtRelTime(ts){
  if(!ts) return '';
  const diff=Math.max(0,Math.floor(Date.now()/1000-ts));
  if(diff<60) return 'Az önce';
  if(diff<3600) return `${Math.floor(diff/60)} dk önce`;
  if(diff<86400) return `Bugün ${new Date(ts*1000).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}`;
  return new Date(ts*1000).toLocaleDateString('tr-TR',{day:'numeric',month:'short'});
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
        const sp=getSpaceObj(d.space);
        return `<button type="button" class="rdoc" onclick="openPage('${escHtml(d.id)}')" title="${escHtml(d.rel)}">
          <span>${escHtml(d.icon||'📄')}</span>
          <span>${escHtml(d.title)}</span>
          ${sp?`<span class="rdoc-sp">${escHtml(sp.icon)} ${escHtml(sp.title)}</span>`:''}
        </button>`;
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
function renderKasalarHome(m){
  const q=kasaSearchQ.trim().toLowerCase();
  const activeSpaceObj=currentSpace!=='all'?getSpaceObj(currentSpace):null;
  const totalKasas=kasalarData.length;
  const totalNotes=kasalarData.reduce((a,k)=>a+(k.counts?k.counts.notes:0),0);
  const totalDocs=kasalarData.reduce((a,k)=>a+(k.counts?k.counts.docs+k.counts.images:0),0);

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
      .filter(([id,p])=>id.startsWith('note:')&&p&&(!activeSpaceObj||p.space===activeSpaceObj.id)&&((p.t||'').toLowerCase().includes(q)||(p.rel||'').toLowerCase().includes(q)))
      .slice(0,10);

    m.innerHTML=`<div class="khome">
      ${activeSpaceObj?`<div class="snav">
        <div class="snav-left">
          <button type="button" class="snav-back" onclick="selectSpaceFilter('all')">← Tüm Alanlar</button>
          <span class="spill on" style="--sp-acc:${escHtml(activeSpaceObj.accent||'#e0a458')}">${escHtml(activeSpaceObj.icon)} ${escHtml(activeSpaceObj.title)}</span>
        </div>
      </div>`:''}
      <div class="khero">
        <div>
          <h1><span style="color:var(--cu)">🔎</span> Arama Sonuçları</h1>
          <p>"<b>${escHtml(kasaSearchQ)}</b>" için ${activeSpaceObj?`<b>${escHtml(activeSpaceObj.title)}</b> alanında`:'tüm alanlarda'} <b>${kMatches.length} kasa</b>, <b>${pageHits.length} doğrudan not/belge</b> bulundu.</p>
        </div>
        <div class="kbar">
          <input class="ksrch" id="kasaSrchIn" placeholder="Alan, kasa veya not ara…" value="${escHtml(kasaSearchQ)}">
          <button class="hb" onclick="kasaSearchQ='';renderKasalarHome($('#main'))">✕ Temizle</button>
        </div>
      </div>
      ${kMatches.length?`<div class="ksect-hd"><h2>❖ Eşleşen Kasalar</h2><span class="ksect-sub">${kMatches.length}</span></div>
        <div class="kgrid">${kMatches.map(k=>renderKasaCardHtml(k,true)).join('')}</div>`
      :`<div class="scard-empty" style="margin-bottom:24px"><span>Bu alanda "${escHtml(kasaSearchQ)}" ile eşleşen kasa yok.</span>${activeSpaceObj?`<button class="hb" onclick="selectSpaceFilter('all')">Tüm Alanlarda Ara</button>`:''}</div>`}
      ${pageHits.length?`<div class="ksect-hd"><h2>📄 Doğrudan Eşleşen Not &amp; Belgeler</h2><span class="ksect-sub">${pageHits.length}</span></div>
        <div class="rdocs">${pageHits.map(([id,p])=>`<button type="button" class="rdoc" onclick="${p.kasa?`currentKasa='${p.kasa}';${p.space?`currentSpace='${p.space}';`:''}rebuildTreeAndSources();`:''}openPage('${escHtml(id)}')"><span>${escHtml(p.i||'📄')}</span><span>${escHtml(p.t||id)}</span><span class="rdoc-sp">${escHtml(p.folder||'Ortak')}</span></button>`).join('')}</div>`:''}
      ${otherMatches.length?`<div class="ksect-hd"><h2>🗂 Diğer Alanlardaki Eşleşmeler</h2><span class="ksect-sub">${otherMatches.length}</span></div>
        <div class="kgrid">${otherMatches.map(k=>renderKasaCardHtml(k,true)).join('')}</div>`:''}
    </div>`;
  }else if(!activeSpaceObj){
    /* ---- SEVİYE 1: ÇALIŞMA ALANLARI (Dönem 7, Dönem 8, Belgeler & Arşiv, Özel Alanlar) ---- */
    m.innerHTML=`<div class="khome">
      <div class="khero">
        <div>
          <h1><span style="color:var(--cu)">❖</span> Çalışma Alanları</h1>
          <p>Derslerini ve belgelerini dönem ve türe göre düzenli tut · <b>${spacesData.length} alan</b>, <b>${totalKasas} kasa</b>, <b>${totalNotes} not</b>, <b>${totalDocs} kaynak</b>.</p>
        </div>
        <div class="kbar">
          <input class="ksrch" id="kasaSrchIn" placeholder="Alan, kasa veya ders notu ara…" value="">
          <button class="btn" style="padding:8px 14px" onclick="openSpaceModal()">＋ Yeni Alan</button>
          <button class="hb" onclick="openNewKasaModal()">＋ Yeni Kasa</button>
          <button class="hb" onclick="triggerAssetUpload()" title="Aktif kasaya belge/fotoğraf yükle">📎 Belge Ekle</button>
        </div>
      </div>

      <div class="ksect-hd">
        <h2>🗂 Çalışma Alanların (${spacesData.length})</h2>
        <span class="kdrag-hint">Alan kartına tıkla → içindeki kasaları gör</span>
      </div>
      <div class="sgrid">
        ${spacesData.map(sp=>{
          const spKasas=kasalarData.filter(k=>k.space===sp.id);
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

      ${renderRootDocsHtml(rootDocsData)}
      ${renderToolsGridHtml()}
    </div>`;
  }else{
    /* ---- SEVİYE 2: SEÇİLİ ÇALIŞMA ALANI İÇİNDEKİ KASALAR ---- */
    const sp=activeSpaceObj;
    const spKasas=kasalarData.filter(k=>k.space===sp.id);
    const spNotes=spKasas.reduce((a,k)=>a+(k.counts?k.counts.notes:0),0);
    const spDocs=spKasas.reduce((a,k)=>a+(k.counts?k.counts.docs+k.counts.images:0),0);
    const spRoots=rootDocsData.filter(d=>d.space===sp.id);

    const pillsHtml=spacesData.map(s=>`
      <button type="button" class="spill ${s.id===sp.id?'on':''}" style="--sp-acc:${escHtml(s.accent||'#e0a458')}" onclick="enterSpace('${escHtml(s.id)}')" ondragover="handleSpaceDragOver(event,this)" ondragleave="handleSpaceDragLeave(this)" ondrop="handleSpaceDrop(event,'${escHtml(s.id)}')" title="${escHtml(s.title)} · Kasayı buraya sürükleyip taşıyabilirsin">
        <span>${escHtml(s.icon||'🗂')}</span>
        <span>${escHtml(s.title)}</span>
        <span class="spill-cnt">${s.count_kasas||0}</span>
      </button>
    `).join('')+`<button type="button" class="spill" onclick="openSpaceModal()" title="Yeni Çalışma Alanı Oluştur">＋ Yeni Alan</button>`;

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
          <input class="ksrch" id="kasaSrchIn" placeholder="Bu alanda kasa veya not ara…" value="">
          <button class="hb" onclick="openSpaceModal('${escHtml(sp.id)}')">✎ Alanı Düzenle</button>
          <button class="hb" onclick="triggerSpaceUpload('${escHtml(sp.id)}')">📎 Belge Ekle</button>
          <button class="btn" style="padding:8px 14px" onclick="openNewKasaModal('${escHtml(sp.id)}')">＋ Yeni Kasa</button>
        </div>
      </div>

      <div class="ksect-hd">
        <h2>❖ Kasalar (${spKasas.length})</h2>
        ${spKasas.length?`<span class="kdrag-hint">İpucu: Kartı üstteki başka bir alan hapına sürükleyerek taşıyabilirsin</span>`:''}
      </div>
      ${cardsHtml}
      ${renderRootDocsHtml(spRoots)}
      ${renderToolsGridHtml()}
    </div>`;
  }

  const sIn=$('#kasaSrchIn');
  if(sIn){
    sIn.oninput=e=>{ kasaSearchQ=e.target.value; renderKasalarHome(m); const el=$('#kasaSrchIn'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} };
  }
}

function closeKasaModal(){ $('#kasaModal').classList.remove('show'); }
$('#kasaModal').onclick=e=>{ if(e.target.id==='kasaModal') closeKasaModal(); };

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
  setTimeout(()=>{ const el=$('#msTitle'); if(el){ el.focus(); el.onkeydown=e=>{ if(e.key==='Enter') submitSpace(existing?existing.id:null); }; } },50);
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
  setTimeout(()=>{ const inp=$('#mfName'); if(inp){ inp.focus(); inp.onkeydown=e=>{ if(e.key==='Enter') submitNewFolder(); }; } },50);
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
      const r=await fetch(`/api/upload?name=${encodeURIComponent(f.name)}&note=${encodeURIComponent(targetRel)}`,{method:'POST',body:f});
      if(!r.ok){let m=r.statusText;try{m=(await r.json()).detail||m}catch(e){}throw new Error(m)}
      uploaded.push(await r.json());
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

    host.innerHTML=`
      <div class="src" style="margin:0"><span>Kasa</span><b class="mono" style="color:var(--cu)">${p.folder||'—'}</b></div>
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
let _pdfNavSeq=0;
function getPdfSlot(id){
  return pdfSlotMap.get(id)||null;
}
function removePdfSlot(id){
  const slot=pdfSlotMap.get(id);
  if(slot){ slot.remove(); pdfSlotMap.delete(id); }
}
function syncPdfSlotsWithTabs(){
  const keep=new Set(openTabs);
  for(const [id,slot] of pdfSlotMap.entries()){
    if(!keep.has(id)){ slot.remove(); pdfSlotMap.delete(id); }
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
function getPdfState(id){
  if(!pdfState[id]){
    pdfState[id]={page:1,totalPages:0,zoom:'FitH',filter:localStorage.getItem('agydesk_pdf_filter')||'normal',drawer:null,scratch:localStorage.getItem('agydesk_scratch_'+id)||''};
  }
  return pdfState[id];
}
function buildPdfUrl(rel,st,bust=false){
  const z=st.zoom||'FitH';
  const zoomParam=(z==='FitH'||z==='Fit')?`view=${z}`:`zoom=${z}`;
  const q=bust?`?_pv=${++_pdfNavSeq}`:'';
  return `/api/raw/${encodeURI(rel)}${q}#page=${st.page||1}&${zoomParam}`;
}
function updatePdfFrame(id,reloadHash=false){
  const st=getPdfState(id);
  const slot=getPdfSlot(id);
  const root=slot||document;
  const wrap=slot?slot.querySelector('.pdf-frame-wrap'):$('#pdfFrameWrap');
  if(wrap){
    wrap.classList.toggle('night',st.filter==='night');
    wrap.classList.toggle('sepia',st.filter==='sepia');
  }
  root.querySelectorAll('.pdf-flt-btn').forEach(b=>b.classList.toggle('on',b.dataset.flt===st.filter));
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
function setPdfFilter(id,flt){
  const st=getPdfState(id);
  st.filter=(st.filter===flt&&flt!=='normal')?'normal':flt;
  persistUiState({agydesk_pdf_filter:st.filter});
  updatePdfFrame(id,false);
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

function renderPptxSlidesHtml(d){
  if(d&&d.note) return `<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">${escHtml(d.title||'Sunum')}</h2><span class="pptx-slide-num">Bilgi</span></div><div class="pptx-slide-body"><p>${escHtml(d.note)}</p></div></div>`;
  const slides=(d&&d.slides)||[];
  if(!slides.length) return `<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">${escHtml((d&&d.title)||'Sunum')}</h2></div><div class="pptx-slide-body"><p>Bu sunumda okunabilir metin veya görsel slayt bulunamadı.</p></div></div>`;
  return slides.map(s=>{
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

    slot=document.createElement('div');
    slot.className='pdf-tab-slot active';
    slot.dataset.pdfId=id;
    slot.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}">
          <span>📄</span><b>${p.t}</b>
        </div>
        <span class="pdf-badge pdf-meta-badge">${st.totalPages?`${st.totalPages} sayfa`:'PDF Stüdyosu'}</span>

        <div class="pdf-grp" title="Okuma Modu (Gece / Sepya / Orijinal)">
          <button class="pdf-flt-btn ${st.filter==='normal'?'on':''}" data-flt="normal" onclick="setPdfFilter('${id}','normal')" title="Orijinal Beyaz Kağıt">☀ Orijinal</button>
          <button class="pdf-flt-btn ${st.filter==='night'?'on':''}" data-flt="night" onclick="setPdfFilter('${id}','night')" title="Gece Okuma Modu (Göz Yormayan Karanlık Filtre)">🌙 Gece</button>
          <button class="pdf-flt-btn ${st.filter==='sepia'?'on':''}" data-flt="sepia" onclick="setPdfFilter('${id}','sepia')" title="Sıcak Sepya Kitap Modu">📜 Sepya</button>
        </div>

        <span style="flex:1"></span>

        <div class="pdf-grp">
          <button class="pdf-drw-btn ${st.drawer==='text'?'on':''}" data-drw="text" onclick="togglePdfDrawer('${id}','text')" title="PDF içindeki metinleri ve formülleri sayfa sayfa incele / kopyala">🔍 Metin &amp; OCR</button>
          <button class="pdf-drw-btn ${st.drawer==='scratch'?'on':''}" data-drw="scratch" onclick="togglePdfDrawer('${id}','scratch')" title="PDF okurken yan tarafta hızlı çalışma notu tut">✎ Not Tut</button>
        </div>

        <button class="hb pdf-ai-btn" style="${isSrcChecked?'border-color:var(--ok);color:var(--ok)':''}" onclick="onSourceCheck('${rel}',!checkedSources.has('${rel}'));renderMain()" title="Bu PDF'i AI kaynaklarına bağla/çıkar">${isSrcChecked?'✓ AI Kaynağı':'＋ AI\'a Bağla'}</button>
        <button class="hb" style="border-color:var(--cu);color:var(--cu)" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('ozet')" title="Bu PDF'i sağdaki AI asistanına özetlet">✨ AI Özetle</button>
        <button class="hb" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('fisle')" title="Bu PDF'ten A4 Sınav Föyü çıkar">▤ Sınav Föyü</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')" title="Bu PDF'i sağ panele sabitleyip not sekmene geri dön (Yan Yana Çalışma)">📌 Sağ Panele Al</button>
        <button class="hb" onclick="toggleZen()" title="Kenar panellerini gizle / Tam odak modu (Ctrl+.)">◐ Odak</button>
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
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap" title="${p.folder||''} · ${rel}"><span>📊</span><b>${p.t}</b></div>
        <span class="pdf-badge" id="pptxMetaBadge">Sunum · PDF Görünümü</span>
        <div class="pdf-grp" title="Okuma Modu (Gece / Sepya / Orijinal)">
          <button class="pdf-flt-btn ${st.filter==='normal'?'on':''}" data-flt="normal" onclick="setPdfFilter('${id}','normal')">☀ Orijinal</button>
          <button class="pdf-flt-btn ${st.filter==='night'?'on':''}" data-flt="night" onclick="setPdfFilter('${id}','night')">🌙 Gece</button>
          <button class="pdf-flt-btn ${st.filter==='sepia'?'on':''}" data-flt="sepia" onclick="setPdfFilter('${id}','sepia')">📜 Sepya</button>
        </div>
        <span style="flex:1"></span>
        <button class="hb" style="${isSrcChecked?'border-color:var(--ok);color:var(--ok)':''}" onclick="onSourceCheck('${rel}',!checkedSources.has('${rel}'));renderMain()">${isSrcChecked?'✓ AI Kaynağı':'＋ AI\'a Bağla'}</button>
        <button class="hb" style="border-color:var(--cu);color:var(--cu)" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('ozet')">✨ AI Özetle</button>
        <button class="hb" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('fisle')">▤ Sınav Föyü</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()" title="Sunumu PDF olarak kaydet / A4 Yazdır">🖨 PDF / Yazdır</button>
        <button class="hb" onclick="toggleZen()">◐ Odak</button>
      </div>
      <div class="pptx-stage ${filtCls}" id="pdfFrameWrap">
        <div style="padding:40px;color:#ccc"><span class="spin"></span> Sunum PDF sayfalarına dönüştürülüyor…</div>
      </div>
    </div>`;
    try{
      const d=await api('/api/pptx?rel='+encodeURIComponent(rel));
      const stage=$('#pdfFrameWrap');
      if(stage) stage.innerHTML=renderPptxSlidesHtml(d);
      const b=$('#pptxMetaBadge');
      if(b) b.textContent=`${d.count||0} slayt · Sunum`;
    }catch(e){
      const stage=$('#pdfFrameWrap');
      if(stage) stage.innerHTML=`<div class="pptx-slide"><div class="pptx-slide-head"><h2 class="pptx-slide-title">Sunum okunamadı</h2></div><div class="pptx-slide-body"><p>${escHtml(e.message)}</p></div></div>`;
    }
    updateRightProps();
    return;
  }

  if(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)){
    const st=getPdfState(id);
    if(typeof st.imgZoom!=='number') st.imgZoom=100;
    if(typeof st.imgRot!=='number') st.imgRot=0;
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
          <button onclick="const s=getPdfState('${id}');s.imgZoom=100;s.imgRot=0;s.imgInv=false;renderMain()">Sıfırla</button>
        </div>
        <div class="pdf-grp">
          <button onclick="const s=getPdfState('${id}');s.imgRot=((s.imgRot||0)-90)%360;renderMain()" title="Sola Döndür">↺ 90°</button>
          <button onclick="const s=getPdfState('${id}');s.imgRot=((s.imgRot||0)+90)%360;renderMain()" title="Sağa Döndür">↻ 90°</button>
          <button class="${st.imgInv?'on':''}" onclick="const s=getPdfState('${id}');s.imgInv=!s.imgInv;renderMain()" title="Renkleri Ters Çevir (Şema/Tahta İnceleme)">◑ Kontrast</button>
        </div>
        <div class="pdf-grp" title="Okuma Modu">
          <button class="pdf-flt-btn ${st.filter==='normal'?'on':''}" data-flt="normal" onclick="setPdfFilter('${id}','normal')">☀</button>
          <button class="pdf-flt-btn ${st.filter==='night'?'on':''}" data-flt="night" onclick="setPdfFilter('${id}','night')">🌙</button>
          <button class="pdf-flt-btn ${st.filter==='sepia'?'on':''}" data-flt="sepia" onclick="setPdfFilter('${id}','sepia')">📜</button>
        </div>
        <span style="flex:1"></span>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')" title="Görseli sağ panele sabitleyip nota dön">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()" title="A4 Yazdır">🖨</button>
        <button class="hb" onclick="toggleZen()">◐ Odak</button>
      </div>
      <div class="img-studio ${filtCls}" id="pdfFrameWrap">
        <img src="/api/raw/${encodeURI(rel)}" style="transform:scale(${(st.imgZoom||100)/100}) rotate(${st.imgRot||0}deg);${st.imgInv?'filter:invert(0.92) hue-rotate(180deg)':''}">
      </div>
    </div>`;
    updateRightProps();
    return;
  }

  if(/\.(docx?)$/i.test(ext)){
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap"><span>📘</span><b>${p.t}</b></div>
        <span class="pdf-badge">Word Belgesi · ${p.folder||''}</span>
        <span style="flex:1"></span>
        <button class="hb" style="border-color:var(--cu);color:var(--cu)" onclick="checkedSources.add('${rel}');rebuildTreeAndSources();runSkill('ozet')">✨ AI Özetle</button>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="window.print()">🖨 A4 Yazdır</button>
      </div>
      <div style="flex:1;overflow:auto;padding:8px 0"><div class="doc" id="docxMainBody"><span class="spin"></span> Word belgesi okunuyor…</div></div>
    </div>`;
    try{
      const d=await api('/api/docx?rel='+encodeURIComponent(rel));
      const host=$('#docxMainBody');
      if(host) host.innerHTML=`<h1>${p.t}</h1><div class="meta"><span>📘 ${p.folder||''}</span><span>·</span><span>${rel}</span></div><div class="rview-docx" style="padding:0">${d.html}</div>`;
    }catch(e){
      const host=$('#docxMainBody');
      if(host) host.innerHTML=`<h1>Belge okunamadı</h1><p>${e.message}</p>`;
    }
    updateRightProps();
    return;
  }

  if(ext==='.html'){
    m.innerHTML=`<div class="pdf-studio">
      <div class="pdf-bar">
        <div class="pdf-title-wrap"><span>${p.i||'🌐'}</span><b>${p.t}</b></div>
        <span class="pdf-badge">${p.folder} · ${rel}</span>
        <span style="flex:1"></span>
        <button class="hb" onclick="dockDocToRightAndReturn('${id}')">📌 Sağ Panele Al</button>
        <button class="hb" onclick="toggleZen()">◐ Odak</button>
      </div>
      <iframe src="/api/raw/${encodeURI(rel)}" style="flex:1;border:0;width:100%;background:#fff"></iframe>
    </div>`;
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
  notionState.locked=!unlockedNotes.has(id);
  if(notionState.locked) editMode=false;
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
        <span class="nc-item" onclick="enterKasa('${n.kasa||p.kasa||''}','write')">📘 ${n.folder}</span>
        <span>/</span>
        <span class="nc-cur">${p.t||n.rel.split('/').pop()}</span>
      </div>
      <span class="notion-lock-pill ${notionState.locked?'locked':''}" onclick="toggleNotionLock('${id}')" title="Notion tarzı kilitle / düzenlemeyi aç">
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

function parseNoteBlocks(md){
  const lines=String(md||'').replace(/\r\n/g,'\n').split('\n');
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

function serializeNoteBlocks(blocks){
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
  return out.join('\n')+'\n';
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
    const resolveRel=t=>/^https?:\/\//i.test(t)?t:(base?base+'/'+t:t);
    if(/\.(pdf|docx?|pptx?|xlsx?|csv|txt|png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(target)){
      const rel=resolveRel(target);
      const safeLbl=label.replace(/'/g,'');
      const ext=target.slice(target.lastIndexOf('.')).toLowerCase();
      const ic=ext==='.pdf'?'📄':(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(ext)?'🖼':'📘');
      return stash(`<span class="n-wiki-chip" contenteditable="false" data-raw="${escAttr(raw)}" onclick="openRightViewer('${escAttr(rel)}','${escAttr(safeLbl)}')" ondblclick="openDocInTab('${escAttr(rel)}','${escAttr(safeLbl)}')" title="Tıkla: Sağda önizle · Çift tıkla: Sekmede aç (${escAttr(rel)})">${ic} ${escHtml(label)}</span>`);
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
  s=s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,'<a href="$2" data-mdlink="$2" onclick="if(event.ctrlKey||notionState.locked)window.open(this.href,\'_blank\')">$1</a>');

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
  if(!_notionUndoApplying) scheduleNotionUndoSnapshot(320);
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
    api('/api/note',{rel,content:ed.value}).then(saved=>{
      noteCache[id]=saved;
      setSavePillState('saved','✓ Kaydedildi');
      updateRightProps();
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
  setSavePillState('saving','● Kaydediliyor…');
  try{
    noteCache[id]=await api('/api/note',{rel,content:md});
    setSavePillState('saved','✓ Kaydedildi');
    updateRightProps();
    renderNotionMinimap();
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
      <div class="ctool" style="opacity:1;pointer-events:auto;transform:none">
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
      const mdNow=editableDomToInlineMd(t);
      const inlineMathMatch=rawTxt.match(/\$([^$\n]{1,80})\$\s$/);
      if(inlineMathMatch){
        b.text=mdNow;
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
    const md=serializeNoteBlocks([b]).trim();
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
document.addEventListener('selectionchange',()=>{
  const bb=$('#notionBubble'); if(!bb) return;
  if(notionState.locked||editMode){ bb.classList.remove('show'); return; }
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.toString().trim()){ bb.classList.remove('show'); return; }
  const anchor=sel.anchorNode?(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement):null;
  if(!anchor||!anchor.closest||!anchor.closest('#mdView')){ bb.classList.remove('show'); return; }
  const r=sel.getRangeAt(0).getBoundingClientRect();
  if(!r.width&&!r.height){ bb.classList.remove('show'); return; }
  const selEl=$('#nbTurnSel');
  if(selEl) selEl.value='';
  bb.classList.add('show');
  const x=Math.max(12,Math.min(window.innerWidth-390,r.left+r.width/2-180));
  const y=Math.max(10,r.top-42);
  bb.style.left=x+'px';
  bb.style.top=y+'px';
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
function renderNotionMinimap(){
  const mm=$('#notionMinimap'); if(!mm) return;
  const headings=[];
  notionState.blocks.forEach((b,idx)=>{
    if(b.type==='h1'||b.type==='h2'||b.type==='h3'){
      const lvl=Number(b.type.slice(1));
      const clean=(b.text||'').replace(/[*_`~=$]/g,'').trim();
      if(clean) headings.push({idx,lvl,text:clean});
    }
  });
  if(headings.length<2){ mm.style.display='none'; return; }
  mm.style.display='flex';
  mm.innerHTML=headings.map(h=>`<div class="nm-tick lvl-${h.lvl}" data-bidx="${h.idx}" onclick="scrollToNotionBlock(${h.idx})" title="${escAttr(h.text)}"></div>`).join('')+
    `<div class="nm-card">
      <div class="nm-head">İçindekiler (${headings.length} başlık)</div>
      ${headings.map(h=>`<div class="nm-link lvl-${h.lvl}" data-bidx="${h.idx}" onclick="scrollToNotionBlock(${h.idx})">${escHtml(h.text)}</div>`).join('')}
    </div>`;
  syncNotionMinimapActive();
}

function setMinimapActiveIdx(idx){
  document.querySelectorAll('#notionMinimap .nm-tick, #notionMinimap .nm-link').forEach(x=>{
    x.classList.toggle('on',Number(x.dataset.bidx)===idx);
  });
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
  const ticks=[...mm.querySelectorAll('.nm-tick')];
  if(!ticks.length) return;
  const scRect=sc.getBoundingClientRect();
  const threshold=scRect.top+96;
  const atBottom=(sc.scrollTop+sc.clientHeight)>=sc.scrollHeight-6;
  let activeIdx=Number(ticks[0].dataset.bidx);
  if(atBottom){
    for(const t of ticks){
      const bidx=Number(t.dataset.bidx);
      const blk=view.querySelector(`.nblock[data-bidx="${bidx}"]`);
      if(!blk) continue;
      if(blk.getBoundingClientRect().top<=scRect.bottom-24) activeIdx=bidx;
    }
  }else{
    for(const t of ticks){
      const bidx=Number(t.dataset.bidx);
      const blk=view.querySelector(`.nblock[data-bidx="${bidx}"]`);
      if(!blk) continue;
      if(blk.getBoundingClientRect().top<=threshold) activeIdx=bidx;
      else break;
    }
  }
  setMinimapActiveIdx(activeIdx);
}

function scrollToNotionBlock(idx){
  const el=$('#mdView')?.querySelector(`.nblock[data-bidx="${idx}"]`);
  if(el){
    _mmClickLock={idx,until:Date.now()+600};
    setMinimapActiveIdx(idx);
    el.scrollIntoView({behavior:'smooth',block:'start'});
  }
}

/* ---------- Not içine görsel / PDF / DOCX sürükle-bırak & yapıştır ---------- */
const isUploadable=f=>f&&(f.type.startsWith('image/')||/\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|html|png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name||''));
async function uploadImages(files,rel){
  const out=[];
  for(const f of files){
    if(!isUploadable(f))continue;
    const r=await fetch(`/api/upload?name=${encodeURIComponent(f.name||'gorsel.png')}&note=${encodeURIComponent(rel)}`,{method:'POST',body:f});
    if(!r.ok){let m=r.statusText;try{m=(await r.json()).detail||m}catch(e){}throw new Error(m)}
    out.push(await r.json());
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
  if(aid==='chatIn'||aid==='scIn'||(ae&&ae.closest&&(ae.closest('#rb-ai')||ae.closest('.sc-wrap')))){
    e.preventDefault(); attachChatImages('side_ai',files); return;
  }
  if(aid==='aiInput'||(ae&&ae.closest&&ae.closest('.aiwrap'))){
    e.preventDefault(); attachChatImages(active,files); return;
  }
  if(active==='studychat'){ e.preventDefault(); attachChatImages('side_ai',files); return; }
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
function renderMain(){
  const m=$('#main');
  const mm=$('#notionMinimap'); if(mm) mm.style.display='none';
  saveMainScroll();
  if(!active.startsWith('note:')) _mountedNoteScrollId=null;
  if(!isPdfTab(active)) deactivatePdfCache();
  if(active==='kasalar') renderKasalarHome(m);
  else if(isBlank(active)) renderBlankTab(m);
  else if(active.startsWith('note:')) renderVaultNote(m,active);
  else if(active==='studychat') renderStudyChat(m);
  else if(active==='cal') renderCal(m);
  else if(active==='trafo') renderTrafoLab(m);
  else if(isAI(active)) renderAI(m);
  else renderSim(m);
  syncPdfFocusMode();
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
  aiSend('side_ai',promptText,k);
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
const EEM_WEEKLY_SCHEDULE=[];

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
  pomo:{sec:25*60,total:25*60,running:false,timer:null,mode:'25 dk Odak',taskTitle:'Yüksek Gerilim & Kontrol Vize Hazırlığı'}
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
  return {
    id:raw.id,
    day:dayNum,
    date,
    title:raw.title||'Etkinlik',
    kind,
    kasa:kasaStr||'',
    start:meta.start||seedDef.start||defStart,
    end:meta.end||seedDef.end||defEnd,
    allDay:!!meta.allDay,
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
    start:ev.start||'10:00',
    end:ev.end||'11:30',
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
  if(GCAL.showSchedule && GCAL.kinds.lecture!==false){
    const d=gcalFromISO(isoDate);
    const dow=d.getDay(); // 0=Paz, 1=Pzt..6=Cmt
    // Sadece akademik dönem ayları için haftalık dersleri üret
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
  }).sort((a,b)=>gcalMin(a.start)-gcalMin(b.start));
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
    return `<div class="gcal-cd" onclick="openCalModal(${e.id})" title="${e.title} · ${e.date} ${e.start}">
      <div class="gcal-cd-top">
        <span>${k.icon} ${e.title}</span>
        <span class="gcal-cd-badge" style="background:${k.solid};color:#fff;border:1px solid ${k.solid}">${badgeTxt}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font:10.5px var(--mono);color:var(--mut)">
        <span>${e.date.split('-').reverse().slice(0,2).join('.')} · ${e.start}</span>
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
            title="${e.start}–${e.end} · ${safeTitle}${e.loc?' ('+e.loc+')':''}">
            <b>${e.start}</b><span>${e.title}</span>
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
  const START_H=7, END_H=23; // 07:00 .. 23:00 (16 saat * 60px = 960px)
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
    allDayCells+=`<div class="gw-ad-cell">
      ${adEvs.map(e=>{
        const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
        return `<div class="gev-pill ${e.done?'done':''}" onclick="openCalModal('${e.id}')" style="background:${k.solid};color:#fff;border-left-color:transparent">
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
    <div class="gweek-top ${colCls}">${topHdr}</div>
    <div class="gw-allday ${colCls}">${allDayCells}</div>
    <div class="gweek-scroll" id="gweekScroll">
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

  // O günkü ders kasalarına ait notları bul
  const activeKasas=new Set(dayEvs.map(e=>e.kasa).filter(Boolean));
  const relatedNotes=Object.entries(window.pages||{}).filter(([id,pg])=>id.startsWith('note:')&&(activeKasas.size?activeKasas.has(pg.kasa):true)).slice(0,6);

  return `<div class="gday-wrap">
    ${renderTimeGrid([cur],true)}
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
        <div class="gpomo-ring" id="gpomoRing" style="--pp:${pct}">
          <span class="gpomo-time" id="gpomoTime">${mm}:${ss}</span>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
          <div style="font:600 11px var(--mono);color:var(--cu)">⏱ POMODORO ÇALIŞMA SAYACI · ${p.mode}</div>
          <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.taskTitle}">🎯 ${p.taskTitle}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">
            <button class="gcal-btn ${p.running?'on':''}" onclick="gcalPomoToggle()">${p.running?'⏸ Duraklat':'▶ Başlat'}</button>
            <button class="gcal-btn" onclick="gcalPomoReset(25,'25 dk Odak')">25 dk</button>
            <button class="gcal-btn" onclick="gcalPomoReset(50,'50 dk Derin')">50 dk</button>
            <button class="gcal-btn" onclick="gcalPomoReset(5,'5 dk Mola')">Mola</button>
          </div>
        </div>
      </div>

      <!-- Seçili Günün Görev & Etkinlik Listesi -->
      <div class="gcal-sec">
        <div class="gcal-sec-hd"><span>GÜNÜN PLANI (${dayEvs.length})</span><span style="color:var(--cu);cursor:pointer" onclick="gcalAskAiForDay('${iso}')">✨ AI ile Günü Planla</span></div>
        ${dayEvs.length?dayEvs.map(e=>{
          const k=GCAL_KINDS[e.kind]||GCAL_KINDS.task;
          return `<div class="gag-card" style="padding:8px 11px" onclick="openCalModal('${e.id}')">
            ${!e.recurring?`<input type="checkbox" ${e.done?'checked':''} onclick="event.stopPropagation();gcalToggleDone(${e.id})" style="accent-color:var(--cu);cursor:pointer">`:`<span class="gag-dot" style="background:${k.color}"></span>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;font-weight:600;${e.done?'text-decoration:line-through;opacity:.55':''}">${k.icon} ${e.title}</div>
              <div style="font:11px var(--mono);color:var(--mut)">${e.start}–${e.end}${e.loc?' · 📍 '+e.loc:''}</div>
            </div>
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
        <button class="gcal-btn pri" onclick="gcalAskAiStudyPlan()">✨ AI Çalışma Programı Çıkar</button>
      </div>
    </div>
    ${dates.length?dates.map(iso=>{
      const d=gcalFromISO(iso);
      const diff=gcalDiffDays(iso,todayIso);
      const isToday=diff===0;
      const relTxt=diff===0?'BUGÜN':diff===1?'YARIN':diff===-1?'DÜN':diff>1?`${diff} gün sonra`:`${Math.abs(diff)} gün önce`;
      return `<div class="gag-day">
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

async function renderCal(m,fetchApi=true){
  if(!m) m=$('#main');
  if(fetchApi) await loadCalEvents(false);
  if(!GCAL.miniMonth) GCAL.miniMonth=gcalFromISO(GCAL.cursor);
  if(typeof renderTabs==='function') renderTabs();

  const stageHtml=GCAL.view==='day'?renderDayStage()
    :GCAL.view==='week'?renderWeekStage()
    :GCAL.view==='agenda'?renderAgendaStage()
    :GCAL.view==='semester'?renderSemesterStage()
    :renderMonthStage();

  const p=GCAL.pomo;
  const pomoMm=gcalPad(Math.floor(p.sec/60)), pomoSs=gcalPad(p.sec%60);
  const nowDt=new Date();
  const curMonShort=GCAL_MONTHS[nowDt.getMonth()].slice(0,3).toUpperCase();
  const conflicts=gcalDetectConflicts();
  const prevSideScroll=m.querySelector('.gcal-side')?.scrollTop||0;

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

      <div class="gcal-dd" id="gcalViewDd"><button class="gcal-btn" onclick="event.stopPropagation();document.getElementById('gcalViewDd').classList.toggle('open')" title="Görünüm Değiştir (D/W/M/A/Y)">${({day:'Gün',week:'Hafta',month:'Ay',agenda:'Planlama',semester:'Dönem'})[GCAL.view]||'Ay'} ▾</button><div class="gcal-dd-menu">${[['day','Gün','D'],['week','Hafta','W'],['month','Ay','M'],['agenda','Planlama','A'],['semester','Dönem','Y']].map(v=>`<button class="${GCAL.view===v[0]?'on':''}" onclick="gcalSetView('${v[0]}')">${v[1]}<kbd>${v[2]}</kbd></button>`).join('')}</div></div>

      <button class="gcal-btn pri" onclick="openCalModal(null,GCAL.cursor)" title="Yeni Etkinlik / Sınav Oluştur (Kısayol: C)">＋ Oluştur</button>
    </div>

    <!-- AgyCal Doğal Dil Sihirli Komut Çubuğu -->
    <div class="gcal-smartbar">
      <div class="gcal-smart-in">
        <span style="color:var(--cu);font-size:14px">⚡</span>
        <input id="gcalSmartInput" placeholder="AgyCal Sihirli Ekle: &quot;Cuma 14:00 Yüksek Gerilim Lab #lab @D-204&quot; veya &quot;20 Kasım 09:00 Makinalar Quiz&quot; yazıp Enter'a bas (Kısayol: Q)" oninput="gcalSmartPreview(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();gcalSmartSubmit();}">
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
}

function renderCalStageOnly(){
  const st=$('#gcalStage');
  if(!st) return;
  const scrollSel=['.gweek-scroll','.gday-cockpit','.gagenda','.gsem'];
  const saved=scrollSel.map(sel=>[sel,st.querySelector(sel)?.scrollTop||0]);
  st.innerHTML=GCAL.view==='day'?renderDayStage()
    :GCAL.view==='week'?renderWeekStage()
    :GCAL.view==='agenda'?renderAgendaStage()
    :GCAL.view==='semester'?renderSemesterStage()
    :renderMonthStage();
  saved.forEach(([sel,top])=>{
    const el=st.querySelector(sel);
    if(el&&top) el.scrollTop=top;
  });
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
  const dur=Math.max(30,gcalMin(item.end)-gcalMin(item.start));
  const newStart=hour*60;
  item.date=targetIso;
  item.day=gcalFromISO(targetIso).getDate();
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
  const hasExplicitTime=!!(ev||defaultStart);
  const startVal=ev?ev.start:(defaultStart||'10:00');
  const endVal=ev?ev.end:gcalFmtMin(gcalMin(startVal)+60);
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
      <input class="gm-title-in" id="gmTitle" placeholder="Başlık ve zaman ekle" value="${titleVal.replace(/"/g,'&quot;')}" onkeydown="if(event.key==='Enter')saveCalFromModal()">
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
            <button type="button" class="gm-pill-btn" id="gmAddTimeBtn" style="display:${hasExplicitTime?'none':'inline-block'}" onclick="event.stopPropagation();gcalExpandTimeRow(true)">Zaman ekle</button>
          </div>
          <div class="gm-sub" id="gmRepeatSub">${repeatVal}${hasExplicitTime?` · ${startVal} – ${endVal}`:''}</div>
          <div id="gmTimeExpand" style="display:${hasExplicitTime?'flex':'none'};flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center" onclick="event.stopPropagation()">
            <input type="date" class="gmodal-in" id="gmDate" value="${dateVal}" style="width:138px" onchange="$('#gmDateHuman').innerHTML=gcalFmtDateHuman(this.value)+' &nbsp;–&nbsp; '+gcalFmtDateHuman(this.value)">
            <input type="time" class="gmodal-in" id="gmStart" value="${startVal}" style="width:98px">
            <span style="color:var(--mut)">–</span>
            <input type="time" class="gmodal-in" id="gmEnd" value="${endVal}" style="width:98px">
            <select class="gmodal-in" id="gmRepeat" style="width:130px;font-size:12px" onchange="$('#gmRepeatSub').textContent=this.value">
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
function gcalExpandTimeRow(focusTime=false){
  const ex=$('#gmTimeExpand'), btn=$('#gmAddTimeBtn');
  if(ex) ex.style.display='flex';
  if(btn) btn.style.display='none';
  if(focusTime) $('#gmStart')?.focus();
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
  const start=$('#gmStart')?.value||'10:00';
  const end=$('#gmEnd')?.value||'11:00';
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
    Object.assign(item,{title,kind,date,day,start,end,kasa,loc,desc,guests,meet,repeat,notify});
    await persistCalEventUpdate(item);
    toast(`✓ "${title}" güncellendi`);
  }else{
    const newEv={id:Date.now(),day,date,title,kind,kasa,start,end,allDay:false,loc,desc,guests,meet,repeat,notify,done:false};
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
  calEvents.filter(e=>!e.done).forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
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
  let start='10:00', end='11:00', kind='task', loc='', kasa='';
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

  // 3) Saat aralığı (14:00-16:00 veya 14:00)
  const timeM=txt.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?\b/);
  if(timeM){
    const h1=gcalPad(Number(timeM[1])), m1=timeM[2];
    start=`${h1}:${m1}`;
    if(timeM[3]!==undefined){
      end=`${gcalPad(Number(timeM[3]))}:${timeM[4]}`;
    }else{
      end=`${gcalPad(Math.min(23,Number(timeM[1])+1))}:${m1}`;
    }
    txt=txt.replace(timeM[0],'').trim();
  }

  // 4) Tarih ("bugün", "yarın", haftanın günleri, veya "19 Kasım")
  const low=txt.toLowerCase();
  const monthNames=['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
  const dmMatch=txt.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames.join('|')})\\b`,'i'));
  if(dmMatch){
    const dNum=Number(dmMatch[1]);
    const mIdx=monthNames.indexOf(dmMatch[2].toLowerCase());
    if(mIdx!==-1) date=`${now.getFullYear()}-${gcalPad(mIdx+1)}-${gcalPad(dNum)}`;
    txt=txt.replace(dmMatch[0],'').trim();
  }else if(/\bbugün\b/i.test(txt)){
    date=gcalTodayISO();
    txt=txt.replace(/\bbugün\b/i,'').trim();
  }else if(/\byarın\b/i.test(txt)){
    const d=new Date(now); d.setDate(d.getDate()+1); date=gcalToISO(d);
    txt=txt.replace(/\byarın\b/i,'').trim();
  }else{
    const dayMap=[['pazartesi|pzt',0],['salı|sali|sal',1],['çarşamba|carsamba|çar',2],['perşembe|persembe|per',3],['cuma|cum',4],['cumartesi|cmt',5],['pazar|paz',6]];
    for(const [pat,targetMonIdx] of dayMap){
      const rx=new RegExp(`\\b(${pat})\\b`,'i');
      const m=txt.match(rx);
      if(m){
        const curMonIdx=gcalDowMon(now);
        let delta=(targetMonIdx-curMonIdx+7)%7;
        if(delta===0) delta=7;
        const d=new Date(now); d.setDate(d.getDate()+delta);
        date=gcalToISO(d);
        txt=txt.replace(m[0],'').trim();
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
  return {title,date,start,end,kind,loc,kasa};
}

function gcalSmartPreview(val){
  const box=$('#gcalSmartPrev');
  if(!box) return;
  const p=gcalParseNaturalLanguage(val);
  if(!p){
    box.innerHTML=`<span style="color:var(--mut)">Örnek: <u style="cursor:pointer;color:var(--cu)" onclick="const el=$('#gcalSmartInput');el.value='Cuma 14:00–16:00 Trafo Boşta Çalışma Deneyi #lab @D-102';gcalSmartPreview(el.value);el.focus()">Cuma 14:00 Trafo Deneyi #lab @D-102</u></span>`;
    return;
  }
  const kObj=GCAL_KINDS[p.kind]||GCAL_KINDS.task;
  const kInk=gcalInk(kObj);
  box.innerHTML=`
    <span class="gcal-smart-chip" style="border-color:${kInk}66;color:${kInk}">${kObj.icon} ${kObj.label}</span>
    <span class="gcal-smart-chip">📅 ${p.date}</span>
    <span class="gcal-smart-chip">🕒 ${p.start}–${p.end}</span>
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
  const newEv={id:Date.now(),day,date:p.date,title:p.title,kind:p.kind,kasa:p.kasa,start:p.start,end:p.end,allDay:false,loc:p.loc,desc:'',guests:'',meet:'',repeat:'Yinelenmez',notify:'Bir gün önce şu saatte: 5pm bildir',done:false};
  try{
    const saved=await api('/api/calendar',{day,title:p.title,kind:p.kind,kasa:packCalMeta(newEv)});
    if(saved&&saved.id) newEv.id=saved.id;
  }catch(e){}
  calEvents.push(newEv);
  GCAL.cursor=p.date;
  inp.value='';
  renderCal($('#main'),false);
  toast(`⚡ AgyCal Sihirli Ekle: "${p.title}" (${p.date} ${p.start})`);
}

function gcalExportICS(){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AgyDesk//AgyCal PRO//TR','CALSCALE:GREGORIAN','X-WR-CALNAME:AgyCal Akademik Takvim'];
  const fmtDt=(iso,hm)=>iso.replace(/-/g,'')+'T'+(hm||'09:00').replace(':','')+'00';
  calEvents.forEach(ev=>{
    lines.push(
      'BEGIN:VEVENT',
      `UID:agycal-${ev.id}@agydesk.local`,
      `DTSTAMP:${fmtDt(gcalTodayISO(),'09:00')}`,
      `DTSTART:${fmtDt(ev.date,ev.start||'09:00')}`,
      `DTEND:${fmtDt(ev.date,ev.end||'10:00')}`,
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

function gcalUpdatePomoDom(){
  const p=GCAL.pomo;
  const mm=gcalPad(Math.floor(p.sec/60)), ss=gcalPad(p.sec%60);
  const pct=Math.round((p.sec/Math.max(1,p.total))*100);
  const topEl=$('#gcalTopPomo'); if(topEl) topEl.textContent=`${mm}:${ss}`;
  const tabEl=$('#acalTabPomo'); if(tabEl) tabEl.textContent=`⏱ ${mm}:${ss}`;
  const tEl=$('#gpomoTime'); if(tEl) tEl.textContent=`${mm}:${ss}`;
  const rEl=$('#gpomoRing'); if(rEl) rEl.style.setProperty('--pp',pct);
}
function gcalPomoToggle(){
  const p=GCAL.pomo;
  if(p.running){
    clearInterval(p.timer); p.timer=null; p.running=false;
  }else{
    p.running=true;
    p.timer=setInterval(()=>{
      if(p.sec>0){ p.sec--; gcalUpdatePomoDom(); }
      else{
        clearInterval(p.timer); p.timer=null; p.running=false;
        toast(`🔔 Pomodoro tamamlandı: ${p.taskTitle}! Harika iş çıkardın.`);
        renderCal($('#main'),false);
      }
    },1000);
  }
  renderCal($('#main'),false);
}
function gcalPomoReset(mins,modeName){
  const p=GCAL.pomo;
  if(p.timer) clearInterval(p.timer);
  p.running=false; p.timer=null;
  p.total=mins*60; p.sec=mins*60; p.mode=modeName;
  renderCal($('#main'),false);
}
function gcalStartPomoFor(title){
  GCAL.pomo.taskTitle=title;
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
function studioAdd(title,md,html){
  studioNotes.unshift({id:'sn'+Date.now(),t:title,md:md||'',h:html||mdToHtml(md||''),ts:Date.now()});
  saveStudio(); renderStudio();
}
function studioSaveMsg(i){
  const m=ai.side_ai.msgs[i]; if(!m) return;
  const d=document.createElement('div'); d.innerHTML=m.h; d.querySelectorAll('.route').forEach(x=>x.remove());
  const txt=d.textContent.trim();
  studioAdd(txt.slice(0,48)||'Not',txt,d.innerHTML);
  toast('📌 Studio notlarına kaydedildi');
}
function studioDel(id){ studioNotes=studioNotes.filter(n=>n.id!==id); saveStudio(); renderStudio(); }
function studioCopy(id){ const n=studioNotes.find(x=>x.id===id); if(n&&navigator.clipboard) navigator.clipboard.writeText(n.md||n.t); }
function studioToggle(id){ studioOpenId=(studioOpenId===id)?null:id; renderStudio(); }
function renderStudio(){
  const b=$('#rb-studio'); if(!b) return;
  b.innerHTML=`<div class="rview-head"><span>✦</span><b>Studio</b></div><div class="st-wrap">
    <div class="st-h"><span>Oluştur</span></div>
    <div class="st-grid">${STUDIO_TILES.map(([k,ic])=>`<button class="st-tile" onclick="runSkill('${k}')"><span class="ic">${ic}</span>${SK[k].h}</button>`).join('')}</div>
    <div class="st-h"><span>Notlar</span><span>${studioNotes.length}</span></div>
    ${studioNotes.length?studioNotes.map(n=>`<div class="st-card"><div class="t" onclick="studioToggle('${n.id}')">${studioOpenId===n.id?'▾':'▸'} ${n.t.replace(/</g,'&lt;')}</div>${studioOpenId===n.id?`<div class="full">${n.h}</div>`:`<div class="pv">${(n.md||'').replace(/[<#*]/g,'').slice(0,220)}</div>`}<div class="ft"><span>${new Date(n.ts).toLocaleString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span><span style="flex:1"></span><button onclick="studioCopy('${n.id}')" title="Kopyala">⧉</button><button onclick="studioDel('${n.id}')" title="Sil">🗑</button></div></div>`).join(''):`<div class="st-empty">Oluşturulan çıktılar ve 📌 ile kaydettiğin yanıtlar burada birikir.</div>`}
  </div>`;
}
function studioSend(q){
  q=(q||'').trim();
  if(!q&&!(ai.side_ai&&ai.side_ai.attachments&&ai.side_ai.attachments.length)) return;
  studioPendingTitle=null; aiSend('side_ai',q);
}
function renderStudyChat(m){
  m.scrollTop=0;
  m.innerHTML=`<div class="sc-wrap"><div class="sc-head"><b>Sohbet</b><span class="sc-src" id="scSrc"></span><span style="flex:1"></span>${effortSelectHtml()}<button class="hb" onclick="clearSideAi()" title="Sohbeti sıfırla">🧹 Temizle</button><button class="hb stop" id="scStop" style="display:none" onclick="aiStop('side_ai')">■ Dur</button></div>
    <div class="sc-body" id="scChat"></div>
    <div class="sc-foot"><div class="sc-chips" id="scChips"></div><div class="chat-att-bar sc-att-bar" id="scAttach"></div><div class="sc-box"><button class="sc-att" id="scImgBtn" type="button" onclick="pickChatImages('side_ai')" title="Sohbete resim ekle (veya Ctrl+V yapıştır / sürükle-bırak)">🖼</button><textarea id="scIn" rows="1" placeholder="Kaynaklarına bir şey sor…"></textarea><span class="sc-n" id="scN"></span><button class="sc-go" id="scGo" title="Gönder">➤</button></div></div></div>`;
  const i=$('#scIn'), go=()=>{
    const v=i.value;
    if(!v.trim()&&!(ai.side_ai&&ai.side_ai.attachments&&ai.side_ai.attachments.length)) return;
    i.value=''; autoGrow(i); studioSend(v);
  };
  $('#scGo').onclick=go;
  i.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); go(); } };
  i.oninput=()=>autoGrow(i);
  wireChatDrop(m.querySelector('.sc-wrap'),()=>'side_ai');
  renderChatAttachments('side_ai');
  updateSideAiCtx(); renderStudyChatBody(); i.focus();
}
function renderStudyChatBody(){
  const c=$('#scChat'); if(!c||active!=='studychat') return;
  const s=ai.side_ai; if(!s) return;
  const msgs=s.msgs.map((x,i)=>({x,i})).filter(o=>!(o.i===0&&o.x.w==='a'&&s.msgs.length===1));
  const prevLen=c.dataset.msgCount?+c.dataset.msgCount:-1;
  const prevScroll=c.scrollTop;
  const nearBottom=!c.dataset.rendered||(c.scrollHeight-c.clientHeight-c.scrollTop)<80;
  const n=getCheckedSources().length;
  let h='';
  if(!msgs.length&&!s.running){
    h=`<div class="sc-hero"><div class="big">Kaynaklarınla sohbet</div><div class="sub">${n} kaynak seçili · soru sor ya da sağdaki Studio'dan çıktı oluştur</div></div>`;
  }else{
    h=msgs.map(({x,i})=>x.w==='me'?`<div class="sc-msg me">${x.h}</div>`:`<div class="sc-msg a">${x.h}<div class="sc-act"><button onclick="studioSaveMsg(${i})">📌 Nota kaydet</button></div></div>`).join('');
    if(s.running) h+=`<div class="sc-msg a"><span class="spin"></span> ${s.step||'Çalışıyor…'}</div>`;
  }
  c.innerHTML=`<div class="sc-col">${h}</div>`;
  c.dataset.rendered='1';
  c.dataset.msgCount=String(msgs.length);
  if(msgs.length!==prevLen||nearBottom) c.scrollTop=c.scrollHeight;
  else c.scrollTop=prevScroll;
  const st=$('#scStop'); if(st) st.style.display=(s.running||s.pending)?'inline-flex':'none';
  const ch=$('#scChips');
  if(ch) ch.innerHTML=msgs.length?'':['Bu kaynakları özetle','Kritik formülleri listele','Sınavda çıkabilecek sorular'].map(q=>`<button onclick="studioSend('${q}')">${q}</button>`).join('');
  runMermaid('#scChat .mermaid');
}
/* ---------- Sohbet / yönlendirici (Sağ Panel Gerçek AI) ---------- */
function chat(who,html){
  ai.side_ai.msgs.push({w:who==='me'?'me':'a',h:html});
  renderSideAi();
}
function autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight+2,Math.round(innerHeight*0.5))+'px'}
function send(){
  const i=$('#chatIn'),q=i.value.trim();
  if(!q&&!(ai.side_ai&&ai.side_ai.attachments&&ai.side_ai.attachments.length))return;
  i.value='';autoGrow(i);
  aiSend('side_ai',q);
}
$('#send').onclick=send; $('#chatIn').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}}; $('#chatIn').oninput=e=>autoGrow(e.target);
wireChatDrop($('#rb-ai'),()=>'side_ai');

/* ---------- Sağ sekmeler & Panel düğmeleri ---------- */
function syncPaneBtns(){
  const l=$('#leftTog'), r=$('#rightTog');
  if(l) l.classList.toggle('on', !app.classList.contains('no-left'));
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
  syncPaneBtns();
  syncPdfFocusMode();
  saveSessionTabs();
}
function leftHeaderAct(){
  if(curMode==='ai'){ newSession(); return; }
  const allOpen=tree.every(g=>g.open);
  tree.forEach(g=>{
    g.open=!allOpen;
    const tk=g.spaceId?('space:'+g.spaceId):(g.rel||((g.id||'')+'|'+g.n));
    TREE_OPEN[tk]=g.open;
  });
  renderTree();
  saveSessionTabs();
}
$$('.rt').forEach(t=>t.onclick=()=>{
  $('#rtabsBar').style.display='';
  viewerPrev=null;
  $$('.rt').forEach(x=>x.classList.toggle('on',x===t));
  $$('.rbody').forEach(b=>b.classList.toggle('on',b.id==='rb-'+t.dataset.rt));
  if(t.dataset.rt==='props') updateRightProps();
  saveSessionTabs();
});
function rtab(n){
  if(n==='ai'&&curMode==='study') n='studio';
  $('#rtabsBar').style.display='';
  viewerPrev=null;
  const el=$(`.rt[data-rt=${n}]`);
  if(el) el.click();
  app.classList.remove('no-right');
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
        if(side==='left'){
          const raw=e.clientX-52;
          leftW=clampLeft(raw);
        }else{
          const raw=window.innerWidth-e.clientX;
          rightW=clampRight(raw);
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
      if(side==='left') leftW=248;
      else rightW=viewerPrev?500:340;
      applyPaneWidths();
      saveSessionTabs();
    });
  };
  bind(rl,'left');
  bind(rr,'right');
  window.addEventListener('resize',()=>{
    leftW=clampLeft(leftW);
    rightW=clampRight(rightW);
    applyPaneWidths();
  });
}
initResizers();

function winAct(cmd){
  if(cmd==='close'){
    try{ saveMainScroll(); saveSessionTabs(); flushUiStateRemote(true); }catch(e){}
  }
  if(window.ipc && typeof window.ipc.postMessage==='function'){
    window.ipc.postMessage(cmd);
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
function layoutMode(m){
  curMode=m;
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
  if(m!=='study'&&$('.rt[data-rt=studio].on')){ const a=$('.rt[data-rt=ai]'); if(a)a.click(); }
  if(m==='kasalar'){app.classList.add('no-left','no-right');show(1,0,0,'Kasa Notları');}
  if(m==='write'){app.classList.remove('no-left');app.classList.add('no-right');show(1,0,0,'Kasa Notları');}
  if(m==='study'){app.classList.remove('no-left','no-right');show(0,1,0,'Kaynaklar');renderStudio();rtab('studio');}
  if(m==='plan'){app.classList.add('no-left','no-right');show(1,0,0,'Kasa Notları');}
  if(m==='ai'){app.classList.add('no-left','no-right');show(1,0,1,'AI Oturumları');const el=$('.rt[data-rt=skills]');if(el)el.click();renderSessions();}
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
  if(m==='ai'){const cur=isAI(active)?active:(openTabs.find(isAI)||'ai1'); openPage(cur);}
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
function syncPdfFocusMode(){
  if(!app) return;
  const on=app.classList.contains('zen')&&isPdfTab(active);
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
 ['Komutlar',[['compact','⇲','Bağlamı sıkıştır','cmd'],['clear','⌫','Oturumu temizle','cmd'],['plan','☰','Adım adım çalışma planı',''],['goal','◎','Uzun hedef modu',''],['boost','⚡','Derin matematiksel analiz','']]],
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
      d.innerHTML=`<div class="ic">${ic}</div><div>${k.startsWith('caveman')||kind==='cmd'||['plan','goal','boost'].includes(k)?'/':''}${k}<small>${desc}</small></div><span class="tg">${kind==='cmd'?'KOMUT':kind==='mode'?'MOD':'ÇALIŞTIR'}</span>`;
      d.onclick=()=>{
        const targetSess=isAI(active)?active:'side_ai';
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

function aiInstant(id,k){
  const s=ai[id];
  if(k==='clear'){ api('/api/clear',{session:id}).catch(()=>{}); s.msgs=[{w:'a',h:'🧹 Oturum temizlendi. agy konuşma bağlamı sıfırlandı.'}]; s.attachments=[]; renderChatAttachments(id); }
  else if(k==='compact'){
    const mine=s.msgs.filter(m=>m.w==='me').map(m=>m.h).slice(-3).join(' · ');
    s.msgs=[{w:'a',h:`🗜 Bağlam sıkıştırıldı. Özet: ${mine||'(henüz içerik yok)'} <div class="route"><span class="chip l">yerel özetleyici</span><span>~%70 token tasarruf</span></div>`}];
  } else if(k==='caveman'){
    s.caveman=!s.caveman;
    s.msgs.push({w:'a',h:s.caveman?'🪨 Caveman açık. Yanıt kısa. Teknik içerik aynı.':'Caveman kapalı. Normal yanıt.'});
  }
  aiRefresh(id);
}

/* ---------- Kullanım & kalan haklar ---------- */
let quota=[{n:'Yükleniyor…',u:0,reset:''}];
const fmtReset=q=>q.cloud?(q.used_pct>=100?`Tükendi · ${Math.floor(q.reset_s/3600)} sa ${Math.floor(q.reset_s%3600/60)} dk sonra yenilenir`:(q.count?`${q.count}/${q.limit} istek · ${Math.floor(q.reset_s/3600)} sa ${Math.floor(q.reset_s%3600/60)} dk sonra yenilenir`:`0/${q.limit} istek`)):`sınırsız · ${q.count} istek`;
function applyQuota(rows){ quota=rows.map(q=>({n:q.label,u:q.used_pct,reset:fmtReset(q)})); renderUsage(); }
async function loadQuota(){ try{ applyQuota(await api('/api/quota')); return true; }catch(e){ return false; } }
async function refreshQuota(ev){ ev&&ev.stopPropagation(); const b=$('#urefresh'); if(b){b.disabled=true;b.textContent='⟳ …';} const ok=await loadQuota(); const b2=$('#urefresh'); if(b2){b2.disabled=false;b2.textContent=ok?'✓ Güncellendi':'⚠ Hata';setTimeout(()=>{const b3=$('#urefresh');if(b3)b3.textContent='⟳ Yenile';},1500);} }
function useQuota(){}
function quotaRows(){
  return quota.map(q=>q.u===null
   ?`<div class="qrow"><div class="l"><span>${q.n}</span><b style="color:var(--ok)">∞</b></div><div class="bar g"><i style="width:100%"></i></div><small>${q.reset}</small></div>`
   :`<div class="qrow"><div class="l"><span>${q.n}</span><b style="${q.u>=100?'color:var(--cu)':''}">${q.u>=100?'Tükendi':'%'+(100-q.u)+' kaldı'}</b></div><div class="bar ${q.u>85?'w':''}"><i style="width:${q.u}%"></i></div><small>${q.reset}</small></div>`).join('');
}
function renderUsage(){
  const cloud=quota.filter(q=>q.u!==null);
  const left=cloud.length?Math.round(cloud.reduce((a,q)=>a+(100-q.u),0)/cloud.length):100;
  $('#uring').style.setProperty('--p',left); $('#uringTxt').textContent=left+'%';
  $('#upop').innerHTML=`<h4><span>AI kullanımı</span><button class="urefresh" id="urefresh" title="Kotaları yenile" onclick="refreshQuota(event)">⟳ Yenile</button></h4>${quotaRows()}
   <div style="font:11px var(--mono);color:var(--mut);border-top:1px solid var(--line);padding-top:8px">Kotası dolan bulut modeli otomatik olarak sıradaki aktif modele (Hydrogen / Argon / Yerel) devredilir.</div>`;
  const ql=$('#quotaList'); if(ql)ql.innerHTML=quotaRows();
}
(()=>{const rr=$('#rb-router'); rr.querySelectorAll('.quota').forEach(e=>e.remove()); rr.querySelector('.ph').insertAdjacentHTML('afterend','<div id="quotaList"></div>');})();
$('#uring').onclick=e=>{e.stopPropagation();$('#mpop')?.classList.remove('show');$('#upop').classList.toggle('show');};
document.addEventListener('click',e=>{if(!e.target.closest('#upop'))$('#upop').classList.remove('show');});
loadQuota(); loadHealth(); setInterval(loadQuota,30000); loadLog(); startEvents();

/* ---------- Tema Yönetimi & Hızlı Seçici ---------- */
const THEMES = [
  { id: 'obsidian', name: 'Obsidian Kehribar', desc: 'Varsayılan karanlık odak', dot: '#e0a458', cat: 'dark' },
  { id: 'forest', name: 'Zümrüt & Adaçayı', desc: 'Göz dinlendirici gece yeşili', dot: '#52b788', cat: 'dark' },
  { id: 'nord', name: 'Nord Buzul Mavisi', desc: 'Soğuk & sakin gece', dot: '#88c0d0', cat: 'dark' },
  { id: 'solarized', name: 'Solarized Gece', desc: 'Okyanus derinliği ve turkuaz', dot: '#2aa198', cat: 'dark' },
  { id: 'tokyo', name: 'Tokyo Night', desc: 'Modern mavi-mor siber tonlar', dot: '#7aa2f7', cat: 'dark' },
  { id: 'gruvbox', name: 'Gruvbox Retro', desc: 'Sıcak sepyamsı koyu mod', dot: '#d79921', cat: 'dark' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', desc: 'Canlı pembe & mor kontrast', dot: '#f72585', cat: 'dark' },
  { id: 'mono-dark', name: 'Saf Siyah-Beyaz', desc: 'Sade, Obsidian & NotebookLM tarzı', dot: '#ffffff', cat: 'dark' },
  { id: 'mono-light', name: 'Saf Beyaz-Siyah (Açık)', desc: 'Sade kâğıt beyazı, siyah vurgu', dot: '#000000', cat: 'light' },
  { id: 'eink', name: 'E-Ink Kağıt (Açık)', desc: 'Sıfır parlama, kitap okuma', dot: '#1b4a2c', cat: 'light' },
  { id: 'sepia', name: 'Papirüs Sepya (Açık)', desc: 'Yumuşak sıcak gündüz modu', dot: '#874218', cat: 'light' }
];

let curTheme = localStorage.getItem('agydesk_theme') || 'obsidian';

function applyTheme(themeId, persist=true) {
  const t = THEMES.find(x => x.id === themeId) || THEMES[0];
  curTheme = t.id;
  document.body.setAttribute('data-theme', curTheme);
  document.documentElement.style.colorScheme = t.cat === 'light' ? 'light' : 'dark';
  if (persist) persistUiState({ agydesk_theme: curTheme }, true);
  renderThemePop();
  if (active === 'sim' || active === 'trafo') renderMain();
  else if (active === 'cal') renderCal($('#main'), false);
  if (window.mermaid) {
    runMermaid('#mdView .mermaid, #chat .mermaid, #scChat .mermaid, #aichat .mermaid, #outs .mermaid', true);
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
  renderThemePop();
  pop.classList.toggle('show');
}

function initThemes() {
  applyTheme(curTheme, false);
  const btn = $('#themeBtn');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); openThemePop(); };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tpop') && !e.target.closest('#themeBtn')) {
      $('#tpop')?.classList.remove('show');
    }
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
let fullW=localStorage.getItem('agydesk_fullw')==='1';
function applyTextPrefs(persist=true){
  curTz=Math.min(TZ_MAX,Math.max(TZ_MIN,Math.round(curTz*20)/20));
  const f=FONTS.find(x=>x.id===curFont)||FONTS[0];
  document.documentElement.style.setProperty('--cfont',f.v);
  document.documentElement.style.setProperty('--tz',curTz);document.documentElement.classList.toggle('tz-on',+curTz!==1);
  document.body.classList.toggle('fw-full',fullW);
  if(persist){
    persistUiState({
      agydesk_font:f.id,
      agydesk_tz:String(curTz),
      agydesk_fullw:fullW?'1':'0'
    },true);
  }
  renderFontPop();
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
  const b=$('#fontBtn');
  if(b) b.onclick=e=>{e.stopPropagation();$('#tpop')?.classList.remove('show');$('#mpop')?.classList.remove('show');renderFontPop();$('#fpop').classList.toggle('show');};
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

/* ---------- Sol ray: sürükle-bırak ile sıralama ---------- */
function applyRailOrder(saved){
  const rail=document.querySelector('.rail');
  if(!rail||!Array.isArray(saved)||!saved.length) return;
  const btns=[...rail.querySelectorAll('.rbtn')];
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
}
function initRailDrag(){
  const rail=document.querySelector('.rail'); if(!rail) return;
  const btns=[...rail.querySelectorAll('.rbtn')];
  const keyOf=(b,i)=>b.dataset.k||(b.dataset.k=b.dataset.mode||b.id||(i===0?'attach':'newnote'));
  btns.forEach((b,i)=>keyOf(b,i));
  const sp=rail.querySelector('.sp');
  try{
    const saved=JSON.parse(localStorage.getItem('agydesk_rail')||'null');
    if(Array.isArray(saved)) applyRailOrder(saved);
  }catch(e){}
  const save=()=>{
    const order=[...rail.querySelectorAll('.rbtn,.sp')].map(b=>b.classList.contains('sp')?'sp':b.dataset.k);
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
  gear:'<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.2v1.3M8 12.5v1.3M2.2 8h1.3M12.5 8h1.3M3.9 3.9l.95.95M11.15 11.15l.95.95M12.1 3.9l-.95.95M4.85 11.15l-.95.95"/></svg>'
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

function renderMediaRail(){
  const btn=$('#mediaBtn'); if(!btn)return;
  btn.innerHTML=mediaIcon(mediaState.platform);
  btn.classList.toggle('playing',mediaState.playing);
  btn.classList.toggle('active',mediaPinned||$('#mpop')?.classList.contains('show'));
  btn.dataset.tip=mediaState.source==='idle'
    ?'Medya Kumandası (Çalan yok)'
    :`${mediaState.playing?'▶':'❚❚'} ${mediaState.title}${mediaState.artist?' — '+mediaState.artist:''} (${mediaState.platformLabel})`;
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

function renderMediaPop(){
  const pop=$('#mpop'); if(!pop)return;
  if(mediaSeeking&&pop.classList.contains('show'))return;
  const activeEl=document.activeElement;
  if(activeEl&&activeEl.id==='spCidIn'&&pop.classList.contains('show'))return;

  const hasSp=spConnected();
  const s=mediaState;
  const players=s.players||[];
  const multi=players.length>1;
  const curIdx=players.findIndex(p=>p.key===s.activeKey);
  const nextPl=multi?players[(curIdx+1)%players.length]:null;
  const nextTip=nextPl
    ?`Sonraki oynatıcı: ${nextPl.platformLabel} (${((curIdx+1)%players.length)+1}/${players.length})`
    :'Başka aktif medya oynatıcı yok';
  const artHtml=s.thumb?`<img src="${escAttr(s.thumb)}" alt="">`:mediaIcon(s.platform);

  const dur=Number(s.durMs)||0;
  const pos=dur>0?liveMediaPosMs():0;
  const pct=dur>0?Math.max(0,Math.min(100,(pos/dur)*100)):(s.pct||0);
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

  pop.innerHTML=`
    <div class="mpop-head">
      <span class="mpop-plat">${mediaIcon(s.platform)}<span>${escAttr(s.platformLabel)}</span></span>
      <div class="mpop-actions">
        <button class="mpop-sbtn ${mediaShowSetup?'on':''}" onclick="toggleMediaSetup()" title="Spotify Connect (Tablet & PC) ayarları">${MEDIA_CTRL_SVG.gear}</button>
        <button class="mpop-next" onclick="cycleMediaPlayer()" ${multi?'':'disabled'} title="${escAttr(nextTip)}">${MEDIA_CTRL_SVG.chevron}</button>
      </div>
    </div>
    <div class="mpop-card">
      <div class="mpop-info">
        <div class="mpop-title">${escAttr(s.title)}</div>
        <div class="mpop-artist">${escAttr(s.artist||'')}</div>
      </div>
      <div class="mpop-art">${artHtml}</div>
    </div>
    ${seekHtml}
    <div class="mpop-ctrls">
      <button class="mpop-cbtn" onclick="mediaCmd('prev')" title="Önceki parça">${MEDIA_CTRL_SVG.prev}</button>
      <button class="mpop-cbtn main" onclick="mediaCmd('playpause')" title="Oynat / Duraklat">${s.playing?MEDIA_CTRL_SVG.pause:MEDIA_CTRL_SVG.play}</button>
      <button class="mpop-cbtn" onclick="mediaCmd('next')" title="Sonraki parça">${MEDIA_CTRL_SVG.next}</button>
    </div>
    ${setupHtml}
  `;
}

function renderMediaUI(){
  renderMediaRail();
  if($('#mpop')?.classList.contains('show'))renderMediaPop();
}

async function refreshMediaNow(){
  await Promise.all([pollPcMedia(),pollSpotifyConnect()]);
  recomputeMediaState();
  renderMediaUI();
}

function openMediaPop(pin=false){
  const pop=$('#mpop'); if(!pop)return;
  $('#upop')?.classList.remove('show');
  $('#tpop')?.classList.remove('show');
  $('#fpop')?.classList.remove('show');
  if(pin)mediaPinned=true;
  renderMediaPop();
  pop.classList.add('show');
  renderMediaRail();
}

function closeMediaPop(force=false){
  if(force)mediaPinned=false;
  if(!force&&mediaPinned)return;
  $('#mpop')?.classList.remove('show');
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
  document.addEventListener('click',e=>{
    if(!e.target.closest('#mpop')&&!e.target.closest('#mediaBtn'))closeMediaPop(true);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&pop.classList.contains('show'))closeMediaPop(true);
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshMediaNow();});
  setInterval(()=>{if(!document.hidden)refreshMediaNow();},2500);
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
      if(typeof srv[k]==='string') localStorage.setItem(k,srv[k]);
    });
    if(typeof srv.agydesk_theme==='string'){
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
    if(typeof srv[TAB_STORE_KEY]==='string'){
      if(restoreSessionTabs()) initNavHistory();
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

/* ---------- Başlat (Son açık sekmeleri geri yükle; yoksa Kasalar ana ekranı) ---------- */
initMainScrollTracking();
initThemes(); initTextPrefs(); initRailDrag(); initAppClock(); initMediaHub(); syncEffortSelects();
if(!restoreSessionTabs()){
  _restoringSession=true;
  setMode('kasalar');
  _restoringSession=false;
}
initNavHistory();
window.addEventListener('beforeunload',()=>{
  saveMainScroll();
  saveSessionTabs();
  flushUiStateRemote(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    saveMainScroll();
    saveSessionTabs();
    flushUiStateRemote(true);
  }
});
hydrateUiState().finally(()=>{
  loadVault(); loadChats(); loadCalEvents(false).then(()=>renderTabs());
});
