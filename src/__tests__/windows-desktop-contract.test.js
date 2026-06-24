const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Windows expo-desktop integration contract', () => {
  it('declares the Windows native project for external app autolinking', () => {
    const config = require('../../react-native.config');

    expect(config.dependency.platforms.windows).toMatchObject({
      sourceDir: 'windows',
      solutionFile: 'ExpoModulesWindowsCore.sln',
      projects: [
        {
          projectFile: 'ExpoModulesWindowsCore\\ExpoModulesWindowsCore.vcxproj',
          directDependency: true,
        },
      ],
    });
  });

  it('declares expo-desktop-modules-core as the required Expo runtime peer', () => {
    const packageJson = require('../../package.json');

    expect(packageJson.peerDependencies).toMatchObject({
      'expo-desktop-modules-core': '*',
    });
  });

  it('ships the Windows autolinking fork behind the package bin', () => {
    const packageJson = require('../../package.json');
    const autolinkingBin = readRepoFile('bin/expo-modules-autolinking.js');
    const vendoredBin = readRepoFile(
      'vendor/expo-modules-autolinking/bin/expo-modules-autolinking.js'
    );
    const vendoredBuild = readRepoFile('vendor/expo-modules-autolinking/build/index.js');
    const windowsGeneratorBuild = readRepoFile(
      'vendor/expo-modules-autolinking/build/platforms/windows/generators.js'
    );

    expect(packageJson.files).toContain('bin');
    expect(packageJson.files).toContain('vendor/expo-modules-autolinking');
    expect(packageJson.bin).toMatchObject({
      'expo-modules-windows-core': 'bin/expo-modules-autolinking.js',
      'expo-modules-windows-autolinking': 'bin/expo-modules-autolinking.js',
    });
    expect(packageJson.dependencies).toMatchObject({
      '@expo/require-utils': '^55.0.2',
      '@expo/spawn-async': '^1.7.2',
      chalk: '^4.1.0',
      commander: '^7.2.0',
    });
    expect(autolinkingBin).toContain(
      "../vendor/expo-modules-autolinking/bin/expo-modules-autolinking.js"
    );
    expect(vendoredBin).toContain("require('../build')");
    expect(vendoredBuild).toContain('require("./commands/autolinkWindowsCommand")');
    expect(vendoredBuild).toContain('autolinkWindowsCommand)(cli)');
    expect(windowsGeneratorBuild).toContain('AdditionalProperties="ExpoModulesCoreProject=');
    expect(windowsGeneratorBuild).toContain('DeployExpoManagedModulesToPackageLayout');
  });

  it('requires expo-desktop to install global.expo instead of creating standalone globals', () => {
    const source = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp');

    expect(source).toContain('expo-desktop-modules-core must initialize global.expo');
    expect(source).not.toContain('__windowsCoreMode');
    expect(source).not.toContain('"standalone"');
    expect(source).not.toContain('Object expo(rt);');
    expect(source).not.toContain('rt.global().setProperty(rt, "expo", expo);');
  });

  it('loads the generated C# provider bridge before local module assemblies', () => {
    const source = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp');

    expect(source).toContain('kAutolinkedAssembly = L"ExpoModulesAutolinked.dll"');
    expect(source).toContain('auto autolinkedAssembly = fs::path(assemblyDir) / kAutolinkedAssembly;');
    expect(source.indexOf('return autolinkedAssembly.wstring();')).toBeLessThan(
      source.indexOf('for (const auto& entry : fs::directory_iterator(assemblyDir))')
    );
  });

  it('eagerly initializes the Windows TurboModule when RNW supports it', () => {
    const header = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.h');

    expect(header).toContain('#ifdef REACT_EAGER_TURBO_MODULE');
    expect(header).toContain('REACT_EAGER_TURBO_MODULE(ExpoModulesWindowsCore)');
    expect(header).toContain('REACT_MODULE(ExpoModulesWindowsCore)');
    expect(header.indexOf('REACT_EAGER_TURBO_MODULE(ExpoModulesWindowsCore)')).toBeLessThan(
      header.indexOf('REACT_MODULE(ExpoModulesWindowsCore)')
    );
  });

  it('builds generated RNW module code without the package precompiled header', () => {
    const vcxproj = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj')
      .replace(/\r\n/g, '\n');

    expect(vcxproj).toContain(
      '<ClCompile Include="$(GeneratedFilesDir)module.g.cpp">\n      <PrecompiledHeader>NotUsing</PrecompiledHeader>\n    </ClCompile>'
    );
  });

  it('builds RNW package shared sources without the package precompiled header', () => {
    const vcxproj = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj')
      .replace(/\r\n/g, '\n');

    expect(vcxproj).toContain(
      '<ClCompile Update="$(PkgMicrosoft_ReactNative_Cxx)\\tools\\Microsoft.ReactNative.Cxx\\*.cpp">\n      <PrecompiledHeader>NotUsing</PrecompiledHeader>\n    </ClCompile>'
    );
  });

  it("uses the consuming Windows solution's React Native Windows runtime", () => {
    const vcxproj = readRepoFile('windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj');

    expect(vcxproj).toContain(
      "$([MSBuild]::GetDirectoryNameOfFileAbove($(SolutionDir), 'node_modules\\react-native-windows\\package.json'))\\node_modules\\react-native-windows\\"
    );
    expect(vcxproj).not.toContain(
      "$([MSBuild]::GetDirectoryNameOfFileAbove($(MSBuildThisFileDirectory), 'node_modules\\react-native-windows\\package.json'))"
    );
  });
});
