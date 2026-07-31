# Flow Recipes Declare Capabilities, Not Models

Flow Templates and Flow Modules declare Model Capabilities instead of binding Steps to concrete model names. This keeps shared recipes portable across local provider configurations, budgets, regions, and future model changes, with the user's AI settings responsible for mapping capabilities such as long context, structured output, low cost, image generation, TTS, or strong reasoning to specific providers and models.
