import '../common.dart';

/// Lista de ejercicios que se miden por repeticiones (para retos y duelos de reps o peso maximo).
Future<List<Map<String, dynamic>>> cargarEjerciciosReps() async {
  final list = asList(await app.api.get('/api/content/exercises'));
  return list.where((e) => asBool(e['mide_reps'])).toList();
}

/// Hoja para elegir un ejercicio. Devuelve el ejercicio elegido o null.
Future<Map<String, dynamic>?> elegirEjercicio(BuildContext context, List<Map<String, dynamic>> ejercicios, {int? actual}) {
  return showPfSheet<Map<String, dynamic>>(
    context,
    (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Elige el ejercicio', style: Tx.display(size: 19)),
        const SizedBox(height: 10),
        for (var i = 0; i < ejercicios.length; i++)
          RowTile(
            title: asStr(ejercicios[i]['nombre']),
            sub: Fmt.capitalize(asStr(ejercicios[i]['grupo_muscular'])),
            last: i == ejercicios.length - 1,
            right: asInt(ejercicios[i]['id']) == actual ? const LIcon('check', size: 18) : null,
            onTap: () => Navigator.pop(ctx, ejercicios[i]),
          ),
      ],
    ),
  );
}

/// Etiqueta en mayusculas como la de PfField (para selectores que no son campos de texto).
class FieldLabel extends StatelessWidget {
  final String text;
  const FieldLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text.toUpperCase(), style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
      );
}

/// Selector de un numero entero con botones - / + (dias, etc.)
class Stepper1 extends StatelessWidget {
  final int value;
  final int min;
  final int max;
  final String suffix;
  final ValueChanged<int> onChanged;
  const Stepper1({super.key, required this.value, required this.min, required this.max, required this.onChanged, this.suffix = ''});

  @override
  Widget build(BuildContext context) {
    Widget btn(String label, int next, bool enabled) => SizedBox(
          width: 44,
          child: PfButton(label, kind: BtnKind.secondary, small: true, onPressed: enabled ? () => onChanged(next) : null),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          btn('−', value - 1, value > min),
          Expanded(child: Center(child: Text('$value$suffix', style: Tx.mono(size: 18, w: FontWeight.w700)))),
          btn('+', value + 1, value < max),
        ],
      ),
    );
  }
}

// ====================================================================== CREAR RETO EN EL SQUAD
/// Cualquier miembro crea un reto para su squad. La XP y los limites los pone el servidor
/// (maximo 3 retos vigentes por squad, de 1 a 30 dias, progreso calculado con las sesiones reales).
class CrearRetoSquadScreen extends StatefulWidget {
  const CrearRetoSquadScreen({super.key});

  @override
  State<CrearRetoSquadScreen> createState() => _CrearRetoSquadScreenState();
}

class _CrearRetoSquadScreenState extends State<CrearRetoSquadScreen> {
  static const _metricas = ['reps', 'sesiones', 'dias_activos', 'peso_maximo'];
  final _titulo = TextEditingController();
  final _desc = TextEditingController();
  final _meta = TextEditingController();
  int _metrica = 0;
  bool _colectivo = true; // true: meta entre todos; false: cada uno
  int _dias = 7;
  int _empieza = 0; // 0 hoy, 1 manana
  Map<String, dynamic>? _ejercicio;
  List<Map<String, dynamic>> _ejercicios = <Map<String, dynamic>>[];
  String? _err;
  bool _busy = false;

  String get _m => _metricas[_metrica];
  bool get _necesitaEjercicio => _m == 'reps' || _m == 'peso_maximo';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    try {
      final l = await cargarEjerciciosReps();
      if (mounted) setState(() => _ejercicios = l);
    } catch (_) {
      // se reintenta al tocar "Elegir ejercicio"
    }
  }

  @override
  void dispose() {
    _titulo.dispose();
    _desc.dispose();
    _meta.dispose();
    super.dispose();
  }

  String get _hintMeta {
    switch (_m) {
      case 'reps':
        return _colectivo ? 'Ej. 500 repeticiones entre todos' : 'Ej. 150 repeticiones cada uno';
      case 'sesiones':
        return 'Ej. 4 sesiones';
      case 'peso_maximo':
        return 'Ej. 60 (kg que cada uno debe levantar)';
      default:
        return 'Ej. 5 días (máximo $_dias)';
    }
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

  Future<void> _crear() async {
    FocusScope.of(context).unfocus();
    final meta = int.tryParse(_meta.text.trim());
    if (_titulo.text.trim().length < 3) {
      setState(() => _err = 'Ponle un título de al menos 3 caracteres.');
      return;
    }
    if (meta == null || meta < 1) {
      setState(() => _err = 'Escribe una meta válida.');
      return;
    }
    if (_necesitaEjercicio && _ejercicio == null) {
      setState(() => _err = 'Elige el ejercicio del reto.');
      return;
    }
    if (_m == 'dias_activos' && meta > _dias) {
      setState(() => _err = 'La meta de días activos no puede superar los $_dias días del reto.');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    final hoy = Fmt.bogotaNow();
    final ini = DateTime.utc(hoy.year, hoy.month, hoy.day).add(Duration(days: _empieza));
    final iniIso = '${ini.year.toString().padLeft(4, '0')}-${ini.month.toString().padLeft(2, '0')}-${ini.day.toString().padLeft(2, '0')}';
    try {
      await app.api.post('/api/social/squads/me/challenges', body: {
        'titulo': _titulo.text.trim(),
        if (_desc.text.trim().isNotEmpty) 'descripcion': _desc.text.trim(),
        'tipo': (_m == 'peso_maximo' || !_colectivo) ? 'individual' : 'squad',
        'metrica': _m,
        if (_necesitaEjercicio) 'ejercicio_id': asInt(_ejercicio!['id']),
        'meta': meta,
        'dias': _dias,
        'fecha_inicio': iniIso,
      });
      toast('Reto creado. Tu squad ya fue avisado.', type: ToastType.success);
      app.bump();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _err = e.code == 'REQUIERE_SQUAD' ? 'Primero únete o crea un squad.' : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final soloIndividual = _m == 'peso_maximo';
    return PfScaffold(
      title: 'Nuevo reto del squad',
      body: PfList(
        children: [
          const MascotNote('energizado', 'Crea un reto para tu squad. Todos reciben un aviso y el progreso sale de las sesiones que registren.'),
          PfField(label: 'Título', controller: _titulo, hint: 'Ej. Semana de sentadillas', maxLength: 100, caps: TextCapitalization.sentences),
          PfField(label: 'Descripción (opcional)', controller: _desc, maxLength: 255, maxLines: 2, caps: TextCapitalization.sentences),
          const FieldLabel('Qué se mide'),
          Segmented(
            labels: const ['Reps', 'Sesiones', 'Días', 'Peso máx.'],
            selected: _metrica,
            onChanged: (i) => setState(() {
              _metrica = i;
              _err = null;
            }),
          ),
          if (_necesitaEjercicio)
            RowCard([
              RowTile(
                title: _ejercicio == null ? 'Elegir ejercicio' : asStr(_ejercicio!['nombre']),
                sub: _ejercicio == null ? 'Solo ejercicios de repeticiones' : 'Toca para cambiarlo',
                left: IconDisc(metricIcon(_m), tone: metricTone(_m)),
                chevron: true,
                onTap: _pickEjercicio,
              ),
            ]),
          const FieldLabel('Cómo se cumple'),
          if (soloIndividual)
            const PanelNote('El peso máximo no se suma: cada miembro debe levantarlo para completar el reto.', icon: 'target')
          else
            Segmented(
              labels: const ['Meta entre todos', 'Cada uno'],
              selected: _colectivo ? 0 : 1,
              onChanged: (i) => setState(() => _colectivo = i == 0),
            ),
          PfField(label: 'Meta (${metricUnit(_m)})', controller: _meta, hint: _hintMeta, keyboard: TextInputType.number, maxLength: 5),
          const FieldLabel('Duración'),
          Stepper1(value: _dias, min: 1, max: 30, suffix: _dias == 1 ? ' día' : ' días', onChanged: (v) => setState(() => _dias = v)),
          const FieldLabel('Empieza'),
          Segmented(labels: const ['Hoy', 'Mañana'], selected: _empieza, onChanged: (i) => setState(() => _empieza = i)),
          PfCard(
            child: Row(
              children: [
                const IconDisc('medal', tone: 'gold'),
                const SizedBox(width: 12),
                Expanded(
                  child: Text('Recompensa: +${xpRetoSquad(_dias)} XP para quien lo complete', style: Tx.body(size: 13, w: FontWeight.w700)),
                ),
              ],
            ),
          ),
          const PanelNote('Máximo 3 retos vigentes por squad. Quien lo crea o el líder pueden cancelarlo.', icon: 'shield-check'),
          if (_err != null)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(_err!, style: Tx.body(size: 12.5, w: FontWeight.w600, color: C.error))),
          PfButton('Crear reto', kind: BtnKind.gold, icon: 'plus', loading: _busy, onPressed: _crear),
        ],
      ),
    );
  }
}
