#include "pch.h"
#include "ExpoViewManager.h"

#include <future>
#include <sstream>

namespace expo {

using namespace winrt;
using namespace winrt::Microsoft::ReactNative;
using namespace winrt::Microsoft::ReactNative::Composition;

namespace {

std::mutex g_viewIdsMutex;
std::unordered_map<int64_t, int> g_viewIdsByTag;

std::mutex g_visualsMutex;
std::unordered_map<int64_t, winrt::Microsoft::UI::Composition::Visual> g_visualsByTag;

void traceExpoView(char const* message) noexcept {
    OutputDebugStringA(message);
    OutputDebugStringA("\n");
}

void traceExpoView(char const* message, int64_t tag, int viewId = -1) noexcept {
    std::ostringstream stream;
    stream << message << " tag=" << tag;
    if (viewId >= 0) {
        stream << " viewId=" << viewId;
    }
    stream << "\n";
    OutputDebugStringA(stream.str().c_str());
}

bool expoViewsEnabled() noexcept {
    wchar_t value[8]{};
    auto length = GetEnvironmentVariableW(L"EXPO_MODULES_WINDOWS_ENABLE_EXPERIMENTAL_VIEWS", value, 8);
    return !(length == 1 && value[0] == L'0');
}

void appendEscapedString(std::string& out, const std::string& value) {
    out.push_back('"');
    for (char c : value) {
        switch (c) {
        case '"': out.append("\\\""); break;
        case '\\': out.append("\\\\"); break;
        case '\b': out.append("\\b"); break;
        case '\f': out.append("\\f"); break;
        case '\n': out.append("\\n"); break;
        case '\r': out.append("\\r"); break;
        case '\t': out.append("\\t"); break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buffer[8];
                snprintf(buffer, sizeof(buffer), "\\u%04x", static_cast<unsigned char>(c));
                out.append(buffer);
            } else {
                out.push_back(c);
            }
            break;
        }
    }
    out.push_back('"');
}

std::string jsValueReaderToJson(IJSValueReader const& reader) {
    switch (reader.ValueType()) {
    case JSValueType::Null:
        return "null";
    case JSValueType::String: {
        std::string out;
        appendEscapedString(out, to_string(reader.GetString()));
        return out;
    }
    case JSValueType::Boolean:
        return reader.GetBoolean() ? "true" : "false";
    case JSValueType::Int64:
        return std::to_string(reader.GetInt64());
    case JSValueType::Double: {
        char buffer[64];
        snprintf(buffer, sizeof(buffer), "%.17g", reader.GetDouble());
        return buffer;
    }
    case JSValueType::Array: {
        std::string out = "[";
        bool first = true;
        while (reader.GetNextArrayItem()) {
            if (!first) out.push_back(',');
            first = false;
            out.append(jsValueReaderToJson(reader));
        }
        out.push_back(']');
        return out;
    }
    case JSValueType::Object: {
        std::string out = "{";
        bool first = true;
        hstring propertyName;
        while (reader.GetNextObjectProperty(propertyName)) {
            if (!first) out.push_back(',');
            first = false;
            appendEscapedString(out, to_string(propertyName));
            out.push_back(':');
            out.append(jsValueReaderToJson(reader));
        }
        out.push_back('}');
        return out;
    }
    default:
        return "null";
    }
}

struct ExpoViewProps : implements<ExpoViewProps, IComponentProps> {
    explicit ExpoViewProps(std::unordered_set<std::string> allowedProps)
        : m_allowedProps(std::move(allowedProps)) {}

    void SetProp(uint32_t /*hash*/, hstring const& propName, IJSValueReader const& value) {
        auto name = to_string(propName);
        if (!m_allowedProps.empty() && !m_allowedProps.count(name)) {
            return;
        }

        m_values[name] = jsValueReaderToJson(value);
    }

    void CopyFrom(ExpoViewProps const& previous) {
        m_values = previous.m_values;
    }

    const std::unordered_map<std::string, std::string>& Values() const {
        return m_values;
    }

private:
    std::unordered_set<std::string> m_allowedProps;
    std::unordered_map<std::string, std::string> m_values;
};

std::string propsToJson(ExpoViewProps const* props) {
    if (!props) return "{}";

    std::string out = "{";
    bool first = true;
    for (auto const& [name, valueJson] : props->Values()) {
        if (!first) out.push_back(',');
        first = false;
        appendEscapedString(out, name);
        out.push_back(':');
        out.append(valueJson);
    }
    out.push_back('}');
    return out;
}

int viewIdForTag(int64_t tag) {
    std::scoped_lock lock(g_viewIdsMutex);
    auto it = g_viewIdsByTag.find(tag);
    return it == g_viewIdsByTag.end() ? -1 : it->second;
}

void storeViewIdForTag(int64_t tag, int viewId) {
    std::scoped_lock lock(g_viewIdsMutex);
    g_viewIdsByTag[tag] = viewId;
}

void eraseViewIdForTag(int64_t tag) {
    std::scoped_lock lock(g_viewIdsMutex);
    g_viewIdsByTag.erase(tag);
}

winrt::Microsoft::UI::Composition::Visual visualForTag(int64_t tag) {
    std::scoped_lock lock(g_visualsMutex);
    auto it = g_visualsByTag.find(tag);
    return it == g_visualsByTag.end()
        ? winrt::Microsoft::UI::Composition::Visual{ nullptr }
        : it->second;
}

void storeVisualForTag(int64_t tag, winrt::Microsoft::UI::Composition::Visual const& visual) {
    std::scoped_lock lock(g_visualsMutex);
    g_visualsByTag.insert_or_assign(tag, visual);
}

void eraseVisualForTag(int64_t tag) {
    std::scoped_lock lock(g_visualsMutex);
    g_visualsByTag.erase(tag);
}

bool runOnUiDispatcher(
    IReactDispatcher const& dispatcher,
    std::function<void()> action) noexcept {
    try {
        if (!dispatcher || dispatcher.HasThreadAccess()) {
            action();
            return true;
        }

        auto done = std::make_shared<std::promise<void>>();
        auto error = std::make_shared<std::exception_ptr>();
        auto future = done->get_future();

        dispatcher.Post([action = std::move(action), done, error]() noexcept {
            try {
                action();
            }
            catch (...) {
                *error = std::current_exception();
            }
            done->set_value();
        });

        future.wait();
        if (*error) {
            std::rethrow_exception(*error);
        }
        return true;
    }
    catch (...) {
        return false;
    }
}

void updateViewLayout(int64_t tag, int viewId, LayoutMetrics const& layoutMetrics) noexcept {
    auto width = layoutMetrics.Frame.Width;
    auto height = layoutMetrics.Frame.Height;
    if (width <= 0 || height <= 0) {
        return;
    }

    if (auto visual = visualForTag(tag)) {
        visual.Size({ width, height });
    }
    ExpoModuleHost::Instance().UpdateViewLayout(viewId, width, height);
}

winrt::Microsoft::UI::Composition::Visual createManagedCompositionVisual(
    ExpoModuleHost& host,
    int moduleIndex,
    winrt::Microsoft::ReactNative::ComponentView const& source) {
    auto tag = source.Tag();
    auto compositionView = source.try_as<winrt::Microsoft::ReactNative::Composition::ComponentView>();
    if (!compositionView) {
        traceExpoView("ExpoView: create visual failed missing composition view", tag);
        return nullptr;
    }

    traceExpoView("ExpoView: create visual", tag);

    int viewId = -1;
    if (host.CreateView(moduleIndex, &viewId) != 0 || viewId < 0) {
        traceExpoView("ExpoView: create view failed", tag);
        return nullptr;
    }

    traceExpoView("ExpoView: create view complete", tag, viewId);
    storeViewIdForTag(tag, viewId);

    void* compositorPtr = nullptr;
    copy_to_abi(compositionView.Compositor(), compositorPtr);

    auto visualPtr = host.InitializeViewComposition(viewId, reinterpret_cast<intptr_t>(compositorPtr));
    if (visualPtr == 0) {
        traceExpoView("ExpoView: create visual failed", tag, viewId);
        host.DestroyView(viewId);
        eraseViewIdForTag(tag);
        return nullptr;
    }

    winrt::Microsoft::UI::Composition::Visual visual{ nullptr };
    attach_abi(visual, reinterpret_cast<void*>(visualPtr));
    storeVisualForTag(tag, visual);

    traceExpoView("ExpoView: create visual complete", tag, viewId);
    return visual;
}

} // namespace

void RegisterExpoViewComponents(IReactPackageBuilder const& packageBuilder) noexcept {
    try {
        if (!expoViewsEnabled()) {
            traceExpoView("ExpoViewManager: view registration disabled by EXPO_MODULES_WINDOWS_ENABLE_EXPERIMENTAL_VIEWS=0");
            return;
        }

        auto fabricBuilder = packageBuilder.try_as<IReactPackageBuilderFabric>();
        if (!fabricBuilder) {
            return;
        }

        auto& host = ExpoModuleHost::Instance();
        host.InitializeDefault();

        for (auto const& module : host.GetModules()) {
            if (!module.view || module.view->componentName.empty()) {
                continue;
            }

            auto moduleIndex = module.index;
            auto componentName = module.view->componentName;
            auto propNames = std::unordered_set<std::string>(
                module.view->props.begin(),
                module.view->props.end());

            fabricBuilder.AddViewComponent(
                to_hstring(componentName),
                [moduleIndex, propNames = std::move(propNames)](IReactViewComponentBuilder const& viewBuilder) {
                    viewBuilder.SetCreateProps(
                        [propNames](ViewProps const& /*props*/, IComponentProps const& cloneFrom) {
                            auto props = make_self<ExpoViewProps>(propNames);
                            if (cloneFrom) {
                                if (auto previous = get_self<ExpoViewProps>(cloneFrom)) {
                                    props->CopyFrom(*previous);
                                }
                            }
                            return props.as<IComponentProps>();
                        });

                    viewBuilder.SetUpdatePropsHandler(
                        [](winrt::Microsoft::ReactNative::ComponentView const& source,
                           IComponentProps const& newProps,
                           IComponentProps const& /*oldProps*/) {
                            traceExpoView("ExpoView: update props", source.Tag());
                            auto viewId = viewIdForTag(source.Tag());
                            if (viewId < 0) {
                                traceExpoView("ExpoView: update props skipped missing view", source.Tag());
                                return;
                            }

                            auto json = propsToJson(get_self<ExpoViewProps>(newProps));
                            auto dispatcher = source.ReactContext().UIDispatcher();
                            runOnUiDispatcher(dispatcher, [viewId, json = std::move(json)]() {
                                ExpoModuleHost::Instance().UpdateViewProps(viewId, json);
                            });
                        });

                    auto compositionBuilder = viewBuilder.try_as<IReactCompositionViewComponentBuilder>();
                    if (!compositionBuilder) {
                        return;
                    }

                    compositionBuilder.SetViewFeatures(
                        ComponentViewFeatures::Default & ~ComponentViewFeatures::Background);

                    compositionBuilder.SetUpdateLayoutMetricsHandler(
                        [](winrt::Microsoft::ReactNative::ComponentView const& source,
                           LayoutMetrics const& newLayoutMetrics,
                           LayoutMetrics const& /*oldLayoutMetrics*/) {
                            traceExpoView("ExpoView: update layout", source.Tag());
                            auto viewId = viewIdForTag(source.Tag());
                            if (viewId < 0) {
                                traceExpoView("ExpoView: update layout skipped missing view", source.Tag());
                                return;
                            }

                            auto dispatcher = source.ReactContext().UIDispatcher();
                            runOnUiDispatcher(dispatcher, [tag = source.Tag(), viewId, newLayoutMetrics]() {
                                updateViewLayout(tag, viewId, newLayoutMetrics);
                            });
                        });

                    compositionBuilder.SetViewComponentViewInitializer(
                        [](ViewComponentView const& view) {
                            traceExpoView("ExpoView: initializer enter", view.Tag());
                            auto tag = view.Tag();
                            auto dispatcher = view.ReactContext().UIDispatcher();
                            view.Destroying([tag, dispatcher](auto const&, auto const&) {
                                auto viewId = viewIdForTag(tag);
                                traceExpoView("ExpoView: destroying enter", tag, viewId);
                                traceExpoView("ExpoView: destroying before dispatcher post", tag, viewId);
                                runOnUiDispatcher(dispatcher, [tag, viewId]() {
                                    if (viewId >= 0) {
                                        traceExpoView("ExpoView: destroying before DestroyView", tag, viewId);
                                        ExpoModuleHost::Instance().DestroyView(viewId);
                                        traceExpoView("ExpoView: destroying after DestroyView", tag, viewId);
                                    }
                                    eraseViewIdForTag(tag);
                                    eraseVisualForTag(tag);
                                    traceExpoView("ExpoView: destroying complete", tag, viewId);
                                });
                            });
                            traceExpoView("ExpoView: initializer complete", tag);
                        });

                    compositionBuilder.SetCreateVisualHandler(
                        [moduleIndex](winrt::Microsoft::ReactNative::ComponentView const& source) {
                            return createManagedCompositionVisual(
                                ExpoModuleHost::Instance(),
                                moduleIndex,
                                source);
                        });
                });
        }
    }
    catch (std::exception const& ex) {
        OutputDebugStringA(("ExpoViewManager: failed to register views: " + std::string(ex.what()) + "\n").c_str());
    }
    catch (...) {
        OutputDebugStringA("ExpoViewManager: failed to register views with unknown error\n");
    }
}

} // namespace expo
