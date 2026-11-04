// Painel (HTML + JS) servido em GET /api/admin.
// Conversa com os endpoints do proprio backend. Protegido pelo token (IMPORT_TOKEN).
export const ADMIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FK E-mail · Adoratta</title>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root { --green:#354734; --cream:#fdf2ed; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Open Sans',Arial,sans-serif; background:#f3f4f6; color:#222; }
  header { background:var(--green); color:#fff; padding:16px 20px; font-weight:700; font-size:18px; display:flex; justify-content:space-between; align-items:center; }
  header .sair { font-size:12px; font-weight:600; color:#cbd5c5; cursor:pointer; text-decoration:underline; }
  .wrap { max-width:900px; margin:0 auto; padding:20px 16px 60px; }
  .card { background:#fff; border-radius:14px; box-shadow:0 1px 4px rgba(0,0,0,.08); padding:20px; margin-bottom:18px; }
  .card h2 { margin:0 0 14px; font-size:16px; color:var(--green); }
  .stats { display:flex; gap:12px; flex-wrap:wrap; }
  .stat { flex:1; min-width:120px; background:var(--cream); border-radius:12px; padding:14px; text-align:center; }
  .stat b { display:block; font-size:26px; color:var(--green); }
  .stat span { font-size:12px; color:#777; }
  label { display:block; font-size:13px; font-weight:600; margin:10px 0 4px; }
  input, textarea { width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-family:inherit; font-size:14px; }
  textarea { min-height:60px; resize:vertical; }
  button { background:var(--green); color:#fff; border:none; border-radius:8px; padding:10px 18px; font-weight:700; font-size:14px; cursor:pointer; font-family:inherit; }
  button.sec { background:#fff; color:var(--green); border:1px solid var(--green); }
  button:disabled { opacity:.5; cursor:default; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .camp { border:1px solid #eee; border-radius:12px; padding:14px; margin-bottom:12px; }
  .camp .top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; }
  .camp .sub { font-weight:700; font-size:15px; }
  .camp .meta { font-size:12px; color:#888; margin-top:2px; }
  .badge { font-size:11px; font-weight:700; padding:3px 8px; border-radius:20px; background:#e8efe6; color:var(--green); }
  .rep { margin-top:12px; display:none; }
  .rep.open { display:block; }
  .metrics { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
  .metric { flex:1; min-width:90px; background:#f7f7f7; border-radius:10px; padding:10px; text-align:center; }
  .metric b { display:block; font-size:20px; color:#222; }
  .metric span { font-size:11px; color:#888; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #eee; }
  .msg { font-size:13px; margin-top:8px; }
  .msg.ok { color:#1a7f37; }
  .msg.err { color:#b42318; }
  .gate { max-width:360px; margin:80px auto; }
  .hint { font-size:12px; color:#999; margin-top:6px; }
  .hidden { display:none; }
</style>
</head>
<body>

<div id="gate" class="wrap gate hidden">
  <div class="card">
    <h2>Entrar</h2>
    <label>Senha (token)</label>
    <input id="tok" type="password" placeholder="seu token" />
    <div class="row" style="margin-top:12px"><button onclick="login()">Entrar</button></div>
    <div id="gateMsg" class="msg"></div>
  </div>
</div>

<div id="app" class="hidden">
  <header>
    <span>FK E-mail · Adoratta</span>
    <span class="sair" onclick="logout()">sair</span>
  </header>
  <div class="wrap">

    <div class="card">
      <h2>Contatos</h2>
      <div class="stats" id="stats"><div class="stat"><b>…</b><span>carregando</span></div></div>
    </div>

    <div class="card">
      <h2>Nova campanha</h2>
      <label>Assunto</label>
      <input id="subject" value="Novidades que você vai amar 🩷" />
      <label>Texto de abertura</label>
      <textarea id="intro">Separamos uns queridinhos que a gente sabe que você vai amar 🩷</textarea>
      <div class="hint">Vai com 4 novidades + 4 mais vendidos (os produtos são buscados na hora de criar).</div>
      <div class="row" style="margin-top:12px"><button id="btnCreate" onclick="createCampaign()">Criar campanha</button></div>
      <div id="createMsg" class="msg"></div>
    </div>

    <div class="card">
      <h2>Campanhas</h2>
      <div id="camps">carregando…</div>
    </div>

  </div>
</div>

<script>
const BASE = location.origin;
function token(){ return localStorage.getItem('fk_token') || ''; }
function setToken(t){ localStorage.setItem('fk_token', t); }
function logout(){ localStorage.removeItem('fk_token'); show(); }

async function api(path, opts){
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(BASE + path + sep + 'token=' + encodeURIComponent(token()), opts || {});
  const j = await res.json().catch(()=>({}));
  if(res.status === 401) throw new Error('401');
  return j;
}
function brl(v){ return 'R$ ' + Number(v||0).toFixed(2).replace('.',','); }
function esc(s){ return String(s==null?'':s).replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

function show(){
  if(!token()){ document.getElementById('gate').classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); }
  else { document.getElementById('gate').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); loadAll(); }
}
async function login(){
  setToken(document.getElementById('tok').value.trim());
  try { await api('/api/stats'); show(); }
  catch(e){ document.getElementById('gateMsg').className='msg err'; document.getElementById('gateMsg').textContent='Token inválido.'; logout_keepGate(); }
}
function logout_keepGate(){ localStorage.removeItem('fk_token'); }

async function loadAll(){ loadStats(); loadCamps(); }

async function loadStats(){
  try{
    const s = await api('/api/stats');
    document.getElementById('stats').innerHTML =
      stat(s.total,'total') + stat(s.subscribed,'inscritos') + stat(s.unsubscribed,'descadastrados') + stat(s.suppressed,'suprimidos');
  }catch(e){ if(String(e.message)==='401') show(); }
}
function stat(n,l){ return '<div class="stat"><b>'+(n??0)+'</b><span>'+l+'</span></div>'; }

async function createCampaign(){
  const btn = document.getElementById('btnCreate'); btn.disabled = true;
  const msg = document.getElementById('createMsg'); msg.className='msg'; msg.textContent='Criando…';
  try{
    const r = await api('/api/campaigns', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ subject: document.getElementById('subject').value, intro: document.getElementById('intro').value })
    });
    if(r.ok){ msg.className='msg ok'; msg.textContent='Campanha criada com '+r.productsUsed+' produtos!'; loadCamps(); }
    else { msg.className='msg err'; msg.textContent='Erro: '+(r.error||'')+' '+(r.detail||''); }
  }catch(e){ msg.className='msg err'; msg.textContent='Falhou.'; }
  btn.disabled = false;
}

async function loadCamps(){
  const box = document.getElementById('camps');
  try{
    const list = await api('/api/campaigns');
    const arr = list.campaigns || [];
    if(!arr.length){ box.innerHTML = '<div class="hint">Nenhuma campanha ainda.</div>'; return; }
    box.innerHTML = arr.map(renderCamp).join('');
  }catch(e){ box.innerHTML = '<div class="msg err">Erro ao carregar.</div>'; }
}

function renderCamp(c){
  const data = c.sent_at ? ('enviada em ' + new Date(c.sent_at).toLocaleString('pt-BR')) : ('criada em ' + new Date(c.created_at).toLocaleString('pt-BR'));
  return '<div class="camp" id="camp-'+c.id+'">'
    + '<div class="top"><div><div class="sub">'+esc(c.subject)+'</div><div class="meta">'+data+'</div></div>'
    + '<span class="badge">'+esc(c.status||'')+'</span></div>'
    + '<div class="row" style="margin-top:10px">'
    + 'Enviar lote de <input type="number" id="lim-'+c.id+'" value="150" style="width:90px"/> '
    + '<button onclick="sendBatch(\\''+c.id+'\\')">Disparar</button>'
    + '<button class="sec" onclick="report(\\''+c.id+'\\')">Ver relatório</button>'
    + '<span class="msg" id="smsg-'+c.id+'"></span></div>'
    + '<div class="rep" id="rep-'+c.id+'"></div>'
    + '</div>';
}

async function sendBatch(id){
  const lim = document.getElementById('lim-'+id).value || 150;
  const m = document.getElementById('smsg-'+id); m.className='msg'; m.textContent='Enviando…';
  try{
    const r = await api('/api/campaigns/'+id+'/send-batch?limit='+lim, { method:'POST' });
    if(r.ok){ m.className='msg ok'; m.textContent='Enviados '+r.sentThisRun+' (falhas '+r.failed+'). Faltam '+r.remaining+'.'; }
    else { m.className='msg err'; m.textContent='Erro: '+(r.error||''); }
  }catch(e){ m.className='msg err'; m.textContent='Falhou.'; }
}

async function report(id){
  const box = document.getElementById('rep-'+id);
  box.classList.add('open'); box.innerHTML = 'carregando relatório…';
  try{
    const r = await api('/api/campaigns/'+id+'/report');
    if(!r.ok){ box.innerHTML = '<div class="msg err">Erro: '+(r.error||'')+'</div>'; return; }
    let html = '<div class="metrics">'
      + met(r.recipients,'enviados') + met(r.opens,'aberturas ('+r.openRate+'%)')
      + met(r.clicks,'cliques ('+r.clickRate+'%)') + met(r.buyers,'compraram')
      + met(brl(r.revenue),'faturamento') + '</div>';
    if(r.topBuyers && r.topBuyers.length){
      html += '<table><tr><th>Quem comprou</th><th>Total</th></tr>'
        + r.topBuyers.map(b=>'<tr><td>'+esc(b.email)+'</td><td>'+brl(b.total)+'</td></tr>').join('') + '</table>';
    } else {
      html += '<div class="hint">Ainda sem compras registradas desta campanha.</div>';
    }
    box.innerHTML = html;
  }catch(e){ box.innerHTML = '<div class="msg err">Falhou.</div>'; }
}
function met(v,l){ return '<div class="metric"><b>'+v+'</b><span>'+l+'</span></div>'; }

show();
</script>
</body>
</html>`;
