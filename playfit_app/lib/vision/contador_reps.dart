import 'dart:math' as math;

/// Punto 2D del cuerpo (en píxeles de la imagen) con la confianza (0 a 1) con que ML Kit lo detectó.
class Pt {
  final double x;
  final double y;
  final double conf;
  const Pt(this.x, this.y, this.conf);
}

/// Ángulo en grados (0 a 180) en el punto [b], formado por los segmentos b→a y b→c.
/// Ejemplo: cadera (a), rodilla (b), tobillo (c) = ángulo de la rodilla. Devuelve null si los puntos coinciden.
double? anguloEn(Pt a, Pt b, Pt c) {
  final v1x = a.x - b.x;
  final v1y = a.y - b.y;
  final v2x = c.x - b.x;
  final v2y = c.y - b.y;
  final m1 = math.sqrt(v1x * v1x + v1y * v1y);
  final m2 = math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return null;
  final cos = ((v1x * v2x + v1y * v2y) / (m1 * m2)).clamp(-1.0, 1.0).toDouble();
  return math.acos(cos) * 180 / math.pi;
}

/// De varias ternas (extremo, articulación, extremo) —por ejemplo lado izquierdo y derecho— devuelve el MENOR ángulo
/// entre las que se ven con confianza suficiente. Si ninguna se ve bien devuelve null.
/// Se usa el menor porque la pierna o el brazo que trabaja es el más flexionado (el otro puede estar tapado o quieto).
double? mejorAngulo(List<List<Pt?>> ternas, {double minConf = 0.5}) {
  double? mejor;
  for (final t in ternas) {
    if (t.length != 3) continue;
    final a = t[0];
    final b = t[1];
    final c = t[2];
    if (a == null || b == null || c == null) continue;
    if (a.conf < minConf || b.conf < minConf || c.conf < minConf) continue;
    final ang = anguloEn(a, b, c);
    if (ang == null) continue;
    if (mejor == null || ang < mejor) mejor = ang;
  }
  return mejor;
}

enum Articulacion { rodilla, codo }

/// Cómo se reconoce una repetición de un ejercicio: qué articulación mirar y entre qué ángulos.
class EjercicioCamara {
  final Articulacion articulacion;

  /// Por debajo de este ángulo la articulación se considera flexionada (abajo en la sentadilla, arriba en el curl).
  final double flexionado;

  /// Por encima de este ángulo se considera extendida.
  final double extendido;

  /// Cómo colocar el celular y el cuerpo para que se detecte bien.
  final String indicacion;
  const EjercicioCamara({required this.articulacion, required this.flexionado, required this.extendido, required this.indicacion});
}

/// Ejercicios con conteo automático, por `slug`. Los demás (p. ej. burpees) se cuentan a mano.
const Map<String, EjercicioCamara> kEjerciciosCamara = <String, EjercicioCamara>{
  'sentadilla': EjercicioCamara(
    articulacion: Articulacion.rodilla,
    flexionado: 110,
    extendido: 155,
    indicacion: 'Apoya el celular a unos 2 m, de lado o en diagonal, y que se vea tu cuerpo completo de cabeza a pies.',
  ),
  'zancadas': EjercicioCamara(
    articulacion: Articulacion.rodilla,
    flexionado: 110,
    extendido: 155,
    indicacion: 'Apoya el celular a unos 2 m, de lado, con tu cuerpo completo a la vista.',
  ),
  'flexiones': EjercicioCamara(
    articulacion: Articulacion.codo,
    flexionado: 100,
    extendido: 150,
    indicacion: 'Pon el celular en el piso, de lado, a 1,5 o 2 m, de modo que se vean tus hombros, codos y manos.',
  ),
  'press-militar': EjercicioCamara(
    articulacion: Articulacion.codo,
    flexionado: 100,
    extendido: 155,
    indicacion: 'Colócate de frente al celular, a unos 2 m, con brazos y cabeza a la vista (la barra o mancuernas no deben taparte los codos).',
  ),
  'curl-biceps': EjercicioCamara(
    articulacion: Articulacion.codo,
    flexionado: 70,
    extendido: 140,
    indicacion: 'Colócate de frente o de lado, a unos 2 m, con brazos y torso a la vista. Haz el movimiento con ambos brazos o con uno solo.',
  ),
};

enum _Fase { desconocida, extendido, flexionado }

/// Cuenta repeticiones a partir de una señal de ángulo. Una repetición se cuenta cuando la articulación estuvo
/// flexionada y vuelve a extenderse (subir de la sentadilla, estirar el brazo en el curl, empujar en la flexión…).
/// Usa dos umbrales distintos (histéresis) y un tiempo mínimo entre repeticiones para ignorar temblores del detector.
class ContadorReps {
  final EjercicioCamara cfg;
  final int minMsEntreReps;
  final double suavizado; // peso de la medida nueva (0 a 1); más alto = reacciona más rápido
  int reps = 0;
  double? _angulo;
  _Fase _fase = _Fase.desconocida;
  DateTime? _ultimaRep;

  ContadorReps(this.cfg, {this.minMsEntreReps = 700, this.suavizado = 0.45});

  /// Ángulo suavizado actual (para mostrarlo al ajustar), o null si aún no hay medidas.
  double? get angulo => _angulo;

  /// true si en este momento la articulación está flexionada (para dar retroalimentación en pantalla).
  bool get flexionada => _fase == _Fase.flexionado;

  /// Procesa una medida de ángulo. Devuelve true si con ella se completó una repetición.
  bool actualizar(double medida, {DateTime? ahora}) {
    final a = _angulo == null ? medida : _angulo! * (1 - suavizado) + medida * suavizado;
    _angulo = a;
    if (a <= cfg.flexionado) {
      _fase = _Fase.flexionado;
      return false;
    }
    if (a >= cfg.extendido) {
      final veniaFlexionado = _fase == _Fase.flexionado;
      _fase = _Fase.extendido;
      if (veniaFlexionado) {
        final t = ahora ?? DateTime.now();
        if (_ultimaRep == null || t.difference(_ultimaRep!).inMilliseconds >= minMsEntreReps) {
          reps++;
          _ultimaRep = t;
          return true;
        }
      }
    }
    return false;
  }

  /// Se llama cuando el cuerpo deja de verse: se olvida la fase para no contar de más al volver a entrar en cuadro.
  void perdido() {
    _fase = _Fase.desconocida;
    _angulo = null;
  }

  /// Suma o resta repeticiones a mano (corrección del usuario). Nunca baja de 0.
  void ajustar(int delta) {
    reps = math.max(0, reps + delta);
  }
}
