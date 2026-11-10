import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { validarPedido, validarRestablecer, normalizarCodigo, pedirCodigo, restablecerPassword, LARGO_CODIGO } from '../auth/recuperacion.js';
import { estilos, colores } from './estilos.js';
import { Logo, FondoDegradado } from './Marca.js';

// Recuperar la contraseña (sin sesión): 1) se pide el código con el correo de la cuenta, 2) se escribe el código que
// llegó por correo junto con la contraseña nueva. Al terminar se vuelve al inicio de sesión.
export default function RecuperarPasswordScreen({ correoInicial = '', alVolver }) {
    const [paso, setPaso] = useState(1);
    const [correo, setCorreo] = useState(correoInicial.includes('@') ? correoInicial : '');
    const [codigo, setCodigo] = useState('');
    const [password, setPassword] = useState('');
    const [repetida, setRepetida] = useState('');
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');
    const [enviando, setEnviando] = useState(false);

    const pedir = async () => {
        const problema = validarPedido(correo);
        if (problema) return setError(problema);
        setError('');
        setEnviando(true);
        try {
            const r = await pedirCodigo(correo);
            setAviso(r.message);
            setPaso(2);
        } catch (e) {
            setError(e.message);
        } finally {
            setEnviando(false);
        }
    };

    const cambiar = async () => {
        const problema = validarRestablecer({ codigo, password, repetida });
        if (problema) return setError(problema);
        setError('');
        setEnviando(true);
        try {
            const r = await restablecerPassword({ correo, codigo, password });
            setAviso(r.message);
            setPaso(3);
        } catch (e) {
            setError(e.message);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <FondoDegradado>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={[estilos.pantalla, { backgroundColor: 'transparent' }]} keyboardShouldPersistTaps="handled">
                <View style={{ alignItems: 'center', marginBottom: 10 }}><View style={estilos.medallon}><Logo ancho={100} /></View></View>
                <Text style={[estilos.titulo, { color: '#fff' }]}>Recuperar contraseña</Text>
                <Text style={[estilos.subtitulo, { color: '#e0e7ff' }]}>
                    {paso === 1 && 'Te enviamos un código por correo'}
                    {paso === 2 && 'Escribí el código y tu contraseña nueva'}
                    {paso === 3 && '¡Listo!'}
                </Text>

                <View style={estilos.tarjeta}>
                    {paso === 1 && (
                        <>
                            <Text style={estilos.etiqueta}>Correo de tu cuenta</Text>
                            <TextInput
                                style={estilos.campo}
                                value={correo}
                                onChangeText={setCorreo}
                                placeholder="nombre@correo.com"
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                editable={!enviando}
                                onSubmitEditing={pedir}
                            />
                            {!!error && <Text style={estilos.error}>{error}</Text>}
                            <Pressable style={[estilos.boton, enviando && estilos.botonDeshabilitado]} onPress={pedir} disabled={enviando} accessibilityRole="button">
                                {enviando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Enviar código</Text>}
                            </Pressable>
                            {enviando && <Text style={[estilos.pie, { color: colores.suave }]}>Conectando… la primera vez puede tardar hasta 1 minuto.</Text>}
                            <Pressable style={estilos.botonSecundario} onPress={() => { setError(''); setPaso(2); }} accessibilityRole="button">
                                <Text style={estilos.botonTextoSecundario}>Ya tengo un código</Text>
                            </Pressable>
                        </>
                    )}

                    {paso === 2 && (
                        <>
                            {!!aviso && <Text style={[estilos.exito, { marginTop: 0, marginBottom: 6 }]}>{aviso}</Text>}
                            <Text style={estilos.etiqueta}>Correo de tu cuenta</Text>
                            <TextInput style={estilos.campo} value={correo} onChangeText={setCorreo} placeholder="nombre@correo.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!enviando} />
                            <Text style={estilos.etiqueta}>Código de {LARGO_CODIGO} dígitos</Text>
                            <TextInput
                                style={[estilos.campo, { letterSpacing: 6, fontSize: 20 }]}
                                value={codigo}
                                onChangeText={(t) => setCodigo(normalizarCodigo(t))}
                                placeholder="000000"
                                keyboardType="number-pad"
                                maxLength={LARGO_CODIGO}
                                editable={!enviando}
                            />
                            <Text style={estilos.etiqueta}>Contraseña nueva</Text>
                            <TextInput style={estilos.campo} value={password} onChangeText={setPassword} placeholder="Mínimo 8, con mayúscula, número y símbolo" secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!enviando} />
                            <Text style={estilos.etiqueta}>Repetí la contraseña nueva</Text>
                            <TextInput style={estilos.campo} value={repetida} onChangeText={setRepetida} placeholder="Repetila" secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!enviando} onSubmitEditing={cambiar} />
                            {!!error && <Text style={estilos.error}>{error}</Text>}
                            <Pressable style={[estilos.boton, enviando && estilos.botonDeshabilitado]} onPress={cambiar} disabled={enviando} accessibilityRole="button">
                                {enviando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Cambiar contraseña</Text>}
                            </Pressable>
                            <Pressable style={estilos.botonSecundario} onPress={() => { setError(''); setCodigo(''); setPaso(1); }} accessibilityRole="button">
                                <Text style={estilos.botonTextoSecundario}>Pedir otro código</Text>
                            </Pressable>
                        </>
                    )}

                    {paso === 3 && (
                        <>
                            <Text style={[estilos.exito, { marginTop: 0 }]}>{aviso}</Text>
                            <Pressable style={estilos.boton} onPress={alVolver} accessibilityRole="button">
                                <Text style={estilos.botonTexto}>Ir a iniciar sesión</Text>
                            </Pressable>
                        </>
                    )}
                </View>

                {paso !== 3 && (
                    <Pressable onPress={alVolver} accessibilityRole="button" style={{ marginTop: 18, alignItems: 'center' }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Volver al inicio de sesión</Text>
                    </Pressable>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
        </FondoDegradado>
    );
}
