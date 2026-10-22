import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import 'ui.dart';

/// Barra gris que "late" mientras carga (skeleton del mockup).
class Skeleton extends StatefulWidget {
  final double? width;
  final double height;
  final double radius;
  const Skeleton({super.key, this.width, this.height = 16, this.radius = 10});

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.45, end: 1.0).animate(_c),
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(color: C.line, borderRadius: BorderRadius.circular(widget.radius)),
      ),
    );
  }
}

class SkeletonScreen extends StatelessWidget {
  const SkeletonScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
      children: const [
        Skeleton(height: 150, radius: 26),
        SizedBox(height: 12),
        Skeleton(height: 84, radius: 20),
        SizedBox(height: 12),
        Skeleton(height: 110, radius: 20),
        SizedBox(height: 12),
        Skeleton(height: 84, radius: 20),
      ],
    );
  }
}

class ErrorState extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const ErrorState({super.key, required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final bool net = error is ApiException && (error as ApiException).isNetwork;
    final bool server = error is ApiException && (error as ApiException).isServer;
    final String msg = error is ApiException ? (error as ApiException).message : 'No pude cargar esta pantalla.';
    final String title = net ? 'Sin conexión' : (server ? 'Servidor no disponible' : 'Algo salió mal');
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        EmptyState(
          pose: (net || server) ? 'cansado' : 'pensativo',
          title: title,
          body: (net || server) ? '$msg\nDesliza hacia abajo o toca Reintentar.' : msg,
          actions: [PfButton('Reintentar', kind: BtnKind.gold, icon: 'refresh-cw', onPressed: onRetry)],
        ),
      ],
    );
  }
}

/// Carga datos del servidor y los muestra con skeleton / error / contenido.
/// Se vuelve a cargar solo cuando cambian los datos de la app (app.version) y con "deslizar para actualizar".
class LoadView<T> extends StatefulWidget {
  final Future<T> Function() loader;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final Widget? skeleton;

  const LoadView({super.key, required this.loader, required this.builder, this.skeleton});

  @override
  State<LoadView<T>> createState() => _LoadViewState<T>();
}

class _LoadViewState<T> extends State<LoadView<T>> {
  T? _data;
  bool _has = false;
  Object? _error;
  bool _loading = true;
  int _seen = 0;

  @override
  void initState() {
    super.initState();
    _seen = app.version;
    app.addListener(_onApp);
    _load();
  }

  @override
  void dispose() {
    app.removeListener(_onApp);
    super.dispose();
  }

  void _onApp() {
    if (app.version != _seen) {
      _seen = app.version;
      _load(silent: true);
    }
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      final d = await widget.loader();
      if (!mounted) return;
      setState(() {
        _data = d;
        _has = true;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false; // si ya habia datos se siguen mostrando
      });
    }
  }

  Future<void> _reload() => _load(silent: true);

  @override
  Widget build(BuildContext context) {
    if (_has) return widget.builder(context, _data as T, _reload);
    if (_loading) return widget.skeleton ?? const SkeletonScreen();
    return RefreshIndicator(
      color: C.ink,
      onRefresh: _reload,
      child: ErrorState(error: _error ?? 'Error', onRetry: () => _load()),
    );
  }
}

/// Atajo: pantalla secundaria con LoadView y lista con "deslizar para actualizar".
Widget loadList<T>({
  required Future<T> Function() loader,
  required List<Widget> Function(BuildContext context, T data) children,
  Widget? skeleton,
}) {
  return LoadView<T>(
    loader: loader,
    skeleton: skeleton,
    builder: (context, data, reload) => PfList(onRefresh: reload, children: children(context, data)),
  );
}
