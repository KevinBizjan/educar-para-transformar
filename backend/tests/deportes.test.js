// Reglas puras de los deportes por grupo y del transporte: no usan la base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_RECORRIDOS, nombreDia, validarHorarioGrupo, seSuperponen, describirHorario } = require('../src/utils/deportes');

const grupo = (dia, inicio, fin) => ({ dia_semana: dia, hora_inicio: inicio, hora_fin: fin });

describe('Deportes por grupo', () => {
    it('el transporte tiene cuatro recorridos', () => {
        assert.equal(MAX_RECORRIDOS, 4);
    });

    it('valida el día y las horas del grupo', () => {
        assert.equal(validarHorarioGrupo(1, '16:00', '17:30'), '');
        assert.equal(validarHorarioGrupo(7, '00:00', '23:59'), '');
        assert.match(validarHorarioGrupo(0, '16:00', '17:00'), /día/);
        assert.match(validarHorarioGrupo(8, '16:00', '17:00'), /día/);
        assert.match(validarHorarioGrupo(1.5, '16:00', '17:00'), /día/);
        assert.match(validarHorarioGrupo(1, '9:00', '17:00'), /HH:MM/);
        assert.match(validarHorarioGrupo(1, '16:00', '25:00'), /HH:MM/);
        assert.match(validarHorarioGrupo(1, '16:00', undefined), /HH:MM/);
        assert.match(validarHorarioGrupo(1, '17:00', '16:00'), /anterior/);
        assert.match(validarHorarioGrupo(1, '16:00', '16:00'), /anterior/);
    });

    it('dos grupos se superponen si comparten día y se pisan en el horario', () => {
        assert.equal(seSuperponen(grupo(1, '16:00', '17:00'), grupo(1, '16:30', '17:30')), true);
        assert.equal(seSuperponen(grupo(1, '16:00', '18:00'), grupo(1, '16:30', '17:00')), true, 'uno dentro del otro');
        assert.equal(seSuperponen(grupo(1, '16:00', '17:00'), grupo(1, '16:00', '17:00')), true, 'idénticos');
        assert.equal(seSuperponen(grupo(1, '16:30', '17:30'), grupo(1, '16:00', '17:00')), true, 'simétrico');
    });

    it('un grupo a continuación del otro, o en otro día, no se superpone', () => {
        assert.equal(seSuperponen(grupo(1, '16:00', '17:00'), grupo(1, '17:00', '18:00')), false);
        assert.equal(seSuperponen(grupo(1, '17:00', '18:00'), grupo(1, '16:00', '17:00')), false);
        assert.equal(seSuperponen(grupo(1, '16:00', '17:00'), grupo(2, '16:00', '17:00')), false);
    });

    it('describe el horario en palabras', () => {
        assert.equal(describirHorario(grupo(3, '17:00', '18:30')), 'miércoles 17:00 a 18:30');
        assert.equal(nombreDia(6), 'sábado');
        assert.equal(nombreDia(9), '');
    });
});
