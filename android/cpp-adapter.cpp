#include <jni.h>
#include "expo-modules-windows-core.h"

extern "C"
JNIEXPORT jdouble JNICALL
Java_com_expomoduleswindowscore_ExpoModulesWindowsCoreModule_nativeMultiply(JNIEnv *env, jclass type, jdouble a, jdouble b) {
    return expomoduleswindowscore::multiply(a, b);
}
