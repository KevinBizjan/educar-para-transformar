import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { API_URL } from '../config';
import ConfirmModal from './ConfirmModal';

const DashboardLayout = ({ title, children }) => {
    const { user, logout, apiFetch } = useAuth();
    const navigate = useNavigate();
    const [perfilOpen, setPerfilOpen] = useState(false);
    const [perfil, setPerfil] = useState(null);
    const [perfilLoading, setPerfilLoading] = useState(false);
    const [perfilError, setPerfilError] = useState('');
    const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

    const handleLogout = () => setLogoutConfirmOpen(true);

    const confirmarLogout = () => {
        setLogoutConfirmOpen(false);
        logout();
        navigate('/');
    };

    const abrirPerfil = async () => {
        setPerfilOpen(true);
        setPerfilLoading(true);
        setPerfilError('');
        try {
            const response = await apiFetch(`${API_URL}/api/auth/me`);
            if (response.ok) {
                setPerfil(await response.json());
            } else {
                setPerfilError('No se pudieron cargar tus datos.');
            }
        } catch {
            setPerfilError('Error de conexión con el servidor.');
        } finally {
            setPerfilLoading(false);
        }
    };

    const faltanDatos = perfil && (!perfil.nombre || !perfil.username || !perfil.created_at);

    return (
        <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Nunito, sans-serif' }}>
            {/* Header del Dashboard */}
            <header style={{
                background: 'linear-gradient(135deg, var(--blue) 0%, var(--blue-lt) 100%)',
                padding: '12px 24px',
                boxShadow: '0 4px 20px rgba(26,95,168,0.2)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'sticky',
                top: 0,
                zIndex: 100,
                color: 'white'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ background: 'white', padding: '4px', borderRadius: '10px' }}>
                        <img src="/img/logo.png" alt="Logo" style={{ height: '35px', display: 'block' }} />
                    </div>
                    <div>
                        <h1 style={{ fontFamily: 'Nunito, sans-serif', fontSize: '1.3rem', color: 'white', margin: 0, letterSpacing: '0.02em' }}>{title}</h1>
                        <p style={{ fontSize: '0.65rem', margin: 0, fontWeight: 700, textTransform: 'uppercase', opacity: 0.8 }}>Gestión Institucional</p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button
                        onClick={abrirPerfil}
                        title="Ver mi perfil"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', padding: 0 }}
                    >
                        <p style={{ fontSize: '0.85rem', fontWeight: 800, margin: 0, color: 'white' }}>{user?.nombre}</p>
                        <p style={{ fontSize: '0.65rem', margin: 0, textTransform: 'uppercase', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{user?.rol} · Mi Perfil</p>
                    </button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => navigate('/')} className="btn" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.75rem', padding: '8px 16px' }}>Inicio</button>
                        <button onClick={handleLogout} className="btn" style={{ background: 'var(--orange)', color: 'white', fontSize: '0.75rem', padding: '8px 16px', boxShadow: '0 4px 10px rgba(245,130,13,0.3)' }}>Cerrar Sesión</button>
                    </div>
                </div>
            </header>

            {/* Contenido Principal */}
            <main style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
                {children}
            </main>

            {/* Modal Mi Perfil (solo lectura) */}
            {perfilOpen && (
                <div style={modalOverlay} onClick={() => setPerfilOpen(false)}>
                    <div style={modalContent} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.25rem', color: 'var(--blue)', fontWeight: 800, margin: 0 }}>Mi Perfil</h2>
                            <button onClick={() => setPerfilOpen(false)} style={closeBtn}>&times;</button>
                        </div>

                        {perfilLoading && <p style={{ color: '#64748b' }}>Cargando...</p>}
                        {!perfilLoading && perfilError && <p style={{ color: '#dc2626' }}>{perfilError}</p>}

                        {!perfilLoading && !perfilError && perfil && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={infoBox}>
                                    <span style={labelStyle}>Nombre completo</span>
                                    <span style={valueStyle}>{perfil.nombre || '-'}</span>
                                </div>
                                <div style={infoBox}>
                                    <span style={labelStyle}>Usuario / Correo</span>
                                    <span style={valueStyle}>{perfil.username || '-'}</span>
                                </div>
                                <div style={infoBox}>
                                    <span style={labelStyle}>Rol</span>
                                    <span style={valueStyle}>{perfil.rol ? perfil.rol.charAt(0).toUpperCase() + perfil.rol.slice(1) : '-'}</span>
                                </div>
                                <div style={infoBox}>
                                    <span style={labelStyle}>Miembro desde</span>
                                    <span style={valueStyle}>{perfil.created_at ? new Date(perfil.created_at).toLocaleDateString('es-AR') : '-'}</span>
                                </div>

                                {faltanDatos && (
                                    <div style={avisoStyle}>
                                        Tu legajo todavía no tiene todos los datos cargados. Si algo no es correcto, comunicate con la institución.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal de confirmación de cierre de sesión (RNF08) */}
            {logoutConfirmOpen && (
                <ConfirmModal
                    title="Cerrar sesión"
                    message="¿Estás seguro de que deseas cerrar la sesión?"
                    confirmLabel="Sí, cerrar sesión"
                    onCancel={() => setLogoutConfirmOpen(false)}
                    onConfirm={confirmarLogout}
                />
            )}
        </div>
    );
};

const modalOverlay = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalContent = { background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '440px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' };
const closeBtn = { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' };
const infoBox = { display: 'flex', flexDirection: 'column', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' };
const labelStyle = { fontSize: '0.7rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 };
const valueStyle = { fontSize: '1rem', fontWeight: 800, color: 'var(--text)' };
const avisoStyle = { padding: '12px', borderLeft: '4px solid var(--orange)', background: '#fff7ed', borderRadius: '0 8px 8px 0', fontSize: '0.85rem', color: '#7c2d12' };

export default DashboardLayout;
