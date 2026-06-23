var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/memoize.ts
function memoize(fn) {
  return (input, ...args) => {
    if (!currentMemoizer) {
      if (false) {}
      return fn(input, ...args);
    }
    return currentMemoizer.call(fn, input, ...args);
  };
}
function createMemoizer() {
  if (currentMemoizer) {
    return currentMemoizer;
  }
  const cacheByFn = new Map;
  const memoizer = {
    async call(fn, input, ...args) {
      let cache = cacheByFn.get(fn);
      if (!cache) {
        cache = new Map;
        cacheByFn.set(fn, cache);
      }
      if (!cache.has(input)) {
        const value = await memoizer.withMemoizer(fn, input, ...args);
        if (cache.size > MAX_SIZE) {
          cache.clear();
        }
        cache.set(input, value);
        return value;
      }
      return cache.get(input);
    },
    async withMemoizer(fn, ...args) {
      currentMemoizer = memoizer;
      currentContexts++;
      try {
        return await fn(...args);
      } finally {
        if (currentContexts > 0) {
          currentContexts--;
        }
        if (currentContexts === 0) {
          currentMemoizer = undefined;
        }
      }
    }
  };
  return memoizer;
}
var MAX_SIZE = 5000, currentMemoizer, currentContexts = 0;

// src/concurrency.ts
var createLimiter = (limit) => {
  let running = 0;
  let head = null;
  let tail = null;
  const enqueue = () => new Promise((resolve) => {
    const item = { resolve, next: null };
    if (tail) {
      tail.next = item;
      tail = item;
    } else {
      head = item;
      tail = item;
    }
  });
  const dequeue = () => {
    if (running < limit && head !== null) {
      const { resolve, next } = head;
      head.next = null;
      head = next;
      if (head === null) {
        tail = null;
      }
      running++;
      resolve();
    }
  };
  return async (fn, ...args) => {
    if (running < limit) {
      running++;
    } else {
      await enqueue();
    }
    try {
      return await fn(...args);
    } finally {
      running--;
      dequeue();
    }
  };
}, taskAll = (inputs, map) => {
  const limiter = createLimiter(8);
  return Promise.all(inputs.map((input) => limiter(map, input)));
};

// src/utils.ts
async function listFilesSorted(targetPath, filter) {
  try {
    return (await import_fs3.default.promises.readdir(targetPath, { withFileTypes: true })).filter((entry) => entry.isFile() && filter(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => import_path4.default.join(targetPath, entry.name));
  } catch {
    return [];
  }
}
async function listFilesInDirectories(targetPath, filter) {
  return (await Promise.all((await import_fs3.default.promises.readdir(targetPath, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== "node_modules").sort((a, b) => a.name.localeCompare(b.name)).map(async (directory) => {
    const entries = await import_fs3.default.promises.readdir(import_path4.default.join(targetPath, directory.name), {
      withFileTypes: true
    });
    return entries.filter((entry) => entry.isFile() && filter(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => import_path4.default.join(directory.name, entry.name));
  }))).flat(1);
}
async function* scanFilesRecursively(parentPath, includeDirectory, sort = !import_fs3.default.opendir) {
  const queue = [parentPath];
  let targetPath;
  while (queue.length > 0 && (targetPath = queue.shift()) != null) {
    try {
      const entries = sort ? (await import_fs3.default.promises.readdir(targetPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)) : await import_fs3.default.promises.opendir(targetPath);
      for await (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules") {
          if (!includeDirectory || includeDirectory(targetPath, entry.name)) {
            queue.push(import_path4.default.join(targetPath, entry.name));
          }
        } else if (entry.isFile()) {
          yield {
            path: import_path4.default.join(targetPath, entry.name),
            parentPath: targetPath,
            name: entry.name
          };
        }
      }
    } catch {
      continue;
    }
  }
}
var import_fs3, import_path4, fileExistsAsync = async (file) => {
  const stat = await import_fs3.default.promises.stat(file).catch(() => null);
  return stat?.isFile() ? file : null;
}, fastJoin, maybeRealpath = async (target) => {
  try {
    return await import_fs3.default.promises.realpath(target);
  } catch {
    return null;
  }
}, loadPackageJson;
var init_utils = __esm(() => {
  import_fs3 = __toESM(require("fs"));
  import_path4 = __toESM(require("path"));
  fastJoin = import_path4.default.sep === "/" ? (from, append) => `${from}${import_path4.default.sep}${append}` : (from, append) => `${from}${import_path4.default.sep}${append[0] === "@" ? append.replace("/", import_path4.default.sep) : append}`;
  loadPackageJson = memoize(async function loadPackageJson2(jsonPath) {
    try {
      const packageJsonText = await import_fs3.default.promises.readFile(jsonPath, "utf8");
      const json = JSON.parse(packageJsonText);
      if (typeof json !== "object" || json == null) {
        return null;
      }
      return json;
    } catch {
      return null;
    }
  });
});

// src/platforms/apple/apple.ts
async function findPodspecFiles(revision) {
  const configPodspecPaths = revision.config?.applePodspecPaths();
  if (configPodspecPaths && configPodspecPaths.length) {
    return configPodspecPaths;
  } else {
    return await listFilesInDirectories(revision.path, (basename) => basename.endsWith(".podspec"));
  }
}
function getSwiftModuleNames(pods, swiftModuleNames) {
  if (swiftModuleNames && swiftModuleNames.length) {
    return swiftModuleNames;
  }
  return pods.map((pod) => pod.podName.replace(/[^a-zA-Z0-9]/g, "_"));
}
async function resolveModuleAsync(packageName, revision, extraOutput) {
  const podspecFiles = await findPodspecFiles(revision);
  if (!podspecFiles.length) {
    return null;
  }
  const pods = podspecFiles.map((podspecFile) => ({
    podName: import_path11.default.basename(podspecFile, import_path11.default.extname(podspecFile)),
    podspecDir: import_path11.default.dirname(import_path11.default.join(revision.path, podspecFile))
  }));
  const swiftModuleNames = getSwiftModuleNames(pods, revision.config?.appleSwiftModuleNames());
  const coreFeatures = revision.config?.coreFeatures() ?? [];
  return {
    packageName,
    pods,
    swiftModuleNames,
    flags: extraOutput.flags,
    modules: revision.config?.appleModules().map((module2) => typeof module2 === "string" ? { name: null, class: module2 } : module2) ?? [],
    appDelegateSubscribers: revision.config?.appleAppDelegateSubscribers() ?? [],
    reactDelegateHandlers: revision.config?.appleReactDelegateHandlers() ?? [],
    debugOnly: revision.config?.appleDebugOnly() ?? false,
    ...coreFeatures.length > 0 ? { coreFeatures } : {}
  };
}
async function resolveExtraBuildDependenciesAsync(projectNativeRoot) {
  const propsFile = import_path11.default.join(projectNativeRoot, APPLE_PROPERTIES_FILE);
  try {
    const contents = await import_fs7.default.promises.readFile(propsFile, "utf8");
    const podfileJson = JSON.parse(contents);
    if (podfileJson[APPLE_EXTRA_BUILD_DEPS_KEY]) {
      const extraPods = JSON.parse(podfileJson[APPLE_EXTRA_BUILD_DEPS_KEY]);
      return extraPods;
    }
  } catch {}
  return null;
}
async function generateModulesProviderAsync(modules, targetPath, entitlementPath) {
  const className = import_path11.default.basename(targetPath, import_path11.default.extname(targetPath));
  const entitlements = await parseEntitlementsAsync(entitlementPath);
  const generatedFileContent = await generatePackageListFileContentAsync(modules, className, entitlements);
  const parentPath = import_path11.default.dirname(targetPath);
  await import_fs7.default.promises.mkdir(parentPath, { recursive: true });
  await import_fs7.default.promises.writeFile(targetPath, generatedFileContent, "utf8");
}
async function generatePackageListFileContentAsync(modules, className, entitlements) {
  const iosModules = modules.filter((module2) => module2.modules.length || module2.appDelegateSubscribers.length || module2.reactDelegateHandlers.length);
  const modulesToImport = iosModules.filter((module2) => !module2.debugOnly);
  const debugOnlyModules = iosModules.filter((module2) => module2.debugOnly);
  const swiftModules = [].concat(...modulesToImport.map((module2) => module2.swiftModuleNames)).filter(Boolean);
  const debugOnlySwiftModules = [].concat(...debugOnlyModules.map((module2) => module2.swiftModuleNames)).filter(Boolean);
  const modulesClassNames = [].concat(...modulesToImport.map((module2) => module2.modules)).filter(Boolean);
  const debugOnlyModulesClassNames = [].concat(...debugOnlyModules.map((module2) => module2.modules)).filter(Boolean);
  const appDelegateSubscribers = [].concat(...modulesToImport.map((module2) => module2.appDelegateSubscribers));
  const debugOnlyAppDelegateSubscribers = [].concat(...debugOnlyModules.map((module2) => module2.appDelegateSubscribers));
  const reactDelegateHandlerModules = modulesToImport.filter((module2) => !!module2.reactDelegateHandlers.length);
  const debugOnlyReactDelegateHandlerModules = debugOnlyModules.filter((module2) => !!module2.reactDelegateHandlers.length);
  return `/**
 * Automatically generated by expo-modules-autolinking.
 *
 * This autogenerated class provides a list of classes of native Expo modules,
 * but only these that are written in Swift and use the new API for creating Expo modules.
 */

internal import ExpoModulesCore
${generateCommonImportList(swiftModules)}
${generateDebugOnlyImportList(debugOnlySwiftModules)}
@objc(${className})
internal class ${className}: ModulesProvider {
  public override func getModuleClasses() -> [ExpoModuleTupleType] {
${generateModuleClasses(modulesClassNames, debugOnlyModulesClassNames)}
  }

  public override func getAppDelegateSubscribers() -> [ExpoAppDelegateSubscriber.Type] {
${generateClasses(appDelegateSubscribers, debugOnlyAppDelegateSubscribers)}
  }

  public override func getReactDelegateHandlers() -> [ExpoReactDelegateHandlerTupleType] {
${generateReactDelegateHandlers(reactDelegateHandlerModules, debugOnlyReactDelegateHandlerModules)}
  }

  public override func getAppCodeSignEntitlements() -> AppCodeSignEntitlements {
    return AppCodeSignEntitlements.from(json: #"${JSON.stringify(entitlements)}"#)
  }
}
`;
}
function generateCommonImportList(swiftModules) {
  return swiftModules.map((moduleName) => `internal import ${moduleName}`).join(`
`);
}
function generateDebugOnlyImportList(swiftModules) {
  if (!swiftModules.length) {
    return "";
  }
  return wrapInDebugConfigurationCheck(0, swiftModules.map((moduleName) => `internal import ${moduleName}`).join(`
`)) + `
`;
}
function generateModuleClasses(modules, debugOnlyModules) {
  const commonClassNames = formatArrayOfModuleTuples(modules);
  if (debugOnlyModules.length > 0) {
    return wrapInDebugConfigurationCheck(2, `return ${formatArrayOfModuleTuples(modules.concat(debugOnlyModules))}`, `return ${commonClassNames}`);
  } else {
    return `${indent.repeat(2)}return ${commonClassNames}`;
  }
}
function formatArrayOfModuleTuples(modules) {
  return `[${modules.map((module2) => `
${indent.repeat(3)}(module: ${module2.class}.self, name: ${module2.name ? `"${module2.name}"` : "nil"})`).join(",")}
${indent.repeat(2)}]`;
}
function generateClasses(classNames, debugOnlyClassName) {
  const commonClassNames = formatArrayOfClassNames(classNames);
  if (debugOnlyClassName.length > 0) {
    return wrapInDebugConfigurationCheck(2, `return ${formatArrayOfClassNames(classNames.concat(debugOnlyClassName))}`, `return ${commonClassNames}`);
  } else {
    return `${indent.repeat(2)}return ${commonClassNames}`;
  }
}
function formatArrayOfClassNames(classNames) {
  return `[${classNames.map((className) => `
${indent.repeat(3)}${className}.self`).join(",")}
${indent.repeat(2)}]`;
}
function generateReactDelegateHandlers(module2, debugOnlyModules) {
  const commonModules = formatArrayOfReactDelegateHandler(module2);
  if (debugOnlyModules.length > 0) {
    return wrapInDebugConfigurationCheck(2, `return ${formatArrayOfReactDelegateHandler(module2.concat(debugOnlyModules))}`, `return ${commonModules}`);
  } else {
    return `${indent.repeat(2)}return ${commonModules}`;
  }
}
function formatArrayOfReactDelegateHandler(modules) {
  const values = [];
  for (const module2 of modules) {
    for (const handler of module2.reactDelegateHandlers) {
      values.push(`(packageName: "${module2.packageName}", handler: ${handler}.self)`);
    }
  }
  return `[${values.map((value) => `
${indent.repeat(3)}${value}`).join(",")}
${indent.repeat(2)}]`;
}
function wrapInDebugConfigurationCheck(indentationLevel, debugBlock, releaseBlock = null) {
  if (releaseBlock) {
    return `${indent.repeat(indentationLevel)}#if EXPO_CONFIGURATION_DEBUG
${indent.repeat(indentationLevel)}${debugBlock}
${indent.repeat(indentationLevel)}#else
${indent.repeat(indentationLevel)}${releaseBlock}
${indent.repeat(indentationLevel)}#endif`;
  }
  return `${indent.repeat(indentationLevel)}#if EXPO_CONFIGURATION_DEBUG
${indent.repeat(indentationLevel)}${debugBlock}
${indent.repeat(indentationLevel)}#endif`;
}
async function parseEntitlementsAsync(entitlementPath) {
  if (!entitlementPath || !await fileExistsAsync(entitlementPath)) {
    return {};
  }
  const { stdout } = await import_spawn_async.default("plutil", ["-convert", "json", "-o", "-", entitlementPath]);
  const entitlementsJson = JSON.parse(stdout);
  return {
    appGroups: entitlementsJson["com.apple.security.application-groups"] || undefined
  };
}
var import_spawn_async, import_fs7, import_path11, APPLE_PROPERTIES_FILE = "Podfile.properties.json", APPLE_EXTRA_BUILD_DEPS_KEY = "apple.extraPods", indent = "  ";
var init_apple = __esm(() => {
  init_utils();
  import_spawn_async = __toESM(require("@expo/spawn-async"));
  import_fs7 = __toESM(require("fs"));
  import_path11 = __toESM(require("path"));
});

// src/platforms/apple/index.ts
var exports_apple = {};
__export(exports_apple, {
  resolveModuleAsync: () => resolveModuleAsync,
  resolveExtraBuildDependenciesAsync: () => resolveExtraBuildDependenciesAsync,
  generateModulesProviderAsync: () => generateModulesProviderAsync
});
var init_apple2 = __esm(() => {
  init_apple();
});

// src/platforms/android/android.ts
function getConfiguration(options) {
  return options.buildFromSource ? { buildFromSource: options.buildFromSource } : undefined;
}
function isAndroidProject(projectRoot) {
  return import_fs8.default.existsSync(import_path12.default.join(projectRoot, "build.gradle")) || import_fs8.default.existsSync(import_path12.default.join(projectRoot, "build.gradle.kts"));
}
async function resolveModuleAsync2(packageName, revision) {
  if (packageName === "@unimodules/react-native-adapter") {
    return null;
  }
  const plugins = (revision.config?.androidGradlePlugins() ?? []).map(({ id, group, sourceDir, applyToRootProject }) => ({
    id,
    group,
    sourceDir: import_path12.default.join(revision.path, sourceDir),
    applyToRootProject: applyToRootProject ?? true
  }));
  const defaultProjectName = convertPackageToProjectName(packageName);
  const androidProjects = revision.config?.androidProjects(defaultProjectName)?.filter((project) => {
    return !project.isDefault || isAndroidProject(import_path12.default.join(revision.path, project.path));
  });
  if (!androidProjects?.length) {
    if (!plugins.length) {
      return null;
    }
    return {
      packageName,
      plugins
    };
  }
  const projects = await taskAll(androidProjects, async (project) => {
    const projectPath = import_path12.default.join(revision.path, project.path);
    const aarProjects = (project.gradleAarProjects ?? [])?.map((aarProject) => {
      const projectName = `${defaultProjectName}$${aarProject.name}`;
      const projectDir = import_path12.default.join(projectPath, "build", projectName);
      return {
        name: projectName,
        aarFilePath: import_path12.default.join(revision.path, aarProject.aarFilePath),
        projectDir
      };
    });
    const { publication } = project;
    const shouldUsePublicationScriptPath = project.shouldUsePublicationScriptPath ? import_path12.default.join(revision.path, project.shouldUsePublicationScriptPath) : undefined;
    const packages = new Set;
    for await (const file of scanFilesRecursively(projectPath)) {
      if (!file.name.endsWith("Package.java") && !file.name.endsWith("Package.kt")) {
        continue;
      }
      const fileContent = await import_fs8.default.promises.readFile(file.path, "utf8");
      if (!/\bimport\s+expo\.modules\.core\.(interfaces\.Package|BasePackage)\b/.test(fileContent)) {
        continue;
      }
      const classPathMatches = fileContent.match(/^package ([\w.]+)\b/m);
      if (classPathMatches) {
        const basename = import_path12.default.basename(file.name, import_path12.default.extname(file.name));
        packages.add(`${classPathMatches[1]}.${basename}`);
      }
    }
    return {
      name: project.name,
      sourceDir: projectPath,
      modules: project.modules ?? [],
      services: project.services ?? [],
      packages: [...packages].sort((a, b) => a.localeCompare(b)),
      ...shouldUsePublicationScriptPath ? { shouldUsePublicationScriptPath } : {},
      ...publication ? { publication } : {},
      ...aarProjects?.length > 0 ? { aarProjects } : {}
    };
  });
  const coreFeatures = revision.config?.coreFeatures() ?? [];
  return {
    packageName,
    projects,
    ...plugins?.length > 0 ? { plugins } : {},
    ...coreFeatures.length > 0 ? { coreFeatures } : {}
  };
}
async function resolveExtraBuildDependenciesAsync2(projectNativeRoot) {
  const extraMavenReposString = await resolveGradlePropertyAsync(projectNativeRoot, ANDROID_EXTRA_BUILD_DEPS_KEY);
  if (extraMavenReposString) {
    try {
      return JSON.parse(extraMavenReposString);
    } catch {}
  }
  return null;
}
async function resolveGradlePropertyAsync(projectNativeRoot, propertyKey) {
  const propsFile = import_path12.default.join(projectNativeRoot, ANDROID_PROPERTIES_FILE);
  try {
    const contents = await import_fs8.default.promises.readFile(propsFile, "utf8");
    const propertyValue = searchGradlePropertyFirst(contents, propertyKey);
    if (propertyValue) {
      return propertyValue;
    }
  } catch {}
  return null;
}
function convertPackageToProjectName(packageName) {
  return packageName.replace(/^@/g, "").replace(/\W+/g, "-");
}
function searchGradlePropertyFirst(contents, propertyName) {
  const lines = contents.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith("#")) {
      const eok = line.indexOf("=");
      const key = line.slice(0, eok);
      if (key === propertyName) {
        const value = line.slice(eok + 1, line.length);
        return value;
      }
    }
  }
  return null;
}
var import_fs8, import_path12, ANDROID_PROPERTIES_FILE = "gradle.properties", ANDROID_EXTRA_BUILD_DEPS_KEY = "android.extraMavenRepos";
var init_android = __esm(() => {
  init_utils();
  import_fs8 = __toESM(require("fs"));
  import_path12 = __toESM(require("path"));
});

// src/platforms/android/index.ts
var exports_android = {};
__export(exports_android, {
  resolveModuleAsync: () => resolveModuleAsync2,
  resolveExtraBuildDependenciesAsync: () => resolveExtraBuildDependenciesAsync2,
  getConfiguration: () => getConfiguration
});
var init_android2 = __esm(() => {
  init_android();
});

// src/platforms/devtools.ts
var exports_devtools = {};
__export(exports_devtools, {
  resolveModuleAsync: () => resolveModuleAsync3,
  resolveExtraBuildDependenciesAsync: () => resolveExtraBuildDependenciesAsync3
});
async function resolveModuleAsync3(packageName, revision) {
  const devtoolsConfig = revision.config?.toJSON().devtools;
  if (devtoolsConfig == null) {
    return null;
  }
  return {
    packageName,
    packageRoot: revision.path,
    webpageRoot: devtoolsConfig.webpageRoot ? import_path13.default.join(revision.path, devtoolsConfig.webpageRoot) : undefined,
    cliExtensions: devtoolsConfig.cliExtensions
  };
}
async function resolveExtraBuildDependenciesAsync3(_projectNativeRoot) {
  return null;
}
var import_path13;
var init_devtools = __esm(() => {
  import_path13 = __toESM(require("path"));
});

// src/platforms/web.ts
var exports_web = {};
__export(exports_web, {
  resolveModuleAsync: () => resolveModuleAsync4,
  resolveExtraBuildDependenciesAsync: () => resolveExtraBuildDependenciesAsync4
});
async function resolveModuleAsync4(packageName, revision) {
  return {
    packageName,
    packageRoot: revision.path
  };
}
async function resolveExtraBuildDependenciesAsync4(_projectNativeRoot) {
  return null;
}

// src/platforms/windows/windows.ts
async function scanForCSharpModules(packagePath) {
  const windowsDir = import_path14.default.join(packagePath, "windows");
  try {
    const entries = await import_fs9.default.promises.readdir(windowsDir, { withFileTypes: true, recursive: true });
    const moduleConfigs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith("Module.cs")) {
        continue;
      }
      const filePath = import_path14.default.join(windowsDir, entry.name);
      const content = await import_fs9.default.promises.readFile(filePath, "utf8");
      const classMatch = content.match(/class\s+(\w+Module)\s*:\s*Module/);
      if (classMatch) {
        const className = classMatch[1];
        const nsMatch = content.match(/namespace\s+([\w.]+)/);
        const fullyQualified = nsMatch ? `${nsMatch[1]}.${className}` : className;
        moduleConfigs.push({ name: null, class: fullyQualified });
      }
    }
    return moduleConfigs;
  } catch {
    return [];
  }
}
async function resolveModuleAsync5(packageName, revision) {
  const config = revision.config;
  if (!config) {
    return null;
  }
  const windowsConfig = config.getWindowsConfig();
  if (!windowsConfig) {
    return null;
  }
  let modules = config.windowsModules();
  if (modules.length === 0) {
    modules = await scanForCSharpModules(revision.path);
  }
  if (modules.length === 0) {
    return null;
  }
  const coreFeatures = config.coreFeatures() ?? [];
  return {
    packageName,
    modules,
    projectPath: config.windowsProjectPath(),
    debugOnly: config.windowsDebugOnly(),
    ...coreFeatures.length > 0 ? { coreFeatures } : {}
  };
}
async function resolveExtraBuildDependenciesAsync5(_projectNativeRoot) {
  return null;
}
async function generateModulesProviderAsync2(modules, targetPath) {
  const generatedFileContent = generateModulesProviderContent(modules);
  const parentPath = import_path14.default.dirname(targetPath);
  await import_fs9.default.promises.mkdir(parentPath, { recursive: true });
  await import_fs9.default.promises.writeFile(targetPath, generatedFileContent, "utf8");
}
function generateModulesProviderContent(modules) {
  const regularModules = modules.filter((m) => !m.debugOnly);
  const debugOnlyModules = modules.filter((m) => m.debugOnly);
  const regularEntries = [].concat(...regularModules.map((m) => m.modules)).filter(Boolean);
  const debugOnlyEntries = [].concat(...debugOnlyModules.map((m) => m.modules)).filter(Boolean);
  const regularLines = regularEntries.map((entry) => `${indent2.repeat(4)}typeof(${entry.class}),`);
  const debugOnlyLines = debugOnlyEntries.map((entry) => `${indent2.repeat(4)}typeof(${entry.class}),`);
  let arrayBody = "";
  if (regularLines.length > 0) {
    arrayBody += regularLines.join(`
`) + `
`;
  }
  if (debugOnlyLines.length > 0) {
    arrayBody += `#if DEBUG
`;
    arrayBody += debugOnlyLines.join(`
`) + `
`;
    arrayBody += `#endif
`;
  }
  return `// <auto-generated/>
// Automatically generated by expo-modules-autolinking.

using System;
using System.Collections.Generic;

namespace Expo.Modules.Autolinking
{
    public static class ExpoModulesProvider
    {
        public static IReadOnlyList<Type> GetModuleClasses()
        {
            return new Type[]
            {
${arrayBody}            };
        }
    }
}
`;
}
var import_fs9, import_path14, indent2 = "  ";
var init_windows = __esm(() => {
  import_fs9 = __toESM(require("fs"));
  import_path14 = __toESM(require("path"));
});

// src/platforms/windows/generators.ts
async function readAssemblyName(csprojPath) {
  try {
    const content = await import_fs10.default.promises.readFile(csprojPath, "utf8");
    const match = content.match(/<AssemblyName>\s*([^<]+?)\s*<\/AssemblyName>/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {}
  return import_path15.default.basename(csprojPath, ".csproj");
}
function generateAutolinkedCsproj(coreProject, moduleProjects, outputDir) {
  const coreRef = winPath.relative(outputDir, coreProject.csprojPath);
  const moduleRefs = moduleProjects.map((m) => winPath.relative(outputDir, m.csprojPath));
  let refs = `    <ProjectReference Include="${coreRef}" />
`;
  for (const ref of moduleRefs) {
    refs += `    <ProjectReference Include="${ref}" AdditionalProperties="ExpoModulesCoreProject=${coreRef}" />
`;
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
function generateDeployTargets(coreProject, autolinkedProject, moduleProjects, netHostPropsRelPath, targetsDir) {
  const allProjects = [coreProject, autolinkedProject, ...moduleProjects];
  let propertyLines = "";
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    const csprojDir = targetsDir ? winPath.relative(targetsDir, winPath.dirname(proj.csprojPath)) : winPath.dirname(proj.csprojPath);
    const prefix = targetsDir ? "$(MSBuildThisFileDirectory)" : "";
    const sep = csprojDir ? "\\" : "";
    propertyLines += `    <${propName}>${prefix}${csprojDir}${sep}bin\\$(Platform)\\$(Configuration)\\${TFM}\\</${propName}>
`;
  }
  let copyItems = "";
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    copyItems += `      <_ManagedFiles Include="$(${propName})${proj.assemblyName}.dll" />
`;
    copyItems += `      <_ManagedFiles Include="$(${propName})${proj.assemblyName}.pdb" />
`;
  }
  const corePropName = `_Expo_${sanitizePropName(coreProject.assemblyName)}_OutputDir`;
  copyItems += `      <_ManagedFiles Include="$(${corePropName})${coreProject.assemblyName}.runtimeconfig.json" />
`;
  let contentItems = "";
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    contentItems += `    <Content Include="$(${propName})${proj.assemblyName}.dll">
`;
    contentItems += `      <Link>managed\\${proj.assemblyName}.dll</Link>
`;
    contentItems += `      <DeploymentContent>true</DeploymentContent>
`;
    contentItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
`;
    contentItems += `    </Content>
`;
  }
  contentItems += `    <Content Include="$(${corePropName})${coreProject.assemblyName}.runtimeconfig.json">
`;
  contentItems += `      <Link>managed\\${coreProject.assemblyName}.runtimeconfig.json</Link>
`;
  contentItems += `      <DeploymentContent>true</DeploymentContent>
`;
  contentItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
`;
  contentItems += `    </Content>
`;
  let pdbItems = "";
  for (const proj of allProjects) {
    const propName = `_Expo_${sanitizePropName(proj.assemblyName)}_OutputDir`;
    pdbItems += `    <Content Include="$(${propName})${proj.assemblyName}.pdb" Condition="'$(Configuration)'=='Debug'">
`;
    pdbItems += `      <Link>managed\\${proj.assemblyName}.pdb</Link>
`;
    pdbItems += `      <DeploymentContent>true</DeploymentContent>
`;
    pdbItems += `      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
`;
    pdbItems += `    </Content>
`;
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
function generateProvider(modules) {
  return generateModulesProviderContent(modules);
}
function sanitizePropName(name) {
  return name.replace(/[.\-]/g, "_");
}
var import_fs10, import_path15, TFM = "net9.0-windows10.0.19041.0", winPath;
var init_generators = __esm(() => {
  init_windows();
  import_fs10 = __toESM(require("fs"));
  import_path15 = __toESM(require("path"));
  winPath = import_path15.default.win32;
});

// src/platforms/windows/slnUtils.ts
function generateDeterministicGuid(name) {
  const hash = import_crypto.default.createHash("sha1").update(GUID_NAMESPACE + ":" + name).digest("hex");
  const guid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32)
  ].join("-");
  return `{${guid.toUpperCase()}}`;
}
function updateSolution(slnContent, projects, managedFolderName = "Managed") {
  const eol = slnContent.includes(`\r
`) ? `\r
` : `
`;
  let lines = slnContent.split(/\r?\n/);
  const solutionConfigs = extractSolutionConfigs(lines);
  let managedFolderGuid = findSolutionFolderGuid(lines, managedFolderName);
  if (!managedFolderGuid) {
    managedFolderGuid = generateDeterministicGuid(`SolutionFolder:${managedFolderName}`);
    const globalIdx = lines.findIndex((l) => l.trim() === "Global");
    if (globalIdx >= 0) {
      lines.splice(globalIdx, 0, `Project("${SOLUTION_FOLDER_TYPE_GUID}") = "${managedFolderName}", "${managedFolderName}", "${managedFolderGuid}"`, "EndProject");
    }
  }
  const desiredGuids = new Set(projects.map((p) => p.guid));
  const existingManagedGuids = findNestedProjectGuids(lines, managedFolderGuid);
  const staleGuids = existingManagedGuids.filter((g) => !desiredGuids.has(g));
  for (const staleGuid of staleGuids) {
    lines = removeProjectBlock(lines, staleGuid);
    lines = removeConfigLines(lines, staleGuid);
    lines = removeNestedLine(lines, staleGuid);
  }
  for (const project of projects) {
    if (!hasProjectBlock(lines, project.guid)) {
      const globalIdx = lines.findIndex((l) => l.trim() === "Global");
      if (globalIdx >= 0) {
        lines.splice(globalIdx, 0, `Project("${CSPROJ_TYPE_GUID}") = "${project.name}", "${project.relativePath}", "${project.guid}"`, "EndProject");
      }
    }
    ensureConfigEntries(lines, project.guid, solutionConfigs);
    ensureNestedEntry(lines, project.guid, managedFolderGuid);
  }
  return lines.join(eol);
}
function extractSolutionConfigs(lines) {
  const configs = [];
  let inSection = false;
  for (const line of lines) {
    if (line.includes("GlobalSection(SolutionConfigurationPlatforms)")) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim() === "EndGlobalSection") {
      break;
    }
    if (inSection) {
      const match = line.match(/^\s+(.+?)\s*=\s*.+$/);
      if (match) {
        configs.push(match[1]);
      }
    }
  }
  return configs;
}
function findSolutionFolderGuid(lines, folderName) {
  for (const line of lines) {
    const match = line.match(new RegExp(`^Project\\("${escapeRegex(SOLUTION_FOLDER_TYPE_GUID)}"\\)\\s*=\\s*"${escapeRegex(folderName)}"\\s*,\\s*"${escapeRegex(folderName)}"\\s*,\\s*"([^"]+)"`));
    if (match) {
      return match[1];
    }
  }
  return null;
}
function hasProjectBlock(lines, guid) {
  return lines.some((l) => l.includes(guid) && l.startsWith("Project("));
}
function removeProjectBlock(lines, guid) {
  const result = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith("Project(") && line.includes(guid)) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === "EndProject") {
      skipping = false;
      continue;
    }
    if (!skipping) {
      result.push(line);
    }
  }
  return result;
}
function removeConfigLines(lines, guid) {
  return lines.filter((l) => !l.includes(guid) || !l.includes(".ActiveCfg") && !l.includes(".Build.0"));
}
function removeNestedLine(lines, guid) {
  return lines.filter((l) => {
    const trimmed = l.trim();
    return !(trimmed.startsWith(guid) && trimmed.includes("="));
  });
}
function findNestedProjectGuids(lines, folderGuid) {
  const guids = [];
  let inNested = false;
  for (const line of lines) {
    if (line.includes("GlobalSection(NestedProjects)")) {
      inNested = true;
      continue;
    }
    if (inNested && line.trim() === "EndGlobalSection") {
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
function ensureConfigEntries(lines, guid, solutionConfigs) {
  let sectionEndIdx = -1;
  let inSection = false;
  for (let i = 0;i < lines.length; i++) {
    if (lines[i].includes("GlobalSection(ProjectConfigurationPlatforms)")) {
      inSection = true;
      continue;
    }
    if (inSection && lines[i].trim() === "EndGlobalSection") {
      sectionEndIdx = i;
      break;
    }
  }
  if (sectionEndIdx < 0)
    return;
  if (lines.some((l) => l.includes(guid) && l.includes(".ActiveCfg"))) {
    return;
  }
  const newLines = [];
  for (const config of solutionConfigs) {
    const projectConfig = config;
    newLines.push(`		${guid}.${config}.ActiveCfg = ${projectConfig}`);
    newLines.push(`		${guid}.${config}.Build.0 = ${projectConfig}`);
  }
  lines.splice(sectionEndIdx, 0, ...newLines);
}
function ensureNestedEntry(lines, projectGuid, folderGuid) {
  let sectionEndIdx = -1;
  let inSection = false;
  for (let i = 0;i < lines.length; i++) {
    if (lines[i].includes("GlobalSection(NestedProjects)")) {
      inSection = true;
      continue;
    }
    if (inSection && lines[i].trim() === "EndGlobalSection") {
      sectionEndIdx = i;
      break;
    }
  }
  if (sectionEndIdx < 0) {
    const endGlobalIdx = lines.findIndex((l) => l.trim() === "EndGlobal");
    if (endGlobalIdx < 0)
      return;
    lines.splice(endGlobalIdx, 0, "\tGlobalSection(NestedProjects) = preSolution", `		${projectGuid} = ${folderGuid}`, "\tEndGlobalSection");
    return;
  }
  if (lines.some((l) => l.trim().startsWith(projectGuid) && l.includes(folderGuid))) {
    return;
  }
  lines.splice(sectionEndIdx, 0, `		${projectGuid} = ${folderGuid}`);
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function createSlnProject(name, csprojAbsPath, slnDir) {
  return {
    name,
    relativePath: winPath2.relative(slnDir, csprojAbsPath),
    guid: generateDeterministicGuid(`CSharpProject:${name}`)
  };
}
var import_crypto, import_path16, CSPROJ_TYPE_GUID = "{9A19103F-16F7-4668-BE54-9A1E7A4F7556}", SOLUTION_FOLDER_TYPE_GUID = "{2150E333-8FDC-42A3-9474-1A3956D46DE8}", winPath2, GUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
var init_slnUtils = __esm(() => {
  import_crypto = __toESM(require("crypto"));
  import_path16 = __toESM(require("path"));
  winPath2 = import_path16.default.win32;
});

// src/platforms/windows/vcxprojUtils.ts
function updateVcxproj(vcxprojContent, autolinkedCsprojRelPath, autolinkedTargetsRelPath, staleRefs = [], staleImports = []) {
  const eol = vcxprojContent.includes(`\r
`) ? `\r
` : `
`;
  let lines = vcxprojContent.split(/\r?\n/);
  for (const staleRef of staleRefs) {
    lines = removeProjectReference(lines, staleRef);
  }
  for (const staleImport of staleImports) {
    lines = removeImport(lines, staleImport);
  }
  lines = ensureProjectReference(lines, autolinkedCsprojRelPath, eol);
  lines = ensureImport(lines, autolinkedTargetsRelPath);
  lines = ensureCppWinRTMetadataFalse(lines);
  return lines.join(eol);
}
function removeProjectReference(lines, refPath) {
  const normalizedRef = refPath.replace(/\\/g, "/").toLowerCase();
  const result = [];
  let skipping = false;
  let inEmptyItemGroup = false;
  let itemGroupStart = -1;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const normalizedLine = line.replace(/\\/g, "/").toLowerCase();
    if (normalizedLine.includes("<projectreference") && normalizedLine.includes(normalizedRef)) {
      if (normalizedLine.includes("/>")) {
        continue;
      }
      skipping = true;
      continue;
    }
    if (skipping && line.trim().toLowerCase() === "</projectreference>") {
      skipping = false;
      continue;
    }
    if (!skipping) {
      result.push(line);
    }
  }
  return removeEmptyItemGroups(result);
}
function removeEmptyItemGroups(lines) {
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "<ItemGroup>") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "")
        j++;
      if (j < lines.length && lines[j].trim() === "</ItemGroup>") {
        i = j + 1;
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  return result;
}
function removeImport(lines, importPath) {
  const normalized = importPath.replace(/\\/g, "/").toLowerCase();
  return lines.filter((line) => {
    const normalizedLine = line.replace(/\\/g, "/").toLowerCase();
    return !(normalizedLine.includes("<import") && normalizedLine.includes(normalized));
  });
}
function ensureProjectReference(lines, csprojRelPath, eol) {
  const normalizedRef = csprojRelPath.replace(/\\/g, "/").toLowerCase();
  for (const line of lines) {
    const normalizedLine = line.replace(/\\/g, "/").toLowerCase();
    if (normalizedLine.includes("<projectreference") && normalizedLine.includes(normalizedRef)) {
      return lines;
    }
  }
  const closeProjectIdx = findLastIndex(lines, (l) => l.trim() === "</Project>");
  if (closeProjectIdx < 0)
    return lines;
  const newLines = [
    "  <ItemGroup>",
    `    <ProjectReference Include="${csprojRelPath}">`,
    "      <ReferenceOutputAssembly>false</ReferenceOutputAssembly>",
    "      <SkipGetTargetFrameworkProperties>true</SkipGetTargetFrameworkProperties>",
    "      <Private>false</Private>",
    "    </ProjectReference>",
    "  </ItemGroup>"
  ];
  lines.splice(closeProjectIdx, 0, ...newLines);
  return lines;
}
function ensureImport(lines, targetsRelPath) {
  const normalizedPath = targetsRelPath.replace(/\\/g, "/").toLowerCase();
  for (const line of lines) {
    const normalizedLine = line.replace(/\\/g, "/").toLowerCase();
    if (normalizedLine.includes("<import") && normalizedLine.includes(normalizedPath)) {
      return lines;
    }
  }
  const closeProjectIdx = findLastIndex(lines, (l) => l.trim() === "</Project>");
  if (closeProjectIdx < 0)
    return lines;
  lines.splice(closeProjectIdx, 0, `  <Import Project="${targetsRelPath}" />`);
  return lines;
}
function ensureCppWinRTMetadataFalse(lines) {
  for (const line of lines) {
    if (line.includes("<CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>")) {
      return lines;
    }
  }
  for (let i = 0;i < lines.length; i++) {
    if (lines[i].includes('Label="Globals"')) {
      for (let j = i + 1;j < lines.length; j++) {
        if (lines[j].trim() === "</PropertyGroup>") {
          lines.splice(j, 0, "    <CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>");
          return lines;
        }
      }
    }
  }
  return lines;
}
function findLastIndex(lines, predicate) {
  for (let i = lines.length - 1;i >= 0; i--) {
    if (predicate(lines[i])) {
      return i;
    }
  }
  return -1;
}

// src/platforms/windows/index.ts
var exports_windows = {};
__export(exports_windows, {
  updateVcxproj: () => updateVcxproj,
  updateSolution: () => updateSolution,
  resolveModuleAsync: () => resolveModuleAsync5,
  resolveExtraBuildDependenciesAsync: () => resolveExtraBuildDependenciesAsync5,
  readAssemblyName: () => readAssemblyName,
  generateProvider: () => generateProvider,
  generateModulesProviderContent: () => generateModulesProviderContent,
  generateModulesProviderAsync: () => generateModulesProviderAsync2,
  generateDeterministicGuid: () => generateDeterministicGuid,
  generateDeployTargets: () => generateDeployTargets,
  generateAutolinkedCsproj: () => generateAutolinkedCsproj,
  createSlnProject: () => createSlnProject
});
var init_windows2 = __esm(() => {
  init_windows();
  init_generators();
  init_slnUtils();
});

// package.json
var require_package = __commonJS((exports2, module2) => {
  module2.exports = {
    name: "expo-modules-autolinking",
    version: "55.0.8",
    description: "Scripts that autolink Expo modules.",
    main: "build/index.js",
    types: "build/index.d.ts",
    scripts: {
      build: "expo-module build",
      clean: "expo-module clean",
      lint: "expo-module lint",
      test: "expo-module test",
      prepare: "expo-module prepare",
      prepublishOnly: "expo-module prepublishOnly",
      "expo-module": "expo-module"
    },
    bin: {
      "expo-modules-autolinking": "bin/expo-modules-autolinking.js"
    },
    keywords: [
      "expo",
      "expo-module",
      "autolinking",
      "unimodules"
    ],
    repository: {
      type: "git",
      url: "https://github.com/expo/expo.git",
      directory: "packages/expo-modules-autolinking"
    },
    bugs: {
      url: "https://github.com/expo/expo/issues"
    },
    author: "650 Industries, Inc.",
    license: "MIT",
    homepage: "https://github.com/expo/expo/tree/main/packages/expo-modules-autolinking#readme",
    devDependencies: {
      "expo-module-scripts": "~55.0.2",
      memfs: "^3.2.0"
    },
    dependencies: {
      "@expo/require-utils": "^55.0.2",
      "@expo/spawn-async": "^1.7.2",
      chalk: "^4.1.0",
      commander: "^7.2.0"
    }
  };
});

// src/index.ts
var import_commander = __toESM(require("commander"));

// src/commands/autolinkWindowsCommand.ts
var import_fs11 = __toESM(require("fs"));
var import_path17 = __toESM(require("path"));

// src/commands/autolinkingOptions.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var isJSONObject = (x) => x != null && typeof x === "object";
var resolvePathMaybe = (target, basePath) => {
  if (typeof target !== "string") {
    return null;
  }
  let resolved = import_path.default.resolve(basePath, target);
  if (import_fs.default.existsSync(resolved)) {
    return resolved;
  } else if ((resolved = import_path.default.resolve(target)) && import_fs.default.existsSync(target)) {
    return target;
  } else {
    return null;
  }
};
var filterMapSearchPaths = (searchPaths, basePath) => {
  if (Array.isArray(searchPaths)) {
    return searchPaths.map((searchPath) => resolvePathMaybe(searchPath, basePath)).filter((searchPath) => searchPath != null);
  } else {
    return;
  }
};
var parsePackageJsonOptions = (packageJson, appRoot, platform) => {
  const expo = isJSONObject(packageJson.expo) ? packageJson.expo : null;
  const autolinkingOptions = expo && isJSONObject(expo.autolinking) ? expo.autolinking : null;
  let platformOptions = null;
  if (platform) {
    platformOptions = autolinkingOptions && isJSONObject(autolinkingOptions[platform]) ? autolinkingOptions[platform] : null;
    if (!platformOptions && platform === "apple") {
      platformOptions = autolinkingOptions && isJSONObject(autolinkingOptions.ios) ? autolinkingOptions.ios : null;
    }
  }
  const mergedOptions = { ...autolinkingOptions, ...platformOptions };
  const outputOptions = {};
  if (mergedOptions.legacy_shallowReactNativeLinking != null) {
    outputOptions.legacy_shallowReactNativeLinking = !!mergedOptions.legacy_shallowReactNativeLinking;
  }
  if (typeof mergedOptions.searchPaths === "string" || Array.isArray(mergedOptions.searchPaths)) {
    const rawSearchPaths = typeof mergedOptions.searchPaths === "string" ? [mergedOptions.searchPaths] : mergedOptions.searchPaths;
    outputOptions.searchPaths = filterMapSearchPaths(rawSearchPaths, appRoot);
  }
  if (typeof mergedOptions.nativeModulesDir === "string") {
    outputOptions.nativeModulesDir = resolvePathMaybe(mergedOptions.nativeModulesDir, appRoot);
  }
  if (Array.isArray(mergedOptions.exclude)) {
    outputOptions.exclude = mergedOptions.exclude.filter((x) => typeof x === "string");
  }
  if (Array.isArray(mergedOptions.buildFromSource)) {
    outputOptions.buildFromSource = mergedOptions.buildFromSource.filter((x) => typeof x === "string");
  }
  if (isJSONObject(mergedOptions.flags)) {
    outputOptions.flags = { ...mergedOptions.flags };
  }
  return outputOptions;
};
function registerAutolinkingArguments(command) {
  return command.option("-e, --exclude <exclude...>", "Package names to exclude when looking up for modules.", (value, previous) => (previous ?? []).concat(value)).option("-p, --platform [platform]", 'The platform that the resulting modules must support. Available options: "apple", "android"', "apple").option("--project-root <projectRoot>", "The path to the root of the project. Defaults to current working directory", process.cwd());
}
var parseExtraArgumentsOptions = (args) => {
  const cwd = process.cwd();
  const platform = args.platform || undefined;
  const commandRoot = resolvePathMaybe(args.projectRoot, cwd) || cwd;
  const extraSearchPaths = filterMapSearchPaths(args.searchPaths, commandRoot);
  const extraExclude = args.exclude?.filter((name) => typeof name === "string");
  return {
    platform,
    commandRoot,
    extraSearchPaths,
    extraExclude
  };
};
var findPackageJsonPathAsync = async (commandRoot) => {
  const root = commandRoot || process.cwd();
  for (let dir = root;import_path.default.dirname(dir) !== dir; dir = import_path.default.dirname(dir)) {
    const file = import_path.default.resolve(dir, "package.json");
    if (import_fs.default.existsSync(file)) {
      return file;
    }
  }
  throw new Error(`Couldn't find "package.json" up from path "${root}"`);
};
var loadPackageJSONAsync = async (packageJsonPath) => {
  const packageJsonText = await import_fs.default.promises.readFile(packageJsonPath, "utf8");
  return JSON.parse(packageJsonText);
};
function createAutolinkingOptionsLoader(argumentsOptions) {
  const extraArgumentsOptions = parseExtraArgumentsOptions(argumentsOptions ?? {});
  const { commandRoot } = extraArgumentsOptions;
  let _packageJsonPath$;
  const getPackageJsonPath = () => {
    return _packageJsonPath$ || (_packageJsonPath$ = findPackageJsonPathAsync(commandRoot));
  };
  let _packageJson$;
  const getPackageJson = async () => _packageJson$ || (_packageJson$ = loadPackageJSONAsync(await getPackageJsonPath()));
  const getAppRoot = async () => import_path.default.dirname(await getPackageJsonPath());
  return {
    getCommandRoot: () => commandRoot,
    getAppRoot,
    async getPlatformOptions(platform = extraArgumentsOptions.platform) {
      const packageJson = await getPackageJson();
      const appRoot = await getAppRoot();
      const options = parsePackageJsonOptions(packageJson, appRoot, platform);
      if (extraArgumentsOptions.extraSearchPaths) {
        options.searchPaths = [
          ...extraArgumentsOptions.extraSearchPaths,
          ...options.searchPaths ?? []
        ];
      }
      if (extraArgumentsOptions.extraExclude) {
        options.exclude = [...options.exclude ?? [], ...extraArgumentsOptions.extraExclude];
      }
      return {
        ...normalizeAutolinkingOptions(options, appRoot),
        platform
      };
    }
  };
}
var normalizeAutolinkingOptions = (options, appRoot) => {
  return {
    legacy_shallowReactNativeLinking: options.legacy_shallowReactNativeLinking ?? false,
    searchPaths: options.searchPaths ?? [],
    nativeModulesDir: options.nativeModulesDir ? resolvePathMaybe(options.nativeModulesDir, appRoot) ?? null : resolvePathMaybe("./modules", appRoot) ?? null,
    exclude: options.exclude ?? [],
    buildFromSource: options.buildFromSource,
    flags: options.flags
  };
};

// src/ExpoModuleConfig.ts
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
function arrayize(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value != null ? [value] : [];
}

class ExpoAndroidModuleConfig {
  classifier;
  name;
  constructor(classifier, name) {
    this.classifier = classifier;
    this.name = name;
  }
}

class ExpoAndroidProjectConfig {
  name;
  path;
  modules;
  services;
  publication;
  gradleAarProjects;
  shouldUsePublicationScriptPath;
  isDefault;
  constructor(name, path3, modules, services, publication, gradleAarProjects, shouldUsePublicationScriptPath, isDefault = false) {
    this.name = name;
    this.path = path3;
    this.modules = modules;
    this.services = services;
    this.publication = publication;
    this.gradleAarProjects = gradleAarProjects;
    this.shouldUsePublicationScriptPath = shouldUsePublicationScriptPath;
    this.isDefault = isDefault;
  }
}

class ExpoModuleConfig {
  rawConfig;
  constructor(rawConfig) {
    this.rawConfig = rawConfig;
  }
  supportsPlatform(platform) {
    const supportedPlatforms = this.rawConfig.platforms ?? [];
    if (platform === "web") {
      return true;
    } else if (platform === "apple") {
      return supportedPlatforms.some((supportedPlatform) => {
        return ["apple", "ios", "macos", "tvos"].includes(supportedPlatform);
      });
    }
    switch (platform) {
      case "ios":
      case "macos":
      case "tvos":
        return supportedPlatforms.includes(platform) || supportedPlatforms.includes("apple");
      case "windows":
        return supportedPlatforms.includes("windows");
      default:
        return supportedPlatforms.includes(platform);
    }
  }
  getAppleConfig() {
    return this.rawConfig.apple ?? this.rawConfig.ios ?? null;
  }
  appleModules() {
    const appleConfig = this.getAppleConfig();
    return appleConfig?.modules ?? [];
  }
  appleAppDelegateSubscribers() {
    return this.getAppleConfig()?.appDelegateSubscribers ?? [];
  }
  appleReactDelegateHandlers() {
    return this.getAppleConfig()?.reactDelegateHandlers ?? [];
  }
  applePodspecPaths() {
    return arrayize(this.getAppleConfig()?.podspecPath);
  }
  appleSwiftModuleNames() {
    return arrayize(this.getAppleConfig()?.swiftModuleName);
  }
  appleDebugOnly() {
    return this.getAppleConfig()?.debugOnly ?? false;
  }
  getWindowsConfig() {
    return this.rawConfig.windows ?? null;
  }
  windowsModules() {
    const windowsConfig = this.getWindowsConfig();
    return windowsConfig?.modules?.map((module2) => typeof module2 === "string" ? { name: null, class: module2 } : { name: module2.name ?? null, class: module2.class }) ?? [];
  }
  windowsProjectPath() {
    return this.getWindowsConfig()?.projectPath ?? null;
  }
  windowsDebugOnly() {
    return this.getWindowsConfig()?.debugOnly ?? false;
  }
  androidProjects(defaultProjectName) {
    const androidProjects = [];
    androidProjects.push(new ExpoAndroidProjectConfig(this.rawConfig.android?.name ?? defaultProjectName, this.rawConfig.android?.path ?? "android", this.rawConfig.android?.modules?.map((module2) => typeof module2 === "string" ? new ExpoAndroidModuleConfig(module2, null) : new ExpoAndroidModuleConfig(module2.class, module2.name)), this.rawConfig.android?.services, this.rawConfig.android?.publication, this.rawConfig.android?.gradleAarProjects, this.rawConfig.android?.shouldUsePublicationScriptPath, !this.rawConfig.android?.path));
    this.rawConfig.android?.projects?.forEach((project) => {
      androidProjects.push(new ExpoAndroidProjectConfig(project.name, project.path, project.modules?.map((module2) => typeof module2 === "string" ? new ExpoAndroidModuleConfig(module2, null) : new ExpoAndroidModuleConfig(module2.class, module2.name)), project.services, project.publication, project.gradleAarProjects, project.shouldUsePublicationScriptPath));
    });
    return androidProjects;
  }
  androidGradlePlugins() {
    return arrayize(this.rawConfig.android?.gradlePlugins ?? []);
  }
  androidGradleAarProjects() {
    return arrayize(this.rawConfig.android?.gradleAarProjects ?? []);
  }
  androidPublication() {
    return this.rawConfig.android?.publication;
  }
  coreFeatures() {
    return arrayize(this.rawConfig.coreFeatures ?? []);
  }
  toJSON() {
    return this.rawConfig;
  }
}
var EXPO_MODULE_CONFIG_FILENAMES = ["expo-module.config.json", "unimodule.json"];
var discoverExpoModuleConfigAsync = memoize(async function discoverExpoModuleConfigAsync2(directoryPath) {
  for (let idx = 0;idx < EXPO_MODULE_CONFIG_FILENAMES.length; idx++) {
    const targetPath = import_path2.default.join(directoryPath, EXPO_MODULE_CONFIG_FILENAMES[idx]);
    let text;
    try {
      text = await import_fs2.default.promises.readFile(targetPath, "utf8");
    } catch {
      continue;
    }
    return new ExpoModuleConfig(JSON.parse(text));
  }
  return null;
});

// src/dependencies/resolution.ts
var import_node_module = __toESM(require("node:module"));

// src/dependencies/utils.ts
var import_path3 = __toESM(require("path"));
var NODE_MODULES_PATTERN = `${import_path3.default.sep}node_modules${import_path3.default.sep}`;
function defaultShouldIncludeDependency(dependencyName) {
  const scopeName = dependencyName[0] === "@" ? dependencyName.slice(1, dependencyName.indexOf("/")) : null;
  if (scopeName === "babel" || scopeName === "types" || scopeName === "eslint" || scopeName === "typescript-eslint" || scopeName === "testing-library" || scopeName === "aws-crypto" || scopeName === "aws-sdk") {
    return false;
  }
  switch (dependencyName) {
    case "@expo/cli":
    case "@expo/config":
    case "@expo/metro-config":
    case "@expo/package-manager":
    case "@expo/prebuild-config":
    case "@expo/webpack-config":
    case "@expo/env":
    case "@react-native/codegen":
    case "@react-native/community-cli-plugin":
    case "eslint":
    case "eslint-config-expo":
    case "eslint-plugin-expo":
    case "eslint-plugin-import":
    case "jest-expo":
    case "jest":
    case "metro":
    case "ts-node":
    case "typescript":
    case "webpack":
      return false;
    default:
      return true;
  }
}
function mergeWithDuplicate(a, b) {
  let target;
  let duplicate;
  if (a.depth < b.depth) {
    target = a;
    duplicate = b;
  } else if (b.depth < a.depth) {
    target = b;
    duplicate = a;
  } else {
    const pathDepthA = a.originPath.split(NODE_MODULES_PATTERN).length;
    const pathDepthB = b.originPath.split(NODE_MODULES_PATTERN).length;
    if (pathDepthA < pathDepthB) {
      target = a;
      duplicate = b;
    } else if (pathDepthB < pathDepthA) {
      target = b;
      duplicate = a;
    } else {
      target = a;
      duplicate = b;
    }
  }
  const duplicates = target.duplicates || (target.duplicates = []);
  if (target.path !== duplicate.path) {
    if (duplicates.every((parent) => parent.path !== duplicate.path)) {
      duplicates.push({
        name: duplicate.name,
        version: duplicate.version,
        path: duplicate.path,
        originPath: duplicate.originPath
      });
    }
  } else if (!target.version && duplicate.version) {
    target.version = duplicate.version;
  }
  if (duplicate.duplicates?.length) {
    duplicates.push(...duplicate.duplicates.filter((child) => duplicates.every((parent) => parent.path !== child.path)));
  }
  return target;
}
async function filterMapResolutionResult(results, filterMap) {
  const resolutions = await taskAll(Object.keys(results), async (key) => {
    const resolution = results[key];
    const result = resolution ? await filterMap(resolution) : null;
    if (resolution?.source === 1 /* SEARCH_PATH */ && !result) {
      for (let idx = 0;resolution.duplicates && idx < resolution.duplicates.length; idx++) {
        const duplicate = resolution.duplicates[idx];
        const duplicateResult = await filterMap({ ...resolution, ...duplicate });
        if (duplicateResult != null) {
          return duplicateResult;
        }
      }
    }
    return result;
  });
  const output = Object.create(null);
  for (let idx = 0;idx < resolutions.length; idx++) {
    const resolution = resolutions[idx];
    if (resolution != null) {
      output[resolution.name] = resolution;
    }
  }
  return output;
}
function mergeResolutionResults(results, base) {
  if (base == null && results.length === 1) {
    return results[0];
  }
  const output = base == null ? Object.create(null) : base;
  for (let idx = 0;idx < results.length; idx++) {
    for (const key in results[idx]) {
      const resolution = results[idx][key];
      const prevResolution = output[key];
      if (prevResolution != null) {
        output[key] = mergeWithDuplicate(prevResolution, resolution);
      } else {
        output[key] = resolution;
      }
    }
  }
  return output;
}

// src/dependencies/resolution.ts
init_utils();
var MAX_DEPTH = 8;
var createNodeModulePathsCreator = () => {
  const _nodeModulePathCache = new Map;
  return async function getNodeModulePaths(packagePath) {
    const outputPaths = [];
    const nodeModulePaths = import_node_module.default._nodeModulePaths(packagePath);
    for (let idx = 0;idx < nodeModulePaths.length; idx++) {
      const nodeModulePath = nodeModulePaths[idx];
      let target = _nodeModulePathCache.get(nodeModulePath);
      if (target === undefined) {
        target = await maybeRealpath(nodeModulePath);
        if (idx !== 0) {
          _nodeModulePathCache.set(nodeModulePath, target);
        }
      }
      if (target != null) {
        outputPaths.push(target);
      }
    }
    return outputPaths;
  };
};
async function resolveDependencies(packageJson, nodeModulePaths, depth, shouldIncludeDependency) {
  const dependencies = Object.create(null);
  if (packageJson.dependencies != null && typeof packageJson.dependencies === "object") {
    Object.assign(dependencies, packageJson.dependencies);
  }
  if (depth === 0 && packageJson.devDependencies != null && typeof packageJson.devDependencies === "object") {
    Object.assign(dependencies, packageJson.devDependencies);
  }
  if (packageJson.peerDependencies != null && typeof packageJson.peerDependencies === "object") {
    const peerDependenciesMeta = packageJson.peerDependenciesMeta != null && typeof packageJson.peerDependenciesMeta === "object" ? packageJson.peerDependenciesMeta : undefined;
    for (const dependencyName in packageJson.peerDependencies) {
      if (!isOptionalPeerDependencyMeta(peerDependenciesMeta, dependencyName)) {
        dependencies[dependencyName] = "";
      }
    }
  }
  const resolveDependency = async (dependencyName) => {
    for (let idx = 0;idx < nodeModulePaths.length; idx++) {
      const originPath = fastJoin(nodeModulePaths[idx], dependencyName);
      const nodeModulePath = await maybeRealpath(originPath);
      if (nodeModulePath != null) {
        return {
          source: 0 /* RECURSIVE_RESOLUTION */,
          name: dependencyName,
          version: "",
          path: nodeModulePath,
          originPath,
          duplicates: null,
          depth
        };
      }
    }
    return null;
  };
  const modules = await taskAll(Object.keys(dependencies).filter((dependencyName) => shouldIncludeDependency(dependencyName)), (dependencyName) => resolveDependency(dependencyName));
  return modules.filter((resolution) => resolution != null);
}
async function scanDependenciesRecursively(rawPath, { shouldIncludeDependency = defaultShouldIncludeDependency, limitDepth } = {}) {
  const rootPath = await maybeRealpath(rawPath);
  if (!rootPath) {
    return {};
  }
  const _visitedPackagePaths = new Set;
  const getNodeModulePaths = createNodeModulePathsCreator();
  const maxDepth = limitDepth != null ? limitDepth : MAX_DEPTH;
  const recurse = async (resolution, depth = 0) => {
    const searchResults2 = Object.create(null);
    if (_visitedPackagePaths.has(resolution.path)) {
      return searchResults2;
    } else {
      _visitedPackagePaths.add(resolution.path);
    }
    const [nodeModulePaths, packageJson] = await Promise.all([
      getNodeModulePaths(resolution.path),
      loadPackageJson(fastJoin(resolution.path, "package.json"))
    ]);
    if (!packageJson) {
      return searchResults2;
    } else {
      resolution.version = packageJson.version || "";
    }
    const modules = await resolveDependencies(packageJson, nodeModulePaths, depth, shouldIncludeDependency);
    for (let idx = 0;idx < modules.length; idx++) {
      searchResults2[modules[idx].name] = modules[idx];
    }
    if (depth + 1 < maxDepth) {
      const childResults = await taskAll(modules, (resolution2) => recurse(resolution2, depth + 1));
      return mergeResolutionResults(childResults, searchResults2);
    } else {
      return searchResults2;
    }
  };
  const searchResults = await recurse({
    source: 0 /* RECURSIVE_RESOLUTION */,
    name: "",
    version: "",
    path: rootPath,
    originPath: rawPath,
    duplicates: null,
    depth: -1
  });
  return searchResults;
}
var isOptionalPeerDependencyMeta = (peerDependenciesMeta, packageName) => {
  return peerDependenciesMeta && peerDependenciesMeta[packageName] != null && typeof peerDependenciesMeta[packageName] === "object" && "optional" in peerDependenciesMeta[packageName] && !!peerDependenciesMeta[packageName].optional;
};
// src/dependencies/scanning.ts
var import_fs4 = __toESM(require("fs"));
init_utils();
async function resolveDependency(basePath, dependencyName, shouldIncludeDependency) {
  if (dependencyName && !shouldIncludeDependency(dependencyName)) {
    return null;
  }
  const originPath = dependencyName ? fastJoin(basePath, dependencyName) : basePath;
  const realPath = await maybeRealpath(originPath);
  const packageJson = await loadPackageJson(fastJoin(realPath || originPath, "package.json"));
  if (packageJson) {
    return {
      source: 1 /* SEARCH_PATH */,
      name: packageJson.name || "",
      version: packageJson.version || "",
      path: realPath || originPath,
      originPath,
      duplicates: null,
      depth: 0
    };
  } else if (dependencyName && realPath) {
    return {
      source: 1 /* SEARCH_PATH */,
      name: dependencyName.toLowerCase(),
      version: "",
      path: realPath,
      originPath,
      duplicates: null,
      depth: 0
    };
  } else {
    return null;
  }
}
async function scanDependenciesInSearchPath(rawPath, { shouldIncludeDependency = defaultShouldIncludeDependency } = {}) {
  const rootPath = await maybeRealpath(rawPath);
  const searchResults = Object.create(null);
  if (!rootPath) {
    return searchResults;
  }
  const resolvedDependencies = [];
  const localModuleTarget = await maybeRealpath(fastJoin(rootPath, "package.json"));
  if (localModuleTarget) {
    const resolution = await resolveDependency(rootPath, null, shouldIncludeDependency);
    if (resolution)
      resolvedDependencies.push(resolution);
  } else {
    const dirents = await import_fs4.default.promises.readdir(rootPath, { withFileTypes: true });
    await taskAll(dirents, async (entry) => {
      if (entry.isSymbolicLink()) {
        const resolution = await resolveDependency(rootPath, entry.name, shouldIncludeDependency);
        if (resolution)
          resolvedDependencies.push(resolution);
      } else if (entry.isDirectory()) {
        if (entry.name === "node_modules") {}
        if (entry.name[0] === ".") {} else if (entry.name[0] === "@") {
          const entryPath = fastJoin(rootPath, entry.name);
          const childEntries = await import_fs4.default.promises.readdir(entryPath, { withFileTypes: true });
          await Promise.all(childEntries.map(async (child) => {
            const dependencyName = `${entry.name}/${child.name}`;
            if (child.isDirectory() || child.isSymbolicLink()) {
              const resolution = await resolveDependency(rootPath, dependencyName, shouldIncludeDependency);
              if (resolution)
                resolvedDependencies.push(resolution);
            }
          }));
        } else {
          const resolution = await resolveDependency(rootPath, entry.name, shouldIncludeDependency);
          if (resolution)
            resolvedDependencies.push(resolution);
        }
      }
    });
  }
  for (let idx = 0;idx < resolvedDependencies.length; idx++) {
    const resolution = resolvedDependencies[idx];
    const prevEntry = searchResults[resolution.name];
    if (prevEntry != null && resolution.path !== prevEntry.path) {
      (prevEntry.duplicates ?? (prevEntry.duplicates = [])).push({
        name: resolution.name,
        version: resolution.version,
        path: resolution.path,
        originPath: resolution.originPath
      });
    } else if (prevEntry == null) {
      searchResults[resolution.name] = resolution;
    }
  }
  return searchResults;
}
// src/dependencies/rncliLocal.ts
var import_path5 = __toESM(require("path"));
init_utils();
async function scanDependenciesFromRNProjectConfig(rawPath, projectConfig, { shouldIncludeDependency = defaultShouldIncludeDependency } = {}) {
  const rootPath = await maybeRealpath(rawPath);
  const searchResults = Object.create(null);
  if (!rootPath || !projectConfig || !projectConfig.dependencies) {
    return searchResults;
  }
  await taskAll(Object.keys(projectConfig.dependencies).filter((dependencyName) => shouldIncludeDependency(dependencyName)), async (dependencyName) => {
    const dependencyConfig = projectConfig.dependencies[dependencyName];
    if (dependencyConfig && dependencyConfig.root && typeof dependencyConfig.root === "string") {
      const originPath = import_path5.default.resolve(rootPath, dependencyConfig.root);
      const realPath = await maybeRealpath(originPath);
      if (realPath) {
        searchResults[dependencyName] = {
          source: 2 /* RN_CLI_LOCAL */,
          name: dependencyName,
          version: "",
          path: realPath,
          originPath,
          duplicates: null,
          depth: 0
        };
      }
    }
  });
  return searchResults;
}
// src/dependencies/CachedDependenciesLinker.ts
var import_fs6 = __toESM(require("fs"));
// src/reactNativeConfig/reactNativeConfig.ts
var import_fs5 = __toESM(require("fs"));
var import_path10 = __toESM(require("path"));

// src/reactNativeConfig/androidResolver.ts
init_utils();
var import_promises = __toESM(require("fs/promises"));
var import_path6 = __toESM(require("path"));
async function resolveDependencyConfigImplAndroidAsync(packageRoot, reactNativeConfig, expoModuleConfig) {
  if (reactNativeConfig === null) {
    return null;
  }
  const sourceDir = reactNativeConfig?.sourceDir || "android";
  const androidDir = import_path6.default.join(packageRoot, sourceDir);
  const { gradle, manifest } = await findGradleAndManifestAsync({ androidDir, isLibrary: true });
  const isPureCxxDependency = reactNativeConfig?.cxxModuleCMakeListsModuleName != null && reactNativeConfig?.cxxModuleCMakeListsPath != null && reactNativeConfig?.cxxModuleHeaderName != null && !manifest && !gradle;
  if (!manifest && !gradle && !isPureCxxDependency) {
    return null;
  }
  if (reactNativeConfig === undefined && expoModuleConfig?.supportsPlatform("android")) {
    if (!!gradle && !expoModuleConfig?.rawConfig.android?.gradlePath) {
      return null;
    }
  }
  let packageInstance = null;
  let packageImportPath = null;
  if (!isPureCxxDependency) {
    const packageName = reactNativeConfig?.packageName || await parsePackageNameAsync(manifest, gradle);
    if (!packageName) {
      return null;
    }
    const nativePackageClassName = await parseNativePackageClassNameAsync(packageRoot, androidDir);
    if (!nativePackageClassName) {
      return null;
    }
    packageImportPath = reactNativeConfig?.packageImportPath || `import ${packageName}.${nativePackageClassName};`;
    packageInstance = reactNativeConfig?.packageInstance || `new ${nativePackageClassName}()`;
  }
  const packageJson = await loadPackageJson(fastJoin(packageRoot, "package.json"));
  const buildTypes = reactNativeConfig?.buildTypes || [];
  const dependencyConfiguration = reactNativeConfig?.dependencyConfiguration;
  const libraryName = reactNativeConfig?.libraryName || await parseLibraryNameAsync(androidDir, packageJson);
  const componentDescriptors = reactNativeConfig?.componentDescriptors || await parseComponentDescriptorsAsync(packageRoot, packageJson);
  let cmakeListsPath = reactNativeConfig?.cmakeListsPath ? import_path6.default.join(androidDir, reactNativeConfig?.cmakeListsPath) : import_path6.default.join(androidDir, "build/generated/source/codegen/jni/CMakeLists.txt");
  const cxxModuleCMakeListsModuleName = reactNativeConfig?.cxxModuleCMakeListsModuleName || null;
  const cxxModuleHeaderName = reactNativeConfig?.cxxModuleHeaderName || null;
  let cxxModuleCMakeListsPath = reactNativeConfig?.cxxModuleCMakeListsPath ? import_path6.default.join(androidDir, reactNativeConfig?.cxxModuleCMakeListsPath) : null;
  if (process.platform === "win32") {
    cmakeListsPath = cmakeListsPath.replace(/\\/g, "/");
    if (cxxModuleCMakeListsPath) {
      cxxModuleCMakeListsPath = cxxModuleCMakeListsPath.replace(/\\/g, "/");
    }
  }
  const result = {
    sourceDir: androidDir,
    packageImportPath,
    packageInstance,
    dependencyConfiguration,
    buildTypes,
    libraryName,
    componentDescriptors,
    cmakeListsPath,
    cxxModuleCMakeListsModuleName,
    cxxModuleCMakeListsPath,
    cxxModuleHeaderName,
    isPureCxxDependency
  };
  if (!result.libraryName) {
    delete result.libraryName;
  }
  if (!result.dependencyConfiguration) {
    delete result.dependencyConfiguration;
  }
  return result;
}
async function parsePackageNameAsync(manifestPath, gradlePath) {
  if (gradlePath) {
    const gradleContents = await import_promises.default.readFile(gradlePath, "utf8");
    const match = gradleContents.match(/namespace\s*[=]*\s*["'](.+?)["']/);
    if (match) {
      return match[1];
    }
  }
  if (manifestPath) {
    const manifestContents = await import_promises.default.readFile(manifestPath, "utf8");
    const match = manifestContents.match(/package="(.+?)"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}
async function parseNativePackageClassNameAsync(packageRoot, androidDir) {
  for await (const entry of scanFilesRecursively(androidDir, undefined, true)) {
    if (entry.name.endsWith("Package.java") || entry.name.endsWith("Package.kt")) {
      try {
        const contents = await import_promises.default.readFile(entry.path);
        const matched = matchNativePackageClassName(entry.path, contents);
        if (matched) {
          return matched;
        }
      } catch {
        continue;
      }
    }
  }
  if (await fileExistsAsync(import_path6.default.join(packageRoot, "expo-module.config.json"))) {
    return null;
  }
  for await (const entry of scanFilesRecursively(androidDir, undefined, true)) {
    if (entry.name.endsWith(".java") || entry.name.endsWith(".kt")) {
      const contents = await import_promises.default.readFile(entry.path);
      const matched = matchNativePackageClassName(entry.path, contents);
      if (matched) {
        return matched;
      }
    }
  }
  return null;
}
var lazyReactPackageRegex = null;
var lazyTurboReactPackageRegex = null;
function matchNativePackageClassName(_filePath, contents) {
  const fileContents = contents.toString();
  if (!lazyReactPackageRegex) {
    lazyReactPackageRegex = /class\s+(\w+[^(\s]*)[\s\w():]*(\s+implements\s+|:)[\s\w():,]*[^{]*ReactPackage/;
  }
  const matchReactPackage = fileContents.match(lazyReactPackageRegex);
  if (matchReactPackage) {
    return matchReactPackage[1];
  }
  if (!lazyTurboReactPackageRegex) {
    lazyTurboReactPackageRegex = /class\s+(\w+[^(\s]*)[\s\w():]*(\s+extends\s+|:)[\s\w():,]*[^{]*(Base|Turbo)ReactPackage/;
  }
  const matchTurboReactPackage = fileContents.match(lazyTurboReactPackageRegex);
  if (matchTurboReactPackage) {
    return matchTurboReactPackage[1];
  }
  return null;
}
async function parseLibraryNameAsync(androidDir, packageJson) {
  if (packageJson.codegenConfig?.name) {
    return packageJson.codegenConfig.name;
  }
  const libraryNameRegExp = /libraryName = ["'](.+)["']/;
  const gradlePath = import_path6.default.join(androidDir, "build.gradle");
  if (await fileExistsAsync(gradlePath)) {
    const buildGradleContents = await import_promises.default.readFile(gradlePath, "utf8");
    const match = buildGradleContents.match(libraryNameRegExp);
    if (match) {
      return match[1];
    }
  }
  const gradleKtsPath = import_path6.default.join(androidDir, "build.gradle.kts");
  if (await fileExistsAsync(gradleKtsPath)) {
    const buildGradleContents = await import_promises.default.readFile(gradleKtsPath, "utf8");
    const match = buildGradleContents.match(libraryNameRegExp);
    if (match) {
      return match[1];
    }
  }
  return null;
}
async function parseComponentDescriptorsAsync(packageRoot, packageJson) {
  const jsRoot = packageJson?.codegenConfig?.jsSrcsDir ? import_path6.default.join(packageRoot, packageJson.codegenConfig.jsSrcsDir) : packageRoot;
  const extRe = /\.[tj]sx?$/;
  const results = new Set;
  for await (const entry of scanFilesRecursively(jsRoot)) {
    if (extRe.test(entry.name)) {
      const contents = await import_promises.default.readFile(entry.path, "utf8");
      const matched = matchComponentDescriptors(entry.path, contents);
      if (matched) {
        results.add(matched);
      }
    }
  }
  return [...results].sort((a, b) => a.localeCompare(b));
}
var lazyCodegenComponentRegex = null;
function matchComponentDescriptors(_filePath, contents) {
  if (!lazyCodegenComponentRegex) {
    lazyCodegenComponentRegex = /codegenNativeComponent(<.*>)?\s*\(\s*["'`](\w+)["'`](,?[\s\S]+interfaceOnly:\s*(\w+))?/m;
  }
  const match = contents.match(lazyCodegenComponentRegex);
  if (!(match?.[4] === "true") && match?.[2]) {
    return `${match[2]}ComponentDescriptor`;
  }
  return null;
}
var findAndroidManifestsAsync = async (targetPath) => {
  const files = scanFilesRecursively(targetPath, (parentPath, name) => {
    switch (name) {
      case "build":
      case "debug":
      case "Pods":
        return false;
      case "Examples":
      case "examples":
        return parentPath !== targetPath;
      case "android":
        return !/[\\/]sdks[\\/]hermes$/.test(parentPath);
      case "androidTest":
      case "test":
        return !/[\\/]src$/.test(parentPath);
      default:
        return true;
    }
  });
  const manifestPaths = [];
  for await (const entry of files) {
    if (entry.name === "AndroidManifest.xml") {
      manifestPaths.push(entry.path);
    }
  }
  return manifestPaths.sort((a, b) => a.localeCompare(b));
};
var getFileCandidatesAsync = async (targetPath, fileNames) => {
  const gradlePaths = await taskAll(fileNames, (fileName) => fileExistsAsync(import_path6.default.join(targetPath, fileName)));
  return gradlePaths.filter((file) => file != null).sort((a, b) => a.localeCompare(b));
};
async function findGradleAndManifestAsync({
  androidDir,
  isLibrary
}) {
  const [manifests, gradles] = await Promise.all([
    findAndroidManifestsAsync(androidDir),
    getFileCandidatesAsync(isLibrary ? androidDir : import_path6.default.join(androidDir, "app"), [
      "build.gradle",
      "build.gradle.kts"
    ])
  ]);
  const manifest = manifests.find((manifest2) => manifest2.includes("src/main/")) ?? manifests.sort((a, b) => a.localeCompare(b))[0];
  const gradle = gradles.sort((a, b) => a.localeCompare(b))[0];
  return { gradle: gradle || null, manifest: manifest || null };
}

// src/reactNativeConfig/config.ts
init_utils();
var import_require_utils = require("@expo/require-utils");
var import_promises2 = __toESM(require("fs/promises"));
var import_path7 = __toESM(require("path"));
var __dirname = "/Users/barthap/dev/projects/expo-modules-windows/vendor/expo-modules-autolinking/src/reactNativeConfig";
var mockedNativeModules = import_path7.default.join(__dirname, "..", "..", "node_modules_mock");
var loadConfigAsync = memoize(async function loadConfigAsync2(packageRoot) {
  const configPath = (await Promise.all(["react-native.config.js", "react-native.config.ts"].map(async (fileName) => {
    const file = import_path7.default.join(packageRoot, fileName);
    return await fileExistsAsync(file) ? file : null;
  }))).find((path8) => path8 != null);
  if (configPath) {
    const mod = import_require_utils.evalModule(await import_promises2.default.readFile(configPath, "utf8"), configPath, { paths: [mockedNativeModules] });
    return mod.default ?? mod ?? null;
  } else {
    return null;
  }
});

// src/reactNativeConfig/iosResolver.ts
init_utils();
var import_path8 = __toESM(require("path"));
var findPodspecFile = async (targetPath) => {
  const podspecFiles = await listFilesSorted(targetPath, (basename) => {
    return basename.endsWith(".podspec");
  });
  const mainBasename = import_path8.default.basename(targetPath).toLowerCase();
  const mainPodspecFile = podspecFiles.find((podspecFile) => import_path8.default.basename(podspecFile, ".podspec").toLowerCase() === mainBasename);
  return mainPodspecFile ?? (podspecFiles.length > 0 ? podspecFiles[0] : null);
};
async function resolveDependencyConfigImplIosAsync(resolution, reactNativeConfig, expoModuleConfig) {
  if (reactNativeConfig === null) {
    return null;
  }
  const podspecPath = await findPodspecFile(resolution.path);
  if (!podspecPath) {
    return null;
  }
  if (reactNativeConfig === undefined && expoModuleConfig?.supportsPlatform("apple")) {
    const overlappingPodspecPath = expoModuleConfig.applePodspecPaths().find((targetFile) => {
      const expoPodspecPath = import_path8.default.normalize(import_path8.default.join(resolution.path, targetFile));
      return expoPodspecPath === import_path8.default.normalize(podspecPath);
    });
    if (overlappingPodspecPath != null) {
      return null;
    }
  }
  return {
    podspecPath,
    version: resolution.version,
    configurations: reactNativeConfig?.configurations || [],
    scriptPhases: reactNativeConfig?.scriptPhases || []
  };
}

// src/reactNativeConfig/webResolver.ts
var import_promises3 = __toESM(require("fs/promises"));
var import_path9 = __toESM(require("path"));
async function checkDependencyWebAsync(resolution, reactNativeConfig, expoModuleConfig) {
  if (!reactNativeConfig || expoModuleConfig) {
    return null;
  }
  const hasReactNativeConfig = !!reactNativeConfig && Object.keys(reactNativeConfig).length > 0;
  if (!hasReactNativeConfig) {
    const packageJson = JSON.parse(await import_promises3.default.readFile(import_path9.default.join(resolution.path, "package.json"), "utf8"));
    const peerDependencies = packageJson.peerDependencies && typeof packageJson.peerDependencies === "object" ? packageJson.peerDependencies : {};
    const codegenConfig = packageJson.codegenConfig && typeof packageJson.codegenConfig === "object" ? packageJson.codegenConfig : null;
    const hasReactNativePeer = !!peerDependencies["react-native"];
    const hasCodegenConfig = !!codegenConfig && Object.keys(codegenConfig).length > 0;
    if (!hasReactNativePeer || !hasCodegenConfig) {
      return null;
    }
  }
  return {
    version: resolution.version
  };
}

// src/reactNativeConfig/reactNativeConfig.ts
var isMissingFBReactNativeSpecCodegenOutput = async (reactNativePath) => {
  const generatedDir = import_path10.default.resolve(reactNativePath, "React/FBReactNativeSpec");
  try {
    const stat = await import_fs5.default.promises.lstat(generatedDir);
    return !stat.isDirectory();
  } catch {
    return true;
  }
};
async function resolveReactNativeModule(resolution, projectConfig, platform, excludeNames) {
  if (excludeNames.has(resolution.name)) {
    return null;
  } else if (resolution.name === "react-native" || resolution.name === "react-native-macos") {
    return null;
  }
  const libraryConfig = await loadConfigAsync(resolution.path);
  const reactNativeConfig = {
    ...libraryConfig?.dependency,
    ...projectConfig?.dependencies?.[resolution.name]
  };
  if (Object.keys(libraryConfig?.platforms ?? {}).length > 0) {
    return null;
  }
  let maybeExpoModuleConfig;
  if (!libraryConfig) {
    try {
      maybeExpoModuleConfig = await discoverExpoModuleConfigAsync(resolution.path);
    } catch {}
  }
  let platformData = null;
  if (platform === "android") {
    platformData = await resolveDependencyConfigImplAndroidAsync(resolution.path, reactNativeConfig.platforms?.android, maybeExpoModuleConfig);
  } else if (platform === "ios") {
    platformData = await resolveDependencyConfigImplIosAsync(resolution, reactNativeConfig.platforms?.ios, maybeExpoModuleConfig);
  } else if (platform === "web") {
    platformData = await checkDependencyWebAsync(resolution, reactNativeConfig, maybeExpoModuleConfig);
  }
  return platformData && {
    root: resolution.path,
    name: resolution.name,
    platforms: {
      [platform]: platformData
    }
  };
}
async function createReactNativeConfigAsync({
  appRoot,
  sourceDir,
  autolinkingOptions
}) {
  const excludeNames = new Set(autolinkingOptions.exclude);
  const projectConfig = await loadConfigAsync(appRoot);
  const searchPaths = autolinkingOptions.nativeModulesDir ? [autolinkingOptions.nativeModulesDir, ...autolinkingOptions.searchPaths] : autolinkingOptions.searchPaths;
  const limitDepth = autolinkingOptions.legacy_shallowReactNativeLinking ? 1 : undefined;
  const resolutions = mergeResolutionResults(await Promise.all([
    scanDependenciesFromRNProjectConfig(appRoot, projectConfig),
    ...searchPaths.map((searchPath) => scanDependenciesInSearchPath(searchPath)),
    scanDependenciesRecursively(appRoot, { limitDepth })
  ]));
  const dependencies = await filterMapResolutionResult(resolutions, (resolution) => resolveReactNativeModule(resolution, projectConfig, autolinkingOptions.platform, excludeNames));
  const reactNativeResolution = resolutions["react-native"];
  if (reactNativeResolution && autolinkingOptions.platform === "ios" && await isMissingFBReactNativeSpecCodegenOutput(reactNativeResolution.path)) {
    dependencies["react-native"] = {
      root: reactNativeResolution.path,
      name: "react-native",
      platforms: {
        ios: {
          podspecPath: "",
          version: reactNativeResolution.version,
          configurations: [],
          scriptPhases: []
        }
      }
    };
  }
  return {
    root: appRoot,
    reactNativePath: resolutions["react-native"]?.path,
    dependencies,
    project: await resolveAppProjectConfigAsync(appRoot, autolinkingOptions.platform, sourceDir)
  };
}
async function resolveAppProjectConfigAsync(projectRoot, platform, sourceDir) {
  if (platform === "android") {
    const androidDir = sourceDir ?? import_path10.default.join(projectRoot, "android");
    const { gradle, manifest } = await findGradleAndManifestAsync({ androidDir, isLibrary: false });
    if (gradle == null || manifest == null) {
      return {};
    }
    const packageName = await parsePackageNameAsync(manifest, gradle);
    return {
      android: {
        packageName: packageName ?? "",
        sourceDir: sourceDir ?? import_path10.default.join(projectRoot, "android")
      }
    };
  }
  if (platform === "ios") {
    return {
      ios: {
        sourceDir: sourceDir ?? import_path10.default.join(projectRoot, "ios")
      }
    };
  }
  return {};
}
// src/dependencies/CachedDependenciesLinker.ts
function makeCachedDependenciesLinker(params) {
  const memoizer = createMemoizer();
  const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
    projectRoot: params.projectRoot
  });
  let appRoot;
  const getAppRoot = () => appRoot || (appRoot = autolinkingOptionsLoader.getAppRoot());
  const dependenciesResultBySearchPath = new Map;
  let reactNativeProjectConfig;
  let reactNativeProjectConfigDependencies;
  let recursiveDependencies;
  return {
    memoizer,
    async getOptionsForPlatform(platform) {
      const options = await autolinkingOptionsLoader.getPlatformOptions(platform);
      return makeCachedDependenciesSearchOptions(options);
    },
    async loadReactNativeProjectConfig() {
      if (reactNativeProjectConfig === undefined) {
        reactNativeProjectConfig = memoizer.call(loadConfigAsync, await getAppRoot());
      }
      return reactNativeProjectConfig;
    },
    async scanDependenciesFromRNProjectConfig() {
      if (reactNativeProjectConfigDependencies === undefined) {
        reactNativeProjectConfigDependencies = memoizer.withMemoizer(async () => {
          return await scanDependenciesFromRNProjectConfig(await getAppRoot(), await this.loadReactNativeProjectConfig());
        });
      }
      return reactNativeProjectConfigDependencies;
    },
    async scanDependenciesRecursively() {
      if (recursiveDependencies === undefined) {
        recursiveDependencies = memoizer.withMemoizer(async () => {
          return scanDependenciesRecursively(await getAppRoot());
        });
      }
      return recursiveDependencies;
    },
    async scanDependenciesInSearchPath(searchPath) {
      let result = dependenciesResultBySearchPath.get(searchPath);
      if (!result) {
        dependenciesResultBySearchPath.set(searchPath, result = memoizer.withMemoizer(scanDependenciesInSearchPath, searchPath));
      }
      return result;
    }
  };
}
async function scanDependencyResolutionsForPlatform(linker, platform, include) {
  const { excludeNames, searchPaths } = await linker.getOptionsForPlatform(platform);
  const includeNames = new Set(include);
  const reactNativeProjectConfig = await linker.loadReactNativeProjectConfig();
  const resolutions = mergeResolutionResults(await Promise.all([
    linker.scanDependenciesFromRNProjectConfig(),
    ...searchPaths.map((searchPath) => {
      return linker.scanDependenciesInSearchPath(searchPath);
    }),
    linker.scanDependenciesRecursively()
  ]));
  return await linker.memoizer.withMemoizer(async () => {
    const dependencies = await filterMapResolutionResult(resolutions, async (resolution) => {
      if (excludeNames.has(resolution.name)) {
        return null;
      } else if (includeNames.has(resolution.name)) {
        return resolution;
      } else if (resolution.source === 2 /* RN_CLI_LOCAL */) {
        const reactNativeModuleDesc = await resolveReactNativeModule(resolution, reactNativeProjectConfig, platform, excludeNames);
        if (!reactNativeModuleDesc) {
          return null;
        }
      } else {
        const [reactNativeModule, expoModule] = await Promise.all([
          resolveReactNativeModule(resolution, reactNativeProjectConfig, platform, excludeNames),
          resolveExpoModule(resolution, platform, excludeNames)
        ]);
        if (!reactNativeModule && !expoModule) {
          return null;
        }
      }
      return resolution;
    });
    return dependencies;
  });
}
var makeCachedDependenciesSearchOptions = (options) => ({
  excludeNames: new Set(options.exclude),
  searchPaths: options.nativeModulesDir && import_fs6.default.existsSync(options.nativeModulesDir) ? [options.nativeModulesDir, ...options.searchPaths ?? []] : options.searchPaths ?? []
});
// src/autolinking/findModules.ts
async function resolveExpoModule(resolution, platform, excludeNames) {
  if (excludeNames.has(resolution.name)) {
    return null;
  }
  const expoModuleConfig = await discoverExpoModuleConfigAsync(resolution.path);
  if (expoModuleConfig && expoModuleConfig.supportsPlatform(platform)) {
    return {
      name: resolution.name,
      path: resolution.path,
      version: resolution.version,
      config: expoModuleConfig,
      duplicates: resolution.duplicates?.map((duplicate) => ({
        name: duplicate.name,
        path: duplicate.path,
        version: duplicate.version
      })) ?? []
    };
  } else {
    return null;
  }
}
async function findModulesAsync({
  appRoot,
  autolinkingOptions
}) {
  const memoizer = createMemoizer();
  const excludeNames = new Set(autolinkingOptions.exclude);
  const searchPaths = autolinkingOptions.nativeModulesDir ? [autolinkingOptions.nativeModulesDir, ...autolinkingOptions.searchPaths] : autolinkingOptions.searchPaths;
  return memoizer.withMemoizer(async () => {
    return filterMapResolutionResult(mergeResolutionResults(await Promise.all([
      ...searchPaths.map((searchPath) => scanDependenciesInSearchPath(searchPath)),
      scanDependenciesRecursively(appRoot)
    ])), (resolution) => resolveExpoModule(resolution, autolinkingOptions.platform, excludeNames));
  });
}
// src/platforms/index.ts
function getLinkingImplementationForPlatform(platform) {
  if (!platform) {
    throw new Error(`No platform was specified, but linking commands require a specific platform.`);
  }
  switch (platform) {
    case "ios":
    case "macos":
    case "tvos":
    case "apple":
      return init_apple2(), __toCommonJS(exports_apple);
    case "android":
      return init_android2(), __toCommonJS(exports_android);
    case "devtools":
      return init_devtools(), __toCommonJS(exports_devtools);
    case "web":
      return __toCommonJS(exports_web);
    case "windows":
      return init_windows2(), __toCommonJS(exports_windows);
    default:
      throw new Error(`No linking implementation is available for platform "${platform}"`);
  }
}

// src/autolinking/resolveModules.ts
async function resolveModulesAsync(searchResults, autolinkingOptions) {
  const platformLinking = getLinkingImplementationForPlatform(autolinkingOptions.platform);
  const extraOutput = { flags: autolinkingOptions.flags };
  const moduleDescriptorList = await taskAll(Object.entries(searchResults), async ([packageName, revision]) => {
    const resolvedModule = await platformLinking.resolveModuleAsync(packageName, revision, extraOutput);
    return resolvedModule ? {
      ...resolvedModule,
      packageVersion: revision.version,
      packageName: resolvedModule.packageName ?? packageName
    } : null;
  });
  return moduleDescriptorList.filter((moduleDescriptor) => moduleDescriptor != null).sort((a, b) => a.packageName.localeCompare(b.packageName));
}
async function resolveExtraBuildDependenciesAsync6({
  commandRoot,
  platform
}) {
  const platformLinking = getLinkingImplementationForPlatform(platform);
  const extraDependencies = await platformLinking.resolveExtraBuildDependenciesAsync(commandRoot);
  return extraDependencies ?? [];
}

// src/commands/autolinkWindowsCommand.ts
init_generators();
init_slnUtils();
function autolinkWindowsCommand(cli) {
  return registerAutolinkingArguments(cli.command("autolink-windows [searchPaths...]")).option("--sln <path>", "Path to the .sln file").option("--app-proj <path>", "Path to the app .vcxproj file").option("--expo-core-project <path>", "Path to Expo.Modules.Core.csproj (auto-detected if not specified)").action(async (searchPaths, commandArguments) => {
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
      ...commandArguments,
      searchPaths,
      platform: "windows"
    });
    const appRoot = await autolinkingOptionsLoader.getAppRoot();
    const slnPath = import_path17.default.resolve(appRoot, commandArguments.sln);
    const vcxprojPath = import_path17.default.resolve(appRoot, commandArguments.appProj);
    const slnDir = import_path17.default.dirname(slnPath);
    const vcxprojDir = import_path17.default.dirname(vcxprojPath);
    const autolinkingOptions = await autolinkingOptionsLoader.getPlatformOptions("windows");
    const searchResults = await findModulesAsync({
      autolinkingOptions,
      appRoot
    });
    const resolvedModules = await resolveModulesAsync(searchResults, autolinkingOptions);
    console.log(`Found ${resolvedModules.length} Expo module(s) for Windows`);
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
      const csprojPath = import_path17.default.resolve(packagePath, mod.projectPath);
      const assemblyName = await readAssemblyName(csprojPath);
      moduleProjects.push({ csprojPath, assemblyName });
      console.log(`  ${mod.packageName} → ${assemblyName}`);
    }
    const coreCsprojPath = resolveCoreCsprojPath(commandArguments.expoCoreProject, appRoot);
    if (!coreCsprojPath) {
      throw new Error("Could not find Expo.Modules.Core.csproj. Use --expo-core-project to specify its path.");
    }
    const coreAssemblyName = await readAssemblyName(coreCsprojPath);
    const coreProject = {
      csprojPath: coreCsprojPath,
      assemblyName: coreAssemblyName
    };
    const autolinkedDir = import_path17.default.join(vcxprojDir, "ExpoModulesAutolinked");
    await import_fs11.default.promises.mkdir(autolinkedDir, { recursive: true });
    const autolinkedCsprojPath = import_path17.default.join(autolinkedDir, "ExpoModulesAutolinked.csproj");
    const autolinkedProject = {
      csprojPath: autolinkedCsprojPath,
      assemblyName: "ExpoModulesAutolinked"
    };
    const csprojContent = generateAutolinkedCsproj(coreProject, moduleProjects, autolinkedDir);
    await writeIfChanged(autolinkedCsprojPath, csprojContent);
    const providerContent = generateProvider(resolvedModules);
    const providerPath = import_path17.default.join(autolinkedDir, "ExpoModulesProvider.g.cs");
    await writeIfChanged(providerPath, providerContent);
    const netHostPropsRelPath = findNetHostPropsRelPath(vcxprojDir, appRoot);
    const targetsContent = generateDeployTargets(coreProject, autolinkedProject, moduleProjects, netHostPropsRelPath, vcxprojDir);
    const targetsPath = import_path17.default.join(vcxprojDir, "ExpoModulesAutolinked.g.targets");
    await writeIfChanged(targetsPath, targetsContent);
    const vcxprojContent = await import_fs11.default.promises.readFile(vcxprojPath, "utf8");
    const staleRefs = findStaleProjectReferences(vcxprojContent, moduleProjects);
    const staleImports = findStaleImports(vcxprojContent);
    const autolinkedCsprojRelPath = import_path17.default.relative(vcxprojDir, autolinkedCsprojPath).replace(/\//g, "\\");
    const autolinkedTargetsRelPath = import_path17.default.relative(vcxprojDir, targetsPath).replace(/\//g, "\\");
    const updatedVcxproj = updateVcxproj(vcxprojContent, autolinkedCsprojRelPath, autolinkedTargetsRelPath, staleRefs, staleImports);
    await writeIfChanged(vcxprojPath, updatedVcxproj);
    const slnContent = await import_fs11.default.promises.readFile(slnPath, "utf8");
    const slnProjects = [
      createSlnProject(coreProject.assemblyName, coreProject.csprojPath, slnDir),
      createSlnProject(autolinkedProject.assemblyName, autolinkedProject.csprojPath, slnDir),
      ...moduleProjects.map((m) => {
        const name = import_path17.default.basename(m.csprojPath, ".csproj");
        return createSlnProject(name, m.csprojPath, slnDir);
      })
    ];
    const updatedSln = updateSolution(slnContent, slnProjects);
    await writeIfChanged(slnPath, updatedSln);
    console.log(`
Autolink complete:`);
    console.log(`  Generated: ${autolinkedCsprojPath}`);
    console.log(`  Generated: ${providerPath}`);
    console.log(`  Generated: ${targetsPath}`);
    console.log(`  Updated:   ${vcxprojPath}`);
    console.log(`  Updated:   ${slnPath}`);
  });
}
function getPackagePath(searchResults, packageName) {
  const revision = searchResults[packageName];
  return revision?.path ?? null;
}
function resolveCoreCsprojPath(explicitPath, appRoot) {
  if (explicitPath) {
    const resolved = import_path17.default.resolve(appRoot, explicitPath);
    if (import_fs11.default.existsSync(resolved))
      return resolved;
    return null;
  }
  const candidates = [
    import_path17.default.join(appRoot, "dotnet", "Expo.Modules.Core", "Expo.Modules.Core.csproj"),
    import_path17.default.join(appRoot, "..", "dotnet", "Expo.Modules.Core", "Expo.Modules.Core.csproj"),
    import_path17.default.join(appRoot, "node_modules", "expo-modules-windows-core", "dotnet", "Expo.Modules.Core", "Expo.Modules.Core.csproj")
  ];
  for (const candidate of candidates) {
    if (import_fs11.default.existsSync(candidate))
      return candidate;
  }
  return null;
}
function findNetHostPropsRelPath(vcxprojDir, appRoot) {
  const candidates = [
    import_path17.default.join(appRoot, "windows", "ExpoModulesWindowsCore", "NetHost.props"),
    import_path17.default.join(appRoot, "..", "windows", "ExpoModulesWindowsCore", "NetHost.props"),
    import_path17.default.join(appRoot, "node_modules", "expo-modules-windows-core", "windows", "ExpoModulesWindowsCore", "NetHost.props")
  ];
  for (const candidate of candidates) {
    if (import_fs11.default.existsSync(candidate)) {
      return import_path17.default.relative(vcxprojDir, candidate).replace(/\//g, "\\");
    }
  }
  return import_path17.default.relative(vcxprojDir, import_path17.default.join(appRoot, "node_modules", "expo-modules-windows-core", "windows", "ExpoModulesWindowsCore", "NetHost.props")).replace(/\//g, "\\");
}
function findStaleProjectReferences(vcxprojContent, _moduleProjects) {
  const stale = [];
  const regex = /<ProjectReference\s+Include="([^"]+\.csproj)"/gi;
  let match;
  while ((match = regex.exec(vcxprojContent)) !== null) {
    const refPath = match[1];
    if (!refPath.includes("ExpoModulesAutolinked")) {
      stale.push(refPath);
    }
  }
  return stale;
}
function findStaleImports(vcxprojContent) {
  const stale = [];
  const regex = /<Import\s+Project="([^"]+)"/gi;
  let match;
  while ((match = regex.exec(vcxprojContent)) !== null) {
    const importPath = match[1];
    if (importPath.includes("ExpoExampleDeploy") || importPath.includes("ExpoManagedDeploy")) {
      stale.push(importPath);
    }
  }
  return stale;
}
async function writeIfChanged(filePath, content) {
  try {
    const existing = await import_fs11.default.promises.readFile(filePath, "utf8");
    if (existing === content)
      return;
  } catch {}
  await import_fs11.default.promises.mkdir(import_path17.default.dirname(filePath), { recursive: true });
  await import_fs11.default.promises.writeFile(filePath, content, "utf8");
}

// src/autolinking/generatePackageList.ts
async function generateModulesProviderAsync3(modules, params) {
  const platformLinking = getLinkingImplementationForPlatform(params.platform);
  if (!("generateModulesProviderAsync" in platformLinking)) {
    throw new Error(`Generating modules provider is not available for platform "${params.platform}"`);
  }
  await platformLinking.generateModulesProviderAsync(modules, params.targetPath, params.entitlementPath);
}

// src/commands/generateModulesProviderCommand.ts
function generateModulesProviderCommand(cli) {
  return registerAutolinkingArguments(cli.command("generate-modules-provider [searchPaths...]")).option("-t, --target <path>", "Path to the target file, where the package list should be written to.").option("--entitlement <path>", "Path to the Apple code signing entitlements file.").option("-p, --packages <packages...>", "Names of the packages to include in the generated modules provider.").option("--app-root <path>", "Path to the app root directory.").action(async (searchPaths, commandArguments) => {
    const platform = commandArguments.platform ?? "apple";
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
      ...commandArguments,
      searchPaths
    });
    const autolinkingOptions = await autolinkingOptionsLoader.getPlatformOptions(platform);
    const expoModulesSearchResults = await findModulesAsync({
      autolinkingOptions: await autolinkingOptionsLoader.getPlatformOptions(platform),
      appRoot: commandArguments.appRoot ?? await autolinkingOptionsLoader.getAppRoot()
    });
    const expoModulesResolveResults = await resolveModulesAsync(expoModulesSearchResults, autolinkingOptions);
    const includeModules = new Set(commandArguments.packages ?? []);
    const filteredModules = expoModulesResolveResults.filter((module2) => includeModules.has(module2.packageName));
    await generateModulesProviderAsync3(filteredModules, {
      platform,
      targetPath: commandArguments.target,
      entitlementPath: commandArguments.entitlement ?? null
    });
  });
}

// src/commands/reactNativeConfigCommand.ts
function reactNativeConfigCommand(cli) {
  return registerAutolinkingArguments(cli.command("react-native-config [searchPaths...]")).option("-p, --platform [platform]", 'The platform that the resulting modules must support. Available options: "android", "ios"', "ios").option("--source-dir <sourceDir>", "The path to the native source directory").option("-j, --json", "Output results in the plain JSON format.", () => true, false).action(async (searchPaths, commandArguments) => {
    const platform = commandArguments.platform ?? "ios";
    if (platform !== "android" && platform !== "ios") {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
      ...commandArguments,
      searchPaths
    });
    const reactNativeConfig3 = await createReactNativeConfigAsync({
      autolinkingOptions: await autolinkingOptionsLoader.getPlatformOptions(platform),
      appRoot: await autolinkingOptionsLoader.getAppRoot(),
      sourceDir: commandArguments.sourceDir ?? undefined
    });
    if (commandArguments.json) {
      console.log(JSON.stringify(reactNativeConfig3));
    } else {
      console.log(require("util").inspect(reactNativeConfig3, false, null, true));
    }
  });
}

// src/autolinking/getConfiguration.ts
function getConfiguration2({
  autolinkingOptions
}) {
  const platformLinking = getLinkingImplementationForPlatform(autolinkingOptions.platform);
  if ("getConfiguration" in platformLinking) {
    return platformLinking.getConfiguration(autolinkingOptions);
  } else {
    return;
  }
}

// src/commands/resolveCommand.ts
function hasCoreFeatures(module2) {
  return module2.coreFeatures !== undefined;
}
function resolveCommand(cli) {
  return registerAutolinkingArguments(cli.command("resolve [searchPaths...]")).option("-j, --json", "Output results in the plain JSON format.", () => true, false).action(async (searchPaths, commandArguments) => {
    const platform = commandArguments.platform ?? "apple";
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
      ...commandArguments,
      searchPaths
    });
    const autolinkingOptions = await autolinkingOptionsLoader.getPlatformOptions(platform);
    const appRoot = await autolinkingOptionsLoader.getAppRoot();
    const expoModulesSearchResults = await findModulesAsync({
      autolinkingOptions,
      appRoot
    });
    const expoModulesResolveResults = await resolveModulesAsync(expoModulesSearchResults, autolinkingOptions);
    const extraDependencies = await resolveExtraBuildDependenciesAsync6({
      commandRoot: autolinkingOptionsLoader.getCommandRoot(),
      platform
    });
    const configuration = getConfiguration2({ autolinkingOptions });
    const coreFeatures = [
      ...expoModulesResolveResults.reduce((acc, module2) => {
        if (hasCoreFeatures(module2)) {
          const features = module2.coreFeatures ?? [];
          for (const feature of features) {
            acc.add(feature);
          }
          return acc;
        }
        return acc;
      }, new Set)
    ];
    if (commandArguments.json) {
      console.log(JSON.stringify({
        extraDependencies,
        coreFeatures,
        modules: expoModulesResolveResults,
        ...configuration ? { configuration } : {}
      }));
    } else {
      console.log(require("util").inspect({
        extraDependencies,
        coreFeatures,
        modules: expoModulesResolveResults,
        ...configuration ? { configuration } : {}
      }, false, null, true));
    }
  });
}

// src/commands/searchCommand.ts
function searchCommand(cli) {
  return registerAutolinkingArguments(cli.command("search [searchPaths...]")).option("-j, --json", "Output results in the plain JSON format.", () => true, false).action(async (searchPaths, commandArguments) => {
    const platform = commandArguments.platform ?? "apple";
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader({
      ...commandArguments,
      searchPaths
    });
    const expoModulesSearchResults = await findModulesAsync({
      autolinkingOptions: await autolinkingOptionsLoader.getPlatformOptions(platform),
      appRoot: await autolinkingOptionsLoader.getAppRoot()
    });
    if (commandArguments.json) {
      console.log(JSON.stringify(expoModulesSearchResults));
    } else {
      console.log(require("util").inspect(expoModulesSearchResults, false, null, true));
    }
  });
}

// src/commands/verifyCommand.ts
var import_chalk = __toESM(require("chalk"));
var import_fs12 = __toESM(require("fs"));
var import_path18 = __toESM(require("path"));
var INCLUDE_PACKAGES = ["react-native", "react-native-tvos"];
function verifyCommand(cli) {
  return registerAutolinkingArguments(cli.command("verify")).option("-v, --verbose", "Output all results instead of just warnings.", () => true, false).option("-j, --json", "Output results in the plain JSON format.", () => true, false).option("-p, --platform [platform]", 'The platform to validate native modules for. Available options: "android", "ios", "both"', "both").action(async (commandArguments) => {
    const platforms = commandArguments.platform === "both" ? ["android", "ios"] : [commandArguments.platform];
    const autolinkingOptionsLoader = createAutolinkingOptionsLoader(commandArguments);
    const appRoot = await autolinkingOptionsLoader.getAppRoot();
    const linker = makeCachedDependenciesLinker({ projectRoot: appRoot });
    const results = mergeResolutionResults(await Promise.all(platforms.map((platform) => scanDependencyResolutionsForPlatform(linker, platform, INCLUDE_PACKAGES))));
    await verifySearchResults(results, {
      appRoot,
      verbose: !!commandArguments.verbose,
      json: !!commandArguments.json
    });
  });
}
async function verifySearchResults(results, options) {
  const { appRoot } = options;
  async function getHumanReadableDependency(dependency) {
    let version = dependency.version || null;
    if (!version) {
      try {
        const pkgContents = await import_fs12.default.promises.readFile(import_path18.default.join(dependency.path, "package.json"), "utf8");
        const pkg = JSON.parse(pkgContents);
        if (pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string") {
          version = pkg.version;
        }
      } catch (error) {
        version = null;
      }
    }
    const relative = import_path18.default.relative(appRoot, dependency.originPath);
    return version ? `${dependency.name}@${version} (at: ${relative})` : `${dependency.name} at: ${relative}`;
  }
  const groups = {
    reactNativeProjectConfig: [],
    searchPaths: [],
    dependencies: [],
    duplicates: []
  };
  for (const moduleName in results) {
    const revision = results[moduleName];
    if (!revision) {
      continue;
    } else if (revision.duplicates?.length) {
      groups.duplicates.push(revision);
    } else {
      switch (revision.source) {
        case 2 /* RN_CLI_LOCAL */:
          groups.reactNativeProjectConfig.push(revision);
          break;
        case 1 /* SEARCH_PATH */:
          groups.searchPaths.push(revision);
          break;
        case 0 /* RECURSIVE_RESOLUTION */:
          groups.dependencies.push(revision);
          break;
      }
    }
  }
  if (options.json) {
    console.log(JSON.stringify(groups));
    return;
  }
  if (options.verbose) {
    const sortResolutions = (resolutions) => [...resolutions].sort((a, b) => a.name.localeCompare(b.name));
    if (groups.reactNativeProjectConfig.length) {
      console.log(`\uD83D\uDD0E  Found ${groups.reactNativeProjectConfig.length} modules from React Native project config`);
      for (const revision of sortResolutions(groups.reactNativeProjectConfig)) {
        console.log(` - ${await getHumanReadableDependency(revision)}`);
      }
    }
    if (groups.searchPaths.length) {
      console.log(`\uD83D\uDD0E  Found ${groups.searchPaths.length} modules in search paths`);
      for (const revision of sortResolutions(groups.searchPaths)) {
        console.log(` - ${await getHumanReadableDependency(revision)}`);
      }
    }
    console.log(`\uD83D\uDD0E  Found ${groups.dependencies.length} modules in dependencies`);
    for (const revision of sortResolutions(groups.dependencies)) {
      console.log(` - ${await getHumanReadableDependency(revision)}`);
    }
  }
  if (groups.duplicates.length) {
    for (const revision of groups.duplicates) {
      console.warn(`⚠️  Found duplicate installations for ${import_chalk.default.green(revision.name)}`);
      const revisions = [revision, ...revision.duplicates ?? []];
      for (let idx = 0;idx < revisions.length; idx++) {
        const prefix = idx !== revisions.length - 1 ? "├─" : "└─";
        const duplicate = revisions[idx];
        console.log(`  ${prefix} ${await getHumanReadableDependency(duplicate)}`);
      }
    }
    console.warn(`⚠️  Multiple versions of the same module may introduce some side effects or compatibility issues.
` + `Resolve your dependency issues and deduplicate your dependencies. Learn more: https://expo.fyi/resolving-dependency-issues`);
  } else {
    console.log("✅ Everything is fine!");
  }
}

// src/index.ts
async function main(args) {
  const cli = import_commander.default.version(require_package().version).description("CLI command that searches for native modules to autolink them.");
  verifyCommand(cli);
  searchCommand(cli);
  resolveCommand(cli);
  generateModulesProviderCommand(cli);
  reactNativeConfigCommand(cli);
  autolinkWindowsCommand(cli);
  await createMemoizer().withMemoizer(async () => {
    await cli.parseAsync(args, { from: "user" });
  });
}
module.exports = main;
