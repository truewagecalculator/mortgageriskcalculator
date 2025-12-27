/* app.js — Mortgage Risk Calculator (static)
   IMPORTANT: This file does NOT inject tool HTML.
   The tool markup lives in index.html inside #toolApp.
*/

(() => {
  // -------------------------
  // Defaults (blank inputs UX)
  // -------------------------
  const DEFAULTS = {
    loanAmount: "",
    annualRatePct: "",
    termYears: "30",

    taxesMonthly: "",
    insuranceMonthly: "",
    hoaMonthly: "",

    netIncomeMonthly: "",
    otherExpensesMonthly: "",
    savings: "",

    incomeDropPct: "0",
    rateHikePct: "0",
    emergencyCost: "",
    monthsUnemployed: "1",
    expenseSpikeMonthly: "",

    mode: "balanced",
  };

  const $ = (id) => document.getElementById(id);

  function hasValue(id) {
    const el = $(id);
    return !!el && el.value !== "";
  }

  function numValue(id) {
    const el = $(id);
    if (!el) return 0;
    const v = el.value;
    return v === "" ? 0 : Number(v);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function money(n) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }

  function pct(n) {
    const v = Number.isFinite(n) ? n : 0;
    return `${(v * 100).toFixed(0)}%`;
  }

  // -------------------------
  // Core math
  // -------------------------
  function amortizedPaymentMonthly(L, annualRatePct, termYears) {
    if (L <= 0) return 0;

    const n = Math.max(1, Math.round(termYears * 12));
    const r = (annualRatePct / 100) / 12;

    if (r <= 0) return L / n;

    const pow = Math.pow(1 + r, n);
    return (L * (r * pow)) / (pow - 1);
  }

  function readState() {
    const termYears = Number($("termYears")?.value || "30");
    const monthsUnemployed = Math.max(1, Number($("monthsUnemployed")?.value || "1"));

    const modeRaw = $("mode")?.value || "balanced";
    const mode = modeRaw === "conservative" ? "conservative" : "balanced";

    return {
      loanAmount: numValue("loanAmount"),
      annualRatePct: numValue("annualRatePct"),
      termYears: Number.isFinite(termYears) && termYears > 0 ? termYears : 30,

      taxesMonthly: numValue("taxesMonthly"),
      insuranceMonthly: numValue("insuranceMonthly"),
      hoaMonthly: numValue("hoaMonthly"),

      netIncomeMonthly: numValue("netIncomeMonthly"),
      otherExpensesMonthly: numValue("otherExpensesMonthly"),
      savings: numValue("savings"),

      incomeDropPct: clamp(numValue("incomeDropPct"), 0, 100),
      rateHikePct: clamp(numValue("rateHikePct"), 0, 20),
      emergencyCost: numValue("emergencyCost"),
      monthsUnemployed,
      expenseSpikeMonthly: numValue("expenseSpikeMonthly"),

      mode,
    };
  }

  function computeBaseline(s) {
    const pAndI = amortizedPaymentMonthly(s.loanAmount, s.annualRatePct, s.termYears);
    const housingMonthly = pAndI + s.taxesMonthly + s.insuranceMonthly + s.hoaMonthly;
    const marginMonthly = s.netIncomeMonthly - housingMonthly - s.otherExpensesMonthly;

    return {
      ...s,
      pAndI,
      housingMonthly,
      marginMonthly,
    };
  }

  function computeStress(b, s) {
    const stressedRate = b.annualRatePct + s.rateHikePct;
    const pAndIStress = amortizedPaymentMonthly(b.loanAmount, stressedRate, b.termYears);

    const incomeAfterDrop = b.netIncomeMonthly * (1 - clamp(s.incomeDropPct, 0, 100) / 100);

    const housingMonthlyStress = pAndIStress + b.taxesMonthly + b.insuranceMonthly + b.hoaMonthly;
    const expensesStress = b.otherExpensesMonthly + Math.max(0, s.expenseSpikeMonthly);

    const marginMonthlyStress = incomeAfterDrop - housingMonthlyStress - expensesStress;

    const savingsAfterEmergency = Math.max(0, b.savings - Math.max(0, s.emergencyCost));

    let runwayMonths = null;
    if (marginMonthlyStress < 0) {
      const burn = Math.abs(marginMonthlyStress);
      runwayMonths = burn > 0 ? Math.floor(savingsAfterEmergency / burn) : null;
    }

    const cappedRunway =
      runwayMonths === null ? null : Math.min(runwayMonths, Math.max(1, s.monthsUnemployed));

    const housingToIncomeStress = incomeAfterDrop > 0 ? housingMonthlyStress / incomeAfterDrop : 0;

    return {
      annualRatePctStress: stressedRate,
      pAndIStress,
      netIncomeMonthlyStress: incomeAfterDrop,
      housingMonthlyStress,
      expensesMonthlyStress: expensesStress,
      marginMonthlyStress,
      savingsAfterEmergency,
      runwayMonths: cappedRunway,
      housingToIncomeStress,
    };
  }

  function computeBreakpoints(b, s) {
    // Rate breakpoint: find hike where margin flips negative (step search)
    let rateFlip = null;
    {
      const maxHike = 20;
      const step = 0.05;

      const baseIncome = b.netIncomeMonthly * (1 - clamp(s.incomeDropPct, 0, 100) / 100);
      const baseExpenses = b.otherExpensesMonthly + Math.max(0, s.expenseSpikeMonthly);
      const esc = b.taxesMonthly + b.insuranceMonthly + b.hoaMonthly;

      const p0 = amortizedPaymentMonthly(b.loanAmount, b.annualRatePct, b.termYears);
      const m0 = baseIncome - (p0 + esc) - baseExpenses;

      if (m0 < 0) {
        rateFlip = null;
      } else {
        for (let hike = 0; hike <= maxHike; hike += step) {
          const p = amortizedPaymentMonthly(b.loanAmount, b.annualRatePct + hike, b.termYears);
          const m = baseIncome - (p + esc) - baseExpenses;
          if (m < 0) {
            rateFlip = hike;
            break;
          }
        }
      }
    }

    // Income loss breakpoint: find drop where margin flips negative (step search)
    let incomeFlip = null; // as fraction (0..1)
    {
      const step = 0.5;
      const maxDrop = 90;

      const stressedRate = b.annualRatePct + clamp(s.rateHikePct, 0, 20);
      const p = amortizedPaymentMonthly(b.loanAmount, stressedRate, b.termYears);
      const housing = p + b.taxesMonthly + b.insuranceMonthly + b.hoaMonthly;
      const exp = b.otherExpensesMonthly + Math.max(0, s.expenseSpikeMonthly);

      const m0 = b.netIncomeMonthly - housing - exp;

      if (m0 < 0) {
        incomeFlip = null;
      } else {
        for (let drop = 0; drop <= maxDrop; drop += step) {
          const inc = b.netIncomeMonthly * (1 - drop / 100);
          const m = inc - housing - exp;
          if (m < 0) {
            incomeFlip = drop / 100;
            break;
          }
        }
      }
    }

    return {
      rateHikeFlipPct: rateFlip, // percent or null
      incomeLossFlipPct: incomeFlip, // fraction or null
    };
  }

  function computeScore(b, st, bp, mode) {
    const w =
      mode === "conservative"
        ? { runway: 0.4, margin: 0.25, pressure: 0.2, breakpoints: 0.15 }
        : { runway: 0.3, margin: 0.3, pressure: 0.2, breakpoints: 0.2 };

    // Runway score
    let runwayScore = 100;
    if (st.runwayMonths !== null) runwayScore = clamp((st.runwayMonths / 12) * 100, 0, 100);

    // Margin score normalized by income
    const denomIncome = Math.max(1, b.netIncomeMonthly);
    const marginRatio = st.marginMonthlyStress / denomIncome;
    const marginScore = clamp(((marginRatio + 0.25) / 0.5) * 100, 0, 100);

    // Housing pressure score
    const p = st.housingToIncomeStress;
    let pressureScore = 100;
    if (p > 0) pressureScore = clamp(100 - ((p - 0.25) / 0.3) * 100, 0, 100);

    // Breakpoint score
    let ratePart = 50;
    let incomePart = 50;

    if (bp.rateHikeFlipPct === null) ratePart = 0;
    else ratePart = clamp((bp.rateHikeFlipPct / 5) * 100, 0, 100);

    if (bp.incomeLossFlipPct === null) incomePart = 0;
    else incomePart = clamp(((bp.incomeLossFlipPct * 100) / 50) * 100, 0, 100);

    const bpScore = (ratePart + incomePart) / 2;

    const score =
      runwayScore * w.runway +
      marginScore * w.margin +
      pressureScore * w.pressure +
      bpScore * w.breakpoints;

    const rounded = Math.round(score);

    let label = "Good";
    if (rounded < 40) label = "High Risk";
    else if (rounded < 60) label = "Borderline";
    else if (rounded < 80) label = "Good";
    else label = "Strong";

    const explain =
      label === "Strong"
        ? "Strong buffer under stress with good runway and low sensitivity."
        : label === "Good"
        ? "Generally safe, but verify your most likely stress scenario."
        : label === "Borderline"
        ? "A small shock can flip your margin negative. Increase runway or reduce burn."
        : "High sensitivity to shocks. Reduce housing pressure or build a larger buffer.";

    return { score: rounded, label, explain };
  }

  // -------------------------
  // Defaults + wiring
  // -------------------------
  function applyDefaults() {
    Object.entries(DEFAULTS).forEach(([id, val]) => {
      const el = $(id);
      if (!el) return;
      el.value = String(val);
    });
  }

  function resetAll() {
    applyDefaults();

    const copyBtn = $("copyBtnTop");
    if (copyBtn) {
      copyBtn.textContent = "Copy Results";
      copyBtn.disabled = false;
    }

    render();
  }

  function wireInputs() {
    const ids = [
      "loanAmount",
      "annualRatePct",
      "termYears",
      "taxesMonthly",
      "insuranceMonthly",
      "hoaMonthly",
      "netIncomeMonthly",
      "otherExpensesMonthly",
      "savings",
      "incomeDropPct",
      "rateHikePct",
      "emergencyCost",
      "monthsUnemployed",
      "expenseSpikeMonthly",
      "mode",
    ];

    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", render);
      el.addEventListener("change", render);
    });

    const resetBtn = $("resetBtnTop");
    if (resetBtn) resetBtn.addEventListener("click", resetAll);

    const copyBtn = $("copyBtnTop");
    if (copyBtn) copyBtn.addEventListener("click", onCopyResults);
  }

  // -------------------------
  // Copy UX (human-readable + feedback)
  // -------------------------
  function showToast(text) {
    let el = $("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.style.position = "fixed";
      el.style.bottom = "18px";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.padding = "10px 14px";
      el.style.borderRadius = "12px";
      el.style.background = "rgba(0,0,0,.75)";
      el.style.border = "1px solid rgba(255,255,255,.15)";
      el.style.color = "rgba(255,255,255,.95)";
      el.style.fontSize = "13px";
      el.style.zIndex = "9999";
      el.style.boxShadow = "0 10px 30px rgba(0,0,0,.4)";
      el.style.opacity = "0";
      el.style.transition = "opacity .15s ease";
      document.body.appendChild(el);
    }

    el.textContent = text;
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 1600);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function buildReadableSummary(b, st, score, bp) {
    const lines = [];

    lines.push("Mortgage Risk Summary");
    lines.push("");
    lines.push(`Overall score: ${score.score} (${score.label})`);
    lines.push(score.explain);
    lines.push("");

    lines.push("Baseline:");
    lines.push(`• Loan: ${hasValue("loanAmount") ? money(b.loanAmount) : "—"}`);
    lines.push(`• Rate: ${hasValue("annualRatePct") ? b.annualRatePct.toFixed(2) + "%" : "—"}`);
    lines.push(`• Term: ${b.termYears} years`);
    lines.push(`• Monthly housing: ${money(b.housingMonthly)}`);
    lines.push(`• Monthly margin: ${money(b.marginMonthly)}`);
    lines.push("");

    lines.push("Stress scenario:");
    lines.push(`• Rate hike: +${Number(numValue("rateHikePct") || 0).toFixed(2)}%`);
    lines.push(`• Income drop: ${Number(numValue("incomeDropPct") || 0).toFixed(0)}%`);
    lines.push(`• Emergency cost: ${hasValue("emergencyCost") ? money(numValue("emergencyCost")) : "—"}`);
    lines.push(`• Expense spike: ${hasValue("expenseSpikeMonthly") ? money(numValue("expenseSpikeMonthly")) + "/mo" : "—"}`);
    lines.push(`• Stress margin: ${money(st.marginMonthlyStress)}`);
    lines.push(`• Runway: ${st.runwayMonths === null ? "Stable" : `${st.runwayMonths} months`}`);
    lines.push("");

    lines.push("Breakpoints:");
    lines.push(
      `• Rate increase that breaks budget: ${
        bp.rateHikeFlipPct === null ? "Already negative" : "+" + bp.rateHikeFlipPct.toFixed(2) + "%"
      }`
    );
    lines.push(
      `• Income loss that breaks budget: ${
        bp.incomeLossFlipPct === null ? "Already negative" : Math.round(bp.incomeLossFlipPct * 100) + "%"
      }`
    );

    lines.push("");
    lines.push("Generated by MortgageRiskCalculator.com");

    return lines.join("\n");
  }

  async function onCopyResults() {
    const copyBtn = $("copyBtnTop");
    if (!copyBtn) return;

    const hasAnyMeaningfulInput =
      hasValue("loanAmount") ||
      hasValue("annualRatePct") ||
      hasValue("netIncomeMonthly") ||
      hasValue("otherExpensesMonthly") ||
      hasValue("savings") ||
      hasValue("taxesMonthly") ||
      hasValue("insuranceMonthly") ||
      hasValue("hoaMonthly");

    if (!hasAnyMeaningfulInput) {
      showToast("Enter your numbers first, then copy results.");
      return;
    }

    const s = readState();
    const b = computeBaseline(s);
    const st = computeStress(b, s);
    const bp = computeBreakpoints(b, s);
    const sc = computeScore(b, st, bp, s.mode);

    const summary = buildReadableSummary(b, st, sc, bp);
    const ok = await copyToClipboard(summary);

    if (ok) {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied ✓";
      copyBtn.disabled = true;
      showToast("Copied. Paste into Notes, email, or a message.");

      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.disabled = false;
      }, 1800);
    } else {
      showToast("Copy failed. Try again or use HTTPS.");
    }
  }

  // -------------------------
  // Render outputs
  // -------------------------
  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function render() {
    const s = readState();

    const hasAnyMeaningfulInput =
      hasValue("loanAmount") ||
      hasValue("annualRatePct") ||
      hasValue("netIncomeMonthly") ||
      hasValue("otherExpensesMonthly") ||
      hasValue("savings") ||
      hasValue("taxesMonthly") ||
      hasValue("insuranceMonthly") ||
      hasValue("hoaMonthly");

    if (!hasAnyMeaningfulInput) {
      setText("score", "—");
      setText("scoreExplain", "Enter your numbers to begin.");
      setText("housingMonthly", "—");
      setText("baseMargin", "—");
      setText("stressMargin", "—");
      setText("runway", "—");
      setText("housingPressure", "—");
      setText("rateBreakpoint", "—");
      setText("incomeBreakpoint", "—");
      setText("savingsAfterEmergency", "—");
      setText("riskPill", "—");
      setText("meaningShort", "—");
      return;
    }

    const baseline = computeBaseline(s);
    const stress = computeStress(baseline, s);
    const bp = computeBreakpoints(baseline, s);
    const score = computeScore(baseline, stress, bp, s.mode);

    // Outputs
    setText("score", `${score.score}`);
    setText("scoreExplain", score.explain);

    setText("housingMonthly", money(baseline.housingMonthly));
    setText("baseMargin", money(baseline.marginMonthly));

    setText("stressMargin", money(stress.marginMonthlyStress));
    setText("runway", stress.runwayMonths === null ? "Stable" : `${stress.runwayMonths} mo`);

    setText(
      "housingPressure",
      stress.netIncomeMonthlyStress > 0 ? pct(stress.housingMonthlyStress / stress.netIncomeMonthlyStress) : "—"
    );

    setText(
      "rateBreakpoint",
      bp.rateHikeFlipPct === null ? "Already negative" : `+${bp.rateHikeFlipPct.toFixed(2)}%`
    );

    setText(
      "incomeBreakpoint",
      bp.incomeLossFlipPct === null ? "Already negative" : `${Math.round(bp.incomeLossFlipPct * 100)}%`
    );

    // Savings after emergency (blank-input friendly)
    const savingsEntered = hasValue("savings");
    const emergencyEntered = hasValue("emergencyCost");

    if (!savingsEntered) setText("savingsAfterEmergency", "—");
    else if (!emergencyEntered) setText("savingsAfterEmergency", money(baseline.savings));
    else setText("savingsAfterEmergency", money(stress.savingsAfterEmergency));

    // Pill + short meaning
    const pill = $("riskPill");
    if (pill) {
      pill.classList.remove("good", "warn", "bad");
      if (score.label === "Strong") pill.classList.add("good");
      else if (score.label === "Good") pill.classList.add("good");
      else if (score.label === "Borderline") pill.classList.add("warn");
      else pill.classList.add("bad");
      pill.textContent = score.label;
      pill.title = `Score: ${score.score}`;
    }

    const meaning =
      score.label === "Strong"
        ? "You have a meaningful buffer under your selected shock."
        : score.label === "Good"
        ? "You can likely absorb this shock, but tighten your assumptions."
        : score.label === "Borderline"
        ? "A small change can flip you negative—build runway or reduce burn."
        : "High sensitivity—reduce housing pressure or add a larger buffer.";

    setText("meaningShort", meaning);
  }

  // -------------------------
  // Boot
  // -------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const y = $("year");
    if (y) y.textContent = String(new Date().getFullYear());

    // Only boot tool if #toolApp exists
    if (!$("toolApp")) return;

    applyDefaults();
    wireInputs();
    wireMobileMenu();
    render();
  });
})();
