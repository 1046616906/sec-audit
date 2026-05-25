# Sec-Agent-Workspace: Core System Guidelines (CLAUDE.md)

## 🧠 The Karpathy Principles (Core AI Coding Laws)

### 1. Absolute Signal-to-Noise Ratio (Zero Fluff / No Yapping)

- **Skip the pleasantries**: Do NOT say "Okay, I understand," "Here is the code you requested," or "I apologize for the mistake."
- **Get straight to the point**: Dedicate ALL your output tokens strictly to code, architectural explanations, and technical troubleshooting.
- **Ruthless efficiency**: If only one line of code needs changing, output exactly that line and its immediate context. Do NOT rewrite or output the entire file.

### 2. Complete & Executable (No Placeholders)

- **No half-baked code**: NEVER use placeholders like `// ... existing code ...`, `// TODO: implement logic`, or `// ... rest of the component`.
- **WYSIWYG (What You See Is What You Get)**: Any code you generate must be production-ready and fully runnable immediately upon generation/writing.
- **Strict Typing**: Adhere strictly to TypeScript conventions. Avoid using `any` at all costs. Ensure `pnpm run check:types` passes without errors.

### 3. Step-by-Step Execution (Systematic Thinking)

- **Think before you act**: Before writing complex Agent logic or cross-component state (Zustand + Draggable PiP window), briefly explain your execution plan in 1-2 sentences.
- **Incremental progress**: Do not attempt to write or modify 10 files simultaneously. Follow our predefined Implementation Phases step-by-step. Close the loop on the current module before moving to the next.
- **Self-correction**: If you encounter runtime or type errors, read the full Error Log first. Analyze the root cause deeply before attempting a fix. Do not guess blindly.

### 4. Architectural Integrity & Context Awareness

- **Read before write**: Always use MCP tools or system commands to read the existing logic of a file before modifying it.
- **Sacred Boundaries**:
  - **NEVER** import Node.js native modules, `playwright`, or `bullmq` into React Client Components (`"use client"`). Keep the frontend and backend strictly decoupled.
  - **NEVER** substitute `framer-motion` animations with basic CSS transitions or plain text. The UI must strictly maintain its cyberpunk, high-tech aesthetic.
- **Stack Purity**: Stick entirely to standard practices for Next.js 16 (App Router), Tailwind CSS, shadcn/ui, Zustand, Prisma, and BullMQ. Do NOT introduce unauthorized third-party alternative libraries.

---

## 🛠️ Project Environment & Command Dictionary

- **Runtime Environment**: Next.js 16.2.6 (Turbopack supported), Node.js, `pnpm`.
- **UI/UX Paradigm**: Cyber/Hacker aesthetic, global Dark Mode (zinc/slate palette), extreme Glassmorphism (`backdrop-blur-xl`), and fluid physics-based animations (`framer-motion`).
- **Core Architecture**: 3-Column Immersive Layout + Draggable Live View (PiP); Independent Node Worker (BullMQ + Playwright) driving the Autonomous Agent.

**Valid verification commands you can execute:**

- Start frontend server: `pnpm dev`
- Run type checking: `pnpm check:types` (MUST be executed after major refactoring)
- Push DB schema: `pnpx prisma db push`
- Run linter: `pnpm lint`

### 5. Failure Handling & Root Cause Analysis

- Reproduce issues before fixing
- Fix root causes, not symptoms
- Observe before retrying
- Never blindly guess
- Validate assumptions with evidence
