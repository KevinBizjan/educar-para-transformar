import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const FieldError = ({ error }) => error ? (
    <span style={{ display: 'block', color: '#dc2626', fontSize: '0.78rem', fontWeight: 700, marginTop: '6px' }}>{error}</span>
) : null;

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState({});
    const [error, setError] = useState('');
    const { login, user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    // Determinar qué tipo de portal mostrar
    const searchParams = new URLSearchParams(location.search);
    const roleParam = searchParams.get('role');

    const getPortalInfo = () => {
        switch (roleParam) {
            case 'admin': return { title: 'Portal Administrador', sub: 'Acceso para gestión institucional' };
            case 'docente': return { title: 'Portal Docente', sub: 'Acceso exclusivo para el personal educativo' };
            case 'alumno': return { title: 'Portal Alumno', sub: 'Accedé a tus clases y materiales' };
            case 'padre': return { title: 'Portal Familiar', sub: 'Seguimiento académico de tus hijos' };
            default: return { title: 'Bienvenido', sub: 'Ingresá a la plataforma institucional' };
        }
    };

    const portal = getPortalInfo();

    const redirectUser = (rol) => {
        switch (rol) {
            case 'admin': navigate('/admin'); break;
            case 'docente': navigate('/docente'); break;
            case 'alumno': navigate('/alumno'); break;
            case 'padre': navigate('/padre'); break;
            default: navigate('/');
        }
    };

    useEffect(() => {
        if (user) {
            redirectUser(user.rol);
        }
    }, [user]);

    // Valida un campo puntual con un mensaje descriptivo que orienta al usuario
    // sobre el dato esperado, sin revelar cuál credencial es incorrecta (seguridad).
    const validarCampo = (name, valor) => {
        if (name === 'username') {
            if (!valor.trim()) return 'Ingresá tu usuario (DNI o correo electrónico).';
            if (/\s/.test(valor)) return 'El usuario no debe contener espacios.';
            return '';
        }
        if (name === 'password') {
            if (!valor) return 'Ingresá tu contraseña.';
            return '';
        }
        return '';
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validación previa a consultar la BD (RF18): usuario y contraseña no vacíos,
        // con avisos descriptivos por campo en lugar de un único error genérico.
        const nuevos = {
            username: validarCampo('username', username),
            password: validarCampo('password', password)
        };
        setErrors(nuevos);
        if (nuevos.username || nuevos.password) return;

        const result = await login(username, password);
        if (!result.success) {
            // Fallo de autenticación real: mensaje genérico (no se revela cuál credencial falló).
            setError(result.message);
        }
    };

    const campoStyle = (name) => ({
        width: '100%', padding: '14px 18px', borderRadius: '12px',
        border: `2px solid ${errors[name] ? '#dc2626' : '#f1f5f9'}`,
        fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s'
    });

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
                    }}>🎓</div>
                    <h2 style={{
                        fontFamily: 'Nunito, sans-serif',
                        color: 'var(--blue)',
                        fontSize: '2.2rem',
                        marginBottom: '8px'
                    }}>
                        {portal.title}
                    </h2>
                    <p style={{ color: 'var(--text-sm)', fontWeight: 600 }}>
                        {portal.sub}
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        padding: '14px',
                        borderRadius: '12px',
                        marginBottom: '24px',
                        fontSize: '0.9rem',
                        fontWeight: '700',
                        textAlign: 'center',
                        border: '1px solid #fecaca'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '800', fontSize: '0.85rem', color: 'var(--text-sm)', textTransform: 'uppercase' }}>Usuario</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => { setUsername(e.target.value); if (errors.username) setErrors((p) => ({ ...p, username: validarCampo('username', e.target.value) })); }}
                            onBlur={(e) => setErrors((p) => ({ ...p, username: validarCampo('username', e.target.value) }))}
                            style={campoStyle('username')}
                            placeholder="Tu usuario"
                        />
                        <FieldError error={errors.username} />
                    </div>
                    <div style={{ marginBottom: '32px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '800', fontSize: '0.85rem', color: 'var(--text-sm)', textTransform: 'uppercase' }}>Contraseña</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((p) => ({ ...p, password: validarCampo('password', e.target.value) })); }}
                            onBlur={(e) => setErrors((p) => ({ ...p, password: validarCampo('password', e.target.value) }))}
                            style={campoStyle('password')}
                            placeholder="••••••••"
                        />
                        <FieldError error={errors.password} />
                    </div>
                    <button type="submit" className="btn btn-violet" style={{ 
                        width: '100%', justifyContent: 'center', padding: '16px', fontSize: '1.1rem',
                        boxShadow: '0 10px 20px rgba(124,58,237,0.3)'
                    }}>
                        Iniciar Sesión →
                    </button>
                </form>

                {(roleParam === 'padre' || !roleParam) && (
                    <div style={{ marginTop: '24px', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-sm)', fontSize: '0.9rem' }}>
                            ¿Sos una familia nueva?{' '}
                            <a href="/registro" style={{ color: 'var(--violet)', fontWeight: '800' }}>
                                Crear cuenta familiar
                            </a>
                        </p>
                    </div>
                )}

                <div style={{ marginTop: '24px', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '24px' }}>
                    <a href="/" style={{ color: 'var(--blue)', fontWeight: '800', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span>←</span> Volver al inicio
                    </a>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
