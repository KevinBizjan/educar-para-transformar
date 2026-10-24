// Cliente de Supabase para la app móvil: SOLO Storage (comprobantes de pago, HU8).
// No se usa Supabase Auth: el login y los datos van por la API REST del backend.
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const BUCKET_COMPROBANTES = 'comprobantes';

export const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    : null;
