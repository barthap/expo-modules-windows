import { useState } from 'react';
import { Text, View, StyleSheet, Button, ScrollView } from 'react-native';
import { multiply } from 'expo-modules-windows-core';

// Access the ExampleModule via the global expo.modules host object
const ExampleModule = (global as any).expo?.modules?.ExampleModule;

export default function App() {
  const [multiplyResult, setMultiplyResult] = useState<string>('');
  const [greetResult, setGreetResult] = useState<string>('');
  const [asyncResult, setAsyncResult] = useState<string>('');
  const [constants, setConstants] = useState<string>('');

  const turboMultiply = multiply(3, 7);

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
          Module loaded: {ExampleModule ? 'Yes' : 'No'}
        </Text>

        <Button
          title="multiply(6, 7)"
          onPress={() => {
            try {
              const result = ExampleModule?.multiply(6, 7);
              setMultiplyResult(`Result: ${result}`);
            } catch (e: any) {
              setMultiplyResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{multiplyResult}</Text>

        <Button
          title='greet("World")'
          onPress={() => {
            try {
              const result = ExampleModule?.greet('World');
              setGreetResult(`Result: ${result}`);
            } catch (e: any) {
              setGreetResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{greetResult}</Text>

        <Button
          title="delayedSquare(5) (async)"
          onPress={async () => {
            try {
              setAsyncResult('Computing...');
              const result = await ExampleModule?.delayedSquare(5);
              setAsyncResult(`Result: ${result}`);
            } catch (e: any) {
              setAsyncResult(`Error: ${e.message}`);
            }
          }}
        />
        <Text>{asyncResult}</Text>

        <Button
          title="Show Constants"
          onPress={() => {
            try {
              const c = ExampleModule?.getConstants?.() ?? 'No getConstants()';
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
});
