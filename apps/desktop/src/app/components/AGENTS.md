# UI components

- Keep rendering and user interaction here; move reusable domain transformations into pure modules and effect coordination into hooks. Function components are the default.
- Reuse shared controls and semantic tokens. Use stable semantic list keys; memoize only after identifying a real rendering cost.
- Build a practical workspace: every element must identify content, explain meaningful state, or enable a task. Keep one clear primary action at each navigation level.
- Use direct labels and factual empty states. Exclude slogans, decorative brand dots, fake avatars/identities, ornamental online indicators, and status labels without decision value.
- Empty states and dialogs explain only the current state and necessary next action. Avoid decorative instructions, dates, repeated statistics, and storage explanations.
- Show loading, empty, error, partial-success, and success states accurately. Confirm persistence before showing saved state; preserve input after recoverable failure.
- Use semantic controls, accessible names, visible focus, and predictable keyboard navigation. Dialogs manage focus and allow safe dismissal.
- Explain disabled actions when needed. Communicate state with more than color; support reduced motion and supported window sizes/scaling.
- Give destructive actions clear scope and appropriate recovery or confirmation. Keep routine reversible actions efficient.
- Before delivery, remove elements without task value and their unused styles. Verify changed interactions and capture screenshots when useful for review.
