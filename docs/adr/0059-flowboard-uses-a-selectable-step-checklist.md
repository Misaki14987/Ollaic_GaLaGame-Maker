# FlowBoard uses a selectable step checklist

FlowBoard now presents production as a checklist grouped into story and characters, dialogue and scenes, and optional material production. Users select the scope before preparing a paused run, then explicitly start production; the backend validates missing prerequisites and persists the selected recipe so recovery retains the same scope. This replaces ADR 0053's React Flow canvas: selecting steps and inspecting results takes priority over arranging nodes, while pending dependencies remain editable through a form and the scheduler retains its DAG model.

Material production is off by default. Only selected capabilities block preparation; unselected material production requires no media interfaces and leaves materials for later editing. Local fallback requires an explicit choice, and skipping a prerequisite never silently enables it or pretends that its data exists.
