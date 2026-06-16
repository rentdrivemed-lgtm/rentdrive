import Anthropic from '@anthropic-ai/sdk';

// Cliente de la API de Claude para el verificador de documentos.
// La clave se lee de ANTHROPIC_API_KEY (ver .env.example). Construcción lazy
// para no romper el arranque si la clave aún no está configurada.
let client: Anthropic | null = null;

export function tieneClaveAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Falta ANTHROPIC_API_KEY en el entorno (configúrala en .env.local).');
  }
  if (!client) client = new Anthropic();
  return client;
}
