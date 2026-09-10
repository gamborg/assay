# assay

**assay is an evaluation harness for tool-using AI agents.**

It lets you define what an agent is expected to do, run the same scenarios against different model configurations, record what actually happened, and turn that behaviour into deterministic pass/fail gates.

The purpose is not to judge whether an agent's prose *sounds* good. It is to make the parts of agent behaviour that matter operationally measurable:

- Did the agent call the right tool?
- Did it avoid the wrong tool?
- Did it use the expected arguments?
- Did it finish within a reasonable number of steps?
- Did it stay below a latency or cost threshold?
- Did a previously passing scenario regress after a model, prompt, or code change?
- Can an agent inspect and run its own evaluations through MCP?

A small example demonstrates why this matters. An agent can produce a fluent, confident answer about a city for which its weather tool has no data. Nothing in the final prose necessarily looks suspicious. A behavioural assertion can still catch it:

```text
PASS  weather-prefers-specific-tool  1840ms  2 step(s)  $0.00412
FAIL  unknown-city-admits-gap        2210ms  2 step(s)  $0.00380
      x outputNotContains: unexpectedly present: degrees celsius, sunny
      x outputMatches: pattern /(no|not|unable|don't have|cannot)/i
```

That is the core problem assay is designed to solve.

---

## Why assay exists

Agent testing is often done by manually rerunning a prompt and deciding whether the result looks acceptable. That approach is difficult to reproduce and provides weak evidence when something changes.

A model upgrade can alter tool selection. A prompt change can introduce a regression. A routing decision can trade quality for latency or cost. A final answer can look correct even though the agent bypassed the authoritative tool.

assay makes those behaviours explicit and comparable.

It focuses on three questions:

1. **Did the agent use the right tool?**  
   The final answer does not reliably tell you. An agent that answers from memory instead of calling an authoritative tool may appear correct today and become wrong as soon as the underlying data changes.

2. **Did the agent get worse?**  
   A total such as "20 scenarios passed" does not tell you whether the failures changed. assay compares results by scenario and target so that regressions and fixes are visible.

3. **What does a model configuration actually cost?**  
   Model routing should be based on measurements of latency and estimated cost rather than assumptions about which model is "cheap" or "fast."

assay is intentionally small. It is a **harness, not an agent framework**.

---

## Quick start

The demo can be run without an API key:

```bash
git clone https://github.com/gamborg/assay.git
cd assay

npm install
npm test

node bin/assay.js run --config examples/demo.config.yaml
```

The demo uses a scripted offline provider, so the complete pipeline can be exercised without network access or model credentials.

It contains two targets:

- `scripted-good` passes the scenarios.
- `scripted-small` deliberately fails scenarios in ways that illustrate common agent mistakes, such as reaching for a generic search tool or inventing plausible information when a tool cannot provide the requested data.

A demo in which everything is green would hide the reason the harness exists. The example therefore includes intentional failures.

To run against real models, copy `.env.example` to `.env`, provide the required credentials, and use the real configuration in `assay.config.yaml`.

---

## How it works

The basic flow is:

```text
                 ┌────────────────────┐
                 │     Scenario(s)     │
                 │ task + expectations │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │   Model / Target   │
                 │ frontier / local   │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │    Agent runner    │
                 │ prompt + tool loop │
                 └─────────┬──────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           tool calls    output       timing/cost
              │            │            │
              └────────────┼────────────┘
                           ▼
                 ┌────────────────────┐
                 │   Trace + gates    │
                 │     pass / fail    │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Regression report  │
                 │ vs. committed base │
                 └────────────────────┘
```

The important boundary is between the harness and the model provider. The evaluation logic, assertions, traces, and reports do not depend directly on a vendor SDK. Providers implement the adapter behind that seam.

---

## Scenarios

A scenario describes one agent task and the behaviour expected from the run. Scenarios can be written in YAML or JSON.

For example:

```yaml
- id: weather-prefers-specific-tool
  description: >
    With both a weather tool and a generic search tool available, the agent
    should use the weather tool and should not fall back to search.
  prompt: What is the weather in Copenhagen right now?
  tools: [get_weather, web_search]
  tags: [tool-selection, core]
  expect:
    - toolCalled: get_weather
    - toolNotCalled: web_search
    - toolCalledWith:
        tool: get_weather
        args: { city: Copenhagen }
    - outputContains: ["12"]
    - maxSteps: 3
    - completes: true
```

Each entry under `expect` is a single assertion. Unknown assertion names are rejected rather than silently ignored; a gate that was accidentally skipped would be worse than having no gate.

### Available assertions

| Assertion | Passes when |
|---|---|
| `toolCalled` | The named tool was called at least once |
| `toolNotCalled` | The named tool was never called |
| `toolCalledWith` | A tool call matched `{tool, args}`; arguments use recursive subset matching |
| `toolCallCount` | Total calls satisfy the supplied tool/min/max constraints |
| `outputContains` | Output contains the specified string, or all strings in a list |
| `outputNotContains` | Output contains none of the specified strings |
| `outputMatches` | Output matches the supplied regular expression |
| `maxSteps` | The run took no more than N model turns |
| `latencyUnderMs` | Wall-clock duration stayed below the limit |
| `costUnderUsd` | Estimated cost stayed below the limit |
| `completes` | The agent finished rather than hitting `maxSteps` |

The harness deliberately favours **behavioural assertions** over exact response matching. Tool choice, call counts, number of steps, latency, and other observable properties tend to survive wording changes better than an assertion requiring the model to emit one exact sentence.

### Adding assertions

Custom assertions can be added in:

```text
lib/gates/assertions.js
```

Once registered, the assertion is available to scenario files.

---

## Deterministic fixture tools

Scenarios use deterministic fixture tools by default.

This is intentional. If a scenario called a live weather API, a failure could be caused by changing weather data or an unavailable service rather than a change in agent behaviour.

A useful evaluation keeps the environment stable and lets the agent be the variable under test.

The fixture tools live in:

```text
lib/agent/tools.js
```

Custom tools can also be registered with `registerTool()`, allowing the same evaluation approach to be used against a real tool surface backed by controlled or stubbed data.

---

## Targets and model routing

A **target** is a named model configuration.

Targets are named for their role in a routing decision rather than only by provider/model identifier. This makes reports easier to read:

```yaml
targets:
  - name: frontier
    provider: anthropic
    model: claude-opus-5

  - name: small
    provider: anthropic
    model: claude-haiku-4-5

  - name: local
    provider: local
    model: ${LOCAL_MODEL}
    baseUrl: ${LOCAL_BASE_URL}
```

Every scenario can be run against every target. The resulting report makes it possible to compare behaviour, latency, and estimated cost across model configurations.

This is particularly useful when deciding whether a task should be routed to a larger hosted model, a smaller model, or a local model.

### Vendor-independent provider seam

Provider-specific integrations are isolated under:

```text
lib/providers/
```

Adding a provider requires an adapter and a registry entry. The rest of the harness — scenario execution, assertions, regression comparison, and reporting — does not import a vendor SDK directly.

This keeps the evaluation layer independent from the model vendor.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rationale behind the boundary.

---

## Traces and metrics

Each run records enough information to explain what happened rather than only reporting a final pass/fail result.

The recorded information includes:

- agent steps
- tool calls
- tool arguments
- output
- latency
- estimated cost
- assertion results

The trace is JSON so it can be inspected and compared directly.

The point of a trace is diagnostic: when a gate fails, you should be able to determine *why* it failed without manually reproducing the run.

---

## Regression suites

assay can record a baseline and compare later runs against it:

```bash
assay baseline
assay run --gate
```

The baseline should be committed to version control. A baseline that exists only on one developer's machine is not a useful regression suite.

With `--gate`, the command exits with a non-zero status when a regression is detected:

| Exit code | Meaning |
|---|---|
| `0` | Everything passed |
| `1` | A gate failed or a regression was found |
| `2` | The harness could not run because of invalid configuration, missing scenarios, or an unknown target |

Regression results are keyed by both **scenario and target**. This matters because the same scenario may legitimately pass on one model and fail on another.

The comparison focuses on **regressions and fixes**, not just totals. For example, a suite that remains at 20 passing scenarios can still have changed materially if the scenarios that pass and fail are different.

---

## MCP server

assay can expose the harness as an MCP server:

```bash
assay-mcp --config assay.config.yaml
```

A client can configure it as an MCP server:

```json
{
  "mcpServers": {
    "assay": {
      "command": "assay-mcp",
      "args": ["--config", "assay.config.yaml"]
    }
  }
}
```

The MCP server exposes five tools:

- `list_scenarios`
- `run_scenarios`
- `get_trace`
- `compare_to_baseline`
- `describe_harness`

This allows an agent to use the evaluation system itself:

```text
change prompt
    ↓
run affected scenarios
    ↓
inspect failed result
    ↓
read trace
    ↓
change implementation
    ↓
run again
    ↓
compare against baseline
```

The MCP interface is intentionally constrained.

### Read and run, never write

The MCP tools cannot modify scenario definitions or promote a new baseline.

That separation prevents the agent from changing the test it is being evaluated against.

There is also a test asserting that no such write capability exists.

### Traces are opt-in

Traces are returned per scenario rather than automatically returning every trace from a run. This keeps the agent's context focused on the evidence it actually needs to diagnose a failure.

---

## How this project was built with agents

Agents were used as part of the development workflow, but the architecture was established before delegating implementation.

### Work was scoped by architectural seam

The key boundaries were fixed first:

- provider interface
- trace format
- assertion signature

With those interfaces established, providers, gates, regression handling, and MCP functionality could be implemented as relatively self-contained workstreams.

This reduced the chance that an implementation agent would make an implicit architectural decision that affected unrelated parts of the system.

### Context was provided up front

Each implementation task was given the neutral message format, run-record shape, and surrounding conventions needed to work within the repository.

The goal was to make the intended contract explicit rather than asking an agent to discover the architecture by reading an arbitrary amount of surrounding code.

### Code was verified by execution

Agent-written code was exercised against the deterministic mock provider as soon as it was implemented.

This exposed bugs that were not obvious from code review alone. The resulting investigation is documented in [FINDINGS.md](FINDINGS.md).

### Model-generated facts were checked against actual sources

Model identifiers and pricing are easy for an agent to state confidently while still being stale or incorrect.

The important fix was therefore not simply correcting a value in a table. The harness was changed so that an unknown price causes a cost gate to fail rather than silently being interpreted as zero.

That principle is central to the project: **an agent's confidence is not evidence of correctness**.

---

## Findings

The repository includes [FINDINGS.md](FINDINGS.md), which documents concrete failures encountered while building the harness.

The findings capture:

- what the agent did incorrectly
- the initial hypothesis about the cause
- how the problem was investigated
- what changed
- whether the change fixed the problem

These examples are important because they show the harness being used on the kind of problems it is intended to expose, rather than presenting evaluation as a purely theoretical capability.

---

## What assay does not do

assay intentionally has a narrow scope.

### No judge-based assertions

The current gates are deterministic. They inspect things such as:

- tool selection
- tool call counts
- output substrings
- regular expressions
- number of steps
- latency
- estimated cost

There is no LLM judge that attempts to decide whether an answer is semantically "good".

That is a deliberate limitation. A judge is itself an agent/model whose reliability would need to be evaluated.

### No flake handling

Each scenario currently runs once.

Agent behaviour can vary between identical runs, so a single pass/fail result can provide less evidence than it appears to. A future version should support pass rates across N runs and define regression behaviour in terms of those rates.

### Cost is estimated

Pricing is based on a hardcoded snapshot. Cached input tokens are not modelled.

For unknown models, cost is reported as `null`, and cost gates fail rather than treating the unknown cost as zero.

### No streaming or multi-turn conversations

The current execution model is intentionally simple:

```text
one prompt
→ one agent
→ one tool loop
```

There is currently no streaming support, multi-turn conversation state, or sub-agent orchestration.

### JSON traces, not OpenTelemetry

Traces are stored as JSON because they are easy to inspect and diff.

They are not currently emitted as OpenTelemetry spans and therefore are not directly integrated with an existing observability stack.

---

## What I would improve next

There are three improvements that would materially strengthen the harness:

1. **Pass rates instead of single-run pass/fail**  
   Repeated runs would better represent stochastic agent behaviour and make regression results more statistically meaningful.

2. **Version the trace schema**  
   Baselines currently depend on an implicit trace shape. An explicit schema version would make breaking changes detectable instead of silently invalidating stored runs.

3. **Emit OpenTelemetry spans**  
   The same execution information could be exposed through OpenTelemetry so traces can be consumed by existing observability infrastructure.

---

## Project structure

The main implementation areas are:

```text
assay/
├── bin/
│   └── assay.js              # CLI entry point
├── lib/
│   ├── agent/                # Agent execution and tools
│   ├── gates/                # Deterministic assertions
│   └── providers/            # Model-provider adapters
├── examples/                 # Example scenarios/configuration
├── ARCHITECTURE.md           # Architectural boundaries and rationale
├── FINDINGS.md               # Investigation of concrete agent failures
├── assay.config.yaml         # Real-model configuration
├── .env.example              # Environment variable template
└── package.json
```

---

## Development

Tests use Node's built-in test runner and do not require network access or an API key:

```bash
npm test
```

The CLI help is available with:

```bash
node bin/assay.js help
```

Runtime requirements:

- Node.js 20.10+
- JavaScript / ESM
- no build step

The runtime dependencies are:

- `yaml`
- `@anthropic-ai/sdk`
- `@modelcontextprotocol/sdk`

---

## Design principles

The implementation follows a few principles that are easy to lose in an evaluation system:

### Measure behaviour, not vibes

A fluent answer is not evidence that the agent used the correct tool, followed the intended workflow, or stayed within operational constraints.

### Keep the environment deterministic

If the underlying tool data changes between runs, it becomes difficult to attribute a regression to the agent.

### Make failures diagnosable

A pass/fail result is useful only when there is enough trace information to understand the failure.

### Keep vendor integrations behind a seam

Model providers should be replaceable without rewriting the evaluation logic.

### Do not let the system rewrite its own tests

An agent that can modify the scenario it is being evaluated against can make the evaluation meaningless.

### Fail closed on unknown cost

Missing pricing information should not make a cost gate pass accidentally.

---

## License

MIT.
