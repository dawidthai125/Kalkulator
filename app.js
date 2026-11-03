var SB=supabase.createClient('https://ukpfrkjikqffojzpdywk.supabase.co','sb_publishable_9coMWsPQsvFtIwNRVEXPiQ_VVyFT8r_');
// role: null (jeszcze nie wiadomo) | 'admin' (właściciel list) | 'debtor' (dłużnik z własnym loginem). Rolę zawsze ustala baza.
var S={debtors:[],sel:null,user:null,editId:null,pwOpen:false,role:null,me:null,pending:[],cred:null,offline:0,pushState:'unknown'},IMP=[];
var fmt=new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'});
var today=Loans.today,esc=Loans.esc,calc=Loans.calc,parseNotes=Loans.parseNotes;
function cur(){return S.debtors.find(function(d){return d.id===S.sel})}
function toast(m){document.querySelectorAll('.msg').forEach(function(x){x.textContent=m||''})}
function fail(r){
  if(r&&r.error){toast(Loans.isNetworkError(r.error)?'Brak połączenia z internetem. Spróbuj ponownie, gdy wróci sieć.':'Błąd: '+r.error.message);return true}
  return false;
}

// --- Monitoring błędów: nieobsłużone błędy JS trafiają do bazy (z limitem), żeby właściciel wiedział o problemach ---
var errSent=0,errSeen={};
function reportError(msg,src){
  try{
    msg=String(msg||'').slice(0,500);
    if(!S.user||!msg||errSent>=5||errSeen[msg]||Loans.isNetworkError({message:msg}))return;
    errSeen[msg]=1;errSent++;
    SB.rpc('log_client_error',{p_message:msg,p_source:String(src||'').slice(0,300),p_ua:navigator.userAgent.slice(0,200)}).then(function(){},function(){});
  }catch(e){}
}
function logTime(iso){var d=new Date(iso);return Loans.datePL(Loans.localDate(d))+', '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}

// --- Tryb offline: ostatni wczytany stan (tylko do odczytu), zapisany na urządzeniu zalogowanego użytkownika ---
var SNAP_KEY='dluznik-snapshot-v1',INST_KEY='dluznik-install-hidden',deferredInstall=null;
function snapSave(){try{localStorage.setItem(SNAP_KEY,JSON.stringify({uid:S.user.id,at:Date.now(),role:S.role,debtors:S.debtors,me:S.me,pending:S.pending}))}catch(e){}}
function snapLoad(){try{var s=JSON.parse(localStorage.getItem(SNAP_KEY)||'null');return s&&S.user&&s.uid===S.user.id?s:null}catch(e){return null}}
function snapClear(){try{localStorage.removeItem(SNAP_KEY)}catch(e){}}
// Brak sieci przy wczytywaniu: zamiast pustego ekranu z błędem pokazujemy ostatni zapisany stan.
function offlineFallback(r){
  if(!r||!r.error||!Loans.isNetworkError(r.error))return false;
  var s=snapLoad();if(!s)return false;
  S.role=s.role;S.debtors=s.debtors||[];S.me=s.me;S.pending=s.pending||[];S.offline=s.at;
  if(!cur())S.sel=S.debtors.length?S.debtors[0].id:null;
  render();return true;
}
function offlineHtml(){
  if(!S.offline)return '';
  var d=new Date(S.offline),hm=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  return '<div class="card remind"><b>Tryb offline</b><p class="sub" style="margin:4px 0 8px">Brak połączenia z internetem. Widzisz dane z '+Loans.datePL(Loans.localDate(d))+', '+hm+'. Zmiany będą możliwe po powrocie sieci.</p><div class="row"><button class="btn" id="retry">Spróbuj ponownie</button></div><p class="msg"></p></div>';
}

// --- Instalacja na telefonie: Android (przycisk) i iPhone (instrukcja) ---
function isStandalone(){return (window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
function installHidden(){try{return localStorage.getItem(INST_KEY)==='1'}catch(e){return false}}
function installHtml(){
  if(isStandalone()||installHidden())return '';
  if(deferredInstall)return '<div class="card" id="instCard"><h2>Zainstaluj aplikację</h2><p class="sub">Dodaj Dłużnik 2.0 do ekranu głównego, żeby otwierać ją jak zwykłą aplikację, także bez internetu.</p><div class="row"><button class="btn" id="instBtn">Zainstaluj aplikację</button><button class="btn ghost" id="instNo" style="color:var(--ink)">Nie teraz</button></div></div>';
  if(isIOS())return '<div class="card" id="instCard"><h2>Zainstaluj aplikację</h2><p class="sub">Dotknij przycisku Udostępnij (kwadrat ze strzałką) w Safari, a potem „Dodaj do ekranu początkowego”. Aplikacja będzie otwierać się jak zwykła, także bez internetu.</p><div class="row"><button class="btn ghost" id="instNo" style="color:var(--ink)">Rozumiem, ukryj</button></div></div>';
  return '';
}
function showInstall(){var p=document.getElementById('panel');if(p&&!document.getElementById('instCard'))p.insertAdjacentHTML('afterbegin',installHtml())}

// --- Powiadomienia push (Web Push): właściciel dostaje je po zgłoszeniu spłaty, dłużnik po decyzji ---
var pushKeyCache=null;
function pushSupported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window}
async function pushStatus(){
  if(!pushSupported())return (isIOS()&&!isStandalone())?'needs-install':'unsupported';
  if(Notification.permission==='denied')return 'denied';
  try{var reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();return sub&&Notification.permission==='granted'?'on':'off'}catch(e){return 'off'}
}
function pushCard(){
  var s=S.pushState,h='<div class="card" id="pushCard"><h2>Powiadomienia</h2>';
  if(s==='unknown'||s==='unsupported')return '';
  var what=S.role==='debtor'?'Dostaniesz powiadomienie, gdy właściciel zaakceptuje lub odrzuci Twoją spłatę.':'Dostaniesz powiadomienie, gdy dłużnik zgłosi spłatę do akceptacji.';
  if(s==='needs-install')return h+'<p class="sub">Na iPhone powiadomienia działają po dodaniu aplikacji do ekranu głównego (Udostępnij → Dodaj do ekranu początkowego). Otwórz ją potem z ikony i włącz powiadomienia tutaj.</p></div>';
  if(s==='denied')return h+'<p class="sub">Powiadomienia są zablokowane w ustawieniach przeglądarki lub telefonu dla tej aplikacji. Odblokuj je tam, a potem wróć tutaj.</p></div>';
  if(s==='busy')return h+'<p class="sub">Włączanie…</p></div>';
  if(s==='on')return h+'<p class="sub">Włączone na tym urządzeniu. '+what+'</p><div class="row"><button class="btn ghost" id="pushOff" style="color:var(--ink)">Wyłącz powiadomienia</button></div><p class="msg"></p></div>';
  return h+'<p class="sub">'+what+'</p><div class="row"><button class="btn" id="pushOn">Włącz powiadomienia</button></div><p class="msg"></p></div>';
}
// Odświeża kartę w miejscu (bez przerysowania całego widoku, żeby nie zgubić wpisywanych pól).
function updatePushCard(){
  var p=document.getElementById('panel');if(!p||!S.role)return;
  var h=pushCard(),el=document.getElementById('pushCard');
  if(el){if(h)el.outerHTML=h;else el.remove()}
  else if(h){var ic=document.getElementById('instCard');if(ic)ic.insertAdjacentHTML('afterend',h);else p.insertAdjacentHTML('afterbegin',h)}
}
async function pushSaveCurrent(){
  try{
    var reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub)return null;
    var j=sub.toJSON();
    return await SB.rpc('save_push_subscription',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,p_ua:navigator.userAgent.slice(0,200)});
  }catch(e){return null}
}
async function refreshPush(){S.pushState=await pushStatus();if(S.pushState==='on')pushSaveCurrent();updatePushCard()}
async function pushKey(){
  if(pushKeyCache)return pushKeyCache;
  var r=await SB.functions.invoke('send-push',{body:{action:'key'}});
  if(r.error||!r.data||!r.data.publicKey)throw new Error('brak klucza');
  return pushKeyCache=r.data.publicKey;
}
async function pushEnable(){
  S.pushState='busy';updatePushCard();
  try{
    var perm=await Notification.requestPermission(); // musi być pierwsze: wymaga bezpośredniego gestu użytkownika (iOS)
    if(perm!=='granted'){S.pushState=perm==='denied'?'denied':'off';updatePushCard();return}
    var key=await pushKey(),reg=await navigator.serviceWorker.ready;
    var sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Loans.urlBase64ToUint8Array(key)});
    var j=sub.toJSON(),r=await SB.rpc('save_push_subscription',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,p_ua:navigator.userAgent.slice(0,200)});
    if(r.error){try{await sub.unsubscribe()}catch(e2){}throw r.error}
    S.pushState='on';
  }catch(e){S.pushState='off';updatePushCard();toast('Nie udało się włączyć powiadomień. Spróbuj ponownie.');return}
  updatePushCard();toast('Powiadomienia włączone.');
}
// Usuwa z serwera subskrypcję tego urządzenia (przeglądarka zachowuje własną, więc po ponownym logowaniu wraca sama).
async function pushCleanup(){
  if(!pushSupported())return;
  try{var reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub)await SB.from('push_subscriptions').delete().eq('endpoint',sub.endpoint)}catch(e){}
}
async function pushDisable(){
  try{var reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    if(sub){await SB.from('push_subscriptions').delete().eq('endpoint',sub.endpoint);await sub.unsubscribe()}}catch(e){}
  S.pushState='off';updatePushCard();toast('Powiadomienia wyłączone.');
}
// Prosi funkcję serwerową o wysłanie powiadomienia; ona sama sprawdza uprawnienia i wysyła najwyżej raz.
function notifyPush(type,id){try{SB.functions.invoke('send-push',{body:{action:'notify',type:type,request_id:id}}).catch(function(){})}catch(e){}}

// opts.soft: odświeżanie w tle (po powrocie do aplikacji): błąd sieci nic nie psuje, a bez zmian w danych nie przerysowujemy widoku.
async function load(opts){
  var soft=!!(opts&&opts.soft);
  // Rolę ustala baza: konto dłużnika dostaje swój przegląd, właściciel dostaje null i widzi wszystkie swoje listy.
  var ov=await SB.rpc('debtor_overview');
  if(ov.error&&soft)return;
  if(offlineFallback(ov))return;
  if(fail(ov))return;
  if(ov.data){
    var changedD=S.role!=='debtor'||!!S.offline||JSON.stringify(S.me)!==JSON.stringify(ov.data);
    S.role='debtor';S.me=ov.data;S.debtors=[];S.sel=null;S.pending=[];S.offline=0;S.lastLoad=Date.now();snapSave();
    if(changedD||!soft){render();refreshPush()}
    return;
  }
  if(S.user&&S.user.user_metadata&&S.user.user_metadata.role==='debtor'){
    // konto dłużnika bez wiersza dostępu: właściciel odebrał dostęp, więc nie pokazujemy mu pustego widoku właściciela
    await SB.auth.signOut();toast('Dostęp do tego konta został wyłączony przez właściciela.');return;
  }
  S.role='admin';S.me=null;
  var a=await SB.from('debtors').select('*').order('created_at'),b=await SB.from('entries').select('*'),
      c=await SB.from('repayment_requests').select('*').eq('status','pending').order('created_at'),
      g=await SB.from('debtor_access').select('debtor_id,login');
  var bad=[a,b,c,g].find(function(x){return x.error});
  if(bad&&soft)return;
  if(bad&&offlineFallback(bad))return;
  if(fail(a)||fail(b)||fail(c)||fail(g))return;
  var before=JSON.stringify([S.debtors,S.pending]),wasOffline=!!S.offline;
  var acc={};g.data.forEach(function(x){acc[x.debtor_id]=x.login});
  S.pending=c.data.map(function(r){return{id:r.id,debtor_id:r.debtor_id,amount:+r.amount,method:r.method,note:r.note||'',created_at:r.created_at}});
  S.debtors=a.data.map(function(d){return{id:d.id,name:d.name,rate:0,access:acc[d.id]||'',remind_at:d.remind_at||'',remind_note:d.remind_note||'',entries:b.data.filter(function(e){return e.debtor_id===d.id}).map(function(e){return{id:e.id,type:e.type,date:e.date,amount:+e.amount,note:e.note||''}})}});
  if(!cur())S.sel=S.debtors.length?S.debtors[0].id:null;
  S.offline=0;S.lastLoad=Date.now();snapSave();
  if(soft&&!wasOffline&&JSON.stringify([S.debtors,S.pending])===before)return;
  render();refreshPush();
}

function render(){
  var t=document.getElementById('tabs'),p=document.getElementById('panel'),bar=document.getElementById('bar');
  if(!S.user){
    bar.innerHTML='';t.innerHTML='';
    p.innerHTML=installHtml()+'<div class="card"><h2>Zaloguj się</h2><div class="row"><label>Login lub e-mail<input id="em" type="text" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"></label><label>Hasło (min. 6 znaków)<input id="pw" type="password" autocomplete="current-password"></label></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn" id="login">Zaloguj</button></div><p class="msg" id="msg"></p></div>';
    return;
  }
  if(S.user.user_metadata&&S.user.user_metadata.must_change_password){
    t.innerHTML='';
    bar.innerHTML='<span class="sub" style="margin:0">'+esc(S.user.email)+'</span><button class="btn ghost" id="logout" style="color:var(--mute)">Wyloguj</button>';
    p.innerHTML='<div class="card"><h2>Ustaw własne hasło</h2><p class="sub">Logujesz się hasłem tymczasowym. Ustaw nowe hasło, aby korzystać z aplikacji.</p>'+
    '<div class="row"><label>Nowe hasło (min. 8 znaków)<input id="pw1" type="password" autocomplete="new-password"></label><label>Powtórz hasło<input id="pw2" type="password" autocomplete="new-password"></label></div>'+
    '<div class="foot"><button class="btn" id="setpw">Zapisz hasło</button></div><p class="msg" id="msg"></p></div>';
    return;
  }
  if(!S.role){
    // baza jeszcze nie powiedziała, kim jest użytkownik: dłużnik nie może zobaczyć nawet chwilowo widoku właściciela
    bar.innerHTML='<span class="sub" style="margin:0">'+esc(S.user.email)+'</span><button class="btn ghost" id="logout" style="color:var(--mute)">Wyloguj</button>';
    t.innerHTML='';p.innerHTML='<div class="card"><p class="empty">Ładowanie…</p><p class="msg" id="msg"></p></div>';return;
  }
  if(S.role==='debtor'){renderDebtor();return}
  bar.innerHTML='<span class="sub" style="margin:0">'+esc(S.user.email)+'</span><span style="display:flex;gap:8px"><button class="btn ghost" id="pwToggle" style="color:var(--mute)">Hasło</button><button class="btn ghost" id="logout" style="color:var(--mute)">Wyloguj</button></span>';
  t.innerHTML=S.debtors.map(function(d){return '<button class="tab" role="tab" aria-selected="'+(d.id===S.sel)+'" data-id="'+d.id+'">'+esc(d.name||'Bez nazwy')+'</button>'}).join('')+'<button class="tab" id="addD">+ Dłużnik</button>';
  var d=cur();
  if(!d){p.innerHTML=offlineHtml()+installHtml()+pushCard()+pwCard()+reqHtml()+'<div class="card"><p class="empty">Dodaj pierwszego dłużnika, aby zacząć liczyć.</p><p class="msg" id="msg"></p></div>';return}
  var c=calc(d),rows=c.sorted.map(function(e){
    if(S.editId===e.id){
      return '<tr class="edit"><td colspan="4"><div class="editrow">'+
        '<input id="ed-dt" type="date" value="'+esc(e.date)+'" aria-label="Data">'+
        '<select id="ed-ty" aria-label="Rodzaj"><option value="loan"'+(e.type==='loan'?' selected':'')+'>Pożyczka</option><option value="pay"'+(e.type==='pay'?' selected':'')+'>Spłata</option></select>'+
        '<input id="ed-am" type="number" min="0" step="0.01" inputmode="decimal" value="'+e.amount+'" aria-label="Kwota (zł)">'+
        '<input id="ed-nt" class="wide" maxlength="200" placeholder="Opis (opcjonalnie)" value="'+esc(e.note||'')+'" aria-label="Opis">'+
        '<span class="act"><button class="x" data-save="'+e.id+'" aria-label="Zapisz zmiany">✓</button><button class="x" data-cancel="1" aria-label="Anuluj edycję">✕</button></span></div></td></tr>';
    }
    return '<tr><td>'+e.date+'</td><td class="'+e.type+'">'+(e.type==='loan'?'Pożyczka':'Spłata')+(e.note?'<span class="note">'+esc(e.note)+'</span>':'')+'</td><td class="n '+e.type+'">'+fmt.format(e.amount)+'</td>'+
      '<td class="act"><button class="x" data-edit="'+e.id+'" aria-label="Edytuj wpis">✎</button><button class="x" data-del="'+e.id+'" aria-label="Usuń wpis">×</button></td></tr>';
  }).join('');
  p.innerHTML=offlineHtml()+installHtml()+pushCard()+pwCard()+reqHtml()+dueHtml()+
  '<div class="card"><div class="row"><label>Imię lub nazwa<input id="nm" value="'+esc(d.name)+'"></label></div><p class="msg" id="msg"></p></div>'+
  '<div class="card"><p class="sub">'+(c.owed<0?'Nadpłata':'Do spłaty dziś')+'</p><p class="total '+(c.owed>0?'neg':'pos')+'">'+fmt.format(Math.abs(c.owed))+'</p><p class="sub"></p>'+
  '<div class="grid"><div>Łącznie pożyczono<b class="neg">'+fmt.format(c.lent)+'</b></div><div>Łącznie spłacono<b class="pos">'+fmt.format(c.paid)+'</b></div></div></div>'+
  '<div class="card"><h2>Szybkie dopisanie kwoty (dziś)</h2><div class="row"><label>Kwota (zł)<input id="qa" type="text" inputmode="decimal" placeholder="np. 250" autocomplete="off"></label><label>Opis (opcjonalnie)<input id="qn" maxlength="200" autocomplete="off"></label></div>'+
  '<div class="row" style="margin-top:10px"><button class="btn" id="qLoan" style="background:var(--debt);color:#fff">+ Dług</button><button class="btn" id="qPay" style="background:var(--paid);color:#fff">− Spłata</button></div></div>'+
  '<div class="card"><h2>Dodaj wpis</h2><div class="row"><label>Rodzaj<select id="ty"><option value="loan">Pożyczka</option><option value="pay">Spłata</option></select></label>'+
  '<label>Data (opcjonalnie)<input id="dt" type="date" value="'+today()+'"></label><label>Kwota (zł)<input id="am" type="number" min="0" step="0.01" inputmode="decimal"></label>'+
  '<label class="wide">Opis (opcjonalnie)<input id="nt" maxlength="200" placeholder="np. przelew za październik" autocomplete="off"></label></div>'+
  '<div class="foot"><button class="btn" id="addE">Dodaj wpis</button></div></div>'+
  '<div class="card"><h2>Historia</h2>'+(rows?'<div class="tablewrap"><table><thead><tr><th>Data</th><th>Rodzaj</th><th class="n">Kwota</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="empty">Brak wpisów. Dodaj pierwszą pożyczkę.</p>')+'<p class="msg"></p></div>'+
  '<div class="card"><h2>Historia zmian</h2><p class="sub">Kto i kiedy dopisał, zmienił lub usunął wpis. Zapisuje to baza, więc nie da się tego ominąć z aplikacji (historia obejmuje zmiany od 3.11.2026).</p><div id="logBox"><div class="row"><button class="btn ghost" id="logShow" style="color:var(--ink)">Pokaż historię zmian</button></div></div></div>'+
  '<div class="card"><h2>Przypomnienie o kwocie</h2><p class="sub">Przy otwarciu aplikacji w dniu terminu (lub później) zobaczysz na górze aktualną kwotę do spłaty.</p>'+
  '<div class="row"><label>Termin<input id="rd" type="date" value="'+esc(d.remind_at)+'"></label><label>Notatka (opcjonalnie)<input id="rn" maxlength="200" value="'+esc(d.remind_note)+'"></label></div>'+
  '<div class="row" style="margin-top:10px"><button class="btn" id="rSave">Zapisz przypomnienie</button><button class="btn ghost" id="rIcs" style="color:var(--ink)">Dodaj do Kalendarza iPhone</button><button class="btn ghost" id="rClear">Usuń</button></div></div>'+
  '<div class="card"><h2>Plan rat dla pozostałego kapitału</h2><div class="row"><label>Liczba miesięcy<input id="mo" type="number" min="1" step="1" value="12" inputmode="numeric"></label>'+
  '<label>Rata miesięczna<input id="rata" readonly></label></div></div>'+
  '<div class="card"><h2>Import z Notatek (iPhone)</h2><p class="sub">W Notatkach zaznacz tekst, wybierz Kopiuj i wklej tutaj. Kwota bez znaku to dług (pożyczka). Spłatą jest kwota z minusem oraz linie pod nagłówkiem „Faktury wpłaty:” lub „Przelewy otrzymane” (do pustej linii). Reszta linii po kwocie trafia do opisu. Linie z samymi godzinami (np. „45h wypłata”) liczą się jako godziny × stawka. Sumy i obliczenia (=, +) są pomijane, a ich listę zobaczysz w podglądzie.</p>'+
  '<label class="filepick">Wczytaj z pliku (Pliki, iCloud Drive: .txt, .md, .csv)<input id="impfile" type="file" accept=".txt,.text,.md,.csv,text/plain,text/markdown,text/csv"></label>'+
  '<textarea id="imptxt" placeholder="Jan Kowalski:&#10;01.10.2026 +500&#10;15.10.2026 -200 zł"></textarea>'+
  '<label style="display:flex;gap:8px;align-items:center;margin:10px 0;font-size:14px"><input type="checkbox" id="flip" style="width:auto;min-height:0">Odwróć znaki (plus = spłata, minus = pożyczka)</label>'+
  '<label style="display:flex;gap:8px;align-items:center;margin:0 0 10px;font-size:14px"><input type="checkbox" id="hdr" style="width:auto;min-height:0">Linia bez kwoty to nazwa dłużnika (np. „Jan Kowalski:”)</label>'+
  '<div class="row" style="margin-bottom:10px"><label>Stawka za godzinę (zł), puste = z notatki<input id="hrate" type="number" min="0" step="0.5" inputmode="decimal" placeholder="np. 40"></label>'+
  '<label>Data dla wpisów bez daty (puste = dziś)<input id="idate" type="date"></label></div>'+
  '<button class="btn" id="prev">Podgląd importu</button><div id="impOut" class="imp"></div></div>'+
  '<div class="card"><h2>Eksport do PDF (dla dłużnika)</h2><p class="sub">Ładne rozliczenie do pokazania lub wysłania dłużnikowi: lista długów, spłaty i kwota końcowa. Pola poniżej są opcjonalne. Otworzy się okno drukowania, wybierz w nim „Zapisz jako PDF” (iPhone: Udostępnij → Zapisz w Plikach).</p>'+
  '<div class="row"><label class="wide">Wiadomość do dłużnika<textarea id="pdfmsg" maxlength="400" style="min-height:72px" placeholder="np. Cześć, wysyłam rozliczenie. Daj znać, kiedy możesz oddać."></textarea></label>'+
  '<label>Termin zapłaty<input id="pdfdue" type="date"></label><label>Numer konta lub BLIK<input id="pdfacct" maxlength="80" autocomplete="off"></label></div>'+
  '<div class="row" style="margin-top:10px"><button class="btn" id="pdfExp">Pobierz PDF</button></div></div>'+
  accessCard(d)+'<div class="card"><h2>Eksport do Notatek (iPhone)</h2><p class="sub">Otworzy się menu udostępniania. Wybierz w nim Notatki. Format jest taki sam jak w imporcie.</p>'+
  '<div class="row"><button class="btn" id="expOne">Ten dłużnik</button><button class="btn" id="expAll">Wszyscy dłużnicy</button></div><div id="expOut"></div></div>'+
  '<div class="foot"><button class="btn ghost" id="delD">Usuń dłużnika</button></div>';
  plan();
}
// Karta zmiany hasła (otwierana przyciskiem "Hasło" w pasku), dostępna dla każdego zalogowanego konta.
function pwCard(){
  if(!S.pwOpen)return '';
  return '<div class="card"><h2>Zmień hasło</h2><div class="row"><label>Nowe hasło (min. 8 znaków)<input id="pw1" type="password" autocomplete="new-password"></label><label>Powtórz hasło<input id="pw2" type="password" autocomplete="new-password"></label></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn" id="chpw">Zapisz hasło</button><button class="btn ghost" id="pwCancel" style="color:var(--ink)">Anuluj</button></div><p class="msg"></p></div>';
}
// Baner właściciela: spłaty zgłoszone przez dłużników, czekające na akceptację.
function reqHtml(){
  if(!S.pending.length)return '';
  return '<div class="card remind"><b>💰 Zgłoszone spłaty do akceptacji ('+S.pending.length+')</b>'+S.pending.map(function(r){
    var d=S.debtors.find(function(x){return x.id===r.debtor_id});
    return '<div class="req"><p class="sub" style="margin:8px 0 6px"><b>'+esc(d?d.name:'?')+'</b> · <b class="pos">'+fmt.format(r.amount)+'</b> · '+esc(Loans.methodLabel(r.method))+' · '+Loans.datePL(Loans.localDate(new Date(r.created_at)))+(r.note?'<br>'+esc(r.note):'')+'</p>'+
      '<div class="row"><button class="btn" data-rapprove="'+esc(r.id)+'">Akceptuj</button><button class="btn ghost" data-rreject="'+esc(r.id)+'" style="color:var(--ink)">Odrzuć</button></div></div>';
  }).join('')+'<p class="msg"></p></div>';
}
// Karta właściciela: konto logowania dłużnika (login i hasło tymczasowe).
function accessCard(d){
  var c=S.cred&&S.cred.debtor_id===d.id?S.cred:null;
  var h='<div class="card"><h2>Dostęp dla dłużnika</h2><p class="sub">Dłużnik loguje się własnym loginem, widzi tylko swoją listę i może zgłosić spłatę (kwota, sposób płatności, adnotacja), którą Ty akceptujesz. Przy pierwszym logowaniu ustawi własne hasło.</p>';
  if(c)h+='<div class="cred"><b>Dostęp gotowy.</b> Przekaż dłużnikowi:<br>Aplikacja: <b>'+esc(location.origin)+'</b><br>Login: <b>'+esc(c.login)+'</b><br>Hasło tymczasowe: <b>'+esc(c.password)+'</b><br><span class="sub">Hasło widać tylko teraz.</span><div class="row" style="margin-top:8px"><button class="btn ghost" id="acCopy" style="color:var(--ink)">Kopiuj dane logowania</button></div></div>';
  if(d.access){
    h+='<p class="sub" style="margin:0 0 8px">Login dłużnika: <b>'+esc(d.access)+'</b></p><div class="row"><label>Nowe hasło tymczasowe<input id="acpw" maxlength="72" autocomplete="off" autocapitalize="none"></label></div>'+
      '<div class="row" style="margin-top:10px"><button class="btn" id="acReset">Ustaw nowe hasło</button><button class="btn ghost" id="acGen" style="color:var(--ink)">Wygeneruj hasło</button><button class="btn ghost" id="acDel">Usuń dostęp</button></div>';
  }else{
    h+='<div class="row"><label>Login dłużnika (małe litery, bez spacji)<input id="aclogin" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="np. zosia"></label>'+
      '<label>Hasło tymczasowe (min. 8 znaków)<input id="acpw" maxlength="72" autocomplete="off" autocapitalize="none"></label></div>'+
      '<div class="row" style="margin-top:10px"><button class="btn" id="acCreate">Utwórz dostęp</button><button class="btn ghost" id="acGen" style="color:var(--ink)">Wygeneruj hasło</button></div>';
  }
  return h+'<p class="msg"></p></div>';
}
// Widok konta dłużnika: jego rozliczenie (tylko do odczytu), zgłaszanie spłat i historia zgłoszeń.
function renderDebtor(){
  var t=document.getElementById('tabs'),p=document.getElementById('panel'),bar=document.getElementById('bar'),m=S.me,
      s=Loans.settlement({rate:0,entries:m.entries.map(function(e){return{id:e.id,type:e.type,date:e.date,amount:+e.amount,note:e.note||''}})}),
      head=s.status==='debt'?'Do zapłaty dziś':s.status==='over'?'Nadpłata':'Rozliczone w całości';
  bar.innerHTML='<span class="sub" style="margin:0">Login: <b>'+esc(m.login)+'</b></span><span style="display:flex;gap:8px"><button class="btn ghost" id="pwToggle" style="color:var(--mute)">Hasło</button><button class="btn ghost" id="logout" style="color:var(--mute)">Wyloguj</button></span>';
  t.innerHTML='';
  var rows=m.entries.slice().reverse().map(function(e){
    return '<tr><td>'+Loans.datePL(e.date)+'</td><td class="'+esc(e.type)+'">'+(e.type==='loan'?'Dług':'Spłata')+(e.note?'<span class="note">'+esc(e.note)+'</span>':'')+'</td><td class="n '+esc(e.type)+'">'+fmt.format(+e.amount)+'</td></tr>';
  }).join('');
  var reqs=m.requests.map(function(r){
    return '<li class="rq"><div><b>'+fmt.format(+r.amount)+'</b> · '+esc(Loans.methodLabel(r.method))+' · '+Loans.datePL(Loans.localDate(new Date(r.created_at)))+' <span class="st '+esc(r.status)+'">'+esc(Loans.statusLabel(r.status))+'</span></div>'+
      (r.note?'<div class="note" style="max-width:none">'+esc(r.note)+'</div>':'')+(r.decision_note?'<div class="note" style="max-width:none">Powód odrzucenia: '+esc(r.decision_note)+'</div>':'')+'</li>';
  }).join('');
  p.innerHTML=offlineHtml()+installHtml()+pushCard()+pwCard()+
    '<div class="card"><h2>Rozliczenie: '+esc(m.name)+'</h2><p class="sub">'+head+'</p><p class="total '+(s.status==='debt'?'neg':'pos')+'">'+fmt.format(s.due)+'</p>'+
    '<div class="grid"><div>Łącznie pożyczono<b class="neg">'+fmt.format(s.lent)+'</b></div><div>Łącznie spłacono<b class="pos">'+fmt.format(s.paid)+'</b></div></div></div>'+
    '<div class="card"><h2>Zgłoś spłatę</h2><p class="sub">Wpisz kwotę, którą oddałeś, i wybierz sposób płatności. Spłata pojawi się na liście dopiero po akceptacji przez właściciela.</p>'+
    '<div class="row"><label>Kwota (zł)<input id="dq" type="text" inputmode="decimal" placeholder="np. 250" autocomplete="off"></label>'+
    '<label>Sposób płatności<select id="dm"><option value="blik">BLIK</option><option value="przelew">Przelew</option><option value="gotowka">Gotówka</option><option value="inne">Inna forma</option></select></label>'+
    '<label class="wide">Adnotacja (opcjonalnie)<input id="dn" maxlength="200" autocomplete="off" placeholder="np. przelew za październik"></label></div>'+
    '<div class="row" style="margin-top:10px"><button class="btn" id="dSend">Wyślij do akceptacji</button></div><p class="msg"></p></div>'+
    '<div class="card"><h2>Twoje zgłoszenia</h2>'+(reqs?'<ul class="rqs">'+reqs+'</ul>':'<p class="empty">Nie zgłoszono jeszcze żadnej spłaty.</p>')+'</div>'+
    '<div class="card"><h2>Rozliczenie do pobrania</h2><p class="sub">Zestawienie długów, spłat i kwoty końcowej jako dokument PDF (w oknie drukowania wybierz „Zapisz jako PDF”).</p><div class="row"><button class="btn" id="dPdf">Pobierz PDF</button></div></div>'+
    '<div class="card"><h2>Historia długu</h2>'+(rows?'<div class="tablewrap"><table><thead><tr><th>Data</th><th>Rodzaj</th><th class="n">Kwota</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="empty">Brak wpisów.</p>')+'</div>'+
    '<div class="card"><h2>Prywatność</h2><p class="sub" style="margin:0">Ta aplikacja przechowuje Twoje imię, wpisy długu i spłat oraz Twoje zgłoszenia spłat. Widzisz je Ty i właściciel listy, nikt inny. Dane są zapisane na serwerze w Unii Europejskiej (Frankfurt). Powiadomienia na telefonie zawierają tylko ogólną informację, bez imion i kwot. Jeśli chcesz usunąć konto lub dane, poproś o to właściciela listy.</p></div>';
}
// Wywołanie funkcji serwerowej (zakładanie / reset / usuwanie konta dłużnika). Zwraca { ok, error }.
async function fnCall(body){
  var r=await SB.functions.invoke('manage-debtor-login',{body:body});
  if(!r.error)return{ok:true,data:r.data};
  var msg='Nie udało się. Spróbuj ponownie.';
  try{var j=await r.error.context.json();if(j&&j.error)msg=j.error}catch(e){}
  return{ok:false,error:msg};
}
function genPw(){
  var a='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=new Uint32Array(10),o='';
  crypto.getRandomValues(b);for(var i=0;i<b.length;i++)o+=a[b[i]%a.length];
  return o;
}
function dueHtml(){
  var t=today(),a=S.debtors.filter(function(d){return d.remind_at&&d.remind_at<=t});
  if(!a.length)return '';
  return a.map(function(d){
    var c=calc(d),p=d.remind_at.split('-');
    return '<div class="card remind"><b>🔔 Przypomnienie: '+esc(d.name||'Bez nazwy')+'</b><p class="sub" style="margin:4px 0 8px">Termin '+p[2]+'.'+p[1]+'.'+p[0]+' · '+(c.owed<0?'nadpłata ':'do spłaty ')+'<b class="'+(c.owed>0?'neg':'pos')+'">'+fmt.format(Math.abs(c.owed))+'</b>'+(d.remind_note?'<br>'+esc(d.remind_note):'')+'</p>'+
      '<div class="row"><button class="btn" data-rgo="'+d.id+'">Otwórz</button><button class="btn ghost" data-rsnooze="'+d.id+'" style="color:var(--ink)">Odłóż o 7 dni</button><button class="btn ghost" data-rdone="'+d.id+'" style="color:var(--ink)">Gotowe</button></div></div>';
  }).join('');
}
function addDays(iso,n){var x=new Date(iso+'T12:00:00');x.setDate(x.getDate()+n);return Loans.localDate(x)}
function icsFor(d){
  var c=calc(d),day=d.remind_at.replace(/-/g,''),end=addDays(d.remind_at,1).replace(/-/g,'');
  var sum='Przypomnienie: '+d.name+' – '+(c.owed<0?'nadpłata ':'do spłaty ')+fmt.format(Math.abs(c.owed));
  function f(x){return String(x).replace(/\\/g,'\\\\').replace(/[,;]/g,'\\$&').replace(/\r?\n/g,'\\n')}
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kalkulator//PL','BEGIN:VEVENT','UID:'+d.id+'-'+day+'@kalkulator','DTSTAMP:'+today().replace(/-/g,'')+'T000000Z',
    'DTSTART;VALUE=DATE:'+day,'DTEND;VALUE=DATE:'+end,'SUMMARY:'+f(sum),'DESCRIPTION:'+f(d.remind_note||''),
    'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+f(sum),'TRIGGER:PT9H','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
}
function plan(){
  var d=cur(),m=document.getElementById('mo'),o=document.getElementById('rata'); if(!d||!m)return;
  var c=calc(d),n=Math.max(1,parseInt(m.value)||1);
  o.value=fmt.format(Loans.monthlyPayment(c.cap+c.int,d.rate,n));
}

// Podgląd importu: wiersze, które już są na liście, są oznaczone, a pole „Pomiń” decyduje, czy wchodzą do sum i importu.
var IMPPR=null,IMPMULTI=false;
function impActive(){return IMP.filter(function(x){return !(S.skipDup&&x.dup)})}
function renderImpPreview(){
  var box=document.getElementById('impOut'),pr=IMPPR,multi=IMPMULTI;if(!box||!pr)return;
  if(!IMP.length){box.innerHTML='<p class="empty" style="margin-top:12px">Nie znaleziono kwot. Użyj formatu „1500 zł klej” albo „01.10.2026 +500”.</p>'+skipHtml(pr.skip);return}
  var nd=IMP.filter(function(x){return x.dup}).length,act=impActive(),
      nl=act.filter(function(x){return x.type==='loan'}),np=act.filter(function(x){return x.type==='pay'}),sl=sumAmounts(nl),sp=sumAmounts(np);
  box.innerHTML=(nd?'<p class="sub" style="margin:12px 0 6px"><b>Wykryto '+nd+' wpisów, które już są na liście.</b></p><label style="display:flex;gap:8px;align-items:center;margin:0 0 6px;font-size:14px"><input type="checkbox" id="skipdup" style="width:auto;min-height:0"'+(S.skipDup?' checked':'')+'>Pomiń wpisy, które już są na liście</label>':'')+
    '<div class="grid" style="margin-top:12px"><div>Długi (pożyczki), '+nl.length+' wpisów<b class="neg">'+fmt.format(sl)+'</b></div><div>Spłaty, '+np.length+' wpisów<b class="pos">'+fmt.format(sp)+'</b></div></div>'+
    (pr.hours&&pr.hours.lines?'<p class="sub" style="margin-top:8px">Godziny przeliczone na kwoty: '+pr.hours.lines+' linii po '+pr.hours.rate+' zł/h.</p>':'')+
    '<p class="sub" style="margin-top:8px">Saldo po imporcie (bez odsetek): <strong class="'+(sl-sp>0?'neg':'pos')+'">'+fmt.format(sl-sp)+'</strong></p>'+
    '<div class="tablewrap"><table><thead><tr>'+(multi?'<th>Dłużnik</th>':'')+'<th>Data</th><th>Rodzaj i opis</th><th class="n">Kwota</th></tr></thead><tbody>'+
    IMP.map(function(x){return '<tr'+(x.dup&&S.skipDup?' style="opacity:.5"':'')+'>'+(multi?'<td>'+esc(x.who)+'</td>':'')+'<td>'+x.date+'</td><td class="'+x.type+'">'+(x.type==='loan'?'Pożyczka':'Spłata')+(x.dup?' <span class="st pending">już jest</span>':'')+(x.note?'<span class="note">'+esc(x.note)+'</span>':'')+'</td><td class="n '+x.type+'">'+fmt.format(x.amount)+'</td></tr>'}).join('')+'</tbody></table></div>'+
    skipHtml(pr.skip)+
    '<div class="foot"><button class="btn" id="doImp">Importuj '+act.length+' wpisów</button></div>';
}
// Drukuje (zapisuje jako PDF) rozliczenie dłużnika d z opcjami o = { msg, due, acct }.
function printSettlement(d,o){
  var host=document.getElementById('pdfdoc');
  if(!host){host=document.createElement('div');host.id='pdfdoc';document.body.appendChild(host)}
  host.innerHTML=pdfHtml(d,o);
  var oldTitle=document.title;document.title='Rozliczenie - '+d.name+' - '+today(); // podpowiedź nazwy pliku PDF
  window.onafterprint=function(){host.innerHTML='';document.title=oldTitle;window.onafterprint=null};
  window.print();
}
// Odświeżanie w tle: po powrocie do aplikacji i co minutę, ale nigdy gdy ktoś coś wpisuje lub edytuje.
var refreshing=false;
function userTyping(){var a=document.activeElement;return !!a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!!a.closest&&!!a.closest('#panel')}
function hasDraft(){
  return ['qa','qn','am','nt','dq','dn','imptxt','pdfmsg','pdfacct','pw1','pw2','acpw','aclogin','hrate'].some(function(id){var e=document.getElementById(id);return !!(e&&e.value&&e.value.trim())});
}
async function softRefresh(){
  if(!Loans.shouldRefresh({hidden:document.hidden,loggedIn:!!(S.user&&S.role),busy:refreshing,typing:userTyping()||hasDraft()||!!S.editId,last:S.lastLoad||0,now:Date.now(),minMs:20000}))return;
  refreshing=true;try{await load({soft:true})}finally{refreshing=false}
}
function sumAmounts(a){return Math.round(a.reduce(function(n,x){return n+x.amount},0)*100)/100}
function skipHtml(a){
  if(!a.length)return '';
  return '<details class="skipped" open><summary>Pominięto '+a.length+' linii (sumy, obliczenia, tekst bez kwoty). Chcesz którąś dodać? Wpisz kwotę, data i opis są opcjonalne.</summary><ul>'+
    a.slice(0,200).map(function(x,i){
      return '<li class="sk"><div class="skline">'+esc(x.length>160?x.slice(0,160)+'…':x)+'</div><div class="skform">'+
        '<select class="sk-ty" aria-label="Rodzaj"><option value="loan">Pożyczka</option><option value="pay">Spłata</option></select>'+
        '<input class="sk-am" type="text" inputmode="decimal" placeholder="Kwota" aria-label="Kwota">'+
        '<input class="sk-dt" type="date" aria-label="Data (opcjonalnie)">'+
        '<input class="sk-nt" maxlength="200" placeholder="Opis (opcjonalnie)" value="'+esc(x.slice(0,200))+'" aria-label="Opis"></div></li>';
    }).join('')+(a.length>200?'<li>…i '+(a.length-200)+' kolejnych (pominięte w podglądzie)</li>':'')+'</ul></details>';
}
function manualRows(who){
  var out=[],dd=(document.getElementById('idate')||{}).value||today();
  document.querySelectorAll('#impOut .sk').forEach(function(li){
    var am=parseFloat(li.querySelector('.sk-am').value.replace(/\s/g,'').replace(',','.'));
    if(!(am>0))return;
    var row={who:who,date:li.querySelector('.sk-dt').value||dd,type:li.querySelector('.sk-ty').value,amount:Math.round(am*100)/100};
    var nt=li.querySelector('.sk-nt').value.trim();if(nt)row.note=nt;
    out.push(row);
  });
  return out;
}
function refreshImpBtn(){
  var b=document.getElementById('doImp');if(!b||b.disabled)return;
  b.textContent='Importuj '+(impActive().length+manualRows('').length)+' wpisów';
}
// Dokument rozliczenia dla dłużnika (drukowany / zapisywany jako PDF). o = { msg, due, acct } z formularza.
function pdfHtml(d,o){
  var s=Loans.settlement(d),now=Loans.datePL(today());
  function table(list,empty){
    if(!list.length)return '<p class="pdf-empty">'+empty+'</p>';
    return '<table class="pdf-t"><thead><tr><th class="c">Lp.</th><th class="d">Data</th><th>Opis</th><th class="n">Kwota</th></tr></thead><tbody>'+
      list.map(function(x,i){return '<tr><td class="c">'+(i+1)+'</td><td>'+Loans.datePL(x.date)+'</td><td>'+(x.note?esc(x.note):'—')+'</td><td class="n">'+fmt.format(x.amount)+'</td></tr>'}).join('')+'</tbody></table>';
  }
  var head=s.status==='debt'?'Do zapłaty':s.status==='over'?'Nadpłata':'Rozliczone w całości',cls=s.status==='debt'?'debt':'ok',meta=[];
  if(s.status==='debt'&&o.due)meta.push('Termin zapłaty: <b>'+esc(Loans.datePL(o.due))+'</b>');
  if(o.acct)meta.push('Numer konta / BLIK: <b>'+esc(o.acct)+'</b>');
  return '<header class="pdf-head"><img src="icon-192.png" width="56" height="56" alt=""><div class="pdf-brand"><b>Dłużnik 2.0</b><span>„Jak zapomnisz, ile pożyczyłeś, to stracisz”</span></div><div class="pdf-date">Stan na<br><b>'+now+'</b></div></header>'+
    '<h1 class="pdf-title">Rozliczenie pożyczek</h1><p class="pdf-for">Dla: <b>'+esc(d.name||'Bez nazwy')+'</b></p>'+
    '<p class="pdf-intro">Poniżej przejrzyste zestawienie wszystkich pożyczek i spłat. Kwota do zapłaty to suma pożyczek pomniejszona o dotychczasowe spłaty.</p>'+
    (o.msg?'<div class="pdf-msg">'+esc(o.msg).replace(/\n/g,'<br>')+'</div>':'')+
    '<div class="pdf-sum"><div><span>Łącznie pożyczono</span><b>'+fmt.format(s.lent)+'</b></div><div><span>Łącznie spłacono</span><b>'+fmt.format(s.paid)+'</b></div><div class="pdf-due '+cls+'"><span>'+head+'</span><b>'+fmt.format(s.due)+'</b></div></div>'+
    (meta.length?'<p class="pdf-meta">'+meta.join(' &nbsp;·&nbsp; ')+'</p>':'')+
    '<h2>Lista długów ('+s.loans.length+')</h2>'+table(s.loans,'Brak zapisanych pożyczek.')+
    (s.loans.length?'<p class="pdf-subtotal">Razem pożyczono: <b>'+fmt.format(s.lent)+'</b></p>':'')+
    '<h2>Rozliczenia, czyli spłaty ('+s.pays.length+')</h2>'+table(s.pays,'Brak spłat do tej pory.')+
    (s.pays.length?'<p class="pdf-subtotal">Razem spłacono: <b>'+fmt.format(s.paid)+'</b></p>':'')+
    '<div class="pdf-final '+cls+'">'+head+': <b>'+fmt.format(s.due)+'</b></div>'+
    '<footer class="pdf-foot"><div>System <b>Dłużnik 2.0</b> stworzony przez <b>Dawida Thai Thanh</b><br>na potrzeby odzyskania pieniążków, założonych, pożyczonych i w ogóle :D</div>'+
    '<div class="pdf-foot-sub">Dokument wygenerowano '+now+'. Zestawienie ma charakter informacyjny.</div></footer>';
}
function exportText(all){
  var list=all?S.debtors:[cur()].filter(Boolean);
  return list.map(function(d){
    return d.name+':\n'+calc(d).sorted.map(function(e){var p=e.date.split('-');return p[2]+'.'+p[1]+'.'+p[0]+' '+(e.type==='loan'?'+':'-')+e.amount.toFixed(2).replace('.',',')+(e.note?' '+e.note:'')}).join('\n');
  }).join('\n\n');
}

document.addEventListener('click',async function(e){
  var t=e.target,id=t.id,d=cur(),box;
  if(id==='login'){
    var em=document.getElementById('em').value.trim(),pw=document.getElementById('pw').value;
    if(!em||pw.length<6){toast('Podaj login lub e-mail i hasło (min. 6 znaków).');return}
    var r=await SB.auth.signInWithPassword({email:Loans.loginToEmail(em),password:pw});
    if(fail(r))return;
  }
  else if(id==='logout'){await pushCleanup();await SB.auth.signOut()}
  else if(id==='logShow'&&d){
    t.disabled=true;
    var lr=await SB.from('entry_log').select('*').eq('debtor_id',d.id).order('at',{ascending:false}).limit(50);
    if(fail(lr)){t.disabled=false;return}
    var lb=document.getElementById('logBox');
    if(lb)lb.innerHTML=lr.data.length?'<ul class="rqs">'+lr.data.map(function(x){var ds=Loans.describeLog(x);return '<li class="rq"><div><b>'+esc(ds.label)+'</b> · '+esc(logTime(x.at))+'</div><div class="note" style="max-width:none">'+esc(ds.text)+'</div></li>'}).join('')+'</ul>'+(lr.data.length>=50?'<p class="sub" style="margin-top:8px">Pokazano ostatnie 50 zmian.</p>':''):'<p class="empty">Brak zapisanych zmian.</p>';
  }
  else if(id==='pushOn'){await pushEnable()}
  else if(id==='pushOff'){await pushDisable()}
  else if(id==='pwToggle'){S.pwOpen=!S.pwOpen;render();var f1=document.getElementById('pw1');if(f1)f1.focus()}
  else if(id==='pwCancel'){S.pwOpen=false;render()}
  else if(id==='instBtn'&&deferredInstall){
    deferredInstall.prompt();try{await deferredInstall.userChoice}catch(err){}
    deferredInstall=null;var ic=document.getElementById('instCard');if(ic)ic.remove();
  }
  else if(id==='instNo'){try{localStorage.setItem(INST_KEY,'1')}catch(err){}var ic2=document.getElementById('instCard');if(ic2)ic2.remove()}
  else if(id==='retry'){t.disabled=true;await load();if(S.offline){t.disabled=false;toast('Nadal brak połączenia z internetem.')}}
  else if(id==='dSend'&&S.role==='debtor'){
    // dłużnik zgłasza spłatę: trafia do akceptacji właściciela, na liście pojawi się dopiero po niej
    var dqv=parseFloat(document.getElementById('dq').value.replace(',','.')),dmv=document.getElementById('dm').value,dnv=document.getElementById('dn').value.trim();
    if(!(dqv>0)){document.getElementById('dq').focus();toast('Wpisz kwotę większą od zera.');return}
    t.disabled=true;
    var sr=await SB.rpc('submit_repayment',{p_amount:Math.round(dqv*100)/100,p_method:dmv,p_note:dnv||null});
    if(fail(sr)){t.disabled=false;return}
    notifyPush('request',sr.data);
    await load();toast('Zgłoszenie wysłane. Pojawi się na liście po akceptacji.');
  }
  else if(t.dataset.rapprove||t.dataset.rreject){
    var rid=t.dataset.rapprove||t.dataset.rreject,apv=!!t.dataset.rapprove,why=null;
    if(!apv){why=prompt('Powód odrzucenia (opcjonalnie, zobaczy go dłużnik):');if(why===null)return}
    t.disabled=true;
    var dr2=await SB.rpc('decide_repayment',{p_id:rid,p_approve:apv,p_reason:why});
    if(fail(dr2)){t.disabled=false;return}
    notifyPush('decision',rid);
    await load();toast(apv?'Zaakceptowano. Spłata jest już na liście dłużnika.':'Zgłoszenie odrzucone.');
  }
  else if(id==='acGen'){document.getElementById('acpw').value=genPw()}
  else if((id==='acCreate'||id==='acReset')&&d){
    var pwv=document.getElementById('acpw').value,lg=id==='acCreate'?document.getElementById('aclogin').value.trim().toLowerCase():d.access;
    if(id==='acCreate'&&!Loans.validLogin(lg)){toast('Login: 3 do 30 znaków, małe litery bez polskich znaków, cyfry, kropka, myślnik lub podkreślenie.');return}
    if(pwv.length<8){toast('Hasło tymczasowe musi mieć co najmniej 8 znaków.');return}
    t.disabled=true;
    var fr=await fnCall({action:id==='acCreate'?'create':'reset',debtor_id:d.id,login:lg,password:pwv});
    t.disabled=false;
    if(!fr.ok){toast(fr.error);return}
    d.access=lg;S.cred={debtor_id:d.id,login:lg,password:pwv};render();
    toast(id==='acCreate'?'Dostęp utworzony.':'Hasło tymczasowe ustawione.');
  }
  else if(id==='acDel'&&d){
    if(!confirm('Usunąć dostęp dłużnika „'+d.name+'”? Jego lista i historia zostają, znika tylko możliwość logowania.'))return;
    var xr=await fnCall({action:'delete',debtor_id:d.id});
    if(!xr.ok){toast(xr.error);return}
    d.access='';S.cred=null;render();toast('Dostęp usunięty.');
  }
  else if(id==='acCopy'&&S.cred){
    var ctx='Dłużnik 2.0: '+location.origin+'\nLogin: '+S.cred.login+'\nHasło tymczasowe: '+S.cred.password+'\n(przy pierwszym logowaniu ustawisz własne hasło)';
    try{await navigator.clipboard.writeText(ctx);toast('Skopiowano dane logowania.')}catch(err){toast('Nie udało się skopiować. Zaznacz dane i skopiuj ręcznie.')}
  }
  else if(id==='setpw'||id==='chpw'){
    var p1=document.getElementById('pw1').value,p2=document.getElementById('pw2').value;
    if(p1.length<8){toast('Hasło musi mieć co najmniej 8 znaków.');return}
    if(p1!==p2){toast('Hasła nie są takie same.');return}
    var ru=await SB.auth.updateUser({password:p1,data:{must_change_password:false,role:(S.user.user_metadata||{}).role}});
    if(fail(ru))return;
    S.user=ru.data.user;S.pwOpen=false;await load();toast('Hasło zostało zmienione.');
  }
  else if(t.dataset.id){S.sel=t.dataset.id;S.editId=null;render()}
  else if(id==='addD'){
    var r=await SB.from('debtors').insert({name:'Dłużnik '+(S.debtors.length+1),rate:0}).select().single();
    if(fail(r))return; S.debtors.push({id:r.data.id,name:r.data.name,rate:0,remind_at:'',remind_note:'',entries:[]});S.sel=r.data.id;render();
    var n=document.getElementById('nm');if(n){n.focus();n.select()}
  }
  else if(id==='addE'&&d){
    var a=parseFloat(document.getElementById('am').value),dt=document.getElementById('dt').value||today(),nt=document.getElementById('nt').value.trim();
    if(!(a>0)){document.getElementById('am').focus();return}
    var row={debtor_id:d.id,type:document.getElementById('ty').value,date:dt,amount:Math.round(a*100)/100,note:nt||null};
    var r=await SB.from('entries').insert(row).select().single(); if(fail(r))return;
    d.entries.push({id:r.data.id,type:row.type,date:row.date,amount:row.amount,note:nt});render();
  }
  else if(id==='qLoan'||id==='qPay'){
    var qa=parseFloat(document.getElementById('qa').value.replace(/\s/g,'').replace(',','.')),qn=document.getElementById('qn').value.trim();
    if(!d||!(qa>0)){document.getElementById('qa').focus();toast('Wpisz kwotę większą od zera.');return}
    var qrow={debtor_id:d.id,type:id==='qLoan'?'loan':'pay',date:today(),amount:Math.round(qa*100)/100,note:qn||null};
    var qr=await SB.from('entries').insert(qrow).select().single();if(fail(qr))return;
    d.entries.push({id:qr.data.id,type:qrow.type,date:qrow.date,amount:qrow.amount,note:qn});render();
    toast('Dodano: '+(qrow.type==='loan'?'dług ':'spłata ')+fmt.format(qrow.amount));
    var q2=document.getElementById('qa');if(q2)q2.focus();
  }
  else if(id==='rSave'||id==='rClear'){
    var rv=id==='rClear'?'':document.getElementById('rd').value,rnv=id==='rClear'?'':document.getElementById('rn').value.trim();
    if(id==='rSave'&&!rv){toast('Wybierz termin przypomnienia.');return}
    var rr=await SB.from('debtors').update({remind_at:rv||null,remind_note:rnv||null}).eq('id',d.id);if(fail(rr))return;
    d.remind_at=rv;d.remind_note=rnv;render();toast(rv?'Przypomnienie zapisane.':'Przypomnienie usunięte.');
  }
  else if(id==='rIcs'){
    var iv=document.getElementById('rd').value;if(!iv){toast('Najpierw wybierz termin.');return}
    var tmp={id:d.id,name:d.name,remind_at:iv,remind_note:document.getElementById('rn').value.trim(),entries:d.entries,rate:d.rate};
    var url=URL.createObjectURL(new Blob([icsFor(tmp)],{type:'text/calendar'})),a=document.createElement('a');
    a.href=url;a.download='przypomnienie.ics';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},4000);
  }
  else if(t.dataset.rgo){S.sel=t.dataset.rgo;S.editId=null;render()}
  else if(t.dataset.rsnooze||t.dataset.rdone){
    var rid=t.dataset.rsnooze||t.dataset.rdone,rd=S.debtors.find(function(x){return x.id===rid});if(!rd)return;
    var nv=t.dataset.rsnooze?addDays(today(),7):'';
    var r3=await SB.from('debtors').update({remind_at:nv||null,remind_note:nv?(rd.remind_note||null):null}).eq('id',rid);if(fail(r3))return;
    rd.remind_at=nv;if(!nv)rd.remind_note='';render();
  }
  else if(t.dataset.edit){S.editId=t.dataset.edit;render()}
  else if(t.dataset.cancel){S.editId=null;render()}
  else if(t.dataset.save&&d){
    var ea=parseFloat(document.getElementById('ed-am').value),ety=document.getElementById('ed-ty').value,ent=document.getElementById('ed-nt').value.trim();
    var en=d.entries.find(function(x){return x.id===t.dataset.save});
    var edt=document.getElementById('ed-dt').value||(en&&en.date)||today();
    if(!(ea>0)){toast('Podaj kwotę większą od zera.');return}
    var chg={type:ety,date:edt,amount:Math.round(ea*100)/100,note:ent||null};
    var rs=await SB.from('entries').update(chg).eq('id',t.dataset.save);if(fail(rs))return;
    if(en)Object.assign(en,{type:chg.type,date:chg.date,amount:chg.amount,note:ent});
    S.editId=null;render();
  }
  else if(t.dataset.del&&d){var de=d.entries.find(function(x){return x.id===t.dataset.del});if(!confirm('Usunąć wpis: '+(de?(de.type==='loan'?'pożyczka ':'spłata ')+fmt.format(de.amount)+' z '+Loans.datePL(de.date):'')+'? Tej operacji nie można cofnąć.'))return;var r=await SB.from('entries').delete().eq('id',t.dataset.del);if(fail(r))return;d.entries=d.entries.filter(function(x){return x.id!==t.dataset.del});render()}
  else if(id==='delD'&&d){
    if(!confirm('Usunąć dłużnika „'+d.name+'” wraz z historią?'))return;
    var r=await SB.from('debtors').delete().eq('id',d.id);if(fail(r))return;
    S.debtors=S.debtors.filter(function(x){return x!==d});S.sel=S.debtors.length?S.debtors[0].id:null;render();
  }
  else if(id==='prev'&&d){
    var pr=parseNotes(document.getElementById('imptxt').value,document.getElementById('flip').checked,d.name,undefined,{headersAsDebtors:document.getElementById('hdr').checked,hourlyRate:parseFloat(document.getElementById('hrate').value)||0,defaultDate:document.getElementById('idate').value||undefined});
    var byNm={};S.debtors.forEach(function(z){byNm[z.name.toLowerCase()]=z});
    // wpisy, które już są na liście (ta sama data, rodzaj i kwota), oznaczamy i domyślnie pomijamy
    IMP=Loans.markDuplicates(pr.rows,function(who){var k=byNm[String(who).toLowerCase()];return k?k.entries:[]});
    IMPPR=pr;IMPMULTI=document.getElementById('hdr').checked;S.skipDup=true;renderImpPreview();
  }
  else if(id==='doImp'&&(impActive().length||document.querySelector('#impOut .sk-am'))){
    var ALL=impActive().concat(manualRows(d?d.name:'')),dupN=S.skipDup?IMP.filter(function(x){return x.dup}).length:0;
    if(!confirm('Zaimportować '+ALL.length+' wpisów?'+(dupN?' Pominięto '+dupN+', które już są na liście.':' Powtórny import tej samej notatki podwoi wpisy.')))return;
    t.disabled=true;t.textContent='Importuję…';
    var byName={};S.debtors.forEach(function(z){byName[z.name.toLowerCase()]=z});
    var rows=[];
    for(var i=0;i<ALL.length;i++){
      var x=ALL[i],k=byName[x.who.toLowerCase()];
      if(!k){var r=await SB.from('debtors').insert({name:x.who,rate:0}).select().single();if(fail(r))return;k={id:r.data.id,name:r.data.name,rate:0,entries:[]};S.debtors.push(k);byName[x.who.toLowerCase()]=k}
      rows.push({debtor_id:k.id,type:x.type,date:x.date,amount:x.amount,note:x.note||null});
    }
    var r2=await SB.from('entries').insert(rows);if(fail(r2)){t.disabled=false;t.textContent='Importuj '+ALL.length+' wpisów';return}
    IMP=[];await load();
  }
  else if(id==='pdfExp'&&d){
    printSettlement(d,{msg:document.getElementById('pdfmsg').value.trim(),due:document.getElementById('pdfdue').value,acct:document.getElementById('pdfacct').value.trim()});
  }
  else if(id==='dPdf'&&S.role==='debtor'){
    // dłużnik pobiera własne rozliczenie: ten sam dokument co u właściciela, bez wiadomości, terminu i numeru konta
    printSettlement({name:S.me.name,rate:0,entries:S.me.entries.map(function(e){return{id:e.id,type:e.type,date:e.date,amount:+e.amount,note:e.note||''}})},{msg:'',due:'',acct:''});
  }
  else if(id==='expOne'||id==='expAll'){
    var txt=exportText(id==='expAll');box=document.getElementById('expOut');
    if(!txt){box.innerHTML='<p class="empty" style="margin-top:12px">Brak danych do eksportu.</p>';return}
    var manual=function(){box.innerHTML='<p class="sub" style="margin-top:12px">Skopiuj tekst ręcznie i wklej go w Notatkach.</p><textarea readonly id="expTxt"></textarea>';var ta=document.getElementById('expTxt');ta.value=txt;ta.focus();ta.select()};
    var copy=function(){try{navigator.clipboard.writeText(txt).then(function(){box.innerHTML='<p class="sub" style="margin-top:12px">Skopiowano do schowka. Wklej w Notatkach.</p>'},manual)}catch(err){manual()}};
    if(navigator.share){navigator.share({title:'Pożyczki',text:txt}).catch(function(err){if(err&&err.name!=='AbortError')copy()})}else copy();
  }
});
document.addEventListener('change',async function(e){
  var d=cur(); if(!d)return;
  if(e.target.id==='nm'){var v=e.target.value.trim();if(!v)return;var r=await SB.from('debtors').update({name:v}).eq('id',d.id);if(fail(r))return;d.name=v;render()}
});
document.addEventListener('change',function(e){
  if(!e.target||e.target.id!=='impfile')return;
  var f=e.target.files&&e.target.files[0];if(!f)return;
  if(f.size>2000000){toast('Plik jest za duży (max 2 MB).');e.target.value='';return}
  var r=new FileReader();
  r.onload=function(){
    var t=String(r.result||'').replace(/^\uFEFF/,'');
    if(/^%PDF|^\{\\rtf/.test(t)){toast('Ten format nie jest obsługiwany. Zapisz notatkę jako zwykły tekst (.txt).');return}
    var ta=document.getElementById('imptxt');if(ta)ta.value=t;
    toast('Wczytano: '+f.name+'. Kliknij Podgląd.');
  };
  r.onerror=function(){toast('Nie udało się odczytać pliku.')};
  r.readAsText(f);e.target.value='';
});
document.addEventListener('input',function(e){
  var t=e.target,isAm=t.id==='qa'||t.id==='dq'||(t.classList&&t.classList.contains('sk-am'));
  if(isAm){var clean=Loans.numOnly(t.value);if(clean!==t.value)t.value=clean}  // pole kwoty: tylko liczby
  if(t.id==='mo')plan();else if(t.classList&&t.classList.contains('sk-am'))refreshImpBtn()
});
SB.auth.onAuthStateChange(function(ev,session){
  // Supabase wysyła SIGNED_IN także po każdym powrocie do karty i odświeżeniu tokenu. Przeładowanie widoku
  // kasowało wtedy wpisywaną kwotę, więc dla tego samego konta tylko zapamiętujemy sesję.
  var next=session?session.user:null,kind=Loans.authTransition(S.user,next);
  S.user=next;
  if(kind==='same')return;
  if(kind==='login'){S.role=null;S.me=null;S.cred=null;render();load()}
  else{S.debtors=[];S.sel=null;S.role=null;S.me=null;S.pending=[];S.cred=null;S.pwOpen=false;S.offline=0;S.pushState='unknown';snapClear();render()}
});
// Po powrocie sieci tryb offline odświeża się sam.
window.addEventListener('online',function(){if(S.user&&S.offline)load()});
// Odświeżanie danych po powrocie do aplikacji i co minutę (bez gubienia wpisywanego tekstu).
document.addEventListener('visibilitychange',function(){if(!document.hidden)softRefresh()});
window.addEventListener('focus',softRefresh);
setInterval(softRefresh,60000);
window.addEventListener('error',function(e){reportError(e.message,(e.filename||'')+':'+(e.lineno||''))});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;reportError(r&&r.message?r.message:r,'promise')});
document.addEventListener('change',function(e){if(e.target&&e.target.id==='skipdup'){S.skipDup=e.target.checked;renderImpPreview()}});
// Android/Chrome: własny przycisk instalacji zamiast ukrytej pozycji w menu przeglądarki.
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredInstall=e;showInstall()});
window.addEventListener('appinstalled',function(){deferredInstall=null;var c=document.getElementById('instCard');if(c)c.remove()});
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}
render();
