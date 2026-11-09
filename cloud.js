/* Kết nối Firebase Firestore để mọi người dùng chung một bảng điểm.
   Cấu hình nằm trong firebase-config.js. Nếu chưa có cấu hình, web chỉ lưu trên trình duyệt. */
const FIREBASE_VERSION = '10.12.2';

(async () => {
  const app = window.SoDiem;
  if (!app) return;
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.projectId || !cfg.apiKey) { app.setStatus('local'); return; }

  try {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const fs = await import(`${base}/firebase-firestore.js`);
    const db = fs.getFirestore(initializeApp(cfg));

    app.connectCloud({
      DELETE: fs.deleteField(),
      write: (col, id, patch) => fs.setDoc(fs.doc(db, col, id), patch, { merge: true }),
      replace: (col, id, obj) => fs.setDoc(fs.doc(db, col, id), obj),
      async loadAll(cols) {
        const out = {};
        for (const c of cols) {
          const snap = await fs.getDocs(fs.collection(db, c));
          out[c] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        }
        return out;
      },
      subscribe(cols, onDoc, onError) {
        cols.forEach(c => fs.onSnapshot(fs.collection(db, c), snap => {
          snap.docChanges().forEach(ch => onDoc(c, ch.doc.id, ch.type === 'removed' ? null : ch.doc.data()));
        }, onError));
      },
    });
  } catch (err) {
    app.setStatus('error', err);
  }
})();
