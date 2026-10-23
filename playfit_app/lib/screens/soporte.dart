import 'dart:async';

import '../common.dart';

/// Burbuja de chat de soporte. `mia`: la escribio quien mira la pantalla.
class SoporteBubble extends StatelessWidget {
  final Map<String, dynamic> m;
  final bool mia;
  const SoporteBubble(this.m, {super.key, required this.mia});

  static String quien(String autor) {
    switch (autor) {
      case 'bot':
        return 'Asistente automático';
      case 'admin':
        return 'Soporte PlayFit';
      default:
        return 'Usuario';
    }
  }

  @override
  Widget build(BuildContext context) {
    final autor = asStr(m['autor']);
    final hora = Fmt.relative(asStr(m['created_at']));
    if (mia) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(bottom: 10, left: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: const BoxDecoration(
            color: C.ink,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(18),
              topRight: Radius.circular(18),
              bottomLeft: Radius.circular(18),
              bottomRight: Radius.circular(5),
            ),
          ),
          child: Text(asStr(m['contenido']), style: Tx.body(size: 13.5, color: C.cream, height: 1.45)),
        ),
      );
    }
    final bool bot = autor == 'bot';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, right: 40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 3),
            child: Text('${quien(autor)}${hora.isEmpty ? '' : ' · $hora'}', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkMute)),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: bot ? C.surface : C.goldBg,
              border: Border.all(color: bot ? C.line : C.gold),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(5),
                topRight: Radius.circular(18),
                bottomLeft: Radius.circular(18),
                bottomRight: Radius.circular(18),
              ),
            ),
            child: Text(asStr(m['contenido']), style: Tx.body(size: 13.5, height: 1.45)),
          ),
        ],
      ),
    );
  }
}

/// Barra inferior para escribir (compartida por el usuario y el admin).
class SoporteInput extends StatelessWidget {
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  final String hint;
  const SoporteInput({super.key, required this.controller, required this.sending, required this.onSend, this.hint = 'Escribe tu mensaje…'});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      decoration: const BoxDecoration(color: C.surface, border: Border(top: BorderSide(color: C.line))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              minLines: 1,
              maxLines: 4,
              maxLength: 1000,
              textCapitalization: TextCapitalization.sentences,
              style: Tx.body(size: 14.5),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: Tx.body(size: 14.5, color: C.inkMute),
                counterText: '',
                filled: true,
                fillColor: C.cream,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: sending ? null : onSend,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: sending ? C.lineStrong : C.ink, shape: BoxShape.circle),
              child: const Center(child: LIcon('send', size: 19, color: C.cream)),
            ),
          ),
        ],
      ),
    );
  }
}

// ====================================================================== SOPORTE (usuario)
/// Chat de ayuda. Responde un asistente automatico; si hablas de pagos o Premium (o pides una persona),
/// la conversacion pasa a un humano del equipo de PlayFit.
class SoporteScreen extends StatefulWidget {
  const SoporteScreen({super.key});

  @override
  State<SoporteScreen> createState() => _SoporteScreenState();
}

class _SoporteScreenState extends State<SoporteScreen> {
  Map<String, dynamic>? _conv;
  bool _loaded = false;
  Object? _error;
  bool _sending = false;
  Timer? _poll;
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
    // mientras un humano atiende, se revisa cada 8 s si llegaron respuestas
    _poll = Timer.periodic(const Duration(seconds: 8), (_) {
      if (_conHumano) _load(silent: true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  bool get _conHumano => asBool(_conv?['con_humano']);
  List<Map<String, dynamic>> get _mensajes => asList(_conv?['mensajes']);

  Future<void> _load({bool silent = false}) async {
    try {
      final d = asMap(await app.api.get('/api/social/support'));
      if (!mounted) return;
      final antes = _mensajes.length;
      setState(() {
        _conv = d['conversacion'] == null ? null : asMap(d['conversacion']);
        _loaded = true;
        _error = null;
      });
      if (_mensajes.length != antes) _scrollDown();
    } catch (e) {
      if (!mounted || silent) return;
      setState(() => _error = e);
    }
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent + 120, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send([String? texto]) async {
    final t = (texto ?? _input.text).trim();
    if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final r = asMap(await app.api.post('/api/social/support/messages', body: {'mensaje': t}));
      if (!mounted) return;
      _input.clear();
      setState(() => _conv = asMap(r['conversacion']));
      if (asBool(r['transferida'])) toast('Te pasamos con una persona del equipo', type: ToastType.success);
      _scrollDown();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _cerrar() async {
    final ok = await confirmSheet(context, title: '¿Terminar la conversación?', body: 'Si luego necesitas algo más, puedes escribir de nuevo.', action: 'Terminar', danger: false);
    if (!ok) return;
    try {
      await app.api.post('/api/social/support/close');
      if (mounted) setState(() => _conv = null);
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    }
  }

  Widget _estado() {
    final estado = asStr(_conv?['estado']);
    if (estado == 'pendiente') {
      return const PanelNote('Te pasamos con una persona del equipo de PlayFit. Te responderá aquí mismo; también te llegará una notificación.', icon: 'clock');
    }
    if (estado == 'atendiendo') {
      return const PanelNote('Estás hablando con una persona del equipo de PlayFit.', icon: 'users');
    }
    return const PanelNote('Te responde un asistente automático. Para pagos o el Premium te pasamos con una persona.', icon: 'message-circle');
  }

  Widget _sugerencias() {
    const opciones = ['¿Cómo funciona la racha?', 'Quiero el Premium', 'Tengo un problema con mi pago', 'Hablar con un asesor'];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final o in opciones)
          ActionChip(
            label: Text(o, style: Tx.body(size: 12, w: FontWeight.w700)),
            backgroundColor: C.surface,
            side: const BorderSide(color: C.lineStrong),
            onPressed: _sending ? null : () => _send(o),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (!_loaded && _error != null) {
      body = ErrorState(error: _error!, onRetry: _load);
    } else if (!_loaded) {
      body = const SkeletonScreen();
    } else {
      body = Column(
        children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: _estado()),
          Expanded(
            child: RefreshIndicator(
              color: C.ink,
              onRefresh: () => _load(silent: true),
              child: ListView(
                controller: _scroll,
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                children: [
                  if (_mensajes.isEmpty) ...[
                    const SizedBox(height: 8),
                    const MascotNote('feliz', '¡Hola! ¿En qué te ayudo? Escribe tu duda o elige una opción.'),
                    _sugerencias(),
                  ],
                  for (final m in _mensajes) SoporteBubble(m, mia: asStr(m['autor']) == 'usuario'),
                ],
              ),
            ),
          ),
          SoporteInput(controller: _input, sending: _sending, onSend: _send),
        ],
      );
    }
    return PfScaffold(
      title: 'Ayuda y soporte',
      actions: _conv != null ? [PfIconButton('x', onTap: _cerrar)] : const [],
      body: body,
    );
  }
}
