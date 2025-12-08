// Test SSE endpoint with fetch (will get initial response)
fetch('http://localhost:5173/api/turnstile')
  .then(response => {
    console.log('SSE endpoint status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    return response.text();
  })
  .then(data => {
    console.log('SSE initial response:', data.substring(0, 200));
  })
  .catch(error => {
    console.error('SSE fetch error:', error);
  });

// Test control endpoint
setTimeout(async () => {
  try {
    const response = await fetch('http://localhost:5173/api/turnstile/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock' })
    });
    console.log('Control response status:', response.status);
    const text = await response.text();
    console.log('Control response body:', text);
  } catch (error) {
    console.error('Control error:', error);
  }
}, 1000);