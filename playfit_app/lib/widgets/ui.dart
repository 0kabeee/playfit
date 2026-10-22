import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../state/app_state.dart';
import '../theme/lucide.dart';
import '../theme/tokens.dart';
import 'mascot.dart';

// ============================================================ botones
enum BtnKind { gold, primary, secondary, danger }

class PfButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final BtnKind kind;
  final String? icon;
  final bool loading;
  final bool small;
  final bool expand;

  const PfButton(
    this.label, {
    super.key,
    this.onPressed,
    this.kind = BtnKind.primary,
    this.icon,
    this.loading = false,
    this.small = false,
    this.expand = true,
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    switch (kind) {
      case BtnKind.gold:
        bg = C.gold;
        fg = C.ink;
        break;
      case BtnKind.primary:
        bg = C.ink;
        fg = C.cream;
        break;
      case BtnKind.danger:
        bg = C.error;
        fg = Colors.white;
        break;
      case BtnKind.secondary:
        bg = Colors.transparent;
        fg = C.ink;
        break;
    }
    final bool disabled = onPressed == null || loading;
    final radius = BorderRadius.circular(small ? 12 : C.rs);

    final content = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (loading)
          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
        else if (icon != null)
          LIcon(icon!, size: 16, color: fg),
        if (loading || icon != null) const SizedBox(width: 7),
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: Tx.body(size: small ? 12 : 14, w: FontWeight.w700, color: fg),
          ),
        ),
      ],
    );

    return Opacity(
      opacity: onPressed == null ? 0.42 : 1,
      child: Material(
        color: bg,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: disabled ? null : onPressed,
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: small ? 14 : 18, vertical: small ? 8 : 14),
            decoration: kind == BtnKind.secondary
                ? BoxDecoration(border: Border.all(color: C.lineStrong, width: 1.5), borderRadius: radius)
                : null,
            child: content,
          ),
        ),
      ),
    );
  }
}

class PfIconButton extends StatelessWidget {
  final String icon;
  final VoidCallback onTap;
  final bool dot;
  final Color color;

  const PfIconButton(this.icon, {super.key, required this.onTap, this.dot = false, this.color = C.ink});

  @override
  Widget build(BuildContext context) {
    return InkResponse(
      onTap: onTap,
      radius: 22,
      child: SizedBox(
        width: 36,
        height: 36,
        child: Stack(
          alignment: Alignment.center,
          children: [
            LIcon(icon, size: 21, color: color),
            if (dot)
              Positioned(
                top: 6,
                right: 6,
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: C.gold,
                    shape: BoxShape.circle,
                    border: Border.all(color: C.cream, width: 1.5),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ============================================================ tarjetas y textos
class PfCard extends StatelessWidget {
  final Widget child;
  final bool lidcap;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final VoidCallback? onTap;
  final Color? color;
  final bool clip;

  const PfCard({
    super.key,
    required this.child,
    this.lidcap = false,
    this.padding = const EdgeInsets.all(16),
    this.margin = const EdgeInsets.only(bottom: 11),
    this.onTap,
    this.color,
    this.clip = false,
  });

  @override
  Widget build(BuildContext context) {
    Widget body = Container(
      padding: padding,
      clipBehavior: clip ? Clip.antiAlias : Clip.none,
      decoration: BoxDecoration(
        color: color ?? C.surface,
        border: Border.all(color: C.line),
        borderRadius: BorderRadius.circular(C.rm),
      ),
      child: child,
    );
    if (onTap != null) {
      body = GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: body);
    }
    if (lidcap) {
      body = Stack(
        clipBehavior: Clip.none,
        children: [
          body,
          Positioned(
            top: -6,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                width: 44,
                height: 12,
                decoration: BoxDecoration(color: C.ink, borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      );
    }
    return Padding(padding: margin, child: body);
  }
}

class SectionLabel extends StatelessWidget {
  final String text;
  const SectionLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 16, 0, 9),
      child: Text(text.toUpperCase(), style: Tx.body(size: 11, w: FontWeight.w700, color: C.inkMute, letter: 0.6)),
    );
  }
}

class PfBadge extends StatelessWidget {
  final String text;
  final String tone;
  final String? icon;
  const PfBadge(this.text, {super.key, this.tone = 'grey', this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: C.bg(tone), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[LIcon(icon!, size: 11, color: C.fg(tone)), const SizedBox(width: 4)],
          Text(text, style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.fg(tone))),
        ],
      ),
    );
  }
}

/// Circulo con iniciales (o icono). `ring`: 'gold' | 'green' | 'grey' segun la racha.
class Avatar extends StatelessWidget {
  final String initials;
  final String? ring;
  final double size;
  final Color? bg;
  final Color? fg;
  final String? icon;

  const Avatar(this.initials, {super.key, this.ring, this.size = 40, this.bg, this.fg, this.icon});

  @override
  Widget build(BuildContext context) {
    Color? ringColor;
    if (ring == 'gold') ringColor = C.gold;
    if (ring == 'green') ringColor = C.green;
    if (ring == 'grey') ringColor = C.lineStrong;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: bg ?? C.goldBg,
        boxShadow: ringColor == null
            ? null
            : [
                BoxShadow(color: ringColor, spreadRadius: 4.5),
                const BoxShadow(color: C.surface, spreadRadius: 2.5),
              ],
      ),
      child: icon != null
          ? LIcon(icon!, size: size * 0.46, color: fg ?? C.ink)
          : Text(initials, style: Tx.body(size: size * 0.34, w: FontWeight.w700, color: fg ?? C.ink)),
    );
  }
}

class AvatarStack extends StatelessWidget {
  final List<String> initials;
  const AvatarStack(this.initials, {super.key});

  @override
  Widget build(BuildContext context) {
    final shown = initials.take(5).toList();
    return SizedBox(
      height: 30,
      width: shown.isEmpty ? 0 : 30.0 + (shown.length - 1) * 21,
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * 21.0,
              child: Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: C.goldBg,
                  border: Border.all(color: C.surface, width: 2),
                ),
                child: Text(shown[i], style: Tx.body(size: 10.5, w: FontWeight.w700)),
              ),
            ),
        ],
      ),
    );
  }
}

/// Fila de lista (icono/avatar a la izquierda, titulo + subtitulo, algo a la derecha).
class RowTile extends StatelessWidget {
  final String title;
  final String? sub;
  final Widget? left;
  final Widget? right;
  final bool chevron;
  final bool last;
  final VoidCallback? onTap;

  const RowTile({
    super.key,
    required this.title,
    this.sub,
    this.left,
    this.right,
    this.chevron = false,
    this.last = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 11),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.line))),
        child: Row(
          children: [
            if (left != null) ...[left!, const SizedBox(width: 12)],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Tx.body(size: 13.5, w: FontWeight.w700)),
                  if (sub != null) ...[
                    const SizedBox(height: 2),
                    Text(sub!, style: Tx.body(size: 11.5, color: C.inkMute)),
                  ],
                ],
              ),
            ),
            if (right != null) ...[const SizedBox(width: 8), right!],
            if (chevron) ...[const SizedBox(width: 6), const LIcon('chevron-right', size: 17, color: C.inkMute)],
          ],
        ),
      ),
    );
  }
}

/// Lista de filas dentro de una tarjeta (pone `last` en la ultima).
class RowCard extends StatelessWidget {
  final List<RowTile> rows;
  const RowCard(this.rows, {super.key});

  @override
  Widget build(BuildContext context) {
    return PfCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++)
            RowTile(
              title: rows[i].title,
              sub: rows[i].sub,
              left: rows[i].left,
              right: rows[i].right,
              chevron: rows[i].chevron,
              onTap: rows[i].onTap,
              last: i == rows.length - 1,
            ),
        ],
      ),
    );
  }
}

/// Circulo de color con icono (el "avatar" de las filas de retos y tecnica)
class IconDisc extends StatelessWidget {
  final String icon;
  final String tone;
  final double size;
  const IconDisc(this.icon, {super.key, this.tone = 'gold', this.size = 40});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, color: C.bg(tone)),
      child: Center(child: LIcon(icon, size: size * 0.46, color: C.fg(tone))),
    );
  }
}

// ============================================================ selector y campos
class Segmented extends StatelessWidget {
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;
  final bool scroll;

  const Segmented({super.key, required this.labels, required this.selected, required this.onChanged, this.scroll = false});

  @override
  Widget build(BuildContext context) {
    Widget item(int i) {
      final bool on = i == selected;
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onChanged(i),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: EdgeInsets.symmetric(vertical: 9, horizontal: scroll ? 14 : 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(color: on ? C.ink : Colors.transparent, borderRadius: BorderRadius.circular(999)),
          child: Text(labels[i], maxLines: 1, overflow: TextOverflow.ellipsis, style: Tx.body(size: 12, w: FontWeight.w700, color: on ? C.cream : C.inkSoft)),
        ),
      );
    }

    final row = scroll
        ? SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [for (var i = 0; i < labels.length; i++) item(i)]),
          )
        : Row(children: [for (var i = 0; i < labels.length; i++) Expanded(child: item(i))]);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: C.surface,
        border: Border.all(color: C.line),
        borderRadius: BorderRadius.circular(999),
      ),
      child: row,
    );
  }
}

class PfField extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboard;
  final bool obscure;
  final String? error;
  final int maxLines;
  final Widget? suffix;
  final ValueChanged<String>? onChanged;
  final TextInputAction? action;
  final TextCapitalization caps;
  final int? maxLength;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;

  const PfField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.keyboard,
    this.obscure = false,
    this.error,
    this.maxLines = 1,
    this.suffix,
    this.onChanged,
    this.action,
    this.caps = TextCapitalization.none,
    this.maxLength,
    this.enabled = true,
    this.onSubmitted,
  });

  OutlineInputBorder _border(Color c, [double w = 1.5]) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(C.rs), borderSide: BorderSide(color: c, width: w));

  @override
  Widget build(BuildContext context) {
    final bool hasError = error != null && error!.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            enabled: enabled,
            obscureText: obscure,
            keyboardType: keyboard,
            textInputAction: action,
            textCapitalization: caps,
            maxLines: obscure ? 1 : maxLines,
            maxLength: maxLength,
            onChanged: onChanged,
            onSubmitted: onSubmitted,
            style: Tx.body(size: 14.5),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: Tx.body(size: 14.5, color: C.inkMute),
              counterText: '',
              filled: true,
              fillColor: C.surface,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 13, vertical: 13),
              suffixIcon: suffix,
              enabledBorder: _border(hasError ? C.error : C.lineStrong),
              disabledBorder: _border(C.line),
              focusedBorder: _border(hasError ? C.error : C.gold),
              border: _border(C.lineStrong),
            ),
          ),
          if (hasError)
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(error!, style: Tx.body(size: 11.5, w: FontWeight.w600, color: C.error)),
            ),
        ],
      ),
    );
  }
}

/// Campo de contraseña con boton para mostrar/ocultar.
class PasswordField extends StatefulWidget {
  final String label;
  final TextEditingController controller;
  final String? error;
  final String? hint;
  final ValueChanged<String>? onChanged;
  final TextInputAction? action;
  final ValueChanged<String>? onSubmitted;

  const PasswordField({
    super.key,
    this.label = 'Contraseña',
    required this.controller,
    this.error,
    this.hint,
    this.onChanged,
    this.action,
    this.onSubmitted,
  });

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) {
    return PfField(
      label: widget.label,
      controller: widget.controller,
      hint: widget.hint,
      obscure: _hidden,
      error: widget.error,
      onChanged: widget.onChanged,
      action: widget.action,
      onSubmitted: widget.onSubmitted,
      suffix: IconButton(
        onPressed: () => setState(() => _hidden = !_hidden),
        icon: LIcon(_hidden ? 'eye' : 'eye-off', size: 19, color: C.inkMute),
      ),
    );
  }
}

// ============================================================ bloques informativos
class PanelNote extends StatelessWidget {
  final String text;
  final String? icon;
  final Color? bg;
  final Color? fg;
  const PanelNote(this.text, {super.key, this.icon, this.bg, this.fg});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: bg ?? C.creamDark, borderRadius: BorderRadius.circular(C.rs)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Padding(padding: const EdgeInsets.only(top: 1), child: LIcon(icon!, size: 15, color: fg ?? C.inkSoft)),
            const SizedBox(width: 8),
          ],
          Expanded(child: Text(text, style: Tx.body(size: 11.5, color: fg ?? C.inkSoft, height: 1.45))),
        ],
      ),
    );
  }
}

class PfProgress extends StatelessWidget {
  final double pct; // 0..100
  final double height;
  final Color color;
  const PfProgress(this.pct, {super.key, this.height = 9, this.color = C.gold});

  @override
  Widget build(BuildContext context) {
    final double f = (pct / 100).clamp(0.0, 1.0).toDouble();
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: Container(
        height: height,
        color: C.line,
        alignment: Alignment.centerLeft,
        child: TweenAnimationBuilder<double>(
          tween: Tween<double>(begin: 0, end: f),
          duration: const Duration(milliseconds: 700),
          curve: Curves.easeOutCubic,
          builder: (context, v, child) => FractionallySizedBox(widthFactor: v, child: child),
          child: Container(color: color),
        ),
      ),
    );
  }
}

class MetricTile extends StatelessWidget {
  final String label;
  final String value;
  const MetricTile(this.label, this.value, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: C.surface,
        border: Border.all(color: C.line),
        borderRadius: BorderRadius.circular(C.rm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkMute, letter: 0.4)),
          const SizedBox(height: 5),
          Text(value, style: Tx.mono(size: 19, w: FontWeight.w700)),
        ],
      ),
    );
  }
}

/// Cuadricula de 2 columnas (si sobra uno, ocupa todo el ancho).
class MetricGrid extends StatelessWidget {
  final List<MetricTile> tiles;
  const MetricGrid(this.tiles, {super.key});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      final bool pair = i + 1 < tiles.length;
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Expanded(child: tiles[i]),
            if (pair) ...[const SizedBox(width: 10), Expanded(child: tiles[i + 1])],
          ],
        ),
      ));
    }
    return Column(children: rows);
  }
}

class EmptyState extends StatelessWidget {
  final String pose;
  final String title;
  final String body;
  final List<Widget> actions;
  const EmptyState({super.key, required this.pose, required this.title, required this.body, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 24, 18, 30),
      child: Column(
        children: [
          Mascot(pose, size: 120, enter: true),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: Tx.display(size: 18)),
          const SizedBox(height: 6),
          Text(body, textAlign: TextAlign.center, style: Tx.body(size: 12.5, color: C.inkMute, height: 1.5)),
          if (actions.isNotEmpty) const SizedBox(height: 18),
          for (final a in actions) Padding(padding: const EdgeInsets.only(bottom: 8), child: a),
        ],
      ),
    );
  }
}

// ============================================================ estructura de pantallas
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: app.api.offline,
      builder: (context, off, _) {
        if (!off) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          color: C.yellowBg,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          child: Row(
            children: [
              const LIcon('wifi-off', size: 15, color: C.yellow),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Sin conexión con el servidor. Lo que registres se sincronizará después.',
                    style: Tx.body(size: 11.5, w: FontWeight.w700, color: C.inkSoft)),
              ),
            ],
          ),
        );
      },
    );
  }
}

class PfAppBar extends StatelessWidget {
  final String title;
  final bool back;
  final List<Widget> actions;
  const PfAppBar({super.key, required this.title, this.back = false, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
      child: Row(
        children: [
          if (back) PfIconButton('chevron-left', onTap: () => Navigator.of(context).maybePop()) else const SizedBox(width: 10),
          const SizedBox(width: 2),
          Expanded(child: Text(title, style: Tx.display(size: 20), overflow: TextOverflow.ellipsis)),
          ...actions,
          if (actions.isEmpty) const SizedBox(width: 36),
        ],
      ),
    );
  }
}

/// Pantalla "empujada" (con boton atras) usada por casi todas las pantallas secundarias.
class PfScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final List<Widget> actions;
  const PfScaffold({super.key, required this.title, required this.body, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        child: Column(
          children: [
            const OfflineBanner(),
            PfAppBar(title: title, back: true, actions: actions),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}

/// Lista con el relleno estandar (16 lateral).
class PfList extends StatelessWidget {
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final EdgeInsets padding;
  const PfList({super.key, required this.children, this.onRefresh, this.padding = const EdgeInsets.fromLTRB(16, 12, 16, 28)});

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: padding,
      children: children,
    );
    if (onRefresh == null) return list;
    return RefreshIndicator(color: C.ink, backgroundColor: C.surface, onRefresh: onRefresh!, child: list);
  }
}

// ============================================================ hojas inferiores (modales)
Future<T?> showPfSheet<T>(BuildContext context, Widget Function(BuildContext) builder) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x80211B15),
    builder: (ctx) {
      final mq = MediaQuery.of(ctx);
      return Container(
        decoration: const BoxDecoration(
          color: C.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        padding: EdgeInsets.fromLTRB(20, 12, 20, 24 + mq.viewInsets.bottom + mq.padding.bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: C.lineStrong, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 16),
              builder(ctx),
            ],
          ),
        ),
      );
    },
  );
}

Future<bool> confirmSheet(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
  bool danger = true,
}) async {
  final r = await showPfSheet<bool>(
    context,
    (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Tx.display(size: 18)),
        const SizedBox(height: 8),
        Text(body, style: Tx.body(size: 13, color: C.inkSoft, height: 1.5)),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(child: PfButton('Cancelar', kind: BtnKind.secondary, onPressed: () => Navigator.pop(ctx, false))),
            const SizedBox(width: 10),
            Expanded(
              child: PfButton(action, kind: danger ? BtnKind.danger : BtnKind.gold, onPressed: () => Navigator.pop(ctx, true)),
            ),
          ],
        ),
      ],
    ),
  );
  return r == true;
}

/// Modal de celebracion con la mascota (nueva marca, nivel, insignia...).
Future<void> showCelebration(
  BuildContext context, {
  required String title,
  required String body,
  String pose = 'logro',
  List<Widget> extra = const [],
  String button = 'Continuar',
}) {
  return showPfSheet<void>(
    context,
    (ctx) => Column(
      children: [
        MascotStage(pose, color: C.greenBg, size: 120, enter: true),
        const SizedBox(height: 14),
        Center(child: Text(title, textAlign: TextAlign.center, style: Tx.display(size: 21))),
        const SizedBox(height: 6),
        Center(child: Text(body, textAlign: TextAlign.center, style: Tx.body(size: 13, color: C.inkSoft, height: 1.5))),
        ...extra,
        const SizedBox(height: 18),
        PfButton(button, kind: BtnKind.gold, onPressed: () => Navigator.pop(ctx)),
      ],
    ),
  );
}

Future<void> copyToClipboard(String text) => Clipboard.setData(ClipboardData(text: text));
