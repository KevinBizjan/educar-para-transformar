// Almacenamiento del token en el celular: SecureStore usa el Keychain (iOS) y el Keystore
// (Android), a diferencia de AsyncStorage, que guarda en texto plano.
import * as SecureStore from 'expo-secure-store';

export const almacenSeguro = {
    guardar: (clave, valor) => SecureStore.setItemAsync(clave, valor),
    leer: (clave) => SecureStore.getItemAsync(clave),
    borrar: (clave) => SecureStore.deleteItemAsync(clave),
};
