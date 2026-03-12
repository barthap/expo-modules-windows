import {
  generateAutolinkedCsproj,
  generateDeployTargets,
  generateProvider,
  AutolinkedProject,
} from '../windows/generators';
import {
  updateSolution,
  createSlnProject,
  generateDeterministicGuid,
  SlnProject,
} from '../windows/slnUtils';
import { updateVcxproj } from '../windows/vcxprojUtils';
import type { ModuleDescriptorWindows } from '../../types';

// ─── generators tests ───

describe('generateAutolinkedCsproj', () => {
  const coreProject: AutolinkedProject = {
    csprojPath: 'C:\\repo\\dotnet\\Expo.Modules.Core\\Expo.Modules.Core.csproj',
    assemblyName: 'Expo.Modules.Core',
  };

  it('generates csproj with zero modules', () => {
    const result = generateAutolinkedCsproj(coreProject, [], 'C:\\repo\\app\\ExpoModulesAutolinked');
    expect(result).toContain('<AssemblyName>ExpoModulesAutolinked</AssemblyName>');
    expect(result).toContain('Expo.Modules.Core.csproj');
    expect(result).not.toContain('RELATIVE_TO_MODULE');
  });

  it('generates csproj with multiple modules', () => {
    const modules: AutolinkedProject[] = [
      {
        csprojPath: 'C:\\repo\\modules\\Battery\\Battery.csproj',
        assemblyName: 'ExpoBattery',
      },
      {
        csprojPath: 'C:\\repo\\modules\\Clipboard\\Clipboard.csproj',
        assemblyName: 'ExpoClipboard',
      },
    ];
    const result = generateAutolinkedCsproj(coreProject, modules, 'C:\\repo\\app\\ExpoModulesAutolinked');
    expect(result).toContain('Battery.csproj');
    expect(result).toContain('Clipboard.csproj');
    expect(result).toContain('Expo.Modules.Core.csproj');
  });

  it('uses backslash path separators', () => {
    const result = generateAutolinkedCsproj(coreProject, [], 'C:\\repo\\app\\ExpoModulesAutolinked');
    // Should not have forward slashes in paths
    const projRefLines = result.split('\n').filter((l) => l.includes('ProjectReference'));
    for (const line of projRefLines) {
      const match = line.match(/Include="([^"]+)"/);
      if (match) {
        expect(match[1]).not.toContain('/');
      }
    }
  });
});

describe('generateDeployTargets', () => {
  const core: AutolinkedProject = {
    csprojPath: 'C:\\repo\\dotnet\\Expo.Modules.Core\\Expo.Modules.Core.csproj',
    assemblyName: 'Expo.Modules.Core',
  };
  const autolinked: AutolinkedProject = {
    csprojPath: 'C:\\repo\\app\\ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
    assemblyName: 'ExpoModulesAutolinked',
  };

  it('generates targets with correct assembly names', () => {
    const modules: AutolinkedProject[] = [
      { csprojPath: 'C:\\repo\\modules\\Bat\\Bat.csproj', assemblyName: 'ExpoBattery' },
    ];
    const result = generateDeployTargets(core, autolinked, modules, '..\\..\\NetHost.props');
    expect(result).toContain('Expo.Modules.Core.dll');
    expect(result).toContain('ExpoModulesAutolinked.dll');
    expect(result).toContain('ExpoBattery.dll');
    expect(result).toContain('Expo.Modules.Core.runtimeconfig.json');
    expect(result).toContain('NetHost.props');
    expect(result).toContain("Condition=\"'$(Configuration)'=='Debug'\"");
  });

  it('generates targets with zero modules', () => {
    const result = generateDeployTargets(core, autolinked, [], '..\\..\\NetHost.props');
    expect(result).toContain('Expo.Modules.Core.dll');
    expect(result).toContain('ExpoModulesAutolinked.dll');
    expect(result).not.toContain('ExpoBattery');
  });

  it('sanitizes assembly names with dots in property names', () => {
    const result = generateDeployTargets(core, autolinked, [], '..\\..\\NetHost.props');
    expect(result).toContain('_Expo_Expo_Modules_Core_OutputDir');
    expect(result).not.toContain('_Expo_Expo.Modules.Core_OutputDir');
  });
});

describe('generateProvider', () => {
  it('generates provider content from module descriptors', () => {
    const modules: ModuleDescriptorWindows[] = [
      {
        packageName: 'expo-battery',
        modules: [{ name: null, class: 'ExpoBattery.BatteryModule' }],
        projectPath: 'Battery.csproj',
        debugOnly: false,
      },
    ];
    const result = generateProvider(modules);
    expect(result).toContain('typeof(ExpoBattery.BatteryModule)');
    expect(result).toContain('ExpoModulesProvider');
  });
});

// ─── slnUtils tests ───

describe('slnUtils', () => {
  const minimalSln = [
    '',
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    '# Visual Studio Version 17',
    'Project("{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}") = "MyApp", "MyApp\\MyApp.vcxproj", "{AAAA}"',
    'EndProject',
    'Global',
    '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution',
    '\t\tDebug|x64 = Debug|x64',
    '\t\tRelease|x64 = Release|x64',
    '\tEndGlobalSection',
    '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution',
    '\t\t{AAAA}.Debug|x64.ActiveCfg = Debug|x64',
    '\t\t{AAAA}.Debug|x64.Build.0 = Debug|x64',
    '\t\t{AAAA}.Release|x64.ActiveCfg = Release|x64',
    '\t\t{AAAA}.Release|x64.Build.0 = Release|x64',
    '\tEndGlobalSection',
    '\tGlobalSection(SolutionProperties) = preSolution',
    '\t\tHideSolutionNode = FALSE',
    '\tEndGlobalSection',
    'EndGlobal',
    '',
  ].join('\r\n');

  describe('generateDeterministicGuid', () => {
    it('returns consistent GUID for same name', () => {
      const a = generateDeterministicGuid('Test');
      const b = generateDeterministicGuid('Test');
      expect(a).toBe(b);
    });

    it('returns different GUIDs for different names', () => {
      const a = generateDeterministicGuid('ProjectA');
      const b = generateDeterministicGuid('ProjectB');
      expect(a).not.toBe(b);
    });

    it('formats as {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}', () => {
      const guid = generateDeterministicGuid('Test');
      expect(guid).toMatch(/^\{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\}$/);
    });
  });

  describe('updateSolution', () => {
    it('adds a project under Managed folder', () => {
      const projects: SlnProject[] = [
        { name: 'CoreLib', relativePath: 'Core\\Core.csproj', guid: '{BBBB}' },
      ];
      const result = updateSolution(minimalSln, projects);
      expect(result).toContain('"CoreLib"');
      expect(result).toContain('"Managed"');
      expect(result).toContain('{BBBB}.Debug|x64.ActiveCfg');
      expect(result).toContain('{BBBB}.Release|x64.ActiveCfg');
    });

    it('is idempotent on re-run', () => {
      const projects: SlnProject[] = [
        { name: 'CoreLib', relativePath: 'Core\\Core.csproj', guid: '{BBBB}' },
      ];
      const first = updateSolution(minimalSln, projects);
      const second = updateSolution(first, projects);
      expect(second).toBe(first);
    });

    it('removes stale projects', () => {
      const oldProjects: SlnProject[] = [
        { name: 'OldLib', relativePath: 'Old\\Old.csproj', guid: '{CCCC}' },
      ];
      const withOld = updateSolution(minimalSln, oldProjects);
      expect(withOld).toContain('"OldLib"');

      const newProjects: SlnProject[] = [
        { name: 'NewLib', relativePath: 'New\\New.csproj', guid: '{DDDD}' },
      ];
      const result = updateSolution(withOld, newProjects);
      expect(result).not.toContain('"OldLib"');
      expect(result).not.toContain('{CCCC}');
      expect(result).toContain('"NewLib"');
    });

    it('preserves CRLF line endings', () => {
      const projects: SlnProject[] = [
        { name: 'Lib', relativePath: 'Lib\\Lib.csproj', guid: '{EEEE}' },
      ];
      const result = updateSolution(minimalSln, projects);
      expect(result).toContain('\r\n');
      // Should not have bare \n (without preceding \r)
      const lines = result.split('\r\n');
      for (const line of lines) {
        expect(line).not.toContain('\n');
      }
    });

    it('preserves LF line endings', () => {
      const lfSln = minimalSln.replace(/\r\n/g, '\n');
      const projects: SlnProject[] = [
        { name: 'Lib', relativePath: 'Lib\\Lib.csproj', guid: '{EEEE}' },
      ];
      const result = updateSolution(lfSln, projects);
      expect(result).not.toContain('\r');
    });

    it('creates Managed folder if not present', () => {
      const projects: SlnProject[] = [
        { name: 'Lib', relativePath: 'Lib\\Lib.csproj', guid: '{FFFF}' },
      ];
      const result = updateSolution(minimalSln, projects);
      expect(result).toContain('"Managed"');
      expect(result).toContain('2150E333-8FDC-42A3-9474-1A3956D46DE8');
    });

    it('reuses existing Managed folder', () => {
      const slnWithFolder = minimalSln.replace(
        'Global',
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Managed", "Managed", "{EXISTING}"\nEndProject\nGlobal'
      );
      const projects: SlnProject[] = [
        { name: 'Lib', relativePath: 'Lib\\Lib.csproj', guid: '{GGGG}' },
      ];
      const result = updateSolution(slnWithFolder, projects);
      // Should use the existing GUID, not create a new one
      expect(result).toContain('{EXISTING}');
      expect(result).toContain('{GGGG} = {EXISTING}');
    });
  });

  describe('createSlnProject', () => {
    it('creates project with deterministic GUID', () => {
      const project = createSlnProject('MyLib', 'C:\\repo\\lib\\MyLib.csproj', 'C:\\repo');
      expect(project.name).toBe('MyLib');
      expect(project.relativePath).toBe('lib\\MyLib.csproj');
      expect(project.guid).toMatch(/^\{[A-F0-9-]+\}$/);
    });
  });
});

// ─── vcxprojUtils tests ───

describe('vcxprojUtils', () => {
  const minimalVcxproj = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
    '  <PropertyGroup Label="Globals">',
    '    <ProjectGuid>{AAAA}</ProjectGuid>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <ClCompile Include="main.cpp" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\r\n');

  describe('updateVcxproj', () => {
    it('adds ProjectReference and Import', () => {
      const result = updateVcxproj(
        minimalVcxproj,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets'
      );
      expect(result).toContain('ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj');
      expect(result).toContain('ReferenceOutputAssembly');
      expect(result).toContain('ExpoModulesAutolinked.g.targets');
    });

    it('is idempotent', () => {
      const first = updateVcxproj(
        minimalVcxproj,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets'
      );
      const second = updateVcxproj(
        first,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets'
      );
      expect(second).toBe(first);
    });

    it('removes stale ProjectReference', () => {
      const withRef = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
        '  <PropertyGroup Label="Globals">',
        '    <ProjectGuid>{AAAA}</ProjectGuid>',
        '  </PropertyGroup>',
        '  <ItemGroup>',
        '    <ProjectReference Include="..\\..\\modules\\Example\\Example.csproj">',
        '      <ReferenceOutputAssembly>false</ReferenceOutputAssembly>',
        '    </ProjectReference>',
        '  </ItemGroup>',
        '</Project>',
      ].join('\r\n');

      const result = updateVcxproj(
        withRef,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets',
        ['..\\..\\modules\\Example\\Example.csproj']
      );
      expect(result).not.toContain('Example.csproj');
      expect(result).toContain('ExpoModulesAutolinked');
    });

    it('removes stale Import', () => {
      const withImport = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
        '  <PropertyGroup Label="Globals">',
        '    <ProjectGuid>{AAAA}</ProjectGuid>',
        '  </PropertyGroup>',
        '  <Import Project="ExpoExampleDeploy.targets" />',
        '</Project>',
      ].join('\r\n');

      const result = updateVcxproj(
        withImport,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets',
        [],
        ['ExpoExampleDeploy.targets']
      );
      expect(result).not.toContain('ExpoExampleDeploy.targets');
      expect(result).toContain('ExpoModulesAutolinked.g.targets');
    });

    it('ensures CppWinRTGenerateWindowsMetadata=false', () => {
      const result = updateVcxproj(
        minimalVcxproj,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets'
      );
      expect(result).toContain('<CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>');
    });

    it('does not duplicate CppWinRTGenerateWindowsMetadata if already present', () => {
      const withMeta = minimalVcxproj.replace(
        '<ProjectGuid>{AAAA}</ProjectGuid>',
        '<ProjectGuid>{AAAA}</ProjectGuid>\r\n    <CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>'
      );
      const result = updateVcxproj(
        withMeta,
        'ExpoModulesAutolinked\\ExpoModulesAutolinked.csproj',
        'ExpoModulesAutolinked.g.targets'
      );
      const linesWithCppWinRT = result.split(/\r?\n/).filter(
        (l) => l.includes('CppWinRTGenerateWindowsMetadata')
      );
      expect(linesWithCppWinRT.length).toBe(1);
    });
  });
});
