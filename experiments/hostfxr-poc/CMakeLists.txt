cmake_minimum_required(VERSION 3.20)
project(hostfxr_poc LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --------------------------------------------------------------------------
# Locate the .NET SDK nethost headers and library.
# The nethost package ships inside the .NET SDK at:
#   <sdk-root>/packs/Microsoft.NETCore.App.Host.win-x64/<version>/runtimes/win-x64/native/
# We search common locations automatically.
# --------------------------------------------------------------------------

# Allow the user to override via -DNETHOST_DIR=...
if(NOT NETHOST_DIR)
    # Try to find via dotnet --list-runtimes or well-known paths
    file(GLOB _nethost_candidates
        "C:/Program Files/dotnet/packs/Microsoft.NETCore.App.Host.win-x64/*/runtimes/win-x64/native"
    )
    if(_nethost_candidates)
        # Pick the last (highest version)
        list(SORT _nethost_candidates)
        list(GET _nethost_candidates -1 NETHOST_DIR)
    endif()
endif()

if(NOT NETHOST_DIR)
    message(FATAL_ERROR
        "Could not find nethost directory. Set -DNETHOST_DIR=<path> to the directory "
        "containing nethost.h, hostfxr.h, coreclr_delegates.h, and nethost.lib.\n"
        "Typical location: C:/Program Files/dotnet/packs/Microsoft.NETCore.App.Host.win-x64/<ver>/runtimes/win-x64/native/")
endif()

message(STATUS "Using nethost from: ${NETHOST_DIR}")

add_executable(hostfxr_poc main.cpp)

target_include_directories(hostfxr_poc PRIVATE "${NETHOST_DIR}")
target_link_directories(hostfxr_poc PRIVATE "${NETHOST_DIR}")
target_link_libraries(hostfxr_poc PRIVATE nethost)

# Copy nethost.dll next to the executable so it can be loaded at runtime
add_custom_command(TARGET hostfxr_poc POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NETHOST_DIR}/nethost.dll"
        "$<TARGET_FILE_DIR:hostfxr_poc>/nethost.dll"
    COMMENT "Copying nethost.dll to output directory"
)
