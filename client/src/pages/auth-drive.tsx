export default function AuthDrive() {
  console.log('[EXTREME SIMPLE] Component rendering!');
  
  if (typeof window !== 'undefined') {
    console.log('[EXTREME SIMPLE] Window URL:', window.location.href);
    console.log('[EXTREME SIMPLE] Has opener:', !!window.opener);
  }

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>Google Drive Auth - TEST MODE</h1>
      <p>Check console for debug messages</p>
      <button onClick={() => {
        console.log('[EXTREME SIMPLE] Test button clicked');
        if (window.opener) {
          window.opener.postMessage({ type: 'DRIVE_AUTH_SUCCESS', test: true }, '*');
          window.close();
        }
      }}>
        Test Message & Close
      </button>
    </div>
  );
}