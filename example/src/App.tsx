import { useState } from 'react';
import { Text, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { multiply } from 'expo-modules-windows-core';

function getExampleModule() {
  console.log('__expoDebug', (global as any).__expoDebug);
  console.log('global.expo', (global as any).expo);
  console.log('global.expo.modules', (global as any).expo?.modules);
  return (global as any).expo?.modules?.ExampleModule;
}

function getInitError(): string | undefined {
  return (global as any).expo?.__initError;
}

function Btn({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [moduleLoaded, setModuleLoaded] = useState<boolean | null>(null);
  const [initError, setInitError] = useState<string>('');
  const [multiplyResult, setMultiplyResult] = useState<string>('');
  const [greetResult, setGreetResult] = useState<string>('');
  const [asyncResult, setAsyncResult] = useState<string>('');
  const [constants, setConstants] = useState<string>('');

  const turboMultiply = multiply(3, 7);

  if (moduleLoaded === null) {
    setTimeout(() => {
      setModuleLoaded(!!getExampleModule());
      setInitError(getInitError() ?? '');
    }, 500);
      console.log('global.expo', (global as any).expo);
  console.log('global.expo.modules', (global as any).expo?.modules);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Expo Modules Windows Core</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TurboModule (sanity check)</Text>
        <Text>multiply(3, 7) = {turboMultiply}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ExampleModule (C# via HostObject)</Text>
        <Text style={styles.status}>
          Module loaded: {moduleLoaded === null ? '...' : moduleLoaded ? 'Yes' : 'No'}
        </Text>

        <Btn title="Check module" onPress={() => {
          setModuleLoaded(!!getExampleModule());
          setInitError(getInitError() ?? '');
        }} />
        {initError ? <Text style={styles.error}>Init error: {initError}</Text> : null}

        <Btn
          title="multiply(6, 7)"
          onPress={() => {
            try {
              const result = getExampleModule()?.multiply(6, 7);
              setMultiplyResult(`Result: ${result}`);
            } catch (e: any) {
              setMultiplyResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{multiplyResult}</Text>

        <Btn
          title='greet("World")'
          onPress={() => {
            try {
              const result = getExampleModule()?.greet('World');
              setGreetResult(`Result: ${result}`);
            } catch (e: any) {
              setGreetResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{greetResult}</Text>

        <Btn
          title="delayedSquare(5) (async)"
          onPress={async () => {
            try {
              setAsyncResult('Computing...');
              const result = await getExampleModule()?.delayedSquare(5);
              setAsyncResult(`Result: ${result}`);
            } catch (e: any) {
              setAsyncResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{asyncResult}</Text>

        <Btn
          title="Show Constants"
          onPress={() => {
            try {
              const c = getExampleModule()?.constants ?? 'No getConstants()';
              setConstants(JSON.stringify(c, null, 2));
            } catch (e: any) {
              setConstants(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{constants}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  section: {
    width: '100%',
    marginBottom: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  status: {
    color: '#666',
    marginBottom: 4,
  },
  error: {
    color: '#d32f2f',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
