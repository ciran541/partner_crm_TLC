# 05 – Insurance Workflows

The core feature of the insurance app: a guided, per-case-type advisory workflow that captures a client's situation, computes the regulated financial numbers, and produces a client-facing PDF report.

## The concept

An insurance case (`cases` table) has a `case_type` — **Refinancing**, **Purchase**, **Decouple**, or **Equity Loan** — and each type has its own multi-step workflow: a sequence of questions an agent answers with the client (current loan, property type, incomes, preferences…). Answers are saved into the case's `workflow_data` JSONB column and drive live calculations shown as the agent types.

## The pieces and where they live

| Piece | File(s) |
|-------|---------|
| Workflow page (per case) | `app/insurance/dashboard/cases/[id]/workflow/page.tsx` |
| Step UIs | `components/insurance/workflow/` — `RefinancingWorkflow.tsx` etc., built on shared primitives in `WorkflowStep.tsx` |
| Typed answer shapes | `lib/types/workflow.ts` — `RefinancingWorkflow`, `PurchaseWorkflow`, `DecoupleWorkflow`, `EquityLoanWorkflow` interfaces + `getRefinancingWorkflow()`-style safe accessors + flag computation helpers |
| Calculation engines (pure) | `lib/insurance/refiCalc.ts`, `purchaseCalc.ts`, `decoupleCalc.ts` |
| Shared financial core (pure) | `lib/insurance/stampDuty.ts`, `loanCalc.ts` (see below) |
| Remarks builders | `refiRemarks.ts`, `purchaseRemarks.ts` — turn computed flags into client-appropriate wording |
| Report HTML builders | `refiPresentation.ts`, `purchasePresentation.ts`, `decouplePresentation.ts`, `equityLoanReport.ts`, on shared `presentationShell.ts` |
| PDF + email | `POST /api/insurance/cases/[id]/send-report` → `lib/email/generatePdf.ts` (headless Chromium) → `lib/email/sendWorkflowReport.ts` (Resend) |

**Data flow:** UI step components ↔ `workflow_data` (auto-saved with an 800 ms debounce on every change) → `inputsFromWorkflow()` adapters → pure `compute*()` engines → results rendered live in the UI, and on demand into a PDF report emailed to the client.

> **Why the engines are "pure" (no database, no network):** a function that just maps inputs → numbers can be unit-tested exhaustively and reused anywhere (workflow UI, send-report route, calculators). All the messy I/O stays in routes and components.

## The shared financial core — one implementation per regulated number

These numbers go in front of real clients, so each lives in exactly **one** module. Never re-implement them locally:

- **`stampDuty.ts`** — BSD tiers (`BSD_TIERS`, `calculateBSD`, `computeBsdBreakdown`) and ABSD (`absdRate`, `worstResidency`). The purchase/decoupling engines *and* the standalone stamp-duty calculator all derive from it.
- **`loanCalc.ts`** — annuity/TDSR/MSR math, `incomeWeightedAge()` (the single IWAA implementation; per-engine wrappers declare their rounding and zero-income semantics via options), and cross-engine constants (`CANCELLATION_FEE_RATE`, `MIN_TENURE`, `DEFAULT_REFERENCE_RATE`).

**Tests:** `lib/insurance/__tests__/financialCore.test.ts` pins BSD/ABSD tier boundaries and wrapper semantics. When IRAS/MAS rates change, update the module and its tests together, then `npm test`. Run tests after touching any of: `*Calc.ts`, `stampDuty.ts`, `loanCalc.ts`, `rateRecommend.ts`.

## Conditional display rules (product decisions, apply consistently)

- Cancellation fee is shown **only when undisbursed amount > 0**.
- Subsidy clawback is shown **only when the clawback amount > 0**.
- **Propagation rule:** an improvement made to one workflow must be applied to *all* workflows where it's applicable. Workflows are siblings, not forks.

## Pipeline stages and closure

Cases move through pipeline stages (`stage` column; pipeline board at `/insurance/dashboard/pipeline`). Two stages are special:

- **Closed Won** and **Closed Lost** cannot be set directly — the case detail page intercepts them with modals requiring closure data (package details, rates, commission info → `closed_won_data` JSONB; or a loss reason → `closed_lost_reason`/`closed_lost_notes`). A closed case without closure data would be useless for the earnings/analytics views built on it (`lib/insurance/closedWon.ts`, `commission.ts`, earnings pages).

Each case also carries follow-up dates (with optional Google Calendar sync via `lib/google/syncFollowUpInsurance.ts`) and an activity log (`insurance_case_activity_logs`).

## Standalone calculators

`/insurance/dashboard/calculators/*` (affordability, amortization, BUC progressive payments, partial repayment, stamp duty, TDSR) are thin pages over the same `lib/insurance/` engines — `amortCalc.ts`, `partialRepaymentCalc.ts`, `stampDuty.ts`, `loanCalc.ts`. Same numbers as the workflows, guaranteed, because it's the same code.

## Adding a question to a workflow (worked recipe)

1. Add the field to the right interface in `lib/types/workflow.ts` (optional, since old cases won't have it).
2. Add the input to the step component in `components/insurance/workflow/` — auto-save handles persistence.
3. If it affects math: thread it through `inputsFromWorkflow()` into the engine, extend the engine, **add a test**.
4. If it affects the report: extend the `*Presentation.ts` builder (and remarks if wording depends on it).
5. Check the propagation rule — does this belong in the other workflows too?

No database migration needed — that's the payoff of the JSONB design ([03 – Database](03-database.md), decision 3).
