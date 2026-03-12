/**
 * Patch a .vcxproj to reference the ExpoModulesAutolinked project and targets.
 * Uses line-based text manipulation (matching RNW's pattern).
 */

/**
 * Update a .vcxproj file to include the autolinked project reference and targets import.
 * Returns the updated content.
 */
export function updateVcxproj(
  vcxprojContent: string,
  autolinkedCsprojRelPath: string,
  autolinkedTargetsRelPath: string,
  staleRefs: string[] = [],
  staleImports: string[] = []
): string {
  const eol = vcxprojContent.includes('\r\n') ? '\r\n' : '\n';
  let lines = vcxprojContent.split(/\r?\n/);

  // Remove stale ProjectReference blocks
  for (const staleRef of staleRefs) {
    lines = removeProjectReference(lines, staleRef);
  }

  // Remove stale Import lines
  for (const staleImport of staleImports) {
    lines = removeImport(lines, staleImport);
  }

  // Ensure ProjectReference to ExpoModulesAutolinked.csproj
  lines = ensureProjectReference(lines, autolinkedCsprojRelPath, eol);

  // Ensure Import of ExpoModulesAutolinked.g.targets
  lines = ensureImport(lines, autolinkedTargetsRelPath);

  // Ensure CppWinRTGenerateWindowsMetadata=false
  lines = ensureCppWinRTMetadataFalse(lines);

  return lines.join(eol);
}

/**
 * Remove a ProjectReference block that includes the given path.
 * Handles both single-line <ProjectReference .../> and multi-line blocks.
 */
function removeProjectReference(lines: string[], refPath: string): string[] {
  const normalizedRef = refPath.replace(/\\/g, '/').toLowerCase();
  const result: string[] = [];
  let skipping = false;
  let inEmptyItemGroup = false;
  let itemGroupStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalizedLine = line.replace(/\\/g, '/').toLowerCase();

    if (normalizedLine.includes('<projectreference') && normalizedLine.includes(normalizedRef)) {
      if (normalizedLine.includes('/>')) {
        // Single-line self-closing
        continue;
      }
      skipping = true;
      continue;
    }
    if (skipping && line.trim().toLowerCase() === '</projectreference>') {
      skipping = false;
      continue;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  // Clean up empty ItemGroups that may have been left behind
  return removeEmptyItemGroups(result);
}

/**
 * Remove empty <ItemGroup> ... </ItemGroup> blocks (with only whitespace between).
 */
function removeEmptyItemGroups(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '<ItemGroup>') {
      // Check if next non-empty line is </ItemGroup>
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && lines[j].trim() === '</ItemGroup>') {
        i = j + 1; // Skip the empty ItemGroup
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  return result;
}

/**
 * Remove an Import line that includes the given project path.
 */
function removeImport(lines: string[], importPath: string): string[] {
  const normalized = importPath.replace(/\\/g, '/').toLowerCase();
  return lines.filter((line) => {
    const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
    return !(normalizedLine.includes('<import') && normalizedLine.includes(normalized));
  });
}

/**
 * Ensure a ProjectReference to the autolinked csproj exists.
 * If it already exists, do nothing. Otherwise, add it in its own ItemGroup.
 */
function ensureProjectReference(lines: string[], csprojRelPath: string, eol: string): string[] {
  const normalizedRef = csprojRelPath.replace(/\\/g, '/').toLowerCase();

  // Check if already present
  for (const line of lines) {
    const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
    if (normalizedLine.includes('<projectreference') && normalizedLine.includes(normalizedRef)) {
      return lines;
    }
  }

  // Find a good insertion point — before the last </Project>
  const closeProjectIdx = findLastIndex(lines, (l) => l.trim() === '</Project>');
  if (closeProjectIdx < 0) return lines;

  const newLines = [
    '  <ItemGroup>',
    `    <ProjectReference Include="${csprojRelPath}">`,
    '      <ReferenceOutputAssembly>false</ReferenceOutputAssembly>',
    '      <SkipGetTargetFrameworkProperties>true</SkipGetTargetFrameworkProperties>',
    '      <Private>false</Private>',
    '    </ProjectReference>',
    '  </ItemGroup>',
  ];

  lines.splice(closeProjectIdx, 0, ...newLines);
  return lines;
}

/**
 * Ensure an Import for the autolinked targets file exists.
 * Placed before </Project>.
 */
function ensureImport(lines: string[], targetsRelPath: string): string[] {
  const normalizedPath = targetsRelPath.replace(/\\/g, '/').toLowerCase();

  // Check if already present
  for (const line of lines) {
    const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
    if (normalizedLine.includes('<import') && normalizedLine.includes(normalizedPath)) {
      return lines;
    }
  }

  const closeProjectIdx = findLastIndex(lines, (l) => l.trim() === '</Project>');
  if (closeProjectIdx < 0) return lines;

  lines.splice(closeProjectIdx, 0, `  <Import Project="${targetsRelPath}" />`);
  return lines;
}

/**
 * Ensure CppWinRTGenerateWindowsMetadata is set to false.
 */
function ensureCppWinRTMetadataFalse(lines: string[]): string[] {
  // Check if already present
  for (const line of lines) {
    if (line.includes('<CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>')) {
      return lines;
    }
  }

  // Find the first PropertyGroup with Label="Globals" and add it there
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Label="Globals"')) {
      // Find the closing </PropertyGroup>
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '</PropertyGroup>') {
          lines.splice(j, 0, '    <CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>');
          return lines;
        }
      }
    }
  }

  return lines;
}

function findLastIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (predicate(lines[i])) {
      return i;
    }
  }
  return -1;
}
