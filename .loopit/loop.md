---
loopit: 1
revision: 3
status: draft
completion-policy: continuous
start: plan-experiment
---

# Improve visual evidence use in VLMs

## Objective

Develop and validate methods that make vision-language models use task-relevant visual evidence when that evidence is sufficient for the answer. Demonstrate progress with controlled evaluations that distinguish visual perception failures, cross-modal integration failures, and answer-generation failures from reliance on language priors.

## Starting Package

### Hypothesis status

**ID:** `current-findings`
**Role:** `state`
**Description:** Specific claims about why VLMs fail to use sufficient visual evidence, each labeled by its current evidence status.

#### Initial Contents

- `Reported, not reproduced` — the current VLM often answers incorrectly even when the image appears to contain sufficient evidence.
- `H1 — Weak visual sensitivity · untested` — answers are less sensitive to image masking and counterfactual image edits than they should be, indicating reliance on language priors.
- `H2 — Perception bottleneck · untested` — failures that recover under an oracle textual description are primarily visual perception failures.
- `H3 — Answer-generation bottleneck · untested` — failures that persist with an oracle textual description are primarily answer-generation or task-reasoning failures rather than visual perception failures.
- `H4 — Cross-modal integration · untested` — cases where the model extracts the relevant visual content but does not change its answer under counterfactual edits indicate a cross-modal integration failure.
- `H5 — Evidence-first prompting · untested` — requiring an explicit visual-evidence extraction step before answering improves counterfactual consistency without materially reducing intact-image accuracy.

### Hypotheses to test

**ID:** `research-questions`
**Role:** `frontier`
**Description:** The initial ranked list of testable hypotheses about perception, cross-modal integration, answer generation, and language-prior reliance.

#### Initial Contents

- `H1 — Weak visual sensitivity`: masking or counterfactually changing answer-relevant image evidence will change the model's answer less often than expected from the task labels.
- `H2 — Perception bottleneck`: oracle text describing the relevant image evidence will recover a substantial fraction of intact-image failures.
- `H3 — Answer-generation bottleneck`: a meaningful fraction of failures will persist even with correct oracle text, showing that perception alone is insufficient.
- `H4 — Cross-modal integration bottleneck`: on some examples the model can report the relevant visual content when asked directly but fails to use it in the final task answer.
- `H5 — Evidence-first prompting`: extracting relevant visual evidence before answering will increase counterfactual answer consistency while preserving most intact-image accuracy.

### Experiment setup

**ID:** `experiment-setup`
**Role:** `foundation`
**Description:** A fully specified minimal VLM experiment that can be run before expanding model, data, or compute scope.

#### Initial Contents

- `Model` — use `Qwen/Qwen2.5-VL-3B-Instruct` initially; reserve the 7B checkpoint for replication only after the minimal test is informative and compute permits it.
- `Environment` — use Python 3.11 with PyTorch, Transformers, Pillow, and Datasets in an isolated environment; lock package versions and record the exact model revision.
- `Diagnostic set` — human-check 40 examples: 20 TextVQA and 20 ChartQA items whose answers are visibly recoverable, subject to dataset availability and license terms.
- `Conditions` — run intact image, answer-relevant region masked, controlled counterfactual edit where feasible, and oracle text with the same question; use temperature 0 and a 64-token output limit.
- `Metrics` — report normalized accuracy, intact-to-masked accuracy drop, counterfactual answer-flip accuracy, and oracle-text recovery separately for TextVQA and ChartQA.
- `Baseline` — use direct question answering with no evidence-extraction instruction; test an evidence-first prompt only after the baseline.
- `Minimal budget` — run 160 baseline inferences (40 examples × 4 conditions), no training, then test the evidence-first prompt on the same examples only if weak visual sensitivity is reproduced.
- `Experiment record` — preserve example IDs, transformed images, prompts, raw outputs, normalized answers, metrics, analysis code, checkpoint revision, hardware, and seeds.

### Test H1 on Qwen2.5-VL-3B

**ID:** `baseline-reliance-test`
**Role:** `first-work`
**Description:** The first experiment tests whether Qwen2.5-VL-3B answers respond appropriately when answer-relevant visual evidence is masked or counterfactually changed.

#### Initial Contents

- Create and human-check the 40-example TextVQA and ChartQA diagnostic set, including the answer-relevant region and counterfactual edit where feasible.
- Run the 160 baseline inferences under the fixed decoding settings and calculate normalized accuracy, masking sensitivity, counterfactual flip accuracy, and oracle recovery rate by task.
- Mark H1 supported only if counterfactual answer-flip accuracy is materially below the human-checked expected flip rate and the result is not explained by a failed image edit; otherwise mark it contradicted or unresolved.
- Produce one Experiment report separating observations from interpretation, with per-example outputs, aggregate tables, confounds, and the next discriminating experiment for H2, H3, or H4.

## Artifacts

### Research findings

**ID:** `research-findings`
**Description:** Versioned claims about the target VLM, supported and contradictory evidence, confidence, scope, known limitations, and the experiment reports that justify each update.

### Research agenda

**ID:** `research-agenda`
**Description:** Ranked hypotheses and evidence gaps. Every item cites the objective criterion it advances, the result or scope change that created it, why it remains unresolved and non-duplicative, and the evidence that would retire it.

### Experiment plan

**ID:** `experiment-plan`
**Description:** One bounded hypothesis and protocol with its link to the research agenda, expected discriminating outcomes, dataset and model scope, controls, metrics, analysis method, resource limit, stopping rule, and required provenance.

### Experiment report

**ID:** `experiment-report`
**Description:** The portable research handoff linking the experiment plan and prior findings revision to exact configurations, data and code references, per-example outputs, metrics, plots or tables, completed, partial, failed, or blocked outcome, analysis verdict, confounds, unresolved findings, and proposed follow-up work.

### Decision request

**ID:** `decision-request`
**Description:** One focused human-owned choice or pause request with the relevant evidence, recommendation, alternatives, resource or risk implications, and consequence of waiting.

### Research decision

**ID:** `research-decision`
**Description:** The researcher's recorded choice about scope, model or task priority, resource use, risk, scheduled observation, continuation, or conclusion.

## Boundaries

### Researcher judgment

**ID:** `researcher-judgment`
**Kind:** `interrupt`
**Description:** Pause when progress requires a consequential model, task, publication, risk, or scope choice that the evidence cannot determine.

### Compute or access limit

**ID:** `compute-access-limit`
**Kind:** `budget`
**Description:** Pause before exceeding authorized compute, data access, API cost, hardware time, or licensing constraints; preserve a blocked experiment report before requesting a decision.

### Research pause

**ID:** `research-pause`
**Kind:** `interrupt`
**Description:** Because the research policy is continuous, a conclusion candidate, an intentional stopping point, or a scheduled observation is presented to the researcher instead of being accepted silently.

## States

### Plan experiment

**ID:** `plan-experiment`
**Kind:** `decide`
**Summary:** Choose the highest-value unresolved hypothesis and design one controlled test.

#### Reads

- Research findings
- Research agenda
- Research decision

#### Instruction

Compare the current findings with the objective and select one unresolved, non-duplicative question whose answer could change a research belief or intervention choice. Write a bounded experiment plan that states the hypothesis, rival explanations, controlled conditions, model and dataset scope, measurements, analysis method, success and failure interpretations, resource ceiling, stopping rule, and reproducibility requirements. Prefer the smallest test that can discriminate among perception, integration, answer-generation, and language-prior explanations. If a required model, dataset, authority, or consequential scope choice is missing, write one decision request instead of inventing it.

#### Writes

- Experiment plan
- Decision request

#### Completion

Either the experiment plan is executable within the recorded setup and resource limit, or one focused decision request identifies the missing human-owned input.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `run-experiment` | The experiment plan is executable and all required access is available | `normal` | `plan-to-run` |
| `review-boundary` | A consequential choice, permission, or resource authorization is required | `interrupt` | `plan-to-boundary` |

### Run experiment

**ID:** `run-experiment`
**Kind:** `act`
**Summary:** Execute the controlled VLM comparison and preserve reproducible outputs.

#### Reads

- Experiment plan

#### Instruction

Execute only the planned conditions within the resource ceiling. Preserve exact inputs, model and environment identifiers, raw per-example outputs, logs, seeds, failures, and stable references to code, data, checkpoints, tables, and plots. Write an experiment report even when execution is partial, failed, or blocked; do not hide negative outcomes or change the hypothesis after seeing the results.

#### Writes

- Experiment report

#### Completion

The experiment report records a completed, partial, failed, or blocked outcome and contains enough provenance and observable output for a fresh researcher to inspect the run.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `analyze-results` | An inspectable experiment report exists for any execution outcome | `normal` | `run-to-analyze` |

### Analyze results

**ID:** `analyze-results`
**Kind:** `evaluate`
**Summary:** Test the hypothesis against metrics, counterfactual behavior, and qualitative failures.

#### Reads

- Experiment plan
- Experiment report

#### Instruction

Check data integrity and planned analyses before interpreting the outcome. Compare intact, masked, counterfactual, and oracle-text behavior where applicable; report uncertainty and effect sizes rather than accuracy alone. Examine representative successes and failures, test rival explanations, identify confounds and regressions, and state whether the evidence supports, contradicts, or leaves the hypothesis unresolved. Add analysis, plots or tables, a verdict, limitations, and candidate follow-up questions to the experiment report without converting speculation into evidence.

#### Writes

- Experiment report

#### Completion

The experiment report contains an evidence-linked verdict, uncertainty, confounds, limitations, and inspectable analysis for any completed, partial, failed, or blocked run.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `update-research` | The result has been interpreted, including negative or blocked outcomes | `normal` | `analyze-to-update` |

### Update research record

**ID:** `update-research`
**Kind:** `update`
**Summary:** Revise the findings and derive the next evidence-backed research question.

#### Reads

- Research findings
- Research agenda
- Experiment report

#### Instruction

Integrate the report into the research findings: update only claims warranted by the evidence, preserve contradictory evidence and scope limits, and cite the report. Resolve, split, reprioritize, or retain agenda items accordingly. Every new agenda item must cite the objective criterion it advances; the report, observation, missing evidence, failed check, or explicit human scope change that created it; why it remains unresolved and is not a duplicate; and the evidence that would retire it.

Then compare the complete findings and agenda with the objective and produce exactly one justified outcome: one or more objective-backed agenda items; a scheduled observation with a date or trigger when external change is expected; one human-owned decision; or a conclusion candidate supported by the declared evidence. Never add unrelated ideas merely to keep the loop active. Record a scheduled observation, human decision, conclusion candidate, or exhausted resource limit in one decision request.

#### Writes

- Research findings
- Research agenda
- Decision request

#### Completion

The research record is internally consistent, the report is traceable from every changed claim, and exactly one next outcome is recorded without relying on hidden conversation context.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `plan-experiment` | One or more justified research agenda items are ready for another bounded test | `continue` | `update-to-plan` |
| `review-boundary` | The justified outcome is a scheduled observation, human-owned decision, conclusion candidate, or resource pause | `interrupt` | `update-to-boundary` |

### Review research boundary

**ID:** `review-boundary`
**Kind:** `interrupt`
**Summary:** Present one research choice or pause condition for the researcher to resolve.

#### Reads

- Decision request
- Research findings
- Research agenda

#### Instruction

Present one focused question with the evidence, recommendation, alternatives, cost or risk, and effect on the objective. Wait for the researcher to authorize resources, choose or change scope, schedule resumption, accept a pause or conclusion, or supply missing intent. Record the answer without treating silence as approval.

#### Writes

- Research decision

#### Completion

The researcher's decision is recorded durably; continuation occurs only when the decision authorizes a next experiment or changes the agenda.

#### Transitions

| Next state | When | Kind | ID |
| --- | --- | --- | --- |
| `plan-experiment` | The researcher authorizes continuation and the agenda contains a justified testable item | `normal` | `boundary-to-plan` |
