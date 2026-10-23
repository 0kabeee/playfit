import '../common.dart';

/// Casilla de consentimiento: cuadro + titulo + texto COMPLETO que la persona esta aceptando.
/// El texto lo manda el servidor (/api/auth/consent-texts) para que lo que se ve sea exactamente lo que queda registrado.
class ConsentCheck extends StatelessWidget {
  final String title;
  final String text;
  final bool value;
  final bool isRequired;
  final String? error;
  final ValueChanged<bool> onChanged;

  const ConsentCheck({
    super.key,
    required this.title,
    required this.text,
    required this.value,
    required this.onChanged,
    this.isRequired = false,
    this.error,
  });

  @override
  Widget build(BuildContext context) {
    final bool hasError = error != null && error!.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => onChanged(!value),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 140),
                  width: 22,
                  height: 22,
                  margin: const EdgeInsets.only(top: 1),
                  decoration: BoxDecoration(
                    color: value ? C.ink : C.surface,
                    borderRadius: BorderRadius.circular(7),
                    border: Border.all(color: hasError ? C.error : (value ? C.ink : C.lineStrong), width: 1.5),
                  ),
                  child: value ? const Center(child: LIcon('check', size: 14, color: C.cream)) : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(child: Text(title, style: Tx.body(size: 12.5, w: FontWeight.w800))),
                          const SizedBox(width: 6),
                          PfBadge(isRequired ? 'Obligatorio' : 'Opcional', tone: isRequired ? 'gold' : 'grey'),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(text, style: Tx.body(size: 12, color: C.inkSoft, height: 1.5)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (hasError)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 32),
              child: Text(error!, style: Tx.body(size: 11.5, w: FontWeight.w600, color: C.error)),
            ),
        ],
      ),
    );
  }
}
