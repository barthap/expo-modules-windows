// ExpoMarshal.cpp — JSON ↔ JSI value conversion.

#include "pch.h"
#include "ExpoMarshal.h"

namespace expo {

// ---- JSON string escaping ----

static void appendEscapedString(std::string& out, const std::string& s) {
    out.push_back('"');
    for (char c : s) {
        switch (c) {
        case '"':  out.append("\\\""); break;
        case '\\': out.append("\\\\"); break;
        case '\b': out.append("\\b"); break;
        case '\f': out.append("\\f"); break;
        case '\n': out.append("\\n"); break;
        case '\r': out.append("\\r"); break;
        case '\t': out.append("\\t"); break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buf[8];
                snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                out.append(buf);
            } else {
                out.push_back(c);
            }
            break;
        }
    }
    out.push_back('"');
}

// ---- JSI → JSON serialization ----

std::string jsiValueToJson(facebook::jsi::Runtime& rt,
                           const facebook::jsi::Value& value) {
    using namespace facebook::jsi;

    if (value.isNull() || value.isUndefined()) {
        return "null";
    }
    if (value.isBool()) {
        return value.getBool() ? "true" : "false";
    }
    if (value.isNumber()) {
        double d = value.getNumber();
        // Integer check: emit without decimal point if it's a whole number
        if (d == static_cast<double>(static_cast<int64_t>(d)) &&
            d >= -9007199254740992.0 && d <= 9007199254740992.0) {
            return std::to_string(static_cast<int64_t>(d));
        }
        char buf[64];
        snprintf(buf, sizeof(buf), "%.17g", d);
        return buf;
    }
    if (value.isString()) {
        std::string result;
        std::string s = value.getString(rt).utf8(rt);
        appendEscapedString(result, s);
        return result;
    }
    if (value.isObject()) {
        Object obj = value.getObject(rt);

        // Array
        if (obj.isArray(rt)) {
            Array arr = obj.getArray(rt);
            size_t len = arr.size(rt);
            std::string result = "[";
            for (size_t i = 0; i < len; i++) {
                if (i > 0) result.push_back(',');
                result.append(jsiValueToJson(rt, arr.getValueAtIndex(rt, i)));
            }
            result.push_back(']');
            return result;
        }

        // Plain object
        Array names = obj.getPropertyNames(rt);
        size_t len = names.size(rt);
        std::string result = "{";
        bool first = true;
        for (size_t i = 0; i < len; i++) {
            String name = names.getValueAtIndex(rt, i).getString(rt);
            Value val = obj.getProperty(rt, name);
            // Skip undefined properties
            if (val.isUndefined()) continue;
            if (!first) result.push_back(',');
            first = false;
            appendEscapedString(result, name.utf8(rt));
            result.push_back(':');
            result.append(jsiValueToJson(rt, val));
        }
        result.push_back('}');
        return result;
    }

    // Symbol, BigInt, etc. — fall back to null
    return "null";
}

std::string jsiArgsToJson(facebook::jsi::Runtime& rt,
                          const facebook::jsi::Value* args,
                          size_t count) {
    std::string result = "[";
    for (size_t i = 0; i < count; i++) {
        if (i > 0) result.push_back(',');
        result.append(jsiValueToJson(rt, args[i]));
    }
    result.push_back(']');
    return result;
}

// ---- Error message extraction ----

// Minimal JSON parser for {"error":"...","message":"..."} pattern.
// Avoids a full JSON library dependency.
static std::string extractJsonStringValue(const std::string& json,
                                          const std::string& key) {
    // Look for "key":"value"
    std::string needle = "\"" + key + "\"";
    auto pos = json.find(needle);
    if (pos == std::string::npos) return "";

    // Skip past the key and find the colon
    pos += needle.size();
    pos = json.find(':', pos);
    if (pos == std::string::npos) return "";
    pos++; // skip ':'

    // Skip whitespace
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t'))
        pos++;

    if (pos >= json.size() || json[pos] != '"') return "";
    pos++; // skip opening quote

    std::string result;
    while (pos < json.size() && json[pos] != '"') {
        if (json[pos] == '\\' && pos + 1 < json.size()) {
            pos++;
            switch (json[pos]) {
            case '"':  result.push_back('"'); break;
            case '\\': result.push_back('\\'); break;
            case 'n':  result.push_back('\n'); break;
            case 'r':  result.push_back('\r'); break;
            case 't':  result.push_back('\t'); break;
            default:   result.push_back(json[pos]); break;
            }
        } else {
            result.push_back(json[pos]);
        }
        pos++;
    }
    return result;
}

std::string extractErrorMessage(const uint8_t* json, int len) {
    std::string jsonStr(reinterpret_cast<const char*>(json), static_cast<size_t>(len));
    std::string code = extractJsonStringValue(jsonStr, "error");
    std::string message = extractJsonStringValue(jsonStr, "message");

    if (!code.empty() && !message.empty()) {
        return code + ": " + message;
    }
    if (!message.empty()) {
        return message;
    }
    // Fallback: return raw JSON
    return jsonStr;
}

} // namespace expo
