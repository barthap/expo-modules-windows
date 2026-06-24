export interface SlnProject {
    /** Display name in Solution Explorer */
    name: string;
    /** Relative path from solution dir to .csproj (backslash-separated) */
    relativePath: string;
    /** Project GUID (deterministic, based on name) */
    guid: string;
}
/**
 * Generate a deterministic GUID from a project name.
 * Uses SHA-1 of namespace + name, formatted as {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}.
 */
export declare function generateDeterministicGuid(name: string): string;
/**
 * Update a .sln file to include the given C# projects under a "Managed" solution folder.
 * Adds/removes project entries, configuration entries, and nesting entries.
 * Returns the updated content, or null if no changes needed.
 */
export declare function updateSolution(slnContent: string, projects: SlnProject[], managedFolderName?: string): string;
/**
 * Create a SlnProject from an absolute csproj path relative to the solution directory.
 */
export declare function createSlnProject(name: string, csprojAbsPath: string, slnDir: string): SlnProject;
