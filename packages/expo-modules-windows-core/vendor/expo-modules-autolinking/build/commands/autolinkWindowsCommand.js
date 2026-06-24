"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.autolinkWindowsCommand = autolinkWindowsCommand;
exports.createSolutionProjects = createSolutionProjects;
exports.ensurePackageTargetsImport = ensurePackageTargetsImport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const autolinkingOptions_1 = require("./autolinkingOptions");
const findModules_1 = require("../autolinking/findModules");
const resolveModules_1 = require("../autolinking/resolveModules");
const generators_1 = require("../platforms/windows/generators");
const slnUtils_1 = require("../platforms/windows/slnUtils");
const vcxprojUtils_1 = require("../platforms/windows/vcxprojUtils");
function autolinkWindowsCommand(cli) {
    return (0, autolinkingOptions_1.registerAutolinkingArguments)(cli.command('autolink-windows [searchPaths...]'))
        .option('--sln <path>', 'Path to the .sln file')
        .option('--app-proj <path>', 'Path to the app .vcxproj file')
        .option('--expo-core-project <path>', 'Path to Expo.Modules.Core.csproj (auto-detected if not specified)')
        .action(async (searchPaths, commandArguments) => {
        const autolinkingOptionsLoader = (0, autolinkingOptions_1.createAutolinkingOptionsLoader)({
            ...commandArguments,
            searchPaths,
            platform: 'windows',
        });
        // 1. Resolve paths
        const appRoot = await autolinkingOptionsLoader.getAppRoot();
        const slnPath = path_1.default.resolve(appRoot, commandArguments.sln);
        const vcxprojPath = path_1.default.resolve(appRoot, commandArguments.appProj);
        const slnDir = path_1.default.dirname(slnPath);
        const vcxprojDir = path_1.default.dirname(vcxprojPath);
        // 2. Find & resolve modules
        const autolinkingOptions = await autolinkingOptionsLoader.getPlatformOptions('windows');
        const searchResults = await (0, findModules_1.findModulesAsync)({
            autolinkingOptions,
            appRoot,
        });
        const resolvedModules = (await (0, resolveModules_1.resolveModulesAsync)(searchResults, autolinkingOptions));
        console.log(`Found ${resolvedModules.length} Expo module(s) for Windows`);
        // 3. Resolve absolute csproj paths for each module
        const moduleProjects = [];
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
            const csprojPath = path_1.default.resolve(packagePath, mod.projectPath);
            const assemblyName = await (0, generators_1.readAssemblyName)(csprojPath);
            moduleProjects.push({ csprojPath, assemblyName });
            console.log(`  ${mod.packageName} → ${assemblyName}`);
        }
        // 4. Resolve Expo.Modules.Core project
        const coreCsprojPath = resolveCoreCsprojPath(commandArguments.expoCoreProject, appRoot);
        if (!coreCsprojPath) {
            throw new Error('Could not find Expo.Modules.Core.csproj. Use --expo-core-project to specify its path.');
        }
        const coreAssemblyName = await (0, generators_1.readAssemblyName)(coreCsprojPath);
        const coreProject = {
            csprojPath: coreCsprojPath,
            assemblyName: coreAssemblyName,
        };
        // 5. Output directory for generated files
        const autolinkedDir = path_1.default.join(vcxprojDir, 'ExpoModulesAutolinked');
        await fs_1.default.promises.mkdir(autolinkedDir, { recursive: true });
        // Autolinked project info
        const autolinkedCsprojPath = path_1.default.join(autolinkedDir, 'ExpoModulesAutolinked.csproj');
        const autolinkedProject = {
            csprojPath: autolinkedCsprojPath,
            assemblyName: 'ExpoModulesAutolinked',
        };
        // 6. Generate ExpoModulesAutolinked.csproj
        const csprojContent = (0, generators_1.generateAutolinkedCsproj)(coreProject, moduleProjects, autolinkedDir);
        await writeIfChanged(autolinkedCsprojPath, csprojContent);
        // 7. Generate ExpoModulesProvider.g.cs
        const providerContent = (0, generators_1.generateProvider)(resolvedModules);
        const providerPath = path_1.default.join(autolinkedDir, 'ExpoModulesProvider.g.cs');
        await writeIfChanged(providerPath, providerContent);
        // 8. Generate ExpoModulesAutolinked.g.targets
        const netHostPropsRelPath = findNetHostPropsRelPath(vcxprojDir, appRoot);
        const targetsContent = (0, generators_1.generateDeployTargets)(coreProject, autolinkedProject, moduleProjects, netHostPropsRelPath, vcxprojDir);
        const targetsPath = path_1.default.join(vcxprojDir, 'ExpoModulesAutolinked.g.targets');
        await writeIfChanged(targetsPath, targetsContent);
        // 9. Generate and import package-layout deploy targets when a .wapproj is present
        const packageProjectPath = await findPackageProjectPath(slnDir, vcxprojPath);
        let packageTargetsPath = null;
        if (packageProjectPath) {
            const packageProjectDir = path_1.default.dirname(packageProjectPath);
            packageTargetsPath = path_1.default.join(packageProjectDir, 'ExpoModulesAutolinked.Package.g.targets');
            const appProjectName = path_1.default.basename(vcxprojPath, path_1.default.extname(vcxprojPath));
            await writeIfChanged(packageTargetsPath, (0, generators_1.generatePackageDeployTargets)(appProjectName));
            const packageProjectContent = await fs_1.default.promises.readFile(packageProjectPath, 'utf8');
            const packageTargetsRelPath = path_1.default
                .relative(packageProjectDir, packageTargetsPath)
                .replace(/\//g, '\\');
            await writeIfChanged(packageProjectPath, ensurePackageTargetsImport(packageProjectContent, packageTargetsRelPath));
        }
        // 10. Collect stale refs from the vcxproj (old manual references to remove)
        const vcxprojContent = await fs_1.default.promises.readFile(vcxprojPath, 'utf8');
        const staleRefs = findStaleProjectReferences(vcxprojContent, moduleProjects);
        const staleImports = findStaleImports(vcxprojContent);
        // 11. Update .vcxproj
        const autolinkedCsprojRelPath = path_1.default
            .relative(vcxprojDir, autolinkedCsprojPath)
            .replace(/\//g, '\\');
        const autolinkedTargetsRelPath = path_1.default
            .relative(vcxprojDir, targetsPath)
            .replace(/\//g, '\\');
        const updatedVcxproj = (0, vcxprojUtils_1.updateVcxproj)(vcxprojContent, autolinkedCsprojRelPath, autolinkedTargetsRelPath, staleRefs, staleImports);
        await writeIfChanged(vcxprojPath, updatedVcxproj);
        // 12. Update .sln
        const slnContent = await fs_1.default.promises.readFile(slnPath, 'utf8');
        const slnProjects = createSolutionProjects(coreProject, autolinkedProject, moduleProjects, slnDir);
        const updatedSln = (0, slnUtils_1.updateSolution)(slnContent, slnProjects);
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
    });
}
/**
 * Get the absolute package path from search results for a given package name.
 */
function getPackagePath(searchResults, packageName) {
    const revision = searchResults[packageName];
    return revision?.path ?? null;
}
function createSolutionProjects(coreProject, autolinkedProject, _moduleProjects, slnDir) {
    return [
        (0, slnUtils_1.createSlnProject)(coreProject.assemblyName, coreProject.csprojPath, slnDir),
        (0, slnUtils_1.createSlnProject)(autolinkedProject.assemblyName, autolinkedProject.csprojPath, slnDir),
    ];
}
async function findPackageProjectPath(slnDir, vcxprojPath) {
    const appProjectName = path_1.default.basename(vcxprojPath, path_1.default.extname(vcxprojPath));
    const conventionalPath = path_1.default.join(path_1.default.dirname(vcxprojPath), '..', `${appProjectName}.Package`, `${appProjectName}.Package.wapproj`);
    if (fs_1.default.existsSync(conventionalPath)) {
        return conventionalPath;
    }
    const candidates = await findFilesByExtension(slnDir, '.wapproj');
    const normalizedVcxprojPath = path_1.default.normalize(vcxprojPath).toLowerCase();
    for (const candidate of candidates) {
        const content = await fs_1.default.promises.readFile(candidate, 'utf8').catch(() => '');
        const candidateDir = path_1.default.dirname(candidate);
        const projectRefs = [...content.matchAll(/<ProjectReference\s+Include="([^"]+\.vcxproj)"/gi)];
        const entryPoint = content.match(/<EntryPointProjectUniqueName>\s*([^<]+\.vcxproj)\s*<\/EntryPointProjectUniqueName>/i);
        const refs = [
            ...projectRefs.map((match) => match[1]),
            ...(entryPoint?.[1] ? [entryPoint[1]] : []),
        ];
        if (refs.some((ref) => path_1.default.normalize(path_1.default.resolve(candidateDir, ref)).toLowerCase() === normalizedVcxprojPath)) {
            return candidate;
        }
    }
    return null;
}
async function findFilesByExtension(root, extension) {
    const result = [];
    const entries = await fs_1.default.promises.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') {
            continue;
        }
        const fullPath = path_1.default.join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await findFilesByExtension(fullPath, extension)));
        }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
            result.push(fullPath);
        }
    }
    return result;
}
function ensurePackageTargetsImport(packageProjectContent, packageTargetsRelPath) {
    const eol = packageProjectContent.includes('\r\n') ? '\r\n' : '\n';
    const normalizedPath = packageTargetsRelPath.replace(/\\/g, '/').toLowerCase();
    const lines = packageProjectContent.split(/\r?\n/);
    if (lines.some((line) => {
        const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
        return normalizedLine.includes('<import') && normalizedLine.includes(normalizedPath);
    })) {
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
function resolveCoreCsprojPath(explicitPath, appRoot) {
    if (explicitPath) {
        const resolved = path_1.default.resolve(appRoot, explicitPath);
        if (fs_1.default.existsSync(resolved))
            return resolved;
        return null;
    }
    // Check common locations (appRoot may be the repo root or a subdirectory like example/)
    const candidates = [
        path_1.default.join(appRoot, 'dotnet', 'Expo.Modules.Core', 'Expo.Modules.Core.csproj'),
        path_1.default.join(appRoot, '..', 'dotnet', 'Expo.Modules.Core', 'Expo.Modules.Core.csproj'),
        path_1.default.join(appRoot, 'node_modules', 'expo-modules-windows-core', 'dotnet', 'Expo.Modules.Core', 'Expo.Modules.Core.csproj'),
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate))
            return candidate;
    }
    return null;
}
/**
 * Find the relative path to NetHost.props from the vcxproj directory.
 */
function findNetHostPropsRelPath(vcxprojDir, appRoot) {
    // Check common locations (appRoot may be the repo root or a subdirectory like example/)
    const candidates = [
        path_1.default.join(appRoot, 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'),
        path_1.default.join(appRoot, '..', 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'),
        path_1.default.join(appRoot, 'node_modules', 'expo-modules-windows-core', 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'),
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            return path_1.default.relative(vcxprojDir, candidate).replace(/\//g, '\\');
        }
    }
    // Fallback: assume standard layout
    return path_1.default
        .relative(vcxprojDir, path_1.default.join(appRoot, 'node_modules', 'expo-modules-windows-core', 'windows', 'ExpoModulesWindowsCore', 'NetHost.props'))
        .replace(/\//g, '\\');
}
/**
 * Find stale manual ProjectReference entries in the vcxproj that should be replaced
 * by the autolinked reference. Looks for references to .csproj files that match
 * module projects or the old ExpoExampleDeploy.targets pattern.
 */
function findStaleProjectReferences(vcxprojContent, _moduleProjects) {
    const stale = [];
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
function findStaleImports(vcxprojContent) {
    const stale = [];
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
function findLastIndex(items, predicate) {
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
async function writeIfChanged(filePath, content) {
    try {
        const existing = await fs_1.default.promises.readFile(filePath, 'utf8');
        if (existing === content)
            return;
    }
    catch {
        // File doesn't exist yet
    }
    await fs_1.default.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
    await fs_1.default.promises.writeFile(filePath, content, 'utf8');
}
//# sourceMappingURL=autolinkWindowsCommand.js.map