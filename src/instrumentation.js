export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureMigrations } = await import('./server/migrate.js');
    await ensureMigrations().catch(err =>
      console.error('[migrations] startup error:', err.message)
    );
  }
}
