declare module 'react-native-windows/Libraries/NativeComponent/NativeComponentRegistry' {
  import type { HostComponent } from 'react-native';

  type PartialViewConfig = {
    uiViewClassName: string;
    validAttributes?: Record<string, true | object>;
    bubblingEventTypes?: Record<string, object>;
    directEventTypes?: Record<string, object>;
  };

  export function get<Props extends object>(
    name: string,
    viewConfigProvider: () => PartialViewConfig
  ): HostComponent<Props>;
}
