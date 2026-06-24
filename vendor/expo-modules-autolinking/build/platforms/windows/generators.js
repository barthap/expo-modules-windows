"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAssemblyName = readAssemblyName;
exports.generateAutolinkedCsproj = generateAutolinkedCsproj;
exports.generateDeployTargets = generateDeployTargets;
exports.generatePackageDeployTargets = generatePackageDeployTargets;
exports.generateProvider = generateProvider;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const windows_1 = require("./windows");
const TFM = 'net9.0-windows10.0.19041.0';
const winPath = path_1.default.win32;
/**
 * Read the <AssemblyName> from a .csproj file, falling back to the filename without extension.
 */
async function readAssemblyName(csprojPath) {
    try {
        const content = await fs_1.default.promises.readFile(csprojPath, 'utf8');
        const match = content.match(/<AssemblyName>\s*([^<]+?)\s*<\/AssemblyName>/);
        if (match?.[1]) {
            return match[1];
        }
    }
    catch {
        // Fall through to filename-based fallback
    }
    return path_1.default.basename(csprojPath, '.csproj');
}
/**
 * Generate the ExpoModulesAutolinked.csproj content.
 */
function generateAutolinkedCsproj(coreProject, moduleProjects, outputDir) {
    const coreRef = winPath.relative(outputDir, coreProject.csprojPath);
    const moduleRefs = moduleProjects.map((m) => ({
        projectRef: winPath.relative(outputDir, m.csprojPath),
        coreRef: winPath.relative(winPath.dirname(m.csprojPath), coreProject.csprojPath),
    }));
    let refs = `    <ProjectReference Include="${coreRef}" />\n`;
    for (const ref of moduleRefs) {
        refs += `    <ProjectReference Include="${ref.projectRef}" AdditionalProperties="ExpoModulesCoreProject=${ref.coreRef};Platform=$(Platform)" />\n`;
    }
    return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${TFM}</TargetFramework>
    <AssemblyName>ExpoModulesAutolinked</AssemblyName>
    <RootNamespace>Expo.Modules.Autolinking</RootNamespace>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
${refs}  </ItemGroup>
</Project>
`;
}
/**
 * Generate the ExpoModulesAutolinked.g.targets content.
 * @param targetsDir - Absolute path of the directory where the .g.targets file will live.
 *                     Output dir properties are computed relative to this directory.
 */
function generateDeployTargets(coreProject, autolinkedProject, moduleProjects, netHostPropsRelPath, targetsDir) {
    // Property definitions for each project's output directory
    let propertyLines = '';
    for (const proj of [coreProject, autolinkedProject]) {
        const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
        const csprojDir = targetsDir
            ? winPath.relative(targetsDir, winPath.dirname(proj.csprojPath))
            : winPath.dirname(proj.csprojPath);
        const prefix = targetsDir ? '$(MSBuildThisFileDirectory)' : '';
        const sep = csprojDir ? '\\' : '';
        propertyLines += `    <${propName}>${prefix}${csprojDir}${sep}bin\\$(Platform)\\$(Configuration)\\${TFM}\\</${propName}>\n`;
    }
    for (const proj of moduleProjects) {
        const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
        const csprojDir = targetsDir
            ? winPath.relative(targetsDir, winPath.dirname(proj.csprojPath))
            : winPath.dirname(proj.csprojPath);
        const prefix = targetsDir ? '$(MSBuildThisFileDirectory)' : '';
        const sep = csprojDir ? '\\' : '';
        propertyLines += `    <${propName}>${prefix}${csprojDir}${sep}bin\\$(Configuration)\\${TFM}\\</${propName}>\n`;
    }
    const allProjects = [coreProject, autolinkedProject, ...moduleProjects];
    // Copy items for the post-build target
    let copyItems = '';
    for (const proj of allProjects) {
        const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
        copyItems += `      <_ManagedFiles Include="$(${propName})*.dll" />\n`;
        copyItems += `      <_ManagedFiles Include="$(${propName})*.deps.json" />\n`;
        copyItems += `      <_ManagedFiles Include="$(${propName})*.runtimeconfig.json" />\n`;
        copyItems += `      <_ManagedFiles Include="$(${propName})*.pdb" Condition="'$(Configuration)'=='Debug'" />\n`;
    }
    // Content declarations for MSIX packaging
    let contentItems = '';
    for (const proj of allProjects) {
        const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
        for (const extension of ['*.dll', '*.deps.json', '*.runtimeconfig.json']) {
            contentItems += `    <Content Include="$(${propName})${extension}">\n`;
            contentItems += `      <Link>managed\\%(Filename)%(Extension)</Link>\n`;
            contentItems += `      <DeploymentContent>true</DeploymentContent>\n`;
            contentItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>\n`;
            contentItems += `    </Content>\n`;
        }
    }
    // PDB Content conditioned on Debug
    let pdbItems = '';
    for (const proj of allProjects) {
        const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
        pdbItems += `    <Content Include="$(${propName})*.pdb" Condition="'$(Configuration)'=='Debug'">\n`;
        pdbItems += `      <Link>managed\\%(Filename)%(Extension)</Link>\n`;
        pdbItems += `      <DeploymentContent>true</DeploymentContent>\n`;
        pdbItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>\n`;
        pdbItems += `    </Content>\n`;
    }
    return `<!--
  ExpoModulesAutolinked.g.targets
  Auto-generated by expo-modules-autolinking. Do not edit manually.
  Deploys managed assemblies for both regular builds and MSIX packaging.
-->
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">

  <PropertyGroup>
${propertyLines}  </PropertyGroup>

  <!-- Post-build: copy all managed assemblies to $(OutDir)\\managed\\ -->
  <Target Name="DeployExpoManagedModules" AfterTargets="Build">
    <ItemGroup>
${copyItems}    </ItemGroup>
    <Message Text="Copying Expo managed assemblies to $(OutDir)managed\\" Importance="high" />
    <MakeDir Directories="$(OutDir)managed" />
    <Copy SourceFiles="@(_ManagedFiles)"
          DestinationFolder="$(OutDir)managed"
          SkipUnchangedFiles="true" />
  </Target>

  <!-- MSIX Content declarations -->
  <ItemGroup>
${contentItems}${pdbItems}  </ItemGroup>

  <!-- Ensure nethost.dll is in the AppX -->
  <Import Project="${netHostPropsRelPath}" />
  <ItemGroup>
    <Content Include="$(NetHostDir)\\nethost.dll" Condition="!Exists('$(OutDir)nethost.dll')">
      <Link>nethost.dll</Link>
      <DeploymentContent>true</DeploymentContent>
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>

</Project>
`;
}
/**
 * Generate a .wapproj-side target that mirrors managed assemblies into the
 * loose AppX layout used by RNW/expo-desktop debug deployment.
 */
function generatePackageDeployTargets(appProjectName) {
    return `<!--
  ExpoModulesAutolinked.Package.g.targets
  Auto-generated by expo-modules-autolinking. Do not edit manually.
  Mirrors managed assemblies into the debug AppX package layout.
-->
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">

  <PropertyGroup>
    <_ExpoManagedPackageSourceDir>$(MSBuildThisFileDirectory)..\\$(Platform)\\$(Configuration)\\managed\\</_ExpoManagedPackageSourceDir>
    <_ExpoManagedPackageOutputDir>$(MSBuildThisFileDirectory)bin\\$(Platform)\\$(Configuration)\\${appProjectName}\\managed\\</_ExpoManagedPackageOutputDir>
  </PropertyGroup>

  <Target Name="DeployExpoManagedModulesToPackageLayout"
          AfterTargets="Build"
          Condition="Exists('$(_ExpoManagedPackageSourceDir)')">
    <ItemGroup>
      <_ExpoPackageManagedFiles Include="$(_ExpoManagedPackageSourceDir)*.dll" />
      <_ExpoPackageManagedFiles Include="$(_ExpoManagedPackageSourceDir)*.deps.json" />
      <_ExpoPackageManagedFiles Include="$(_ExpoManagedPackageSourceDir)*.runtimeconfig.json" />
      <_ExpoPackageManagedFiles Include="$(_ExpoManagedPackageSourceDir)*.pdb" Condition="'$(Configuration)'=='Debug'" />
    </ItemGroup>
    <Message Text="Copying Expo managed assemblies to $(_ExpoManagedPackageOutputDir)" Importance="high" />
    <MakeDir Directories="$(_ExpoManagedPackageOutputDir)" />
    <Copy SourceFiles="@(_ExpoPackageManagedFiles)"
          DestinationFolder="$(_ExpoManagedPackageOutputDir)"
          SkipUnchangedFiles="true" />
  </Target>

</Project>
`;
}
/**
 * Generate the ExpoModulesProvider.g.cs content.
 * Delegates to the existing function in windows.ts.
 */
function generateProvider(modules) {
    return (0, windows_1.generateModulesProviderContent)(modules);
}
/**
 * Sanitize an assembly name for use as an MSBuild property name.
 * Replaces dots and hyphens with underscores.
 */
function sanitizePropName(name) {
    return name.replace(/[.\-]/g, '_');
}
//# sourceMappingURL=generators.js.map