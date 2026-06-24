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
  generatePackageDeployTargets,
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

        // 9. Generate and import package-layout deploy targets when a .wapproj is present
        const packageProjectPath = await findPackageProjectPath(slnDir, vcxprojPath);
        let packageTargetsPath: string | null = null;
        if (packageProjectPath) {
          const packageProjectDir = path.dirname(packageProjectPath);
          packageTargetsPath = path.join(packageProjectDir, 'ExpoModulesAutolinked.Package.g.targets');
          const appProjectName = path.basename(vcxprojPath, path.extname(vcxprojPath));
          await writeIfChanged(packageTargetsPath, generatePackageDeployTargets(appProjectName));

          const packageProjectContent = await fs.promises.readFile(packageProjectPath, 'utf8');
          const packageTargetsRelPath = path
            .relative(packageProjectDir, packageTargetsPath)
            .replace(/\//g, '\\');
          await writeIfChanged(
            packageProjectPath,
            ensurePackageTargetsImport(packageProjectContent, packageTargetsRelPath)
          );
        }

        // 10. Collect stale refs from the vcxproj (old manual references to remove)
        const vcxprojContent = await fs.promises.readFile(vcxprojPath, 'utf8');
        const staleRefs = findStaleProjectReferences(vcxprojContent, moduleProjects);
        const staleImports = findStaleImports(vcxprojContent);

        // 11. Update .vcxproj
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

        // 12. Update .sln
        const slnContent = await fs.promises.readFile(slnPath, 'utf8');
        const slnProjects = createSolutionProjects(
          coreProject,
          autolinkedProject,
          moduleProjects,
          slnDir
        );

        const updatedSln = updateSolution(slnContent, slnProjects);
        await writeIfChanged(slnPath, updatedSln);

        // 13. Summary
        console.log('\nAutolink complete:');
        console.log(`  Generated: ${autolinkedCsprojPath}`);
        console.log(`  Generated: ${providerPath}`);
        console.log(`  Generated: ${targetsPath}`);
        if (packageTargetsPath && packageProjectPath) {
          console.log(`  Generated: ${packageTargetsPath}`);
          console.log(`  Updated:   ${packageProjectPath}`);
        }
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

export function createSolutionProjects(
  coreProject: AutolinkedProject,
  autolinkedProject: AutolinkedProject,
  _moduleProjects: AutolinkedProject[],
  slnDir: string
): SlnProject[] {
  return [
    createSlnProject(coreProject.assemblyName, coreProject.csprojPath, slnDir),
    createSlnProject(autolinkedProject.assemblyName, autolinkedProject.csprojPath, slnDir),
  ];
}

async function findPackageProjectPath(slnDir: string, vcxprojPath: string): Promise<string | null> {
  const appProjectName = path.basename(vcxprojPath, path.extname(vcxprojPath));
  const conventionalPath = path.join(
    path.dirname(vcxprojPath),
    '..',
    `${appProjectName}.Package`,
    `${appProjectName}.Package.wapproj`
  );
  if (fs.existsSync(conventionalPath)) {
    return conventionalPath;
  }

  const candidates = await findFilesByExtension(slnDir, '.wapproj');
  const normalizedVcxprojPath = path.normalize(vcxprojPath).toLowerCase();
  for (const candidate of candidates) {
    const content = await fs.promises.readFile(candidate, 'utf8').catch(() => '');
    const candidateDir = path.dirname(candidate);
    const projectRefs = [...content.matchAll(/<ProjectReference\s+Include="([^"]+\.vcxproj)"/gi)];
    const entryPoint = content.match(
      /<EntryPointProjectUniqueName>\s*([^<]+\.vcxproj)\s*<\/EntryPointProjectUniqueName>/i
    );
    const refs = [
      ...projectRefs.map((match) => match[1]),
      ...(entryPoint?.[1] ? [entryPoint[1]] : []),
    ];

    if (
      refs.some(
        (ref) =>
          path.normalize(path.resolve(candidateDir, ref)).toLowerCase() === normalizedVcxprojPath
      )
    ) {
      return candidate;
    }
  }

  return null;
}

async function findFilesByExtension(root: string, extension: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findFilesByExtension(fullPath, extension)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      result.push(fullPath);
    }
  }
  return result;
}

export function ensurePackageTargetsImport(
  packageProjectContent: string,
  packageTargetsRelPath: string
): string {
  const eol = packageProjectContent.includes('\r\n') ? '\r\n' : '\n';
  const normalizedPath = packageTargetsRelPath.replace(/\\/g, '/').toLowerCase();
  const lines = packageProjectContent.split(/\r?\n/);

  if (
    lines.some((line) => {
      const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
      return normalizedLine.includes('<import') && normalizedLine.includes(normalizedPath);
    })
  ) {
    return packageProjectContent;
  }

  const closeProjectIdx = findLastIndex(lines, (line) => line.trim() === '</Project>');
  if (closeProjectIdx < 0) {
    return packageProjectContent;
  }

  lines.splice(closeProjectIdx, 0, `  <Import Project="${packageTargetsRelPath}" />`);
  return lines.join(eol);
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

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) {
      return i;
    }
  }
  return -1;
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
