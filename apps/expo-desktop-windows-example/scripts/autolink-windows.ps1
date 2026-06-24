[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sln = Join-Path $AppRoot 'windows\ExpoModulesWindowsCoreExample.sln'
$appProj = Join-Path $AppRoot 'windows\ExpoModulesWindowsCoreExample\ExpoModulesWindowsCoreExample.vcxproj'
$expoCoreProject = Join-Path $AppRoot 'node_modules\expo-modules-windows-core\dotnet\Expo.Modules.Core\Expo.Modules.Core.csproj'

bunx expo-modules-windows-core autolink-windows `
  --sln $sln `
  --app-proj $appProj `
  --expo-core-project $expoCoreProject
