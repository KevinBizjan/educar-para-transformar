// Patrón OBSERVER (de comportamiento) aplicado a los comunicados (HU4).
//
// Problema: al publicar un comunicado pueden querer enterarse otras partes del sistema
// (auditoría, y a futuro envío por correo o notificaciones push en la app móvil). Si el
// controlador las llamara una por una, habría que modificarlo cada vez que se suma una.
// Solución: el controlador solo AVISA "se publicó un comunicado". Quien quiera reaccionar
// se suscribe, sin que el controlador lo conozca.

class Publicador {
    constructor() {
        this.observadores = [];
    }

    // Registra un observador (una función que recibe el evento). Devuelve una función para
    // darlo de baja.
    suscribir(observador) {
        if (typeof observador !== 'function') {
            throw new TypeError('El observador debe ser una función');
        }
        this.observadores.push(observador);
        return () => {
            this.observadores = this.observadores.filter(o => o !== observador);
        };
    }

    // Avisa a todos. Un observador que falla NO debe romper la publicación ni a los demás.
    notificar(evento) {
        for (const observador of this.observadores) {
            try {
                observador(evento);
            } catch (err) {
                console.error('[comunicados] un observador falló:', err.message);
            }
        }
    }
}

// Instancia única para los comunicados de la institución.
const comunicados = new Publicador();

// Observador por defecto: deja constancia (auditoría) de cada comunicado publicado.
comunicados.suscribir((evento) => {
    console.log(`[comunicados] publicado #${evento.id} "${evento.titulo}" para: ${evento.rol_destino}`);
});

module.exports = { Publicador, comunicados };
