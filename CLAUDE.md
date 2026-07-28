# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository (`sandsd01/sandsd01`) currently has no application source code, build configuration, or dependency manifests — it is a blank slate for a web application project. Once code is added, this file should be updated to reflect:

- The language(s) and framework(s) in use
- Commands to build, lint, run, and test the project (including how to run a single test)
- The high-level architecture and how major components fit together
- Any project-specific conventions

## Subagent pipeline

This project defines 7 subagents under `.claude/agents/`. For any new feature or system request, invoke them in this order:

1. **planner-agent** — breaks the request into a plan and task list for the other agents. Always run first for anything beyond a trivial one-line fix.
2. **database-agent** — designs schema, writes migrations, defines models.
3. **backend-agent** — implements API endpoints, business logic, auth/authorization.
4. **frontend-agent** — builds UI screens/components against the backend API.
5. **qa-agent** — writes and runs tests covering the golden path and edge cases.
6. **devops-agent** — sets up build/run/CI/deployment configuration.
7. **docs-agent** — updates README/API docs/CLAUDE.md to match what was actually built.

Each agent should hand off to the next once its stage is done, rather than trying to do the whole feature itself. Skip stages that clearly don't apply to a given request (e.g. a pure copy change doesn't need database-agent), but default to running planner-agent first so that decision is made explicitly rather than skipped by accident.

### Role-based access

Role/permission concerns (e.g. admin vs staff) must be enforced in the database schema and backend, not just hidden in the UI. See database-agent and backend-agent for specifics.
