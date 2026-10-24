import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext.js';
import { estilos } from './estilos.js';

// Pantalla principal del padre/tutor. "Mis hijos" y las cuotas se suman en las próximas HU.
export default function InicioScreen({ alCambiarPassword }) {
    const { usuario, cerrarSesion } = useAuth();

    // RNF08: confirmación antes de cerrar la sesión, igual que en la web.
    const confirmarSalida = () => {
        Alert.alert('Cerrar sesión', '¿Querés cerrar tu sesión?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Cerrar sesión', style: 'destructive', onPress: cerrarSesion },
        ]);
    };

    return (
        <ScrollView contentContainerStyle={estilos.pantalla}>
            <Text style={estilos.titulo}>Hola, {usuario.nombre}</Text>
            <Text style={estilos.subtitulo}>Padre / Tutor</Text>

            <View style={estilos.tarjeta}>
                <Text style={estilos.etiqueta}>Tu cuenta</Text>
                <Text style={estilos.texto}>Usuario: {usuario.username}</Text>

                <Text style={[estilos.etiqueta, { marginTop: 20 }]}>Próximamente</Text>
                <Text style={estilos.texto}>Tus hijos, las cuotas y los pagos van a aparecer acá.</Text>

                <Pressable style={estilos.botonSecundario} onPress={alCambiarPassword}>
                    <Text style={estilos.botonTextoSecundario}>Cambiar contraseña</Text>
                </Pressable>
                <Pressable style={estilos.botonPeligro} onPress={confirmarSalida}>
                    <Text style={estilos.botonTexto}>Cerrar sesión</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
}
