fetch('http://127.0.0.1:3000/api/auth/setup-admin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'adminpassword' })
})
.then(res => res.json())
.then(console.log)
.catch(console.error);
