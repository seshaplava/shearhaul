import 'package:flutter_test/flutter_test.dart';
import 'package:shipper_app/main.dart';

void main() {
  testWidgets('Shipper app boots', (tester) async {
    await tester.pumpWidget(const ShipperApp());
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
