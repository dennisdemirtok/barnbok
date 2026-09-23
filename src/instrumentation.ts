// Körs en gång när servern startar. Bakgrundsjobb (bilder och ljudböcker) som
// var igång när servern startades om tas upp direkt - annars skulle de stå
// still tills någon råkar öppna appen. Serverkoden laddas bara i Node-miljön.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
