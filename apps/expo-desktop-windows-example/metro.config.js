const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');
const escapeStringRegexp = require('escape-string-regexp');

const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, '../..');
const packageRoot = path.join(repoRoot, 'packages/expo-modules-windows-core');
const packageJson = require(path.join(packageRoot, 'package.json'));
const sharedModules = Object.keys(packageJson.peerDependencies ?? {});
const rootNodeModules = path.join(repoRoot, 'node_modules');

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
);

const config = {
  watchFolders: [repoRoot, packageRoot],
  resolver: {
    blockList: sharedModules.map(
      (name) =>
        new RegExp(
          `^${escapeStringRegexp(path.join(packageRoot, 'node_modules', name))}(?:[/\\\\].*)?$`,
        ),
    ).concat([
      new RegExp(`${path.resolve(appRoot, 'windows').replace(/[/\\]/g, '/')}.*`),
      new RegExp(`${rnwPath}/build/.*`),
      new RegExp(`${rnwPath}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ]),
    extraNodeModules: sharedModules.reduce(
      (acc, name) => {
        acc[name] = path.join(rootNodeModules, name);
        return acc;
      },
      {
        'expo-modules-windows-core': packageRoot,
      },
    ),
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
