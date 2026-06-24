/**
 * Patch a .vcxproj to reference the ExpoModulesAutolinked project and targets.
 * Uses line-based text manipulation (matching RNW's pattern).
 */
/**
 * Update a .vcxproj file to include the autolinked project reference and targets import.
 * Returns the updated content.
 */
export declare function updateVcxproj(vcxprojContent: string, autolinkedCsprojRelPath: string, autolinkedTargetsRelPath: string, staleRefs?: string[], staleImports?: string[]): string;
