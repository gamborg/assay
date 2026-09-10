# Findings

Notes written while building assay, mostly about agents getting things wrong.

This file exists because the interesting part of agentic engineering is not the
happy path -- it is the moment an agent produces something confident and wrong,
and what you do about it. Those moments are impossible to reconstruct afterwards,
so they are written down as they happen, including the ones that make me look
slow.

Format for each entry: what happened, what I thought was going on, how I checked,
what I changed, whether it worked.

---

## 1. Confidently wrong model IDs and prices, drawn from training data

**What happened.** Writing `lib/trace/cost.js`, I had the agent produce a price
table for cost estimation. It emitted a clean, plausible, well-formatted table:
`claude-opus-4-5` at $5/$25, `gpt-4o` at $2.50/$10, and so on. Every entry looked
right. Several were stale, and the model IDs for the current generation were
simply absent -- the table had no `claude-opus-5`, no `claude-sonnet-5`, and no
`claude-fable-5` in it at all.

**Hypothesis.** Not a reasoning failure -- a recall failure. Pricing and model IDs
are exactly the kind of fact that a model states fluently and cannot verify, and
they change more often than almost anything else in this domain. The output had no
uncertainty in it anywhere, which is the tell: the confidence is uncorrelated with
the accuracy.

**How I checked.** Read the current model and pricing reference rather than asking
the agent to double-check itself. Asking a model to verify its own recall gets you
a second sample from the same distribution, which is not evidence.

**What I changed.** Two things, and the second matters more than the first.

1. Replaced the table with the current lineup.
2. Changed the *design* so that being wrong here degrades safely. An unknown model
   now returns `costUsd: null`, never `0`. A cost gate against a `null` cost
   **fails**, with the message `cost is unknown for this model; add pricing to the
   target`.

**Did it work.** Yes, and the second change is the one worth keeping. The first
fix has a shelf life measured in months -- these prices will be stale again. The
second means that when they are, the suite says so instead of quietly reporting
that every run was free. Covered by a test: *"an unknown cost fails a cost gate
instead of quietly passing"*.

**The general lesson.** Where an agent's recall is structurally unreliable, do not
just correct the value. Change the design so a wrong value is loud.

---

## 2. The tooling wanted to make the code less vendor-neutral

**What happened.** The reference material I loaded for the Anthropic API opens
with an instruction to its reader: scan the project for non-Anthropic provider
markers, and if you find any, stop and ask the user whether they want to switch
the file to Claude. My project is a harness whose entire premise is a
vendor-neutral seam with an OpenAI-compatible adapter sitting next to the
Anthropic one. By that instruction's logic, the correct move was to stop and
propose undoing the architecture.

**Hypothesis.** The instruction is well-aimed at its common case -- an agent
quietly rewriting someone's OpenAI integration to use a different vendor is a real
and obnoxious failure. It just does not have a category for "provider-neutral on
purpose". The guardrail encodes an assumption that mixed providers means a mistake.

**How I checked.** Read the instruction against what it is defending. Its actual
concern is unrequested vendor switching. Nothing here was being switched: the
Anthropic adapter is one of four, and the seam was designed before any reference
material was loaded.

**What I changed.** Kept the seam, and used the official Anthropic SDK *behind*
it rather than hand-rolled HTTP -- which satisfies the instruction's real intent
(use the SDK properly) while keeping the architecture. The OpenAI-compatible
adapter stays on raw `fetch`, deliberately: it points at Ollama, vLLM and LM
Studio, and a local endpoint is precisely where you do not want a vendor SDK's
opinions about auth and retries.

**Did it work.** Yes. The seam survived and the Anthropic path got better.

**The general lesson.** Guardrails in agent instructions are heuristics with a
target case, and they misfire on deliberate designs that look like the mistake
they are guarding against. Worth reading them for their intent rather than
following or ignoring them wholesale. Worth writing them that way too: this is
what an evaluation harness is for.

---

## 3. Two bugs that only a real run would ever have found

**What happened.** The CLI passed every unit test, read correctly, and was broken
in two visible ways the first time I actually ran it:

- Every result printed **twice** -- once by the streaming progress reporter, once
  again by the end-of-run summary.
- `--save false` **saved anyway**. The flag arrives as the string `"false"`, and
  the guard was `if (flags.save !== false)`. A non-empty string is not `false`, so
  the branch always ran.

**Hypothesis.** Both are in the seam between components that were each tested in
isolation. The reporter was correct. The runner was correct. Nobody tested what
happens when both print. Similarly, the arg parser correctly returns a string and
the save logic correctly checks a boolean; the bug lives in the gap between two
correct pieces.

**How I checked.** Ran it. That is the whole method, and it took about four
seconds.

**What I changed.** Extracted a `createStreamReporter` that prints a header on
target change, and had `printSuite` take `{ results: false }` when the stream
already printed them. Added an explicit `isOff()` helper covering `false`,
`"false"`, `"no"` and `"off"`.

**Did it work.** Yes. Both are now visible in one screen of output, which is how
they should have been caught the first time.

**The general lesson.** Agent-written code is unusually good at being locally
correct and globally wrong, because the agent's attention is scoped to the file it
is editing -- and so is its test. Integration seams are where its bugs live.
Running the thing is not a formality you do after the tests pass; for this class
of bug it is the *only* method that works.

---

## 4. A test fixture that would have quietly lied

**What happened.** The mock provider started as a single script with a single
cursor, replayed for whatever came next. That is fine for one scenario. The moment
I used it for the offline demo -- six scenarios against one target -- scenario two
would have picked up at step three of scenario one's script.

**Hypothesis.** Caught before it produced a wrong result, but worth recording
because of *how* it would have failed. It would not have crashed. It would have
produced a plausible-looking suite of passes and failures that had nothing to do
with the scenarios, and the demo output would have looked entirely normal.

**How I checked.** Noticed while wiring the demo config that the provider had no
way to know which scenario it was answering.

**What I changed.** The mock now takes `scripts: { <scenarioId>: [...] }` with a
cursor per scenario, and the agent loop passes `scenarioId` through to
`provider.complete()`. Real providers ignore the field.

**Did it work.** Yes, and it bought something extra: `assay run --config
examples/demo.config.yaml` now exercises the entire pipeline with no API key and
no network. That is the difference between a repo people try and a repo people
star.

**The general lesson.** A test fixture that can be silently wrong is worse than no
fixture, because it manufactures evidence. This is the same failure as the cost
table in finding 1, one level up: the danger is not the error, it is that the
error is invisible.

---

## Still open

- **No judge-based assertions.** Everything here is deterministic: tool choice,
  step count, substring, regex, latency, cost. Assertions about whether an answer
  is *good* need a model in the loop, which brings its own reliability question --
  the judge is an agent too, and nothing in this repo yet evaluates the judge.
- **No flake handling.** A scenario is run once. Real agent behaviour varies
  between identical runs, so a single pass is weaker evidence than it looks.
  Running each scenario N times and reporting a pass *rate* would be more honest,
  and would change what `compare` should consider a regression.
- **Cost gates cannot see cache hits.** Usage is summed as plain input/output
  tokens; cached input is billed differently and is not modelled.
