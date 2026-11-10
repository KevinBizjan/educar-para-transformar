import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext.js';
import { PORTAL_WEB_URL } from '../config.js';
import { estilos } from './estilos.js';
import { Logo, FondoDegradado } from './Marca.js';

// Roles que no son padre/tutor (administrador, docente, alumno): usan el portal web.
export default function SinAccesoScreen() {
    const { usuario, cerrarSesion } = useAuth();
    return (
        <FondoDegradado>
        <ScrollView contentContainerStyle={[estilos.pantalla, { backgroundColor: 'transparent' }]}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}><View style={estilos.medallon}><Logo ancho={130} /></View></View>
            <Text style={[estilos.titulo, { color: '#fff' }]}>Educar para Transformar</Text>
            <View style={[estilos.tarjeta, { marginTop: 24 }]}>
                <Text style={estilos.etiqueta}>Hola, {usuario.nombre}</Text>
                <Text style={estilos.texto}>
                    Esta aplicación es para padres y tutores. Con tu cuenta ({usuario.rol}) ingresá al portal web de la institución.
                </Text>
                <Pressable style={estilos.boton} onPress={() => Linking.openURL(PORTAL_WEB_URL)} accessibilityRole="link">
                    <Text style={estilos.botonTexto}>Abrir el portal web</Text>
                </Pressable>
                <Pressable style={estilos.botonSecundario} onPress={cerrarSesion}>
                    <Text style={estilos.botonTextoSecundario}>Salir</Text>
                </Pressable>
            </View>
        </ScrollView>
        </FondoDegradado>
    );
}
