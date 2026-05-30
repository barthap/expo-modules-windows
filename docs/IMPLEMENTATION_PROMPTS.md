# Implementation Status

This repo is past the original step-by-step implementation phase.
The earlier agent prompts under `docs/prompts/` were useful while building the
MVP, but they are no longer the source of truth for the project state and have
been retired.

## Current State

The core MVP stack is implemented in-tree:

| Area | Status | Notes |
|------|--------|-------|
| HostFXR proof of concept | Done | Standalone host loading validated before integrating with RNW. |
| C# core library (`Expo.Modules.Core`) | Done | Module DSL, registry, JSON type conversion, lifecycle, events, interop entry points. |
| C++ host bridge | Done | Single TurboModule, JSI HostObject, HostFXR runtime loader, async callback path. |
| Expo shared C++ layer | Done | Vendored from expo-desktop (SDK 54, MSVC-patched). EventEmitter, NativeModule, SharedObject, SharedRef, LazyObject. See [EXPO_DESKTOP.md](EXPO_DESKTOP.md). |
| Build integration | Done | Managed deployment targets, `nethost` packaging, VS/MSIX build path working. |
| Windows Expo autolinking | Done | `autolink-windows` command, generated hub project, `.sln`/`.vcxproj` patching, generated provider and deploy targets. |

## What Still Needs Polish

These are not new platform pillars, but they still matter:

- Tighten the consumer packaging story so the Windows autolinking CLI is
  delivered and discoverable outside this repo.
- Hook the Expo autolinking command into the example app workflow so a fresh
  clone does not depend on pre-generated local artifacts.
- Continue aligning docs with the implemented Step 5 build shape.

## Next Major Milestones

1. **expo-modules-core TS compatibility**
   Verify that `requireNativeModule()` from the upstream `expo-modules-core`
   TypeScript package works with our native layer, now that it matches the
   upstream JS API surface.

2. **SharedObject for C# objects**
   Wire the SharedObject releaser to call back into C# to release managed
   handles when the JS object is GC'd.

3. **NativeAOT mode and typed dispatch**
   Replace the HostFXR-only MVP path with a production-grade alternative based
   on source generation, typed exports, and NativeAOT-friendly marshaling.
   See `docs/DESIGN.md`, Phase 3.

4. **View / native React component support**
   Add Fabric-compatible native view support from C# with a view DSL and C++
   view manager bridge. See `docs/DESIGN.md`, Phase 4 and `docs/DESIGN_VIEWS.md`.

5. **Developer experience and packaging**
   Templates, NuGet packaging, hot reload, and example modules remain a later
   phase after the two platform milestones above. See `docs/DESIGN.md`, Phase 5.

## Recommended Docs To Read

- `docs/DESIGN.md`: architecture and long-term roadmap
- `docs/BUILD_SYSTEM.md`: current build and solution shape
- `docs/AUTOLINKING.md`: current Windows autolinking flow
- `docs/CODE_FLOW.md`: runtime call path from JS to C#
- `docs/DESIGN_VIEWS.md`: detailed view-system design and open questions
