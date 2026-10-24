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
import MisHijosScreen from './src/screens/MisHijosScreen.js';
import BarraInferior from './src/screens/BarraInferior.js';
import { colores } from './src/screens/estilos.js';

// Redirección según el estado de la sesión y el rol del usuario.
function Raiz() {
  const { usuario, cargando } = useAuth();
  const [seccion, setSeccion] = useState('hijos'); // 'hijos' | 'cuenta'
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

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {seccion === 'hijos'
          ? <MisHijosScreen />
          : <InicioScreen alCambiarPassword={() => setVerCambioPassword(true)} />}
      </View>
      <BarraInferior activa={seccion} alElegir={setSeccion} />
    </View>
  );
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
