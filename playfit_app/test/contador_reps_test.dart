import 'package:flutter_test/flutter_test.dart';
import 'package:playfit_app/vision/contador_reps.dart';

/// Una repetición ideal: baja de [hi] a [lo] y vuelve a [hi] en 2*[pasos] medidas.
List<double> _rep({double lo = 80, double hi = 170, int pasos = 8}) => <double>[
      for (var i = 0; i <= pasos; i++) hi - (hi - lo) * i / pasos,
      for (var i = 1; i <= pasos; i++) lo + (hi - lo) * i / pasos,
    ];

int _correr(ContadorReps c, List<double> seq, {int dtMs = 100}) {
  final base = DateTime(2026, 1, 1);
  for (var i = 0; i < seq.length; i++) {
    c.actualizar(seq[i], ahora: base.add(Duration(milliseconds: dtMs * i)));
  }
  return c.reps;
}

ContadorReps _sentadilla({double suavizado = 0.45}) => ContadorReps(kEjerciciosCamara['sentadilla']!, suavizado: suavizado);

void main() {
  group('anguloEn', () {
    test('ángulo recto, llano y agudo', () {
      expect(anguloEn(const Pt(0, 0, 1), const Pt(0, 1, 1), const Pt(1, 1, 1)), closeTo(90, 1e-9));
      expect(anguloEn(const Pt(0, 0, 1), const Pt(0, 1, 1), const Pt(0, 2, 1)), closeTo(180, 1e-9));
      expect(anguloEn(const Pt(0, 0, 1), const Pt(0, 1, 1), const Pt(1, 0, 1)), closeTo(45, 1e-9));
    });

    test('puntos que coinciden no dan ángulo', () {
      expect(anguloEn(const Pt(1, 1, 1), const Pt(1, 1, 1), const Pt(2, 2, 1)), isNull);
    });
  });

  group('mejorAngulo', () {
    const recto = <Pt?>[Pt(0, 0, 0.9), Pt(0, 1, 0.9), Pt(1, 1, 0.9)]; // 90°
    const llano = <Pt?>[Pt(0, 0, 0.9), Pt(0, 1, 0.9), Pt(0, 2, 0.9)]; // 180°

    test('elige el menor ángulo entre los lados visibles', () {
      expect(mejorAngulo(<List<Pt?>>[recto, llano]), closeTo(90, 1e-9));
    });

    test('ignora los puntos con poca confianza', () {
      const tapado = <Pt?>[Pt(0, 0, 0.9), Pt(0, 1, 0.2), Pt(1, 0, 0.9)]; // 45° pero poco confiable
      expect(mejorAngulo(<List<Pt?>>[tapado, llano]), closeTo(180, 1e-9));
    });

    test('devuelve null si no se ve nada con confianza o faltan puntos', () {
      const tapado = <Pt?>[Pt(0, 0, 0.9), Pt(0, 1, 0.2), Pt(1, 0, 0.9)];
      const incompleto = <Pt?>[Pt(0, 0, 0.9), null, Pt(1, 0, 0.9)];
      expect(mejorAngulo(<List<Pt?>>[tapado, incompleto]), isNull);
      expect(mejorAngulo(<List<Pt?>>[]), isNull);
    });
  });

  group('ContadorReps', () {
    test('una repetición: flexiona y vuelve a extender', () {
      expect(_correr(_sentadilla(suavizado: 1), <double>[170, 160, 120, 100, 120, 160, 170], dtMs: 1000), 1);
    });

    test('dos repeticiones seguidas', () {
      expect(_correr(_sentadilla(suavizado: 1), <double>[170, 100, 170, 100, 170], dtMs: 1000), 2);
    });

    test('tres sentadillas completas con el suavizado normal', () {
      expect(_correr(_sentadilla(), <double>[..._rep(), ..._rep(), ..._rep(), 170, 170, 170, 170]), 3);
    });

    test('media sentadilla (no baja lo suficiente) no cuenta', () {
      expect(_correr(_sentadilla(), <double>[..._rep(lo: 130), ..._rep(lo: 130), 170, 170, 170, 170]), 0);
    });

    test('flexiona pero no extiende del todo: no cuenta', () {
      expect(_correr(_sentadilla(suavizado: 1), <double>[170, 100, 150, 100, 150]), 0);
    });

    test('quedarse de pie, o temblar en la zona intermedia, no cuenta', () {
      expect(_correr(_sentadilla(), <double>[170, 172, 168, 171, 169, 170, 172]), 0);
      expect(_correr(_sentadilla(suavizado: 1), <double>[170, 130, 150, 130, 150, 170]), 0);
    });

    test('una repetición real con ruido de ±6° cuenta una sola vez', () {
      final base = <double>[..._rep(), 170, 170, 170, 170];
      final ruido = <double>[for (var i = 0; i < base.length; i++) (base[i] + (i.isOdd ? 6 : -6)).clamp(60.0, 180.0).toDouble()];
      expect(_correr(_sentadilla(), ruido), 1);
    });

    test('cinco repeticiones con pausas entre ellas', () {
      final seq = <double>[for (var k = 0; k < 5; k++) ..._rep(), 170, 170, 170, 170];
      expect(_correr(_sentadilla(), seq), 5);
    });

    test('dos cruces en menos de 700 ms cuentan una sola repetición', () {
      expect(_correr(_sentadilla(suavizado: 1), <double>[170, 100, 170, 100, 170], dtMs: 100), 1);
    });

    test('si empieza abajo y sube, cuenta esa subida', () {
      expect(_correr(_sentadilla(), <double>[90, 95, 100, 120, 150, 170, 172, 172]), 1);
    });

    test('perdido() olvida la fase: volver a entrar en cuadro de pie no cuenta', () {
      final c = _sentadilla(suavizado: 1);
      _correr(c, <double>[170, 100]);
      c.perdido();
      expect(_correr(c, <double>[170, 172]), 0);
    });

    test('curl de bíceps: usa sus propios umbrales', () {
      final c = ContadorReps(kEjerciciosCamara['curl-biceps']!, suavizado: 1);
      expect(_correr(c, <double>[165, 60, 165, 60, 165], dtMs: 1000), 2);
    });

    test('ajustar suma y resta a mano, sin bajar de cero', () {
      final c = _sentadilla();
      c.ajustar(2);
      c.ajustar(-1);
      expect(c.reps, 1);
      c.ajustar(-5);
      expect(c.reps, 0);
    });
  });

  group('ejercicios con cámara', () {
    test('cada uno tiene umbrales coherentes e indicación', () {
      expect(kEjerciciosCamara.keys, containsAll(<String>['sentadilla', 'zancadas', 'flexiones', 'press-militar', 'curl-biceps']));
      for (final e in kEjerciciosCamara.values) {
        expect(e.flexionado, lessThan(e.extendido));
        expect(e.indicacion, isNotEmpty);
      }
    });

    test('los burpees no tienen conteo automático (se cuentan a mano)', () {
      expect(kEjerciciosCamara.containsKey('burpees'), isFalse);
    });
  });
}
