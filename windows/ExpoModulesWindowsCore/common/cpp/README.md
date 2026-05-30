# Expo Shared C++ Layer (Vendored)

This directory contains Expo's platform-independent C++ runtime layer, vendored
from the [expo-desktop](https://github.com/shirakaba/expo-desktop) project.

**Source:** https://github.com/shirakaba/expo-desktop/tree/bcdf48576fe52db755b5277827821df53505dc88/packages/expo-desktop-modules-core/common/cpp

**Upstream commit:** [`bcdf485`](https://github.com/shirakaba/expo-desktop/commit/bcdf48576fe52db755b5277827821df53505dc88)

**Expo SDK version:** 54

These files are MSVC-patched by expo-desktop (`#import` replaced with
`#include`, `<functional>` added, non-Apple include paths). They are taken
as-is with no further modifications.

Do NOT modify files in this directory. To update, re-vendor from expo-desktop
at a newer commit. See `docs/EXPO_DESKTOP.md` for the update process.
