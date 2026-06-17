import Anthropic from '@anthropic-ai/sdk';
let client: Anthropic | null = null;
export function tieneClaveAnthropic(): boolean { return !!process.env.ANTHROPIC_API_KEY; }
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
  if (!client) client = new Anthropic();
  return client;
}