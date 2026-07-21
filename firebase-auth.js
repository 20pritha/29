// Firebase client bridge (ES module). Loads the Firebase Auth SDK, and exposes a
// tiny non-module API on window.Firebase so the plain-script app (online.js) can
// use it. Sign-in returns an ID token, which online.js sends to the server for
// verification. If the SDK can't load (offline, blocked), the app falls back to
// its own username/password auth — nothing here is required to play.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

let auth = null;
try {
  auth = getAuth(initializeApp(window.FIREBASE_CONFIG));
} catch (e) {
  console.warn('Firebase init failed:', e && e.message);
}

window.Firebase = {
  available: !!auth,
  /** Google popup sign-in → resolves to an ID token. */
  async signInGoogle() {
    const res = await signInWithPopup(auth, new GoogleAuthProvider());
    return res.user.getIdToken();
  },
  /** Email/password sign-in → ID token. */
  async signInEmail(email, password) {
    const res = await signInWithEmailAndPassword(auth, email, password);
    return res.user.getIdToken();
  },
  /** Create an email/password account → ID token. */
  async registerEmail(email, password) {
    const res = await createUserWithEmailAndPassword(auth, email, password);
    return res.user.getIdToken();
  },
  /** Send a password-reset email. */
  resetPassword(email) { return sendPasswordResetEmail(auth, email); },
  /** Fresh ID token for the currently signed-in user, or null. */
  async currentToken() { return (auth && auth.currentUser) ? auth.currentUser.getIdToken() : null; },
  signOut() { return auth ? signOut(auth) : Promise.resolve(); },
};

// Notify the app when Firebase restores a session on load (auto-login).
if (auth) onAuthStateChanged(auth, (user) => {
  if (typeof window.onFirebaseUser === 'function') window.onFirebaseUser(user);
});
