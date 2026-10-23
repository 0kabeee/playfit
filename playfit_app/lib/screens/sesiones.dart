import '../common.dart';

/// Una serie en pantalla: sus propios campos de peso y repeticiones (o duración).
class _SerieCtl {
  final TextEditingController peso;
  final TextEditingController reps;

  /// Quién contó las repeticiones: 'manual' o 'camara' (vuelve a 'manual' si la persona edita el número).
  String fuente;
  _SerieCtl({String pesoTxt = '', String repsTxt = '', this.fuente = 'manual'})
      : peso = TextEditingController(text: pesoTxt),
        reps = TextEditingController(text: repsTxt);

  void dispose() {
    peso.dispose();
    reps.dispose();
  }
}

// ====================================================================== REGISTRAR SESION
class RegistrarSesionScreen extends StatefulWidget {
  final int? initialExerciseId;
  final int? initialReps;
  final int? initialSeries;

  /// Repeticiones de cada serie (p. ej. las contadas con la cámara) y, en paralelo, quién las contó.
  final List<int>? initialRepsList;
  final List<String>? initialFuentes;
  const RegistrarSesionScreen({
    super.key,
    this.initialExerciseId,
    this.initialReps,
    this.initialSeries,
    this.initialRepsList,
    this.initialFuentes,
  });

  @override
  State<RegistrarSesionScreen> createState() => _RegistrarSesionScreenState();
}

class _RegistrarSesionScreenState extends State<RegistrarSesionScreen> {
  List<Map<String, dynamic>> _ejercicios = <Map<String, dynamic>>[];
  Map<String, dynamic>? _sel;
  Object? _loadError;
  bool _loading = true;
  bool _saving = false;

  static const int _maxSeries = 10;
  final List<_SerieCtl> _filas = <_SerieCtl>[];
  final Map<String, String> _err = <String, String>{};

  @override
  void initState() {
    super.initState();
    final lista = widget.initialRepsList;
    if (lista != null && lista.isNotEmpty) {
      final fuentes = widget.initialFuentes;
      for (var i = 0; i < lista.length && i < _maxSeries; i++) {
        _filas.add(_SerieCtl(
          repsTxt: '${lista[i]}',
          fuente: (fuentes != null && i < fuentes.length) ? fuentes[i] : 'manual',
        ));
      }
    } else {
      final int n = (widget.initialSeries ?? 3).clamp(1, _maxSeries).toInt();
      for (var i = 0; i < n; i++) {
        _filas.add(_SerieCtl(repsTxt: widget.initialReps != null ? '${widget.initialReps}' : ''));
      }
    }
    _load();
  }

  @override
  void dispose() {
    for (final f in _filas) {
      f.dispose();
    }
    super.dispose();
  }

  /// Agrega una serie nueva copiando el peso y las repeticiones de la anterior (solo hay que corregir lo que cambie).
  void _agregar() {
    if (_filas.length >= _maxSeries) {
      toast('Máximo $_maxSeries series por sesión', icon: 'triangle-alert');
      return;
    }
    final ult = _filas.last;
    setState(() => _filas.add(_SerieCtl(pesoTxt: ult.peso.text, repsTxt: ult.reps.text)));
  }

  void _quitar(int i) {
    if (_filas.length <= 1) return;
    final quitada = _filas[i];
    setState(() {
      _filas.removeAt(i);
      _err.clear();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => quitada.dispose()); // se libera cuando ya no está en pantalla
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final list = asList(await app.api.get('/api/content/exercises'));
      if (!mounted) return;
      Map<String, dynamic>? sel;
      if (widget.initialExerciseId != null) {
        for (final e in list) {
          if (asInt(e['id']) == widget.initialExerciseId) sel = e;
        }
      }
      setState(() {
        _ejercicios = list;
        _sel = sel ?? (list.isNotEmpty ? list.first : null);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e;
        _loading = false;
      });
    }
  }

  bool get _mideReps => _sel == null ? true : asBool(_sel!['mide_reps']);

  Future<void> _pick() async {
    final chosen = await showPfSheet<Map<String, dynamic>>(
      context,
      (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Elige el ejercicio', style: Tx.display(size: 18)),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.5),
            child: ListView(
              shrinkWrap: true,
              children: [
                for (var i = 0; i < _ejercicios.length; i++)
                  RowTile(
                    title: asStr(_ejercicios[i]['nombre']),
                    sub: Fmt.capitalize(asStr(_ejercicios[i]['grupo_muscular'])),
                    last: i == _ejercicios.length - 1,
                    right: asInt(_ejercicios[i]['id']) == asInt(_sel?['id']) ? const LIcon('check', size: 18) : null,
                    onTap: () => Navigator.pop(ctx, _ejercicios[i]),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
    if (chosen != null) {
      setState(() {
        _sel = chosen;
        _err.clear();
      });
    }
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    final ej = _sel;
    if (ej == null) return;
    _err.clear();

    final List<Map<String, dynamic>> series = <Map<String, dynamic>>[];
    for (var i = 0; i < _filas.length; i++) {
      final f = _filas[i];
      final bool conCamara = _mideReps && f.fuente == 'camara' && widget.initialExerciseId == asInt(ej['id']);
      final Map<String, dynamic> serie = <String, dynamic>{'fuente_conteo': conCamara ? 'camara' : 'manual'};
      if (_mideReps) {
        final reps = int.tryParse(f.reps.text.trim());
        if (reps == null || reps < 1 || reps > 200) _err['reps$i'] = 'Entre 1 y 200';
        serie['repeticiones'] = reps ?? 0;
        final pesoTxt = f.peso.text.trim().replaceAll(',', '.');
        if (pesoTxt.isNotEmpty) {
          final p = double.tryParse(pesoTxt);
          if (p == null || p < 0 || p > 500) {
            _err['peso$i'] = 'Entre 0 y 500';
          } else {
            serie['peso_kg'] = p;
          }
        }
      } else {
        final dur = int.tryParse(f.reps.text.trim());
        if (dur == null || dur < 5 || dur > 3600) _err['reps$i'] = 'Entre 5 y 3600 s';
        serie['duracion_seg'] = dur ?? 0;
      }
      series.add(serie);
    }
    if (_err.isNotEmpty) {
      setState(() {});
      toast('Revisa las series marcadas en rojo', type: ToastType.error);
      return;
    }

    final payload = <String, dynamic>{
      'fecha': Fmt.todayIso(),
      'ejercicios': [
        <String, dynamic>{'ejercicio_id': asInt(ej['id']), 'series': series},
      ],
    };

    setState(() => _saving = true);
    try {
      final r = asMap(await app.api.post('/api/social/sessions', body: payload));
      app.bump();
      if (!mounted) return;
      await _showResult(r);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isNetwork) {
        await app.queueSession(payload);
        toast('Sin conexión: guardé tu sesión en el teléfono y la enviaré cuando vuelva.', icon: 'wifi-off');
        if (mounted) Navigator.of(context).pop();
      } else {
        toast(e.message, type: ToastType.error);
        setState(() => _saving = false);
      }
    }
  }

  Future<void> _showResult(Map<String, dynamic> r) async {
    final records = asList(r['records']);
    final insignias = asList(r['insignias_nuevas']);
    final retos = asList(r['retos_completados']);
    final subio = asBool(r['subio_nivel']);
    final xp = asInt(r['xp_ganado']);
    final adv = asList(r['advertencias']);

    final extra = <Widget>[];
    final desglose = asList(r['desglose']);
    if (desglose.isNotEmpty) {
      extra.add(const SizedBox(height: 14));
      for (final d in desglose) {
        extra.add(Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Row(
            children: [
              Expanded(child: Text(asStr(d['motivo']), style: Tx.body(size: 12.5, color: C.inkSoft))),
              Text('+${asInt(d['xp'])} XP', style: Tx.mono(size: 12, w: FontWeight.w700)),
            ],
          ),
        ));
      }
    }
    for (final a in adv) {
      final motivos = (a['motivos'] is List ? (a['motivos'] as List).map((m) => Fmt.flagLabel(m.toString())).join(', ') : '');
      extra.add(const SizedBox(height: 10));
      extra.add(PanelNote(
        '${asStr(a['ejercicio'])} puede no ser el más adecuado para ti ($motivos). Consúltalo con un profesional de salud antes de aumentar la carga.',
        icon: 'triangle-alert',
        bg: C.yellowBg,
      ));
    }

    String? title;
    String body = '+$xp XP · ¡Buen trabajo!';
    if (records.isNotEmpty) {
      final rec = records.first;
      title = '¡Nueva marca personal!';
      body = '${asStr(rec['ejercicio'])}: ${asStr(rec['anterior'])} → ${asStr(rec['nuevo'])}. +$xp XP';
    } else if (subio) {
      title = '¡Subiste al nivel ${asInt(r['nivel'])}!';
    } else if (insignias.isNotEmpty) {
      title = '¡Nueva insignia!';
      body = asStr(insignias.first['nombre']);
    } else if (retos.isNotEmpty) {
      title = '¡Reto completado!';
      body = asStr(retos.first['titulo']);
    }

    if (title != null) {
      await showCelebration(context, title: title, body: body, extra: extra);
    } else if (adv.isNotEmpty) {
      await showCelebration(context, title: 'Sesión registrada', body: '+$xp XP', pose: 'vamos', extra: extra);
    } else {
      toast('Sesión registrada · +$xp XP', type: ToastType.success);
    }
  }

  Widget _serieCard(int i) {
    final f = _filas[i];
    return PfCard(
      key: ObjectKey(f),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 0),
      margin: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('SERIE ${i + 1}', style: Tx.body(size: 11.5, w: FontWeight.w800, color: C.inkSoft, letter: 0.5)),
              ),
              if (_filas.length > 1) PfIconButton('x', color: C.inkMute, onTap: () => _quitar(i)),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 6, top: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_mideReps) ...[
                  Expanded(
                    child: PfField(
                      label: 'Peso (kg)',
                      controller: f.peso,
                      hint: 'Opcional',
                      keyboard: const TextInputType.numberWithOptions(decimal: true),
                      error: _err['peso$i'],
                      onChanged: (_) => setState(() => _err.remove('peso$i')),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: PfField(
                    label: _mideReps ? 'Repeticiones' : 'Duración (seg)',
                    controller: f.reps,
                    hint: _mideReps ? '10' : '60',
                    keyboard: TextInputType.number,
                    error: _err['reps$i'],
                    onChanged: (_) => setState(() {
                      f.fuente = 'manual'; // si la persona corrige el número, ya no es el conteo de la cámara
                      _err.remove('reps$i');
                    }),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_loading) {
      body = const SkeletonScreen();
    } else if (_loadError != null) {
      body = ErrorState(error: _loadError!, onRetry: _load);
    } else {
      body = PfList(
        children: [
          const Center(child: Mascot('entrenando', size: 110, enter: true)),
          const SizedBox(height: 12),
          Text('EJERCICIO', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
          const SizedBox(height: 6),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _pick,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 13),
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                color: C.surface,
                border: Border.all(color: C.lineStrong, width: 1.5),
                borderRadius: BorderRadius.circular(C.rs),
              ),
              child: Row(
                children: [
                  Expanded(child: Text(asStr(_sel?['nombre'], 'Elige un ejercicio'), style: Tx.body(size: 14.5, w: FontWeight.w600))),
                  Transform.rotate(angle: 1.5708, child: const LIcon('chevron-right', size: 18, color: C.inkMute)),
                ],
              ),
            ),
          ),
          for (var i = 0; i < _filas.length; i++) _serieCard(i),
          PfButton('Agregar serie', kind: BtnKind.secondary, icon: 'plus', onPressed: _agregar),
          const SizedBox(height: 12),
          const PanelNote(
            'Cada serie tiene sus propias repeticiones y peso (el peso es opcional). Las marcas personales y el XP se calculan automáticamente.',
            icon: 'activity',
          ),
          const SizedBox(height: 4),
          PfButton('Guardar sesión', kind: BtnKind.gold, icon: 'check', loading: _saving, onPressed: _save),
        ],
      );
    }
    return PfScaffold(title: 'Registrar sesión', body: body);
  }
}

// ====================================================================== HISTORIAL DE SESIONES
class SesionesScreen extends StatelessWidget {
  const SesionesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Historial de sesiones',
      body: LoadView<List<Map<String, dynamic>>>(
        loader: () async => asList(await app.api.get('/api/social/sessions', query: {'limit': '50'})),
        builder: (context, sesiones, reload) {
          final pend = app.myPending;
          if (sesiones.isEmpty && pend.isEmpty) {
            return PfList(onRefresh: reload, children: [
              EmptyState(
                pose: 'pensativo',
                title: 'Aún no registras sesiones',
                body: 'Cada sesión suma XP, mantiene tu racha y alimenta tus marcas personales.',
                actions: [
                  PfButton('Registrar mi primera sesión', kind: BtnKind.gold, icon: 'plus', onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const RegistrarSesionScreen()));
                  }),
                ],
              ),
            ]);
          }
          return PfList(onRefresh: reload, children: [
            RowCard([
              for (final _ in pend)
                RowTile(
                  title: 'Sesión pendiente',
                  sub: 'Se enviará cuando haya conexión',
                  left: const IconDisc('wifi-off', tone: 'yellow'),
                  right: const PfBadge('Pendiente', tone: 'yellow'),
                ),
              for (final s in sesiones) _tile(s),
            ]),
          ]);
        },
      ),
    );
  }

  RowTile _tile(Map<String, dynamic> s) {
    final series = asList(s['series']);
    final names = <String>[];
    for (final x in series) {
      final n = asStr(x['ejercicio']);
      if (!names.contains(n)) names.add(n);
    }
    final title = names.length <= 2 ? names.join(' + ') : '${names.take(2).join(' + ')} +${names.length - 2}';
    num best = 0;
    for (final x in series) {
      final p = asNum(x['peso_kg']);
      if (p > best) best = p;
    }
    // con un solo ejercicio se muestran las repeticiones de cada serie (ej. 12-10-8)
    final reps = <String>[];
    if (names.length == 1) {
      for (final x in series) {
        final r = asInt(x['repeticiones']);
        if (r > 0) reps.add('$r');
      }
    }
    final detalle = reps.isEmpty ? '${series.length} series' : '${series.length} series · ${reps.join('-')} reps';
    return RowTile(
      title: title.isEmpty ? 'Sesión' : title,
      sub: '${Fmt.dayLabel(asStr(s['fecha']))} · $detalle',
      left: const IconDisc('dumbbell', tone: 'blue'),
      right: best > 0 ? Text(Fmt.kg(best), style: Tx.mono(size: 12, w: FontWeight.w700)) : null,
    );
  }
}
