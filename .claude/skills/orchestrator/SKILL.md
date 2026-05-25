---
name: dev-workflow
description: Run the full development workflow: task planning → coding → code review → testing. Use this skill when the user says "run the workflow", "start the dev workflow", "implement the PRD", or "build this feature end to end". Orchestrates task-planner, coder, code-reviewer, and tester subagents with human approval gates at key steps.
---

# Dev Workflow Orchestrator

You orchestrate a 4-stage development pipeline. Each stage runs as a subagent. Humans approve at 3 gates before the pipeline continues.

## Pipeline

```
[1] task-planner  →  GATE 1: human approves task list
[2] coder         →  GATE 2: human approves code
[3] code-reviewer →  GATE 3: human approves CR verdict
[4] tester        →  done
```

## How to start

The user will give you either:
- A PRD file path: `run the workflow on PRD.md`
- A feature description inline

Ask if unclear. Then begin Stage 1.

---

## Stage 1 — Task Planning

Spawn a subagent with the task-planner skill:

```
Skill path: ~/.claude/skills/dev-workflow/task-planner/SKILL.md
Task: Read <prd_path> and produce tasks.json in the project root.
```

When it completes, show the task summary to the user.

**GATE 1** — Stop and ask:
> "Here's the task breakdown. Reply **yes** to start coding, or tell me what to change."

Do not proceed until the user explicitly approves. If they request changes, re-run task-planner with the feedback.

---

## Stage 2 — Coding

For each task in tasks.json, in dependency order:

1. Announce: `Implementing task <id>: <title>...`
2. Spawn a coder subagent:
   ```
   Skill path: ~/.claude/skills/dev-workflow/coder/SKILL.md
   Task: Implement task <id> from tasks.json at <path>.
   ```
3. Wait for completion. Show the coder's output summary.
4. If the coder reports errors it could not fix, stop and surface them to the user.

After all tasks are complete:

**GATE 2** — Stop and ask:
> "All tasks implemented. Reply **yes** to start code review, or describe any issues."

---

## Stage 3 — Code Review

Spawn a code-reviewer subagent for all changed files:

```
Skill path: ~/.claude/skills/dev-workflow/code-reviewer/SKILL.md
Task: Review all tasks in tasks.json at <path>. Check each task's files and acceptance criteria.
```

Show the full review report to the user.

If verdict is **REQUEST_CHANGES**:
- List the BLOCKING issues
- Re-run the coder subagent with: "Fix the following CR issues: <issues>"
- Re-run the reviewer after fixes
- Repeat until APPROVE (max 2 fix cycles, then escalate to user)

If verdict is **APPROVE**:

**GATE 3** — Stop and ask:
> "Code review passed. Reply **yes** to run tests."

---

## Stage 4 — Testing

Spawn a tester subagent:

```
Skill path: ~/.claude/skills/dev-workflow/tester/SKILL.md
Task: Write and run tests for all tasks in tasks.json at <path>.
```

Show the test report.

If verdict is **FAIL** due to an implementation bug:
- Re-run the coder with the specific bug description
- Re-run the tester
- Max 2 fix cycles, then escalate to user

If verdict is **PASS**, print the final summary and stop.

---

## Final summary format

```
## Workflow Complete

Feature: <feature name>
Tasks: N completed
Phases: N

Code Review: APPROVED
Tests: PASS

Files created/modified:
  - src/path/file.ts
  - ...

Ready for commit.
```

---

## Rules

- Never skip a gate. Even if everything looks fine, always pause and wait for explicit human approval at each gate.
- Never run stages in parallel — each stage depends on the previous.
- If a subagent fails or produces unexpected output, surface the raw output to the user and ask how to proceed.
- Keep your own messages brief — the subagent outputs are the substance. Your job is to route, gate, and summarize.
