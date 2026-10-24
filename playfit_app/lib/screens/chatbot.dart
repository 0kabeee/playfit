import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../common.dart';
import 'premium.dart';
import 'soporte.dart';

class _Msg {
  final bool user;
  final String text;
  final bool alert; // aviso de salud
  final bool error;
  final bool soporte; // la conversacion se transfirio a un humano (pagos)
  Map<String, dynamic>? accion; // propuesta del agente (registrar sesion / crear reto) que el usuario confirma
  final List<Map<String, dynamic>> memoria; // preferencias que el agente acaba de guardar
  _Msg({
    required this.user,
    required this.text,
    this.alert = false,
    this.error = false,
    this.soporte = false,
    this.accion,
    this.memoria = const <Map<String, dynamic>>[],
  });
}

/// Ejecuta una propuesta del agente con el endpoint NORMAL de la app (mismas validaciones, XP y anti-abuso) y
/// le informa al asistente el resultado. Devuelve la accion actualizada.
Future<Map<String, dynamic>> confirmarAccionAgente(ApiClient api, Map<String, dynamic> accion) async {
  final datos = asMap(accion['datos']);
  int resultado;
  String aviso;
  if (asStr(accion['tipo']) == 'registrar_sesion') {
    final r = asMap(await api.post('/api/social/sessions', body: datos));
    resultado = asInt(r['sesion_id']);
    aviso = 'Sesión registrada · +${asInt(r['xp_ganado'])} XP';
  } else {
    final r = asMap(await api.post('/api/social/squads/me/challenges', body: datos));
    resultado = asInt(r['id']);
    aviso = 'Reto creado en tu squad';
  }
  final a = asMap(await api.post('/api/content/ai/actions/${asInt(accion['id'])}', body: {'estado': 'confirmada', 'resultado_id': resultado}));
  toast(aviso, type: ToastType.success);
  return a;
}

/// Chat con el asistente (Gemini). Al modelo solo llegan indicadores generales, nunca el historial clinico.
/// Fase 13: el asistente es un agente (propone registrar sesiones y crear retos, que el usuario confirma),
/// recuerda preferencias que el usuario le cuenta, y se puede hablar con el (voz a texto) y escucharlo (texto a voz).
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

  // voz: dictado (speech_to_text) y lectura en voz alta (flutter_tts). Ambos usan los servicios del celular.
  final SpeechToText _stt = SpeechToText();
  final FlutterTts _tts = FlutterTts();
  bool _sttListo = false;
  bool _escuchando = false;
  bool _leerEnVoz = false;
  final Set<int> _resolviendo = <int>{};

  @override
  void initState() {
    super.initState();
    _messages.add(_saludo());
    _checkConsent();
    _cargarPreferenciaVoz();
  }

  _Msg _saludo() => _Msg(
        user: false,
        text: 'Hola ${app.firstName}, soy el asistente de PlayFit. Te ayudo con técnica, rutinas y nutrición, y puedo '
            'registrar tus entrenos o armar retos para tu squad (siempre te pido confirmación). ¿En qué te ayudo?',
      );

  // ---------------------------------------------------------------- voz
  Future<void> _cargarPreferenciaVoz() async {
    try {
      final p = await SharedPreferences.getInstance();
      if (mounted) setState(() => _leerEnVoz = p.getBool('ia_voz_${app.userId}') ?? false);
    } catch (_) {}
  }

  Future<void> _alternarVoz() async {
    final nuevo = !_leerEnVoz;
    if (nuevo && !app.isPremium) {
      await pedirPremium(context, 'Escuchar al asistente');
      return;
    }
    setState(() => _leerEnVoz = nuevo);
    if (!nuevo) await _tts.stop();
    toast(nuevo ? 'Leeré mis respuestas en voz alta' : 'Ya no leeré en voz alta', icon: nuevo ? 'volume-2' : 'volume-x');
    try {
      final p = await SharedPreferences.getInstance();
      await p.setBool('ia_voz_${app.userId}', nuevo);
    } catch (_) {}
  }

  Future<void> _hablar(String texto) async {
    if (!_leerEnVoz || !app.isPremium || texto.trim().isEmpty) return;
    try {
      for (final idioma in const ['es-CO', 'es-MX', 'es-US', 'es-ES']) {
        if (await _tts.isLanguageAvailable(idioma) == true) {
          await _tts.setLanguage(idioma);
          break;
        }
      }
      await _tts.stop();
      await _tts.speak(texto);
    } catch (_) {
      // sin motor de voz en el celular: se queda solo el texto
    }
  }

  Future<void> _microfono() async {
    if (_sending) return;
    if (!app.isPremium && !_escuchando) {
      await pedirPremium(context, 'Hablarle al asistente');
      return;
    }
    if (_escuchando) {
      await _stt.stop();
      if (mounted) setState(() => _escuchando = false);
      return;
    }
    await _tts.stop();
    if (!_sttListo) {
      try {
        _sttListo = await _stt.initialize(
          onStatus: (s) {
            if ((s == 'done' || s == 'notListening') && mounted) setState(() => _escuchando = false);
          },
          onError: (_) {
            if (mounted) setState(() => _escuchando = false);
          },
        );
      } catch (_) {
        _sttListo = false;
      }
      if (!_sttListo) {
        toast('No pude usar el micrófono. Revisa el permiso en los ajustes del celular.', type: ToastType.error);
        return;
      }
    }
    String? locale;
    try {
      final locales = await _stt.locales();
      for (final pref in const ['es_CO', 'es_MX', 'es_US', 'es_ES']) {
        if (locales.any((l) => l.localeId == pref)) {
          locale = pref;
          break;
        }
      }
      locale ??= locales.where((l) => l.localeId.startsWith('es')).map((l) => l.localeId).firstOrNull;
    } catch (_) {}
    setState(() => _escuchando = true);
    await _stt.listen(
      listenOptions: SpeechListenOptions(localeId: locale, partialResults: true, cancelOnError: true),
      onResult: (r) {
        if (!mounted) return;
        setState(() => _input.text = r.recognizedWords);
        if (r.finalResult) {
          setState(() => _escuchando = false);
          if (_input.text.trim().isNotEmpty) _send();
        }
      },
    );
  }

  // ---------------------------------------------------------------- memoria
  Future<void> _verMemoria() async {
    if (!app.isPremium) {
      await pedirPremium(context, 'La memoria del asistente');
      return;
    }
    List<Map<String, dynamic>> mem;
    try {
      mem = asList(await app.api.get('/api/content/ai/memory'));
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
      return;
    }
    if (!mounted) return;
    await showPfSheet<void>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Lo que recuerda el asistente', style: Tx.display(size: 19)),
            const SizedBox(height: 6),
            Text('Solo preferencias que tú le contaste para personalizar sus respuestas. Nunca datos de salud.',
                style: Tx.body(size: 12.5, color: C.inkSoft, height: 1.45)),
            const SizedBox(height: 12),
            if (mem.isEmpty)
              Text('Todavía no recuerda nada. Cuéntale tu objetivo, tus días disponibles o el equipo que tienes.',
                  style: Tx.body(size: 13, color: C.inkSoft))
            else ...[
              RowCard([
                for (final m in mem)
                  RowTile(
                    title: asStr(m['etiqueta']),
                    sub: asStr(m['valor']).replaceAll('_', ' '),
                    left: const IconDisc('sparkles', tone: 'purple', size: 34),
                    right: PfIconButton('x', onTap: () async {
                      try {
                        await app.api.delete('/api/content/ai/memory/${asStr(m['clave'])}');
                        setSheet(() => mem.remove(m));
                      } on ApiException catch (e) {
                        toast(e.message, type: ToastType.error);
                      }
                    }),
                  ),
              ]),
              const SizedBox(height: 14),
              PfButton('Olvidar todo', kind: BtnKind.secondary, onPressed: () async {
                try {
                  await app.api.delete('/api/content/ai/memory');
                  setSheet(mem.clear);
                } on ApiException catch (e) {
                  toast(e.message, type: ToastType.error);
                }
              }),
            ],
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- propuestas del agente
  Future<void> _resolver(_Msg m, {required bool confirmar}) async {
    final accion = m.accion;
    if (accion == null) return;
    final id = asInt(accion['id']);
    if (_resolviendo.contains(id)) return;
    setState(() => _resolviendo.add(id));
    try {
      final a = confirmar
          ? await confirmarAccionAgente(app.api, accion)
          : asMap(await app.api.post('/api/content/ai/actions/$id', body: {'estado': 'cancelada'}));
      if (confirmar) app.bump(); // dashboard, retos e historial se recargan
      if (mounted) setState(() => m.accion = a);
    } on ApiException catch (e) {
      if (e.code == 'ACCION_YA_RESUELTA') {
        if (mounted) setState(() => m.accion = <String, dynamic>{...accion, 'estado': 'resuelta'});
      } else {
        toast(e.message, type: ToastType.error);
      }
    } finally {
      if (mounted) setState(() => _resolviendo.remove(id));
    }
  }

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
          final a = m['accion'];
          _messages.add(_Msg(user: asStr(m['rol']) == 'usuario', text: asStr(m['contenido']), accion: a is Map ? asMap(a) : null));
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
    _stt.cancel();
    _tts.stop();
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
      final accion = r['accion'];
      setState(() {
        _convId = asInt(r['conversacion_id']);
        _remaining = asInt(r['restantes_hoy']);
        if (r.containsKey('premium') && asBool(r['premium']) != app.isPremium) app.refreshMe();
        _messages.add(_Msg(
          user: false,
          text: asStr(r['respuesta']),
          alert: asBool(r['alerta_salud']),
          soporte: asBool(r['transferido_a_soporte']),
          accion: accion is Map ? asMap(accion) : null,
          memoria: asList(r['memoria_actualizada']),
        ));
      });
      _hablar(asStr(r['respuesta']));
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
        'También puede proponerte registrar entrenos o crear retos (nada se guarda sin que toques «Confirmar») y recordar preferencias que le cuentes, como tu objetivo o tus días disponibles. Puedes ver y borrar lo que recuerda.\n\n'
        'Si usas el micrófono, el dictado lo hace el servicio de voz de tu celular.\n\n'
        'Puedes revocar este permiso cuando quieras en Perfil › Cuenta (se borra lo que el asistente recuerda).',
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
                    hintText: _escuchando ? 'Te escucho…' : 'Escribe o toca el micrófono…',
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
                onTap: _microfono,
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _escuchando ? C.error : C.cream,
                    shape: BoxShape.circle,
                    border: Border.all(color: _escuchando ? C.error : C.lineStrong),
                  ),
                  child: Center(child: LIcon(_escuchando ? 'square' : 'mic', size: 19, color: _escuchando ? C.cream : C.ink)),
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m.text, style: Tx.body(size: 13.5, height: 1.45)),
                  if (m.soporte) ...[
                    const SizedBox(height: 10),
                    PfButton('Ir a Soporte', kind: BtnKind.gold, small: true, expand: false, icon: 'message-circle', onPressed: () {
                      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SoporteScreen()));
                    }),
                  ],
                  if (m.accion != null) ...[
                    const SizedBox(height: 10),
                    _AccionCard(
                      accion: m.accion!,
                      ocupado: _resolviendo.contains(asInt(m.accion!['id'])),
                      onConfirmar: () => _resolver(m, confirmar: true),
                      onCancelar: () => _resolver(m, confirmar: false),
                    ),
                  ],
                  if (m.memoria.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final p in m.memoria)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                          decoration: BoxDecoration(color: C.purpleBg, borderRadius: BorderRadius.circular(20)),
                          child: Row(mainAxisSize: MainAxisSize.min, children: [
                            const LIcon('sparkles', size: 12, color: C.purple),
                            const SizedBox(width: 4),
                            Text('Recordaré: ${asStr(p['etiqueta'])} · ${asStr(p['valor']).replaceAll('_', ' ')}',
                                style: Tx.body(size: 11, color: C.purple, w: FontWeight.w700)),
                          ]),
                        ),
                    ]),
                  ],
                ],
              ),
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
              PfIconButton(_leerEnVoz ? 'volume-2' : 'volume-x', onTap: _alternarVoz),
              PfIconButton('sparkles', onTap: _verMemoria),
              PfIconButton('clock', onTap: _historial),
              PfIconButton('plus', onTap: _nueva),
            ]
          : const [],
    );
  }
}

/// Tarjeta de una propuesta del agente: resumen + Confirmar / Cancelar (o el estado si ya se resolvio).
class _AccionCard extends StatelessWidget {
  const _AccionCard({required this.accion, required this.ocupado, required this.onConfirmar, required this.onCancelar});

  final Map<String, dynamic> accion;
  final bool ocupado;
  final VoidCallback onConfirmar;
  final VoidCallback onCancelar;

  @override
  Widget build(BuildContext context) {
    final estado = asStr(accion['estado']);
    final esSesion = asStr(accion['tipo']) == 'registrar_sesion';
    final (String texto, Color color) = switch (estado) {
      'confirmada' => (esSesion ? 'Sesión registrada' : 'Reto creado', C.green),
      'cancelada' => ('Cancelado', C.inkMute),
      'resuelta' => ('Ya resuelta', C.inkMute),
      _ => ('', C.ink),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: C.cream, borderRadius: BorderRadius.circular(14), border: Border.all(color: C.lineStrong)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            IconDisc(esSesion ? 'dumbbell' : 'trophy', tone: esSesion ? 'blue' : 'gold', size: 28),
            const SizedBox(width: 8),
            Text(esSesion ? 'Registrar sesión' : 'Crear reto del squad', style: Tx.body(size: 12.5, w: FontWeight.w800)),
          ]),
          const SizedBox(height: 8),
          Text(asStr(accion['resumen']), style: Tx.body(size: 12.5, color: C.inkSoft, height: 1.4)),
          const SizedBox(height: 10),
          if (estado == 'propuesta')
            Row(children: [
              Expanded(child: PfButton('Confirmar', kind: BtnKind.gold, small: true, icon: 'check', loading: ocupado, onPressed: ocupado ? null : onConfirmar)),
              const SizedBox(width: 8),
              Expanded(child: PfButton('Cancelar', kind: BtnKind.secondary, small: true, onPressed: ocupado ? null : onCancelar)),
            ])
          else
            Row(children: [
              LIcon(estado == 'confirmada' ? 'check-circle' : 'x', size: 15, color: color),
              const SizedBox(width: 6),
              Text(texto, style: Tx.body(size: 12, color: color, w: FontWeight.w700)),
            ]),
        ],
      ),
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
