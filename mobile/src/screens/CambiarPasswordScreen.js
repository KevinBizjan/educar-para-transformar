import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext.js';
import { validarCambioPassword } from '../utils/validators.js';
import { estilos } from './estilos.js';

export default function CambiarPasswordScreen({ alVolver }) {
    const { cambiarPassword } = useAuth();
    const [actual, setActual] = useState('');
    const [nueva, setNueva] = useState('');
    const [repetida, setRepetida] = useState('');
    const [error, setError] = useState('');
    const [listo, setListo] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const guardar = async () => {
        const problema = validarCambioPassword(actual, nueva, repetida);
        if (problema) { setError(problema); return; }
        setError('');
        setEnviando(true);
        try {
            await cambiarPassword(actual, nueva);
            setListo(true);
        } catch (e) {
            setError(e.message);
        } finally {
            setEnviando(false);
        }
    };

    const campo = (etiqueta, valor, cambiar) => (
        <>
            <Text style={estilos.etiqueta}>{etiqueta}</Text>
            <TextInput
                style={estilos.campo}
                value={valor}
                onChangeText={cambiar}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!enviando && !listo}
            />
        </>
    );

    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={estilos.pantalla} keyboardShouldPersistTaps="handled">
                <Text style={estilos.titulo}>Cambiar contraseña</Text>
                <Text style={estilos.subtitulo}>Mínimo 8 caracteres, con mayúscula, número y símbolo</Text>

                <View style={estilos.tarjeta}>
                    {campo('Contraseña actual', actual, setActual)}
                    {campo('Contraseña nueva', nueva, setNueva)}
                    {campo('Repetí la contraseña nueva', repetida, setRepetida)}

                    {!!error && <Text style={estilos.error}>{error}</Text>}
                    {listo && <Text style={estilos.exito}>✓ Tu contraseña se actualizó correctamente.</Text>}

                    {!listo && (
                        <Pressable style={[estilos.boton, enviando && estilos.botonDeshabilitado]} onPress={guardar} disabled={enviando}>
                            {enviando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Guardar contraseña</Text>}
                        </Pressable>
                    )}
                    <Pressable style={estilos.botonSecundario} onPress={alVolver}>
                        <Text style={estilos.botonTextoSecundario}>{listo ? 'Volver al inicio' : 'Cancelar'}</Text>
                    </Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
