# Implementation Prompts — Index

Detailed prompts for each implementation step live in `docs/prompts/`.
Use these with Plan agents or implementation agents in new sessions.

## Status

| # | Prompt | Status | File |
|---|--------|--------|------|
| — | HostFXR PoC (standalone) | **DONE** — all tests pass | `docs/HOSTFXR_POC_RESULTS.md` |
| — | DSL Research | **DONE** | `docs/RESEARCH_DSL.md` |
| — | Autolinking Research | **DONE** | `docs/RESEARCH_AUTOLINKING.md` |
| 1 | C# Core Library | **DONE** (fc390b2) | `docs/prompts/01_CSHARP_CORE_LIBRARY.md` |
| 2 | C++ ExpoModulesHostObject | **DONE** (fd61716) | `docs/prompts/02_CPP_HOST_OBJECT.md` |
| 3 | Build Integration | **DONE** (90c7b07) | `docs/prompts/03_BUILD_INTEGRATION.md` |
| 4 | Autolinking Fork | **DONE** (07f9aae) | `docs/prompts/04_AUTOLINKING_FORK.md` |
| 5 | Autolinking ↔ Build Integration | **TODO** — next up | `docs/prompts/05_AUTOLINKING_BUILD_INTEGRATION.md` |

## Dependency Graph

```
HostFXR PoC (done) ──┐
DSL Research (done) ──┼──→ [1] C# Core Library (done) ──→ [2] C++ HostObject (done) ──→ [3] Build Integration (done) ─┐
                      │                                                                                              │
Autolinking Research ─┴──→ [4] Autolinking Fork (done) ────────────────────────────────────────────────────────────┴──→ [5] Autolinking ↔ Build
```

## How to Use

1. Start a new session (fresh context)
2. Read the relevant prompt file: `docs/prompts/0X_*.md`
3. The prompt contains full context — no other reading needed
4. Reference research docs if the agent needs more detail
