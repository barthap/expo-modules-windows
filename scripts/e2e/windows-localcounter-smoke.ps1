[CmdletBinding()]
param(
  [string]$RepoRoot = '',
  [string]$WorkRoot = (Join-Path ([System.IO.Path]::GetTempPath()) 'expo-modules-windows-core-e2e'),
  [string]$AppName = 'CodexProofExpoModulesWindowsCoreE2E',
  [string]$ExistingAppPath = '',
  [switch]$SkipCreateApp,
  [switch]$KeepApp,
  [int]$TimeoutSeconds = 240,
  [int]$MetroPort = 8081,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
$ArtifactsRoot = Join-Path $WorkRoot 'artifacts'
$ArtifactsDir = Join-Path $ArtifactsRoot $RunId
$ProofFileName = 'expo-modules-windows-core-localcounter-proof.json'
$TempProofPath = Join-Path ([System.IO.Path]::GetTempPath()) $ProofFileName
$MetroProcess = $null
$AppPath = $null
$RunStartedAt = Get-Date
$registration = $null
if (-not $RepoRoot) {
  $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
}
$PackageRoot = $null

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message"
}

function Write-FailureDiagnostics {
  param(
    [datetime]$Since,
    [string]$CurrentAppName,
    [object]$Registration,
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )

  $diagnosticsPath = Join-Path $ArtifactsDir 'failure-diagnostics.txt'
  $packagePattern = if ($Registration -and $Registration.PackageFamilyName) {
    [regex]::Escape([string]$Registration.PackageFamilyName)
  } else {
    [regex]::Escape($CurrentAppName)
  }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("Failure diagnostics captured at $(Get-Date -Format o)")
  $lines.Add("Run started at $($Since.ToString('o'))")
  $lines.Add("AppName: $CurrentAppName")
  if ($ErrorRecord) {
    $lines.Add('')
    $lines.Add('== Script Error ==')
    $lines.Add($ErrorRecord.Exception.ToString())
    if ($ErrorRecord.ScriptStackTrace) {
      $lines.Add('')
      $lines.Add('== Script Stack Trace ==')
      $lines.Add($ErrorRecord.ScriptStackTrace)
    }
  }
  if ($Registration) {
    $lines.Add("PackageFullName: $($Registration.PackageFullName)")
    $lines.Add("PackageFamilyName: $($Registration.PackageFamilyName)")
    $lines.Add("AppUserModelId: $($Registration.AppUserModelId)")
    $lines.Add("Manifest: $($Registration.Manifest)")
  }

  $lines.Add('')
  $lines.Add('== Processes ==')
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like "$CurrentAppName*" -or $_.ProcessName -match 'node|bun' } |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize |
    Out-String |
    ForEach-Object { $lines.Add($_) }

  $lines.Add('')
  $lines.Add('== AppX Package ==')
  Get-AppxPackage -Name $CurrentAppName -ErrorAction SilentlyContinue |
    Select-Object Name, PackageFullName, PackageFamilyName, InstallLocation, Status |
    Format-List |
    Out-String |
    ForEach-Object { $lines.Add($_) }

  $lines.Add('')
  $lines.Add('== AppModel Runtime Events ==')
  Get-WinEvent -LogName 'Microsoft-Windows-AppModel-Runtime/Admin' -MaxEvents 300 -ErrorAction SilentlyContinue |
    Where-Object { $_.TimeCreated -ge $Since -and ($_.Message -match $packagePattern -or $_.Message -match [regex]::Escape($CurrentAppName)) } |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List |
    Out-String |
    ForEach-Object { $lines.Add($_) }

  $lines.Add('')
  $lines.Add('== Application Events ==')
  Get-WinEvent -LogName Application -MaxEvents 500 -ErrorAction SilentlyContinue |
    Where-Object { $_.TimeCreated -ge $Since -and ($_.Message -match [regex]::Escape($CurrentAppName) -or $_.Message -match 'ExpoModules|ReactNative|Application Error|\.NET Runtime|ucrtbase|KERNELBASE') } |
    Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message |
    Format-List |
    Out-String |
    ForEach-Object { $lines.Add($_) }

  $lines | Set-Content -LiteralPath $diagnosticsPath
  Write-Host "Failure diagnostics written to $diagnosticsPath"
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-LoggedCommand {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )

  $safeLabel = $Label -replace '[^A-Za-z0-9_.-]', '_'
  $logPath = Join-Path $ArtifactsDir "$safeLabel.log"
  "# $FilePath $($Arguments -join ' ')" | Set-Content -LiteralPath $logPath
  Write-Host "[$Label] $FilePath $($Arguments -join ' ')"

  $oldValues = @{}
  foreach ($key in $Environment.Keys) {
    $oldValues[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
  }

  Push-Location $WorkingDirectory
  $oldErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments 2>&1 | ForEach-Object { "$($_)" } | Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
      throw "Command '$Label' failed with exit code $LASTEXITCODE. See $logPath"
    }
  }
  finally {
    $ErrorActionPreference = $oldErrorActionPreference
    Pop-Location
    foreach ($key in $Environment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $oldValues[$key], 'Process')
    }
  }
}

function Invoke-LoggedCommandAllowFailure {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )

  try {
    Invoke-LoggedCommand -Label $Label -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory -Environment $Environment
    return 0
  }
  catch {
    Write-Host $_.Exception.Message
    return $LASTEXITCODE
  }
}

function Wait-ForHttpOk {
  param([string]$Url, [int]$Timeout)

  $deadline = (Get-Date).AddSeconds($Timeout)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    }
    catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for $Url"
}

function Wait-ForFile {
  param([string]$Path, [int]$Timeout)

  $deadline = (Get-Date).AddSeconds($Timeout)
  do {
    if (Test-Path -LiteralPath $Path) {
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for proof file $Path"
}

function Wait-ForLocalCounterProof {
  param([string]$Path, [int]$Timeout, [string]$AppPath, [int]$MetroPort)

  $inspectorScript = Join-Path $ArtifactsDir 'hermes-localcounter-proof.cjs'
  $inspectorResult = Join-Path $ArtifactsDir 'hermes-localcounter-inspector-result.json'
  @'
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');

const [, , port, resultPath] = process.argv;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error(`Timed out requesting ${url}`));
    });
  });
}

async function main() {
  const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
  const target = list.find((item) => item.webSocketDebuggerUrl);
  if (!target) {
    throw new Error('No Hermes inspector target with webSocketDebuggerUrl was found.');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Runtime.evaluate result.')), 10000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(
        JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            returnByValue: true,
            expression: `(() => {
              try {
                if (typeof globalThis.__expoWindowsLocalCounterProof !== 'function') {
                  return JSON.stringify({
                    error: 'globalThis.__expoWindowsLocalCounterProof is not installed',
                    moduleNames: globalThis.expo?.modules ? Object.keys(globalThis.expo.modules) : [],
                    initError: globalThis.expo?.__initError ?? null
                  });
                }
                return globalThis.__expoWindowsLocalCounterProof();
              } catch (error) {
                return JSON.stringify({ error: String(error), stack: error && error.stack });
              }
            })()`,
          },
        })
      );
    });
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id !== 2) {
        return;
      }
      clearTimeout(timeout);
      resolve(message);
      ws.close();
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  fs.writeFileSync(resultPath, JSON.stringify({ target, result }, null, 2));
  const value = result?.result?.result?.value;
  if (typeof value !== 'string') {
    throw new Error(`Hermes proof did not return a string result: ${JSON.stringify(result)}`);
  }
  const proof = JSON.parse(value);
  if (proof.error || proof.value !== 1 || proof.countAfter !== 1 || proof.initError !== null) {
    throw new Error(`Hermes proof failed: ${JSON.stringify(proof)}`);
  }
}

main().catch((error) => {
  fs.writeFileSync(resultPath, JSON.stringify({ error: String(error), stack: error && error.stack }, null, 2));
  process.exit(1);
});
'@ | Set-Content -LiteralPath $inspectorScript

  $deadline = (Get-Date).AddSeconds($Timeout)
  do {
    if (Test-Path -LiteralPath $Path) {
      return
    }

    $oldErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & node $inspectorScript ([string]$MetroPort) $inspectorResult 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $Path)) {
        return
      }
    }
    finally {
      $ErrorActionPreference = $oldErrorActionPreference
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  $lastInspector = if (Test-Path -LiteralPath $inspectorResult) { Get-Content -Raw -LiteralPath $inspectorResult } else { '<no inspector result>' }
  throw "Timed out waiting for proof file $Path. Last Hermes inspector result: $lastInspector"
}

function Assert-ProofJson {
  param([string]$Path)

  $proof = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json

  if ($proof.value -ne 1) {
    throw "Expected LocalCounter.increment() to return 1, got '$($proof.value)'."
  }
  if ($proof.countAfter -ne 1) {
    throw "Expected LocalCounter.getCount() to return 1, got '$($proof.countAfter)'."
  }
  if ($null -ne $proof.initError) {
    throw "Expected global.expo initError to be null, got '$($proof.initError)'."
  }
  foreach ($name in @('LocalCounter', 'NativeModulesProxy', 'ExpoAsset', 'ExponentConstants')) {
    if ($proof.moduleNames -notcontains $name) {
      throw "Expected global.expo.modules to contain '$name'. Saw: $($proof.moduleNames -join ', ')"
    }
  }

  Write-Host 'Proof JSON validated:'
  $proof | ConvertTo-Json -Depth 6 | Write-Host
}

function Get-RelativePathCompat {
  param([string]$BasePath, [string]$TargetPath)

  $resolvedBase = (Resolve-Path $BasePath).Path
  if (-not $resolvedBase.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedBase += [System.IO.Path]::DirectorySeparatorChar
  }
  $resolvedTarget = (Resolve-Path $TargetPath).Path
  $baseUri = New-Object System.Uri($resolvedBase)
  $targetUri = New-Object System.Uri($resolvedTarget)
  return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

function Reset-AppPackageManagerState {
  param([string]$AppPath)

  $packageJsonPath = Join-Path $AppPath 'package.json'
  if (Test-Path -LiteralPath $packageJsonPath) {
    $packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
    if ($packageJson.dependencies -and ($packageJson.dependencies.PSObject.Properties.Name -contains 'expo-modules-windows-core')) {
      $packageJson.dependencies.PSObject.Properties.Remove('expo-modules-windows-core')
      $packageJson | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $packageJsonPath
    }
  }

  foreach ($lockFile in @('bun.lock', 'bun.lockb', 'yarn.lock')) {
    $lockPath = Join-Path $AppPath $lockFile
    if (Test-Path -LiteralPath $lockPath) {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
}

function New-ExpoDesktopApp {
  param([string]$ParentDir, [string]$Name)

  Write-Step "Creating fresh expo-desktop app $Name"
  New-Item -ItemType Directory -Force $ParentDir | Out-Null

  # Prime bunx's expo-desktop cache, then call the package API directly. The
  # public create-app command is currently interactive even when all app name
  # flags are provided, because package-manager selection has no CLI flag.
  Invoke-LoggedCommand `
    -Label 'cache-expo-desktop-cli' `
    -FilePath 'bunx' `
    -Arguments @('expo-desktop@latest', '--version') `
    -WorkingDirectory $ParentDir

  $expoDesktopDir = Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Directory -Filter 'bunx-*-expo-desktop@latest' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName 'node_modules\expo-desktop' } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'build\create-app\create-expo-desktop-app.js') } |
    Select-Object -First 1

  if (-not $expoDesktopDir) {
    throw 'Could not find bunx-cached expo-desktop package for programmatic app creation.'
  }

  $createScript = Join-Path $ArtifactsDir 'create-expo-desktop-app.mjs'
  @'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , parentDir, appName, expoDesktopDir] = process.argv;
process.chdir(parentDir);

const moduleUrl = pathToFileURL(
  path.join(expoDesktopDir, 'build', 'create-app', 'create-expo-desktop-app.js')
);
const { createExpoDesktopApp } = await import(moduleUrl.href);

await createExpoDesktopApp({
  localDev: false,
  name: {
    filesafeName: appName,
    displayName: appName.replace(/([a-z])([A-Z])/g, '$1 $2'),
    rdns: `com.codex.${appName.toLowerCase()}`,
  },
  packageManager: 'bun',
  templates: {},
  versions: {
    expoMajor: 54,
    expoBlankTypeScript: '54.0.45',
    minor: 81,
    mobile: '0.81.6',
    windows: '0.81.29',
    macos: '0.81.7',
  },
});
'@ | Set-Content -LiteralPath $createScript

  $createExitCode = Invoke-LoggedCommandAllowFailure `
    -Label 'create-expo-desktop-app-programmatic' `
    -FilePath 'node' `
    -Arguments @($createScript, $ParentDir, $Name, $expoDesktopDir) `
    -WorkingDirectory $ParentDir

  $createdAppPath = Join-Path $ParentDir $Name
  $createdWindowsDir = Join-Path $createdAppPath 'windows'
  $createdPackageJson = Join-Path $createdAppPath 'package.json'
  $createdSln = Get-ChildItem -LiteralPath $createdWindowsDir -Filter '*.sln' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($createExitCode -ne 0 -and (Test-Path -LiteralPath $createdPackageJson) -and $createdSln) {
    Write-Host "expo-desktop app creation exited $createExitCode after creating the app; continuing because package.json and Windows solution exist."
    return
  }
  if ($createExitCode -ne 0) {
    throw "expo-desktop app creation failed before creating a usable app at $createdAppPath."
  }
}

function Write-LocalCounterModule {
  param([string]$AppPath)

  Write-Step 'Writing local C# Expo module LocalCounter'
  $moduleDir = Join-Path $AppPath 'modules\LocalCounter'
  New-Item -ItemType Directory -Force $moduleDir | Out-Null

  @'
using Expo.Modules.Core;
using System.IO;

namespace LocalCounterModule;

public sealed class LocalCounterModule : Module
{
    private int _count;

    public override ModuleDefinition Definition() => new()
    {
        Name("LocalCounter"),
        Function<int>("increment", () => ++_count),
        Function<int>("getCount", () => _count),
        Function<string, string>("recordProof", (json) =>
        {
            var path = Path.Combine(Path.GetTempPath(), "expo-modules-windows-core-localcounter-proof.json");
            File.WriteAllText(path, json);
            return path;
        }),
        Constants(new { initialValue = 0, platform = "windows" })
    };
}
'@ | Set-Content -LiteralPath (Join-Path $moduleDir 'LocalCounterModule.cs')

  @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0-windows10.0.19041.0</TargetFramework>
    <AssemblyName>LocalCounterModule</AssemblyName>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>LocalCounterModule</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(ExpoModulesCoreProject)" />
    <PackageReference Include="Microsoft.WindowsAppSDK" Version="1.7.250401001" ExcludeAssets="build;buildTransitive" />
  </ItemGroup>
</Project>
'@ | Set-Content -LiteralPath (Join-Path $moduleDir 'LocalCounterModule.csproj')

  @'
{
  "platforms": ["windows"],
  "windows": {
    "modules": ["LocalCounterModule.LocalCounterModule"],
    "projectPath": "LocalCounterModule.csproj"
  }
}
'@ | Set-Content -LiteralPath (Join-Path $moduleDir 'expo-module.config.json')
}

function Write-ProofAppTsx {
  param([string]$AppPath)

  Write-Step 'Writing JS proof harness into App.tsx'
  @'
import { StatusBar } from 'expo-status-bar';
import { install as installExpoModulesWindowsCore } from 'expo-modules-windows-core';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

function runLocalCounterProof() {
  installExpoModulesWindowsCore();
  const expoGlobal = (globalThis as any).expo;
  const modules = expoGlobal?.modules;
  const localCounter = modules?.LocalCounter;
  const value = localCounter?.increment?.();
  const countAfter = localCounter?.getCount?.();
  const availableStub = ['NativeModulesProxy', 'ExpoAsset', 'ExponentConstants'].find(
    (name) => modules?.[name] != null
  );
  const proof = {
    value,
    countAfter,
    availableStub,
    localCounterKeys: localCounter ? Object.keys(localCounter) : [],
    moduleNames: modules ? Object.keys(modules) : [],
    initError: expoGlobal?.__initError ?? null,
  };
  localCounter?.recordProof?.(JSON.stringify(proof, null, 2));
  console.log('[LocalCounterProof]', proof);
  return JSON.stringify(proof);
}

(globalThis as any).__expoWindowsLocalCounterProof = runLocalCounterProof;

export default function App() {
  const [result, setResult] = useState('Waiting for LocalCounter...');
  const [stubs, setStubs] = useState('Checking expo-desktop stubs...');

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const proof = JSON.parse(runLocalCounterProof());

        setResult(`LocalCounter.increment() => ${String(proof.value)}; getCount() => ${String(proof.countAfter)}`);
        setStubs(`expo-desktop stub: ${proof.availableStub ?? 'not found'}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setResult(`LocalCounter error: ${message}`);
        console.error('[LocalCounterProof]', error);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Expo Modules Windows Core Proof</Text>
      <Text style={styles.result}>{result}</Text>
      <Text style={styles.result}>{stubs}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    color: '#111',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  result: {
    color: '#111',
    fontSize: 16,
    textAlign: 'center',
  },
});
'@ | Set-Content -LiteralPath (Join-Path $AppPath 'App.tsx')
}

function Write-ExpoVirtualMetroEntry {
  param([string]$AppPath)

  Write-Step 'Writing Expo virtual Metro entry for Windows debug bundle'
  $expoDir = Join-Path $AppPath '.expo'
  New-Item -ItemType Directory -Force $expoDir | Out-Null

  @'
import { registerRootComponent } from 'expo';
import App from '../App';

registerRootComponent(App);
'@ | Set-Content -LiteralPath (Join-Path $expoDir '.virtual-metro-entry.js')
}

function Find-WindowsProjectFiles {
  param([string]$AppPath)

  $windowsDir = Join-Path $AppPath 'windows'
  $sln = Get-ChildItem -LiteralPath $windowsDir -Filter '*.sln' -File | Select-Object -First 1
  $vcxproj = Get-ChildItem -LiteralPath $windowsDir -Filter '*.vcxproj' -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    Select-Object -First 1

  if (-not $sln -or -not $vcxproj) {
    throw "Could not find Windows .sln/.vcxproj under $windowsDir. Did expo-desktop create/prebuild Windows files?"
  }

  return [pscustomobject]@{
    WindowsDir = $windowsDir
    Solution = $sln.FullName
    Project = $vcxproj.FullName
  }
}

function Stop-ExistingAppProcesses {
  param([string]$ProjectPath)

  $processName = [System.IO.Path]::GetFileNameWithoutExtension($ProjectPath)
  if (-not $processName) {
    return
  }

  $running = Get-Process -Name $processName -ErrorAction SilentlyContinue
  if ($running) {
    Write-Step "Stopping existing app process $processName before build"
    Stop-Process -Name $processName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Stop-ProcessesUsingPath {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  $running = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Path*" }

  if (-not $running) {
    return
  }

  Write-Step "Stopping processes using app path $Path"
  foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

function Stop-ProcessUsingPort {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
  if ($processIds.Count -eq 0) {
    return
  }

  Write-Step "Stopping existing process on Metro port $Port"
  foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

function Remove-InstalledAppPackage {
  param([string]$Name)

  if (-not $Name) {
    return
  }

  $packages = @(Get-AppxPackage -Name $Name -ErrorAction SilentlyContinue)
  if ($packages.Count -eq 0) {
    return
  }

  Write-Step "Removing existing AppX package registration $Name"
  foreach ($package in $packages) {
    Remove-AppxPackage -Package $package.PackageFullName -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

function Register-And-LaunchApp {
  param([string]$WindowsDir)

  Write-Step 'Registering AppX layout and launching app'
  $manifest = Get-ChildItem -LiteralPath $WindowsDir -Filter 'AppxManifest.xml' -Recurse -File |
    Where-Object { $_.FullName -match '\\bin\\x64\\Debug\\' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $manifest) {
    throw "Could not find built AppxManifest.xml under $WindowsDir"
  }

  [xml]$manifestXml = Get-Content -Raw -LiteralPath $manifest.FullName
  $identityName = [string]$manifestXml.Package.Identity.Name
  $applicationId = [string]($manifestXml.Package.Applications.Application | Select-Object -First 1).Id
  Remove-InstalledAppPackage -Name $identityName

  Add-AppxPackage -Path $manifest.FullName -Register -ForceApplicationShutdown -ErrorAction Stop

  $package = Get-AppxPackage -Name $identityName |
    Sort-Object InstallLocation -Descending |
    Select-Object -First 1

  if (-not $package) {
    throw "AppX package '$identityName' was registered, but Get-AppxPackage could not find it."
  }

  $aumid = "$($package.PackageFamilyName)!$applicationId"
  Start-Process "shell:AppsFolder\$aumid"
  return [pscustomobject]@{
    Manifest = $manifest.FullName
    PackageFullName = $package.PackageFullName
    PackageFamilyName = $package.PackageFamilyName
    AppUserModelId = $aumid
  }
}

try {
  if ([System.Environment]::OSVersion.Platform -ne 'Win32NT') {
    throw 'This smoke test must run on Windows.'
  }

  $RepoRoot = (Resolve-Path $RepoRoot).Path
  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'package.json'))) {
    throw "RepoRoot does not look like this repository: $RepoRoot"
  }
  $PackageRoot = Join-Path $RepoRoot 'packages\expo-modules-windows-core'
  if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot 'package.json'))) {
    throw "Could not find expo-modules-windows-core package workspace at $PackageRoot"
  }
  $packageJson = Get-Content -Raw -LiteralPath (Join-Path $PackageRoot 'package.json') | ConvertFrom-Json
  if ($packageJson.name -ne 'expo-modules-windows-core') {
    throw "Package workspace at $PackageRoot is named '$($packageJson.name)', expected expo-modules-windows-core."
  }

  New-Item -ItemType Directory -Force $ArtifactsDir | Out-Null
  Assert-Command 'bun'
  Assert-Command 'bunx'
  Assert-Command 'powershell'

  if ($ValidateOnly) {
    Write-Host 'Script validation passed. No app was created because -ValidateOnly was set.'
    exit 0
  }

  $packageTarball = Join-Path $ArtifactsDir 'expo-modules-windows-core-e2e.tgz'
  if ($ExistingAppPath) {
    $AppPath = (Resolve-Path $ExistingAppPath).Path
  }
  else {
    $AppPath = Join-Path $WorkRoot $AppName
  }

  Stop-ProcessesUsingPath -Path $AppPath
  Stop-ProcessUsingPort -Port $MetroPort
  Remove-InstalledAppPackage -Name $AppName

  if (-not $ExistingAppPath -and -not $SkipCreateApp) {
    if (Test-Path -LiteralPath $AppPath) {
      Remove-Item -LiteralPath $AppPath -Recurse -Force
    }
    New-ExpoDesktopApp -ParentDir $WorkRoot -Name $AppName
  }

  if (-not (Test-Path -LiteralPath $AppPath)) {
    throw "App path does not exist: $AppPath"
  }

  Write-Step 'Resetting app package manager state for local package install'
  Reset-AppPackageManagerState -AppPath $AppPath

  Write-Step 'Packing local expo-modules-windows-core package'
  # Equivalent command: bun pm pack --filename <artifacts>/expo-modules-windows-core-e2e.tgz
  Invoke-LoggedCommand -Label 'bun-pm-pack-local-package' -FilePath 'bun' -Arguments @('pm', 'pack', '--filename', $packageTarball) -WorkingDirectory $PackageRoot

  Write-Step 'Installing packed expo-modules-windows-core package'
  Invoke-LoggedCommand -Label 'bun-add-local-package' -FilePath 'bun' -Arguments @('add', $packageTarball) -WorkingDirectory $AppPath

  Write-LocalCounterModule -AppPath $AppPath
  Write-ProofAppTsx -AppPath $AppPath
  Write-ExpoVirtualMetroEntry -AppPath $AppPath

  $projectFiles = Find-WindowsProjectFiles -AppPath $AppPath
  $relativeSln = Get-RelativePathCompat -BasePath $AppPath -TargetPath $projectFiles.Solution
  $relativeProj = Get-RelativePathCompat -BasePath $AppPath -TargetPath $projectFiles.Project
  $expoCoreProject = 'node_modules\expo-modules-windows-core\dotnet\Expo.Modules.Core\Expo.Modules.Core.csproj'

  Write-Step 'Running Windows Expo autolinking'
  # Equivalent command: bunx expo-modules-windows-core autolink-windows --sln ... --app-proj ... --expo-core-project ...
  Invoke-LoggedCommand `
    -Label 'expo-modules-windows-core-autolink-windows' `
    -FilePath 'bunx' `
    -Arguments @('expo-modules-windows-core', 'autolink-windows', '--sln', $relativeSln, '--app-proj', $relativeProj, '--expo-core-project', $expoCoreProject) `
    -WorkingDirectory $AppPath

  Stop-ExistingAppProcesses -ProjectPath $projectFiles.Project

  Write-Step 'Building Windows app without deploy/launch'
  Invoke-LoggedCommand `
    -Label 'react-native-run-windows-build' `
    -FilePath 'bunx' `
    -Arguments @('react-native', 'run-windows', '--no-packager', '--no-launch', '--no-deploy', '--logging', '--sln', $relativeSln, '--proj', $relativeProj, '--msbuildprops', 'PlatformToolset=v143') `
    -WorkingDirectory $AppPath `
    -Environment @{ MinimumVisualStudioVersion = '17.14.0'; VisualStudioVersion = '17.0' }

  if (Test-Path -LiteralPath $TempProofPath) {
    Remove-Item -LiteralPath $TempProofPath -Force
  }

  Stop-ProcessUsingPort -Port $MetroPort

  Write-Step 'Starting Metro'
  $metroOut = Join-Path $ArtifactsDir 'metro.out.log'
  $metroErr = Join-Path $ArtifactsDir 'metro.err.log'
  $MetroProcess = Start-Process -FilePath 'bunx' -ArgumentList @('react-native', 'start', '--port', [string]$MetroPort) -WorkingDirectory $AppPath -RedirectStandardOutput $metroOut -RedirectStandardError $metroErr -PassThru -WindowStyle Hidden
  Wait-ForHttpOk -Url "http://127.0.0.1:$MetroPort/status" -Timeout 60

  $registration = Register-And-LaunchApp -WindowsDir $projectFiles.WindowsDir

  Write-Step 'Waiting for JS-written LocalCounter proof JSON'
  Wait-ForLocalCounterProof -Path $TempProofPath -Timeout $TimeoutSeconds -AppPath $AppPath -MetroPort $MetroPort
  Assert-ProofJson -Path $TempProofPath

  $proofCopy = Join-Path $ArtifactsDir 'hermes-localcounter-proof.json'
  Copy-Item -LiteralPath $TempProofPath -Destination $proofCopy -Force
  $summary = [pscustomobject]@{
    repoRoot = $RepoRoot
    packageRoot = $PackageRoot
    appPath = $AppPath
    artifactsDir = $ArtifactsDir
    proofPath = $proofCopy
    tempProofPath = $TempProofPath
    packageFullName = $registration.PackageFullName
    appUserModelId = $registration.AppUserModelId
    sln = $projectFiles.Solution
    project = $projectFiles.Project
  }
  $summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ArtifactsDir 'summary.json')

  Write-Step 'Windows LocalCounter smoke proof succeeded'
  $summary | ConvertTo-Json -Depth 4 | Write-Host
}
catch {
  Write-FailureDiagnostics -Since $RunStartedAt -CurrentAppName $AppName -Registration $registration -ErrorRecord $_
  throw
}
finally {
  if ($MetroProcess -and -not $MetroProcess.HasExited) {
    Stop-Process -Id $MetroProcess.Id -Force -ErrorAction SilentlyContinue
  }

  if (-not $KeepApp -and -not $ExistingAppPath -and $AppPath -and (Test-Path -LiteralPath $AppPath)) {
    Remove-Item -LiteralPath $AppPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}
