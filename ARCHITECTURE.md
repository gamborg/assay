# Architecture

## The shape of it

```
                        scenarios/*.yaml          assay.config.yaml
                              |                          |
                              v                          v
                     +-----------------+        +-----------------+
                     | scenario loader |        | target config   |
                     +--------+--------+        +--------+--------+
                              |                          |
                              +-----------+  +-----------+
                                          |  |
                                          v  v
                                     +-------------+
                                     |   runner    |  every scenario x every target
                                     +------+------+
                                            |
                                            v
                                     +-------------+        +-----------------+
                                     | agent loop  |<------>| fixture tools   |
                                     +------+------+        | (deterministic) |
                                            |               +-----------------+
                            ================|================  <- the vendor seam
                                            v
                                     +-------------+
                                     |  provider   |
                                     +------+------+
                                     /      |      \
                            anthropic   openai-compatible   mock
                             (SDK)      (Ollama, vLLM,     (offline,
                                         LM Studio, ...)    scripted)
                                            |
                                            v
                                     +-------------+
                                     |    trace    |  every turn, call, result, timing
                                     +------+------+
                                            |
                          +-----------------+-----------------+
                          v                                   v
                   +-------------+                    +---------------+
                   |    gates    |                    |   reports     |
                   | assertions  |                    | console/JSON  |
                   +------+------+                    +---------------+
                          |
                          v
                   +-------------+        +-----------------+
                   |  baseline   |<------>|    compare      |  regressions, not totals
                   +-------------+        +-----------------+

                   bin/assay.js  and  bin/assay-mcp.js are both thin shells over lib/
```

## Why it is arranged this way

**The vendor seam is the load-bearing decision.** Everything above it -- the loop,
the gates, the reports, the regression store -- speaks one neutral message format
and never imports a vendor SDK. Adding a provider means adding one file under
`lib/providers/` and one line in its registry.

The reason is not portability for its own sake. It is that if swapping models
requires touching evaluation logic, you are no longer measuring the model, you are
measuring your integration -- and the numbers stop meaning anything the moment you
change vendors.

**Assertions read the trace, not the answer.** "Did it call the right tool" is not
visible in the final text. Making the trace the contract between the loop and the
gates is what allows the interesting assertions to exist at all, and it keeps the
gates pure functions that are trivial to test.

**Failures are data, not exceptions.** A provider that times out, a tool that
throws, a model that loops until `maxSteps` -- each is a legitimate evaluation
outcome recorded in the run, not a crash that takes the suite down. The one thing
kept separate is an errored run, which fails regardless of its assertions: "the
model chose wrong" and "the endpoint was down" need different people to look at
them.

**Unknown is not zero.** An unpriced model reports `costUsd: null` and fails a cost
gate rather than passing it. Quiet green is the failure mode that makes an eval
suite worthless.

## Module map

| Path | Responsibility |
|---|---|
| `lib/scenarios/` | Parse and validate scenario files; fail loudly on typos |
| `lib/config/` | Named model targets, with `${ENV}` expansion |
| `lib/providers/` | The vendor seam and its adapters |
| `lib/agent/` | The tool-calling loop, and the deterministic fixture tools |
| `lib/trace/` | Trace recording and cost estimation |
| `lib/gates/` | The assertion registry and the pass/fail evaluator |
| `lib/regression/` | Run storage, baselines, and run-to-run diffing |
| `lib/report/` | Console and JSON output |
| `lib/mcp/` | The harness exposed as an MCP server |
| `lib/cli/` | Argument parsing and command dispatch |
