const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/e2e/windows-localcounter-smoke.ps1');

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
}

describe('Windows LocalCounter e2e smoke script contract', () => {
  it('ships a runnable PowerShell script for the expo-desktop LocalCounter proof', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);

    const script = readScript();
    expect(script).toContain('[CmdletBinding()]');
    expect(script).toContain('param(');
    expect(script).toContain('$RepoRoot');
    expect(script).toContain('$WorkRoot');
    expect(script).toContain('$ExistingAppPath');
    expect(script).toContain('$SkipCreateApp');
    expect(script).toContain('$KeepApp');
    expect(script).toContain('$TimeoutSeconds');
    expect(script).toContain('createExpoDesktopApp');
    expect(script).toContain('expo-desktop@latest');
    expect(script).toContain("windows: '0.81.29'");
  });

  it('exposes the smoke proof through a package script', () => {
    const packageJson = require('../package.json');

    expect(packageJson.scripts).toMatchObject({
      'test:e2e:windows-localcounter': 'powershell -ExecutionPolicy Bypass -File scripts/e2e/windows-localcounter-smoke.ps1',
    });
  });

  it('creates the LocalCounter module and runs Windows Expo autolinking', () => {
    const script = readScript();

    expect(script).toContain('LocalCounterModule.cs');
    expect(script).toContain('LocalCounterModule.csproj');
    expect(script).toContain('expo-module.config.json');
    expect(script).toContain('Function<int>("increment"');
    expect(script).toContain('Function<int>("getCount"');
    expect(script).toContain('recordProof');
    expect(script).toContain('Write-ExpoVirtualMetroEntry');
    expect(script).toContain('.virtual-metro-entry.js');
    expect(script).toContain("registerRootComponent(App)");
    expect(script).toContain('__expoWindowsLocalCounterProof');
    expect(script).toContain('bun pm pack');
    expect(script).toContain('$PackageRoot');
    expect(script).toContain("packages\\expo-modules-windows-core");
    expect(script).toContain('expo-modules-windows-core-e2e.tgz');
    expect(script).toContain('expo-modules-windows-core autolink-windows');
    expect(script).toContain('--expo-core-project');
  });

  it('builds, registers, launches, and validates JS-written proof output', () => {
    const script = readScript();

    expect(script).toContain('MinimumVisualStudioVersion');
    expect(script).toContain('VisualStudioVersion');
    expect(script).toContain('PlatformToolset=v143');
    expect(script).toContain('Stop-ExistingAppProcesses');
    expect(script).toContain('Stop-Process -Name $processName');
    expect(script).toContain('Stop-ProcessesUsingPath');
    expect(script).toContain('Remove-InstalledAppPackage');
    expect(script).toContain('Remove-AppxPackage');
    expect(script).toContain('Add-AppxPackage');
    expect(script).toContain('Stop-ProcessUsingPort');
    expect(script).toContain('Get-NetTCPConnection -LocalPort $Port');
    expect(script).toContain("@('react-native', 'start'");
    expect(script).toContain('Start-Process "shell:AppsFolder');
    expect(script).toContain('expo-modules-windows-core-localcounter-proof.json');
    expect(script).toContain('Wait-ForLocalCounterProof');
    expect(script).toContain('hermes-localcounter-proof.cjs');
    expect(script).toContain('/json/list');
    expect(script).toContain('Runtime.evaluate');
    expect(script).toContain('Assert-ProofJson');
    expect(script).toContain('$proof.value -ne 1');
    expect(script).toContain('$proof.countAfter -ne 1');
    expect(script).toContain('NativeModulesProxy');
    expect(script).toContain('ExpoAsset');
    expect(script).toContain('ExponentConstants');
    expect(script).toContain('$null -ne $proof.initError');
  });
});
