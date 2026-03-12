import crypto from 'crypto';
import path from 'path';

// Project type GUIDs
const CSPROJ_TYPE_GUID = '{9A19103F-16F7-4668-BE54-9A1E7A4F7556}';
const SOLUTION_FOLDER_TYPE_GUID = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';

// Namespace for deterministic GUID generation
const GUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace UUID

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
export function generateDeterministicGuid(name: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(GUID_NAMESPACE + ':' + name)
    .digest('hex');
  const guid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-');
  return `{${guid.toUpperCase()}}`;
}

/**
 * Update a .sln file to include the given C# projects under a "Managed" solution folder.
 * Adds/removes project entries, configuration entries, and nesting entries.
 * Returns the updated content, or null if no changes needed.
 */
export function updateSolution(
  slnContent: string,
  projects: SlnProject[],
  managedFolderName: string = 'Managed'
): string {
  const eol = slnContent.includes('\r\n') ? '\r\n' : '\n';
  let lines = slnContent.split(/\r?\n/);

  // Extract existing solution configs (e.g., "Debug|x64", "Release|ARM64")
  const solutionConfigs = extractSolutionConfigs(lines);

  // Find or create the Managed solution folder
  let managedFolderGuid = findSolutionFolderGuid(lines, managedFolderName);
  if (!managedFolderGuid) {
    managedFolderGuid = generateDeterministicGuid(`SolutionFolder:${managedFolderName}`);
    // Insert the folder before the Global line
    const globalIdx = lines.findIndex((l) => l.trim() === 'Global');
    if (globalIdx >= 0) {
      lines.splice(globalIdx, 0,
        `Project("${SOLUTION_FOLDER_TYPE_GUID}") = "${managedFolderName}", "${managedFolderName}", "${managedFolderGuid}"`,
        'EndProject'
      );
    }
  }

  // Collect GUIDs of projects we're managing (to detect stale ones)
  const desiredGuids = new Set(projects.map((p) => p.guid));

  // Remove stale autolinked project entries (projects that were in Managed folder but are no longer desired)
  const existingManagedGuids = findNestedProjectGuids(lines, managedFolderGuid);
  const staleGuids = existingManagedGuids.filter((g) => !desiredGuids.has(g));
  for (const staleGuid of staleGuids) {
    lines = removeProjectBlock(lines, staleGuid);
    lines = removeConfigLines(lines, staleGuid);
    lines = removeNestedLine(lines, staleGuid);
  }

  // Add/update each project
  for (const project of projects) {
    if (!hasProjectBlock(lines, project.guid)) {
      // Insert before Global
      const globalIdx = lines.findIndex((l) => l.trim() === 'Global');
      if (globalIdx >= 0) {
        lines.splice(globalIdx, 0,
          `Project("${CSPROJ_TYPE_GUID}") = "${project.name}", "${project.relativePath}", "${project.guid}"`,
          'EndProject'
        );
      }
    }

    // Ensure configuration entries exist
    ensureConfigEntries(lines, project.guid, solutionConfigs);

    // Ensure nested under Managed folder
    ensureNestedEntry(lines, project.guid, managedFolderGuid);
  }

  return lines.join(eol);
}

/**
 * Extract solution configuration names from SolutionConfigurationPlatforms section.
 */
function extractSolutionConfigs(lines: string[]): string[] {
  const configs: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.includes('GlobalSection(SolutionConfigurationPlatforms)')) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim() === 'EndGlobalSection') {
      break;
    }
    if (inSection) {
      // Format: "		Debug|x64 = Debug|x64"
      const match = line.match(/^\s+(.+?)\s*=\s*.+$/);
      if (match) {
        configs.push(match[1]);
      }
    }
  }
  return configs;
}

/**
 * Find the GUID of an existing solution folder by name.
 */
function findSolutionFolderGuid(lines: string[], folderName: string): string | null {
  for (const line of lines) {
    const match = line.match(
      new RegExp(
        `^Project\\("${escapeRegex(SOLUTION_FOLDER_TYPE_GUID)}"\\)\\s*=\\s*"${escapeRegex(folderName)}"\\s*,\\s*"${escapeRegex(folderName)}"\\s*,\\s*"([^"]+)"`
      )
    );
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if a project block with the given GUID already exists.
 */
function hasProjectBlock(lines: string[], guid: string): boolean {
  return lines.some((l) => l.includes(guid) && l.startsWith('Project('));
}

/**
 * Remove a Project block (Project...EndProject) by GUID.
 */
function removeProjectBlock(lines: string[], guid: string): string[] {
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith('Project(') && line.includes(guid)) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === 'EndProject') {
      skipping = false;
      continue;
    }
    if (!skipping) {
      result.push(line);
    }
  }
  return result;
}

/**
 * Remove all ProjectConfigurationPlatforms lines for a given GUID.
 */
function removeConfigLines(lines: string[], guid: string): string[] {
  return lines.filter((l) => !l.includes(guid) || !l.includes('.ActiveCfg') && !l.includes('.Build.0'));
}

/**
 * Remove NestedProjects line for a given GUID.
 */
function removeNestedLine(lines: string[], guid: string): string[] {
  return lines.filter((l) => {
    const trimmed = l.trim();
    return !(trimmed.startsWith(guid) && trimmed.includes('='));
  });
}

/**
 * Find all project GUIDs nested under a given folder GUID.
 */
function findNestedProjectGuids(lines: string[], folderGuid: string): string[] {
  const guids: string[] = [];
  let inNested = false;
  for (const line of lines) {
    if (line.includes('GlobalSection(NestedProjects)')) {
      inNested = true;
      continue;
    }
    if (inNested && line.trim() === 'EndGlobalSection') {
      break;
    }
    if (inNested) {
      const match = line.match(/^\s*(\{[^}]+\})\s*=\s*(\{[^}]+\})/);
      if (match && match[2] === folderGuid) {
        guids.push(match[1]);
      }
    }
  }
  return guids;
}

/**
 * Ensure ProjectConfigurationPlatforms entries for a project GUID.
 * C# projects use x86 (not Win32) for the platform mapping.
 */
function ensureConfigEntries(lines: string[], guid: string, solutionConfigs: string[]): void {
  // Find the end of the ProjectConfigurationPlatforms section
  let sectionEndIdx = -1;
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('GlobalSection(ProjectConfigurationPlatforms)')) {
      inSection = true;
      continue;
    }
    if (inSection && lines[i].trim() === 'EndGlobalSection') {
      sectionEndIdx = i;
      break;
    }
  }

  if (sectionEndIdx < 0) return;

  // Check if entries already exist
  if (lines.some((l) => l.includes(guid) && l.includes('.ActiveCfg'))) {
    return;
  }

  // For C# projects, x86 stays x86 (no Win32 mapping needed)
  const newLines: string[] = [];
  for (const config of solutionConfigs) {
    // C# projects use x86 not Win32
    const projectConfig = config;
    newLines.push(`\t\t${guid}.${config}.ActiveCfg = ${projectConfig}`);
    newLines.push(`\t\t${guid}.${config}.Build.0 = ${projectConfig}`);
  }

  lines.splice(sectionEndIdx, 0, ...newLines);
}

/**
 * Ensure a NestedProjects entry for a project under a folder.
 */
function ensureNestedEntry(lines: string[], projectGuid: string, folderGuid: string): void {
  // Find NestedProjects section
  let sectionEndIdx = -1;
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('GlobalSection(NestedProjects)')) {
      inSection = true;
      continue;
    }
    if (inSection && lines[i].trim() === 'EndGlobalSection') {
      sectionEndIdx = i;
      break;
    }
  }

  if (sectionEndIdx < 0) {
    // No NestedProjects section exists — create one
    // Find the last EndGlobalSection before EndGlobal
    const endGlobalIdx = lines.findIndex((l) => l.trim() === 'EndGlobal');
    if (endGlobalIdx < 0) return;
    lines.splice(endGlobalIdx, 0,
      '\tGlobalSection(NestedProjects) = preSolution',
      `\t\t${projectGuid} = ${folderGuid}`,
      '\tEndGlobalSection'
    );
    return;
  }

  // Check if already nested
  if (lines.some((l) => l.trim().startsWith(projectGuid) && l.includes(folderGuid))) {
    return;
  }

  lines.splice(sectionEndIdx, 0, `\t\t${projectGuid} = ${folderGuid}`);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a SlnProject from an absolute csproj path relative to the solution directory.
 */
export function createSlnProject(name: string, csprojAbsPath: string, slnDir: string): SlnProject {
  return {
    name,
    relativePath: path.relative(slnDir, csprojAbsPath).replace(/\//g, '\\'),
    guid: generateDeterministicGuid(`CSharpProject:${name}`),
  };
}
