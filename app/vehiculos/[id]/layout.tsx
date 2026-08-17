import type { Metadata } from 'next';
import { getDb } from '@/lib/db';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.drivepasscol.com';

type VehiculoRow = {
  marca: string;
  modelo: string;
  anio: number;
  tipo: string;
  ubicacion: string;
  precio_dia: number;
  descripcion: string | null;
  fotos: string | null;
  disponible: number;
};

function getVehiculo(id: string): VehiculoRow | undefined {
  const db = getDb();
  return db
    .prepare(
      'SELECT marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion, fotos, disponible FROM vehiculos WHERE id = ?'
    )
    .get(Number(id)) as VehiculoRow | undefined;
}

function primeraFoto(fotos: string | null): string | undefined {
  if (!fotos) return undefined;
  try {
    const arr = JSON.parse(fotos);
    if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
      return arr[0];
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function recortarDescripcion(texto: string, max = 155): string {
  if (texto.length <= max) return texto;
  return `${texto.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vehiculo = getVehiculo(id);

  if (!vehiculo) {
    return {
      title: 'Vehículo en alquiler en Medellín',
      description:
        'Alquila carros en Medellín directamente entre particulares con DrivePass. Sin intermediarios, con seguro incluido.',
    };
  }

  const { marca, modelo, anio, ubicacion, precio_dia, descripcion } = vehiculo;
  const title = `${marca} ${modelo} ${anio} en alquiler en Medellín`;

  const description =
    descripcion && descripcion.trim().length > 0
      ? recortarDescripcion(descripcion.trim())
      : recortarDescripcion(
          `Alquila el ${marca} ${modelo} ${anio} en ${ubicacion} desde $${precio_dia.toLocaleString('es-CO')}/día. Reserva directo con el propietario, sin intermediarios.`
        );

  const foto = primeraFoto(vehiculo.fotos);
  const imageUrl = foto ? (foto.startsWith('http') ? foto : `${BASE_URL}${foto}`) : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function VehiculoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vehiculo = getVehiculo(id);

  if (!vehiculo) {
    return <>{children}</>;
  }

  const { marca, modelo, anio, ubicacion, precio_dia, descripcion, disponible } = vehiculo;
  const foto = primeraFoto(vehiculo.fotos);
  const imageUrl = foto ? (foto.startsWith('http') ? foto : `${BASE_URL}${foto}`) : undefined;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${marca} ${modelo} ${anio}`,
    description:
      descripcion && descripcion.trim().length > 0
        ? descripcion.trim()
        : `Alquiler del ${marca} ${modelo} ${anio} en ${ubicacion}, Medellín.`,
    ...(imageUrl ? { image: imageUrl } : {}),
    offers: {
      '@type': 'Offer',
      price: precio_dia,
      priceCurrency: 'COP',
      availability: disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${BASE_URL}/vehiculos/${id}`,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
