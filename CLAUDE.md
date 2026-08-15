## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

# 21st.dev Operating Policy

21st.dev is a VISUAL DESIGN REFERENCE ONLY.

It must NEVER determine the implementation technology.

Whenever using 21st.dev:

Step 1
Search for layouts, dashboards, tables, forms, navigation, spacing, typography, colors and UX patterns.

Step 2
Analyze the design.

Step 3
Recreate the design from scratch.

Do NOT copy framework code.

---

Scope of these rules

These rules govern `prototype/` — the application the user opens. They do NOT
govern `backend/`, the optional Python service that holds the AI model
credential and grounding prompt. That code never reaches the browser, is never
required to run the application, and uses pip dependencies deliberately.

`prototype/` must keep working with `backend/` stopped. Any AI path there
degrades to the no-AI behaviour rather than erroring.

---

Implementation Rules

The implementation MUST use ONLY:

• HTML5
• CSS3
• Vanilla JavaScript
• SVG
• Local assets

Never use:

• React
• Next.js
• Vue
• Angular
• Svelte
• Astro
• TypeScript
• JSX
• Tailwind runtime
• shadcn/ui
• npm packages
• pnpm
• yarn
• bun
• Vite
• webpack
• Babel
• CDN resources
• Remote fonts

unless explicitly instructed by the user.

---

Portability Requirements

The finished application MUST:

✓ execute by double-clicking index.html

✓ require zero installation

✓ require zero configuration

✓ require zero internet connection

✓ require zero package manager

✓ require zero build process

✓ require zero local server

The application must work on a clean Windows machine with only a modern browser installed.

---

Decision Process

Before using any 21st.dev component ask:

Can this be recreated using HTML/CSS/JavaScript?

If YES

→ recreate it.

If NO

→ simplify the design until it can.

Never introduce a framework simply because the original component uses one.

---

Validation

Before completing any UI task verify:

□ index.html opens directly

□ all CSS is local

□ all JavaScript is local

□ no CDN exists

□ no build step exists

□ no npm dependency exists

□ application works offline

If any answer is NO, continue working until every answer is YES.