import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const FieldError = ({ error }) => error ? <span style={errorTextStyle}>{error}</span> : null;

// Validadores por campo: devuelven '' (ok) o el mensaje de error.
// Permiten mostrar el error inline apenas se completa cada campo.
const validateCampo = (name, { nombre, email, password, confirmar }) => {
    switch (name) {
        case 'nombre':
            if (!nombre.trim()) return 'Ingresá tu nombre y apellido.';
            if (!/^[\p{L}\s'’.-]+$/u.test(nombre.trim())) return 'El nombre solo puede contener letras (sin números ni símbolos).';
            return '';
        case 'email':
            if (!email.trim()) return 'El correo es obligatorio.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Ingresá un correo electrónico válido.';
            return '';
        case 'password':
            if (!password) return 'La contraseña es obligatoria.';
            if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
            if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una mayúscula.';
            if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
            if (!/[^A-Za-z0-9]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial (ej: ! @ # $).';
            return '';
        case 'confirmar':
            if (!confirmar) return 'Repetí la contraseña.';
            if (password !== confirmar) return 'Las contraseñas no coinciden.';
            return '';
        default:
            return '';
    }
};

const RegistroPage = () => {
    const [nombre, setNombre] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [errors, setErrors] = useState({});
    const [error, setError] = useState('');
    const [exito, setExito] = useState('');
    const [cargando, setCargando] = useState(false);
    const { registrar, user } = useAuth();
    const navigate = useNavigate();

    // Si ya hay sesión iniciada, no tiene sentido mostrar el registro.
    useEffect(() => {
        if (user) navigate('/padre');
    }, [user, navigate]);

    // Valida un campo puntual (en blur o cuando ya tenía error) y lo refleja inline.
    const checkField = (name, overrides = {}) => {
        const valores = { nombre, email, password, confirmar, ...overrides };
        const msg = validateCampo(name, valores);
        setErrors((prev) => ({ ...prev, [name]: msg }));
        return msg;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setExito('');

        // Validamos todos los campos y mostramos cada error junto a su input.
        const valores = { nombre, email, password, confirmar };
        const nuevos = {};
        ['nombre', 'email', 'password', 'confirmar'].forEach((name) => {
            const msg = validateCampo(name, valores);
            if (msg) nuevos[name] = msg;
        });
        setErrors(nuevos);
        if (Object.keys(nuevos).length > 0) return;

        setCargando(true);
        const result = await registrar(nombre.trim(), email.trim().toLowerCase(), password);
        setCargando(false);

        if (result.success) {
            setExito('¡Cuenta creada! Ya podés iniciar sesión. Redirigiendo...');
            setTimeout(() => navigate('/login?role=padre'), 1800);
        } else {
            setError(result.message);
        }
    };

    const campoStyle = (name) => ({ ...inputStyle, borderColor: errors[name] ? '#dc2626' : '#f1f5f9' });

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1a5fa8 0%, #7c3aed 100%)',
            padding: '24px',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Decoración de fondo */}
            <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: '40%', height: '40%', background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }}></div>
            <div style={{ position: 'absolute', bottom: '-10%', right: '-5%', width: '30%', height: '30%', background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }}></div>

            <div style={{
                background: 'var(--white)',
                padding: '40px',
                borderRadius: '24px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
                maxWidth: '450px',
                width: '100%',
                position: 'relative',
                zIndex: 1
            }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{
                        width: '64px', height: '64px', background: 'var(--bg)', borderRadius: '16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem',
                        margin: '0 auto 16px'
                    }}>👨‍👩‍👧</div>
                    <h2 style={{
                        fontFamily: 'Nunito, sans-serif',
                        color: 'var(--blue)',
                        fontSize: '2.2rem',
                        marginBottom: '8px'
                    }}>
                        Crear Cuenta Familiar
                    </h2>
                    <p style={{ color: 'var(--text-sm)', fontWeight: 600 }}>
                        Registrate y luego vinculá el legajo de tu hijo/a
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: '#fee2e2', color: '#dc2626', padding: '14px', borderRadius: '12px',
                        marginBottom: '24px', fontSize: '0.9rem', fontWeight: '700', textAlign: 'center', border: '1px solid #fecaca'
                    }}>
                        {error}
                    </div>
                )}
                {exito && (
                    <div style={{
                        background: '#dcfce7', color: '#16a34a', padding: '14px', borderRadius: '12px',
                        marginBottom: '24px', fontSize: '0.9rem', fontWeight: '700', textAlign: 'center', border: '1px solid #bbf7d0'
                    }}>
                        {exito}
                    </div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={labelStyle}>Nombre y Apellido</label>
                        <input
                            type="text"
                            value={nombre}
                            onChange={(e) => { setNombre(e.target.value); if (errors.nombre) checkField('nombre', { nombre: e.target.value }); }}
                            onBlur={(e) => checkField('nombre', { nombre: e.target.value })}
                            style={campoStyle('nombre')}
                            placeholder="Ej: María González"
                        />
                        <FieldError error={errors.nombre} />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={labelStyle}>Correo electrónico</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); if (errors.email) checkField('email', { email: e.target.value }); }}
                            onBlur={(e) => checkField('email', { email: e.target.value })}
                            style={campoStyle('email')}
                            placeholder="tucorreo@ejemplo.com"
                        />
                        <FieldError error={errors.email} />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={labelStyle}>Contraseña</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); if (errors.password) checkField('password', { password: e.target.value }); }}
                            onBlur={(e) => checkField('password', { password: e.target.value })}
                            style={campoStyle('password')}
                            placeholder="Mín. 8: mayúscula, número y símbolo"
                        />
                        <FieldError error={errors.password} />
                    </div>
                    <div style={{ marginBottom: '32px' }}>
                        <label style={labelStyle}>Repetir contraseña</label>
                        <input
                            type="password"
                            value={confirmar}
                            onChange={(e) => { setConfirmar(e.target.value); if (errors.confirmar) checkField('confirmar', { confirmar: e.target.value }); }}
                            onBlur={(e) => checkField('confirmar', { confirmar: e.target.value })}
                            style={campoStyle('confirmar')}
                            placeholder="••••••••"
                        />
                        <FieldError error={errors.confirmar} />
                    </div>
                    <button type="submit" disabled={cargando} className="btn btn-violet" style={{
                        width: '100%', justifyContent: 'center', padding: '16px', fontSize: '1.1rem',
                        boxShadow: '0 10px 20px rgba(124,58,237,0.3)', opacity: cargando ? 0.7 : 1
                    }}>
                        {cargando ? 'Creando cuenta...' : 'Crear Cuenta →'}
                    </button>
                </form>

                <div style={{ marginTop: '32px', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '24px' }}>
                    <p style={{ color: 'var(--text-sm)', fontSize: '0.9rem', marginBottom: '8px' }}>¿Ya tenés cuenta?</p>
                    <a href="/login?role=padre" style={{ color: 'var(--blue)', fontWeight: '800', fontSize: '0.9rem' }}>
                        Iniciar sesión
                    </a>
                </div>

                <div style={{ marginTop: '20px', textAlign: 'center' }}>
                    <a href="/" style={{ color: 'var(--blue)', fontWeight: '800', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span>←</span> Volver al inicio
                    </a>
                </div>
            </div>
        </div>
    );
};

const labelStyle = { display: 'block', marginBottom: '8px', fontWeight: '800', fontSize: '0.85rem', color: 'var(--text-sm)', textTransform: 'uppercase' };
const inputStyle = {
    width: '100%', padding: '14px 18px', borderRadius: '12px', border: '2px solid #f1f5f9',
    fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s'
};
const errorTextStyle = {
    display: 'block', color: '#dc2626', fontSize: '0.78rem', fontWeight: 700, marginTop: '6px'
};

export default RegistroPage;
