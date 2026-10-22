import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Tamaño original (ancho, alto) de cada ilustracion de la mascota, para conservar la proporcion.
const Map<String, List<int>> kMascotSize = {
  'hero': [244, 340],
  'entrenando': [242, 288],
  'en_accion': [209, 284],
  'vamos': [225, 280],
  'descanso': [259, 246],
  'logro': [241, 253],
  'cansado': [204, 263],
  'feliz': [170, 201],
  'enfocado': [165, 201],
  'sorprendido': [169, 201],
  'pensativo': [165, 207],
  'triste': [164, 201],
  'energizado': [164, 201],
  'calentando': [190, 202],
  'levantando': [252, 204],
  'cardio': [176, 212],
  'yeah': [174, 219],
  'recuperando': [170, 207],
  'listo_manana': [183, 207]
};

/// Pose de la mascota. Las 19 ilustraciones son las del usuario (`assets/mascota/<pose>.png`), sin redibujar.
class Mascot extends StatefulWidget {
  final String pose;
  final double size; // alto en dp
  final bool animate; // balanceo suave (idle)
  final bool enter; // animacion de entrada

  const Mascot(this.pose, {super.key, this.size = 64, this.animate = true, this.enter = false});

  @override
  State<Mascot> createState() => _MascotState();
}

class _MascotState extends State<Mascot> with TickerProviderStateMixin {
  late final AnimationController _idle;
  AnimationController? _enter;

  @override
  void initState() {
    super.initState();
    _idle = AnimationController(vsync: this, duration: const Duration(milliseconds: 3400));
    if (widget.animate) _idle.repeat(reverse: true);
    if (widget.enter) {
      _enter = AnimationController(vsync: this, duration: const Duration(milliseconds: 550))..forward();
    }
  }

  @override
  void dispose() {
    _idle.dispose();
    _enter?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dims = kMascotSize[widget.pose] ?? kMascotSize['feliz']!;
    final double h = widget.size;
    final double w = h * dims[0] / dims[1];
    final String pose = kMascotSize.containsKey(widget.pose) ? widget.pose : 'feliz';

    Widget img = AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      child: Image.asset(
        'assets/mascota/$pose.png',
        key: ValueKey<String>(pose),
        width: w,
        height: h,
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
      ),
    );

    if (widget.animate) {
      img = AnimatedBuilder(
        animation: _idle,
        child: img,
        builder: (context, child) {
          final t = Curves.easeInOut.transform(_idle.value);
          return Transform.translate(
            offset: Offset(0, -6 * t),
            child: Transform.rotate(angle: -0.021 * t, alignment: Alignment.bottomCenter, child: child),
          );
        },
      );
    }

    final enter = _enter;
    if (enter != null) {
      img = AnimatedBuilder(
        animation: enter,
        child: img,
        builder: (context, child) {
          final t = Curves.easeOutBack.transform(enter.value);
          final double opacity = (enter.value * 1.8).clamp(0.0, 1.0).toDouble();
          return Opacity(
            opacity: opacity,
            child: Transform.translate(
              offset: Offset(0, 18 * (1 - t)),
              child: Transform.scale(scale: 0.82 + 0.18 * t, alignment: Alignment.bottomCenter, child: child),
            ),
          );
        },
      );
    }
    return SizedBox(width: w, height: h + 6, child: Align(alignment: Alignment.bottomCenter, child: img));
  }
}

/// Mascota de pie sobre un "escenario" de color suave (como en el dashboard del mockup).
class MascotStage extends StatelessWidget {
  final String pose;
  final Color color;
  final double size;
  final bool enter;

  const MascotStage(this.pose, {super.key, this.color = C.brownBg, this.size = 132, this.enter = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(0, 20, 0, 6),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(28)),
      child: Stack(
        alignment: Alignment.bottomCenter,
        children: [
          Positioned(
            bottom: 6,
            child: Container(
              width: size * 0.55,
              height: 4,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                boxShadow: const [BoxShadow(color: Color(0x33211B15), blurRadius: 12, spreadRadius: 4)],
              ),
            ),
          ),
          Mascot(pose, size: size, enter: enter),
        ],
      ),
    );
  }
}

/// Mascota con un mensaje corto al lado (el "mascotNote" del mockup).
class MascotNote extends StatelessWidget {
  final String pose;
  final String text;
  final double size;

  const MascotNote(this.pose, this.text, {super.key, this.size = 44});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: C.surface,
        border: Border.all(color: C.line),
        borderRadius: BorderRadius.circular(C.rm),
      ),
      child: Row(
        children: [
          Mascot(pose, size: size, animate: false),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: Tx.body(size: 12.5, w: FontWeight.w600, color: C.inkSoft, height: 1.45))),
        ],
      ),
    );
  }
}
