/* ============================================================
   KHATA — personal cashflow ledger
   Single source of truth: state.transactions[]
   Everything else below is a computed view over it.
   ============================================================ */

const STORAGE_KEY = 'khata_v1';

const ACCOUNTS = [
  { id:'city',   name:'City Bank' },
  { id:'bkash',  name:'Bkash' },
  { id:'midland',name:'Midland' },
  { id:'home',   name:'Home Safe' },
  { id:'wallet', name:'Wallet' },
  { id:'pf',     name:'Provident Fund' },
];

const CATEGORY_TAXONOMY = {
  Income:  ['Salary','Allowance','Annual_Encashment','Payback','Return','Bonus','Salami','Cashback','Mismatch'],
  Expense: ['Food','Transport','Beverage','Fee','Grocery','Bill','Fund','Donation','Tax','Allowance','Mismatch','Service','Medical','Gift','Salami','Rent','Accessory','Furniture','Electric','Treat','Tips','Fare','Apparel','Advance','Game','Day_out','Salary','Appliances','Supershop','Qurbani','Sports'],
  Loan:    ['Loan_Taken','Loan_Given','Debt_Paid','Received'],
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_SETTINGS = {
  initialBalances: { city:0, bkash:0, midland:0, home:0, wallet:0, pf:0 },
  idealSaveRate: 15000,
  annualTarget: 180000,
  flexibleAnnualTarget: 140000,
  homeSupport: 5000,
  investmentAllowance: 2000,
  officeCost: 3000,
  expectedMonthlyIncome: 0,
  zakatRate: 2.5,
  zakatGoldKarat: '21',
  goldRates: { '22':0, '21':0, '18':0, shonatoni:0 },
  customCategories: { Income:[], Expense:[] },
  currency: '৳',
};

/* ---------------- state / persistence ---------------- */
let state = load();

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      parsed.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      parsed.settings.initialBalances = Object.assign({}, DEFAULT_SETTINGS.initialBalances, parsed.settings.initialBalances || {});
      parsed.settings.goldRates = Object.assign({}, DEFAULT_SETTINGS.goldRates, parsed.settings.goldRates || {});
      parsed.settings.customCategories = Object.assign({Income:[],Expense:[]}, parsed.settings.customCategories || {});
      parsed.transactions = parsed.transactions || [];
      parsed.loanNotes = parsed.loanNotes || [];
      return parsed;
    }
  }catch(e){ console.error('load failed', e); }
  return { transactions:[], settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), loanNotes:[] };
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------- utils ---------------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function monthKeyOf(dateStr){ return dateStr.slice(0,7); }
function fmt(n){
  const r = Math.round(n||0);
  return state.settings.currency + r.toLocaleString('en-US');
}
function fmtSigned(n){
  const r = Math.round(n||0);
  return (r>0?'+':'') + state.settings.currency + r.toLocaleString('en-US');
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove('show'), 1800);
}
function accountName(id){ const a=ACCOUNTS.find(x=>x.id===id); return a?a.name:id; }
function esc(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function categoriesFor(type){
  if(type==='Income') return [...CATEGORY_TAXONOMY.Income, ...state.settings.customCategories.Income];
  if(type==='Expense') return [...CATEGORY_TAXONOMY.Expense, ...state.settings.customCategories.Expense];
  if(type==='Loan') return CATEGORY_TAXONOMY.Loan;
  return [];
}

/* ---------------- core derived math ---------------- */
function txnTotal(t){ return Object.values(t.amounts).reduce((a,b)=>a+(b||0),0); }

function accountBalance(accId){
  let bal = state.settings.initialBalances[accId] || 0;
  for(const t of state.transactions) bal += (t.amounts[accId]||0);
  return bal;
}
function allAccountBalances(){ return ACCOUNTS.map(a=>({...a, balance:accountBalance(a.id)})); }

function debtBalance(){
  let taken=0, paid=0;
  state.transactions.filter(t=>t.type==='Loan').forEach(t=>{
    const amt = Math.abs(txnTotal(t));
    if(t.category==='Loan_Taken') taken+=amt;
    if(t.category==='Debt_Paid') paid+=amt;
  });
  return taken - paid;
}
function receivableBalance(){
  let given=0, received=0;
  state.transactions.filter(t=>t.type==='Loan').forEach(t=>{
    const amt = Math.abs(txnTotal(t));
    if(t.category==='Loan_Given') given+=amt;
    if(t.category==='Received') received+=amt;
  });
  return given - received;
}
function netWorth(){
  const accTotal = ACCOUNTS.reduce((s,a)=>s+accountBalance(a.id),0);
  return accTotal + receivableBalance() - debtBalance();
}

function monthlySummary(year){
  const months = [];
  for(let m=1;m<=12;m++){
    const key = `${year}-${String(m).padStart(2,'0')}`;
    const txns = state.transactions.filter(t=>t.date.startsWith(key));
    const income = txns.filter(t=>t.type==='Income').reduce((s,t)=>s+txnTotal(t),0);
    const expense = txns.filter(t=>t.type==='Expense').reduce((s,t)=>s+Math.abs(txnTotal(t)),0);
    const salaryIncome = txns.filter(t=>t.type==='Income'&&t.category==='Salary').reduce((s,t)=>s+txnTotal(t),0);
    const pl = income - expense;
    const savingsRate = income>0 ? (pl/income*100) : 0;
    const salaryPL = salaryIncome - expense;
    const salarySavingsRate = salaryIncome>0 ? (salaryPL/salaryIncome*100) : 0;
    months.push({ m, key, name:MONTH_NAMES[m-1], income, expense, pl, savingsRate, salaryPL, salarySavingsRate, hasData:txns.length>0 });
  }
  const initialTotal = ACCOUNTS.reduce((s,a)=>s+(state.settings.initialBalances[a.id]||0),0);
  let running = initialTotal;
  months.forEach(mo=>{
    const net = state.transactions.filter(t=>t.date.startsWith(mo.key)).reduce((s,t)=>s+txnTotal(t),0);
    running += net;
    mo.runningBalance = running;
  });
  return months;
}

function savingsGoalData(){
  const year = new Date().getFullYear();
  const months = monthlySummary(year);
  const monthsElapsed = new Date().getMonth()+1;
  const savingsToDate = months.slice(0,monthsElapsed).reduce((s,mo)=>s+mo.pl,0);
  const monthsRemaining = Math.max(12-monthsElapsed,0);
  const avgSoFar = monthsElapsed>0 ? savingsToDate/monthsElapsed : 0;
  const extrapolatedYearEnd = avgSoFar*12;
  const s = state.settings;
  const strategies = {
    ideal:    { label:'Ideal Save Rate',        tag:'Flat monthly target you set',            monthly: s.idealSaveRate, annual: s.idealSaveRate*12 },
    current:  { label:'Current Save Rate',      tag:'Your actual average so far this year',   monthly: avgSoFar, annual: extrapolatedYearEnd },
    strict:   { label:'Revised Target (Strict)',tag:'Catch up fully to the annual target',    monthly: monthsRemaining>0 ? (s.annualTarget-savingsToDate)/monthsRemaining : 0, annual: s.annualTarget },
    flexible: { label:'Revised Target (Flexible)', tag:'Catch up to a relaxed annual target',  monthly: monthsRemaining>0 ? (s.flexibleAnnualTarget-savingsToDate)/monthsRemaining : 0, annual: s.flexibleAnnualTarget },
  };
  const active = s.activeGoalStrategy || 'ideal';
  return { monthsElapsed, monthsRemaining, savingsToDate, avgSoFar, extrapolatedYearEnd, strategies, active };
}

function dailyBudgetData(){
  const today = new Date();
  const y=today.getFullYear(), m=today.getMonth()+1;
  const daysInMonth = new Date(y,m,0).getDate();
  const dayOfMonth = today.getDate();
  const mk = `${y}-${String(m).padStart(2,'0')}`;
  const monthTxns = state.transactions.filter(t=>t.date.startsWith(mk));
  const incomeSoFar = monthTxns.filter(t=>t.type==='Income').reduce((s,t)=>s+txnTotal(t),0);
  const s = state.settings;
  let incomeEstimate = s.expectedMonthlyIncome;
  if(!incomeEstimate){
    if(incomeSoFar>0) incomeEstimate = incomeSoFar;
    else{
      const yearMonths = monthlySummary(y).filter(mo=>mo.hasData && mo.m<m);
      incomeEstimate = yearMonths.length ? yearMonths.reduce((s2,mo)=>s2+mo.income,0)/yearMonths.length : 0;
    }
  }
  const dailyBudget = Math.max(incomeEstimate - s.idealSaveRate - s.homeSupport - s.investmentAllowance - s.officeCost, 0) / daysInMonth;
  const spentToday = monthTxns.filter(t=>t.type==='Expense' && t.date===todayISO()).reduce((s2,t)=>s2+Math.abs(txnTotal(t)),0);
  const spentMonthToDate = monthTxns.filter(t=>t.type==='Expense').reduce((s2,t)=>s2+Math.abs(txnTotal(t)),0);
  const allowedToDate = dailyBudget*dayOfMonth;
  const diff = allowedToDate - spentMonthToDate;
  const ratio = dailyBudget>0 ? diff/dailyBudget : 0;
  let status;
  if(ratio>=1) status={emoji:'🤟',msg:'On budget'};
  else if(ratio>=0) status={emoji:'🙂',msg:'On budget'};
  else if(ratio>=-1) status={emoji:'😐',msg:'A little over'};
  else if(ratio>=-2) status={emoji:'😥',msg:'Crossed budget'};
  else status={emoji:'💀',msg:'No hope'};
  const remainingToday = dailyBudget - spentToday;
  return { dailyBudget, spentToday, remainingToday, spentMonthToDate, allowedToDate, diff, ratio, status, daysInMonth, dayOfMonth, incomeEstimate };
}

function categoryMatrix(year, type){
  const months = monthlySummary(year).filter(m=>m.hasData || true).map(m=>m.key);
  const data = {};
  state.transactions.filter(t=>t.type===type && t.date.startsWith(String(year))).forEach(t=>{
    data[t.category] = data[t.category] || {};
    const mk = monthKeyOf(t.date);
    data[t.category][mk] = (data[t.category][mk]||0) + Math.abs(txnTotal(t));
  });
  const catTotal = c => Object.values(data[c]||{}).reduce((a,b)=>a+b,0);
  const categories = Object.keys(data).sort((a,b)=>catTotal(b)-catTotal(a));
  return { months, categories, data, catTotal };
}

function loanBalances(){
  const people = {};
  state.transactions.filter(t=>t.type==='Loan').forEach(t=>{
    const person = t.subcategory || 'Unknown';
    people[person] = people[person] || {given:0, received:0, taken:0, paid:0};
    const amt = Math.abs(txnTotal(t));
    if(t.category==='Loan_Given') people[person].given+=amt;
    if(t.category==='Received') people[person].received+=amt;
    if(t.category==='Loan_Taken') people[person].taken+=amt;
    if(t.category==='Debt_Paid') people[person].paid+=amt;
  });
  return Object.entries(people).map(([person,d])=>({
    person, ...d, owedToMe: d.given-d.received, iOwe: d.taken-d.paid
  })).filter(p=>p.owedToMe!==0 || p.iOwe!==0 || p.given||p.taken);
}

function zakatData(){
  const s = state.settings;
  const rate = Number(s.goldRates[s.zakatGoldKarat])||0;
  const nisabVori = 7.5;
  const nisab = rate*nisabVori;
  const wealth = netWorth();
  const eligible = nisab>0 && wealth>=nisab;
  return {
    rate, nisab, wealth, eligible,
    due25: eligible ? wealth*0.025 : 0,
    due3:  eligible ? wealth*0.03  : 0,
  };
}

/* ============================================================
   ROUTER + RENDER
   ============================================================ */
let ui = { tab:'home', insightsSub:'monthly', moreSub:'loans', ledgerFilterType:'all', ledgerFilterMonth:'all' };

const view = document.getElementById('view');
const pageTitle = document.getElementById('pageTitle');
const pageEyebrow = document.getElementById('pageEyebrow');

function setTab(tab){
  ui.tab = tab;
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  render();
}

function render(){
  const titles = { home:['HalKhata','Home'], ledger:['Ledger','All transactions'], add:['New Entry','Add transaction'], insights:['Insights','Where it goes'], more:['More','Loans · Zakat · Settings'] };
  pageEyebrow.textContent = titles[ui.tab][0];
  pageTitle.textContent = titles[ui.tab][1];
  if(ui.tab==='home') renderHome();
  else if(ui.tab==='ledger') renderLedger();
  else if(ui.tab==='add') renderAdd();
  else if(ui.tab==='insights') renderInsights();
  else if(ui.tab==='more') renderMore();
  window.scrollTo(0,0);
}

/* ---------------- HOME ---------------- */
function renderHome(){
  const nw = netWorth();
  const accs = allAccountBalances();
  const budget = dailyBudgetData();
  const debt = debtBalance();
  const recent = [...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,5);

  view.innerHTML = `
    <div class="hero">
      <div class="hero-label">Net Worth</div>
      <div class="hero-amount">${fmt(nw)}</div>
      <div class="hero-sub">${debt>0 ? `Owing <b>${fmt(debt)}</b> to people` : 'No informal debt outstanding'}</div>
    </div>

    <div class="card" data-goto="insights" data-sub="budget">
      <div class="card-title">Today's Budget</div>
      <div class="row-between">
        <div>
          <div style="font-family:var(--font-mono); font-size:22px;">${budget.status.emoji} ${fmt(Math.max(budget.remainingToday,0))}</div>
          <div class="muted small">${budget.status.msg} · left to spend today</div>
        </div>
        <div class="muted small" style="text-align:right;">Daily budget<br><b style="color:var(--paper)">${fmt(budget.dailyBudget)}</b></div>
      </div>
    </div>

    <div class="section-head"><h2>Accounts</h2><span class="link" data-goto="more" data-sub="settings">Edit</span></div>
    <div class="acct-grid">
      ${accs.map(a=>`
        <div class="acct-item">
          <div class="acct-name">${a.name}</div>
          <div class="acct-bal ${a.balance<0?'neg':''}">${fmt(a.balance)}</div>
        </div>`).join('')}
    </div>

    <div class="section-head"><h2>Recent activity</h2><span class="link" data-goto="ledger">See all</span></div>
    <div class="card">
      ${recent.length? recent.map(t=>txnRow(t)).join('') : `<div class="empty" style="padding:10px 0;"><p>No transactions logged yet — tap + to add your first one.</p></div>`}
    </div>
  `;
}

function txnRow(t){
  const total = txnTotal(t);
  const cls = total>=0 ? 'pos':'neg';
  return `
    <div class="txn" data-open-txn="${t.id}">
      <div class="txn-left">
        <span class="txn-cat">${esc(t.category.replace(/_/g,' '))}</span>
        <span class="txn-sub">${esc(t.subcategory||'')}${t.subcategory&&t.context?' · ':''}${esc(t.context||'')}</span>
      </div>
      <div style="text-align:right;">
        <div class="txn-amt ${cls}">${fmtSigned(total)}</div>
        <div class="txn-sub">${t.date}</div>
      </div>
    </div>`;
}

/* ---------------- LEDGER ---------------- */
function renderLedger(){
  const types = ['all','Income','Expense','Loan','Transfer'];
  let txns = [...state.transactions];
  if(ui.ledgerFilterType!=='all') txns = txns.filter(t=>t.type===ui.ledgerFilterType);
  if(ui.ledgerFilterMonth!=='all') txns = txns.filter(t=>monthKeyOf(t.date)===ui.ledgerFilterMonth);
  txns.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));

  const monthOptions = [...new Set(state.transactions.map(t=>monthKeyOf(t.date)))].sort().reverse();

  let grouped = {};
  txns.forEach(t=>{ grouped[t.date]=grouped[t.date]||[]; grouped[t.date].push(t); });

  view.innerHTML = `
    <div class="chipbar">
      ${types.map(ty=>`<button class="chip ${ui.ledgerFilterType===ty?'active':''}" data-ledger-type="${ty}">${ty==='all'?'All':ty}</button>`).join('')}
    </div>
    <div class="field" style="margin-bottom:16px;">
      <select id="monthFilter">
        <option value="all">All months</option>
        ${monthOptions.map(mk=>`<option value="${mk}" ${ui.ledgerFilterMonth===mk?'selected':''}>${monthLabel(mk)}</option>`).join('')}
      </select>
    </div>
    ${Object.keys(grouped).length ? Object.keys(grouped).map(d=>`
      <div class="txn-date">${d}</div>
      <div class="card">${grouped[d].map(txnRow).join('')}</div>
    `).join('') : `<div class="empty"><h3>Nothing here</h3><p>Try a different filter, or log a new transaction.</p></div>`}
  `;
  document.getElementById('monthFilter').onchange = e=>{ ui.ledgerFilterMonth=e.target.value; renderLedger(); };
}
function monthLabel(mk){ const [y,m]=mk.split('-'); return `${MONTH_NAMES[+m-1]} ${y}`; }

/* ---------------- ADD TRANSACTION ---------------- */
let addState = { type:'Expense', date: todayISO(), account:'city', account2:'', category:'', subcategory:'', context:'', amount:'' };

function renderAdd(){
  const type = addState.type;
  view.innerHTML = `
    <div class="seg" style="margin-bottom:18px;">
      ${['Income','Expense','Loan','Transfer'].map(t=>`<button data-set-type="${t}" class="${type===t?'active':''}">${t}</button>`).join('')}
    </div>

    <div class="field">
      <label>Date</label>
      <input type="date" id="f-date" value="${addState.date}" />
    </div>

    ${type==='Transfer' ? `
      <div class="field"><label>From account</label>
        <select id="f-account">${ACCOUNTS.map(a=>`<option value="${a.id}" ${addState.account===a.id?'selected':''}>${a.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>To account</label>
        <select id="f-account2">${ACCOUNTS.map(a=>`<option value="${a.id}" ${addState.account2===a.id?'selected':''}>${a.name}</option>`).join('')}</select>
      </div>
    ` : `
      <div class="field"><label>Account</label>
        <select id="f-account">${ACCOUNTS.map(a=>`<option value="${a.id}" ${addState.account===a.id?'selected':''}>${a.name}</option>`).join('')}</select>
      </div>
    `}

    ${type!=='Transfer' ? `
      <div class="field"><label>Category</label>
        <select id="f-category">
          <option value="">Choose…</option>
          ${categoriesFor(type).map(c=>`<option value="${c}" ${addState.category===c?'selected':''}>${c.replace(/_/g,' ')}</option>`).join('')}
          <option value="__new__">+ New category…</option>
        </select>
      </div>
    ` : ''}

    <div class="field">
      <label>${type==='Loan' ? "Person's name" : 'Subcategory'}</label>
      <input type="text" id="f-subcategory" placeholder="${type==='Loan'?'e.g. Rafiq':'e.g. merchant, purpose'}" value="${esc(addState.subcategory)}" />
    </div>

    <div class="field">
      <label>Context <span class="muted">(optional)</span></label>
      <input type="text" id="f-context" placeholder="Extra detail" value="${esc(addState.context)}" />
    </div>

    <div class="field">
      <label>Amount</label>
      <input type="number" inputmode="decimal" id="f-amount" placeholder="0" value="${addState.amount}" />
    </div>

    <button class="btn" id="saveTxnBtn">Save entry</button>
  `;

  document.querySelectorAll('[data-set-type]').forEach(b=>b.onclick=()=>{ addState.type=b.dataset.setType; addState.category=''; syncFormIntoState(); renderAdd(); });
  const bind = (id,key)=>{ const el=document.getElementById(id); if(el) el.oninput=el.onchange=()=>{ addState[key]=el.value; }; };
  bind('f-date','date'); bind('f-account','account'); bind('f-account2','account2');
  bind('f-subcategory','subcategory'); bind('f-context','context'); bind('f-amount','amount');
  const catEl = document.getElementById('f-category');
  if(catEl) catEl.onchange = ()=>{
    if(catEl.value==='__new__'){
      const name = prompt('New category name (e.g. Subscriptions)');
      if(name && name.trim()){
        const clean = name.trim().replace(/\s+/g,'_');
        state.settings.customCategories[type] = state.settings.customCategories[type]||[];
        state.settings.customCategories[type].push(clean);
        save();
        addState.category = clean;
      } else { addState.category=''; }
      renderAdd();
    } else { addState.category = catEl.value; }
  };
  document.getElementById('saveTxnBtn').onclick = saveTransaction;
}
function syncFormIntoState(){ /* values already bound live via oninput */ }

function saveTransaction(){
  const amt = parseFloat(addState.amount);
  if(!amt || amt<=0){ toast('Enter an amount'); return; }
  if(addState.type!=='Transfer' && !addState.category){ toast('Choose a category'); return; }
  if(addState.type==='Loan' && !addState.subcategory.trim()){ toast("Enter the person's name"); return; }
  if(addState.type==='Transfer' && addState.account===addState.account2){ toast('Pick two different accounts'); return; }

  const t = { id:uid(), date:addState.date, type:addState.type, subcategory:addState.subcategory.trim(), context:addState.context.trim(), amounts:{} };

  if(addState.type==='Income'){ t.category=addState.category; t.amounts[addState.account]=amt; }
  else if(addState.type==='Expense'){ t.category=addState.category; t.amounts[addState.account]=-amt; }
  else if(addState.type==='Loan'){
    t.category=addState.category;
    const sign = (addState.category==='Loan_Taken'||addState.category==='Received') ? amt : -amt;
    t.amounts[addState.account]=sign;
  } else if(addState.type==='Transfer'){
    const toPF = addState.account2==='pf';
    t.category = toPF ? 'Hold' : `From_${accountName(addState.account)}`;
    t.amounts[addState.account] = -amt;
    t.amounts[addState.account2] = amt;
  }

  state.transactions.push(t);
  save();
  toast('Saved to the ledger');
  addState = { type:addState.type, date: todayISO(), account:'city', account2:'', category:'', subcategory:'', context:'', amount:'' };
  setTab('home');
}

function openTxnSheet(id){
  const t = state.transactions.find(x=>x.id===id);
  if(!t) return;
  const rows = Object.entries(t.amounts).filter(([,v])=>v).map(([acc,v])=>`<div class="row-between small" style="padding:4px 0;"><span class="muted">${accountName(acc)}</span><span style="font-family:var(--font-mono);">${fmtSigned(v)}</span></div>`).join('');
  showSheet(`
    <h2>${esc(t.category.replace(/_/g,' '))}</h2>
    <div class="muted small" style="margin-bottom:14px;">${t.date} · ${t.type}</div>
    ${t.subcategory?`<div class="small" style="margin-bottom:6px;"><b>${esc(t.subcategory)}</b></div>`:''}
    ${t.context?`<div class="muted small" style="margin-bottom:14px;">${esc(t.context)}</div>`:''}
    <div class="card">${rows}</div>
    <button class="btn danger" id="deleteTxnBtn">Delete entry</button>
  `);
  document.getElementById('deleteTxnBtn').onclick = ()=>{
    state.transactions = state.transactions.filter(x=>x.id!==id);
    save(); closeSheet(); toast('Deleted'); render();
  };
}

/* ---------------- INSIGHTS ---------------- */
function renderInsights(){
  const subs = [['monthly','Monthly'],['goals','Goals'],['budget','Budget'],['analytics','Categories']];
  view.innerHTML = `<div class="subtabs">${subs.map(([k,l])=>`<button data-insight="${k}" class="${ui.insightsSub===k?'active':''}">${l}</button>`).join('')}</div><div id="insightBody"></div>`;
  document.querySelectorAll('[data-insight]').forEach(b=>b.onclick=()=>{ ui.insightsSub=b.dataset.insight; renderInsights(); });
  const body = document.getElementById('insightBody');
  if(ui.insightsSub==='monthly') body.innerHTML = monthlyHTML();
  else if(ui.insightsSub==='goals') body.innerHTML = goalsHTML();
  else if(ui.insightsSub==='budget') body.innerHTML = budgetHTML();
  else body.innerHTML = analyticsHTML();
  if(ui.insightsSub==='goals') bindGoalRadios();
}

function monthlyHTML(){
  const year = new Date().getFullYear();
  const months = monthlySummary(year);
  const maxBal = Math.max(...months.map(m=>Math.abs(m.runningBalance)), 1);
  const active = months.filter(m=>m.hasData);
  return `
    <div class="card">
      <div class="card-title">Running balance — ${year}</div>
      <div class="barchart">
        ${months.map(m=>`
          <div class="bar-col">
            <div class="bar-fill ${m.runningBalance<0?'neg':''}" style="height:${Math.max(Math.abs(m.runningBalance)/maxBal*100,2)}%"></div>
            <div class="bar-label">${m.name.slice(0,3)}</div>
          </div>`).join('')}
      </div>
    </div>
    ${active.length===0?`<div class="empty"><p>Log some transactions to see your monthly report.</p></div>`: months.filter(m=>m.hasData).map(m=>`
      <div class="card">
        <div class="row-between" style="margin-bottom:8px;"><b>${m.name}</b><span class="muted small">Savings rate ${m.savingsRate.toFixed(0)}%</span></div>
        <div class="row-between small"><span class="muted">Income</span><span style="font-family:var(--font-mono);">${fmt(m.income)}</span></div>
        <div class="row-between small"><span class="muted">Expense</span><span style="font-family:var(--font-mono);">${fmt(m.expense)}</span></div>
        <div class="row-between small"><span class="muted">P/L</span><span style="font-family:var(--font-mono); color:${m.pl>=0?'var(--gold)':'var(--rose)'}">${fmtSigned(m.pl)}</span></div>
        <div class="row-between small"><span class="muted">Balance at month end</span><span style="font-family:var(--font-mono);">${fmt(m.runningBalance)}</span></div>
      </div>
    `).join('')}
  `;
}

function goalsHTML(){
  const g = savingsGoalData();
  const order = ['ideal','current','strict','flexible'];
  return `
    <div class="card">
      <div class="card-title">Year to date</div>
      <div class="row-between small"><span class="muted">Months elapsed</span><span>${g.monthsElapsed} of 12</span></div>
      <div class="row-between small"><span class="muted">Saved so far</span><span style="font-family:var(--font-mono);">${fmt(g.savingsToDate)}</span></div>
      <div class="row-between small"><span class="muted">Extrapolated year-end</span><span style="font-family:var(--font-mono);">${fmt(g.extrapolatedYearEnd)}</span></div>
    </div>
    <div class="card">
      <div class="card-title">Choose your active target</div>
      ${order.map(k=>{
        const s=g.strategies[k];
        return `
        <div class="goal-row" data-goal-radio="${k}">
          <span class="goal-name"><span class="radio-dot ${g.active===k?'checked':''}"></span>${s.label}<span class="tag">${s.tag}</span></span>
          <span class="goal-val">${fmt(s.monthly)}<span class="tag">/mo</span></span>
        </div>`;
      }).join('')}
    </div>
  `;
}
function bindGoalRadios(){
  document.querySelectorAll('[data-goal-radio]').forEach(el=>el.onclick=()=>{
    state.settings.activeGoalStrategy = el.dataset.goalRadio; save(); renderInsights();
  });
}

function budgetHTML(){
  const b = dailyBudgetData();
  const pct = Math.min(Math.max((b.spentMonthToDate/(b.allowedToDate||1))*100,0),160);
  return `
    <div class="card budget-status">
      <div class="budget-emoji">${b.status.emoji}</div>
      <div class="budget-msg">${b.status.msg}</div>
      <div class="budget-figure">${fmt(Math.abs(b.diff))} ${b.diff>=0?'under':'over'} for the month so far</div>
      <div class="progressbar"><div class="progressbar-fill ${pct>100?'over':''}" style="width:${Math.min(pct,100)}%"></div></div>
    </div>
    <div class="card">
      <div class="row-between small"><span class="muted">Daily budget</span><span style="font-family:var(--font-mono);">${fmt(b.dailyBudget)}</span></div>
      <div class="row-between small"><span class="muted">Spent today</span><span style="font-family:var(--font-mono);">${fmt(b.spentToday)}</span></div>
      <div class="row-between small"><span class="muted">Remaining today</span><span style="font-family:var(--font-mono); color:${b.remainingToday>=0?'var(--gold)':'var(--rose)'}">${fmt(b.remainingToday)}</span></div>
      <div class="row-between small"><span class="muted">Spent this month</span><span style="font-family:var(--font-mono);">${fmt(b.spentMonthToDate)}</span></div>
      <div class="row-between small"><span class="muted">Income estimate used</span><span style="font-family:var(--font-mono);">${fmt(b.incomeEstimate)}</span></div>
    </div>
    <p class="muted small">Set a fixed "expected monthly income" in More → Settings for a steadier daily budget instead of relying on this month's income so far.</p>
  `;
}

function analyticsHTML(){
  const year = new Date().getFullYear();
  const type = ui.analyticsType || 'Expense';
  const mat = categoryMatrix(year, type);
  const maxVal = Math.max(...mat.categories.map(c=>mat.catTotal(c)), 1);
  return `
    <div class="seg" style="margin-bottom:14px;">
      ${['Expense','Income'].map(t=>`<button data-analytics-type="${t}" class="${type===t?'active':''}">${t}</button>`).join('')}
    </div>
    ${mat.categories.length? `
    <div class="card">
      <div class="card-title">${type} by category — ${year}</div>
      ${mat.categories.map(c=>`
        <div style="margin-bottom:10px;">
          <div class="row-between small"><span>${c.replace(/_/g,' ')}</span><span style="font-family:var(--font-mono);">${fmt(mat.catTotal(c))}</span></div>
          <div class="progressbar"><div class="progressbar-fill" style="width:${mat.catTotal(c)/maxVal*100}%"></div></div>
        </div>
      `).join('')}
    </div>` : `<div class="empty"><p>No ${type.toLowerCase()} logged for ${year} yet.</p></div>`}
  `;
  }
function bindAnalyticsToggle(){
  document.querySelectorAll('[data-analytics-type]').forEach(b=>b.onclick=()=>{ ui.analyticsType=b.dataset.analyticsType; renderInsights(); });
}

/* ---------------- MORE (Loans / Zakat / Settings) ---------------- */
function renderMore(){
  const subs = [['loans','Loans'],['zakat','Zakat'],['settings','Settings']];
  view.innerHTML = `<div class="subtabs">${subs.map(([k,l])=>`<button data-more="${k}" class="${ui.moreSub===k?'active':''}">${l}</button>`).join('')}</div><div id="moreBody"></div>`;
  document.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{ ui.moreSub=b.dataset.more; renderMore(); });
  const body = document.getElementById('moreBody');
  if(ui.moreSub==='loans') body.innerHTML = loansHTML();
  else if(ui.moreSub==='zakat') body.innerHTML = zakatHTML();
  else { body.innerHTML = settingsHTML(); bindSettingsForm(); }
}

function loansHTML(){
  const loans = loanBalances();
  return `
    ${loans.length? loans.map(p=>`
      <div class="card loan-card">
        <div>
          <div class="loan-person">${esc(p.person)}</div>
          <div class="loan-detail">Lent ${fmt(p.given)} · Repaid to you ${fmt(p.received)}</div>
          <div class="loan-detail">Borrowed ${fmt(p.taken)} · You repaid ${fmt(p.paid)}</div>
        </div>
        <div style="text-align:right;">
          ${p.owedToMe>0?`<div class="txn-amt pos">${fmt(p.owedToMe)}<div class="small muted">owes you</div></div>`:''}
          ${p.iOwe>0?`<div class="txn-amt neg">${fmt(p.iOwe)}<div class="small muted">you owe</div></div>`:''}
          ${p.owedToMe<=0&&p.iOwe<=0?`<div class="small muted">Settled</div>`:''}
        </div>
      </div>
    `).join('') : `<div class="empty"><h3>No informal loans yet</h3><p>Log a Loan transaction from the + tab (Loan Given, Loan Taken, Received or Debt Paid) and it'll show up here grouped by person.</p></div>`}
  `;
}

function zakatHTML(){
  const z = zakatData();
  const s = state.settings;
  return `
    <div class="card">
      <div class="card-title">Gold rates (per vori · you enter these)</div>
      ${['22','21','18'].map(k=>`
        <div class="field"><label>${k}k gold</label><input type="number" data-gold="${k}" value="${s.goldRates[k]||''}" placeholder="0" /></div>
      `).join('')}
      <div class="field"><label>Shonatoni</label><input type="number" data-gold="shonatoni" value="${s.goldRates.shonatoni||''}" placeholder="0" /></div>
      <div class="field"><label>Use which purity for Nisab?</label>
        <select id="zakatKarat">
          ${['22','21','18'].map(k=>`<option value="${k}" ${s.zakatGoldKarat===k?'selected':''}>${k}k</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Nisab &amp; wealth</div>
      <div class="row-between small"><span class="muted">Nisab (7.5 vori)</span><span style="font-family:var(--font-mono);">${fmt(z.nisab)}</span></div>
      <div class="row-between small"><span class="muted">Your net worth</span><span style="font-family:var(--font-mono);">${fmt(z.wealth)}</span></div>
      <div class="row-between small"><span class="muted">Zakat eligible?</span><span>${z.eligible?'Yes':'No'}</span></div>
    </div>
    ${z.eligible?`
    <div class="card">
      <div class="card-title">Zakat due</div>
      <div class="row-between small"><span class="muted">At 2.5%</span><span style="font-family:var(--font-mono); color:var(--gold);">${fmt(z.due25)}</span></div>
      <div class="row-between small"><span class="muted">At 3%</span><span style="font-family:var(--font-mono); color:var(--gold);">${fmt(z.due3)}</span></div>
    </div>` : `<p class="muted small">Enter this year's gold rate to see your Nisab threshold and whether Zakat is due.</p>`}
  `;
}
function bindZakatInputs(){
  document.querySelectorAll('[data-gold]').forEach(el=>el.oninput=()=>{ state.settings.goldRates[el.dataset.gold]=parseFloat(el.value)||0; save(); });
  const k = document.getElementById('zakatKarat');
  if(k) k.onchange=()=>{ state.settings.zakatGoldKarat=k.value; save(); renderMore(); };
}

function settingsHTML(){
  const s = state.settings;
  return `
    <div class="card">
      <div class="card-title">Opening balances</div>
      ${ACCOUNTS.map(a=>`<div class="field"><label>${a.name}</label><input type="number" data-bal="${a.id}" value="${s.initialBalances[a.id]||0}" /></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Savings targets</div>
      <div class="field"><label>Ideal save rate (monthly)</label><input type="number" data-set="idealSaveRate" value="${s.idealSaveRate}" /></div>
      <div class="field"><label>Annual target (strict)</label><input type="number" data-set="annualTarget" value="${s.annualTarget}" /></div>
      <div class="field"><label>Annual target (flexible)</label><input type="number" data-set="flexibleAnnualTarget" value="${s.flexibleAnnualTarget}" /></div>
    </div>
    <div class="card">
      <div class="card-title">Daily budget inputs</div>
      <div class="field"><label>Expected monthly income <span class="muted">(0 = auto)</span></label><input type="number" data-set="expectedMonthlyIncome" value="${s.expectedMonthlyIncome}" /></div>
      <div class="field"><label>Home support allowance</label><input type="number" data-set="homeSupport" value="${s.homeSupport}" /></div>
      <div class="field"><label>Investment allowance</label><input type="number" data-set="investmentAllowance" value="${s.investmentAllowance}" /></div>
      <div class="field"><label>Office cost</label><input type="number" data-set="officeCost" value="${s.officeCost}" /></div>
    </div>
    <div class="card">
      <div class="card-title">Data</div>
      <button class="btn secondary" id="exportBtn">Export backup (.json)</button>
      <div class="spacer"></div>
      <button class="btn ghost" id="importBtn">Import backup</button>
      <input type="file" id="importFile" accept="application/json" style="display:none;" />
      <div class="spacer"></div>
      <button class="btn danger" id="wipeBtn">Erase all data</button>
    </div>
    <div class="card">
      <div class="card-title">Credits</div>
      <p class="small muted"><a href="https://www.flaticon.com/free-icons/ledger" title="Ledger icons" target="_blank" rel="noopener" style="color:var(--gold);">Ledger icons created by Freepik - Flaticon</a></p>
    </div>
  `;
}
function bindSettingsForm(){
  document.querySelectorAll('[data-bal]').forEach(el=>el.oninput=()=>{ state.settings.initialBalances[el.dataset.bal]=parseFloat(el.value)||0; save(); });
  document.querySelectorAll('[data-set]').forEach(el=>el.oninput=()=>{ state.settings[el.dataset.set]=parseFloat(el.value)||0; save(); });
  document.getElementById('exportBtn').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`khata-backup-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  document.getElementById('importBtn').onclick = ()=>document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{ const parsed = JSON.parse(reader.result); state = parsed; save(); toast('Backup restored'); render(); }
      catch(err){ toast('Could not read that file'); }
    };
    reader.readAsText(file);
  };
  document.getElementById('wipeBtn').onclick = ()=>{
    if(confirm('This erases every transaction and setting on this phone. Continue?')){
      localStorage.removeItem(STORAGE_KEY); state = load(); toast('All data erased'); render();
    }
  };
}

/* ---------------- sheet (bottom modal) ---------------- */
function ensureSheetDom(){
  if(document.getElementById('sheetBackdrop')) return;
  const d = document.createElement('div');
  d.id='sheetBackdrop'; d.className='sheet-backdrop hidden';
  d.innerHTML = `<div class="sheet"><div class="sheet-handle"></div><div id="sheetContent"></div></div>`;
  d.onclick = (e)=>{ if(e.target===d) closeSheet(); };
  document.body.appendChild(d);
}
function showSheet(html){ ensureSheetDom(); document.getElementById('sheetContent').innerHTML = html; document.getElementById('sheetBackdrop').classList.remove('hidden'); }
function closeSheet(){ const d=document.getElementById('sheetBackdrop'); if(d) d.classList.add('hidden'); }

/* ---------------- global event delegation ---------------- */
document.addEventListener('click', (e)=>{
  const gotoEl = e.target.closest('[data-goto]');
  if(gotoEl){
    if(gotoEl.dataset.sub){
      if(gotoEl.dataset.goto==='insights') ui.insightsSub = gotoEl.dataset.sub;
      if(gotoEl.dataset.goto==='more') ui.moreSub = gotoEl.dataset.sub;
    }
    setTab(gotoEl.dataset.goto);
    return;
  }
  const txnEl = e.target.closest('[data-open-txn]');
  if(txnEl){ openTxnSheet(txnEl.dataset.openTxn); return; }
  const ledgerType = e.target.closest('[data-ledger-type]');
  if(ledgerType){ ui.ledgerFilterType = ledgerType.dataset.ledgerType; renderLedger(); return; }
  const analyticsType = e.target.closest('[data-analytics-type]');
  if(analyticsType){ ui.analyticsType = analyticsType.dataset.analyticsType; renderInsights(); return; }
  const goldInput = e.target.closest('[data-gold]');
  if(goldInput){ return; } // handled by input listener below via delegated bind after render
});

// re-bind dynamic inputs that need delegated live listeners each render
const origRenderMore = renderMore;
renderMore = function(){ origRenderMore(); if(ui.moreSub==='zakat') bindZakatInputs(); };

document.getElementById('settingsBtn').onclick = ()=>{ ui.moreSub='settings'; setTab('more'); };
document.querySelectorAll('.tabbtn').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));

/* ---------------- boot ---------------- */
setTab('home');

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
