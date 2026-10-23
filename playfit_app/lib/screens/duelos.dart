import '../common.dart';
import 'crear_reto.dart';

// ====================================================================== DUELOS 1 VS 1
/// Duelos entre miembros del mismo squad. El ganador se decide con las sesiones reales registradas
/// durante los dias del duelo y recibe XP (la fija el servidor).
class DuelosScreen extends StatefulWidget {
  const DuelosScreen({super.key});

  @override
  State<DuelosScreen> createState() => _DuelosScreenState();
}

class _DuelosScreenState extends State<DuelosScreen> {
  final Set<int> _busy = <int>{};

  Future<void> _accion(int id, Future<dynamic> Function() llamada, String ok) async {
    setState(() => _busy.add(id));
    try {
      await llamada();
      toast(ok, type: ToastType.success);
      app.bump();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
      app.bump();
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _retar() async {
    final creado = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => const RetarScreen()));
    if (creado == true) app.bump();
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Duelos 1 vs 1',
      body: LoadView<Map<String, dynamic>>(
        loader: () async => asMap(await app.api.get('/api/social/duels')),
        builder: (context, d, reload) {
          final recibidos = asList(d['recibidos']);
          final enviados = asList(d['enviados']);
          final activos = asList(d['activos']);
          final historial = asList(d['historial']);
          final reglas = asMap(d['reglas']);
          final vacio = recibidos.isEmpty && enviados.isEmpty && activos.isEmpty && historial.isEmpty;
          return PfList(onRefresh: reload, children: [
            if (vacio)
              EmptyState(
                pose: 'vamos',
                title: 'Reta a alguien de tu squad',
                body: 'Elijan un ejercicio y unos días. Gana quien más avance con sus sesiones reales: +${asInt(reglas['xp_ganador'], 60)} XP.',
                actions: [PfButton('Retar a un compañero', kind: BtnKind.gold, icon: 'target', onPressed: _retar)],
              )
            else ...[
              PfButton('Retar a un compañero', kind: BtnKind.gold, icon: 'target', onPressed: _retar),
              const SizedBox(height: 4),
            ],
            if (recibidos.isNotEmpty) ...[
              const SectionLabel('Te retaron'),
              for (final x in recibidos) _pendienteRecibido(x),
            ],
            if (activos.isNotEmpty) ...[
              const SectionLabel('En curso'),
              for (final x in activos) _activo(x),
            ],
            if (enviados.isNotEmpty) ...[
              const SectionLabel('Esperando respuesta'),
              for (final x in enviados) _enviado(x),
            ],
            if (historial.isNotEmpty) ...[
              const SectionLabel('Últimos 30 días'),
              RowCard([for (final x in historial) _historialRow(x)]),
            ],
            if (!vacio)
              PanelNote(
                'Máximo ${asInt(reglas['max_abiertos'], 3)} duelos abiertos y ${asInt(reglas['max_dias'], 7)} días por duelo. '
                'Si nadie entrena, es empate sin XP. Un duelo sin respuesta vence a los 3 días.',
                icon: 'shield-check',
              ),
          ]);
        },
      ),
    );
  }

  static String _rivalNombre(Map<String, dynamic> x) {
    final r = asMap(x['rival']);
    return Fmt.shortName(asStr(r['nombre']), asStr(r['apellido']));
  }

  static String _resumen(Map<String, dynamic> x) {
    final dias = asInt(x['dias']);
    return '${metricLabel(asStr(x['metrica']))}${asStr(x['ejercicio']).isEmpty ? '' : ' · ${asStr(x['ejercicio'])}'} · $dias ${dias == 1 ? 'día' : 'días'}';
  }

  Widget _cabecera(Map<String, dynamic> x, {Widget? right}) {
    final r = asMap(x['rival']);
    return Row(
      children: [
        Avatar(Fmt.initials(asStr(r['nombre']), asStr(r['apellido'])), size: 40),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_rivalNombre(x), style: Tx.body(size: 14, w: FontWeight.w700)),
              Text(_resumen(x), style: Tx.body(size: 11.5, color: C.inkMute)),
            ],
          ),
        ),
        if (right != null) right,
      ],
    );
  }

  Widget _pendienteRecibido(Map<String, dynamic> x) {
    final id = asInt(x['id']);
    final busy = _busy.contains(id);
    return PfCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cabecera(x, right: const PfBadge('Nuevo', tone: 'gold')),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: PfButton('Rechazar', kind: BtnKind.secondary, small: true, onPressed: busy
                    ? null
                    : () => _accion(id, () => app.api.post('/api/social/duels/$id/respond', body: {'aceptar': false}), 'Duelo rechazado')),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PfButton('Aceptar', kind: BtnKind.gold, small: true, loading: busy, onPressed: busy
                    ? null
                    : () => _accion(id, () => app.api.post('/api/social/duels/$id/respond', body: {'aceptar': true}), '¡Duelo aceptado! Empieza hoy.')),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _enviado(Map<String, dynamic> x) {
    final id = asInt(x['id']);
    return PfCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cabecera(x, right: const PfBadge('Pendiente', tone: 'grey')),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _busy.contains(id) ? null : () => _accion(id, () => app.api.post('/api/social/duels/$id/cancel'), 'Duelo cancelado'),
              child: Text('Cancelar duelo', style: Tx.body(size: 12.5, w: FontWeight.w700, color: C.error)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _activo(Map<String, dynamic> x) {
    final yo = asInt(x['mi_progreso']);
    final el = asInt(x['su_progreso']);
    final total = yo > el ? yo : el;
    final unidad = metricUnit(asStr(x['metrica']));
    final dias = asInt(x['dias_restantes']);
    final String estado = yo > el ? 'Vas ganando' : (yo < el ? 'Vas perdiendo' : 'Empatados');
    Widget barra(String quien, int v, Color color) => Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(quien, style: Tx.body(size: 12, w: FontWeight.w700, color: C.inkSoft))),
                Text('$v $unidad', style: Tx.mono(size: 12.5, w: FontWeight.w700)),
              ]),
              const SizedBox(height: 5),
              PfProgress(total == 0 ? 0.0 : v * 100 / total, color: color),
            ],
          ),
        );
    return PfCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cabecera(x, right: PfBadge(dias == 0 ? 'Último día' : '$dias ${dias == 1 ? 'día' : 'días'}', tone: 'blue')),
          barra('Tú', yo, C.gold),
          barra(_rivalNombre(x), el, C.lineStrong),
          const SizedBox(height: 10),
          Text('$estado · el ganador recibe +${asInt(x['xp_ganador'], 60)} XP', style: Tx.body(size: 12, w: FontWeight.w700, color: yo >= el ? C.green : C.orange)),
        ],
      ),
    );
  }

  RowTile _historialRow(Map<String, dynamic> x) {
    final estado = asStr(x['estado']);
    final res = asStr(x['resultado']);
    String sub;
    PfBadge badge;
    switch (estado) {
      case 'finalizado':
        sub = '${asInt(x['mi_progreso'])} vs ${asInt(x['su_progreso'])} · ${_resumen(x)}';
        badge = res == 'gane'
            ? const PfBadge('Ganaste', tone: 'green', icon: 'medal')
            : (res == 'perdi' ? const PfBadge('Perdiste', tone: 'orange') : const PfBadge('Empate', tone: 'grey'));
        break;
      case 'rechazado':
        sub = _resumen(x);
        badge = const PfBadge('Rechazado', tone: 'grey');
        break;
      case 'expirado':
        sub = _resumen(x);
        badge = const PfBadge('Sin respuesta', tone: 'grey');
        break;
      default:
        sub = _resumen(x);
        badge = const PfBadge('Cancelado', tone: 'grey');
    }
    return RowTile(title: _rivalNombre(x), sub: sub, left: IconDisc(metricIcon(asStr(x['metrica'])), tone: metricTone(asStr(x['metrica']))), right: badge);
  }
}

// ====================================================================== RETAR A UN COMPANERO
class RetarScreen extends StatefulWidget {
  final int? rivalId;
  const RetarScreen({super.key, this.rivalId});

  @override
  State<RetarScreen> createState() => _RetarScreenState();
}

class _RetarScreenState extends State<RetarScreen> {
  static const _metricas = ['reps', 'sesiones', 'peso_maximo'];
  int? _rival;
  int _metrica = 0;
  int _dias = 3;
  Map<String, dynamic>? _ejercicio;
  List<Map<String, dynamic>> _ejercicios = <Map<String, dynamic>>[];
  bool _busy = false;
  String? _err;

  String get _m => _metricas[_metrica];

  @override
  void initState() {
    super.initState();
    _rival = widget.rivalId;
  }

  Future<Map<String, dynamic>> _load() async {
    final squad = asMap(asMap(await app.api.get('/api/social/squads/me'))['squad']);
    try {
      _ejercicios = await cargarEjerciciosReps();
    } catch (_) {
      // se reintenta al elegir ejercicio
    }
    return squad;
  }

  Future<void> _pickEjercicio() async {
    if (_ejercicios.isEmpty) {
      try {
        _ejercicios = await cargarEjerciciosReps();
      } on ApiException catch (e) {
        toast(e.message, type: ToastType.error);
        return;
      }
    }
    if (!mounted) return;
    final e = await elegirEjercicio(context, _ejercicios, actual: asInt(_ejercicio?['id']));
    if (e != null) setState(() => _ejercicio = e);
  }

  Future<void> _enviar() async {
    if (_rival == null) {
      setState(() => _err = 'Elige a quién quieres retar.');
      return;
    }
    if (_m != 'sesiones' && _ejercicio == null) {
      setState(() => _err = 'Elige el ejercicio del duelo.');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await app.api.post('/api/social/duels', body: {
        'rival_id': _rival,
        'metrica': _m,
        if (_m != 'sesiones') 'ejercicio_id': asInt(_ejercicio!['id']),
        'dias': _dias,
      });
      toast('Reto enviado. Te avisaremos cuando responda.', type: ToastType.success);
      app.bump();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _err = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Retar a un duelo',
      body: LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, squad, reload) {
          if (squad.isEmpty) {
            return PfList(children: const [
              EmptyState(pose: 'pensativo', title: 'Necesitas un squad', body: 'Los duelos son entre compañeros del mismo squad. Crea uno o únete con un código.'),
            ]);
          }
          final otros = asList(squad['miembros']).where((m) => asInt(m['id']) != app.userId).toList();
          if (otros.isEmpty) {
            return PfList(children: const [
              EmptyState(pose: 'calentando', title: 'Tu squad está solo', body: 'Invita amigos con el código del squad para poder retarlos.'),
            ]);
          }
          return PfList(children: [
            const FieldLabel('¿A quién retas?'),
            RowCard([
              for (final m in otros)
                RowTile(
                  title: Fmt.shortName(asStr(m['nombre']), asStr(m['apellido'])),
                  sub: 'Nivel ${asInt(m['nivel'])} · racha ${asInt(m['racha'])}',
                  left: Avatar(Fmt.initials(asStr(m['nombre']), asStr(m['apellido'])), size: 36),
                  right: _rival == asInt(m['id']) ? const LIcon('check-circle', size: 20, color: C.green) : null,
                  onTap: () => setState(() {
                    _rival = asInt(m['id']);
                    _err = null;
                  }),
                ),
            ]),
            const FieldLabel('¿En qué compiten?'),
            Segmented(
              labels: const ['Repeticiones', 'Sesiones', 'Peso máx.'],
              selected: _metrica,
              onChanged: (i) => setState(() {
                _metrica = i;
                _err = null;
              }),
            ),
            if (_m != 'sesiones')
              RowCard([
                RowTile(
                  title: _ejercicio == null ? 'Elegir ejercicio' : asStr(_ejercicio!['nombre']),
                  sub: _m == 'reps' ? 'Gana quien sume más repeticiones' : 'Gana quien levante más peso',
                  left: IconDisc(metricIcon(_m), tone: metricTone(_m)),
                  chevron: true,
                  onTap: _pickEjercicio,
                ),
              ])
            else
              const PanelNote('Gana quien registre más sesiones durante el duelo.', icon: 'flame'),
            const FieldLabel('Duración'),
            Stepper1(value: _dias, min: 1, max: 7, suffix: _dias == 1 ? ' día' : ' días', onChanged: (v) => setState(() => _dias = v)),
            const PanelNote('Empieza el día en que tu compañero acepta. Si no responde en 3 días, el reto vence.', icon: 'clock'),
            if (_err != null)
              Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(_err!, style: Tx.body(size: 12.5, w: FontWeight.w600, color: C.error))),
            PfButton('Enviar reto', kind: BtnKind.gold, icon: 'target', loading: _busy, onPressed: _enviar),
          ]);
        },
      ),
    );
  }
}
