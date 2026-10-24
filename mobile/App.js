import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/auth/AuthContext.js';
import { pantallaPorRol } from './src/auth/sesion.js';
import LoginScreen from './src/screens/LoginScreen.js';
import InicioScreen from './src/screens/InicioScreen.js';
import CambiarPasswordScreen from './src/screens/CambiarPasswordScreen.js';
import SinAccesoScreen from './src/screens/SinAccesoScreen.js';
import { colores } from './src/screens/estilos.js';

// Redirección según el estado de la sesión y el rol del usuario.
function Raiz() {
  const { usuario, cargando } = useAuth();
  const [verCambioPassword, setVerCambioPassword] = useState(false);

  if (cargando) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colores.fondo }}>
        <ActivityIndicator size="large" color={colores.azul} />
      </View>
    );
  }
  if (!usuario) return <LoginScreen />;

  if (pantallaPorRol(usuario.rol) === 'sin-acceso') return <SinAccesoScreen />;
  if (verCambioPassword) return <CambiarPasswordScreen alVolver={() => setVerCambioPassword(false)} />;
  return <InicioScreen alCambiarPassword={() => setVerCambioPassword(true)} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: colores.fondo }}>
          <Raiz />
        </SafeAreaView>
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
