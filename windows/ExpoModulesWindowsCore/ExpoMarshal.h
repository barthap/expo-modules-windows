// ExpoMarshal.h — JSON ↔ JSI value conversion utilities.
// Handles serialization of JSI args to JSON for C# calls,
// and error message extraction from C# error JSON.

#pragma once

#include <string>
#include <jsi/jsi.h>

namespace expo {

// Serialize JSI function arguments to a JSON array string: "[arg1,arg2,...]"
std::string jsiArgsToJson(facebook::jsi::Runtime& rt,
                          const facebook::jsi::Value* args,
                          size_t count);

// Serialize a single JSI value to a JSON string.
std::string jsiValueToJson(facebook::jsi::Runtime& rt,
                           const facebook::jsi::Value& value);

// Extract error message from C# error JSON: {"error":"CODE","message":"..."}
// Returns "CODE: message" or the raw JSON if parsing fails.
std::string extractErrorMessage(const uint8_t* json, int len);

} // namespace expo
