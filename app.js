/* ============================================================
   HALKHATA — personal cashflow ledger
   Single source of truth: state.transactions[]
   Everything else below is a computed view over it.
   ============================================================ */

const STORAGE_KEY = 'khata_v1';

// Used only to seed a brand-new install, or to migrate an old install
// that still has the hardcoded account list. Accounts now live in state.
const ACCOUNTS_SEED = [
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

const CHART_PALETTE = ['#C9A227','#D1495B','#8FA69B','#6FA8DC','#E1B15A','#8E6FCE','#4FB0A5','#D98E73','#B98CCB','#7FA0C9'];

const DEFAULT_SETTINGS = {
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
      parsed.settings.goldRates = Object.assign({}, DEFAULT_SETTINGS.goldRates, parsed.settings.goldRates || {});
      parsed.settings.customCategories = Object.assign({Income:[],Expense:[]}, parsed.settings.customCategories || {});
      parsed.transactions = parsed.transactions || [];
      parsed.loanNotes = parsed.loanNotes || [];
      // migrate accounts from old hardcoded list + settings.initialBalances if needed
      if(!parsed.accounts){
        const oldBalances = (parsed.settings && parsed.settings.initialBalances) || {};
        parsed.accounts = ACCOUNTS_SEED.map(a => ({ id:a.id, name:a.name, initialBalance: oldBalances[a.id]||0, archived:false }));
      }
      parsed.accounts.forEach(a => { if(a.archived===undefined) a.archived=false; });
      delete parsed.settings.initialBalances;
      return parsed;
    }
  }catch(e){ console.error('load failed', e); }
  return {
    transactions:[],
    accounts: ACCOUNTS_SEED.map(a => ({ id:a.id, name:a.name, initialBalance:0, archived:false })),
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    loanNotes:[],
  };
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
function accountById(id){ return state.accounts.find(a=>a.id===id); }
function accountName(id){ const a=accountById(id); return a?a.name:id; }
function activeAccounts(){ return state.accounts.filter(a=>!a.archived); }
function esc(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function colorForCategory(name){
  let h=0; for(let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
  return CHART_PALETTE[h % CHART_PALETTE.length];
}

function categoriesFor(type){
  if(type==='Income') return [...CATEGORY_TAXONOMY.Income, ...state.settings.customCategories.Income];
  if(type==='Expense') return [...CATEGORY_TAXONOMY.Expense, ...state.settings.customCategories.Expense];
  if(type==='Loan') return CATEGORY_TAXONOMY.Loan;
  return [];
}
function allCategoriesFlat(){
  return [...new Set([...categoriesFor('Income'), ...categoriesFor('Expense'), ...categoriesFor('Loan')])];
}

/* ---------------- accounts CRUD ---------------- */
function addAccount(name, initialBalance){
  const id = uid();
  state.accounts.push({ id, name: name.trim()||'Untitled account', initialBalance:Number(initialBalance)||0, archived:false });
  save();
  return id;
}
function updateAccount(id, patch){
  const a = accountById(id);
  if(a) Object.assign(a, patch);
  save();
}
function deleteAccount(id){
  const hasTxns = state.transactions.some(t => t.amounts[id]!==undefined && t.amounts[id]!==0);
  if(hasTxns){
    updateAccount(id, { archived:true });
  } else {
    state.accounts = state.accounts.filter(a=>a.id!==id);
    save();
  }
}

/* ---------------- core derived math ---------------- */
function txnTotal(t){ return Object.values(t.amounts).reduce((a,b)=>a+(b||0),0); }

function accountBalance(accId){
  const a = accountById(accId);
  let bal = a ? (a.initialBalance||0) : 0;
  for(const t of state.transactions) bal += (t.amounts[accId]||0);
  return bal;
}
function allAccountBalances(includeArchived){
  const list = includeArchived ? state.accounts : activeAccounts();
  return list.map(a=>({...a, balance:accountBalance(a.id)}));
}

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
  const accTotal = state.accounts.reduce((s,a)=>s+accountBalance(a.id),0);
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
  const initialTotal = state.accounts.reduce((s,a)=>s+(a.initialBalance||0),0);
  let running = initialTotal;
  months.forEach(mo=>{
    const net = state.transactions.filter(t=>t.date.startsWith(mo.key)).reduce((s,t)=>s+txnTotal(t),0);
    running += net;
    mo.runningBalance = running;
  });
  return months;
}

function yearlyRollup(year){
  const months = monthlySummary(year);
  return months.reduce((acc,m)=>({
    income: acc.income+m.income, expense: acc.expense+m.expense, pl: acc.pl+m.pl
  }), {income:0, expense:0, pl:0});
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
  const months = monthlySummary(year).map(m=>m.key);
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
let ui = {
  tab:'home', prevTab:'home',
  insightsSub:'monthly', analyticsType:'Expense',
  revealedAccounts:{},
  ledgerFilters:{ type:'all', range:'all', month:'all', account:'all', category:'all', search:'' },
};

const TABS = ['home','ledger','goals','insights'];

const view = document.getElementById('view');
const pageTitle = document.getElementById('pageTitle');
const pageEyebrow = document.getElementById('pageEyebrow');
const fab = document.getElementById('fab');

function setTab(tab){
  ui.tab = tab;
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  render();
}
function openAdd(){
  ui.prevTab = TABS.includes(ui.tab) ? ui.tab : 'home';
  ui.tab = 'add';
  render();
}
function closeAdd(){
  ui.tab = ui.prevTab || 'home';
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('active', b.dataset.tab===ui.tab));
  render();
}

function render(){
  const titles = {
    home:['Halkhata','Home'], ledger:['Ledger','All transactions'],
    goals:['Goals & Budget','Targets & daily spend'], insights:['Insights','Where it goes'],
    add:['New Entry','Add transaction'],
  };
  pageEyebrow.textContent = titles[ui.tab][0];
  pageTitle.textContent = titles[ui.tab][1];
  fab.classList.toggle('hidden', !(ui.tab==='home' || ui.tab==='ledger'));

  if(ui.tab==='home') renderHome();
  else if(ui.tab==='ledger') renderLedger();
  else if(ui.tab==='add') renderAdd();
  else if(ui.tab==='goals') renderGoals();
  else if(ui.tab==='insights') renderInsights();
  window.scrollTo(0,0);
}

/* ---------------- HOME ---------------- */
function renderHome(){
  const nw = netWorth();
  const accs = allAccountBalances(false);
  const budget = dailyBudgetData();
  const debt = debtBalance();
  const recent = [...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,5);

  view.innerHTML = `
    <div class="hero">
      <div class="hero-label">Net Worth</div>
      <div class="hero-amount">${fmt(nw)}</div>
      <div class="hero-sub">${debt>0 ? `Owing <b>${fmt(debt)}</b> to people` : 'No informal debt outstanding'}</div>
    </div>

    <div class="card" data-goto="goals">
      <div class="card-title">Today's Budget</div>
      <div class="row-between">
        <div>
          <div style="font-family:var(--font-mono); font-size:22px;">${budget.status.emoji} ${fmt(Math.max(budget.remainingToday,0))}</div>
          <div class="muted small">${budget.status.msg} · left to spend today</div>
        </div>
        <div class="muted small" style="text-align:right;">Daily budget<br><b style="color:var(--paper)">${fmt(budget.dailyBudget)}</b></div>
      </div>
    </div>

    <div class="section-head"><h2>Accounts</h2><button class="link" data-open-accounts>✎ Edit</button></div>
    <div class="acct-grid">
      ${accs.map(a=>{
        const revealed = !!ui.revealedAccounts[a.id];
        return `
        <div class="acct-item" data-reveal-acct="${a.id}">
          <div class="acct-name">${esc(a.name)}</div>
          <div class="acct-bal ${revealed && a.balance<0?'neg':''} ${revealed?'':'masked'}">${revealed ? fmt(a.balance) : '••••••'}</div>
        </div>`;
      }).join('')}
      <button class="acct-item-add" data-add-account>+ Add account</button>
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

function addAccountSheet(){
  showSheet(`
    <h2>New account</h2>
    <div class="field"><label>Name</label><input type="text" id="newAcctName" placeholder="e.g. Savings account" /></div>
    <div class="field"><label>Starting balance</label><input type="number" id="newAcctBal" value="0" /></div>
    <button class="btn" id="newAcctSaveBtn">Add account</button>
  `);
  document.getElementById('newAcctSaveBtn').onclick = ()=>{
    const name = document.getElementById('newAcctName').value.trim();
    const bal = parseFloat(document.getElementById('newAcctBal').value)||0;
    if(!name){ toast('Enter a name'); return; }
    addAccount(name, bal);
    closeSheet(); toast('Account added'); render();
  };
}

/* ---------------- LEDGER ---------------- */
function ledgerFilterCount(){
  const f = ui.ledgerFilters;
  let n=0;
  if(f.type!=='all') n++;
  if(f.range!=='all') n++;
  if(f.month!=='all') n++;
  if(f.account!=='all') n++;
  if(f.category!=='all') n++;
  if(f.search.trim()) n++;
  return n;
}

function filteredTransactions(){
  const f = ui.ledgerFilters;
  let txns = [...state.transactions];
  if(f.type!=='all') txns = txns.filter(t=>t.type===f.type);
  if(f.account!=='all') txns = txns.filter(t=>t.amounts[f.account]!==undefined && t.amounts[f.account]!==0);
  if(f.category!=='all') txns = txns.filter(t=>t.category===f.category);
  if(f.search.trim()){
    const q = f.search.trim().toLowerCase();
    txns = txns.filter(t=>(t.subcategory||'').toLowerCase().includes(q) || (t.context||'').toLowerCase().includes(q));
  }
  if(f.month!=='all'){
    txns = txns.filter(t=>monthKeyOf(t.date)===f.month);
  } else if(f.range==='today'){
    txns = txns.filter(t=>t.date===todayISO());
  } else if(f.range==='week'){
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate()-now.getDay());
    const startStr = start.toISOString().slice(0,10);
    txns = txns.filter(t=>t.date>=startStr && t.date<=todayISO());
  } else if(f.range==='month'){
    const mk = todayISO().slice(0,7);
    txns = txns.filter(t=>monthKeyOf(t.date)===mk);
  }
  return txns;
}

function renderLedger(){
  let txns = filteredTransactions();
  txns.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  let grouped = {};
  txns.forEach(t=>{ grouped[t.date]=grouped[t.date]||[]; grouped[t.date].push(t); });
  const count = ledgerFilterCount();

  view.innerHTML = `
    <div class="filter-row">
      <span class="filter-summary">${txns.length} transaction${txns.length===1?'':'s'}</span>
      <button class="iconbtn" id="openFiltersBtn" aria-label="Filter">⏷${count?`<span class="filter-badge">${count}</span>`:''}</button>
    </div>
    ${Object.keys(grouped).length ? Object.keys(grouped).map(d=>`
      <div class="txn-date">${d}</div>
      <div class="card">${grouped[d].map(txnRow).join('')}</div>
    `).join('') : `<div class="empty"><h3>Nothing here</h3><p>Try different filters, or log a new transaction.</p></div>`}
  `;
  document.getElementById('openFiltersBtn').onclick = openLedgerFilters;
}
function monthLabel(mk){ const [y,m]=mk.split('-'); return `${MONTH_NAMES[+m-1]} ${y}`; }

function ledgerFilterSheetHTML(){
  const f = ui.ledgerFilters;
  const monthOptions = [...new Set(state.transactions.map(t=>monthKeyOf(t.date)))].sort().reverse();
  const catOptions = f.type==='all' || f.type==='Transfer' ? allCategoriesFlat() : categoriesFor(f.type);
  return `
    <h2>Filter transactions</h2>
    <div class="field"><label>Type</label>
      <div class="seg">${['all','Income','Expense','Loan','Transfer'].map(t=>`<button data-f-type="${t}" class="${f.type===t?'active':''}">${t==='all'?'All':t}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Time range</label>
      <div class="seg">${[['all','All'],['today','Today'],['week','Week'],['month','This month']].map(([k,l])=>`<button data-f-range="${k}" class="${f.range===k?'active':''}">${l}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Specific month</label>
      <select id="f-month"><option value="all">Any</option>${monthOptions.map(mk=>`<option value="${mk}" ${f.month===mk?'selected':''}>${monthLabel(mk)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Account</label>
      <select id="f-account"><option value="all">All accounts</option>${state.accounts.map(a=>`<option value="${a.id}" ${f.account===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Category</label>
      <select id="f-category"><option value="all">All</option>${catOptions.map(c=>`<option value="${c}" ${f.category===c?'selected':''}>${c.replace(/_/g,' ')}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Search subcategory / context</label>
      <input type="text" id="f-search" value="${esc(f.search)}" placeholder="e.g. Rafiq, groceries" />
    </div>
    <button class="btn" id="applyFiltersBtn">Show results</button>
    <div class="spacer"></div>
    <button class="btn ghost" id="clearFiltersBtn">Clear all filters</button>
  `;
}
function openLedgerFilters(){ showSheet(ledgerFilterSheetHTML()); bindLedgerFilterSheet(); }
function bindLedgerFilterSheet(){
  document.querySelectorAll('[data-f-type]').forEach(b=>b.onclick=()=>{ ui.ledgerFilters.type=b.dataset.fType; ui.ledgerFilters.category='all'; showSheet(ledgerFilterSheetHTML()); bindLedgerFilterSheet(); });
  document.querySelectorAll('[data-f-range]').forEach(b=>b.onclick=()=>{ ui.ledgerFilters.range=b.dataset.fRange; if(b.dataset.fRange!=='all') ui.ledgerFilters.month='all'; showSheet(ledgerFilterSheetHTML()); bindLedgerFilterSheet(); });
  const monthEl=document.getElementById('f-month'); if(monthEl) monthEl.onchange=()=>{ ui.ledgerFilters.month=monthEl.value; if(monthEl.value!=='all') ui.ledgerFilters.range='all'; };
  const accEl=document.getElementById('f-account'); if(accEl) accEl.onchange=()=>{ ui.ledgerFilters.account=accEl.value; };
  const catEl=document.getElementById('f-category'); if(catEl) catEl.onchange=()=>{ ui.ledgerFilters.category=catEl.value; };
  const searchEl=document.getElementById('f-search'); if(searchEl) searchEl.oninput=()=>{ ui.ledgerFilters.search=searchEl.value; };
  document.getElementById('applyFiltersBtn').onclick=()=>{ closeSheet(); renderLedger(); };
  document.getElementById('clearFiltersBtn').onclick=()=>{ ui.ledgerFilters={type:'all',range:'all',month:'all',account:'all',category:'all',search:''}; closeSheet(); renderLedger(); };
}

/* ---------------- ADD TRANSACTION ---------------- */
let addState = { type:'Expense', date: todayISO(), account:'', account2:'', category:'', subcategory:'', context:'', amount:'' };

function renderAdd(){
  const type = addState.type;
  if(!addState.account) addState.account = (activeAccounts()[0]||{}).id || '';
  view.innerHTML = `
    <button class="sheet-back" id="cancelAddBtn">‹ Cancel</button>
    <div class="seg" style="margin-bottom:18px;">
      ${['Income','Expense','Loan','Transfer'].map(t=>`<button data-set-type="${t}" class="${type===t?'active':''}">${t}</button>`).join('')}
    </div>

    <div class="field">
      <label>Date</label>
      <input type="date" id="f-date" value="${addState.date}" />
    </div>

    ${type==='Transfer' ? `
      <div class="field"><label>From account</label>
        <select id="f-account">${activeAccounts().map(a=>`<option value="${a.id}" ${addState.account===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>To account</label>
        <select id="f-account2">${activeAccounts().map(a=>`<option value="${a.id}" ${addState.account2===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>
      </div>
    ` : `
      <div class="field"><label>Account</label>
        <select id="f-account">${activeAccounts().map(a=>`<option value="${a.id}" ${addState.account===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>
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

  document.getElementById('cancelAddBtn').onclick = closeAdd;
  document.querySelectorAll('[data-set-type]').forEach(b=>b.onclick=()=>{ addState.type=b.dataset.setType; addState.category=''; renderAdd(); });
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

function saveTransaction(){
  const amt = parseFloat(addState.amount);
  if(!amt || amt<=0){ toast('Enter an amount'); return; }
  if(addState.type!=='Transfer' && !addState.category){ toast('Choose a category'); return; }
  if(addState.type==='Loan' && !addState.subcategory.trim()){ toast("Enter the person's name"); return; }
  if(addState.type==='Transfer' && addState.account===addState.account2){ toast('Pick two different accounts'); return; }
  if(!addState.account){ toast('Add an account first'); return; }

  const t = { id:uid(), date:addState.date, type:addState.type, subcategory:addState.subcategory.trim(), context:addState.context.trim(), amounts:{} };

  if(addState.type==='Income'){ t.category=addState.category; t.amounts[addState.account]=amt; }
  else if(addState.type==='Expense'){ t.category=addState.category; t.amounts[addState.account]=-amt; }
  else if(addState.type==='Loan'){
    t.category=addState.category;
    const sign = (addState.category==='Loan_Taken'||addState.category==='Received') ? amt : -amt;
    t.amounts[addState.account]=sign;
  } else if(addState.type==='Transfer'){
    const toAccount = accountById(addState.account2);
    const isPF = toAccount && toAccount.name.toLowerCase().includes('provident');
    t.category = isPF ? 'Hold' : `From_${accountName(addState.account)}`;
    t.amounts[addState.account] = -amt;
    t.amounts[addState.account2] = amt;
  }

  state.transactions.push(t);
  save();
  toast('Saved to the ledger');
  addState = { type:addState.type, date: todayISO(), account:addState.account, account2:'', category:'', subcategory:'', context:'', amount:'' };
  closeAdd();
}

function openTxnSheet(id){
  const t = state.transactions.find(x=>x.id===id);
  if(!t) return;
  const rows = Object.entries(t.amounts).filter(([,v])=>v).map(([acc,v])=>`<div class="row-between small" style="padding:4px 0;"><span class="muted">${esc(accountName(acc))}</span><span style="font-family:var(--font-mono);">${fmtSigned(v)}</span></div>`).join('');
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

/* ---------------- GOALS & BUDGET ---------------- */
function renderGoals(){
  view.innerHTML = budgetStatusHTML() + budgetInputsHTML() + savingsTargetsHTML() + goalsHTML();
  bindGoalRadios();
  document.querySelectorAll('[data-set]').forEach(el=>el.oninput=()=>{ state.settings[el.dataset.set]=parseFloat(el.value)||0; save(); });
}

function budgetStatusHTML(){
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
  `;
}
function budgetInputsHTML(){
  const s = state.settings;
  return `
    <div class="card">
      <div class="card-title">Budget inputs</div>
      <div class="field"><label>Expected monthly income <span class="muted">(0 = auto)</span></label><input type="number" data-set="expectedMonthlyIncome" value="${s.expectedMonthlyIncome}" /></div>
      <div class="field"><label>Home support allowance</label><input type="number" data-set="homeSupport" value="${s.homeSupport}" /></div>
      <div class="field"><label>Investment allowance</label><input type="number" data-set="investmentAllowance" value="${s.investmentAllowance}" /></div>
      <div class="field"><label>Office cost</label><input type="number" data-set="officeCost" value="${s.officeCost}" /></div>
    </div>
  `;
}
function savingsTargetsHTML(){
  const s = state.settings;
  return `
    <div class="card">
      <div class="card-title">Savings targets</div>
      <div class="field"><label>Ideal save rate (monthly)</label><input type="number" data-set="idealSaveRate" value="${s.idealSaveRate}" /></div>
      <div class="field"><label>Annual target (strict)</label><input type="number" data-set="annualTarget" value="${s.annualTarget}" /></div>
      <div class="field"><label>Annual target (flexible)</label><input type="number" data-set="flexibleAnnualTarget" value="${s.flexibleAnnualTarget}" /></div>
    </div>
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
    state.settings.activeGoalStrategy = el.dataset.goalRadio; save(); renderGoals();
  });
}

/* ---------------- INSIGHTS ---------------- */
function renderInsights(){
  const subs = [['monthly','Monthly'],['charts','Charts'],['categories','Categories']];
  view.innerHTML = `<div class="subtabs">${subs.map(([k,l])=>`<button data-insight="${k}" class="${ui.insightsSub===k?'active':''}">${l}</button>`).join('')}</div><div id="insightBody"></div>`;
  document.querySelectorAll('[data-insight]').forEach(b=>b.onclick=()=>{ ui.insightsSub=b.dataset.insight; renderInsights(); });
  const body = document.getElementById('insightBody');
  if(ui.insightsSub==='monthly') body.innerHTML = monthlyHTML();
  else if(ui.insightsSub==='charts') body.innerHTML = chartsHTML();
  else body.innerHTML = categoryBreakdownHTML();
  if(ui.insightsSub!=='monthly') document.querySelectorAll('[data-analytics-type]').forEach(b=>b.onclick=()=>{ ui.analyticsType=b.dataset.analyticsType; renderInsights(); });
}

function monthlyHTML(){
  const year = new Date().getFullYear();
  const months = monthlySummary(year);
  const rollup = yearlyRollup(year);
  const maxBal = Math.max(...months.map(m=>Math.abs(m.runningBalance)), 1);
  const active = months.filter(m=>m.hasData);
  return `
    <div class="card">
      <div class="card-title">${year} so far</div>
      <div class="row-between small"><span class="muted">Total income</span><span style="font-family:var(--font-mono);">${fmt(rollup.income)}</span></div>
      <div class="row-between small"><span class="muted">Total expense</span><span style="font-family:var(--font-mono);">${fmt(rollup.expense)}</span></div>
      <div class="row-between small"><span class="muted">Net P/L</span><span style="font-family:var(--font-mono); color:${rollup.pl>=0?'var(--gold)':'var(--rose)'}">${fmtSigned(rollup.pl)}</span></div>
    </div>
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

function categoryBreakdownHTML(){
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

function chartsHTML(){
  const year = new Date().getFullYear();
  const type = ui.analyticsType || 'Expense';
  const mat = categoryMatrix(year, type);
  const total = mat.categories.reduce((s,c)=>s+mat.catTotal(c),0) || 1;
  let acc = 0;
  const stops = mat.categories.map(c=>{
    const val = mat.catTotal(c); const pct = val/total*100; const start=acc; acc+=pct;
    return `${colorForCategory(c)} ${start}% ${acc}%`;
  }).join(', ');
  return `
    <div class="seg" style="margin-bottom:14px;">
      ${['Expense','Income'].map(t=>`<button data-analytics-type="${t}" class="${type===t?'active':''}">${t}</button>`).join('')}
    </div>
    ${mat.categories.length? `
    <div class="card">
      <div class="card-title">${type} split — ${year}</div>
      <div class="piechart" style="background:conic-gradient(${stops});"></div>
      ${mat.categories.map(c=>`
        <div class="legend-row">
          <span class="legend-name small"><span class="legend-dot" style="background:${colorForCategory(c)};"></span>${c.replace(/_/g,' ')}</span>
          <span class="small" style="font-family:var(--font-mono);">${fmt(mat.catTotal(c))} · ${(mat.catTotal(c)/total*100).toFixed(0)}%</span>
        </div>
      `).join('')}
    </div>` : `<div class="empty"><p>No ${type.toLowerCase()} logged for ${year} yet.</p></div>`}
  `;
}

/* ---------------- SIDEBAR (hamburger menu) ---------------- */
function sidebarMenuHTML(){
  const items = [
    ['loans','Loans','Money owed to/by people'],
    ['zakat','Zakat','Nisab & due calculator'],
    ['categories','Categories','View your category list'],
    ['accounts','Accounts','Add, edit, archive accounts'],
    ['settings','Settings','Backup, restore, credits'],
  ];
  return `<h2>Menu</h2><div class="menu-list">${items.map(([k,l,d])=>`
    <button class="menu-row" data-sidebar="${k}">
      <span class="menu-row-main"><b>${l}</b><span class="muted small">${d}</span></span>
      <span class="menu-chevron">›</span>
    </button>`).join('')}</div>`;
}
function openSidebarMenu(){ showSheet(sidebarMenuHTML()); bindSidebarMenu(); }
function bindSidebarMenu(){
  document.querySelectorAll('[data-sidebar]').forEach(b=>b.onclick=()=>openSidebarSection(b.dataset.sidebar));
}
function openSidebarSection(key){
  let html='';
  if(key==='loans') html = loansHTML();
  else if(key==='zakat') html = zakatHTML();
  else if(key==='categories') html = categoryListHTML();
  else if(key==='accounts') html = accountsHTML();
  else if(key==='settings') html = settingsHTML();
  showSheet(`<button class="sheet-back" id="sheetBackBtn">‹ Menu</button>${html}`);
  document.getElementById('sheetBackBtn').onclick = openSidebarMenu;
  if(key==='zakat') bindZakatInputs();
  if(key==='accounts') bindAccountsForm();
  if(key==='settings') bindSettingsForm();
}

function loansHTML(){
  const loans = loanBalances();
  return `
    <h2>Loans</h2>
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
    `).join('') : `<div class="empty"><h3>No informal loans yet</h3><p>Log a Loan transaction (Loan Given, Loan Taken, Received or Debt Paid) and it'll show up here grouped by person.</p></div>`}
  `;
}

function zakatHTML(){
  const z = zakatData();
  const s = state.settings;
  return `
    <h2>Zakat</h2>
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
  if(k) k.onchange=()=>{ state.settings.zakatGoldKarat=k.value; save(); openSidebarSection('zakat'); };
}

function categoryListHTML(){
  const incomeCats = categoriesFor('Income');
  const expenseCats = categoriesFor('Expense');
  return `
    <h2>Categories</h2>
    <div class="card"><div class="card-title">Income</div>${incomeCats.map(c=>`<span class="chip active" style="display:inline-block; margin:3px 4px 3px 0;">${c.replace(/_/g,' ')}</span>`).join('')}</div>
    <div class="card"><div class="card-title">Expense</div>${expenseCats.map(c=>`<span class="chip active" style="display:inline-block; margin:3px 4px 3px 0;">${c.replace(/_/g,' ')}</span>`).join('')}</div>
    <p class="muted small">New categories can be added inline while adding a transaction. Per-category icons and editing are coming later.</p>
  `;
}

function accountsHTML(){
  return `
    <h2>Accounts</h2>
    ${state.accounts.map(a=>`
      <div class="card">
        <div class="row-between" style="margin-bottom:10px;">
          <b>${esc(a.name)}${a.archived?' <span class="muted small">(archived)</span>':''}</b>
          <span class="muted small" style="font-family:var(--font-mono);">${fmt(accountBalance(a.id))}</span>
        </div>
        <div class="field"><label>Name</label><input type="text" data-acct-name="${a.id}" value="${esc(a.name)}" /></div>
        <div class="field"><label>Starting balance</label><input type="number" data-acct-bal="${a.id}" value="${a.initialBalance}" /></div>
        ${!a.archived?`<button class="btn danger" data-del-acct="${a.id}">Remove account</button>`:''}
      </div>
    `).join('')}
    <button class="btn secondary" id="addAcctBtnSidebar">+ Add account</button>
  `;
}
function bindAccountsForm(){
  document.querySelectorAll('[data-acct-name]').forEach(el=>el.oninput=()=>{ updateAccount(el.dataset.acctName, {name:el.value}); });
  document.querySelectorAll('[data-acct-bal]').forEach(el=>el.oninput=()=>{ updateAccount(el.dataset.acctBal, {initialBalance:parseFloat(el.value)||0}); });
  document.querySelectorAll('[data-del-acct]').forEach(el=>el.onclick=()=>{
    if(confirm('Remove this account? If it has transaction history it will be archived instead of deleted.')){
      deleteAccount(el.dataset.delAcct); toast('Account removed'); openSidebarSection('accounts');
    }
  });
  const addBtn = document.getElementById('addAcctBtnSidebar');
  if(addBtn) addBtn.onclick = ()=>{ closeSheet(); addAccountSheet(); };
}

function settingsHTML(){
  return `
    <h2>Settings</h2>
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
      try{ const parsed = JSON.parse(reader.result); state = parsed; save(); toast('Backup restored'); closeSheet(); render(); }
      catch(err){ toast('Could not read that file'); }
    };
    reader.readAsText(file);
  };
  document.getElementById('wipeBtn').onclick = ()=>{
    if(confirm('This erases every transaction and setting on this phone. Continue?')){
      localStorage.removeItem(STORAGE_KEY); state = load(); toast('All data erased'); closeSheet(); render();
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
  if(gotoEl){ setTab(gotoEl.dataset.goto); return; }

  const txnEl = e.target.closest('[data-open-txn]');
  if(txnEl){ openTxnSheet(txnEl.dataset.openTxn); return; }

  const revealEl = e.target.closest('[data-reveal-acct]');
  if(revealEl){ ui.revealedAccounts[revealEl.dataset.revealAcct] = !ui.revealedAccounts[revealEl.dataset.revealAcct]; renderHome(); return; }

  const openAcctsEl = e.target.closest('[data-open-accounts]');
  if(openAcctsEl){ openSidebarSection('accounts'); return; }

  const addAcctEl = e.target.closest('[data-add-account]');
  if(addAcctEl){ addAccountSheet(); return; }
});

document.getElementById('menuBtn').onclick = openSidebarMenu;
document.getElementById('fab').onclick = openAdd;
document.querySelectorAll('.tabbtn').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));

/* ---------------- boot ---------------- */
setTab('home');

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
