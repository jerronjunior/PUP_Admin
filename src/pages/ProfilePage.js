import React, { useEffect, useState } from 'react';
import { db, storage, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import useMediaQuery from '../hooks/useMediaQuery';

export default function ProfilePage({ user }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');

  // Profile picture state
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoPreviewSrc, setPhotoPreviewSrc] = useState('');
  const [photoErr, setPhotoErr] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [loadingProfile, setLoadingProfile] = useState(true);

  // Load existing profile picture URL from Firestore
  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.uid) return;
      try {
        const docRef = doc(db, 'admin_profiles', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPhotoUrl(docSnap.data().photoUrl || '');
        }
      } catch (err) {
        console.error('Error loading profile:', err);
      } finally {
        setLoadingProfile(false);
      }
    };
    loadProfile();
  }, [user?.uid]);

  // Handle photo file selection
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewSrc('');
      return;
    }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  const handlePhotoChange = e => {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoFile(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoErr('Please choose a valid image file.');
      setPhotoFile(null);
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setPhotoErr('Image must be 5MB or less.');
      setPhotoFile(null);
      return;
    }

    setPhotoErr('');
    setPhotoFile(file);
  };

  const uploadProfilePhoto = async () => {
    if (!photoFile || !user?.uid) return;

    setPhotoLoading(true);
    setPhotoErr('');

    try {
      const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const imageRef = ref(storage, `admin_profiles/${user.uid}-${Date.now()}-${safeName}`);
      await uploadBytes(imageRef, photoFile);
      const downloadUrl = await getDownloadURL(imageRef);

      // Save photo URL to Firestore
      await setDoc(doc(db, 'admin_profiles', user.uid), { photoUrl: downloadUrl }, { merge: true });

      setPhotoUrl(downloadUrl);
      setPhotoFile(null);
      setPhotoPreviewSrc('');
    } catch (err) {
      setPhotoErr('Failed to upload photo: ' + (err.message || 'Unknown error'));
    } finally {
      setPhotoLoading(false);
    }
  };

  const handlePasswordChange = async e => {
    e.preventDefault();
    setPasswordErr('');
    setPasswordSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordErr('All fields are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordErr('New passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordErr('New password must be at least 6 characters.');
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordErr('New password must be different from current password.');
      return;
    }

    setPasswordLoading(true);

    try {
      // Reauthenticate user
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      // Update password
      await updatePassword(auth.currentUser, newPassword);

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      if (err.code === 'auth/wrong-password') {
        setPasswordErr('Current password is incorrect.');
      } else if (err.code === 'auth/weak-password') {
        setPasswordErr('New password is too weak.');
      } else {
        setPasswordErr('Failed to update password: ' + (err.message || 'Unknown error'));
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loadingProfile) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading profile…</div>;
  }

  return (
    <div>
      <div style={{ ...s.pageHeader, ...(isMobile ? s.pageHeaderMobile : {}) }}>
        <div>
          <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}), ...(isTinyMobile ? s.h1Tiny : {}) }}>
            Admin Profile
          </h1>
          <p style={s.sub}>Manage your profile and account settings</p>
        </div>
      </div>

      {/* Profile Picture Section */}
      <div style={{ ...s.card, ...(isMobile ? s.cardMobile : {}) }}>
        <h3 style={{ ...s.cardTitle, ...(isMobile ? s.cardTitleMobile : {}) }}>🖼️ Profile Picture</h3>

        <div style={s.photoSection}>
          {/* Current/Preview Photo */}
          <div style={s.photoDisplayWrap}>
            {photoFile ? (
              <img alt="preview" src={photoPreviewSrc} style={s.photoDisplay} />
            ) : photoUrl ? (
              <img alt="current" src={photoUrl} style={s.photoDisplay} />
            ) : (
              <div style={s.photoPlaceholder}>
                <span style={{ fontSize: 56 }}>📷</span>
                <div style={s.photoPlaceholderText}>No photo</div>
              </div>
            )}
          </div>

          {/* Photo Controls */}
          <div style={s.photoControls}>
            <div>
              <label style={s.fileLabel}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                />
                <span style={s.fileButton}>Choose Image</span>
              </label>
              <div style={s.fileHint}>JPG, PNG or GIF. Max 5MB.</div>
            </div>

            {photoErr && <div style={s.error}>{photoErr}</div>}

            {photoFile && (
              <button type="button" onClick={uploadProfilePhoto} style={s.uploadBtn} disabled={photoLoading}>
                {photoLoading ? 'Uploading…' : '✓ Upload Photo'}
              </button>
            )}

            {photoUrl && !photoFile && (
              <div style={s.success}>✓ Photo uploaded</div>
            )}
          </div>
        </div>
      </div>

      {/* Password Change Section */}
      <div style={{ ...s.card, ...(isMobile ? s.cardMobile : {}) }}>
        <h3 style={{ ...s.cardTitle, ...(isMobile ? s.cardTitleMobile : {}) }}>🔐 Change Password</h3>

        <form onSubmit={handlePasswordChange}>
          <div style={s.formGrid}>
            <div>
              <label style={s.label}>Current Password *</label>
              <input
                type="password"
                style={s.input}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </div>

            <div>
              <label style={s.label}>New Password *</label>
              <input
                type="password"
                style={s.input}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
            </div>

            <div>
              <label style={s.label}>Confirm New Password *</label>
              <input
                type="password"
                style={s.input}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
            </div>
          </div>

          {passwordErr && <div style={s.error}>{passwordErr}</div>}
          {passwordSuccess && <div style={s.success}>✓ Password updated successfully</div>}

          <button type="submit" style={s.saveBtn} disabled={passwordLoading}>
            {passwordLoading ? 'Updating…' : '💾 Update Password'}
          </button>
        </form>
      </div>

      {/* Account Info Section */}
      <div style={{ ...s.card, ...(isMobile ? s.cardMobile : {}) }}>
        <h3 style={{ ...s.cardTitle, ...(isMobile ? s.cardTitleMobile : {}) }}>ℹ️ Account Information</h3>

        <div style={s.infoGrid}>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Email:</span>
            <span style={s.infoValue}>{user?.email}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>User ID:</span>
            <span style={{ ...s.infoValue, fontFamily: 'monospace', fontSize: 12 }}>{user?.uid}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Role:</span>
            <span style={s.infoValue}>Administrator</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  pageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  pageHeaderMobile: { flexDirection: 'column', gap: 10, marginBottom: 16 },
  h1: { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile: { fontSize: 24 },
  h1Tiny: { fontSize: 21 },
  sub: { margin: '4px 0 0', color: '#888', fontSize: 14 },
  card: { background: '#fff', borderRadius: 14, padding: '22px 24px', marginBottom: 20, boxShadow: '0 2px 10px rgba(0,0,0,.06)' },
  cardMobile: { padding: '16px 14px', marginBottom: 14, borderRadius: 12 },
  cardTitle: { margin: '0 0 18px', fontSize: 18, fontWeight: 700, color: '#222' },
  cardTitleMobile: { fontSize: 16, marginBottom: 14 },

  photoSection: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 24, alignItems: 'start' },
  photoDisplayWrap: { position: 'relative' },
  photoDisplay: { width: 160, height: 160, borderRadius: 12, objectFit: 'cover', border: '2px solid #e8edf2' },
  photoPlaceholder: { width: 160, height: 160, borderRadius: 12, border: '2px dashed #d9e3e8', background: '#f7faf9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPlaceholderText: { fontSize: 12, color: '#8897a3', fontWeight: 600 },
  photoControls: { display: 'flex', flexDirection: 'column', gap: 12 },
  fileLabel: { cursor: 'pointer' },
  fileButton: { display: 'inline-block', padding: '10px 20px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  fileHint: { fontSize: 12, color: '#8897a3', marginTop: 6 },
  uploadBtn: { padding: '10px 20px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  error: { background: '#FFEBEE', color: '#C62828', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginTop: 12 },
  success: { background: '#E8F5E9', color: '#2E7D32', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginTop: 12 },

  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: .4 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  saveBtn: { padding: '12px 28px', background: 'linear-gradient(135deg,#2E7D32,#388E3C)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: .3 },

  infoGrid: { display: 'flex', flexDirection: 'column', gap: 16 },
  infoRow: { display: 'grid', gridTemplateColumns: '100px 1fr', gap: 16, alignItems: 'center' },
  infoLabel: { fontWeight: 700, color: '#555', fontSize: 14 },
  infoValue: { color: '#333', fontSize: 14 },
};
