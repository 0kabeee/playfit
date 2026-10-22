import '../common.dart';
import 'ranking.dart';

// ====================================================================== PESTAÑA SQUAD
class SquadTab extends StatelessWidget {
  const SquadTab({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      loader: () async => asMap(await app.api.get('/api/social/squads/me')),
      builder: (context, data, reload) {
        final squad = asMap(data['squad']);
        if (squad.isEmpty) {
          return PfList(onRefresh: reload, children: [
            EmptyState(
              pose: 'pensativo',
              title: 'Aún no perteneces a un squad',
              body: 'Entrena acompañado: crea un squad o únete con el código de un amigo.',
              actions: [
                PfButton('Crear o unirme a un squad', kind: BtnKind.gold, icon: 'users', onPressed: () => _push(context, const CrearUnirSquadScreen())),
              ],
            ),
          ]);
        }

        final miembros = asList(squad['miembros']);
        final resumen = asMap(squad['resumen']);
        final combinada = asInt(resumen['racha_combinada']);
        final liderId = asInt(squad['lider_id']);

        String pose;
        String note;
        if (combinada >= 20) {
          pose = 'energizado';
          note = '¡Tu squad está en llamas! Suman $combinada días de racha combinada.';
        } else if (combinada > 0) {
          pose = 'vamos';
          note = 'Entre todos suman $combinada días de racha. ¡Sigan así!';
        } else {
          pose = 'calentando';
          note = 'Hoy es un buen día para que el squad arranque su primera racha.';
        }

        final feed = asList(squad['feed']).take(12).toList();

        return PfList(
          onRefresh: reload,
          children: [
            Text(asStr(squad['nombre']), style: Tx.display(size: 24)),
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 14),
              child: Text('${miembros.length} integrantes · squad cerrado', style: Tx.body(size: 12.5, color: C.inkSoft)),
            ),
            MascotNote(pose, note),
            MetricGrid([
              MetricTile('Racha combinada', '$combinada días'),
              MetricTile('Sesiones esta semana', '${asInt(resumen['sesiones_semana'])}'),
            ]),
            const SectionLabel('Integrantes'),
            RowCard([
              for (final m in miembros)
                RowTile(
                  title: _memberTitle(m, liderId),
                  sub: 'Nivel ${asInt(m['nivel'])} · ${_lastTrain(m)}',
                  left: Avatar(
                    Fmt.initials(asStr(m['nombre']), asStr(m['apellido'])),
                    ring: ringForStreak(asInt(m['racha'])),
                    size: 40,
                  ),
                  right: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const LIcon('flame', size: 15, color: C.orange),
                      const SizedBox(width: 3),
                      Text('${asInt(m['racha'])}', style: Tx.mono(size: 13, w: FontWeight.w700)),
                    ],
                  ),
                  chevron: true,
                  onTap: () => _push(context, MiembroDetalleScreen(member: m, liderId: liderId)),
                ),
            ]),
            const SectionLabel('Actividad del squad'),
            if (feed.isEmpty)
              PfCard(child: Text('Todavía no hay actividad. ¡Registra la primera sesión!', style: Tx.body(size: 12.5, color: C.inkMute)))
            else
              PfCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Column(
                  children: [
                    for (var i = 0; i < feed.length; i++) _feedRow(feed[i], last: i == feed.length - 1),
                  ],
                ),
              ),
            const SizedBox(height: 6),
            PfButton('Invitar amigos', kind: BtnKind.gold, icon: 'plus', onPressed: () => _push(context, const InvitarScreen())),
            const SizedBox(height: 10),
            PfButton('Ver ranking', kind: BtnKind.secondary, icon: 'bar-chart-3', onPressed: () => _push(context, const RankingScreen())),
            const SizedBox(height: 10),
            Center(
              child: TextButton(
                onPressed: () => _leave(context),
                child: Text('Salir del squad', style: Tx.body(size: 12.5, w: FontWeight.w700, color: C.error)),
              ),
            ),
          ],
        );
      },
    );
  }

  static String _memberTitle(Map<String, dynamic> m, int liderId) {
    final bool yo = asInt(m['id']) == app.userId;
    final nombre = yo ? '${asStr(m['nombre'])} (tú)' : Fmt.shortName(asStr(m['nombre']), asStr(m['apellido']));
    return asInt(m['id']) == liderId ? '$nombre · líder' : nombre;
  }

  static String _lastTrain(Map<String, dynamic> m) {
    if (asBool(m['entreno_hoy'])) return 'entrenó hoy';
    final u = asStr(m['ultima_actividad']);
    return u.isEmpty ? 'sin sesiones aún' : 'último entreno: ${Fmt.dayLabel(u)}';
  }

  Widget _feedRow(Map<String, dynamic> f, {bool last = false}) {
    final d = asMap(f['detalle']);
    final bool yo = asInt(f['estudiante_id']) == app.userId;
    final nombre = yo ? 'Tú' : asStr(f['nombre']);
    String texto;
    switch (asStr(f['tipo'])) {
      case 'sesion':
        final ejs = d['ejercicios'] is List ? (d['ejercicios'] as List).map((e) => e.toString()).join(', ') : '';
        texto = '$nombre registró una sesión${ejs.isEmpty ? '' : ': $ejs'}';
        break;
      case 'record':
        texto = '$nombre superó su marca en ${asStr(d['ejercicio'])}';
        break;
      case 'racha':
        texto = '$nombre alcanzó una racha de ${asInt(d['dias'])} días';
        break;
      case 'reto_completado':
        texto = '$nombre completó el reto "${asStr(d['titulo'])}"';
        break;
      case 'insignia':
        texto = '$nombre consiguió la insignia "${asStr(d['nombre'])}"';
        break;
      case 'union':
        texto = asBool(d['fundador']) ? '$nombre creó el squad' : '$nombre se unió al squad';
        break;
      default:
        texto = '$nombre tuvo actividad';
    }
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.line))),
      child: Row(
        children: [
          Avatar(Fmt.initials(asStr(f['nombre'])), size: 30),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: Tx.body(size: 12.5, color: C.inkSoft, height: 1.35))),
          const SizedBox(width: 8),
          Text(Fmt.relative(asStr(f['created_at'])), style: Tx.body(size: 11, color: C.inkMute)),
        ],
      ),
    );
  }

  Future<void> _leave(BuildContext context) async {
    final ok = await confirmSheet(
      context,
      title: '¿Salir del squad?',
      body: 'Dejarás de ver la actividad de tu squad y de sumar a sus retos. Podrás unirte a otro cuando quieras.',
      action: 'Salir',
    );
    if (!ok) return;
    try {
      await app.api.post('/api/social/squads/leave');
      toast('Saliste del squad', type: ToastType.success);
      app.bump();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    }
  }

  static void _push(BuildContext context, Widget w) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => w));
  }
}

// ====================================================================== CREAR / UNIRSE
class CrearUnirSquadScreen extends StatefulWidget {
  const CrearUnirSquadScreen({super.key});

  @override
  State<CrearUnirSquadScreen> createState() => _CrearUnirSquadScreenState();
}

class _CrearUnirSquadScreenState extends State<CrearUnirSquadScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  String? _nameErr;
  String? _codeErr;
  bool _creating = false;
  bool _joining = false;

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    super.dispose();
  }

  void _done(String msg) {
    app.bump();
    shellTab.value = 1;
    toast(msg, type: ToastType.success);
    Navigator.of(context).popUntil((r) => r.isFirst);
  }

  Future<void> _create() async {
    FocusScope.of(context).unfocus();
    final n = _name.text.trim();
    if (n.length < 3) {
      setState(() => _nameErr = 'Mínimo 3 caracteres');
      return;
    }
    setState(() => _creating = true);
    try {
      await app.api.post('/api/social/squads', body: {'nombre': n});
      if (mounted) _done('Squad creado. ¡Invita a tus amigos!');
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _join() async {
    FocusScope.of(context).unfocus();
    final c = _code.text.trim().toUpperCase();
    if (c.length != 8) {
      setState(() => _codeErr = 'El código tiene 8 caracteres');
      return;
    }
    setState(() => _joining = true);
    try {
      final r = asMap(await app.api.post('/api/social/squads/join', body: {'codigo': c}));
      if (mounted) _done('Te uniste a ${asStr(r['nombre'])}');
    } on ApiException catch (e) {
      if (e.code == 'SQUAD_NO_ENCONTRADO') setState(() => _codeErr = 'No existe un squad con ese código');
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Crear o unirme',
      body: PfList(
        children: [
          const Center(child: Mascot('calentando', size: 112, enter: true)),
          const SizedBox(height: 8),
          PfCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Crear un squad', style: Tx.body(size: 15, w: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('Hasta 6 integrantes. Tú serás el líder.', style: Tx.body(size: 12, color: C.inkMute)),
                const SizedBox(height: 14),
                PfField(
                  label: 'Nombre del squad',
                  controller: _name,
                  hint: 'Ej. Los Titanes',
                  caps: TextCapitalization.words,
                  maxLength: 60,
                  error: _nameErr,
                  onChanged: (_) => setState(() => _nameErr = null),
                ),
                PfButton('Crear squad', kind: BtnKind.gold, loading: _creating, onPressed: _joining ? null : _create),
              ],
            ),
          ),
          PfCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Unirme con un código', style: Tx.body(size: 15, w: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('Pídele el código a quien creó el squad.', style: Tx.body(size: 12, color: C.inkMute)),
                const SizedBox(height: 14),
                PfField(
                  label: 'Código de invitación',
                  controller: _code,
                  hint: 'TIT4N001',
                  caps: TextCapitalization.characters,
                  maxLength: 8,
                  error: _codeErr,
                  onChanged: (_) => setState(() => _codeErr = null),
                ),
                PfButton('Unirme', kind: BtnKind.primary, loading: _joining, onPressed: _creating ? null : _join),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ====================================================================== INVITAR
class InvitarScreen extends StatelessWidget {
  const InvitarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Invitar amigos',
      body: LoadView<Map<String, dynamic>>(
        loader: () async => asMap(await app.api.get('/api/social/squads/me')),
        builder: (context, data, reload) {
          final squad = asMap(data['squad']);
          if (squad.isEmpty) {
            return PfList(onRefresh: reload, children: [
              EmptyState(
                pose: 'pensativo',
                title: 'Primero necesitas un squad',
                body: 'Crea uno o únete a uno existente para poder invitar amigos.',
                actions: [
                  PfButton('Crear o unirme', kind: BtnKind.gold, onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CrearUnirSquadScreen()));
                  }),
                ],
              ),
            ]);
          }
          final code = asStr(squad['codigo_invitacion']);
          return PfList(onRefresh: reload, children: [
            const Center(child: Mascot('vamos', size: 116, enter: true)),
            const SizedBox(height: 8),
            Center(child: Text(asStr(squad['nombre']), style: Tx.display(size: 22))),
            const SizedBox(height: 4),
            Center(child: Text('Comparte este código con tus amigos', style: Tx.body(size: 13, color: C.inkSoft))),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 22),
              decoration: BoxDecoration(
                color: C.surface,
                borderRadius: BorderRadius.circular(C.rm),
                border: Border.all(color: C.lineStrong, width: 1.6),
              ),
              child: Center(child: Text(code, style: Tx.mono(size: 30, w: FontWeight.w700, letter: 4))),
            ),
            const SizedBox(height: 14),
            PfButton('Copiar código', kind: BtnKind.gold, icon: 'check', onPressed: () async {
              await copyToClipboard(code);
              toast('Código copiado', type: ToastType.success);
            }),
            const SizedBox(height: 12),
            const PanelNote('Quien tenga el código puede unirse mientras haya cupo (máximo 6 integrantes).', icon: 'shield-check'),
          ]);
        },
      ),
    );
  }
}

// ====================================================================== DETALLE DE MIEMBRO
class MiembroDetalleScreen extends StatelessWidget {
  final Map<String, dynamic> member;
  final int liderId;
  const MiembroDetalleScreen({super.key, required this.member, required this.liderId});

  Future<Map<String, dynamic>> _load() async {
    final id = asInt(member['id']);
    final theirs = asList(await app.api.get('/api/social/records', query: {'student': '$id'}));
    var mine = <Map<String, dynamic>>[];
    if (id != app.userId) mine = asList(await app.api.get('/api/social/records'));
    return <String, dynamic>{'theirs': theirs, 'mine': mine};
  }

  @override
  Widget build(BuildContext context) {
    final id = asInt(member['id']);
    final bool yo = id == app.userId;
    final nombre = asStr(member['nombre']);
    final racha = asInt(member['racha']);

    return PfScaffold(
      title: yo ? 'Tu progreso' : nombre,
      body: LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, data, reload) {
          final theirs = asList(data['theirs']);
          final mine = asList(data['mine']);
          final withWeight = theirs.where((r) => r['mejor_peso_kg'] != null).toList();

          // comparacion: ejercicios con peso en ambos
          final comps = <Map<String, dynamic>>[];
          int ahead = 0;
          int behind = 0;
          if (!yo) {
            for (final t in withWeight) {
              for (final m in mine) {
                if (asInt(m['ejercicio_id']) == asInt(t['ejercicio_id']) && m['mejor_peso_kg'] != null) {
                  final delta = asNum(m['mejor_peso_kg']) - asNum(t['mejor_peso_kg']);
                  comps.add(<String, dynamic>{
                    'nombre': asStr(t['nombre']),
                    'mine': asNum(m['mejor_peso_kg']),
                    'theirs': asNum(t['mejor_peso_kg']),
                    'delta': delta,
                  });
                  if (delta > 0) ahead++;
                  if (delta < 0) behind++;
                }
              }
            }
          }

          String? notePose;
          String? noteText;
          if (comps.isNotEmpty) {
            if (behind > ahead) {
              notePose = 'entrenando';
              noteText = '$nombre te lleva ventaja en ${behind == 1 ? 'una marca' : '$behind marcas'}. ¡Es buen momento para alcanzarle!';
            } else if (ahead > 0) {
              notePose = 'yeah';
              noteText = 'Vas adelante de $nombre en la mayoría de tus marcas. ¡Sigue así!';
            } else {
              notePose = 'feliz';
              noteText = 'Van parejos con $nombre. ¡Qué buena competencia!';
            }
          }

          return PfList(onRefresh: reload, children: [
            Center(child: Avatar(Fmt.initials(nombre, asStr(member['apellido'])), size: 64, ring: ringForStreak(racha))),
            const SizedBox(height: 14),
            Center(child: Text(yo ? '${Fmt.shortName(nombre, asStr(member['apellido']))} (tú)' : Fmt.shortName(nombre, asStr(member['apellido'])), style: Tx.display(size: 22))),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                PfBadge('Nivel ${asInt(member['nivel'])}', tone: 'gold'),
                if (id == liderId) ...[const SizedBox(width: 6), const PfBadge('Líder', tone: 'purple', icon: 'users')],
              ],
            ),
            const SizedBox(height: 16),
            PfCard(
              child: Row(
                children: [
                  const IconDisc('flame', tone: 'orange', size: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('$racha ${racha == 1 ? 'día' : 'días'} de racha', style: Tx.body(size: 15, w: FontWeight.w800)),
                        Text(asBool(member['entreno_hoy']) ? 'Entrenó hoy' : 'Último entreno: ${Fmt.dayLabel(asStr(member['ultima_actividad']))}', style: Tx.body(size: 11.5, color: C.inkMute)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            MetricGrid([
              MetricTile('XP total', '${asInt(member['xp_total'])}'),
              MetricTile('Insignias', '${asInt(member['insignias'])}'),
            ]),
            if (notePose != null && noteText != null) MascotNote(notePose, noteText),
            const SectionLabel('Marcas personales'),
            if (withWeight.isEmpty)
              PfCard(child: Text('Aún no registra ejercicios con peso.', style: Tx.body(size: 12.5, color: C.inkMute)))
            else
              RowCard([
                for (final r in withWeight.take(4))
                  RowTile(
                    title: asStr(r['nombre']),
                    sub: '${asInt(r['mejores_reps'])} reps máx.',
                    left: const IconDisc('dumbbell', tone: 'blue'),
                    right: Text(Fmt.kg(asNum(r['mejor_peso_kg'])), style: Tx.mono(size: 13, w: FontWeight.w700)),
                  ),
              ]),
            if (!yo) ...[
              const SectionLabel('Comparado contigo'),
              if (comps.isEmpty)
                PfCard(child: Text('Aún no tienen ejercicios con peso en común.', style: Tx.body(size: 12.5, color: C.inkMute)))
              else
                RowCard([
                  for (final c in comps)
                    RowTile(
                      title: asStr(c['nombre']),
                      sub: 'Tú ${Fmt.kg(asNum(c['mine']))} · $nombre ${Fmt.kg(asNum(c['theirs']))}',
                      right: asNum(c['delta']) > 0
                          ? PfBadge('Vas +${Fmt.kg(asNum(c['delta']))}', tone: 'green')
                          : (asNum(c['delta']) < 0 ? PfBadge('Te lleva ${Fmt.kg(-asNum(c['delta']))}', tone: 'orange') : const PfBadge('Igual', tone: 'grey')),
                    ),
                ]),
            ],
            const SizedBox(height: 4),
            const PanelNote('Solo se comparten estadísticas de entrenamiento. Nunca tu historial clínico ni tu peso corporal.', icon: 'shield-check'),
          ]);
        },
      ),
    );
  }
}
