import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, push, update, remove } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyA4KyRfOCaw_vnJ999_XbHLt2_anuDWES8",
  authDomain: "exchplatf.firebaseapp.com",
  databaseURL: "https://exchplatf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "exchplatf",
  storageBucket: "exchplatf.firebasestorage.app",
  messagingSenderId: "319239729444",
  appId: "1:319239729444:web:4568b488ab6c9011bd83b1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export {
  db, ref, set, get, onValue, push, update, remove,
  auth, googleProvider, signInWithPopup, onAuthStateChanged, signOut,
  storage, storageRef, uploadBytes, getDownloadURL, deleteObject
};
