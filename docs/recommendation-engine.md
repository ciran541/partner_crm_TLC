# How the Mortgage Package Recommendation Works

*A plain-language guide for agents and management. No technical background needed.*

---

## 1. What it is — and what it is not

When an agent reaches **Step 4** of a refinancing case, the system shows a short, ranked list of mortgage packages with the monthly savings already worked out for **that specific client**.

- ✅ It is a **decision-support tool** — it does the maths and surfaces the best-fit options so the agent doesn't have to dig through a rate sheet.
- ✅ It only ever uses **our own rate data** (the packages an admin loaded) plus the **official daily SORA** from MAS. It does **not** guess or invent rates.
- ❌ It is **not** an auto-pilot. The agent always reviews and chooses. The system ranks; the human decides.

Think of it as a **calculator with a sorting brain**, not a black box.

---

## 2. Where the numbers come from (the inputs)

The recommendation is only as good as what was entered earlier in the case. It uses:

| From | What it uses |
|---|---|
| **Step 1 — Qualify** | Outstanding loan, remaining tenure, current interest rate, lock-in status |
| **Step 2 — Fact Find** | Property type, income, existing debts, subsidy/clawback |
| **Step 3 — Risk & Suitability** | Rate preference (fixed/floating), holding period, payment sensitivity, selling plans |
| **Live SORA** | Today's 1-month and 3-month SORA, pulled automatically from MAS each day |
| **Rate packages** | The bank packages an admin has loaded and published |

> **Key point for checking accuracy:** if a recommendation looks wrong, the first thing to check is whether Steps 1–3 were filled in correctly. Wrong input → wrong output.

---

## 3. How a package gets recommended — three stages

### Stage A — Filtering (who even qualifies)
This uses the **exact same logic as the standalone Rates page**, fed automatically from the case instead of typed in by hand. A package is **removed from consideration** unless it passes *all* of these:

1. **Loan size (tiered)** — the client's loan must clear the package's minimum, and where a bank offers the same package at several loan tiers, only the **best (highest) tier the client qualifies for** is shown — not every redundant lower tier. Packages whose minimum is **up to 10% above** the loan are still shown, tagged **"Appeal"** (the bank may approve on appeal), and ranked below the strict matches.
2. **Priority / privilege banking** — if the client holds priority status with a bank (captured in the workflow), that bank's lower minimum-loan threshold is applied.
3. **Current bank excluded** — the client's existing bank is hidden (refinancing moves to a new bank).
4. **Property type** — matches the client's (HDB / Private / EC), including the completed-vs-under-construction distinction.
5. **Rate type** — the panel offers the same pills as the Rates page: specific Fixed lock-ins (1Y / 2Y / 3Y / 5Y) and Floating. They start pre-set from the client's saved fixed/floating preference and the agent can refine live. Packages for properties *under construction* (BUC) are property-driven, not a manual pill.
6. **Features** (optional) — Waiver Due to Sale, Partial Repayment, Free Conversion: toggling one keeps only packages that offer it.

### Stage B — Working out the real numbers
For each package that survives the filter, the system calculates:

- **The actual rate for each year.** Fixed years use the stated rate. Floating years are worked out as **SORA + the bank's spread** using today's SORA. (For a "1M/3M SORA" package, it uses the **lower** of the two — the better figure for the client.)
- **The monthly instalment** for each year (recalculated as the rate steps change, the way banks do).
- **The savings** versus the client's current rate — monthly, and the net saving over 2 and 3 years **after** subtracting any clawback or lock-in penalty.
- **Affordability (TDSR)** — whether the repayment stays within the 55% income limit. Over the limit gets flagged.

### Stage C — Ranking (best first)
The surviving packages are ordered by this priority:

1. Packages we can fully price (have all the data).
2. **No serious mismatch** — a package that clashes with the client's situation is pushed down even if it's cheap (see the fit rules below).
3. **Biggest monthly saving** — money is the lead factor among suitable options.
4. **Best fit score** — breaks near-ties.
5. Lowest rate during the lock-in.

The top result gets the **"BEST"** label.

---

## 4. The "fit" rules (why one package suits a client better)

Beyond price, the system reads the Step 3 answers and adds plain-English tags (✓ good / ⚠ watch) to each package:

| What the client said | How it affects the recommendation |
|---|---|
| **Plans to sell / short holding period** | A **no-lock-in** package is rewarded. A **long (3-year) lock-in is treated as a serious mismatch** and pushed down — because they'd pay a penalty if they sell during it. |
| **Sensitive to payment changes** | Packages that stay **fixed through the lock-in** (predictable payments) are rewarded; ones that turn floating mid-lock-in are flagged. |
| **Long holding period** | The **reversion rate** (the rate *after* the lock-in ends — the "Thereafter" rate) is weighed more heavily, because that's the rate they'll actually live on. A low one is rewarded, a high one flagged. |
| **Subsidy / rebate available** | A small plus, with a tag — useful when two options are close. |

Every tag is shown on the card, so the agent sees the reasoning, not just the order.

---

## 5. A worked example

**Client:** $800,000 loan, 25 years left, currently paying 3.20%, private condo, **prefers fixed**, **planning to sell in about a year**. Today's 3M SORA = ~1.06%.

Three packages qualify:

| Package | Rate | Lock-in | Monthly saving vs 3.20% |
|---|---|---|---|
| **A** — 2Y Fixed @ 1.70% | 1.70% | **3 years** | ~$640/mo (cheapest) |
| **B** — 2Y Fixed @ 1.80% | 1.80% | **No lock-in** | ~$600/mo |
| **C** — Floating 3M SORA + 0.30% | ~1.36% | 2 years | — (filtered out: client wants *fixed*) |

**What the system does:**
- C is **removed** — the client asked for fixed.
- A is **cheapest**, but it has a **3-year lock-in and the client is selling in a year** → that's a serious mismatch → A is **pushed below B** and tagged **"⚠ 3Y lock-in — penalty risk if they sell soon."**
- **B is recommended #1**, tagged **"✓ No lock-in — flexible if selling early."**

So the system recommends the option that's $40/month *more expensive* — because the cheaper one would likely cost the client a penalty they'd pay on selling. **That's the judgment a good broker would make, applied automatically.** The agent still sees A and can choose it if circumstances change.

---

## 6. How fresh and reliable the data is

- **Rates** are whatever an admin last loaded and published. Each package shows a "last updated" date. Banks change rates often, so keeping these current is the admin's job (the "Import from sheet" tool makes that fast).
- **SORA** is fetched from MAS automatically every day; the Rates page shows the "as of" date. Floating-rate figures are estimates based on that day's SORA.
- **The proposal is frozen.** When an agent picks a package for a client, a snapshot of its rates is saved to the case. If an admin updates that package's rates next week, the client's existing proposal does **not** silently change.

---

## 7. What it does **not** do yet (so expectations are clear)

- Among genuinely suitable packages, it leads with **price** — fit reorders at the margins and removes clear mismatches, but it won't pick a much pricier package just because it fits slightly better.
- **Subsidy value is a soft plus, not a dollar figure** — bank subsidy text isn't a clean number in our data, so it isn't added to the savings total (only flagged).
- It uses the **categorical** Step 3 answers (e.g. "short / medium / long"), not an exact sell date.
- **Legal-fee rebates and reversion rates are not yet added into the dollar savings** — they influence the fit tags, not the headline saving figure.

None of these make the maths wrong — they're the next refinements if we want the ranking even sharper.

---

## 8. How to check a recommendation is right

For an agent or manager who wants to verify a result:

1. **Check the inputs** — open Steps 1–3 and confirm loan, tenure, current rate, property type, and preferences are correct. Most surprises come from a wrong input.
2. **Read the tags** — the ✓/⚠ tags explain *why* each package ranked where it did.
3. **Check the SORA date** — on the Rates page, confirm SORA is recent (hit "Refresh SORA" if needed); floating estimates depend on it.
4. **Cross-check the rate** — the package's real rate is shown both on the Rates page (`3M SORA + 0.35% → 1.41%`) and in Step 4; they should match.
5. **The agent always confirms** — nothing is sent to a client automatically.

---

*In one sentence: the system filters packages the client qualifies for, works out the real rate and savings using today's SORA, ranks them by savings while respecting the client's situation, and shows its reasoning — but the agent always makes the final call.*
