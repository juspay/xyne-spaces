# Xyne Spaces - Project Guidelines

This is the main entry point for AI/LLM agents working in this repository. Read this file first to understand the project structure, then navigate to the appropriate subdirectory guidelines for detailed information.

---

## How to Read These Guidelines

### For LLM Agents

1. **Start here** - Read this file for overall project understanding
2. **Identify the area of change** - Determine if you're working on backend, dashboard, or both
3. **Read the specific guidelines**:
   - **Backend changes**: Read [`backend/docs/guidelines/xyne.md`](backend/docs/guidelines/xyne.md)
   - **Dashboard changes**: Read [`dashboard/docs/guidelines/xyne.md`](dashboard/docs/guidelines/xyne.md)
   - **Both**: Read both guideline files before making changes
4. **Cross-reference** - Backend and dashboard guidelines reference each other for shared concerns (Zero sync, shared types)

### Reading Order

| Task | Files to Read |
|------|---------------|
| Backend-only changes | This file → `backend/docs/guidelines/xyne.md` → relevant sub-docs |
| Dashboard-only changes | This file → `dashboard/docs/guidelines/xyne.md` → relevant sub-docs |
| Full-stack changes | This file → Both guideline files → Zero docs in both |
| Zero/real-time sync | Both guideline files + `backend/docs/guidelines/zero/` + `dashboard/docs/guidelines/zero/` |

---

## Project Structure

This is a monorepo with multiple workspaces:

```
xyne-spaces/
├── backend/                    # Node.js API server (Hono + Prisma)
│   └── docs/guidelines/        # Backend development guidelines
│       └── xyne.md             # 👈 START HERE for backend work
├── dashboard/                  # React web app (Vite + Zero)
│   └── docs/guidelines/        # Dashboard development guidelines
│       └── xyne.md             # 👈 START HERE for dashboard work
├── shared/                     # Shared types and Zero schema
├── apps/
│   ├── xyne-spaces/            # React Native mobile app
│   └── public-web/             # Public marketing site
├── framework/                  # Agentic AI framework library
├── electron/                   # Desktop app wrapper
├── xyne-automation/            # Playwright + Cucumber E2E tests
└── guidelines/                 # General repo guidelines
    └── AGENTS.md               # Code style for all agents
```

**Remember**: Always start with this file, then dive into the specific workspace guidelines based on what you're working on.
