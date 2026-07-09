# Flow Steps invoke agents through an injected Agent trait

Flow Steps do not call an LLM directly. They call an `Agent` trait (`async fn run(ctx: &AgentContext) -> Result<AgentOutput>`), and the pipeline is given an `AgentRegistry` that maps a step kind to a concrete agent. P0 ships **deterministic stub agents** for the Plan and Outline steps; real `genai`-backed agents arrive in P1.

This boundary is what makes the orchestrator fully testable without an LLM or API key: tests inject stub agents whose output is deterministic, so DAG scheduling, pause/resume/retry/skip, persistence, and event emission can be verified with assertions rather than `#[ignore]`d real-model harnesses. It also matches the V2 model-router intent (route a step to the right agent + model capability) without coupling the scheduler to `genai`. The real-model harness pattern already used in `ai/commands_tests.rs` remains the right shape for P1 LLM-path tests.
