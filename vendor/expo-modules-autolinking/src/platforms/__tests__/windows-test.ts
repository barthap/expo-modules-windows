import { vol } from 'memfs';

import { ExpoModuleConfig } from '../../ExpoModuleConfig';
import {
  generateModulesProviderContent,
  resolveModuleAsync,
} from '../windows/windows';

afterEach(() => {
  vol.reset();
  jest.resetAllMocks();
});

describe(resolveModuleAsync, () => {
  it('should resolve module with explicit modules config', async () => {
    const result = await resolveModuleAsync('expo-battery', {
      name: 'expo-battery',
      path: '/packages/expo-battery',
      version: '1.0.0',
      config: new ExpoModuleConfig({
        platforms: ['windows'],
        windows: {
          modules: ['ExpoBattery.BatteryModule'],
        },
      }),
    });

    expect(result).toEqual({
      packageName: 'expo-battery',
      modules: [{ name: null, class: 'ExpoBattery.BatteryModule' }],
      projectPath: null,
      debugOnly: false,
    });
  });

  it('should resolve module with object entries', async () => {
    const result = await resolveModuleAsync('expo-camera', {
      name: 'expo-camera',
      path: '/packages/expo-camera',
      version: '2.0.0',
      config: new ExpoModuleConfig({
        platforms: ['windows'],
        windows: {
          modules: [
            { name: 'Camera', class: 'ExpoCamera.CameraModule' },
          ],
          projectPath: 'windows/ExpoCamera',
        },
      }),
    });

    expect(result).toEqual({
      packageName: 'expo-camera',
      modules: [{ name: 'Camera', class: 'ExpoCamera.CameraModule' }],
      projectPath: 'windows/ExpoCamera',
      debugOnly: false,
    });
  });

  it('should return null when no windows config', async () => {
    const result = await resolveModuleAsync('expo-no-windows', {
      name: 'expo-no-windows',
      path: '/packages/expo-no-windows',
      version: '1.0.0',
      config: new ExpoModuleConfig({
        platforms: ['ios', 'android'],
      }),
    });

    expect(result).toBeNull();
  });

  it('should return null when no config at all', async () => {
    const result = await resolveModuleAsync('no-config', {
      name: 'no-config',
      path: '/packages/no-config',
      version: '1.0.0',
    });

    expect(result).toBeNull();
  });

  it('should auto-scan for C# modules when none are explicitly listed', async () => {
    vol.fromJSON(
      {
        'windows/BatteryModule.cs': `
namespace ExpoBattery
{
    public class BatteryModule : Module
    {
    }
}`,
      },
      '/packages/expo-battery'
    );

    const result = await resolveModuleAsync('expo-battery', {
      name: 'expo-battery',
      path: '/packages/expo-battery',
      version: '1.0.0',
      config: new ExpoModuleConfig({
        platforms: ['windows'],
        windows: {},
      }),
    });

    expect(result).toEqual({
      packageName: 'expo-battery',
      modules: [{ name: null, class: 'ExpoBattery.BatteryModule' }],
      projectPath: null,
      debugOnly: false,
    });
  });

  it('should return null when auto-scan finds no modules', async () => {
    vol.fromJSON(
      {
        'windows/Helper.cs': `
namespace ExpoBattery
{
    public class Helper
    {
    }
}`,
      },
      '/packages/expo-battery'
    );

    const result = await resolveModuleAsync('expo-battery', {
      name: 'expo-battery',
      path: '/packages/expo-battery',
      version: '1.0.0',
      config: new ExpoModuleConfig({
        platforms: ['windows'],
        windows: {},
      }),
    });

    expect(result).toBeNull();
  });

  it('should include debugOnly flag', async () => {
    const result = await resolveModuleAsync('expo-dev-menu', {
      name: 'expo-dev-menu',
      path: '/packages/expo-dev-menu',
      version: '1.0.0',
      config: new ExpoModuleConfig({
        platforms: ['windows'],
        windows: {
          modules: ['ExpoDevMenu.DevMenuModule'],
          debugOnly: true,
        },
      }),
    });

    expect(result).toEqual({
      packageName: 'expo-dev-menu',
      modules: [{ name: null, class: 'ExpoDevMenu.DevMenuModule' }],
      projectPath: null,
      debugOnly: true,
    });
  });
});

describe(generateModulesProviderContent, () => {
  it('should generate correct C# with regular modules', () => {
    const content = generateModulesProviderContent([
      {
        packageName: 'expo-battery',
        modules: [{ name: null, class: 'ExpoBattery.BatteryModule' }],
        projectPath: null,
        debugOnly: false,
      },
      {
        packageName: 'expo-camera',
        modules: [{ name: 'Camera', class: 'ExpoCamera.CameraModule' }],
        projectPath: null,
        debugOnly: false,
      },
    ]);

    expect(content).toContain('typeof(ExpoBattery.BatteryModule)');
    expect(content).toContain('typeof(ExpoCamera.CameraModule)');
    expect(content).toContain('namespace Expo.Modules.Autolinking');
    expect(content).toContain('public static class ExpoModulesProvider');
    expect(content).toContain('public static IReadOnlyList<Type> GetModuleClasses()');
    expect(content).not.toContain('#if DEBUG');
  });

  it('should generate #if DEBUG block for debug-only modules', () => {
    const content = generateModulesProviderContent([
      {
        packageName: 'expo-battery',
        modules: [{ name: null, class: 'ExpoBattery.BatteryModule' }],
        projectPath: null,
        debugOnly: false,
      },
      {
        packageName: 'expo-dev-menu',
        modules: [{ name: null, class: 'ExpoDevMenu.DevMenuModule' }],
        projectPath: null,
        debugOnly: true,
      },
    ]);

    expect(content).toContain('typeof(ExpoBattery.BatteryModule)');
    expect(content).toContain('#if DEBUG');
    expect(content).toContain('typeof(ExpoDevMenu.DevMenuModule)');
    expect(content).toContain('#endif');

    // The debug module should be inside the #if DEBUG block
    const debugStart = content.indexOf('#if DEBUG');
    const debugEnd = content.indexOf('#endif');
    const devMenuIndex = content.indexOf('typeof(ExpoDevMenu.DevMenuModule)');
    expect(devMenuIndex).toBeGreaterThan(debugStart);
    expect(devMenuIndex).toBeLessThan(debugEnd);

    // Regular module should be before #if DEBUG
    const batteryIndex = content.indexOf('typeof(ExpoBattery.BatteryModule)');
    expect(batteryIndex).toBeLessThan(debugStart);
  });

  it('should generate empty array when no modules', () => {
    const content = generateModulesProviderContent([]);

    expect(content).toContain('return new Type[]');
    expect(content).not.toContain('typeof(');
    expect(content).not.toContain('#if DEBUG');
  });
});

describe('ExpoModuleConfig windows accessors', () => {
  it('should parse string modules', () => {
    const config = new ExpoModuleConfig({
      platforms: ['windows'],
      windows: {
        modules: ['ExpoBattery.BatteryModule', 'ExpoCamera.CameraModule'],
      },
    });

    expect(config.windowsModules()).toEqual([
      { name: null, class: 'ExpoBattery.BatteryModule' },
      { name: null, class: 'ExpoCamera.CameraModule' },
    ]);
  });

  it('should parse object modules', () => {
    const config = new ExpoModuleConfig({
      platforms: ['windows'],
      windows: {
        modules: [{ name: 'Battery', class: 'ExpoBattery.BatteryModule' }],
      },
    });

    expect(config.windowsModules()).toEqual([
      { name: 'Battery', class: 'ExpoBattery.BatteryModule' },
    ]);
  });

  it('should return empty array when no windows config', () => {
    const config = new ExpoModuleConfig({ platforms: ['ios'] });
    expect(config.windowsModules()).toEqual([]);
    expect(config.windowsProjectPath()).toBeNull();
    expect(config.windowsDebugOnly()).toBe(false);
  });

  it('supportsPlatform should match windows', () => {
    const config = new ExpoModuleConfig({ platforms: ['windows'] });
    expect(config.supportsPlatform('windows')).toBe(true);
    expect(config.supportsPlatform('ios')).toBe(false);
  });

  it('supportsPlatform should not match windows when not listed', () => {
    const config = new ExpoModuleConfig({ platforms: ['ios', 'android'] });
    expect(config.supportsPlatform('windows')).toBe(false);
  });
});
