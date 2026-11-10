import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { API_URL, PORTAL_WEB_URL } from '../config.js';
import { useAuth } from '../auth/AuthContext.js';
import { estilos, colores } from './estilos.js';
import RecuperarPasswordScreen from './RecuperarPasswordScreen.js';
import { Logo, FondoDegradado } from './Marca.js';

export default function LoginScreen() {
    const { iniciarSesion, aviso } = useAuth();
    const [usuario, setUsuario] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [recuperando, setRecuperando] = useState(false);

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

    if (recuperando) return <RecuperarPasswordScreen correoInicial={usuario.trim()} alVolver={() => setRecuperando(false)} />;

    return (
        <FondoDegradado>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={[estilos.pantalla, { backgroundColor: 'transparent' }]} keyboardShouldPersistTaps="handled">
                <View style={{ alignItems: 'center', marginBottom: 12 }}>
                    <View style={estilos.medallon}><Logo ancho={140} /></View>
                </View>
                <Text style={[estilos.titulo, { color: '#fff' }]}>Educar para Transformar</Text>
                <Text style={[estilos.subtitulo, { color: '#e0e7ff' }]}>Ingresá con tu cuenta de familia</Text>

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
                    <Pressable onPress={() => setRecuperando(true)} disabled={enviando} accessibilityRole="button" style={{ marginTop: 16, alignItems: 'center' }}>
                        <Text style={{ color: colores.azul, fontWeight: '800', fontSize: 14 }}>¿Olvidaste tu contraseña?</Text>
                    </Pressable>
                </View>
                <View style={[estilos.tarjeta, { marginTop: 16, alignItems: 'center' }]}>
                    <Text style={[estilos.texto, { textAlign: 'center' }]}>¿Sos docente, alumno o administrador?</Text>
                    <Pressable style={[estilos.botonSecundario, { alignSelf: 'stretch' }]} onPress={() => Linking.openURL(PORTAL_WEB_URL)} accessibilityRole="link">
                        <Text style={estilos.botonTextoSecundario}>Ir al portal web</Text>
                    </Pressable>
                </View>
                <Text style={[estilos.pie, { color: '#c7d2fe' }]}>{API_URL}</Text>
            </ScrollView>
        </KeyboardAvoidingView>
        </FondoDegradado>
    );
}
