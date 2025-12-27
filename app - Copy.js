// Tool loads ONLY on index.html (where #toolApp exists)

const PRESETS = [
  { id:"laid_off_4mo", title:"Laid off (4 months)", patch:{ monthsUnemployed:4, incomeDropPct:60, emergencyCost:1500, rateHikePct:0, expenseSpikeMonthly:0 } },
  { id:"partner_income_gone", title:"Partner income gone", patch:{ monthsUnemployed:6, incomeDropPct:50, emergencyCost:0, rateHikePct:0, expenseSpikeMonthly:0 } },
  { id:"escrow_shock", title:"Escrow shock (+$300/mo)", patch:{ expenseSpikeMonthly:300 } },
  { id:"hvac_9000", title:"HVAC ($9,000)", patch:{ emergencyCost:9000 } },
  { id:"rate_hike_2", title:"Rates +2%", patch:{ rateHikePct:2.0 } },
];

const DEFAULTS = {
  loanAmount: 350000,
  annualRatePct: 6.75,
  termYears: 30,
  taxesMonthly: 450,
  insuranceMonthly: 180,
  hoaMonthly: 0,
  netIncomeMonthly: 6500,
  otherExpensesMonthly: 2600,
  savings: 15000,
  incomeDropPct: 50,
  rateHikePct: 2.0,
  emergencyCost: 7500,
  monthsUnemployed: 4,
  expenseSpikeMonthly: 0,
  mode: "balanced",
};

const $ = (id) => document.getElementById(id);

function money(n){
  if(!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0});
}

function amortizedPaymentMonthly(L, annualRatePct, termYears){
  const r = (annualRatePct/100)/12;
  const n = Math.max(1, Math.round(termYears*12));
  if(r<=0) return L/n;
  const pow = Math.pow(1+r,n);
  return L * (r*pow)/(pow-1);
}

function computeBaseline(s){
  const piMonthly = amortizedPaymentMonthly(s.loanAmount, s.annualRatePct, s.termYears);
  const housingMonthly = piMonthly + s.taxesMonthly + s.insuranceMonthly + s.hoaMonthly;
  const marginMonthly = s.netIncomeMonthly - (housingMonthly + s.otherExpensesMonthly);
  return { ...s, piMonthly, housingMonthly, marginMonthly };
}

function computeStress(b, sc){
  const annualRatePctStress = b.annualRatePct + sc.rateHikePct;
  const piMonthlyStress = amortizedPaymentMonthly(b.loanAmount, annualRatePctStress, b.termYears);
  const housingMonthlyStress = piMonthlyStress + b.taxesMonthly + b.insuranceMonthly + b.hoaMonthly;

  const incomeDrop = sc.incomeDropPct/100;
  const netIncomeMonthlyStress = Math.max(0, b.netIncomeMonthly * (1 - incomeDrop));
  const otherExpensesMonthlyStress = Math.max(0, b.otherExpensesMonthly + sc.expenseSpikeMonthly);

  const marginMonthlyStress = netIncomeMonthlyStress - (housingMonthlyStress + otherExpensesMonthlyStress);
  const savingsAfterEmergency = Math.max(0, b.savings - Math.max(0, sc.emergencyCost));

  const runwayMonths = marginMonthlyStress >= 0 ? null : Math.floor(savingsAfterEmergency / Math.max(1, Math.abs(marginMonthlyStress)));

  return { annualRatePctStress, piMonthlyStress, housingMonthlyStress, netIncomeMonthlyStress, otherExpensesMonthlyStress, marginMonthlyStress, savingsAfterEmergency, runwayMonths };
}

function findBreakpoints(b, expenseSpikeMonthly){
  const baseOther = b.otherExpensesMonthly + expenseSpikeMonthly;

  const marginAt = (annualRatePct, incomeLossPct01) => {
    const pi = amortizedPaymentMonthly(b.loanAmount, annualRatePct, b.termYears);
    const housing = pi + b.taxesMonthly + b.insuranceMonthly + b.hoaMonthly;
    const income = Math.max(0, b.netIncomeMonthly * (1 - incomeLossPct01));
    return income - (housing + baseOther);
  };

  const baseMargin = marginAt(b.annualRatePct, 0);
  const alreadyNegative = baseMargin < 0;

  let rateHikeFlipPct = null;
  if(!alreadyNegative){
    for(let hike=0; hike<=6; hike+=0.05){
      if(marginAt(b.annualRatePct + hike, 0) < 0){ rateHikeFlipPct = Number(hike.toFixed(2)); break; }
    }
  }

  let incomeLossFlipPct = null;
  if(!alreadyNegative){
    for(let loss=0; loss<=0.95; loss+=0.01){
      if(marginAt(b.annualRatePct, loss) < 0){ incomeLossFlipPct = Number(loss.toFixed(2)); break; }
    }
  }

  return { rateHikeFlipPct, incomeLossFlipPct };
}

function computeScore(b, st, mode){
  const housingToIncomeStress = st.housingMonthlyStress / Math.max(1, st.netIncomeMonthlyStress);
  const runway = st.runwayMonths === null ? 24 : st.runwayMonths;
  const runwayNorm = Math.min(1, runway/12);

  const pressure = Math.min(2, housingToIncomeStress);
  const pressureNorm = 1 - Math.min(1, (pressure - 0.25)/0.75);

  const marginNorm = st.marginMonthlyStress >= 0 ? 1 : Math.max(0, 1 - Math.min(1, Math.abs(st.marginMonthlyStress)/1500));

  const wRunway = mode === "conservative" ? 0.5 : 0.4;
  const wPressure = mode === "conservative" ? 0.3 : 0.35;
  const wMargin = mode === "conservative" ? 0.2 : 0.25;

  const score = Math.round((wRunway*runwayNorm + wPressure*pressureNorm + wMargin*marginNorm)*100);

  let label="Risky";
  let explain="Your plan breaks quickly under stress. Focus on increasing runway and lowering monthly burn.";
  if(score>=75){ label="Resilient"; explain="You have solid runway and manageable payment pressure even under stress scenarios."; }
  else if(score>=50){ label="Borderline"; explain="You can survive some hits, but a bigger rate jump or income shock may break the budget."; }

  const baseHTI = b.housingMonthly / Math.max(1, b.netIncomeMonthly);
  const note = baseHTI > 0.35 ? "Baseline housing-to-income is high, so you’re starting near the edge." : "Baseline looks reasonable, but stress scenarios still matter.";

  return { score, label, explain: `${explain} ${note}` };
}

function suggestActions(b, st){
  const actions=[];
  const burn = st.marginMonthlyStress < 0 ? Math.abs(st.marginMonthlyStress) : 0;

  if(st.runwayMonths !== null && st.runwayMonths < 3){
    actions.push({ title:"Increase runway fast", body:`You’re burning about ${money(burn)}/mo under stress. Push runway above 6 months with savings + expense cuts.` });
  } else if(st.runwayMonths !== null && st.runwayMonths < 6){
    actions.push({ title:"Target 6-month resilience", body:`Aim for ~6 months runway. Small monthly reductions extend survival quickly.` });
  } else {
    actions.push({ title:"Maintain the buffer", body:`You’re relatively stable under this scenario. Protect savings and avoid lifestyle creep.` });
  }

  const htiStress = st.housingMonthlyStress / Math.max(1, st.netIncomeMonthlyStress);
  if(htiStress > 0.45){
    actions.push({ title:"Lower payment pressure", body:"Housing consumes a big share of stressed income. Consider principal strategy, refi plan, or downsizing options." });
  } else {
    actions.push({ title:"Protect income", body:"Income continuity is your best lever: keep a job-search plan and preserve cash flexibility." });
  }

  if(b.savings < b.housingMonthly * 3){
    actions.push({ title:"Build a homeowner emergency fund", body:"Consider 3–6 months of total spending plus a repair buffer for deductible/HVAC surprises." });
  } else {
    actions.push({ title:"Split savings", body:"Separate runway savings from a repair buffer to avoid draining core emergency funds." });
  }

  return actions;
}

function toolMarkup(){
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Inputs</div>
          <div class="card-sub">Baseline numbers</div>
        </div>
        <div class="pill" id="pill">—</div>
      </div>
      <div class="card-body">
        <div class="row two">
          <div>
            <label>Loan amount</label>
            <input id="loanAmount" type="number" inputmode="numeric" />
          </div>
          <div>
            <label>Rate (%)</label>
            <input id="annualRatePct" type="number" step="0.01" inputmode="decimal" />
          </div>
        </div>

        <div class="row two">
          <div>
            <label>Term (years)</label>
            <input id="termYears" type="number" inputmode="numeric" />
          </div>
          <div>
            <label>Score mode</label>
            <select id="mode">
              <option value="balanced">Balanced</option>
              <option value="conservative">Conservative</option>
            </select>
          </div>
        </div>

        <div class="row three">
          <div><label>Taxes / mo</label><input id="taxesMonthly" type="number" /></div>
          <div><label>Insurance / mo</label><input id="insuranceMonthly" type="number" /></div>
          <div><label>HOA / mo</label><input id="hoaMonthly" type="number" /></div>
        </div>

        <div class="row two">
          <div><label>Net income / mo</label><input id="netIncomeMonthly" type="number" /></div>
          <div><label>Other expenses / mo</label><input id="otherExpensesMonthly" type="number" /></div>
        </div>

        <div>
          <label>Liquid savings</label>
          <input id="savings" type="number" />
        </div>

        <div class="box">
          <div class="kv">
            <div>P&I payment</div><div class="v" id="basePI">—</div>
            <div>Total housing</div><div class="v" id="baseHousing">—</div>
            <div>Monthly margin</div><div class="v" id="baseMargin">—</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Stress scenario</div>
          <div class="card-sub">Life punches</div>
        </div>
      </div>

      <div class="card-body">
        <div class="box">
          <label>Presets</label>
          <div id="presets" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        </div>

        <div class="box">
          <div class="kv" style="margin-bottom:10px;">
            <div>Income drop</div><div class="v" id="incomeDropLabel">—</div>
          </div>
          <input id="incomeDropPct" type="range" min="0" max="100" value="50" />
        </div>

        <div class="box">
          <div class="kv" style="margin-bottom:10px;">
            <div>Rate hike</div><div class="v" id="rateHikeLabel">—</div>
          </div>
          <input id="rateHikePct" type="range" min="0" max="5" step="0.05" value="2" />
        </div>

        <div class="row two">
          <div>
            <label>Emergency event (one-time)</label>
            <input id="emergencyCost" type="number" />
          </div>
          <div>
            <label>Months unemployed</label>
            <input id="monthsUnemployed" type="number" min="1" max="12" />
          </div>
        </div>

        <div>
          <label>Expense spike / mo</label>
          <input id="expenseSpikeMonthly" type="number" />
        </div>

        <div class="box">
          <div class="kv">
            <div>Stress housing</div><div class="v" id="stressHousing">—</div>
            <div>Stress margin</div><div class="v" id="stressMargin">—</div>
            <div>Runway</div><div class="v" id="stressRunway">—</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Results</div>
          <div class="card-sub">Breakpoints + actions</div>
        </div>
      </div>

      <div class="card-body">
        <div class="box">
          <div class="big-score">
            <div>
              <div class="muted">Stress Score</div>
              <div class="num" id="score">—</div>
            </div>
            <div class="txt" id="scoreExplain">—</div>
          </div>
        </div>

        <div class="box">
          <div class="kv">
            <div>Runway (months)</div><div class="v" id="runway">—</div>
            <div>Savings after emergency</div><div class="v" id="savingsAfterEmergency">—</div>
          </div>
        </div>

        <div class="box">
          <div class="kv">
            <div>Rate hike breakpoint</div><div class="v" id="bpRate">—</div>
            <div>Income loss breakpoint</div><div class="v" id="bpIncome">—</div>
          </div>
        </div>

        <div class="box">
          <div class="card-title" style="margin-bottom:8px;">Top actions</div>
          <ol id="actions" class="actions"></ol>
        </div>
      </div>
    </section>
  `;
}

function setDefaults(){
  $("loanAmount").value = DEFAULTS.loanAmount;
  $("annualRatePct").value = DEFAULTS.annualRatePct;
  $("termYears").value = DEFAULTS.termYears;
  $("taxesMonthly").value = DEFAULTS.taxesMonthly;
  $("insuranceMonthly").value = DEFAULTS.insuranceMonthly;
  $("hoaMonthly").value = DEFAULTS.hoaMonthly;
  $("netIncomeMonthly").value = DEFAULTS.netIncomeMonthly;
  $("otherExpensesMonthly").value = DEFAULTS.otherExpensesMonthly;
  $("savings").value = DEFAULTS.savings;
  $("incomeDropPct").value = DEFAULTS.incomeDropPct;
  $("rateHikePct").value = DEFAULTS.rateHikePct;
  $("emergencyCost").value = DEFAULTS.emergencyCost;
  $("monthsUnemployed").value = DEFAULTS.monthsUnemployed;
  $("expenseSpikeMonthly").value = DEFAULTS.expenseSpikeMonthly;
  $("mode").value = DEFAULTS.mode;
}

function readState(){
  return {
    loanAmount: Number($("loanAmount").value || 0),
    annualRatePct: Number($("annualRatePct").value || 0),
    termYears: Number($("termYears").value || 0),
    taxesMonthly: Number($("taxesMonthly").value || 0),
    insuranceMonthly: Number($("insuranceMonthly").value || 0),
    hoaMonthly: Number($("hoaMonthly").value || 0),
    netIncomeMonthly: Number($("netIncomeMonthly").value || 0),
    otherExpensesMonthly: Number($("otherExpensesMonthly").value || 0),
    savings: Number($("savings").value || 0),
    incomeDropPct: Number($("incomeDropPct").value || 0),
    rateHikePct: Number($("rateHikePct").value || 0),
    emergencyCost: Number($("emergencyCost").value || 0),
    monthsUnemployed: Math.min(12, Math.max(1, Number($("monthsUnemployed").value || 1))),
    expenseSpikeMonthly: Number($("expenseSpikeMonthly").value || 0),
    mode: $("mode").value === "conservative" ? "conservative" : "balanced",
  };
}

function mountPresets(){
  const wrap = $("presets");
  wrap.innerHTML = "";
  PRESETS.forEach(p=>{
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.padding = "8px 10px";
    btn.style.borderRadius = "999px";
    btn.textContent = p.title;
    btn.onclick = ()=>{
      Object.entries(p.patch).forEach(([k,v])=>{
        const el = $(k);
        if(el) el.value = String(v);
      });
      render();
    };
    wrap.appendChild(btn);
  });
}

function render(){
  $("year").textContent = new Date().getFullYear();

  const s = readState();
  $("incomeDropLabel").textContent = `${Math.round(s.incomeDropPct)}%`;
  $("rateHikeLabel").textContent = `+${Number(s.rateHikePct).toFixed(2)}%`;

  const baseline = computeBaseline(s);
  $("basePI").textContent = money(baseline.piMonthly);
  $("baseHousing").textContent = money(baseline.housingMonthly);
  $("baseMargin").textContent = money(baseline.marginMonthly);

  const stress = computeStress(baseline, s);
  $("stressHousing").textContent = money(stress.housingMonthlyStress);
  $("stressMargin").textContent = money(stress.marginMonthlyStress);
  $("stressRunway").textContent = stress.runwayMonths === null ? "Stable" : `${stress.runwayMonths} mo`;

  const score = computeScore(baseline, stress, s.mode);
  $("score").textContent = String(score.score);
  $("scoreExplain").textContent = score.explain;

  const pill = $("pill");
  pill.textContent = score.label;
  pill.className = "pill " + (score.score >= 75 ? "good" : score.score >= 50 ? "warn" : "bad");

  $("runway").textContent = stress.runwayMonths === null ? "Stable" : String(stress.runwayMonths);
  $("savingsAfterEmergency").textContent = money(stress.savingsAfterEmergency);

  const bp = findBreakpoints(baseline, s.expenseSpikeMonthly);
  $("bpRate").textContent = bp.rateHikeFlipPct === null ? "Already negative" : `+${bp.rateHikeFlipPct.toFixed(2)}%`;
  $("bpIncome").textContent = bp.incomeLossFlipPct === null ? "Already negative" : `${Math.round(bp.incomeLossFlipPct * 100)}%`;

  const actions = suggestActions(baseline, stress).slice(0,3);
  const ol = $("actions");
  ol.innerHTML = "";
  actions.forEach(a=>{
    const li = document.createElement("li");
    li.innerHTML = `<strong>${a.title}:</strong> ${a.body}`;
    ol.appendChild(li);
  });

  // top buttons (optional)
  const copyTop = $("copyBtnTop");
  if(copyTop){
    copyTop.onclick = async ()=>{
      const payload = { baseline, stress, score, breakpoints: bp };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      copyTop.textContent = "Copied";
      setTimeout(()=> copyTop.textContent = "Copy Results", 900);
    };
  }
}

function wire(){
  const ids = [
    "loanAmount","annualRatePct","termYears",
    "taxesMonthly","insuranceMonthly","hoaMonthly",
    "netIncomeMonthly","otherExpensesMonthly","savings",
    "incomeDropPct","rateHikePct","emergencyCost","monthsUnemployed","expenseSpikeMonthly",
    "mode"
  ];
  ids.forEach(id => $(id).addEventListener("input", render));
  $("mode").addEventListener("change", render);

  const resetTop = $("resetBtnTop");
  if(resetTop){
    resetTop.addEventListener("click", ()=>{ setDefaults(); render(); });
  }
}

(function init(){
  const mount = document.getElementById("toolApp");
  if(!mount){
    // SEO page: just set year and exit
    const y = document.getElementById("year");
    if(y) y.textContent = new Date().getFullYear();
    return;
  }

  mount.innerHTML = toolMarkup();

  setDefaults();
  mountPresets();
  wire();
  render();

// ===============================
// Mobile Dropdown Menu
// ===============================
    (function setupMobileDropdown(){
      const header = document.querySelector(".site-header");
      const btn = document.querySelector(".nav-toggle");
      const menu = document.getElementById("mobileMenu");

      if (!header || !btn || !menu) return;

      const open = () => {
        header.classList.add("nav-open");
        btn.setAttribute("aria-expanded", "true");
        menu.scrollTop = 0;
      };

      const close = () => {
        header.classList.remove("nav-open");
        btn.setAttribute("aria-expanded", "false");
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        header.classList.contains("nav-open") ? close() : open();
      });

      // Close after clicking a link
      menu.querySelectorAll("a").forEach(a => a.addEventListener("click", close));

      // Close if you click outside
      document.addEventListener("click", (e) => {
        if (!header.contains(e.target)) close();
      });

      // Close on ESC
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
  })();
})();
