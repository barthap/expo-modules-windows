# expo-desktop Windows Example

This is a checked-in Windows development app for `expo-modules-windows-core`.
It is intentionally separate from the package under
`packages/expo-modules-windows-core`.

Use this app for manual iteration on the native Windows package, the C# module
DSL, and the Expo module host object behavior. The acceptance proof remains the
fresh-app E2E script at `scripts/e2e/windows-localcounter-smoke.ps1`.

## Run

From the repo root:

```powershell
bun install
cd apps\expo-desktop-windows-example
bun run autolink:windows
bun run windows
```

The app contains a local C# Expo module under `modules\ExampleModule` and a
Windows RNW app under `windows\`.

## Boundaries

- Bun is the only package manager.
- Android and iOS template projects are intentionally not restored.
- The app is private and must not be published.
- Generated Windows build output stays ignored by the repo root `.gitignore`.
