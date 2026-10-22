import '../common.dart';

// ====================================================================== RANKING
class RankingScreen extends StatefulWidget {
  const RankingScreen({super.key});

  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  int _tab = 0;
  List<Map<String, dynamic>> _ejercicios = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _loadExercises();
  }

  Future<void> _loadExercises() async {
    try {
      final list = asList(await app.api.get('/api/content/exercises'));
      if (mounted) setState(() => _ejercicios = list);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final labels = <String>['General', for (final e in _ejercicios) asStr(e['nombre'])];
    if (_tab >= labels.length) _tab = 0;
    return PfScaffold(
      title: 'Ranking',
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Segmented(labels: labels, selected: _tab, scroll: true, onChanged: (i) => setState(() => _tab = i)),
          ),
          Expanded(
            child: _tab == 0
                ? const _GeneralRanking(key: ValueKey<String>('general'))
                : _ExerciseRanking(key: ValueKey<int>(asInt(_ejercicios[_tab - 1]['id'])), ejercicioId: asInt(_ejercicios[_tab - 1]['id'])),
          ),
        ],
      ),
    );
  }
}

Widget _position(int puesto) {
  Color bg = C.line;
  Color fg = C.inkSoft;
  if (puesto == 1) {
    bg = C.gold;
    fg = C.ink;
  } else if (puesto == 2) {
    bg = const Color(0xFFD9D4C9);
    fg = C.ink;
  } else if (puesto == 3) {
    bg = const Color(0xFFD9B08C);
    fg = C.ink;
  }
  return Container(
    width: 28,
    height: 28,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
    child: Text('$puesto', style: Tx.mono(size: 12, w: FontWeight.w700, color: fg)),
  );
}

String _name(Map<String, dynamic> r) {
  if (asBool(r['es_yo'])) return '${asStr(r['nombre'])} (tú)';
  return Fmt.shortName(asStr(r['nombre']), asStr(r['apellido']));
}

class _GeneralRanking extends StatelessWidget {
  const _GeneralRanking({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadView<List<Map<String, dynamic>>>(
      loader: () async => asList(await app.api.get('/api/social/rankings/xp', query: {'limit': '30'})),
      builder: (context, rows, reload) {
        if (rows.isEmpty) {
          return PfList(onRefresh: reload, children: const [
            EmptyState(pose: 'pensativo', title: 'Aún no hay ranking', body: 'Cuando se registren las primeras sesiones aparecerán aquí.'),
          ]);
        }
        return PfList(onRefresh: reload, children: [
          RowCard([
            for (final r in rows)
              RowTile(
                title: _name(r),
                sub: 'Nivel ${asInt(r['nivel'])} · racha ${asInt(r['racha'])}',
                left: Row(mainAxisSize: MainAxisSize.min, children: [
                  _position(asInt(r['puesto'])),
                  const SizedBox(width: 10),
                  Avatar(Fmt.initials(asStr(r['nombre']), asStr(r['apellido'])), size: 36),
                ]),
                right: Text('${asInt(r['xp_total'])} XP', style: Tx.mono(size: 12.5, w: FontWeight.w700)),
              ),
          ]),
          const PanelNote('El ranking muestra solo tu nombre y la inicial del apellido de los demás.', icon: 'shield-check'),
        ]);
      },
    );
  }
}

class _ExerciseRanking extends StatelessWidget {
  final int ejercicioId;
  const _ExerciseRanking({super.key, required this.ejercicioId});

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      loader: () async => asMap(await app.api.get('/api/social/rankings/exercises/$ejercicioId', query: {'limit': '30'})),
      builder: (context, data, reload) {
        final rows = asList(data['ranking']);
        final unidad = asStr(data['unidad'], 'reps');
        if (rows.isEmpty) {
          return PfList(onRefresh: reload, children: const [
            EmptyState(pose: 'pensativo', title: 'Nadie ha registrado este ejercicio', body: 'Sé el primero en aparecer en este ranking.'),
          ]);
        }
        return PfList(onRefresh: reload, children: [
          RowCard([
            for (final r in rows)
              RowTile(
                title: _name(r),
                sub: asNum(r['mejor_peso_kg']) > 0 ? 'Mejor peso: ${Fmt.kg(asNum(r['mejor_peso_kg']))}' : 'Esta semana: ${asInt(r['semana_actual'])} $unidad',
                left: Row(mainAxisSize: MainAxisSize.min, children: [
                  _position(asInt(r['puesto'])),
                  const SizedBox(width: 10),
                  Avatar(Fmt.initials(asStr(r['nombre']), asStr(r['apellido'])), size: 36),
                ]),
                right: Row(mainAxisSize: MainAxisSize.min, children: [
                  _trend(asStr(r['tendencia'])),
                  const SizedBox(width: 6),
                  Text('${asInt(r['total'])} $unidad', style: Tx.mono(size: 12, w: FontWeight.w700)),
                ]),
              ),
          ]),
          const PanelNote('La flecha compara esta semana con la anterior.', icon: 'activity'),
        ]);
      },
    );
  }

  Widget _trend(String t) {
    if (t == 'sube') return Text('▲', style: Tx.body(size: 11, color: C.green));
    if (t == 'baja') return Text('▼', style: Tx.body(size: 11, color: C.error));
    return Text('–', style: Tx.body(size: 12, color: C.inkMute));
  }
}

// ====================================================================== INSIGNIAS
class InsigniasScreen extends StatelessWidget {
  const InsigniasScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Insignias',
      body: LoadView<List<Map<String, dynamic>>>(
        loader: () async => asList(await app.api.get('/api/social/badges')),
        builder: (context, badges, reload) {
          final got = badges.where((b) => asBool(b['obtenida'])).length;
          return PfList(onRefresh: reload, children: [
            MascotNote(got == 0 ? 'calentando' : 'logro', got == 0 ? 'Registra tu primera sesión para ganar tu primera insignia.' : '¡Llevas $got de ${badges.length} insignias! Sigue entrenando por las demás.'),
            LayoutBuilder(builder: (context, c) {
              final w = (c.maxWidth - 12) / 2;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [for (final b in badges) SizedBox(width: w, child: _BadgeTile(b))],
              );
            }),
          ]);
        },
      ),
    );
  }
}

class _BadgeTile extends StatelessWidget {
  final Map<String, dynamic> b;
  const _BadgeTile(this.b);

  @override
  Widget build(BuildContext context) {
    final got = asBool(b['obtenida']);
    return Opacity(
      opacity: got ? 1 : 0.5,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: C.surface,
          border: Border.all(color: got ? C.gold : C.line, width: got ? 1.6 : 1),
          borderRadius: BorderRadius.circular(C.rm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconDisc(got ? 'medal' : 'lock', tone: got ? 'gold' : 'grey', size: 44),
            const SizedBox(height: 10),
            Text(asStr(b['nombre']), style: Tx.body(size: 13.5, w: FontWeight.w800)),
            const SizedBox(height: 3),
            Text(asStr(b['descripcion']), style: Tx.body(size: 11.5, color: C.inkMute, height: 1.4)),
            const SizedBox(height: 8),
            Text(
              got ? 'Obtenida ${Fmt.dayLabel(asStr(b['obtenida_at']))}' : 'Bloqueada',
              style: Tx.body(size: 11, w: FontWeight.w700, color: got ? C.green : C.inkMute),
            ),
          ],
        ),
      ),
    );
  }
}
