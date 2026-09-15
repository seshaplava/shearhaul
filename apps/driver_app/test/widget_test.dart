import 'package:flutter_test/flutter_test.dart';
import 'package:driver_app/main.dart';

void main() {
  testWidgets('Driver app boots', (tester) async {
    await tester.pumpWidget(const DriverApp());
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
