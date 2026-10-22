import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:google_mlkit_pose_detection/google_mlkit_pose_detection.dart';

import '../common.dart';
import '../vision/contador_reps.dart';
import 'sesiones.dart';

enum _Estado { iniciando, listo, permisoDenegado, sinCamara, error, manual }

/// Práctica con conteo de repeticiones.
///
/// Si el ejercicio tiene conteo automático (ver [kEjerciciosCamara]) se abre la cámara y ML Kit detecta tu cuerpo
/// para contar solo; si no, o si la cámara no está disponible, el conteo es manual con los botones.
/// El video NO se guarda ni se envía a ningún lado: cada imagen se analiza en el celular y se descarta.
class CamaraConteoScreen extends StatefulWidget {
  final int ejercicioId;
  final String nombre;
  final String slug;
  const CamaraConteoScreen({super.key, required this.ejercicioId, required this.nombre, required this.slug});

  @override
  State<CamaraConteoScreen> createState() => _CamaraConteoScreenState();
}

class _CamaraConteoScreenState extends State<CamaraConteoScreen> with WidgetsBindingObserver {
  static const Map<DeviceOrientation, int> _orientaciones = <DeviceOrientation, int>{
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  late final EjercicioCamara? _cfg = kEjerciciosCamara[widget.slug];

  PoseDetector? _detector;
  CameraController? _ctrl;
  CameraDescription? _camara;
  List<CameraDescription>? _camaras;
  ContadorReps? _contador;

  _Estado _estado = _Estado.iniciando;
  bool _frontal = true; // con el celular apoyado de frente a ti, ves la pantalla mientras haces el ejercicio
  bool _iniciando = false;
  bool _busy = false;
  bool _contando = false;
  int? _cuenta; // cuenta regresiva 3..1 antes de empezar
  int _reps = 0; // repeticiones de la serie actual
  int _repsAuto = 0; // cuántas de esas las contó la cámara
  bool _ajustado = false; // el usuario sumó o restó a mano
  bool _visible = false; // se ve la articulación con buena confianza
  int _sinPose = 0; // cuadros seguidos sin detectar ninguna persona
  int _sinAngulo = 0; // cuadros seguidos sin una medida confiable de la articulación
  int _rotExtra = 0; // corrección automática de la orientación de la imagen si nunca se detecta a nadie
  double? _anguloDebug;

  // Series ya terminadas en esta práctica (repeticiones y quién las contó), para guardarlas juntas.
  final List<int> _series = <int>[];
  final List<String> _fuentes = <String>[];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    SystemChrome.setPreferredOrientations(<DeviceOrientation>[DeviceOrientation.portraitUp]);
    final cfg = _cfg;
    if (cfg == null) {
      _estado = _Estado.manual;
    } else {
      _detector = PoseDetector(options: PoseDetectorOptions());
      _contador = ContadorReps(cfg);
      _initCamera();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    _cuenta = null;
    _liberarCamara();
    _detector?.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_cfg == null) return;
    if (state == AppLifecycleState.paused) {
      _liberarCamara();
      if (mounted && _estado == _Estado.listo) setState(() => _estado = _Estado.iniciando);
    } else if (state == AppLifecycleState.resumed && _ctrl == null && _estado != _Estado.permisoDenegado) {
      _initCamera();
    }
  }

  // ------------------------------------------------------------------ cámara
  Future<void> _initCamera() async {
    if (_iniciando || _cfg == null) return;
    _iniciando = true;
    if (mounted) setState(() => _estado = _Estado.iniciando);
    try {
      _camaras ??= await availableCameras();
      final lista = _camaras!;
      if (lista.isEmpty) {
        if (mounted) setState(() => _estado = _Estado.sinCamara);
        return;
      }
      final deseada = _frontal ? CameraLensDirection.front : CameraLensDirection.back;
      final cam = lista.firstWhere((c) => c.lensDirection == deseada, orElse: () => lista.first);
      final ctrl = CameraController(
        cam,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21, // el formato que ML Kit espera en Android
      );
      await ctrl.initialize();
      if (!mounted) {
        await ctrl.dispose();
        return;
      }
      await ctrl.startImageStream(_onFrame);
      _camara = cam;
      _ctrl = ctrl;
      _rotExtra = 0;
      _sinPose = 0;
      _sinAngulo = 0;
      _visible = false;
      setState(() => _estado = _Estado.listo);
    } on CameraException catch (e) {
      if (!mounted) return;
      setState(() => _estado = e.code.startsWith('CameraAccess') ? _Estado.permisoDenegado : _Estado.error);
    } catch (_) {
      if (mounted) setState(() => _estado = _Estado.error);
    } finally {
      _iniciando = false;
    }
  }

  Future<void> _liberarCamara() async {
    final c = _ctrl;
    _ctrl = null;
    if (c == null) return;
    try {
      if (c.value.isStreamingImages) await c.stopImageStream();
    } catch (_) {}
    try {
      await c.dispose();
    } catch (_) {}
  }

  Future<void> _cambiarCamara() async {
    if (_contando || _cuenta != null) return;
    _frontal = !_frontal;
    await _liberarCamara();
    await _initCamera();
  }

  // ------------------------------------------------------------------ detección
  InputImage? _aInputImage(CameraImage image) {
    final cam = _camara;
    final ctrl = _ctrl;
    if (cam == null || ctrl == null) return null;
    var comp = _orientaciones[ctrl.value.deviceOrientation];
    if (comp == null) return null;
    final sensor = cam.sensorOrientation;
    if (cam.lensDirection == CameraLensDirection.front) {
      comp = (sensor + comp) % 360;
    } else {
      comp = (sensor - comp + 360) % 360;
    }
    comp = (comp + _rotExtra) % 360;
    final rotation = InputImageRotationValue.fromRawValue(comp);
    if (rotation == null) return null;
    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null || format != InputImageFormat.nv21 || image.planes.length != 1) return null;
    final plane = image.planes.first;
    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: plane.bytesPerRow,
      ),
    );
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_busy) return; // un cuadro a la vez: los que llegan mientras se analiza otro se descartan
    final det = _detector;
    if (det == null || !mounted) return;
    _busy = true;
    try {
      final input = _aInputImage(image);
      if (input == null) return;
      final poses = await det.processImage(input);
      if (!mounted) return;
      _procesar(poses);
    } catch (_) {
      // un cuadro que falla simplemente se ignora
    } finally {
      _busy = false;
    }
  }

  void _procesar(List<Pose> poses) {
    final cfg = _cfg;
    final contador = _contador;
    if (cfg == null || contador == null) return;

    double? angulo;
    if (poses.isEmpty) {
      _sinPose++;
      // Si nunca aparece nadie, quizá la imagen llega girada: se prueba otra orientación cada ~25 cuadros.
      if (_sinPose % 25 == 0) _rotExtra = (_rotExtra + 90) % 360;
    } else {
      _sinPose = 0;
      final p = poses.first;
      Pt? pt(PoseLandmarkType t) {
        final l = p.landmarks[t];
        return l == null ? null : Pt(l.x, l.y, l.likelihood);
      }

      final List<List<Pt?>> ternas = cfg.articulacion == Articulacion.rodilla
          ? <List<Pt?>>[
              <Pt?>[pt(PoseLandmarkType.leftHip), pt(PoseLandmarkType.leftKnee), pt(PoseLandmarkType.leftAnkle)],
              <Pt?>[pt(PoseLandmarkType.rightHip), pt(PoseLandmarkType.rightKnee), pt(PoseLandmarkType.rightAnkle)],
            ]
          : <List<Pt?>>[
              <Pt?>[pt(PoseLandmarkType.leftShoulder), pt(PoseLandmarkType.leftElbow), pt(PoseLandmarkType.leftWrist)],
              <Pt?>[pt(PoseLandmarkType.rightShoulder), pt(PoseLandmarkType.rightElbow), pt(PoseLandmarkType.rightWrist)],
            ];
      angulo = mejorAngulo(ternas);
    }

    var cambio = false;
    if (angulo == null) {
      if (_visible) {
        _visible = false;
        cambio = true;
      }
      _sinAngulo++;
      if (_sinAngulo == 12) contador.perdido(); // ~1 s sin verte: se olvida la fase para no contar de más al volver
    } else {
      _sinAngulo = 0;
      if (!_visible) {
        _visible = true;
        cambio = true;
      }
      if (_contando) {
        if (contador.actualizar(angulo)) {
          _reps = contador.reps;
          _repsAuto++;
          HapticFeedback.lightImpact();
          cambio = true;
        }
      }
    }
    if (kDebugMode) {
      _anguloDebug = angulo;
      cambio = true;
    }
    if (cambio && mounted) setState(() {});
  }

  // ------------------------------------------------------------------ flujo de la serie
  Future<void> _iniciar() async {
    final cfg = _cfg;
    if (cfg == null) {
      setState(() {
        _contador = null;
        _reps = 0;
        _repsAuto = 0;
        _ajustado = false;
        _contando = true;
      });
      return;
    }
    if (_estado == _Estado.listo) {
      for (var i = 3; i > 0; i--) {
        if (!mounted) return;
        setState(() => _cuenta = i);
        await Future<void>.delayed(const Duration(seconds: 1));
        if (!mounted || _cuenta == null) return; // se canceló
      }
    }
    if (!mounted) return;
    setState(() {
      _cuenta = null;
      _contador = ContadorReps(cfg);
      _reps = 0;
      _repsAuto = 0;
      _ajustado = false;
      _contando = true;
    });
  }

  void _cancelarCuenta() => setState(() => _cuenta = null);

  void _ajustar(int delta) {
    setState(() {
      _ajustado = true;
      final c = _contador;
      if (c != null) {
        c.ajustar(delta);
        _reps = c.reps;
      } else {
        _reps = _reps + delta < 0 ? 0 : _reps + delta;
      }
    });
  }

  String get _fuenteActual => (_repsAuto > 0 && !_ajustado) ? 'camara' : 'manual';

  Future<void> _detener() async {
    setState(() {
      _contando = false;
      _cuenta = null;
    });
    if (_reps == 0) return;
    final reps = _reps;
    final numSerie = _series.length + 1;
    String tip = 'Mantén la espalda neutra y controla la bajada en cada repetición.';
    try {
      final r = asMap(await app.api.get('/api/content/exercises/${widget.ejercicioId}/tip'));
      final t = asMap(r['tip']);
      if (asStr(t['texto']).isNotEmpty) tip = asStr(t['texto']);
    } catch (_) {}
    if (!mounted) return;
    final puedeOtra = _series.length + 1 < 10;
    final accion = await showPfSheet<String>(
      context,
      (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Mascot('vamos', size: 70),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('¡$reps repeticiones!', style: Tx.display(size: 21)),
                    Text('Serie $numSerie', style: Tx.body(size: 12.5, color: C.inkSoft)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text('CONSEJO RÁPIDO', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkMute, letter: 0.5)),
          const SizedBox(height: 4),
          Text(tip, style: Tx.body(size: 13.5, height: 1.5)),
          const SizedBox(height: 10),
          const PanelNote('Orientación educativa: no reemplaza a un entrenador certificado.', icon: 'shield-check'),
          const SizedBox(height: 6),
          PfButton(numSerie == 1 ? 'Guardar como sesión' : 'Guardar sesión ($numSerie series)', kind: BtnKind.gold, icon: 'check', onPressed: () => Navigator.pop(ctx, 'guardar')),
          if (puedeOtra) ...[
            const SizedBox(height: 10),
            PfButton('Hacer otra serie', kind: BtnKind.secondary, icon: 'plus', onPressed: () => Navigator.pop(ctx, 'otra')),
          ],
          const SizedBox(height: 10),
          PfButton('Descartar y salir', kind: BtnKind.secondary, onPressed: () => Navigator.pop(ctx, 'descartar')),
        ],
      ),
    );
    if (!mounted) return;
    switch (accion) {
      case 'guardar':
        _series.add(reps);
        _fuentes.add(_fuenteActual);
        await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
          builder: (_) => RegistrarSesionScreen(
            initialExerciseId: widget.ejercicioId,
            initialRepsList: List<int>.from(_series),
            initialFuentes: List<String>.from(_fuentes),
          ),
        ));
        break;
      case 'descartar':
        Navigator.of(context).maybePop();
        break;
      default: // 'otra', o la hoja se cerró sin elegir: la serie se conserva y se sigue
        setState(() {
          _series.add(reps);
          _fuentes.add(_fuenteActual);
          _reps = 0;
          _repsAuto = 0;
          _ajustado = false;
        });
    }
  }

  // ------------------------------------------------------------------ interfaz
  String get _estadoTexto {
    if (_cuenta != null) return 'Prepárate…';
    if (_contando) return _visible ? '● Contando' : 'No te veo bien';
    return _visible ? 'Te veo ✓' : 'Colócate frente a la cámara';
  }

  Widget _chip(String t) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: const Color(0x66000000), borderRadius: BorderRadius.circular(999)),
        child: Text(t, style: Tx.body(size: 11, w: FontWeight.w700, color: Colors.white)),
      );

  Widget _mensajeVisor(String icon, String titulo, String texto, {Widget? accion}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LIcon(icon, size: 34, color: Colors.white70),
            const SizedBox(height: 10),
            Text(titulo, textAlign: TextAlign.center, style: Tx.body(size: 15, w: FontWeight.w700, color: Colors.white)),
            const SizedBox(height: 6),
            Text(texto, textAlign: TextAlign.center, style: Tx.body(size: 12.5, color: Colors.white70, height: 1.4)),
            if (accion != null) ...[const SizedBox(height: 14), accion],
          ],
        ),
      ),
    );
  }

  Widget _contadorGrande() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$_reps', style: Tx.mono(size: 84, w: FontWeight.w700, color: C.gold)),
          Text('REPETICIONES', style: Tx.body(size: 11, w: FontWeight.w700, color: Colors.white70, letter: 1.2)),
        ],
      ),
    );
  }

  Widget _visor() {
    Widget contenido;
    switch (_estado) {
      case _Estado.manual:
        contenido = Stack(children: [
          Center(child: _contadorGrande()),
          Positioned(left: 14, top: 14, child: _chip(_contando ? '● Practicando' : 'Conteo manual')),
          const Positioned(right: 14, bottom: 10, child: Mascot('enfocado', size: 64)),
          Positioned(
            left: 18,
            right: 90,
            bottom: 16,
            child: Text('Para este ejercicio el conteo es manual: toca el botón en cada repetición.', style: Tx.body(size: 11, color: Colors.white60, height: 1.4)),
          ),
        ]);
        break;
      case _Estado.iniciando:
        contenido = _mensajeVisor('camera', 'Abriendo la cámara…', 'Si te pide permiso, acéptalo para poder contar tus repeticiones.');
        break;
      case _Estado.permisoDenegado:
        contenido = _mensajeVisor(
          'camera',
          'Sin permiso de cámara',
          'Sin la cámara no puedo contar solo. Puedes dar el permiso en Ajustes del celular › Apps › PlayFit, o contar a mano.',
          accion: PfButton('Reintentar', kind: BtnKind.gold, small: true, expand: false, onPressed: _initCamera),
        );
        break;
      case _Estado.sinCamara:
        contenido = _mensajeVisor('camera', 'No encuentro una cámara', 'Puedes contar tus repeticiones a mano con los botones.');
        break;
      case _Estado.error:
        contenido = _mensajeVisor(
          'triangle-alert',
          'No pude abrir la cámara',
          'Cierra otras apps que la usen e inténtalo de nuevo, o cuenta a mano.',
          accion: PfButton('Reintentar', kind: BtnKind.gold, small: true, expand: false, onPressed: _initCamera),
        );
        break;
      case _Estado.listo:
        final ctrl = _ctrl;
        final size = ctrl?.value.previewSize;
        if (ctrl == null || size == null) {
          contenido = const SizedBox.shrink();
          break;
        }
        contenido = Stack(
          fit: StackFit.expand,
          children: [
            FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              // el sensor entrega la imagen "acostada": en vertical el ancho y el alto se intercambian
              child: SizedBox(width: size.height, height: size.width, child: CameraPreview(ctrl)),
            ),
            Positioned(left: 14, top: 14, child: _chip(_estadoTexto)),
            if (_contando) Positioned(right: 14, top: 10, child: _repsPequeno()),
            if (_cuenta != null)
              Center(child: Text('$_cuenta', style: Tx.mono(size: 110, w: FontWeight.w700, color: Colors.white))),
            if (kDebugMode && _anguloDebug != null)
              Positioned(
                left: 14,
                bottom: 10,
                child: _chip('ángulo ${_anguloDebug!.toStringAsFixed(0)}° · giro extra $_rotExtra°'),
              ),
          ],
        );
        break;
    }
    return Container(
      height: 380,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: const Color(0xFF1B1713), borderRadius: BorderRadius.circular(C.rl)),
      child: contenido,
    );
  }

  Widget _repsPequeno() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(color: const Color(0x99000000), borderRadius: BorderRadius.circular(16)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$_reps', style: Tx.mono(size: 46, w: FontWeight.w700, color: C.gold)),
          Text('REPS', style: Tx.body(size: 10, w: FontWeight.w700, color: Colors.white70, letter: 1.2)),
        ],
      ),
    );
  }

  List<Widget> _controles() {
    final cfg = _cfg;
    if (_cuenta != null) {
      return [PfButton('Cancelar', kind: BtnKind.secondary, onPressed: _cancelarCuenta)];
    }
    if (_contando) {
      return [
        Row(
          children: [
            Expanded(child: PfButton('Restar 1', kind: BtnKind.secondary, onPressed: () => _ajustar(-1))),
            const SizedBox(width: 12),
            Expanded(child: PfButton('Sumar 1', kind: BtnKind.secondary, icon: 'plus', onPressed: () => _ajustar(1))),
          ],
        ),
        const SizedBox(height: 10),
        PfButton('Detener', kind: BtnKind.primary, onPressed: _detener),
        const SizedBox(height: 10),
        Text(
          _estado == _Estado.listo ? 'Si el conteo se equivoca, corrígelo con Sumar o Restar.' : 'Toca Sumar 1 en cada repetición.',
          textAlign: TextAlign.center,
          style: Tx.body(size: 11.5, color: C.inkMute),
        ),
      ];
    }
    return [
      if (_series.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: PanelNote('Series de esta práctica: ${_series.join(' · ')} repeticiones. Al terminar, guarda todas juntas.', icon: 'check-circle'),
        ),
      PfButton(
        _series.isEmpty ? 'Iniciar conteo' : 'Iniciar otra serie',
        kind: BtnKind.gold,
        icon: 'activity',
        onPressed: (_estado == _Estado.iniciando) ? null : _iniciar,
      ),
      if (_series.isNotEmpty) ...[
        const SizedBox(height: 10),
        PfButton('Guardar sesión (${_series.length} ${_series.length == 1 ? 'serie' : 'series'})', kind: BtnKind.secondary, icon: 'check', onPressed: _guardarAcumuladas),
      ],
      if (_estado == _Estado.listo && cfg != null) ...[
        const SizedBox(height: 10),
        PfButton('Cambiar cámara (${_frontal ? 'frontal' : 'trasera'})', kind: BtnKind.secondary, icon: 'refresh-cw', onPressed: _cambiarCamara),
        const SizedBox(height: 12),
        PanelNote(cfg.indicacion, icon: 'camera'),
      ],
      const SizedBox(height: 12),
      const PanelNote('Tu video no se guarda ni se envía: cada imagen se analiza en tu celular y se descarta al instante.', icon: 'shield-check'),
    ];
  }

  void _guardarAcumuladas() {
    Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
      builder: (_) => RegistrarSesionScreen(
        initialExerciseId: widget.ejercicioId,
        initialRepsList: List<int>.from(_series),
        initialFuentes: List<String>.from(_fuentes),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: widget.nombre,
      body: PfList(children: [
        _visor(),
        const SizedBox(height: 14),
        ..._controles(),
      ]),
    );
  }
}
