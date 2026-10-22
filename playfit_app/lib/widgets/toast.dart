import 'package:flutter/material.dart';

import '../globals.dart';
import '../theme/lucide.dart';
import '../theme/tokens.dart';

enum ToastType { info, success, error }

/// Aviso flotante (como el toast del mockup). Se puede llamar desde cualquier parte.
void toast(String message, {ToastType type = ToastType.info, String? icon}) {
  final messenger = messengerKey.currentState;
  if (messenger == null) return;
  final Color bg = type == ToastType.success ? C.green : (type == ToastType.error ? C.error : C.ink);
  final String ic = icon ??
      (type == ToastType.success ? 'check-circle' : (type == ToastType.error ? 'triangle-alert' : 'refresh-cw'));
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      backgroundColor: bg,
      behavior: SnackBarBehavior.floating,
      duration: const Duration(milliseconds: 3000),
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 92),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(C.rs)),
      content: Row(
        children: [
          LIcon(ic, size: 16, color: Colors.white),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: Tx.body(size: 12.5, w: FontWeight.w700, color: Colors.white))),
        ],
      ),
    ),
  );
}
