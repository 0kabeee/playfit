import '../common.dart';
import 'soporte.dart';

class _Msg {
  final bool user;
  final String text;
  final bool alert; // aviso de salud
  final bool error;
  final bool soporte; // la conversacion se transfirio a un humano (pagos)
  const _Msg({required this.user, required this.text, this.alert = false, this.error = false, this.soporte = false});
}

/// Chat con el asistente (Gemini). Al modelo solo llegan indicadores generales, nunca el historial clinico.
class ChatbotScreen extends StatefulWidget {
  const ChatbotScreen({super.key});

  @override
  State<ChatbotScreen> createState() => _ChatbotScreenState();
}

class _ChatbotScreenState extends State<ChatbotScreen> {
  bool? _consent;
  Object? _loadError;
  bool _accepting = false;
  bool _sending = false;
  int? _convId;
  int? _remaining;
  final List<_Msg> _messages = <_Msg>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _messages.add(_saludo());
    _checkConsent();
  }

  _Msg _saludo() => _Msg(
        user: false,
        text: 'Hola ${app.firstName}, soy el asistente de PlayFit. Te ayudo con dudas de técnica y nutrición. ¿Qué quieres saber?',
      );

  /// Al entrar se retoma la conversación más reciente (el servidor las guarda); si no hay ninguna, se queda el saludo.
  Future<void> _cargarUltima() async {
    try {
      final lista = asList(await app.api.get('/api/content/ai/conversations'));
      if (lista.isNotEmpty && mounted && _convId == null && _messages.length == 1) {
        await _abrir(asInt(lista.first['id']), avisar: false);
      }
    } catch (_) {
      // sin historial no pasa nada: se empieza una conversación nueva
    }
  }

  Future<void> _abrir(int id, {bool avisar = true}) async {
    try {
      final c = asMap(await app.api.get('/api/content/ai/conversations/$id'));
      final msgs = asList(c['mensajes']);
      if (!mounted) return;
      setState(() {
        _convId = id;
        _messages
          ..clear()
          ..add(_saludo());
        for (final m in msgs) {
          _messages.add(_Msg(user: asStr(m['rol']) == 'usuario', text: asStr(m['contenido'])));
        }
      });
      _scrollDown();
    } on ApiException catch (e) {
      if (avisar) toast(e.message, type: ToastType.error);
    }
  }

  void _nueva() {
    if (_sending) return;
    setState(() {
      _convId = null;
      _messages
        ..clear()
        ..add(_saludo());
    });
  }

  Future<void> _historial() async {
    List<Map<String, dynamic>> lista;
    try {
      lista = asList(await app.api.get('/api/content/ai/conversations'));
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
      return;
    }
    if (!mounted) return;
    final elegido = await showPfSheet<int>(
      context,
      (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Tus conversaciones', style: Tx.display(size: 19)),
          const SizedBox(height: 12),
          if (lista.isEmpty)
            Text('Todavía no tienes conversaciones guardadas.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            RowCard([
              for (final c in lista)
                RowTile(
                  title: asStr(c['titulo']).isEmpty ? 'Conversación' : asStr(c['titulo']),
                  sub: Fmt.dayLabel(asStr(c['created_at'])),
                  left: const IconDisc('message-circle', tone: 'blue', size: 34),
                  chevron: true,
                  onTap: () => Navigator.of(ctx).pop(asInt(c['id'])),
                ),
            ]),
        ],
      ),
    );
    if (elegido != null) await _abrir(elegido);
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _checkConsent() async {
    setState(() {
      _loadError = null;
      _consent = null;
    });
    try {
      final c = asMap(await app.api.get('/api/auth/consents'));
      if (mounted) setState(() => _consent = asBool(c['ia_chatbot']));
      if (mounted && _consent == true) _cargarUltima();
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  Future<void> _accept() async {
    setState(() => _accepting = true);
    try {
      await app.api.put('/api/auth/consents/ia_chatbot', body: {'aceptado': true});
      if (mounted) setState(() => _consent = true);
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _accepting = false);
    }
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent + 120, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    if (text.length > 1000) {
      toast('El mensaje puede tener hasta 1000 caracteres', type: ToastType.error);
      return;
    }
    setState(() {
      _messages.add(_Msg(user: true, text: text));
      _sending = true;
      _input.clear();
    });
    _scrollDown();

    try {
      final body = <String, dynamic>{'mensaje': text};
      if (_convId != null) body['conversacionId'] = _convId;
      final r = asMap(await app.api.post('/api/content/ai/chat', body: body));
      if (!mounted) return;
      setState(() {
        _convId = asInt(r['conversacion_id']);
        _remaining = asInt(r['restantes_hoy']);
        _messages.add(_Msg(user: false, text: asStr(r['respuesta']), alert: asBool(r['alerta_salud']), soporte: asBool(r['transferido_a_soporte'])));
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'CONSENTIMIENTO_REQUERIDO') {
        setState(() => _consent = false);
      } else {
        String msg = e.message;
        if (e.code == 'IA_NO_CONFIGURADA') msg = 'El asistente no está disponible en este momento. Inténtalo más tarde.';
        if (e.isNetwork) msg = 'No pude conectarme. Revisa tu conexión e inténtalo de nuevo.';
        setState(() => _messages.add(_Msg(user: false, text: msg, error: true)));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollDown();
    }
  }

  Widget _consentCard() {
    return PfList(children: [
      const MascotStage('pensativo', color: C.purpleBg, size: 120, enter: true),
      const SizedBox(height: 16),
      Text('Antes de empezar', style: Tx.display(size: 22)),
      const SizedBox(height: 8),
      Text(
        'El asistente responde dudas de técnica y nutrición usando Gemini, un servicio de Google.\n\n'
        'Solo recibe indicadores generales de seguridad (por ejemplo, «evitar impacto de rodilla»). Nunca recibe tu historial clínico, tu nombre ni tu correo.\n\n'
        'Puedes revocar este permiso cuando quieras en Perfil › Cuenta.',
        style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5),
      ),
      const SizedBox(height: 20),
      PfButton('Aceptar y continuar', kind: BtnKind.gold, loading: _accepting, onPressed: _accept),
      const SizedBox(height: 10),
      PfButton('Ahora no', kind: BtnKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
    ]);
  }

  Widget _chat() {
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: PanelNote('Usa solo indicadores generales de tu perfil, nunca tu historial clínico. Orientación general: no reemplaza a un profesional.', icon: 'shield-check'),
        ),
        Expanded(
          child: ListView(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            children: [
              for (final m in _messages) _bubble(m),
              if (_sending) const _TypingBubble(),
            ],
          ),
        ),
        if (_remaining != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('$_remaining mensajes restantes hoy', style: Tx.body(size: 11, color: C.inkMute)),
          ),
        Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
          decoration: const BoxDecoration(color: C.surface, border: Border(top: BorderSide(color: C.line))),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 1000,
                  textCapitalization: TextCapitalization.sentences,
                  style: Tx.body(size: 14.5),
                  decoration: InputDecoration(
                    hintText: 'Escribe tu pregunta…',
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
                onTap: _send,
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: _sending ? C.lineStrong : C.ink, shape: BoxShape.circle),
                  child: const Center(child: LIcon('send', size: 19, color: C.cream)),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bubble(_Msg m) {
    if (m.user) {
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
          child: Text(m.text, style: Tx.body(size: 13.5, color: C.cream, height: 1.45)),
        ),
      );
    }
    final Color bg = m.alert ? C.yellowBg : (m.error ? C.errorBg : C.surface);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, right: 40),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          const Mascot('feliz', size: 30, animate: false),
          const SizedBox(width: 8),
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: bg,
                border: Border.all(color: m.alert ? C.yellow : (m.error ? C.error : C.line)),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(18),
                  topRight: Radius.circular(18),
                  bottomLeft: Radius.circular(5),
                  bottomRight: Radius.circular(18),
                ),
              ),
              child: m.soporte
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.text, style: Tx.body(size: 13.5, height: 1.45)),
                        const SizedBox(height: 10),
                        PfButton('Ir a Soporte', kind: BtnKind.gold, small: true, expand: false, icon: 'message-circle', onPressed: () {
                          Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SoporteScreen()));
                        }),
                      ],
                    )
                  : Text(m.text, style: Tx.body(size: 13.5, height: 1.45)),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_loadError != null) {
      body = ErrorState(error: _loadError!, onRetry: _checkConsent);
    } else if (_consent == null) {
      body = const SkeletonScreen();
    } else if (_consent == false) {
      body = _consentCard();
    } else {
      body = _chat();
    }
    return PfScaffold(
      title: 'Asistente PlayFit',
      body: body,
      actions: _consent == true
          ? [
              PfIconButton('clock', onTap: _historial),
              PfIconButton('plus', onTap: _nueva),
            ]
          : const [],
    );
  }
}

class _TypingBubble extends StatefulWidget {
  const _TypingBubble();

  @override
  State<_TypingBubble> createState() => _TypingBubbleState();
}

class _TypingBubbleState extends State<_TypingBubble> with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          const Mascot('pensativo', size: 30, animate: false),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.line), borderRadius: BorderRadius.circular(18)),
            child: AnimatedBuilder(
              animation: _c,
              builder: (context, _) {
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 0; i < 3; i++)
                      Container(
                        width: 7,
                        height: 7,
                        margin: const EdgeInsets.symmetric(horizontal: 2.5),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: C.inkMute.withValues(alpha: ((_c.value * 3 - i) % 3 < 1) ? 1.0 : 0.35),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
