import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext.js';
import { estilos } from './estilos.js';

// Roles que no son padre/tutor (administrador, docente, alumno): usan el portal web.
export default function SinAccesoScreen() {
    const { usuario, cerrarSesion } = useAuth();
    return (
        <ScrollView contentContainerStyle={estilos.pantalla}>
            <Text style={estilos.titulo}>Educar para Transformar</Text>
            <View style={[estilos.tarjeta, { marginTop: 24 }]}>
                <Text style={estilos.etiqueta}>Hola, {usuario.nombre}</Text>
                <Text style={estilos.texto}>
                    Esta aplicación es para padres y tutores. Con tu cuenta ({usuario.rol}) ingresá al portal web de la institución.
                </Text>
                <Pressable style={estilos.boton} onPress={cerrarSesion}>
                    <Text style={estilos.botonTexto}>Salir</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
}
