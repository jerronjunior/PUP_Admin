# Flutter App Setup for Reward Config Sync

Add these files to your Flutter project to enable real-time reward config sync from the admin panel.

---

## File 1: `lib/models/reward_config_model.dart`

**Path:** `lib/models/reward_config_model.dart`

**Content:** Copy the entire `reward_config_model.dart` file from your Desktop into this location.

This model mirrors the Firestore `reward_config/default` document with all fields including the new `spinCost`.

---

## File 2: `lib/providers/rewards_provider.dart`

**Path:** `lib/providers/rewards_provider.dart`

**Content:** Copy the entire `rewards_provider.dart` file from your Desktop into this location.

This provider:
- Listens to Firestore in real-time via stream
- Updates the entire app when admin changes values
- Provides quick getters like `spinCost` for any screen to use

**Integration in `main.dart`:**

Wrap your `MaterialApp` with `MultiProvider`:

```dart
import 'package:provider/provider.dart';
import 'providers/rewards_provider.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => RewardsProvider()),
        // ... other providers
      ],
      child: MyApp(),
    ),
  );
}
```

---

## File 3: Add Methods to `lib/services/firestore_service.dart`

**Path:** `lib/services/firestore_service.dart`

**Action:** Add these THREE methods to your existing `FirestoreService` class:

```dart
// ── 1. REAL-TIME STREAM ───────────────────────────────────────────────────────
Stream<RewardConfigModel> rewardConfigStream() {
  return _firestore
      .collection('reward_config')
      .doc('default')
      .snapshots()
      .map((snap) {
    if (!snap.exists || snap.data() == null) {
      return RewardConfigModel.defaults();
    }
    return RewardConfigModel.fromMap(snap.id, snap.data()!);
  });
}

// ── 2. ONE-TIME FETCH ─────────────────────────────────────────────────────────
Future<RewardConfigModel> getRewardConfig() async {
  try {
    final snap = await _firestore
        .collection('reward_config')
        .doc('default')
        .get();
    if (!snap.exists || snap.data() == null) {
      return RewardConfigModel.defaults();
    }
    return RewardConfigModel.fromMap(snap.id, snap.data()!);
  } catch (_) {
    return RewardConfigModel.defaults();
  }
}

// ── 3. SAVE (used by Flutter admin screens) ───────────────────────────────────
Future<void> updateRewardConfig(RewardConfigModel config) async {
  await _firestore
      .collection('reward_config')
      .doc('default')
      .set(config.toMap(), SetOptions(merge: true));
}
```

---

## Usage in Screens

Once set up, use reward config anywhere in your app:

```dart
// In any screen/widget
final config = context.watch<RewardsProvider>();

// Access individual values
final spinCost = config.spinCost;
final pointsPerBottle = config.pointsPerBottle;
final wheelGifts = config.wheelGifts;

// Or the entire config
final allConfig = config.config;
```

**Example: Spin Wheel Screen**

```dart
class SpinWheelScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final rewardsConfig = context.watch<RewardsProvider>();
    
    return Column(
      children: [
        Text('Spin Cost: ${rewardsConfig.spinCost} points'),
        RollingGiftBox(
          gifts: rewardsConfig.wheelGifts,
        ),
        ElevatedButton(
          onPressed: userPoints >= rewardsConfig.spinCost 
            ? () => spinWheel(rewardsConfig.spinCost)
            : null,
          child: Text('Spin (${rewardsConfig.spinCost} pts)'),
        ),
      ],
    );
  }
}
```

---

## Verification Checklist

- [ ] `lib/models/reward_config_model.dart` created
- [ ] `lib/providers/rewards_provider.dart` created
- [ ] Three methods added to `lib/services/firestore_service.dart`
- [ ] `MultiProvider` configured in `main.dart`
- [ ] Import `RewardConfigModel` in reward_config_model.dart
- [ ] Import `RewardsProvider` in main.dart and screens
- [ ] `pubspec.yaml` has `provider: ^6.x` dependency (run `flutter pub get`)

---

## Testing

1. Open your Flutter app
2. Navigate to admin panel → Manage Rewards → Spin Wheel Gifts
3. Change "Spin Cost (points)" value (e.g., 25 → 50)
4. Click "Save Changes"
5. Check your Flutter app — the spin cost should update instantly in real-time
6. Refresh the app if needed and verify the new value persists

---

## Key Difference from Admin Panel

**Admin Panel (React):**
- Field name: `spinCost`
- Stored in: `reward_config/default.spinCost`
- UI: NumberField component labeled "Spin Cost (points)"

**Flutter App:**
- Model field: `spinCost` (maps from Firestore `spinCost` field)
- Read via: `RewardsProvider().spinCost`
- Auto-updates when admin changes the value

**✅ Aligned:** Both admin panel and Flutter app use the same field name `spinCost` in Firestore, so real-time sync works instantly!
