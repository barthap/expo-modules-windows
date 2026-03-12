import commander from 'commander';
import fs from 'fs';
import path from 'path';

import {
  createAutolinkingOptionsLoader,
  registerAutolinkingArguments,
  AutolinkingCommonArguments,
} from './autolinkingOptions';
import { findModulesAsync } from '../autolinking/findModules';
import { resolveModulesAsync } from '../autolinking/resolveModules';
import type { ModuleDescriptorWindows, SearchResults } from '../types';
import {
  generateAutolinkedCsproj,
  generateDeployTargets,
  generateProvider,
  readAssemblyName,
  AutolinkedProject,
} from '../platforms/windows/generators';
import { updateSolution, createSlnProject, SlnProject } from '../platforms/windows/slnUtils';
import { updateVcxproj } from '../platforms/windows/vcxprojUtils';

interface AutolinkWindowsArguments extends AutolinkingCommonArguments {
  sln: string;
  appProj: string;
  expoCoreProject?: string;
}

export function autolinkWindowsCommand(cli: commander.CommanderStatic) {
  return registerAutolinkingArguments(cli.command('autolink-windows [searchPaths...]'))
    .option('--sln <path>', 'Path to the .sln file')
    .option('--app-proj <path>', 'Path to the app .vcxproj file')
    .option(
      '--expo-core-project <path>',
      'Path to Expo.Modules.Core.csproj (auto-detected if not specified)'
    )
    .action(
      async (searchPaths: string[] | null, commandArguments: AutolinkWindowsArguments) => {
        const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
          ...commandArguments,
          searchPaths,
          platform: 'windows',
        });

        // 1. Resolve paths
        const appRoot = await autolinkingOptionsLoader.getAppRoot();
        const slnPath = path.resolve(appRoot, commandArguments.sln);
        const vcxprojPath = path.resolve(appRoot, commandArguments.appProj);
        const slnDir = path.dirname(slnPath);
        const vcxprojDir = path.dirname(vcxprojPath);

        // 2. Find & resolve modules
        const autolinkingOptions = await autolinkingOptionsLoader.getPlatformOptions('windows');
        const searchResults = await findModulesAsync({
          autolinkingOptions,
          appRoot,
        });
        const resolvedModules = (await resolveModulesAsync(
          searchResults,
          autolinkingOptions
        )) as ModuleDescriptorWindows[];

        console.log(`Found ${resolvedModules.length} Expo module(s) for Windows`);

        // 3. Resolve absolute csproj paths for each module
        const moduleProjects: AutolinkedProject[] = [];
        for (const mod of resolvedModules) {
          if (!mod.projectPath) {
            console.warn(`  Skipping ${mod.packageName}: no projectPath defined`);
            continue;
          }
          const packagePath = getPackagePath(searchResults, mod.packageName);
          if (!packagePath) {
            console.warn(`  Skipping ${mod.packageName}: package path not found`);
            continue;
          }
          const csprojPath = path.resolve(packagePath, mod.projectPath);
          const assemblyName = await readAssemblyName(csprojPath);
          moduleProjects.push({ csprojPath, assemblyName });
          console.log(`  ${mod.packageName} → ${assemblyName}`);
        }

        // 4. Resolve Expo.Modules.Core project
        const coreCsprojPath = resolveCoreCsprojPath(
          commandArguments.expoCoreProject,
          appRoot
        );
        if (!coreCsprojPath) {
          throw new Error(
            'Could not find Expo.Modules.Core.csproj. Use --expo-core-project to specify its path.'
          );
        }
        const coreAssemblyName = await readAssemblyName(coreCsprojPath);
        const coreProject: AutolinkedProject = {
          csprojPath: coreCsprojPath,
          assemblyName: coreAssemblyName,
        };

        // 5. Output directory for generated files
        const autolinkedDir = path.join(vcxprojDir, 'ExpoModulesAutolinked');
        await fs.promises.mkdir(autolinkedDir, { recursive: true });

        // Autolinked project info
        const autolinkedCsprojPath = path.join(autolinkedDir, 'ExpoModulesAutolinked.csproj');
        const autolinkedProject: AutolinkedProject = {
          csprojPath: autolinkedCsprojPath,
          assemblyName: 'ExpoModulesAutolinked',
        };

        // 6. Generate ExpoModulesAutolinked.csproj
        const csprojContent = generateAutolinkedCsproj(coreProject, moduleProjects, autolinkedDir);
        await writeIfChanged(autolinkedCsprojPath, csprojContent);

        // 7. Generate ExpoModulesProvider.g.cs
        const providerContent = generateProvider(resolvedModules);
        const providerPath = path.join(autolinkedDir, 'ExpoModulesProvider.g.cs');
        await writeIfChanged(providerPath, providerContent);

        // 8. Generate ExpoModulesAutolinked.g.targets
        const netHostPropsRelPath = findNetHostPropsRelPath(vcxprojDir, appRoot);
        const targetsContent = generateDeployTargets(
          coreProject,
          autolinkedProject,
          moduleProjects,
          netHostPropsRelPath,
          vcxprojDir
        );
        const targetsPath = path.join(vcxprojDir, 'ExpoModulesAutolinked.g.targets');
        await writeIfChanged(targetsPath, targetsContent);

        // 9. Collect stale refs from the vcxproj (old manual references to remove)
        const vcxprojContent = await fs.promises.readFile(vcxprojPath, 'utf8');
        const staleRefs = findStaleProjectReferences(vcxprojContent, moduleProjects);
        const staleImports = findStaleImports(vcxprojContent);

        // 10. Update .vcxproj
        const autolinkedCsprojRelPath = path
          .relative(vcxprojDir, autolinkedCsprojPath)
          .replace(/\//g, '\\');
        const autolinkedTargetsRelPath = path
          .relative(vcxprojDir, targetsPath)
          .replace(/\//g, '\\');

        const updatedVcxproj = updateVcxproj(
          vcxprojContent,
          autolinkedCsprojRelPath,
          autolinkedTargetsRelPath,
          staleRefs,
          staleImports
        );
        await writeIfChanged(vcxprojPath, updatedVcxproj);

        // 11. Update .sln
        const slnContent = await fs.promises.readFile(slnPath, 'utf8');
        const slnProjects: SlnProject[] = [
          createSlnProject(coreProject.assemblyName, coreProject.csprojPath, slnDir),
          createSlnProject(autolinkedProject.assemblyName, autolinkedProject.csprojPath, slnDir),
          ...moduleProjects.map((m) => {
            const name = path.basename(m.csprojPath, '.csproj');
            return createSlnProject(name, m.csprojPath, slnDir);
          }),
        ];

        const updatedSln = updateSolution(slnContent, slnProjects);
        await writeIfChanged(slnPath, updatedSln);

        // 12. Summary
        console.log('\nAutolink complete:');
        console.log(`  Generated: ${autolinkedCsprojPath}`);
        console.log(`  Generated: ${providerPath}`);
        console.log(`  Generated: ${targetsPath}`);
        console.log(`  Updated:   ${vcxprojPath}`);
        console.log(`  Updated:   ${slnPath}`);
      }
    );
}

/**
 * Get the absolute package path from search results for a given package name.
 */
function getPackagePath(
  searchResults: SearchResults,
  packageName: string
): string | null {
  const revision = searchResults[packageName];
  return revision?.path ?? null;
}

/**
 * Resolve the path to Expo.Modules.Core.csproj.
 * Checks --expo-core-project flag, then common locations.
 */
function resolveCoreCsprojPath(
  explicitPath: string | undefined,
  appRoot: string
): string | null {
  if (explicitPath) {
    const resolved = path.resolve(appRoot, explicitPath);
    if (fs.existsSync(resolved)) return resolved;
    return null;
  }

  // Check common locations (appRoot may be the repo root or a subdirectory like example/)
  const candidates = [
    path.join(appRoot, 'dotnet', 'Expo.Modules.Core', 'Expo.Modules.Core.csproj'),
    path.join(appRoot, '..', 'dotnet', 'Expo.Modules.Core', 'Expo.Modules.Core.csproj'),
    path.join(
      appRoot,
      'node_modules',
      'expo-modules-windows-core',
      'dotnet',
      'Expo.Modules.Core',
      'Expo.Modules.Core.csproj'
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Find the relative path to NetHost.props from the vcxproj directory.
 */
function findNetHostPropsRelPath(vcxprojDir: string, appRoot: string): string {
  // Check common locations (appRoot may be the repo root or a subdirectory like example/)
  const candidates = [
    path.join(appRoot, 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'),
    path.join(appRoot, '..', 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'),
    path.join(
      appRoot,
      'node_modules',
      'expo-modules-windows-core',
      'windows',
      'ExpoModulesWindowsCore',
      'NetHost.props'
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.relative(vcxprojDir, candidate).replace(/\//g, '\\');
    }
  }

  // Fallback: assume standard layout
  return path
    .relative(
      vcxprojDir,
      path.join(appRoot, 'node_modules', 'expo-modules-windows-core', 'windows', 'ExpoModulesWindowsCore', 'NetHost.props')
    )
    .replace(/\//g, '\\');
}

/**
 * Find stale manual ProjectReference entries in the vcxproj that should be replaced
 * by the autolinked reference. Looks for references to .csproj files that match
 * module projects or the old ExpoExampleDeploy.targets pattern.
 */
function findStaleProjectReferences(
  vcxprojContent: string,
  _moduleProjects: AutolinkedProject[]
): string[] {
  const stale: string[] = [];
  // Match ProjectReference Include="...csproj" lines
  const regex = /<ProjectReference\s+Include="([^"]+\.csproj)"/gi;
  let match;
  while ((match = regex.exec(vcxprojContent)) !== null) {
    const refPath = match[1];
    // Keep the autolinked reference, remove old module references
    if (!refPath.includes('ExpoModulesAutolinked')) {
      stale.push(refPath);
    }
  }
  return stale;
}

/**
 * Find stale Import lines that should be replaced by the autolinked targets.
 */
function findStaleImports(vcxprojContent: string): string[] {
  const stale: string[] = [];
  const regex = /<Import\s+Project="([^"]+)"/gi;
  let match;
  while ((match = regex.exec(vcxprojContent)) !== null) {
    const importPath = match[1];
    // Remove old ExpoExampleDeploy.targets (replaced by ExpoModulesAutolinked.g.targets)
    if (importPath.includes('ExpoExampleDeploy') || importPath.includes('ExpoManagedDeploy')) {
      stale.push(importPath);
    }
  }
  return stale;
}

/**
 * Write content to a file only if it differs from the existing content.
 */
async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.promises.readFile(filePath, 'utf8');
    if (existing === content) return;
  } catch {
    // File doesn't exist yet
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, 'utf8');
}
