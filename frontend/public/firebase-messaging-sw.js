importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAem3j-vD6nYTAoqvG1p2IYYCFQ7FL1V8Y",
  authDomain: "college-attandance-tracker-202.firebaseapp.com",
  projectId: "college-attandance-tracker-202",
  storageBucket: "college-attandance-tracker-202.firebasestorage.app",
  messagingSenderId: "1057513234016",
  appId: "1:1057513234016:web:38c03953ff34e3561eed05",
  measurementId: "G-SB0VZ5XQ7Y"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || 'Attendance Notification';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'Your attendance status was updated.',
    icon: '/favicon.ico',
    data: payload.data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
