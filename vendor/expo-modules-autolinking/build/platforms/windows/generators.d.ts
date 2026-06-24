import type { ModuleDescriptorWindows } from '../../types';
export interface AutolinkedProject {
    /** Absolute path to the .csproj file */
    csprojPath: string;
    /** Assembly name (read from csproj or derived from filename) */
    assemblyName: string;
}
/**
 * Read the <AssemblyName> from a .csproj file, falling back to the filename without extension.
 */
export declare function readAssemblyName(csprojPath: string): Promise<string>;
/**
 * Generate the ExpoModulesAutolinked.csproj content.
 */
export declare function generateAutolinkedCsproj(coreProject: AutolinkedProject, moduleProjects: AutolinkedProject[], outputDir: string): string;
/**
 * Generate the ExpoModulesAutolinked.g.targets content.
 * @param targetsDir - Absolute path of the directory where the .g.targets file will live.
 *                     Output dir properties are computed relative to this directory.
 */
export declare function generateDeployTargets(coreProject: AutolinkedProject, autolinkedProject: AutolinkedProject, moduleProjects: AutolinkedProject[], netHostPropsRelPath: string, targetsDir?: string): string;
/**
 * Generate a .wapproj-side target that mirrors managed assemblies into the
 * loose AppX layout used by RNW/expo-desktop debug deployment.
 */
export declare function generatePackageDeployTargets(appProjectName: string): string;
/**
 * Generate the ExpoModulesProvider.g.cs content.
 * Delegates to the existing function in windows.ts.
 */
export declare function generateProvider(modules: ModuleDescriptorWindows[]): string;
