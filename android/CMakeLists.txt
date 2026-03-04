cmake_minimum_required(VERSION 3.4.1)
project(ExpoModulesWindowsCore)

set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 14)

add_library(expo-modules-windows-core            SHARED
            ../cpp/expo-modules-windows-core.cpp
            cpp-adapter.cpp
)

# Specifies a path to native header files.
include_directories(
            ../cpp
)
