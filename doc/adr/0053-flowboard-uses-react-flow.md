# FlowBoard uses React Flow

The V2 FlowBoard is the project-first workspace that renders an Agent Flow as an interactive DAG. We render it with the **React Flow** library rather than a self-built lightweight canvas.

The doc's interaction requirements — wheel zoom, drag-to-pan, drag a node to edit dependencies, and virtualization toward very large step counts — are exactly what React Flow provides off the shelf. Building a custom canvas would be rebuilt later to recover these. One well-supported dependency is cheaper than a bespoke canvas that would need to grow into the same feature set.
