import ExpoModulesWindowsCore from './NativeExpoModulesWindowsCore';
import * as NativeComponentRegistry from 'react-native-windows/Libraries/NativeComponent/NativeComponentRegistry';

export function multiply(a: number, b: number): number {
  return ExpoModulesWindowsCore.multiply(a, b);
}

export function install(): boolean {
  return ExpoModulesWindowsCore.install();
}

export function requireNativeViewManager<Props extends object>(
  name: string,
  propNames: readonly string[] = []
) {
  const validAttributes: Record<string, true> = {};
  for (const propName of propNames) {
    validAttributes[propName] = true;
  }

  return NativeComponentRegistry.get<Props>(name, () => ({
    uiViewClassName: name,
    validAttributes,
  }));
}
