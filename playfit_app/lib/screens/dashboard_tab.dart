import '../common.dart';
import 'retos.dart';
import 'sesiones.dart';
import 'squad.dart';

class DashboardTab extends StatelessWidget {
  const DashboardTab({super.key});

  Future<Map<String, dynamic>> _load() async {
    final dash = asMap(await app.api.get('/api/social/dashboard'));
    Map<String, dynamic>? squad;
    final sq = asMap(dash['squad']);
    if (sq.isNotEmpty) {
      try {
        squad = asMap(await app.api.get('/api/social/squads/${sq['id']}'));
      } catch (_) {}
    }
    app.refreshUnread();
    return <String, dynamic>{'dash': dash, 'squad': squad};
  }

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      loader: _load,
      builder: (context, data, reload) {
        final dash = asMap(data['dash']);
        final squad = data['squad'] == null ? null : asMap(data['squad']);
        final hasSquad = asMap(dash['squad']).isNotEmpty;
        final racha = asInt(dash['racha_actual']);
        final xp = asInt(dash['xp_total']);
        final semana = asList(dash['semana']);
        final trained = semana.where((d) => asBool(d['entreno'])).length;
        final entrenoHoy = asBool(dash['entreno_hoy']);
        final reto = asMap(dash['reto_en_vivo']);
        final pending = app.myPending.length;

        // ---- estado vacio: cuenta nueva sin actividad ni squad ----
        if (xp == 0 && !hasSquad) {
          return PfList(onRefresh: reload, children: [
            EmptyState(
              pose: 'listo_manana',
              title: 'Te damos la bienvenida a PlayFit',
              body: 'Únete a un squad o registra tu primera sesión para empezar tu racha.',
              actions: [
                PfButton('Registrar sesión', kind: BtnKind.gold, icon: 'plus', onPressed: () => _go(context, const RegistrarSesionScreen())),
                PfButton('Unirme a un squad', kind: BtnKind.secondary, onPressed: () => _go(context, const CrearUnirSquadScreen())),
              ],
            ),
          ]);
        }

        String pose;
        Color stage;
        String greet;
        String sub;
        if (racha >= 7) {
          pose = 'energizado';
          stage = C.brownBg;
          greet = '¡Estás imparable!';
          sub = '$racha días seguidos';
        } else if (racha > 0) {
          pose = 'vamos';
          stage = C.brownBg;
          greet = '¡Vamos bien!';
          sub = '$trained de 7 días esta semana';
        } else {
          pose = 'triste';
          stage = C.blueBg;
          greet = '¿Todo bien?';
          sub = 'Hoy es un buen día para empezar una racha nueva';
        }
        if (entrenoHoy) sub = 'Hoy ya entrenaste · $sub';

        const letras = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

        return PfList(
          onRefresh: reload,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          children: [
            PfCard(
              lidcap: true,
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  MascotStage(pose, color: stage, size: 128, enter: true),
                  const SizedBox(height: 12),
                  Text(greet, style: Tx.display(size: 22)),
                  const SizedBox(height: 2),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(sub, textAlign: TextAlign.center, style: Tx.body(size: 12.5, color: C.inkSoft)),
                  ),
                ],
              ),
            ),
            if (pending > 0)
              PanelNote(
                'Tienes $pending sesión(es) guardada(s) sin conexión. Se enviarán automáticamente.',
                icon: 'wifi-off',
                bg: C.yellowBg,
              ),
            // ---- racha ----
            PfCard(
              child: Column(
                children: [
                  Row(
                    children: [
                      const IconDisc('flame', tone: 'orange', size: 46),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('$racha ${racha == 1 ? 'día' : 'días'} de racha', style: Tx.body(size: 15, w: FontWeight.w800)),
                            Text('Tu mejor racha: ${asInt(dash['racha_maxima'])} días', style: Tx.body(size: 11.5, color: C.inkMute)),
                          ],
                        ),
                      ),
                      PfBadge('Nivel ${asInt(dash['nivel'])}', tone: 'gold'),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      for (var i = 0; i < 7; i++)
                        _DayDot(
                          letter: letras[i],
                          trained: i < semana.length && asBool(semana[i]['entreno']),
                          today: i < semana.length && asBool(semana[i]['es_hoy']),
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Text('${asInt(dash['xp_en_nivel'])} / ${asInt(dash['xp_en_nivel']) + asInt(dash['xp_para_siguiente'])} XP', style: Tx.mono(size: 11, color: C.inkSoft)),
                      const Spacer(),
                      Text('Puesto #${asInt(dash['puesto'])}', style: Tx.body(size: 11.5, w: FontWeight.w700, color: C.inkSoft)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  PfProgress(asNum(dash['porcentaje']).toDouble(), height: 7),
                ],
              ),
            ),
            // ---- reto activo ----
            if (reto.isNotEmpty)
              PfCard(
                onTap: () => _go(context, RetoDetalleScreen(retoId: asInt(reto['id']))),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        IconDisc(metricIcon(asStr(reto['metrica'])), tone: metricTone(asStr(reto['metrica']))),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(asStr(reto['titulo']), style: Tx.body(size: 14, w: FontWeight.w700)),
                              Text(tipoRetoLabel(asStr(reto['tipo'])), style: Tx.body(size: 11.5, color: C.inkMute)),
                            ],
                          ),
                        ),
                        PfBadge('${asInt(reto['dias_restantes'])} días', tone: 'blue'),
                      ],
                    ),
                    const SizedBox(height: 12),
                    PfProgress(asNum(reto['porcentaje']).toDouble()),
                    const SizedBox(height: 7),
                    Text(
                      '${asInt(reto['progreso'])} de ${asInt(reto['meta'])} ${metricUnit(asStr(reto['metrica']))}',
                      style: Tx.body(size: 12, w: FontWeight.w600, color: C.inkSoft),
                    ),
                  ],
                ),
              ),
            // ---- squad ----
            if (hasSquad && squad != null) _squadCard(context, squad),
            const SizedBox(height: 4),
            PfButton('Registrar sesión', kind: BtnKind.gold, icon: 'plus', onPressed: () => _go(context, const RegistrarSesionScreen())),
          ],
        );
      },
    );
  }

  Widget _squadCard(BuildContext context, Map<String, dynamic> squad) {
    final miembros = asList(squad['miembros']);
    final lider = miembros.isEmpty ? '' : asStr(miembros.first['nombre']);
    return PfCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(asStr(squad['nombre']), style: Tx.body(size: 14, w: FontWeight.w800))),
              GestureDetector(
                onTap: () => shellTab.value = 1,
                child: Text('Ver squad', style: Tx.body(size: 12.5, w: FontWeight.w700, color: C.blue)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              AvatarStack([for (final m in miembros) Fmt.initials(asStr(m['nombre']), asStr(m['apellido']))]),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  lider.isEmpty ? '' : '$lider lidera el ranking de tu squad',
                  style: Tx.body(size: 12, color: C.inkSoft),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _go(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }
}

class _DayDot extends StatelessWidget {
  final String letter;
  final bool trained;
  final bool today;
  const _DayDot({required this.letter, required this.trained, required this.today});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(letter, style: Tx.body(size: 11, w: FontWeight.w700, color: today ? C.ink : C.inkMute)),
        const SizedBox(height: 6),
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: trained ? C.gold : Colors.transparent,
            border: Border.all(color: trained ? C.gold : (today ? C.ink : C.line), width: 1.8),
          ),
          child: trained ? const Center(child: LIcon('check', size: 15, color: C.ink)) : null,
        ),
      ],
    );
  }
}
