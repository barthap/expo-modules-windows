import commander from 'commander';
import { AutolinkedProject } from '../platforms/windows/generators';
import { SlnProject } from '../platforms/windows/slnUtils';
export declare function autolinkWindowsCommand(cli: commander.CommanderStatic): commander.Command;
export declare function createSolutionProjects(coreProject: AutolinkedProject, autolinkedProject: AutolinkedProject, _moduleProjects: AutolinkedProject[], slnDir: string): SlnProject[];
export declare function ensurePackageTargetsImport(packageProjectContent: string, packageTargetsRelPath: string): string;
