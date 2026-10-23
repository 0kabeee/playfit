// Utilidades: conversion segura de JSON y formatos de fecha/nombre.

Map<String, dynamic> asMap(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Map<String, dynamic>> asList(dynamic v) =>
    v is List ? v.map((e) => asMap(e)).toList() : <Map<String, dynamic>>[];

num asNum(dynamic v, [num fallback = 0]) {
  if (v is num) return v;
  if (v is String) return num.tryParse(v) ?? fallback;
  return fallback;
}

int asInt(dynamic v, [int fallback = 0]) => asNum(v, fallback).toInt();

String asStr(dynamic v, [String fallback = '']) => v == null ? fallback : v.toString();

bool asBool(dynamic v) => v == true || v == 1 || v == '1';

class Fmt {
  /// "Camila Reyes" -> "CR"
  static String initials(String nombre, [String apellido = '']) {
    final partes = ('$nombre $apellido').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (partes.isEmpty) return '?';
    if (partes.length == 1) return partes[0].substring(0, 1).toUpperCase();
    return (partes[0].substring(0, 1) + partes[1].substring(0, 1)).toUpperCase();
  }

  /// Para ver a otros estudiantes: nombre + inicial del apellido ("Camila R.")
  static String shortName(String nombre, String apellido) {
    final a = apellido.trim();
    return a.isEmpty ? nombre : '$nombre ${a.substring(0, 1).toUpperCase()}.';
  }

  /// "2026-10-05 14:30:00" (UTC) -> DateTime local
  static DateTime? parseUtc(String? s) {
    if (s == null || s.isEmpty) return null;
    try {
      return DateTime.parse('${s.replaceFirst(' ', 'T')}Z').toLocal();
    } catch (_) {
      return null;
    }
  }

  /// "Hace 20 min", "Hace 3 h", "Ayer", "Hace 4 días", "05/10"
  static String relative(String? utc) {
    final d = parseUtc(utc);
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 1) return 'Ahora';
    if (diff.inMinutes < 60) return 'Hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Hace ${diff.inHours} h';
    if (diff.inDays == 1) return 'Ayer';
    if (diff.inDays < 7) return 'Hace ${diff.inDays} días';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  }

  /// Hora actual en Colombia (UTC-5, sin horario de verano). El servidor cuenta los dias en esta zona,
  /// asi que la app NO depende de la zona horaria del telefono ni del emulador.
  static DateTime bogotaNow() => DateTime.now().toUtc().subtract(const Duration(hours: 5));

  /// "2026-10-05" -> "Hoy" / "Ayer" / "05/10"
  static String dayLabel(String? yyyyMmDd) {
    if (yyyyMmDd == null || yyyyMmDd.length < 10) return '';
    final f = DateTime.tryParse(yyyyMmDd.substring(0, 10));
    if (f == null) return yyyyMmDd;
    final hoy = bogotaNow();
    final h = DateTime.utc(hoy.year, hoy.month, hoy.day);
    final dias = h.difference(DateTime.utc(f.year, f.month, f.day)).inDays;
    if (dias == 0) return 'Hoy';
    if (dias == 1) return 'Ayer';
    if (dias > 1 && dias < 7) return 'Hace $dias días';
    return '${f.day.toString().padLeft(2, '0')}/${f.month.toString().padLeft(2, '0')}';
  }

  /// Fecha de hoy en Colombia como "YYYY-MM-DD"
  static String todayIso() {
    final n = bogotaNow();
    return '${n.year.toString().padLeft(4, '0')}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
  }

  static String kg(num v) => v == v.roundToDouble() ? '${v.toInt()} kg' : '${v.toStringAsFixed(1)} kg';

  static String capitalize(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  /// Codigo de flag clinico -> etiqueta amigable
  static String flagLabel(String code) {
    switch (code) {
      case 'LESION_RODILLA':
        return 'Lesión de rodilla · evitar impacto';
      case 'LESION_HOMBRO':
        return 'Lesión de hombro · evitar empujes sobre la cabeza';
      case 'LESION_ESPALDA_BAJA':
        return 'Espalda baja · evitar carga axial';
      case 'HIPERTENSION':
        return 'Presión arterial · evitar esfuerzos máximos';
      case 'ASMA_EJERCICIO':
        return 'Asma · cuidar el cardio intenso';
      case 'RESTRICCION_IMPACTO':
        return 'Restricción de impacto · evitar saltos';
      case 'SIN_RESTRICCIONES':
        return 'Sin restricciones';
      default:
        return code;
    }
  }
}

// ---- retos y duelos: unidad, icono y color segun la metrica ----
String metricUnit(String metrica) {
  switch (metrica) {
    case 'reps':
      return 'repeticiones';
    case 'sesiones':
      return 'sesiones';
    case 'peso_maximo':
      return 'kg';
    default:
      return 'días activos';
  }
}

String metricLabel(String metrica) {
  switch (metrica) {
    case 'reps':
      return 'Repeticiones';
    case 'sesiones':
      return 'Sesiones';
    case 'peso_maximo':
      return 'Peso máximo';
    default:
      return 'Días activos';
  }
}

String metricIcon(String metrica) {
  switch (metrica) {
    case 'reps':
      return 'dumbbell';
    case 'sesiones':
      return 'flame';
    case 'peso_maximo':
      return 'target';
    default:
      return 'trophy';
  }
}

String metricTone(String metrica) {
  switch (metrica) {
    case 'reps':
      return 'blue';
    case 'sesiones':
      return 'orange';
    case 'peso_maximo':
      return 'green';
    default:
      return 'purple';
  }
}

String tipoRetoLabel(String tipo, {bool deSquad = false}) {
  if (deSquad) return tipo == 'squad' ? 'Reto del squad · meta entre todos' : 'Reto del squad · cada uno';
  switch (tipo) {
    case 'squad':
      return 'Reto de squad';
    default:
      return 'Reto individual';
  }
}

/// XP que da un reto creado en el squad (la fija el servidor: 50 + 10 por dia, maximo 300). Solo para mostrarla antes de crear.
int xpRetoSquad(int dias) => (50 + 10 * dias).clamp(0, 300).toInt();

/// Color del anillo del avatar segun la racha: dorado (10+), verde (5+), gris.
String? ringForStreak(int racha) => racha >= 10 ? 'gold' : (racha >= 5 ? 'green' : 'grey');
