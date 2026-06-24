import type { ExtraDependencies, ModuleDescriptorWindows, PackageRevision } from '../../types';
/** Resolves module search result with additional details required for Windows platform. */
export declare function resolveModuleAsync(packageName: string, revision: PackageRevision): Promise<ModuleDescriptorWindows | null>;
export declare function resolveExtraBuildDependenciesAsync(_projectNativeRoot: string): Promise<ExtraDependencies | null>;
/**
 * Generates C# file that contains all autolinked module classes.
 */
export declare function generateModulesProviderAsync(modules: ModuleDescriptorWindows[], targetPath: string): Promise<void>;
/**
 * Generates the content for the ExpoModulesProvider.g.cs file.
 */
export declare function generateModulesProviderContent(modules: ModuleDescriptorWindows[]): string;
