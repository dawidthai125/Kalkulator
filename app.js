var SB=supabase.createClient('https://ukpfrkjikqffojzpdywk.supabase.co','sb_publishable_9coMWsPQsvFtIwNRVEXPiQ_VVyFT8r_');
var S={debtors:[],sel:null,user:null,editId:null},IMP=[];
var fmt=new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'});
var today=Loans.today,esc=Loans.esc,calc=Loans.calc,parseNotes=Loans.parseNotes;
function cur(){return S.debtors.find(function(d){return d.id===S.sel})}
function toast(m){document.querySelectorAll('.msg').forEach(function(x){x.textContent=m||''})}
function fail(r){if(r&&r.error){toast('Błąd: '+r.error.message);return true}return false}

async function load(){
  var a=await SB.from('debtors').select('*').order('created_at'),b=await SB.from('entries').select('*');
  if(fail(a)||fail(b))return;
  S.debtors=a.data.map(function(d){return{id:d.id,name:d.name,rate:+d.rate,remind_at:d.remind_at||'',remind_note:d.remind_note||'',entries:b.data.filter(function(e){return e.debtor_id===d.id}).map(function(e){return{id:e.id,type:e.type,date:e.date,amount:+e.amount,note:e.note||''}})}});
  if(!cur())S.sel=S.debtors.length?S.debtors[0].id:null;
  render();
}

function render(){
  var t=document.getElementById('tabs'),p=document.getElementById('panel'),bar=document.getElementById('bar');
  if(!S.user){
    bar.innerHTML='';t.innerHTML='';
    p.innerHTML='<div class="card"><h2>Zaloguj się</h2><div class="row"><label>E-mail<input id="em" type="email" autocomplete="email"></label><label>Hasło (min. 6 znaków)<input id="pw" type="password" autocomplete="current-password"></label></div>'+
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
  bar.innerHTML='<span class="sub" style="margin:0">'+esc(S.user.email)+'</span><button class="btn ghost" id="logout" style="color:var(--mute)">Wyloguj</button>';
  t.innerHTML=S.debtors.map(function(d){return '<button class="tab" role="tab" aria-selected="'+(d.id===S.sel)+'" data-id="'+d.id+'">'+esc(d.name||'Bez nazwy')+'</button>'}).join('')+'<button class="tab" id="addD">+ Dłużnik</button>';
  var d=cur();
  if(!d){p.innerHTML='<div class="card"><p class="empty">Dodaj pierwszego dłużnika, aby zacząć liczyć.</p><p class="msg" id="msg"></p></div>';return}
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
  p.innerHTML=dueHtml()+
  '<div class="card"><div class="row"><label>Imię lub nazwa<input id="nm" value="'+esc(d.name)+'"></label>'+
  '<label>Oprocentowanie roczne (%)<input id="rt" type="number" min="0" step="0.1" inputmode="decimal" value="'+(d.rate||0)+'"></label></div><p class="msg" id="msg"></p></div>'+
  '<div class="card"><p class="sub">'+(c.owed<0?'Nadpłata':'Do spłaty dziś')+'</p><p class="total '+(c.owed>0?'neg':'pos')+'">'+fmt.format(Math.abs(c.owed))+'</p><p class="sub"></p>'+
  '<div class="grid"><div>Kapitał do spłaty<b class="'+(c.cap>0?'neg':'')+'">'+fmt.format(c.cap)+'</b></div><div>Naliczone odsetki<b class="'+(c.int>0?'neg':'')+'">'+fmt.format(c.int)+'</b></div>'+
  '<div>Łącznie pożyczono<b class="neg">'+fmt.format(c.lent)+'</b></div><div>Łącznie spłacono<b class="pos">'+fmt.format(c.paid)+'</b></div></div></div>'+
  '<div class="card"><h2>Szybkie dopisanie kwoty (dziś)</h2><div class="row"><label>Kwota (zł)<input id="qa" type="text" inputmode="decimal" placeholder="np. 250" autocomplete="off"></label><label>Opis (opcjonalnie)<input id="qn" maxlength="200" autocomplete="off"></label></div>'+
  '<div class="row" style="margin-top:10px"><button class="btn" id="qLoan" style="background:var(--debt);color:#fff">+ Dług</button><button class="btn" id="qPay" style="background:var(--paid);color:#fff">− Spłata</button></div></div>'+
  '<div class="card"><h2>Dodaj wpis</h2><div class="row"><label>Rodzaj<select id="ty"><option value="loan">Pożyczka</option><option value="pay">Spłata</option></select></label>'+
  '<label>Data (opcjonalnie)<input id="dt" type="date" value="'+today()+'"></label><label>Kwota (zł)<input id="am" type="number" min="0" step="0.01" inputmode="decimal"></label>'+
  '<label class="wide">Opis (opcjonalnie)<input id="nt" maxlength="200" placeholder="np. przelew za październik" autocomplete="off"></label></div>'+
  '<div class="foot"><button class="btn" id="addE">Dodaj wpis</button></div></div>'+
  '<div class="card"><h2>Historia</h2>'+(rows?'<div class="tablewrap"><table><thead><tr><th>Data</th><th>Rodzaj</th><th class="n">Kwota</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="empty">Brak wpisów. Dodaj pierwszą pożyczkę.</p>')+'<p class="msg"></p></div>'+
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
  '<div class="card"><h2>Eksport do Notatek (iPhone)</h2><p class="sub">Otworzy się menu udostępniania. Wybierz w nim Notatki. Format jest taki sam jak w imporcie.</p>'+
  '<div class="row"><button class="btn" id="expOne">Ten dłużnik</button><button class="btn" id="expAll">Wszyscy dłużnicy</button></div><div id="expOut"></div></div>'+
  '<div class="foot"><button class="btn ghost" id="delD">Usuń dłużnika</button></div>';
  plan();
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
  b.textContent='Importuj '+(IMP.length+manualRows('').length)+' wpisów';
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
    if(!em||pw.length<6){toast('Podaj e-mail i hasło (min. 6 znaków).');return}
    var r=await SB.auth.signInWithPassword({email:em,password:pw});
    if(fail(r))return;
  }
  else if(id==='logout'){await SB.auth.signOut()}
  else if(id==='setpw'){
    var p1=document.getElementById('pw1').value,p2=document.getElementById('pw2').value;
    if(p1.length<8){toast('Hasło musi mieć co najmniej 8 znaków.');return}
    if(p1!==p2){toast('Hasła nie są takie same.');return}
    var ru=await SB.auth.updateUser({password:p1,data:{must_change_password:false}});
    if(fail(ru))return;
    S.user=ru.data.user;await load();
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
  else if(t.dataset.del&&d){var r=await SB.from('entries').delete().eq('id',t.dataset.del);if(fail(r))return;d.entries=d.entries.filter(function(x){return x.id!==t.dataset.del});render()}
  else if(id==='delD'&&d){
    if(!confirm('Usunąć dłużnika „'+d.name+'” wraz z historią?'))return;
    var r=await SB.from('debtors').delete().eq('id',d.id);if(fail(r))return;
    S.debtors=S.debtors.filter(function(x){return x!==d});S.sel=S.debtors.length?S.debtors[0].id:null;render();
  }
  else if(id==='prev'&&d){
    box=document.getElementById('impOut');
    var pr=parseNotes(document.getElementById('imptxt').value,document.getElementById('flip').checked,d.name,undefined,{headersAsDebtors:document.getElementById('hdr').checked,hourlyRate:parseFloat(document.getElementById('hrate').value)||0,defaultDate:document.getElementById('idate').value||undefined});IMP=pr.rows;
    if(!IMP.length){box.innerHTML='<p class="empty" style="margin-top:12px">Nie znaleziono kwot. Użyj formatu „1500 zł klej” albo „01.10.2026 +500”.</p>'+skipHtml(pr.skip);return}
    var multi=document.getElementById('hdr').checked;
    var nl=IMP.filter(function(x){return x.type==='loan'}),np=IMP.filter(function(x){return x.type==='pay'});
    var sl=sumAmounts(nl),sp=sumAmounts(np);
    box.innerHTML='<div class="grid" style="margin-top:12px"><div>Długi (pożyczki), '+nl.length+' wpisów<b class="neg">'+fmt.format(sl)+'</b></div><div>Spłaty, '+np.length+' wpisów<b class="pos">'+fmt.format(sp)+'</b></div></div>'+
      (pr.hours&&pr.hours.lines?'<p class="sub" style="margin-top:8px">Godziny przeliczone na kwoty: '+pr.hours.lines+' linii po '+pr.hours.rate+' zł/h.</p>':'')+
      '<p class="sub" style="margin-top:8px">Saldo po imporcie (bez odsetek): <strong class="'+(sl-sp>0?'neg':'pos')+'">'+fmt.format(sl-sp)+'</strong></p>'+
      '<div class="tablewrap"><table><thead><tr>'+(multi?'<th>Dłużnik</th>':'')+'<th>Data</th><th>Rodzaj i opis</th><th class="n">Kwota</th></tr></thead><tbody>'+
      IMP.map(function(x){return '<tr>'+(multi?'<td>'+esc(x.who)+'</td>':'')+'<td>'+x.date+'</td><td class="'+x.type+'">'+(x.type==='loan'?'Pożyczka':'Spłata')+(x.note?'<span class="note">'+esc(x.note)+'</span>':'')+'</td><td class="n '+x.type+'">'+fmt.format(x.amount)+'</td></tr>'}).join('')+'</tbody></table></div>'+
      skipHtml(pr.skip)+
      '<div class="foot"><button class="btn" id="doImp">Importuj '+IMP.length+' wpisów</button></div>';
  }
  else if(id==='doImp'&&(IMP.length||document.querySelector('#impOut .sk-am'))){
    var ALL=IMP.concat(manualRows(d?d.name:''));
    if(!confirm('Zaimportować '+ALL.length+' wpisów? Powtórny import tej samej notatki podwoi wpisy.'))return;
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
  else if(e.target.id==='rt'){var v2=Math.max(0,parseFloat(e.target.value)||0);var r=await SB.from('debtors').update({rate:v2}).eq('id',d.id);if(fail(r))return;d.rate=v2;render()}
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
document.addEventListener('input',function(e){if(e.target.id==='mo')plan();else if(e.target.classList&&e.target.classList.contains('sk-am'))refreshImpBtn()});
SB.auth.onAuthStateChange(function(ev,session){
  S.user=session?session.user:null;
  if(S.user)load();else{S.debtors=[];S.sel=null;render()}
});
render();
