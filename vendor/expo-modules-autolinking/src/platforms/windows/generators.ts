import fs from 'fs';
import path from 'path';

import { generateModulesProviderContent } from './windows';
import type { ModuleDescriptorWindows } from '../../types';

const TFM = 'net9.0-windows10.0.19041.0';

export interface AutolinkedProject {
  /** Absolute path to the .csproj file */
  csprojPath: string;
  /** Assembly name (read from csproj or derived from filename) */
  assemblyName: string;
}

/**
 * Read the <AssemblyName> from a .csproj file, falling back to the filename without extension.
 */
export async function readAssemblyName(csprojPath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(csprojPath, 'utf8');
    const match = content.match(/<AssemblyName>\s*([^<]+?)\s*<\/AssemblyName>/);
    if (match) {
      return match[1];
    }
  } catch {
    // Fall through to filename-based fallback
  }
  return path.basename(csprojPath, '.csproj');
}

/**
 * Generate the ExpoModulesAutolinked.csproj content.
 */
export function generateAutolinkedCsproj(
  coreProject: AutolinkedProject,
  moduleProjects: AutolinkedProject[],
  outputDir: string
): string {
  const coreRef = path.relative(outputDir, coreProject.csprojPath).replace(/\//g, '\\');
  const moduleRefs = moduleProjects.map(
    (m) => path.relative(outputDir, m.csprojPath).replace(/\//g, '\\')
  );

  let refs = `    <ProjectReference Include="${coreRef}" />\n`;
  for (const ref of moduleRefs) {
    refs += `    <ProjectReference Include="${ref}" />\n`;
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
export function generateDeployTargets(
  coreProject: AutolinkedProject,
  autolinkedProject: AutolinkedProject,
  moduleProjects: AutolinkedProject[],
  netHostPropsRelPath: string,
  targetsDir?: string
): string {
  const allProjects = [coreProject, autolinkedProject, ...moduleProjects];

  // Property definitions for each project's output directory
  let propertyLines = '';
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    const csprojDir = targetsDir
      ? path.relative(targetsDir, path.dirname(proj.csprojPath)).replace(/\//g, '\\')
      : path.dirname(proj.csprojPath).replace(/\//g, '\\');
    const prefix = targetsDir ? '$(MSBuildThisFileDirectory)' : '';
    const sep = csprojDir ? '\\' : '';
    propertyLines += `    <${propName}>${prefix}${csprojDir}${sep}bin\\$(Platform)\\$(Configuration)\\${TFM}\\</${propName}>\n`;
  }

  // Copy items for the post-build target
  let copyItems = '';
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    copyItems += `      <_ManagedFiles Include="$(${propName})${proj.assemblyName}.dll" />\n`;
    copyItems += `      <_ManagedFiles Include="$(${propName})${proj.assemblyName}.pdb" />\n`;
  }
  // Core also needs runtimeconfig.json
  const corePropName = `_Expo_${sanitizePropName(coreProject.assemblyName)}_OutputDir`;
  copyItems += `      <_ManagedFiles Include="$(${corePropName})${coreProject.assemblyName}.runtimeconfig.json" />\n`;

  // Content declarations for MSIX packaging
  let contentItems = '';
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    contentItems += `    <Content Include="$(${propName})${proj.assemblyName}.dll">\n`;
    contentItems += `      <Link>managed\\${proj.assemblyName}.dll</Link>\n`;
    contentItems += `      <DeploymentContent>true</DeploymentContent>\n`;
    contentItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>\n`;
    contentItems += `    </Content>\n`;
  }
  // Core runtimeconfig.json
  contentItems += `    <Content Include="$(${corePropName})${coreProject.assemblyName}.runtimeconfig.json">\n`;
  contentItems += `      <Link>managed\\${coreProject.assemblyName}.runtimeconfig.json</Link>\n`;
  contentItems += `      <DeploymentContent>true</DeploymentContent>\n`;
  contentItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>\n`;
  contentItems += `    </Content>\n`;

  // PDB Content conditioned on Debug
  let pdbItems = '';
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    pdbItems += `    <Content Include="$(${propName})${proj.assemblyName}.pdb" Condition="'$(Configuration)'=='Debug'">\n`;
    pdbItems += `      <Link>managed\\${proj.assemblyName}.pdb</Link>\n`;
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
 * Generate the ExpoModulesProvider.g.cs content.
 * Delegates to the existing function in windows.ts.
 */
export function generateProvider(modules: ModuleDescriptorWindows[]): string {
  return generateModulesProviderContent(modules);
}

/**
 * Sanitize an assembly name for use as an MSBuild property name.
 * Replaces dots and hyphens with underscores.
 */
function sanitizePropName(name: string): string {
  return name.replace(/[.\-]/g, '_');
}
