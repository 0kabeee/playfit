import 'package:url_launcher/url_launcher.dart';
import 'package:youtube_player_iframe/youtube_player_iframe.dart';

import '../common.dart';
import 'camara_conteo.dart';
import 'chatbot.dart';
import 'sesiones.dart';

String _nivelLabel(String n) {
  switch (n) {
    case 'avanzado':
      return 'Avanzado';
    case 'intermedio':
      return 'Intermedio';
    default:
      return 'Principiante';
  }
}

String _nivelTone(String n) {
  switch (n) {
    case 'avanzado':
      return 'pink';
    case 'intermedio':
      return 'blue';
    default:
      return 'green';
  }
}

final RegExp _ytId = RegExp(r'^[A-Za-z0-9_-]{11}$');

/// Abre el video de técnica en la app de YouTube (o el navegador).
Future<void> _abrirVideo(String id) async {
  if (!_ytId.hasMatch(id)) return;
  try {
    final ok = await launchUrl(Uri.parse('https://www.youtube.com/watch?v=$id'), mode: LaunchMode.externalApplication);
    if (!ok) toast('No pude abrir el video.', type: ToastType.error);
  } catch (_) {
    toast('No pude abrir el video.', type: ToastType.error);
  }
}

/// Mini reproductor de YouTube dentro de la pantalla (el video se ve sin salir de la app).
class _VideoTecnica extends StatefulWidget {
  final String videoId;
  const _VideoTecnica({super.key, required this.videoId});

  @override
  State<_VideoTecnica> createState() => _VideoTecnicaState();
}

class _VideoTecnicaState extends State<_VideoTecnica> {
  late final YoutubePlayerController _c;

  @override
  void initState() {
    super.initState();
    _c = YoutubePlayerController.fromVideoId(
      videoId: widget.videoId,
      autoPlay: false,
      // YouTube exige identificar quién incrusta el video (si no, error 152/153): se usa el id de la app.
      params: const YoutubePlayerParams(
        origin: 'https://co.edu.usb.playfit_app',
        showFullscreenButton: true,
      ),
    );
  }

  @override
  void dispose() {
    _c.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: YoutubePlayer(controller: _c, aspectRatio: 16 / 9),
        ),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => _abrirVideo(widget.videoId),
          child: Text('¿No carga? Ábrelo en YouTube', style: Tx.body(size: 12, w: FontWeight.w700, color: C.inkSoft)),
        ),
      ],
    );
  }
}

// ====================================================================== PESTAÑA TECNICA
class TecnicaTab extends StatelessWidget {
  const TecnicaTab({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadView<List<Map<String, dynamic>>>(
      loader: () async => asList(await app.api.get('/api/content/exercises')),
      builder: (context, ejercicios, reload) {
        return PfList(onRefresh: reload, children: [
          const MascotNote('enfocado', 'Aprende la técnica antes de cargar peso: una buena ejecución te protege y te hace progresar más rápido.'),
          const SectionLabel('Catálogo de ejercicios'),
          RowCard([
            for (final e in ejercicios)
              RowTile(
                title: asStr(e['nombre']),
                sub: Fmt.capitalize(asStr(e['grupo_muscular'])),
                left: const IconDisc('dumbbell', tone: 'blue'),
                right: PfBadge(_nivelLabel(asStr(e['nivel'])), tone: _nivelTone(asStr(e['nivel']))),
                chevron: true,
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TecnicaDetalleScreen(ejercicioId: asInt(e['id'])))),
              ),
          ]),
          const SectionLabel('Más recursos'),
          PfCard(
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NutricionScreen())),
            child: Row(
              children: [
                const IconDisc('book-open', tone: 'green', size: 44),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Nutrición y asistente', style: Tx.body(size: 14, w: FontWeight.w700)),
                      Text('Consejos de alimentación y chat con IA', style: Tx.body(size: 11.5, color: C.inkMute)),
                    ],
                  ),
                ),
                const LIcon('chevron-right', size: 18, color: C.inkMute),
              ],
            ),
          ),
        ]);
      },
    );
  }
}

// ====================================================================== DETALLE DE EJERCICIO
class TecnicaDetalleScreen extends StatelessWidget {
  final int ejercicioId;
  const TecnicaDetalleScreen({super.key, required this.ejercicioId});

  Future<Map<String, dynamic>> _load() async {
    final d = asMap(await app.api.get('/api/content/exercises/$ejercicioId'));
    var restringido = false;
    try {
      final me = asMap(await app.api.get('/api/clinical/me/exercises'));
      for (final r in asList(me['restringidos'])) {
        if (asInt(r['id']) == ejercicioId) restringido = true;
      }
    } catch (_) {}
    return <String, dynamic>{'d': d, 'restringido': restringido};
  }

  static String _tipLabel(String t) {
    switch (t) {
      case 'error_comun':
        return 'Error común';
      case 'respiracion':
        return 'Respiración';
      default:
        return 'Consejo';
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Técnica',
      body: LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, data, reload) {
          final d = asMap(data['d']);
          final pasos = (d['pasos'] is List) ? (d['pasos'] as List).map((e) => e.toString()).toList() : <String>[];
          final tips = asList(d['tips']);
          final soportaCamara = asBool(d['soporta_camara']);
          final nombre = asStr(d['nombre']);
          final ytId = asStr(d['youtube_id']);

          return PfList(onRefresh: reload, children: [
            Row(
              children: [
                Expanded(child: Text(nombre, style: Tx.display(size: 24))),
                PfBadge(_nivelLabel(asStr(d['nivel'])), tone: _nivelTone(asStr(d['nivel']))),
              ],
            ),
            const SizedBox(height: 2),
            Text(Fmt.capitalize(asStr(d['grupo_muscular'])), style: Tx.body(size: 12.5, color: C.inkSoft)),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
              decoration: BoxDecoration(color: C.blueBg, borderRadius: BorderRadius.circular(C.rl)),
              child: _ytId.hasMatch(ytId)
                  ? _VideoTecnica(key: ValueKey(ytId), videoId: ytId)
                  : Column(
                      children: [
                        const Mascot('enfocado', size: 96, enter: true),
                        const SizedBox(height: 8),
                        Text('Video de técnica: próximamente', style: Tx.body(size: 12, w: FontWeight.w700, color: C.inkSoft)),
                      ],
                    ),
            ),
            const SizedBox(height: 14),
            Text(asStr(d['descripcion']), style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5)),
            const SizedBox(height: 12),
            if (asBool(data['restringido']))
              const PanelNote(
                'Este ejercicio puede no ser el más adecuado según tus indicadores de salud. Consúltalo con tu docente antes de aumentar la carga.',
                icon: 'triangle-alert',
                bg: C.yellowBg,
              ),
            if (pasos.isNotEmpty) ...[
              const SectionLabel('Puntos clave'),
              PfCard(
                child: Column(
                  children: [
                    for (var i = 0; i < pasos.length; i++)
                      Padding(
                        padding: EdgeInsets.only(bottom: i == pasos.length - 1 ? 0 : 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 24,
                              height: 24,
                              alignment: Alignment.center,
                              decoration: const BoxDecoration(color: C.goldBg, shape: BoxShape.circle),
                              child: Text('${i + 1}', style: Tx.mono(size: 11, w: FontWeight.w700)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(pasos[i].replaceFirst(RegExp(r'^\d+\.\s*'), ''), style: Tx.body(size: 13, height: 1.45)),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
            if (tips.isNotEmpty) ...[
              const SectionLabel('Errores comunes y consejos'),
              RowCard([
                for (final t in tips)
                  RowTile(
                    title: asStr(t['texto']),
                    sub: _tipLabel(asStr(t['tipo'])),
                    left: IconDisc(asStr(t['tipo']) == 'error_comun' ? 'triangle-alert' : 'check-circle', tone: asStr(t['tipo']) == 'error_comun' ? 'orange' : 'green', size: 34),
                  ),
              ]),
            ],
            const SizedBox(height: 4),
            if (soportaCamara)
              PfButton('Practicar contando repeticiones', kind: BtnKind.gold, icon: 'camera', onPressed: () {
                Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CamaraConteoScreen(ejercicioId: ejercicioId, nombre: nombre, slug: asStr(d['slug']))));
              }),
            if (soportaCamara) const SizedBox(height: 10),
            PfButton('Registrar sesión', kind: soportaCamara ? BtnKind.secondary : BtnKind.gold, icon: 'plus', onPressed: () {
              Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RegistrarSesionScreen(initialExerciseId: ejercicioId)));
            }),
            const SizedBox(height: 12),
            const PanelNote('Orientación educativa: no reemplaza a un entrenador certificado ni a un profesional de salud.', icon: 'shield-check'),
          ]);
        },
      ),
    );
  }
}

// ====================================================================== NUTRICION
class NutricionScreen extends StatelessWidget {
  const NutricionScreen({super.key});

  static String _icon(String c) {
    switch (c) {
      case 'hidratacion':
        return 'activity';
      case 'proteina':
        return 'dumbbell';
      case 'pre_entreno':
        return 'flame';
      case 'post_entreno':
        return 'battery-full';
      default:
        return 'book-open';
    }
  }

  static String _tone(String c) {
    switch (c) {
      case 'hidratacion':
        return 'blue';
      case 'proteina':
        return 'pink';
      case 'pre_entreno':
        return 'orange';
      case 'post_entreno':
        return 'green';
      default:
        return 'grey';
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Nutrición',
      body: LoadView<List<Map<String, dynamic>>>(
        loader: () async => asList(await app.api.get('/api/content/nutrition')),
        builder: (context, items, reload) {
          return PfList(onRefresh: reload, children: [
            const MascotNote('recuperando', 'Entrenar bien también es comer y descansar bien. Estos consejos son generales y económicos.'),
            for (final n in items) _NutriCard(n),
            const PanelNote('Son recomendaciones generales. Para un plan personalizado consulta a un nutricionista.', icon: 'shield-check'),
            PfCard(
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ChatbotScreen())),
              child: Row(
                children: [
                  const IconDisc('message-circle', tone: 'purple', size: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('¿Tienes dudas?', style: Tx.body(size: 14, w: FontWeight.w700)),
                        Text('Pregúntale al asistente PlayFit', style: Tx.body(size: 11.5, color: C.inkMute)),
                      ],
                    ),
                  ),
                  const LIcon('chevron-right', size: 18, color: C.inkMute),
                ],
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class _NutriCard extends StatefulWidget {
  final Map<String, dynamic> item;
  const _NutriCard(this.item);

  @override
  State<_NutriCard> createState() => _NutriCardState();
}

class _NutriCardState extends State<_NutriCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final cat = asStr(widget.item['categoria']);
    return PfCard(
      onTap: () => setState(() => _open = !_open),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconDisc(NutricionScreen._icon(cat), tone: NutricionScreen._tone(cat), size: 40),
              const SizedBox(width: 12),
              Expanded(child: Text(asStr(widget.item['titulo']), style: Tx.body(size: 14, w: FontWeight.w700))),
              Transform.rotate(angle: _open ? 1.5708 * 3 : 1.5708, child: const LIcon('chevron-right', size: 17, color: C.inkMute)),
            ],
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            alignment: Alignment.topCenter,
            child: _open
                ? Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(asStr(widget.item['cuerpo']), style: Tx.body(size: 13, color: C.inkSoft, height: 1.5)),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}
