#import "ExpoModulesWindowsCore.h"

@implementation ExpoModulesWindowsCore
RCT_EXPORT_MODULE()

- (NSNumber *)multiply:(double)a b:(double)b {
    NSNumber *result = @(expomoduleswindowscore::multiply(a, b));

    return result;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeExpoModulesWindowsCoreSpecJSI>(params);
}

@end
