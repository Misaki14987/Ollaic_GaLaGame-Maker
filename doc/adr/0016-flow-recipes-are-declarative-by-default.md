# Flow Recipes Are Declarative by Default

Flow Templates and Flow Modules are declarative recipes by default: they describe Steps, dependencies, prompts, schemas, parameters, model preferences, retry behavior, and checks without executing arbitrary code. This keeps local sharing and future import/export safer and easier to reason about, while leaving sandboxed scripting or full plugins as separate future capabilities rather than part of the core Flow recipe model.
