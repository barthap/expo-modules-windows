#!/usr/bin/env bash
# Build script for the HostFXR proof-of-concept (bash version for Git Bash / MSYS2)
# Run from the repo root: bash test/hostfxr-poc/build.sh
# Or from this directory: bash build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Building HostFXR PoC ==="
echo ""

# Step 1: Build the C# class library
echo "[1/3] Building C# class library..."
dotnet build "$REPO_ROOT/dotnet/Expo.Modules.HostTest/Expo.Modules.HostTest.csproj" -c Release
echo ""

# Step 2: Configure CMake
echo "[2/3] Configuring CMake..."
mkdir -p "$SCRIPT_DIR/build"
cmake -S "$SCRIPT_DIR" -B "$SCRIPT_DIR/build" -A x64
echo ""

# Step 3: Build C++ project
echo "[3/3] Building C++ project..."
cmake --build "$SCRIPT_DIR/build" --config Release
echo ""

echo "=== Build complete ==="
echo ""
echo "Executable: $SCRIPT_DIR/build/Release/hostfxr_poc.exe"
echo ""
echo "To run:"
echo "  cd $REPO_ROOT"
echo "  ./test/hostfxr-poc/build/Release/hostfxr_poc.exe"
echo ""
