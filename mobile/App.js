import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { API_URL } from './src/config';
import { verificarConexion } from './src/api/client';

// Pantalla inicial de la HU2: comprueba que la app llega al backend real.
// El login (HU3) se agrega a continuación.
export default function App() {
  const [estado, setEstado] = useState({ fase: 'cargando' });

  const probar = useCallback(async () => {
    setEstado({ fase: 'cargando' });
    try {
      const r = await verificarConexion();
      setEstado({ fase: 'ok', mensaje: r.mensaje, demoraMs: r.demoraMs });
    } catch (e) {
      setEstado({ fase: 'error', mensaje: e.message });
    }
  }, []);

  useEffect(() => { probar(); }, [probar]);

  return (
    <View style={styles.contenedor}>
      <Text style={styles.titulo}>Educar para Transformar</Text>
      <Text style={styles.subtitulo}>Aplicación para familias</Text>

      <View style={styles.tarjeta}>
        <Text style={styles.etiqueta}>Conexión con el servidor</Text>
        {estado.fase === 'cargando' && (
          <View style={styles.fila}>
            <ActivityIndicator color="#1a5fa8" />
            <Text style={styles.texto}>  Conectando… (la primera vez puede tardar hasta 1 minuto)</Text>
          </View>
        )}
        {estado.fase === 'ok' && (
          <Text style={[styles.texto, styles.ok]}>
            ✓ Conectado ({estado.demoraMs} ms){'\n'}{estado.mensaje}
          </Text>
        )}
        {estado.fase === 'error' && <Text style={[styles.texto, styles.error]}>✕ {estado.mensaje}</Text>}
        <Text style={styles.url}>{API_URL}</Text>
        <Pressable style={styles.boton} onPress={probar}>
          <Text style={styles.botonTexto}>Probar de nuevo</Text>
        </Pressable>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', padding: 24 },
  titulo: { fontSize: 26, fontWeight: '800', color: '#1a5fa8' },
  subtitulo: { fontSize: 14, color: '#475569', marginBottom: 28 },
  tarjeta: { width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 2 },
  etiqueta: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 10 },
  fila: { flexDirection: 'row', alignItems: 'center' },
  texto: { fontSize: 15, color: '#0f172a' },
  ok: { color: '#166534', fontWeight: '700' },
  error: { color: '#991b1b', fontWeight: '700' },
  url: { fontSize: 11, color: '#94a3b8', marginTop: 10 },
  boton: { marginTop: 16, backgroundColor: '#f5820d', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  botonTexto: { color: '#fff', fontWeight: '800' },
});
