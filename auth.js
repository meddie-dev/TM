// Initialize Supabase (only once)
const SUPABASE_URL = 'https://vguximxbchwhcsgfdyfn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZndXhpbXhiY2h3aGNzZ2ZkeWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MDc0MzYsImV4cCI6MjA5NzA4MzQzNn0.0EZpyd0TUUJ_kjm69CywYGJWZc9qPCKWei2UnEJSl4M';

// Create global supabase client
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Logout function
window.logout = async function() {
    await window.supabaseClient.auth.signOut();
    window.location.href = 'login.html';
};

console.log('Auth.js loaded - Supabase client ready');