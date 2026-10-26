#!/usr/bin/env python3
"""
train_bin_model.py
──────────────────
Trains a TFLite model for bin detection using your collected images.

Requirements:
  pip install tensorflow tflite-model-maker pillow numpy

Folder structure needed:
  training_data/
    bin/          ← images of real bins (from your 78 images + Firebase)
    not_bin/      ← images of false positives (keyboards, bags, plants etc)

Usage:
  python train_bin_model.py

Output:
  bin_detector.tflite  ← drop this into assets/models/ in Flutter
"""

import os, sys, shutil
from pathlib import Path
import numpy as np

# ── Check requirements ────────────────────────────────────────────────────────
try:
    import tensorflow as tf
    print(f"TensorFlow: {tf.__version__}")
except ImportError:
    print("ERROR: pip install tensorflow")
    sys.exit(1)

DATA_DIR   = 'training_data'
OUTPUT     = 'bin_detector.tflite'
IMG_SIZE   = 224
BATCH      = 16
EPOCHS     = 20

# ── Check data ────────────────────────────────────────────────────────────────
def check_data():
    bin_dir     = Path(DATA_DIR) / 'bin'
    not_bin_dir = Path(DATA_DIR) / 'not_bin'

    if not bin_dir.exists() or not not_bin_dir.exists():
        print(f"""
ERROR: Training data folders not found.

Create this structure:
  training_data/
    bin/       ← copy your 78 bin images here + more from Firebase
    not_bin/   ← screenshots of bags, keyboards, plants, clothing

Minimum: 30 images per class (more = better)
""")
        sys.exit(1)

    bin_count     = len(list(bin_dir.glob('*.jpg')) + list(bin_dir.glob('*.png')))
    not_bin_count = len(list(not_bin_dir.glob('*.jpg')) + list(not_bin_dir.glob('*.png')))

    print(f"  bin images:     {bin_count}")
    print(f"  not_bin images: {not_bin_count}")

    if bin_count < 20:
        print("WARNING: Need at least 20 bin images for decent accuracy")
    if not_bin_count < 20:
        print("WARNING: Need at least 20 not_bin images")

    return bin_count, not_bin_count


# ── Train ─────────────────────────────────────────────────────────────────────
def train():
    print("\n[1/4] Loading data…")

    datagen = tf.keras.preprocessing.image.ImageDataGenerator(
        rescale=1./255,
        validation_split=0.2,
        rotation_range=15,
        width_shift_range=0.1,
        height_shift_range=0.1,
        brightness_range=[0.7, 1.3],  # simulate different lighting
        horizontal_flip=True,
        zoom_range=0.1,
    )

    train_data = datagen.flow_from_directory(
        DATA_DIR,
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=BATCH,
        class_mode='binary',
        subset='training',
    )

    val_data = datagen.flow_from_directory(
        DATA_DIR,
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=BATCH,
        class_mode='binary',
        subset='validation',
    )

    print(f"  Classes: {train_data.class_indices}")
    print(f"  Train samples: {train_data.samples}")
    print(f"  Val samples:   {val_data.samples}")

    print("\n[2/4] Building model (MobileNetV2 transfer learning)…")

    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights='imagenet',
    )
    # Freeze base — only train top layers (fast, works with small datasets)
    base.trainable = False

    model = tf.keras.Sequential([
        base,
        tf.keras.layers.GlobalAveragePooling2D(),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(1, activation='sigmoid'),
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss='binary_crossentropy',
        metrics=['accuracy'],
    )

    print(f"  Parameters: {model.count_params():,}")

    print("\n[3/4] Training…")
    history = model.fit(
        train_data,
        epochs=EPOCHS,
        validation_data=val_data,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),
            tf.keras.callbacks.ReduceLROnPlateau(patience=3, factor=0.5),
        ],
    )

    final_acc = max(history.history['val_accuracy'])
    print(f"\n  Best validation accuracy: {final_acc*100:.1f}%")

    if final_acc < 0.80:
        print("  WARNING: Accuracy below 80%. Collect more images and retrain.")
    else:
        print("  ✓ Good accuracy — proceeding to export")

    print("\n[4/4] Exporting TFLite model…")

    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    # Quantize to reduce model size (from ~9MB to ~2MB)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_types = [tf.float16]

    tflite_model = converter.convert()

    with open(OUTPUT, 'wb') as f:
        f.write(tflite_model)

    size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
    print(f"\n  Saved: {OUTPUT} ({size_mb:.1f} MB)")
    print(f"\n  Next steps:")
    print(f"  1. Copy {OUTPUT} to Flutter: assets/models/bin_detector.tflite")
    print(f"  2. Upload to Firebase Storage: models/bin_detector.tflite")
    print(f"  3. Update Remote Config: tflite_model_version = today's date")

    return final_acc


# ── Download training data from Firebase (optional) ───────────────────────────
def download_from_firebase(project_id='price-ur-plastic-faab5'):
    """
    If you have Firebase training data collected from the app,
    download it first: python train_bin_model.py --download
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, storage as fb_storage
    except ImportError:
        print("pip install firebase-admin")
        return

    cred_path = 'service-account-key.json'
    if not os.path.exists(cred_path):
        print(f"Need {cred_path} from Firebase Console → Project Settings → Service Accounts")
        return

    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {'storageBucket': f'{project_id}.firebasestorage.app'})

    db     = firestore.client()
    bucket = fb_storage.bucket()

    print("Downloading verified training samples from Firebase…")
    samples = db.collection('training_samples') \
                .where('verified', '==', True) \
                .stream()

    counts = {'bin': 0, 'not_bin': 0}

    for doc in samples:
        data  = doc.to_dict()
        label = data.get('label', '')

        # Two storage reference styles exist:
        #   • Flutter app saves 'imageUrl' (full download URL)
        #   • Web admin saves 'storagePath' (direct bucket path)
        # Handle both so samples from BOTH sources get downloaded.
        url          = data.get('imageUrl', '')
        storage_path = data.get('storagePath', '')

        if not url and not storage_path:
            continue

        # Map Firebase labels to folder names
        folder = 'bin' if label in (
            'binRed','binGreen','binPurple','binUnknown',
            'clean_sri_lanka','carekleen','bin'
        ) else 'not_bin' if label == 'notBottle' else None

        if not folder: continue

        dest = Path(DATA_DIR) / folder
        dest.mkdir(parents=True, exist_ok=True)

        try:
            if storage_path:
                # Web admin format — direct bucket path
                blob_path = storage_path
            else:
                # Flutter format — extract path from the download URL
                blob_path = url.split('/o/')[1].split('?')[0].replace('%2F', '/')

            blob = bucket.blob(blob_path)
            blob.download_to_filename(str(dest / f"{doc.id}.jpg"))
            counts[folder] += 1
            print(f"  {folder}: {doc.id[:12]}…")
        except Exception as e:
            print(f"  skip {doc.id}: {e}")

    print(f"\nDownloaded: bin={counts['bin']}  not_bin={counts['not_bin']}")


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if '--download' in sys.argv:
        download_from_firebase()
    else:
        print("Bin Detector — TFLite Training Script")
        print("─" * 40)
        check_data()
        train()
