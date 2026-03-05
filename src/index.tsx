import ExpoModulesWindowsCore from './NativeExpoModulesWindowsCore';

export function multiply(a: number, b: number): number {
  return ExpoModulesWindowsCore.multiply(a, b);
}

export function install(): boolean {
  return ExpoModulesWindowsCore.install();
}
