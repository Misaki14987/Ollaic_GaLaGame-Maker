# Styles and tokens

- Reuse semantic color, spacing, typography, and surface tokens. Add shared tokens here only when they represent reusable meaning.
- Keep feature styles scoped to their owning component; reserve global selectors for deliberate application-wide behavior.
- Remove unused styles with removed UI. Avoid a second token system or repeated hard-coded values for an existing semantic role.
- Preserve focus visibility, contrast, reduced motion, and behavior at supported window sizes/scaling. Check light/dark variants when affected.
- Follow [UI rules](../app/components/AGENTS.md) when a visual change adds or removes interface elements.
