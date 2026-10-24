import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { API_URL } from '../config.js';
import { useAuth } from '../auth/AuthContext.js';
import { estilos, colores } from './estilos.js';

export default function LoginScreen() {
    const { iniciarSesion, aviso } = useAuth();
    const [usuario, setUsuario] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);

    const entrar = async () => {
        if (!usuario.trim() || !password) {
            setError('Ingresá tu usuario y tu contraseña.');
            return;
        }
        setError('');
        setEnviando(true);
        try {
            await iniciarSesion(usuario.trim(), password);
        } catch (e) {
            setError(e.message);
            setEnviando(false);
        }
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={estilos.pantalla} keyboardShouldPersistTaps="handled">
                <Text style={estilos.titulo}>Educar para Transformar</Text>
                <Text style={estilos.subtitulo}>Ingresá con tu cuenta de familia</Text>

                <View style={estilos.tarjeta}>
                    {!!aviso && <Text style={[estilos.error, { marginTop: 0, marginBottom: 6 }]}>{aviso}</Text>}

                    <Text style={estilos.etiqueta}>Usuario</Text>
                    <TextInput
                        style={estilos.campo}
                        value={usuario}
                        onChangeText={setUsuario}
                        placeholder="Tu correo o usuario"
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="username"
                        keyboardType="email-address"
                        editable={!enviando}
                    />

                    <Text style={estilos.etiqueta}>Contraseña</Text>
                    <TextInput
                        style={estilos.campo}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Tu contraseña"
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="password"
                        editable={!enviando}
                        onSubmitEditing={entrar}
                    />

                    {!!error && <Text style={estilos.error}>{error}</Text>}

                    <Pressable style={[estilos.boton, enviando && estilos.botonDeshabilitado]} onPress={entrar} disabled={enviando}>
                        {enviando
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={estilos.botonTexto}>Iniciar sesión</Text>}
                    </Pressable>
                    {enviando && (
                        <Text style={[estilos.pie, { color: colores.suave }]}>
                            Conectando… la primera vez puede tardar hasta 1 minuto.
                        </Text>
                    )}
                </View>
                <Text style={estilos.pie}>{API_URL}</Text>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
