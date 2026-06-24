/**
 * @type {import('@react-native-community/cli-types').UserDependencyConfig}
 */
module.exports = {
  dependency: {
    platforms: {
      windows: {
        sourceDir: 'windows',
        solutionFile: 'ExpoModulesWindowsCore.sln',
        projects: [
          {
            projectFile: 'ExpoModulesWindowsCore\\ExpoModulesWindowsCore.vcxproj',
            directDependency: true,
          },
        ],
      },
    },
  },
};
