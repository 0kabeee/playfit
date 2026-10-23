import '../common.dart';
import 'crear_reto.dart';
import 'duelos.dart';
import 'sesiones.dart';

// ====================================================================== PESTAÑA RETOS
class RetosTab extends StatefulWidget {
  const RetosTab({super.key});

  @override
  State<RetosTab> createState() => _RetosTabState();
}

class _RetosTabState extends State<RetosTab> {
  int _tab = 0; // 0 activos, 1 disponibles, 2 completados
  final Set<int> _busy = <int>{};

  Future<void> _join(int id) async {
    setState(() => _busy.add(id));
    try {
      await app.api.post('/api/social/challenges/$id/join');
      toast('Te uniste al reto', type: ToastType.success);
      if (mounted) setState(() => _tab = 0);
      app.bump();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      loader: () async {
        final data = asMap(await app.api.get('/api/social/challenges'));
        try {
          final duelos = asMap(await app.api.get('/api/social/duels'));
          data['_duelos_recibidos'] = asList(duelos['recibidos']).length;
          data['_duelos_activos'] = asList(duelos['activos']).length;
        } catch (_) {
          // si falla, la pestaña de retos se muestra igual
        }
        return data;
      },
      builder: (context, data, reload) {
        final activos = asList(data['activos']);
        final disponibles = asList(data['disponibles']);
        final completados = asList(data['completados']);
        final lista = _tab == 0 ? activos : (_tab == 1 ? disponibles : completados);

        String pose;
        String note;
        if (_tab == 0) {
          pose = 'entrenando';
          note = activos.isEmpty ? 'No tienes retos activos. Mira los disponibles y súmate a uno.' : 'Cada sesión que registres suma a tus retos activos.';
        } else if (_tab == 1) {
          pose = 'energizado';
          note = 'Elige un reto y súmate. En los de squad el progreso se suma entre todos.';
        } else {
          pose = completados.isEmpty ? 'pensativo' : 'logro';
          note = completados.isEmpty ? 'Aquí aparecerán los retos que completes.' : '¡Llevas ${completados.length} reto(s) completado(s)! Qué nivel.';
        }

        final recibidos = asInt(data['_duelos_recibidos']);
        final enCurso = asInt(data['_duelos_activos']);
        return PfList(
          onRefresh: reload,
          children: [
            RowCard([
              RowTile(
                title: 'Duelos 1 vs 1',
                sub: recibidos > 0
                    ? 'Te retaron $recibidos ${recibidos == 1 ? 'vez' : 'veces'} · responde'
                    : (enCurso > 0 ? '$enCurso en curso' : 'Reta a alguien de tu squad'),
                left: const IconDisc('target', tone: 'orange'),
                right: recibidos > 0 ? PfBadge('$recibidos', tone: 'gold') : null,
                chevron: true,
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const DuelosScreen())),
              ),
            ]),
            Segmented(
              labels: ['Activos (${activos.length})', 'Disponibles (${disponibles.length})', 'Completados (${completados.length})'],
              selected: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            MascotNote(pose, note),
            if (lista.isEmpty)
              PfCard(
                child: Text(
                  _tab == 0 ? 'Sin retos activos por ahora.' : (_tab == 1 ? 'No hay retos disponibles en este momento.' : 'Todavía no completas ningún reto.'),
                  style: Tx.body(size: 12.5, color: C.inkMute),
                ),
              )
            else
              for (final r in lista) _card(context, r),
            const SizedBox(height: 4),
            PfButton('Crear un reto para mi squad', kind: BtnKind.secondary, icon: 'plus', onPressed: () async {
              final ok = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => const CrearRetoSquadScreen()));
              if (ok == true && mounted) setState(() => _tab = 0);
            }),
          ],
        );
      },
    );
  }

  Widget _card(BuildContext context, Map<String, dynamic> r) {
    final id = asInt(r['id']);
    final metrica = asStr(r['metrica']);
    final unidad = metricUnit(metrica);
    final mode = _tab;
    return PfCard(
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RetoDetalleScreen(retoId: id))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconDisc(metricIcon(metrica), tone: metricTone(metrica)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(asStr(r['titulo']), style: Tx.body(size: 14, w: FontWeight.w700)),
                    Text('${tipoRetoLabel(asStr(r['tipo']), deSquad: asBool(r['de_squad']))} · meta ${asInt(r['meta'])} $unidad', style: Tx.body(size: 11.5, color: C.inkMute)),
                    if (asBool(r['de_squad']) && asStr(r['creador']).isNotEmpty)
                      Text('Creado por ${r['creador'] == app.user['nombre'] ? 'ti' : asStr(r['creador'])}', style: Tx.body(size: 11, color: C.inkMute)),
                  ],
                ),
              ),
              if (mode == 0) PfBadge('${asInt(r['dias_restantes'])} días', tone: 'blue'),
              if (mode == 2) const PfBadge('Completado', tone: 'green', icon: 'medal'),
            ],
          ),
          if (mode == 0) ...[
            const SizedBox(height: 12),
            PfProgress(asNum(r['porcentaje']).toDouble()),
            const SizedBox(height: 7),
            Text('${asInt(r['progreso'])} de ${asInt(r['meta'])} $unidad', style: Tx.body(size: 12, w: FontWeight.w600, color: C.inkSoft)),
          ],
          if (mode == 1) ...[
            const SizedBox(height: 10),
            Text(asStr(r['descripcion']), style: Tx.body(size: 12.5, color: C.inkSoft, height: 1.4)),
            const SizedBox(height: 4),
            Text('Termina en ${asInt(r['dias_restantes'])} días · +${asInt(r['xp_recompensa'])} XP', style: Tx.body(size: 11.5, color: C.inkMute)),
            const SizedBox(height: 12),
            PfButton(
              asBool(r['puede_unirse']) ? 'Unirme al reto' : 'Requiere squad',
              kind: BtnKind.gold,
              small: true,
              expand: false,
              loading: _busy.contains(id),
              onPressed: asBool(r['puede_unirse']) ? () => _join(id) : null,
            ),
          ],
          if (mode == 2) ...[
            const SizedBox(height: 8),
            Text('+${asInt(r['xp_recompensa'])} XP ganados', style: Tx.body(size: 12, w: FontWeight.w700, color: C.green)),
          ],
        ],
      ),
    );
  }
}

// ====================================================================== DETALLE DE RETO
class RetoDetalleScreen extends StatefulWidget {
  final int retoId;
  const RetoDetalleScreen({super.key, required this.retoId});

  @override
  State<RetoDetalleScreen> createState() => _RetoDetalleScreenState();
}

class _RetoDetalleScreenState extends State<RetoDetalleScreen> {
  bool _joining = false;

  Future<void> _cancelar() async {
    final ok = await confirmSheet(
      context,
      title: '¿Cancelar este reto?',
      body: 'Dejará de aparecer para tu squad. Quienes ya lo completaron conservan su XP.',
      action: 'Cancelar reto',
    );
    if (!ok) return;
    try {
      await app.api.delete('/api/social/challenges/${widget.retoId}');
      toast('Reto cancelado', type: ToastType.success);
      app.bump();
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    }
  }

  Future<void> _join() async {
    setState(() => _joining = true);
    try {
      await app.api.post('/api/social/challenges/${widget.retoId}/join');
      toast('Te uniste al reto', type: ToastType.success);
      app.bump();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Detalle del reto',
      body: LoadView<Map<String, dynamic>>(
        loader: () async => asMap(await app.api.get('/api/social/challenges/${widget.retoId}')),
        builder: (context, r, reload) {
          final metrica = asStr(r['metrica']);
          final unidad = metricUnit(metrica);
          final esSquad = asStr(r['tipo']) == 'squad';
          final deSquad = asBool(r['de_squad']);
          final participantes = asList(r['participantes']);
          final finalizado = asBool(r['finalizado']);
          final completado = asBool(r['completado']);
          final participa = asBool(r['participa']);

          String pose = 'entrenando';
          if (metrica == 'sesiones') pose = 'energizado';
          if (metrica == 'dias_activos') pose = 'calentando';
          if (metrica == 'peso_maximo') pose = 'vamos';

          Widget action;
          if (completado) {
            action = const PfButton('Reto completado', kind: BtnKind.secondary, icon: 'medal');
          } else if (asBool(r['puede_unirse'])) {
            action = PfButton('Unirme al reto', kind: BtnKind.gold, loading: _joining, onPressed: _join);
          } else if (participa && !finalizado) {
            action = PfButton('Registrar sesión', kind: BtnKind.gold, icon: 'plus', onPressed: () {
              Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const RegistrarSesionScreen()));
            });
          } else if (!participa && asStr(r['tipo']) == 'squad') {
            action = const PfButton('Requiere pertenecer a un squad', kind: BtnKind.secondary);
          } else {
            action = const PfButton('Reto finalizado', kind: BtnKind.secondary);
          }

          return PfList(onRefresh: reload, children: [
            Text(asStr(r['titulo']), style: Tx.display(size: 24)),
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 14),
              child: Text(
                '${tipoRetoLabel(asStr(r['tipo']), deSquad: deSquad)} · ${finalizado ? 'finalizado' : 'termina en ${asInt(r['dias_restantes'])} días'}',
                style: Tx.body(size: 12.5, color: C.inkSoft),
              ),
            ),
            MascotNote(pose, asStr(r['descripcion'])),
            PfCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(esSquad ? 'PROGRESO DEL SQUAD' : 'TU PROGRESO', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkMute, letter: 0.5)),
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('${asInt(r['progreso'])}', style: Tx.mono(size: 30, w: FontWeight.w700)),
                      Text(' / ${asInt(r['meta'])} $unidad', style: Tx.body(size: 13, color: C.inkSoft)),
                      const Spacer(),
                      PfBadge('+${asInt(r['xp_recompensa'])} XP', tone: 'gold'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  PfProgress(asNum(r['porcentaje']).toDouble(), height: 10),
                  const SizedBox(height: 6),
                  Text('${asInt(r['porcentaje'])}% completado', style: Tx.body(size: 11.5, color: C.inkMute)),
                ],
              ),
            ),
            if (participantes.isNotEmpty) ...[
              const SectionLabel('Participantes de tu squad'),
              RowCard([
                for (final p in participantes)
                  RowTile(
                    title: asBool(p['es_yo']) ? '${asStr(p['nombre'])} (tú)' : Fmt.shortName(asStr(p['nombre']), asStr(p['apellido'])),
                    left: Avatar(Fmt.initials(asStr(p['nombre']), asStr(p['apellido'])), size: 36),
                    right: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (asBool(p['completado'])) const Padding(padding: EdgeInsets.only(right: 6), child: LIcon('check-circle', size: 16, color: C.green)),
                      Text('${asInt(p['progreso'])}', style: Tx.mono(size: 13, w: FontWeight.w700)),
                    ]),
                  ),
              ]),
            ] else if (asInt(r['participantes_total']) > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text('${asInt(r['participantes_total'])} personas participan en este reto.', style: Tx.body(size: 12, color: C.inkMute)),
              ),
            const SizedBox(height: 6),
            action,
            if (asBool(r['puede_cancelar']) && !finalizado)
              Center(
                child: TextButton(
                  onPressed: _cancelar,
                  child: Text('Cancelar este reto', style: Tx.body(size: 12.5, w: FontWeight.w700, color: C.error)),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
