// Patrón FACTORY (creacional) aplicado a los roles del sistema (HU2 / RBAC).
//
// Problema: la lista de roles y su significado estaban repetidos como textos sueltos
// ('admin', 'padre', ...) en varios controladores.
// Solución: un único punto que sabe CREAR cada tipo de rol. Quien necesita un rol le
// pide uno a la fábrica por su nombre y no conoce las clases concretas.

class Rol {
    constructor(nombre, etiqueta, { esAdministrador = false, registroPublico = false } = {}) {
        this.nombre = nombre;
        this.etiqueta = etiqueta;
        this.esAdministrador = esAdministrador;
        // Si el rol puede crearse solo desde el registro público de la web.
        this.registroPublico = registroPublico;
        Object.freeze(this);
    }
}

class Administrador extends Rol {
    constructor() { super('admin', 'Administrador', { esAdministrador: true }); }
}
class Docente extends Rol {
    constructor() { super('docente', 'Docente'); }
}
class Alumno extends Rol {
    constructor() { super('alumno', 'Alumno'); }
}
class Padre extends Rol {
    constructor() { super('padre', 'Padre / Tutor', { registroPublico: true }); }
}

const CONSTRUCTORES = {
    admin: Administrador,
    docente: Docente,
    alumno: Alumno,
    padre: Padre
};

const RolFactory = {
    // Crea el rol pedido. Si el nombre no existe devuelve null (no lanza), para que el
    // controlador responda 400 con su propio mensaje.
    crear(nombre) {
        const Constructor = CONSTRUCTORES[nombre];
        return Constructor ? new Constructor() : null;
    },

    esValido(nombre) {
        return Object.prototype.hasOwnProperty.call(CONSTRUCTORES, nombre);
    },

    nombres() {
        return Object.keys(CONSTRUCTORES);
    }
};

module.exports = RolFactory;
