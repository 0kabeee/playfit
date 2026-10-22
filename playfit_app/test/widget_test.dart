import 'package:flutter_test/flutter_test.dart';
import 'package:playfit_app/util.dart';

void main() {
  test('iniciales y nombres cortos', () {
    expect(Fmt.initials('Camila', 'Reyes'), 'CR');
    expect(Fmt.shortName('Camila', 'Reyes'), 'Camila R.');
  });

  test('conversion segura de JSON', () {
    expect(asInt('42'), 42);
    expect(asNum('3.5'), 3.5);
    expect(asStr(null, 'x'), 'x');
    expect(asBool(1), true);
    expect(asList(null), isEmpty);
  });
}
