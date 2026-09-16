'use client';
// Pantalla propia para leer y firmar UN contrato digital.
//
// Existe para que el enlace que se le manda a un cliente o a un propietario
// («firma tu contrato aquí») lleve a un sitio donde solo está el documento, sin el
// resto del panel alrededor. Quién puede abrirla lo decide el servidor en
// GET /api/contratos/[id]: a quien no sea parte ni tenga el área de contratos le
// responde 404, y el componente muestra ese mensaje.
import { useParams } from 'next/navigation';
import ContratoFirmar from '@/components/ContratoFirmar';

export default function ContratoPage() {
  const { id } = useParams<{ id: string }>();
  const contratoId = Number(id);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {Number.isInteger(contratoId) && contratoId > 0 ? (
        <ContratoFirmar contratoId={contratoId} />
      ) : (
        <div className="bg-danger/5 border border-danger/25 rounded-2xl p-5 text-center">
          <p className="text-danger text-sm">Documento no encontrado.</p>
        </div>
      )}
    </div>
  );
}
