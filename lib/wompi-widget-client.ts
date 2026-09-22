'use client';
/**
 * Formulario oficial de Wompi para capturar la tarjeta (widget en modo
 * `tokenize`). Antes pedíamos número, fecha y CVV con inputs propios en
 * `/pago`: el dato de la tarjeta pasaba por nuestra página (nos dejaba en el
 * nivel de cumplimiento PCI más exigente, SAQ A-EP). El widget corre en su
 * propio modal — el número y CVV nunca tocan nuestro DOM — y solo nos
 * devuelve un `tok_...` para crear la fuente de pago (SAQ A).
 */

const WIDGET_SRC = 'https://checkout.wompi.co/widget.js';

export interface WompiPaymentSource {
  token: string;
  type: string;
}

interface WidgetCheckoutInstance {
  open(callback: (result: { payment_source?: WompiPaymentSource }) => void): void;
}

declare global {
  interface Window {
    WidgetCheckout?: new (config: {
      publicKey: string;
      widgetOperation: 'tokenize';
    }) => WidgetCheckoutInstance;
  }
}

let loading: Promise<void> | null = null;

/** Carga `widget.js` una sola vez por pestaña, aunque se abra varias veces. */
function loadWidget(): Promise<void> {
  if (window.WidgetCheckout) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = WIDGET_SRC;
      script.async = true;
      script.onload = () =>
        window.WidgetCheckout
          ? resolve()
          : reject(new Error('El formulario de pago de Wompi no respondió.'));
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('No se pudo cargar el formulario seguro de Wompi. Revisa tu conexión e inténtalo de nuevo.'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * Abre el modal de Wompi para capturar la tarjeta. `onToken` solo se llama si
 * la persona completa el formulario: si cierra el modal sin pagar, Wompi no
 * avisa (no hay evento de cancelación), así que quien use esto debe manejar
 * ese caso aparte (p. ej. un listener de `focus` en la ventana).
 */
export async function openCardTokenizer(
  publicKey: string,
  onToken: (source: WompiPaymentSource) => void,
): Promise<void> {
  await loadWidget();
  const WidgetCheckout = window.WidgetCheckout;
  if (!WidgetCheckout) throw new Error('El formulario de pago de Wompi no respondió.');
  const checkout = new WidgetCheckout({ publicKey, widgetOperation: 'tokenize' });
  checkout.open((result) => {
    const source = result?.payment_source;
    if (source?.token) onToken(source);
  });
}
